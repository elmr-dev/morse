// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

//! CW tone frequency detection via the Goertzel algorithm.
//!
//! A two-pass spectral peak-pick — coarse sweep then fine refinement — locates
//! the dominant CW tone in the 300–1000 Hz passband without a full FFT.  No
//! extra crate is needed; Goertzel evaluates one DFT bin per O(N) pass.
//!
//! Returns `None` when the peak-to-mean-power ratio falls below [`MIN_SNR`],
//! signalling that the audio is too noisy or tone-free to make a confident
//! pick.  The caller falls back to `DEFAULT_TONE_HZ` in that case.

use std::f64::consts::PI;

/// Plausible CW tone passband boundaries, in Hz.
const CW_BAND_LO: f64 = 300.0;
const CW_BAND_HI: f64 = 1000.0;

/// Coarse-sweep step size (Hz).  At 8 kHz/4 s the DFT bin width is 0.25 Hz,
/// so 50 Hz steps are extremely conservative — just wide enough to span the
/// whole band in ~15 evaluations.
const COARSE_STEP: f64 = 50.0;

/// Fine-sweep ±radius (Hz) and step around the coarse winner.
const FINE_RADIUS: f64 = 45.0;
const FINE_STEP: f64 = 5.0;

/// Minimum peak-to-mean-power ratio across coarse bins.  Below this the signal
/// is noise-dominated and we decline to guess.
const MIN_SNR: f64 = 3.0;

/// Cap the analysis window to 4 s (32 000 samples at 8 kHz) — long enough for
/// good frequency resolution while remaining cheap.
const MAX_DETECT_SAMPLES: usize = 32_000;

/// Compute the squared DFT magnitude at `freq_hz` using Goertzel's algorithm.
///
/// `freq_hz` is rounded to the nearest DFT bin (`k = round(N·f/fs)`).  The
/// return value is in arbitrary power units; only ratios matter for detection.
fn goertzel(samples: &[f32], sample_rate: u32, freq_hz: f64) -> f64 {
    let n = samples.len();
    let k = (n as f64 * freq_hz / sample_rate as f64).round();
    let omega = 2.0 * PI * k / n as f64;
    let coeff = 2.0 * omega.cos();

    let mut q1 = 0.0f64;
    let mut q2 = 0.0f64;

    for &s in samples {
        let q0 = coeff * q1 - q2 + s as f64;
        q2 = q1;
        q1 = q0;
    }

    q1 * q1 + q2 * q2 - q1 * q2 * coeff
}

/// Detect the dominant CW tone in `samples` (at `sample_rate` Hz).
///
/// Returns the estimated CW centre frequency in Hz, or `None` if no single
/// tone stands clearly above the noise floor (peak-to-mean power ratio below
/// [`MIN_SNR`]).  The caller should fall back to a sensible default when this
/// returns `None`.
pub fn detect_tone(samples: &[f32], sample_rate: u32) -> Option<f64> {
    let window = &samples[..samples.len().min(MAX_DETECT_SAMPLES)];
    // Need at least 100 ms of audio for meaningful frequency resolution.
    if window.len() < sample_rate as usize / 10 {
        return None;
    }

    // ── Coarse pass ──────────────────────────────────────────────────────────
    let mut coarse_freqs: Vec<f64> = Vec::new();
    let mut f = CW_BAND_LO;
    while f <= CW_BAND_HI {
        coarse_freqs.push(f);
        f += COARSE_STEP;
    }

    let coarse_powers: Vec<f64> = coarse_freqs
        .iter()
        .map(|&freq| goertzel(window, sample_rate, freq))
        .collect();

    let (peak_idx, &peak_power) = coarse_powers
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))?;

    // SNR check: peak vs mean of the remaining bins.
    let n_others = coarse_powers.len().saturating_sub(1);
    let mean_others = if n_others == 0 {
        return None;
    } else {
        coarse_powers
            .iter()
            .enumerate()
            .filter(|(i, _)| *i != peak_idx)
            .map(|(_, &p)| p)
            .sum::<f64>()
            / n_others as f64
    };

    if mean_others == 0.0 || peak_power / mean_others < MIN_SNR {
        return None;
    }

    let coarse_center = coarse_freqs[peak_idx];

    // ── Fine pass ─────────────────────────────────────────────────────────────
    let fine_lo = (coarse_center - FINE_RADIUS).max(CW_BAND_LO);
    let fine_hi = (coarse_center + FINE_RADIUS).min(CW_BAND_HI);

    let mut best_freq = coarse_center;
    let mut best_power = peak_power;

    let mut f = fine_lo;
    while f <= fine_hi {
        let p = goertzel(window, sample_rate, f);
        if p > best_power {
            best_power = p;
            best_freq = f;
        }
        f += FINE_STEP;
    }

    Some(best_freq)
}

/// The audio passband displayed in the waterfall, in Hz.
pub const WATERFALL_LO: f64 = 250.0;
pub const WATERFALL_HI: f64 = 1050.0;
/// Number of power bins spanning the waterfall passband.
pub const WATERFALL_BINS: usize = 128;

