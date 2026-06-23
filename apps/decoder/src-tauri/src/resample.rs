// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Sample-rate conversion to the DSP's fixed 8 kHz rate.
//!
//! The DSP is conformance-locked to [`DSP_SAMPLE_RATE`] and refuses any other
//! rate ([`crate::pipeline::decode_samples`]). Live capture, however, arrives at
//! the device's native rate — a USB rig CODEC (e.g. the IC-7300) hands back
//! 48 kHz, never 8 kHz. This module is the bridge the [`AudioSource`] seam
//! deliberately leaves out (`audio/source.rs`: "matching the DSP's expected rate
//! is a later, conformance-locked concern, not this seam's").
//!
//! It is **not** on the file-decode path: golden-vector parity stays on
//! already-8 kHz fixtures, so resampling never perturbs the conformance lock.
//!
//! [`AudioSource`]: crate::audio::AudioSource
//! [`DSP_SAMPLE_RATE`]: crate::dsp::DSP_SAMPLE_RATE

use rubato::{FftFixedIn, Resampler};

use crate::dsp::DSP_SAMPLE_RATE;

/// Resample mono `samples` from `input_rate` Hz to [`DSP_SAMPLE_RATE`].
///
/// Returns the input untouched when it is already at the DSP rate (the common
/// fixture path). Errors on a zero input rate or a resampler failure.
pub fn resample_to_dsp_rate(samples: &[f32], input_rate: u32) -> Result<Vec<f32>, String> {
    if input_rate == 0 {
        return Err("input sample rate must be > 0".to_string());
    }
    if input_rate == DSP_SAMPLE_RATE || samples.is_empty() {
        return Ok(samples.to_vec());
    }

    // Fixed input-chunk FFT resampler, single channel. The chunk size is an
    // internal batching detail; we feed exactly `input_frames_next()` frames per
    // `process` call and flush the trailing remainder with `process_partial`.
    const CHUNK_IN: usize = 1024;
    let mut resampler = FftFixedIn::<f32>::new(
        input_rate as usize,
        DSP_SAMPLE_RATE as usize,
        CHUNK_IN,
        2,
        1,
    )
    .map_err(|e| format!("resampler init failed: {e}"))?;

    let mut out =
        Vec::with_capacity(samples.len() * DSP_SAMPLE_RATE as usize / input_rate as usize);
    let mut pos = 0;

    let frames = resampler.input_frames_next();
    while pos + frames <= samples.len() {
        let block = resampler
            .process(&[&samples[pos..pos + frames]], None)
            .map_err(|e| format!("resample failed: {e}"))?;
        out.extend_from_slice(&block[0]);
        pos += frames;
    }

    if pos < samples.len() {
        let block = resampler
            .process_partial(Some(&[&samples[pos..]]), None)
            .map_err(|e| format!("resample (tail) failed: {e}"))?;
        out.extend_from_slice(&block[0]);
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::TAU;

    /// Generate `secs` seconds of a `freq` Hz sine at `rate` Hz, mono.
    fn sine(freq: f32, rate: u32, secs: f32) -> Vec<f32> {
        let n = (rate as f32 * secs) as usize;
        (0..n)
            .map(|i| (TAU * freq * i as f32 / rate as f32).sin())
            .collect()
    }

    /// Count zero-crossings — a cheap dominant-frequency proxy. A clean `f` Hz
    /// tone has ~`2 * f` crossings per second.
    fn zero_crossings(x: &[f32]) -> usize {
        x.windows(2)
            .filter(|w| (w[0] <= 0.0) != (w[1] <= 0.0))
            .count()
    }

    #[test]
    fn passthrough_when_already_dsp_rate() {
        let buf = sine(700.0, DSP_SAMPLE_RATE, 0.1);
        let out = resample_to_dsp_rate(&buf, DSP_SAMPLE_RATE).unwrap();
        assert_eq!(out, buf, "8 kHz input must pass through unchanged");
    }

    #[test]
    fn empty_input_is_empty() {
        assert!(resample_to_dsp_rate(&[], 48_000).unwrap().is_empty());
    }

    #[test]
    fn rejects_zero_rate() {
        assert!(resample_to_dsp_rate(&[0.1, 0.2], 0).is_err());
    }

    #[test]
    fn downsamples_48k_to_8k_length() {
        // 1.0 s at 48 kHz -> ~1.0 s at 8 kHz (= ~8000 frames). Allow slack for
        // the resampler's edge/group-delay handling.
        let input = sine(1000.0, 48_000, 1.0);
        let out = resample_to_dsp_rate(&input, 48_000).unwrap();
        assert!(
            (7800..=8200).contains(&out.len()),
            "expected ~8000 frames, got {}",
            out.len()
        );
    }

    #[test]
    fn preserves_dominant_frequency() {
        // A 1000 Hz tone resampled 48k -> 8k must still read as ~1000 Hz, i.e.
        // ~2000 zero-crossings over the (~1 s) output.
        let input = sine(1000.0, 48_000, 1.0);
        let out = resample_to_dsp_rate(&input, 48_000).unwrap();
        let zc = zero_crossings(&out);
        assert!(
            (1900..=2100).contains(&zc),
            "expected ~2000 zero-crossings for a preserved 1 kHz tone, got {zc}"
        );
    }
}
