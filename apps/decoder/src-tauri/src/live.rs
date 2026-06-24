// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Continuous live-decode engine (Slice 5).
//!
//! Opens a device, streams PCM into a sliding 16 s 8 kHz rolling window, and
//! calls a callback with a [`DecodeResult`] every [`SLIDE_SECS`] of new audio.
//! Empty results (no CW detected) are delivered so the frontend can detect gaps.

use std::collections::VecDeque;
use std::sync::mpsc;

use tauri::Emitter;

use crate::audio::{AudioSource, DeviceSource};
use crate::decode::DecodeResult;
use crate::dsp::DSP_SAMPLE_RATE;
use crate::pipeline::{decode_samples, MAX_DECODE_SAMPLES};
use crate::resample::resample_to_dsp_rate;
use crate::tone::{detect_tone, spectrum_bins};

/// New audio accumulated before the window re-decodes (seconds).
const SLIDE_SECS: f64 = 1.0;

/// Minimum rolling-window depth before the first decode (8 kHz samples).
/// Two seconds avoids running inference on a near-empty window.
const MIN_DECODE_SAMPLES: usize = DSP_SAMPLE_RATE as usize * 2;

/// Payload for the `spectrum-frame` Tauri event.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SpectrumFrame {
    /// Normalised power bins spanning 250–1050 Hz, length = WATERFALL_BINS.
    pub bins: Vec<f32>,
    /// Hz positions of signal peaks visible above the noise floor.
    pub detected_signals: Vec<f64>,
}

/// A handle to a running live-capture session.
///
/// The actual `!Send` `cpal::Stream` lives entirely on its own thread; this
/// handle is `Send` — it owns only a channel sender.
pub struct LiveHandle {
    stop_tx: mpsc::Sender<()>,
}

impl LiveHandle {
    /// Start a live-capture session.
    ///
    /// Opens `device` (host default when `None`), accumulates PCM on a background
    /// thread, resamples to 8 kHz, and re-decodes the rolling 16 s window every
    /// [`SLIDE_SECS`] of new audio. Both non-empty and empty results are delivered
    /// to `on_result` so the frontend can detect end-of-transmission gaps.
    ///
    /// A `spectrum-frame` event is also emitted to `app` for each 1-s chunk so
    /// the waterfall can render live spectral data.
    pub fn start(
        device: Option<String>,
        tone_hz: Option<f64>,
        app: tauri::AppHandle,
        on_result: impl Fn(DecodeResult) + Send + 'static,
    ) -> Result<Self, String> {
        let (stop_tx, stop_rx) = mpsc::channel::<()>();

        std::thread::spawn(move || {
            // DeviceSource is !Send; created here and never moved to another thread.
            let mut source = match DeviceSource::open(device.as_deref()) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("live capture: cannot open device: {e}");
                    return;
                }
            };
            let input_rate = source.sample_rate();
            let slide_input = (input_rate as f64 * SLIDE_SECS).ceil() as usize;

            let mut rolling: VecDeque<f32> = VecDeque::with_capacity(MAX_DECODE_SAMPLES);
            let mut accum: Vec<f32> = Vec::with_capacity(slide_input);
            let mut buf = vec![0.0f32; 4096];

            loop {
                if stop_rx.try_recv().is_ok() {
                    break;
                }

                // Blocking pull; returns quickly when the cpal callback fires (~10 ms).
                let n = match source.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => n,
                };
                accum.extend_from_slice(&buf[..n]);

                if accum.len() < slide_input {
                    continue;
                }

                // Resample the accumulated chunk to 8 kHz.
                let dsp_chunk = match resample_to_dsp_rate(&accum, input_rate) {
                    Ok(d) => d,
                    Err(e) => {
                        eprintln!("live capture: resample error: {e}");
                        accum.clear();
                        continue;
                    }
                };
                accum.clear();

                // Emit a spectrum frame for the waterfall on every chunk.
                let (bins, detected_signals) = spectrum_bins(&dsp_chunk, DSP_SAMPLE_RATE);
                app.emit("spectrum-frame", SpectrumFrame { bins, detected_signals }).ok();

                // Silence detection: if no CW tone in this 1-second chunk, clear the
                // rolling window so the next transmission decodes from a clean slate,
                // and emit an empty result so the frontend can detect end-of-transmission.
                if detect_tone(&dsp_chunk, DSP_SAMPLE_RATE).is_none() {
                    rolling.clear();
                    on_result(DecodeResult {
                        chars: vec![],
                        text: String::new(),
                        confidence: 0.0,
                        detected_tone_hz: 0.0,
                    });
                    continue;
                }

                // Signal present: advance the rolling window with the new chunk.
                for s in dsp_chunk {
                    if rolling.len() >= MAX_DECODE_SAMPLES {
                        rolling.pop_front();
                    }
                    rolling.push_back(s);
                }

                if rolling.len() < MIN_DECODE_SAMPLES {
                    continue;
                }

                let window: Vec<f32> = rolling.iter().copied().collect();
                match decode_samples(&window, DSP_SAMPLE_RATE, tone_hz) {
                    Ok(result) => on_result(result),
                    Err(e) => eprintln!("live capture: decode error: {e}"),
                }
            }
        });

        Ok(Self { stop_tx })
    }

    /// Signal the background thread to stop after its next read returns.
    pub fn stop(self) {
        let _ = self.stop_tx.send(());
    }
}
