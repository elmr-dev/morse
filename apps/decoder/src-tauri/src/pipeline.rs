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

/// Analyse the DSP envelope and return a per-output-frame word-gap mask.
///
/// `mask[i] == true` means output frame `i` lies within an audio silence long
/// enough to be an inter-word boundary. The mask is consumed by
/// [`crate::decode::greedy_decode`] to insert spaces between words.
///
/// Uses envelope energy rather than CTC blank-run lengths because CTC labels
/// can fire anywhere inside a character's duration: `blank_before` values for
/// intra-word and inter-word transitions are completely interleaved in practice
/// and cannot be separated by any clustering approach.
///
/// Algorithm:
/// 1. Max energy across the 4 envelope channels per output frame.
/// 2. Threshold at 8 % of peak (envelope is already bandpass-filtered to the CW
///    tone, so the noise floor sits well below this in practice).
/// 3. Estimate dit duration from the shortest signal-on run ≥ 2 frames (8 ms).
/// 4. Silence ≥ 4 × dit is a word gap — sits between char gap (3T) and word gap
///    (7T), robust at any WPM from 5 to 100+.
/// 5. Every frame within a qualifying silence is marked `true`.
pub fn detect_word_gap_frames(envelope: &[f32], t_out: usize) -> Vec<bool> {
    let n_env = envelope.len() / IN_CHANNELS;

    // Use ch0 (double-sharpened amplitude, index 0) per output frame.
    // ch0 is already mapped to near-0 (silence) or near-1 (signal) by the
    // double-sharpen (γ=8 twice ≈ γ_eff=64), so it makes a clean gate here.
    // Using max-of-all-channels would include ch3 (200 ms matched filter) whose
    // long impulse response fills in inter-word gaps and masks the silence.
    let energy: Vec<f32> = (0..t_out)
        .map(|o| {
            let mut peak = 0.0f32;
            for ef in [o * 2, o * 2 + 1] {
                if ef < n_env {
                    peak = peak.max(envelope[ef * IN_CHANNELS]); // ch0 only
                }
            }
            peak
        })
        .collect();

    let global_peak = energy.iter().cloned().fold(0.0f32, f32::max);
    if global_peak == 0.0 {
        return vec![false; t_out];
    }
    // ch0 is binary after double-sharpen — any midpoint works; 0.5 is natural.
    let threshold = global_peak * 0.5;
    let signal: Vec<bool> = energy.iter().map(|&e| e > threshold).collect();

    // Estimate dit duration from signal-on runs.
    //
    // Uses the 10th-percentile of all qualifying runs rather than the absolute
    // minimum. The minimum is fragile for bad fists: one spuriously short run
    // (key bounce, chirp, noise spike) drives word_gap_min way down and produces
    // false word splits within a character. The 10th-percentile ignores the
    // bottom tail while still tracking the actual dit speed accurately.
    const MIN_DIT_FRAMES: usize = 2;
    let dit_frames = {
        let mut runs: Vec<usize> = Vec::new();
        let mut run = 0usize;
        for &s in &signal {
            if s {
                run += 1;
            } else {
                if run >= MIN_DIT_FRAMES {
                    runs.push(run);
                }
                run = 0;
            }
        }
        if run >= MIN_DIT_FRAMES {
            runs.push(run);
        }
        if runs.is_empty() {
            return vec![false; t_out];
        }
        runs.sort_unstable();
        let idx = runs.len() / 10; // 10th percentile index
        runs[idx].max(MIN_DIT_FRAMES).min(t_out / 4 + 1)
    };

    // Silence ≥ 4× dit falls between char gap (3T) and word gap (7T) at any WPM.
    let word_gap_min = dit_frames * 4;

    // Mark every frame that lies within a qualifying silence run.
    // Only silence that is PRECEDED by signal counts as a potential word gap —
    // leading silence (before the first CW element in the window) is excluded.
    // This prevents the rolling window's pre-transmission padding from being
    // flagged as a word gap and inserting a spurious space early in the decode.
    let mut mask = vec![false; t_out];
    let mut gap_start = 0usize;
    let mut in_gap = false;
    let mut gap_len = 0usize;
    let mut seen_signal = false;

    for i in 0..t_out {
        if !signal[i] {
            if seen_signal {
                if !in_gap {
                    gap_start = i;
                    in_gap = true;
                }
                gap_len += 1;
            }
        } else {
            seen_signal = true;
            if in_gap && gap_len >= word_gap_min {
                for j in gap_start..i {
                    mask[j] = true;
                }
            }
            in_gap = false;
            gap_len = 0;
        }
    }
    // Trailing silence after the last element is never a word gap either
    // (nothing follows it, so there's no second word to separate).

    mask
}

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
    let word_gaps = detect_word_gap_frames(&envelope, t_out);
    let mut result = greedy_decode(&log_probs, t_out, DecodeOptions::default(), Some(&word_gaps));
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
    drop(source);

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

    /// Helper: strip spaces and return the character sequence.
    fn stripped(text: &str) -> String {
        text.chars().filter(|&c| c != ' ').collect()
    }

    /// Verify that a decoded text has proper word spacing:
    /// - contains at least one space
    /// - no consecutive spaces
    /// - all non-space characters are uppercase ASCII
    fn assert_word_spaced(text: &str) {
        assert!(
            text.contains(' '),
            "expected word spaces in {:?}",
            text
        );
        assert!(
            !text.contains("  "),
            "unexpected consecutive spaces in {:?}",
            text
        );
    }

    #[test]
    fn decodes_clean_cq_clip_like_ts() {
        let path = fixture("cq_clean_20wpm.input.wav");
        let result = decode_wav_file(path.to_str().unwrap(), Some(DEFAULT_TONE_HZ)).unwrap();
        assert_eq!(stripped(&result.text), "CQCQDEW1ABCW1ABCK");
        assert_eq!(result.detected_tone_hz, DEFAULT_TONE_HZ);
        assert!(
            result.confidence > 0.5,
            "expected confident decode, got {}",
            result.confidence
        );
        assert_word_spaced(&result.text);
        // "CQ" should never appear as "C Q" — no spaces within a word.
        assert!(
            !result.text.contains("C Q"),
            "intra-word space found in CQ: {:?}",
            result.text
        );
    }

    #[test]
    fn word_spacing_0db_20wpm() {
        let path = fixture("cq_0db_20wpm.input.wav");
        let result = decode_wav_file(path.to_str().unwrap(), None).unwrap();
        // Characters may differ in noisy conditions; spacing should still be present
        // and CQ should not have an internal space.
        assert_word_spaced(&result.text);
        assert!(
            !result.text.contains("C Q"),
            "intra-word space found in CQ: {:?}",
            result.text
        );
        eprintln!("0db 20wpm decoded: {:?}", result.text);
    }

    #[test]
    fn auto_detects_tone_in_clean_clip() {
        let path = fixture("cq_clean_20wpm.input.wav");
        let result = decode_wav_file(path.to_str().unwrap(), None).unwrap();
        assert_eq!(stripped(&result.text), "CQCQDEW1ABCW1ABCK");
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
