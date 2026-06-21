// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

//! End-to-end native decode: PCM samples → DSP → ONNX → CTC text.
//!
//! This is the Rust counterpart of `apps/web/src/inference/pipeline.ts`. The
//! [`AudioSource`](crate::audio::AudioSource) seam from Slice 2 feeds raw mono
//! PCM in; [`extract_envelope`] turns it into the 4-channel envelope; the model
//! produces log-probabilities; greedy CTC collapses them to text. Holding the
//! whole chain here keeps `lib.rs` a thin Tauri shell over reusable domain logic.

use crate::audio::{AudioError, AudioSource, WavFileSource};
use crate::decode::{greedy_decode, DecodeOptions};
use crate::dsp::{extract_envelope, DSP_SAMPLE_RATE, IN_CHANNELS};
use crate::model::run_inference;

/// Default CW tone the DSP centers its bandpass/matched filters on, in Hz.
pub const DEFAULT_TONE_HZ: f64 = 700.0;

/// Decode mono PCM `samples` (at `sample_rate` Hz) to text.
///
/// `sample_rate` must be [`DSP_SAMPLE_RATE`] — the DSP is conformance-locked to
/// 8 kHz and does not resample.
pub fn decode_samples(samples: &[f32], sample_rate: u32, tone_hz: f64) -> Result<String, String> {
    if sample_rate != DSP_SAMPLE_RATE {
        return Err(format!(
            "expected {DSP_SAMPLE_RATE} Hz audio, got {sample_rate} Hz"
        ));
    }
    if samples.len() < IN_CHANNELS * crate::dsp::DECIMATION {
        return Err("audio too short to decode".to_string());
    }

    let envelope = extract_envelope(samples, sample_rate, tone_hz);
    let log_probs = run_inference(&envelope)?;
    let t_out = log_probs.len() / crate::decode::NUM_CLASSES;
    let result = greedy_decode(&log_probs, t_out, DecodeOptions::default());
    Ok(result.text)
}

/// Open a WAV file and decode it end to end via the [`AudioSource`] seam.
pub fn decode_wav_file(path: &str, tone_hz: f64) -> Result<String, String> {
    let mut source = WavFileSource::open(path).map_err(audio_err)?;
    let sample_rate = source.sample_rate();
    let samples = source.read_to_end().map_err(audio_err)?;
    decode_samples(&samples, sample_rate, tone_hz)
}

fn audio_err(e: AudioError) -> String {
    e.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../fixtures/dsp/clips")
            .join(name)
    }

    /// Full native decode must reproduce what the TS pipeline produces on the
    /// same clip. The TS decoder (dsp.ts → onnx → decode.ts) emits
    /// "CQCQDEW1ABCW1ABCK" for cq_clean_20wpm (no inter-word spaces — the CTC
    /// alphabet has no space label). Same DSP + same model + same CTC ⇒ same text.
    #[test]
    fn decodes_clean_cq_clip_like_ts() {
        let path = fixture("cq_clean_20wpm.input.wav");
        let text = decode_wav_file(path.to_str().unwrap(), DEFAULT_TONE_HZ).unwrap();
        assert_eq!(text, "CQCQDEW1ABCW1ABCK");
    }

    #[test]
    fn rejects_non_8khz() {
        let samples = vec![0.0f32; 16000];
        assert!(decode_samples(&samples, 44100, DEFAULT_TONE_HZ).is_err());
    }
}
