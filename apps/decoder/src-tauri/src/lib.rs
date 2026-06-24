// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

pub mod audio;
pub mod decode;
pub mod dsp;
pub mod live;
pub mod model;
pub mod pipeline;
pub mod resample;
pub mod tone;

use std::sync::Mutex;

use tauri::Emitter;

use audio::{
    list_input_devices as enumerate_input_devices,
    list_output_devices as enumerate_output_devices, AudioSource, DeviceInfo, MonitorHandle,
    WavFileSource,
};
use decode::DecodeResult;
use live::LiveHandle;
use pipeline::{capture_and_decode as pipeline_capture_and_decode, decode_wav_file};

/// Tauri managed state for the audio monitor passthrough.
struct MonitorState(Mutex<Option<MonitorHandle>>);

/// Tauri managed state for the live-capture session.
///
/// `LiveHandle` is `Send` (owns only a channel sender; the `!Send`
/// `DeviceSource` lives on its own thread). Wrapped in `Mutex` so
/// `start_live_capture` / `stop_live_capture` are atomic.
struct LiveState(Mutex<Option<LiveHandle>>);

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Summary of a decoded audio clip, returned to the frontend.
///
/// Slice 2 stops here: it proves PCM samples cross from a file into Rust through
/// the [`AudioSource`] seam. Returning a compact summary (not the whole sample
/// array) keeps the boundary cheap — decode lands in a later slice.
#[derive(serde::Serialize)]
struct ClipInfo {
    /// Native sample rate of the source, in Hz.
    sample_rate: u32,
    /// Number of mono samples decoded.
    sample_count: usize,
    /// Clip length in seconds (`sample_count / sample_rate`).
    duration_secs: f32,
    /// Largest absolute sample value — nonzero confirms real signal arrived.
    peak: f32,
}

/// Load a WAV clip from `path` and report what crossed into Rust.
#[tauri::command]
fn load_audio_clip(path: String) -> Result<ClipInfo, String> {
    let mut source = WavFileSource::open(&path).map_err(|e| e.to_string())?;
    let sample_rate = source.sample_rate();
    let samples = source.read_to_end().map_err(|e| e.to_string())?;

    let peak = samples.iter().fold(0.0f32, |m, &s| m.max(s.abs()));
    let duration_secs = if sample_rate == 0 {
        0.0
    } else {
        samples.len() as f32 / sample_rate as f32
    };

    Ok(ClipInfo {
        sample_rate,
        sample_count: samples.len(),
        duration_secs,
        peak,
    })
}

/// Decode a CW audio file end to end and return the decoded text + confidence.
///
/// Runs the full native pipeline (`pipeline::decode_wav_file`): WAV → DSP →
/// ONNX → greedy CTC. `tone_hz` is the CW tone the DSP centers on; pass `None`
/// for the 700 Hz default. The audio must be 8 kHz mono (the DSP does not
/// resample); decode failures cross the boundary as a stringified error.
#[tauri::command]
fn decode_file(path: String, tone_hz: Option<f64>) -> Result<DecodeResult, String> {
    decode_wav_file(&path, tone_hz)
}

/// List the input devices available for live capture.
///
/// Powers the device picker; the IC-7300 appears here as "USB Audio CODEC".
#[tauri::command]
fn list_input_devices() -> Result<Vec<DeviceInfo>, String> {
    enumerate_input_devices().map_err(|e| e.to_string())
}

/// List the output devices available for the monitor passthrough.
///
/// Powers the monitor output picker (speakers, headphones, etc.).
#[tauri::command]
fn list_output_devices() -> Result<Vec<DeviceInfo>, String> {
    enumerate_output_devices().map_err(|e| e.to_string())
}

/// Start (or restart) the audio monitor passthrough.
///
/// Captures from `input_device` (host default when `None`) and plays back
/// through `output_device` (host default when `None`). `volume` is clamped to
/// `[0.0, 1.0]`; defaults to 1.0. If a monitor is already running it is
/// stopped first.
///
/// Returns once both streams are confirmed running. The monitor continues until
/// [`stop_monitor`] is called or the app exits.
#[tauri::command]
fn start_monitor(
    state: tauri::State<'_, MonitorState>,
    input_device: Option<String>,
    output_device: Option<String>,
    volume: Option<f32>,
) -> Result<(), String> {
    let mut guard = state.0.lock().expect("monitor state poisoned");
    if let Some(existing) = guard.take() {
        existing.stop();
    }
    let handle = MonitorHandle::start(input_device, output_device, volume.unwrap_or(1.0))
        .map_err(|e| e.to_string())?;
    *guard = Some(handle);
    Ok(())
}

