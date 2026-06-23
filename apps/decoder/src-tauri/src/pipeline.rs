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

use std::time::Duration;

use crate::audio::{AudioError, AudioSource, DeviceSource, WavFileSource};
use crate::decode::{greedy_decode, DecodeOptions, DecodeResult};
use crate::dsp::{extract_envelope, DECIMATION, DSP_SAMPLE_RATE, IN_CHANNELS};
use crate::model::{run_inference, MAX_FRAMES};
use crate::resample::resample_to_dsp_rate;
use crate::tone::detect_tone;

/// Default CW tone the DSP centers its bandpass/matched filters on, in Hz.
/// Used as fallback when auto-detection finds no clear spectral peak.
pub const DEFAULT_TONE_HZ: f64 = 700.0;

/// Longest audio span the fixed-length model accepts, in 8 kHz samples.
///
/// The graph is traced at [`MAX_FRAMES`] envelope frames; the DSP decimates audio
/// by [`DECIMATION`] to reach the envelope rate, so the audio cap is their product
/// (= 16 s at 8 kHz). Live capture decodes only the trailing window this allows.
pub const MAX_DECODE_SAMPLES: usize = MAX_FRAMES * DECIMATION;

/// Decode mono PCM `samples` (at `sample_rate` Hz) to text + confidence.
///
/// `sample_rate` must be [`DSP_SAMPLE_RATE`] — the DSP is conformance-locked to
/// 8 kHz and does not resample.
///
/// `tone_hz` is the CW tone the DSP centres its bandpass and matched filters on.
/// Pass `Some(hz)` to use a specific frequency (manual override); pass `None` to
/// auto-detect via spectral peak-pick in the 300–1000 Hz passband, falling back
/// to [`DEFAULT_TONE_HZ`] if no clear peak is found. The tone actually used is
/// returned in [`DecodeResult::detected_tone_hz`].
pub fn decode_samples(
    samples: &[f32],
    sample_rate: u32,
    tone_hz: Option<f64>,
) -> Result<DecodeResult, String> {
    if sample_rate != DSP_SAMPLE_RATE {
        return Err(format!(
            "expected {DSP_SAMPLE_RATE} Hz audio, got {sample_rate} Hz"
        ));
    }
    if samples.len() < IN_CHANNELS * DECIMATION {
        return Err("audio too short to decode".to_string());
    }

    let tone = tone_hz
        .unwrap_or_else(|| detect_tone(samples, sample_rate).unwrap_or(DEFAULT_TONE_HZ));

    let envelope = extract_envelope(samples, sample_rate, tone);
    let log_probs = run_inference(&envelope)?;
    let t_out = log_probs.len() / crate::decode::NUM_CLASSES;
    let mut result = greedy_decode(&log_probs, t_out, DecodeOptions::default());
    result.detected_tone_hz = tone;
    Ok(result)
}

/// Open a WAV file and decode it end to end via the [`AudioSource`] seam.
///
/// Pass `tone_hz = None` to auto-detect the CW tone via spectral peak-pick.
pub fn decode_wav_file(path: &str, tone_hz: Option<f64>) -> Result<DecodeResult, String> {
    let mut source = WavFileSource::open(path).map_err(audio_err)?;
    let sample_rate = source.sample_rate();
    let samples = source.read_to_end().map_err(audio_err)?;
    decode_samples(&samples, sample_rate, tone_hz)
}

/// Capture `seconds` of live audio from an input device and decode it.
///
/// The live counterpart of [`decode_wav_file`]: opens `device` (host default when
/// `None`) via [`DeviceSource`], lets it buffer for `seconds`, resamples the
/// device-native rate down to the DSP's 8 kHz ([`resample_to_dsp_rate`]), then
/// decodes the trailing [`MAX_DECODE_SAMPLES`] window the fixed-length model
/// accepts. This is the one-shot workaround for the 16 s graph; the continuous
/// re-decode loop is a later concern.
///
/// Pass `tone_hz = None` to auto-detect the CW tone via spectral peak-pick.
pub fn capture_and_decode(
    device: Option<&str>,
    seconds: f64,
    tone_hz: Option<f64>,
) -> Result<DecodeResult, String> {
    if !(seconds.is_finite() && seconds > 0.0) {
        return Err("capture seconds must be a positive number".to_string());
    }

    let source = DeviceSource::open(device).map_err(audio_err)?;
    let rate = source.sample_rate();
    std::thread::sleep(Duration::from_secs_f64(seconds));
    let captured = source.take_buffered();
    drop(source); // stop the stream before the heavy DSP work

    if captured.is_empty() {
        return Err("no audio captured from device".to_string());
    }

    let samples = resample_to_dsp_rate(&captured, rate)?;
    let window = if samples.len() > MAX_DECODE_SAMPLES {
        &samples[samples.len() - MAX_DECODE_SAMPLES..]
    } else {
        &samples[..]
    };
    decode_samples(window, DSP_SAMPLE_RATE, tone_hz)
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
        let result = decode_wav_file(path.to_str().unwrap(), Some(DEFAULT_TONE_HZ)).unwrap();
        assert_eq!(result.text, "CQCQDEW1ABCW1ABCK");
        assert_eq!(result.detected_tone_hz, DEFAULT_TONE_HZ);
        // A clean clip should decode with high per-emission confidence.
        assert!(
            result.confidence > 0.5,
            "expected confident decode, got {}",
            result.confidence
        );
    }

    /// Auto-detect should find the 700 Hz tone in the clean CQ clip without
    /// being told the frequency explicitly.
    #[test]
    fn auto_detects_tone_in_clean_clip() {
        let path = fixture("cq_clean_20wpm.input.wav");
        let result = decode_wav_file(path.to_str().unwrap(), None).unwrap();
        assert_eq!(result.text, "CQCQDEW1ABCW1ABCK");
        assert!(
            (result.detected_tone_hz - DEFAULT_TONE_HZ).abs() < 20.0,
            "expected tone near {DEFAULT_TONE_HZ} Hz, got {} Hz",
            result.detected_tone_hz
        );
    }

    #[test]
    fn rejects_non_8khz() {
        let samples = vec![0.0f32; 16000];
        assert!(decode_samples(&samples, 44100, Some(DEFAULT_TONE_HZ)).is_err());
    }
}
