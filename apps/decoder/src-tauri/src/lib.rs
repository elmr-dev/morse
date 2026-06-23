// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

pub mod audio;
pub mod decode;
pub mod dsp;
pub mod model;
pub mod pipeline;
pub mod resample;
pub mod tone;

use audio::{
    list_input_devices as enumerate_input_devices, AudioSource, DeviceInfo, WavFileSource,
};
use decode::DecodeResult;
use pipeline::{capture_and_decode as pipeline_capture_and_decode, decode_wav_file};

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
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            load_audio_clip,
            decode_file,
            list_input_devices,
            capture_and_decode
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
