// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Audio monitor passthrough: captures from an input device and plays back
//! through an output device in real time.
//!
//! The flow is:
//!
//! ```text
//! input device → capture callback → ring buffer → output callback → speakers/headphones
//! ```
//!
//! This is fully decoupled from the decode pipeline: both run independently from
//! whatever captures audio, so an operator can hear the rig while decoding
//! proceeds separately. Volume is adjustable without restarting the streams.
//!
//! ## Threading model
//!
//! `cpal::Stream` is `!Send`. [`Monitor`] therefore lives on a dedicated thread
//! and is controlled via a channel. [`MonitorHandle`] is the `Send`-able entry
//! point stored in Tauri state; it owns the channel sender, and dropping it (or
//! calling [`MonitorHandle::stop`]) shuts the thread down cleanly.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample};

use super::device::DeviceInfo;
use super::source::AudioError;

/// Ring buffer latency, in milliseconds.
const RING_MS: u64 = 80;

// ---------------------------------------------------------------------------
// Ring buffer
// ---------------------------------------------------------------------------

/// Lock-free-ish ring buffer shared between the monitor's input and output
/// cpal callbacks via `Arc`.
///
/// Sized to ~80 ms at the input device's sample rate — enough cushion to absorb
/// callback scheduling jitter without adding audible latency. On overrun the
/// oldest samples are discarded silently; on underrun the output fills with
/// zeros (silence).
struct RingBuf {
    buf: Mutex<VecDeque<f32>>,
    capacity: usize,
}

impl RingBuf {
    fn new(capacity: usize) -> Arc<Self> {
        Arc::new(Self {
            buf: Mutex::new(VecDeque::with_capacity(capacity)),
            capacity,
        })
    }

    /// Push mono samples from the capture callback, dropping the oldest on overrun.
    fn push(&self, samples: &[f32]) {
        let mut buf = self.buf.lock().expect("monitor ring buf poisoned");
        for &s in samples {
            if buf.len() >= self.capacity {
                buf.pop_front();
            }
            buf.push_back(s);
        }
    }

    /// Drain `out.len()` mono frames, applying `volume`, filling with silence on underrun.
    fn fill(&self, out: &mut [f32], volume: f32) {
        let mut buf = self.buf.lock().expect("monitor ring buf poisoned");
        for slot in out.iter_mut() {
            *slot = buf.pop_front().unwrap_or(0.0) * volume;
        }
    }
}

// ---------------------------------------------------------------------------
// Output device enumeration
// ---------------------------------------------------------------------------

