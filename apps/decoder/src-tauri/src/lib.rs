// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

pub mod audio;

use audio::{AudioSource, WavFileSource};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, load_audio_clip])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