/// Minimum peak-to-mean power ratio for a bin to be reported as a detected
/// signal peak in the waterfall display.
const SIGNAL_PEAK_SNR: f64 = 2.0;

/// Stricter SNR threshold used for AUTO-mode tuning — must clearly stand above
/// the noise floor before we anchor the decoder to that frequency.
const AUTO_DETECT_SNR: f64 = 3.0;

/// Compute `WATERFALL_BINS` normalised power samples spanning
/// [`WATERFALL_LO`]..=[`WATERFALL_HI`] Hz from `samples`.
///
/// Returns `(bins, detected_signals, strongest_hz)` where:
/// - `bins` is a `Vec<f32>` of length [`WATERFALL_BINS`], each value in `[0, 1]`
///   (normalised to the peak bin).
/// - `detected_signals` is a sorted `Vec<f64>` of Hz positions where a bin's
///   power exceeds `SIGNAL_PEAK_SNR × mean`, i.e. signal peaks visible in the
///   waterfall.
/// - `strongest_hz` is the Hz position of the highest-power local maximum above
///   the signal threshold, or `None` if no signal is present.  Use this for
///   AUTO-mode tuning so the decoder always follows the dominant waterfall peak.
pub fn spectrum_bins(samples: &[f32], sample_rate: u32) -> (Vec<f32>, Vec<f64>, Option<f64>) {
    let window = &samples[..samples.len().min(MAX_DETECT_SAMPLES)];
    let freq_step = (WATERFALL_HI - WATERFALL_LO) / (WATERFALL_BINS - 1) as f64;

    let powers: Vec<f64> = (0..WATERFALL_BINS)
        .map(|i| {
            let freq = WATERFALL_LO + i as f64 * freq_step;
            goertzel(window, sample_rate, freq)
        })
        .collect();

    let peak = powers.iter().cloned().fold(0.0f64, f64::max);
    let mean = powers.iter().sum::<f64>() / powers.len() as f64;

    let bins: Vec<f32> = powers
        .iter()
        .map(|&p| if peak > 0.0 { (p / peak) as f32 } else { 0.0 })
        .collect();

    let display_threshold = mean * SIGNAL_PEAK_SNR;
    let auto_threshold = mean * AUTO_DETECT_SNR;
    let mut detected: Vec<f64> = Vec::new();
    let mut strongest_hz: Option<f64> = None;
    let mut strongest_power = 0.0f64;

    // Simple peak-pick: local maxima above threshold, avoid double-counting.
    for i in 1..powers.len().saturating_sub(1) {
        if powers[i] > display_threshold && powers[i] > powers[i - 1] && powers[i] > powers[i + 1] {
            let hz = WATERFALL_LO + i as f64 * freq_step;
            detected.push(hz);
            // Only consider this bin for auto-tune if it clears the stricter threshold.
            if powers[i] > auto_threshold && powers[i] > strongest_power {
                strongest_power = powers[i];
                strongest_hz = Some(hz);
            }
        }
    }

    (bins, detected, strongest_hz)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI as PIf;

    /// Generate a pure tone at `freq_hz` sampled at `sample_rate` Hz.
    fn pure_tone(freq_hz: f32, sample_rate: u32, samples: usize) -> Vec<f32> {
        (0..samples)
            .map(|i| (2.0 * PIf * freq_hz * i as f32 / sample_rate as f32).sin())
            .collect()
    }

    #[test]
    fn detects_700hz_tone() {
        let audio = pure_tone(700.0, 8000, 8000); // 1 s at 8 kHz
        let tone = detect_tone(&audio, 8000).expect("should detect a clear 700 Hz tone");
        assert!(
            (tone - 700.0).abs() < 10.0,
            "expected ≈700 Hz, got {tone:.1} Hz"
        );
    }

    #[test]
    fn detects_600hz_tone() {
        let audio = pure_tone(600.0, 8000, 8000);
        let tone = detect_tone(&audio, 8000).expect("should detect a clear 600 Hz tone");
        assert!(
            (tone - 600.0).abs() < 10.0,
            "expected ≈600 Hz, got {tone:.1} Hz"
        );
    }

    #[test]
    fn detects_800hz_tone() {
        let audio = pure_tone(800.0, 8000, 8000);
        let tone = detect_tone(&audio, 8000).expect("should detect a clear 800 Hz tone");
        assert!(
            (tone - 800.0).abs() < 10.0,
            "expected ≈800 Hz, got {tone:.1} Hz"
        );
    }

    #[test]
    fn returns_none_for_silence() {
        let audio = vec![0.0f32; 8000];
        assert!(detect_tone(&audio, 8000).is_none());
    }

    #[test]
    fn returns_none_for_too_short() {
        // Only 50 ms — below the 100 ms minimum.
        let audio = vec![0.0f32; 400];
        assert!(detect_tone(&audio, 8000).is_none());
    }
}