/// Enumerate available output devices for the monitor output picker.
///
/// Returns the host's output devices with the default flagged. The `id` field
/// of each entry is passed back to [`MonitorHandle::start`].
pub fn list_output_devices() -> Result<Vec<DeviceInfo>, AudioError> {
    let host = cpal::default_host();
    let default_id = host
        .default_output_device()
        .and_then(|d| d.id().ok())
        .map(|id| id.to_string());

    let devices = host
        .output_devices()
        .map_err(|e| AudioError::Device(format!("cannot enumerate output devices: {e}")))?;

    let mut out = Vec::new();
    for device in devices {
        let id = match device.id() {
            Ok(id) => id.to_string(),
            Err(_) => continue,
        };
        let name = device
            .description()
            .map(|d| d.to_string())
            .unwrap_or_else(|_| id.clone());
        let default = default_id.as_ref() == Some(&id);
        out.push(DeviceInfo { id, name, default });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Monitor (lives on its own thread — !Send)
// ---------------------------------------------------------------------------

/// An active monitor passthrough: one input stream → ring buffer → one output stream.
///
/// `cpal::Stream` is `!Send`; this type is created and dropped on its own thread
/// via [`MonitorHandle`]. Do not attempt to share it across threads.
struct Monitor {
    _input_stream: cpal::Stream,
    _output_stream: cpal::Stream,
    volume: Arc<Mutex<f32>>,
}

impl Monitor {
    fn start(
        input_id: Option<&str>,
        output_id: Option<&str>,
        volume: f32,
    ) -> Result<Self, AudioError> {
        let host = cpal::default_host();

        let in_device = resolve_input(&host, input_id)?;
        let in_supported = in_device
            .default_input_config()
            .map_err(|e| AudioError::Device(format!("no default input config: {e}")))?;
        let in_rate = in_supported.sample_rate();
        let in_channels = in_supported.channels() as usize;
        let in_format = in_supported.sample_format();
        let in_config: cpal::StreamConfig = in_supported.into();

        let out_device = resolve_output(&host, output_id)?;
        let out_supported = best_output_config(&out_device, in_rate)?;
        let out_channels = out_supported.channels() as usize;
        let out_format = out_supported.sample_format();
        let out_config: cpal::StreamConfig = out_supported.into();

        let capacity = (in_rate as u64 * RING_MS / 1000) as usize;
        let ring = RingBuf::new(capacity);
        let ring_in = ring.clone();
        let ring_out = ring;

        let volume = Arc::new(Mutex::new(volume.clamp(0.0, 1.0)));
        let volume_out = volume.clone();

        let input_stream =
            build_monitor_input(&in_device, &in_config, in_format, in_channels, ring_in)?;
        let output_stream = build_monitor_output(
            &out_device,
            &out_config,
            out_format,
            out_channels,
            ring_out,
            volume_out,
        )?;

        input_stream
            .play()
            .map_err(|e| AudioError::Device(format!("cannot start monitor input: {e}")))?;
        output_stream
            .play()
            .map_err(|e| AudioError::Device(format!("cannot start monitor output: {e}")))?;

        Ok(Self {
            _input_stream: input_stream,
            _output_stream: output_stream,
            volume,
        })
    }

    fn set_volume(&self, v: f32) {
        *self.volume.lock().expect("monitor volume poisoned") = v.clamp(0.0, 1.0);
    }
}

// ---------------------------------------------------------------------------
// MonitorHandle — the Send wrapper stored in Tauri state
// ---------------------------------------------------------------------------

enum MonitorCmd {
    SetVolume(f32),
    Stop,
}

/// A `Send` handle to a running [`Monitor`].
///
/// The actual streams live on a dedicated thread; this handle communicates with
/// it via a channel. Dropping the handle (or calling [`stop`](MonitorHandle::stop))
/// signals the thread to tear down both streams.
pub struct MonitorHandle {
    cmd_tx: std::sync::mpsc::SyncSender<MonitorCmd>,
}

// Safety: SyncSender is Send, so MonitorHandle is Send.
// The !Send Monitor lives entirely on the worker thread.
unsafe impl Send for MonitorHandle {}

impl MonitorHandle {
    /// Spawn a monitor thread and start both streams.
    ///
    /// Returns after the streams are confirmed running (or an error is returned).
    /// `input_id` / `output_id` are [`DeviceInfo::id`] values; pass `None` for
    /// the host default. `volume` is clamped to `[0.0, 1.0]`.
    pub fn start(
        input_id: Option<String>,
        output_id: Option<String>,
        volume: f32,
    ) -> Result<Self, AudioError> {
        let (cmd_tx, cmd_rx) = std::sync::mpsc::sync_channel::<MonitorCmd>(32);
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), AudioError>>();

        std::thread::spawn(move || {
            let monitor = match Monitor::start(
                input_id.as_deref(),
                output_id.as_deref(),
                volume,
            ) {
                Ok(m) => {
                    ready_tx.send(Ok(())).ok();
                    m
                }
                Err(e) => {
                    ready_tx.send(Err(e)).ok();
                    return;
                }
            };

            for cmd in cmd_rx {
                match cmd {
                    MonitorCmd::SetVolume(v) => monitor.set_volume(v),
                    MonitorCmd::Stop => break,
                }
            }
            // monitor dropped here — both streams stop
        });

        // Block until the thread confirms both streams are up (or reports failure).
        ready_rx
            .recv()
            .unwrap_or(Err(AudioError::Device("monitor thread exited immediately".into())))?;

        Ok(Self { cmd_tx })
    }

    /// Update the playback volume without restarting the streams.
    ///
    /// `v` is clamped to `[0.0, 1.0]`; 0.0 mutes, 1.0 is unity gain.
    pub fn set_volume(&self, v: f32) {
        let _ = self.cmd_tx.send(MonitorCmd::SetVolume(v));
    }

    /// Stop the monitor and tear down both streams.
    pub fn stop(self) {
        let _ = self.cmd_tx.send(MonitorCmd::Stop);
        // cmd_tx drops → thread's recv loop ends → Monitor drops
    }
}

// ---------------------------------------------------------------------------
// Device helpers
// ---------------------------------------------------------------------------

fn resolve_input(host: &cpal::Host, id: Option<&str>) -> Result<cpal::Device, AudioError> {
    match id {
        Some(want) => host
            .input_devices()
            .map_err(|e| AudioError::Device(format!("cannot enumerate input devices: {e}")))?
            .find(|d| d.id().map(|got| got.to_string() == want).unwrap_or(false))
            .ok_or_else(|| AudioError::Device(format!("input device not found: {want}"))),
        None => host
            .default_input_device()
            .ok_or_else(|| AudioError::Device("no default input device".to_string())),
    }
}

fn resolve_output(host: &cpal::Host, id: Option<&str>) -> Result<cpal::Device, AudioError> {
    match id {
        Some(want) => host
            .output_devices()
            .map_err(|e| AudioError::Device(format!("cannot enumerate output devices: {e}")))?
            .find(|d| d.id().map(|got| got.to_string() == want).unwrap_or(false))
            .ok_or_else(|| AudioError::Device(format!("output device not found: {want}"))),
        None => host
            .default_output_device()
            .ok_or_else(|| AudioError::Device("no default output device".to_string())),
    }
}

/// Find an output config that matches `preferred_rate` if the device supports
/// it; fall back to the device's own default otherwise.
///
/// Rate-matching avoids resampling and keeps pitch/speed accurate. When the
/// input and output devices share a host clock (common on macOS CoreAudio), the
/// rates almost always agree and no resampling is needed.
fn best_output_config(
    device: &cpal::Device,
    preferred_rate: u32,
) -> Result<cpal::SupportedStreamConfig, AudioError> {
    if let Ok(ranges) = device.supported_output_configs() {
        for range in ranges {
            if range.min_sample_rate() <= preferred_rate
                && preferred_rate <= range.max_sample_rate()
            {
                return Ok(range.with_sample_rate(preferred_rate));
            }
        }
    }
    device
        .default_output_config()
        .map_err(|e| AudioError::Device(format!("no default output config: {e}")))
}

// ---------------------------------------------------------------------------
// Stream builders
// ---------------------------------------------------------------------------

fn build_monitor_input(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    format: SampleFormat,
    channels: usize,
    ring: Arc<RingBuf>,
) -> Result<cpal::Stream, AudioError> {
    match format {
        SampleFormat::F32 => build_typed_input::<f32>(device, config, channels, ring),
        SampleFormat::F64 => build_typed_input::<f64>(device, config, channels, ring),
        SampleFormat::I16 => build_typed_input::<i16>(device, config, channels, ring),
        SampleFormat::I32 => build_typed_input::<i32>(device, config, channels, ring),
        SampleFormat::U16 => build_typed_input::<u16>(device, config, channels, ring),
        SampleFormat::U8 => build_typed_input::<u8>(device, config, channels, ring),
        other => Err(AudioError::Device(format!(
            "unsupported monitor input format: {other:?}"
        ))),
    }
}

fn build_typed_input<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    channels: usize,
    ring: Arc<RingBuf>,
) -> Result<cpal::Stream, AudioError>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let inv_channels = 1.0 / channels.max(1) as f32;
    let mut mono_scratch = Vec::new();
    device
        .build_input_stream(
            *config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                mono_scratch.clear();
                for frame in data.chunks(channels) {
                    let sum: f32 = frame.iter().map(|&s| f32::from_sample(s)).sum();
                    mono_scratch.push(sum * inv_channels);
                }
                ring.push(&mono_scratch);
            },
            |err| eprintln!("monitor input stream error: {err}"),
            None,
        )
        .map_err(|e| AudioError::Device(format!("cannot build monitor input stream: {e}")))
}

