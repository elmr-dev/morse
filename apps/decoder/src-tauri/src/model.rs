// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

//! ONNX model wiring — the `ort` runtime declared in Slice 0, now actually used.
//!
//! The full-sequence CWNet graph (`cw_model_full.onnx`) is traced at a fixed
//! envelope length ([`MAX_FRAMES`]): callers zero-pad shorter audio up to that
//! length and trim the output back to `(floor(T/2), NUM_CLASSES)`. This mirrors
//! `apps/web/src/inference/onnx.ts` so the native path and the web path drive the
//! identical graph with the identical I/O contract.
//!
//! The model is embedded with `include_bytes!` so the decode pipeline is
//! self-contained: tests and the Tauri command share one code path and there is
//! no resource-dir resolution to get wrong. The bytes are a copy of the canonical
//! model that ships with `morse-web` (`apps/web/public/model/cw_model_full.onnx`).

use std::sync::{Mutex, OnceLock};

use ort::session::Session;
use ort::value::Tensor;

use crate::decode::NUM_CLASSES;
use crate::dsp::IN_CHANNELS;

/// Fixed envelope length the graph is traced at: 16 s at the 500 Hz envelope rate.
pub const MAX_FRAMES: usize = 8000;
/// Output time steps at the traced length (the CNN stride-2 halves time).
pub const MAX_OUTPUT_FRAMES: usize = MAX_FRAMES / 2;

/// The CWNet ONNX graph, embedded into the binary (see module docs).
static MODEL_BYTES: &[u8] = include_bytes!("../resources/cw_model_full.onnx");

/// Process-wide session. `Session::run` takes `&mut self`, so it lives behind a
/// `Mutex`; the model is read-only and the decoder is not latency-critical, so a
/// single shared session is the simplest correct choice.
static SESSION: OnceLock<Mutex<Session>> = OnceLock::new();

fn session() -> Result<&'static Mutex<Session>, String> {
    // `get_or_init` can't carry a fallible init, so init once and surface the
    // error; subsequent calls reuse the cell.
    if SESSION.get().is_none() {
        let built = Session::builder()
            .and_then(|mut b| b.commit_from_memory(MODEL_BYTES))
            .map_err(|e| format!("failed to load CWNet model: {e}"))?;
        // If two threads race, the loser's session is dropped — harmless.
        let _ = SESSION.set(Mutex::new(built));
    }
    Ok(SESSION.get().unwrap())
}

/// Run inference on a flat `(T, IN_CHANNELS)` envelope at the 500 Hz rate.
///
/// Zero-pads to [`MAX_FRAMES`], runs the fixed-shape graph, and returns the flat
/// `(floor(T/2), NUM_CLASSES)` log-probabilities trimmed back to the real length.
pub fn run_inference(envelope: &[f32]) -> Result<Vec<f32>, String> {
    if !envelope.len().is_multiple_of(IN_CHANNELS) {
        return Err(format!(
            "envelope length {} is not a multiple of {IN_CHANNELS} channels",
            envelope.len()
        ));
    }
    let t = envelope.len() / IN_CHANNELS;
    if t > MAX_FRAMES {
        return Err(format!(
            "audio too long: {t} frames (max {MAX_FRAMES} = {}s)",
            MAX_FRAMES / 500
        ));
    }

    let mut padded = vec![0.0f32; MAX_FRAMES * IN_CHANNELS];
    padded[..envelope.len()].copy_from_slice(envelope);

    let input = Tensor::from_array((
        vec![1i64, MAX_FRAMES as i64, IN_CHANNELS as i64],
        padded,
    ))
    .map_err(|e| format!("failed to build input tensor: {e}"))?;

    let session = session()?;
    let mut guard = session.lock().map_err(|e| format!("session lock poisoned: {e}"))?;
    let outputs = guard
        .run(ort::inputs!["envelopes" => input])
        .map_err(|e| format!("model inference failed: {e}"))?;

    let (_, data) = outputs["log_probs"]
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("failed to read log_probs: {e}"))?;

    let t_out = t / 2;
    Ok(data[..t_out * NUM_CLASSES].to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_model_loads() {
        // Proves the include_bytes! blob is a valid ONNX graph the runtime accepts.
        assert!(session().is_ok(), "embedded model should load");
    }

    #[test]
    fn rejects_overlong_envelope() {
        let env = vec![0.0f32; (MAX_FRAMES + 1) * IN_CHANNELS];
        assert!(run_inference(&env).is_err());
    }

    #[test]
    fn output_length_tracks_input_frames() {
        // A short all-zero envelope still runs; output is floor(T/2) * NUM_CLASSES.
        let t = 200usize;
        let env = vec![0.0f32; t * IN_CHANNELS];
        let lp = run_inference(&env).unwrap();
        assert_eq!(lp.len(), (t / 2) * NUM_CLASSES);
    }
}
