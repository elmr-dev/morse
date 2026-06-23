// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Live capture [`AudioSource`] over `cpal` — the second implementation of the
//! seam (`audio/source.rs`), after [`WavFileSource`](crate::audio::WavFileSource).
//!
//! A USB rig CODEC (the IC-7300 enumerates on macOS as "USB Audio CODEC") is just
//! another OS input device here: pick it from [`list_input_devices`] and open it.
//! The device hands back samples at its native rate (48 kHz, often 2-channel);
//! this source downmixes to mono and reports that native rate, honoring the seam's
//! "report your own rate, do not resample" contract — rate conversion to the DSP's
//! 8 kHz is [`crate::resample`]'s job.
//!
//! Capture runs on a `cpal` callback thread that pushes mono frames into a shared
//! queue; [`read`](AudioSource::read) drains it, blocking until samples arrive so
//! the same pull loop drives both file and live sources. The held [`cpal::Stream`]
//! is `!Send`, so a `DeviceSource` is created and consumed on one thread (the
//! Tauri command worker for one-shot capture); the continuous worker is Slice 5.

use std::collections::VecDeque;
use std::sync::{Arc, Condvar, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample};

use super::source::{AudioError, AudioSource};

/// An input device the user can select as a capture source.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DeviceInfo {
    /// Stable handle passed back to [`DeviceSource::open`] (`cpal` device id).
    pub id: String,
    /// Human-readable name for the picker (e.g. "USB Audio CODEC" for the IC-7300).
    pub name: String,
    /// Whether this is the host's current default input device.
    pub default: bool,
}

/// Buffer shared between the `cpal` callback thread and [`AudioSource::read`].
struct Shared {
    queue: Mutex<VecDeque<f32>>,
    ready: Condvar,
}

/// A live microphone / line-in capture source backed by a running `cpal` stream.
///
/// Dropping the source drops the stream, which stops capture.
pub struct DeviceSource {
    // Held only to keep the stream alive; never read directly. `!Send`.
    _stream: cpal::Stream,
    rate: u32,
    shared: Arc<Shared>,
}

/// Enumerate available input devices for the capture picker.
///
/// Returns the host's input devices with the default flagged. The `id` of each is
/// the handle passed back to [`DeviceSource::open`].
pub fn list_input_devices() -> Result<Vec<DeviceInfo>, AudioError> {
    let host = cpal::default_host();
    let default_id = host
        .default_input_device()
        .and_then(|d| d.id().ok())
        .map(|id| id.to_string());

    let devices = host
        .input_devices()
        .map_err(|e| AudioError::Device(format!("cannot enumerate input devices: {e}")))?;

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

impl DeviceSource {
    /// Open an input device by id, or the host default when `id` is `None`.
    ///
    /// `id` is a [`DeviceInfo::id`] from [`list_input_devices`]. Starts the capture
    /// stream immediately; samples accumulate until the source is read or dropped.
    pub fn open(id: Option<&str>) -> Result<Self, AudioError> {
        let host = cpal::default_host();
        let device = match id {
            Some(want) => host
                .input_devices()
                .map_err(|e| AudioError::Device(format!("cannot enumerate input devices: {e}")))?
                .find(|d| d.id().map(|got| got.to_string() == want).unwrap_or(false))
                .ok_or_else(|| AudioError::Device(format!("input device not found: {want}")))?,
            None => host
                .default_input_device()
                .ok_or_else(|| AudioError::Device("no default input device".to_string()))?,
        };

        let supported = device
            .default_input_config()
            .map_err(|e| AudioError::Device(format!("no default input config: {e}")))?;
        let rate = supported.sample_rate();
        let channels = supported.channels() as usize;
        let sample_format = supported.sample_format();
        let config: cpal::StreamConfig = supported.into();

        let shared = Arc::new(Shared {
            queue: Mutex::new(VecDeque::new()),
            ready: Condvar::new(),
        });

        let stream = build_input_stream(&device, &config, sample_format, channels, shared.clone())?;
        stream
            .play()
            .map_err(|e| AudioError::Device(format!("cannot start capture stream: {e}")))?;

        Ok(Self {
            _stream: stream,
            rate,
            shared,
        })
    }

    /// Drain everything captured so far, non-blocking.
    ///
    /// The one-shot capture path ([`crate::pipeline::capture_and_decode`]) opens a
    /// source, waits a fixed span, then takes the buffered mono samples in one go
    /// — simpler than the pull loop, which is the continuous worker's concern.
    pub fn take_buffered(&self) -> Vec<f32> {
        let mut queue = self.shared.queue.lock().expect("capture queue poisoned");
        queue.drain(..).collect()
    }
}

impl AudioSource for DeviceSource {
    fn sample_rate(&self) -> u32 {
        self.rate
    }

    fn read(&mut self, out: &mut [f32]) -> Result<usize, AudioError> {
        let mut queue = self.shared.queue.lock().expect("capture queue poisoned");
        // Live source: block until samples exist, never report end-of-stream.
        while queue.is_empty() {
            queue = self
                .shared
                .ready
                .wait(queue)
                .expect("capture queue poisoned");
        }
        let n = out.len().min(queue.len());
        for slot in out.iter_mut().take(n) {
            *slot = queue.pop_front().expect("checked non-empty");
        }
        Ok(n)
    }
}

/// Build a capture stream for whatever sample format the device negotiated,
/// converting every sample to `f32` and downmixing channels to mono.
fn build_input_stream(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    format: SampleFormat,
    channels: usize,
    shared: Arc<Shared>,
) -> Result<cpal::Stream, AudioError> {
    match format {
        SampleFormat::F32 => build_typed::<f32>(device, config, channels, shared),
        SampleFormat::F64 => build_typed::<f64>(device, config, channels, shared),
        SampleFormat::I16 => build_typed::<i16>(device, config, channels, shared),
        SampleFormat::I32 => build_typed::<i32>(device, config, channels, shared),
        SampleFormat::U16 => build_typed::<u16>(device, config, channels, shared),
        SampleFormat::U8 => build_typed::<u8>(device, config, channels, shared),
        other => Err(AudioError::Device(format!(
            "unsupported sample format: {other:?}"
        ))),
    }
}

/// Build a typed input stream whose callback downmixes `T` frames to mono `f32`.
fn build_typed<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    channels: usize,
    shared: Arc<Shared>,
) -> Result<cpal::Stream, AudioError>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let inv_channels = 1.0 / channels.max(1) as f32;
    device
        .build_input_stream(
            *config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                let mut queue = shared.queue.lock().expect("capture queue poisoned");
                for frame in data.chunks(channels) {
                    let sum: f32 = frame.iter().map(|&s| f32::from_sample(s)).sum();
                    queue.push_back(sum * inv_channels);
                }
                shared.ready.notify_one();
            },
            |err| eprintln!("capture stream error: {err}"),
            None,
        )
        .map_err(|e| AudioError::Device(format!("cannot build capture stream: {e}")))
}