fn build_monitor_output(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    format: SampleFormat,
    channels: usize,
    ring: Arc<RingBuf>,
    volume: Arc<Mutex<f32>>,
) -> Result<cpal::Stream, AudioError> {
    match format {
        SampleFormat::F32 => build_typed_output::<f32>(device, config, channels, ring, volume),
        SampleFormat::F64 => build_typed_output::<f64>(device, config, channels, ring, volume),
        SampleFormat::I16 => build_typed_output::<i16>(device, config, channels, ring, volume),
        SampleFormat::I32 => build_typed_output::<i32>(device, config, channels, ring, volume),
        SampleFormat::U16 => build_typed_output::<u16>(device, config, channels, ring, volume),
        SampleFormat::U8 => build_typed_output::<u8>(device, config, channels, ring, volume),
        other => Err(AudioError::Device(format!(
            "unsupported monitor output format: {other:?}"
        ))),
    }
}

fn build_typed_output<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    channels: usize,
    ring: Arc<RingBuf>,
    volume: Arc<Mutex<f32>>,
) -> Result<cpal::Stream, AudioError>
where
    T: SizedSample + FromSample<f32>,
{
    let mut mono_scratch = Vec::new();
    device
        .build_output_stream(
            *config,
            move |data: &mut [T], _: &cpal::OutputCallbackInfo| {
                let vol = *volume.lock().expect("monitor volume poisoned");
                let frames = data.len() / channels.max(1);
                mono_scratch.resize(frames, 0.0f32);
                ring.fill(&mut mono_scratch, vol);
                for (frame, &mono) in data.chunks_mut(channels).zip(mono_scratch.iter()) {
                    for slot in frame.iter_mut() {
                        *slot = T::from_sample(mono);
                    }
                }
            },
            |err| eprintln!("monitor output stream error: {err}"),
            None,
        )
        .map_err(|e| AudioError::Device(format!("cannot build monitor output stream: {e}")))
}