/// Stop the audio monitor passthrough if one is running.
#[tauri::command]
fn stop_monitor(state: tauri::State<'_, MonitorState>) -> Result<(), String> {
    if let Some(h) = state.0.lock().expect("monitor state poisoned").take() {
        h.stop();
    }
    Ok(())
}

/// Adjust the monitor playback volume without restarting the streams.
///
/// `volume` is clamped to `[0.0, 1.0]`. Returns an error if no monitor is running.
#[tauri::command]
fn set_monitor_volume(
    state: tauri::State<'_, MonitorState>,
    volume: f32,
) -> Result<(), String> {
    let guard = state.0.lock().expect("monitor state poisoned");
    match guard.as_ref() {
        Some(h) => {
            h.set_volume(volume);
            Ok(())
        }
        None => Err("monitor is not running".to_string()),
    }
}

/// Start a continuous live-capture session.
///
/// Opens `device` (host default when `None`) and begins streaming PCM through a
/// sliding 16 s decode window, emitting `"live-decode"` events to the frontend
/// every ~1 s of new audio. Both non-empty and empty results are emitted so the
/// frontend can detect end-of-transmission gaps.
///
/// Also emits `"spectrum-frame"` events (128-bin power spectrum, 250–1050 Hz)
/// on each chunk for the waterfall renderer.
///
/// Returns immediately; decoding runs on a background thread. Call
/// [`stop_live_capture`] to end the session. Returns an error if a session is
/// already running.
#[tauri::command]
fn start_live_capture(
    state: tauri::State<'_, LiveState>,
    app: tauri::AppHandle,
    device: Option<String>,
    tone_hz: Option<f64>,
) -> Result<(), String> {
    let mut guard = state.0.lock().expect("live state poisoned");
    if guard.is_some() {
        return Err("live capture already running".into());
    }
    let emit_app = app.clone();
    let handle = LiveHandle::start(device, tone_hz, app, move |result| {
        emit_app.emit("live-decode", result).ok();
    })?;
    *guard = Some(handle);
    Ok(())
}

/// Stop the running live-capture session, if any.
#[tauri::command]
fn stop_live_capture(state: tauri::State<'_, LiveState>) -> Result<(), String> {
    if let Some(h) = state.0.lock().expect("live state poisoned").take() {
        h.stop();
    }
    Ok(())
}

/// Write the copy log to `path` (absolute path from the Tauri save dialog).
///
/// The frontend formats the log content and provides the user-chosen path via
/// `@tauri-apps/plugin-dialog`'s `save()` call.
#[tauri::command]
fn export_copy_log(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("write failed: {e}"))
}

/// Capture `seconds` of live audio from `device` and decode it to text.
///
/// `device` is the device id from [`list_input_devices`] (host default when
/// `None`); `tone_hz` is the CW tone the DSP centers on (700 Hz default). Runs the
/// full native path: capture → resample to 8 kHz → trailing-window decode.
///
/// `async` + `spawn_blocking`: the capture sleeps for `seconds` and then runs heavy
/// DSP/ONNX work, so it must stay off the main thread or the webview beachballs.
/// The `cpal::Stream` inside is `!Send`, but it is created and dropped entirely
/// within the closure on the blocking thread, so it never crosses a thread boundary.
#[tauri::command]
async fn capture_and_decode(
    device: Option<String>,
    seconds: f64,
    tone_hz: Option<f64>,
) -> Result<DecodeResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        pipeline_capture_and_decode(device.as_deref(), seconds, tone_hz)
    })
    .await
    .map_err(|e| format!("capture task failed: {e}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(MonitorState(Mutex::new(None)))
        .manage(LiveState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            greet,
            load_audio_clip,
            decode_file,
            list_input_devices,
            capture_and_decode,
            list_output_devices,
            start_monitor,
            stop_monitor,
            set_monitor_volume,
            start_live_capture,
            stop_live_capture,
            export_copy_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
