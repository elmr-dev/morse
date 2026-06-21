// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

//! 4-channel envelope extraction — the Rust mirror of the suite DSP.
//!
//! This is a faithful port of `apps/web/src/inference/dsp.ts`, which is itself a
//! port of the authoritative training-side scipy pipeline
//! (`packages/ml/cw-dsp-research/dsp.py`). All three must agree, channel for
//! channel, on the golden vectors in `fixtures/dsp/` — that conformance lock is
//! what lets the native decoder reuse the model trained against the Python DSP.
//! The parity test (`dsp::tests`) is the Rust end of that lock.
//!
//! Channels (output is `(T, 4)` interleaved at [`ENVELOPE_SR`], `T = floor(n/16)`):
//! - ch0 amplitude — ±25 Hz bandpass + Hilbert magnitude + percentile-norm + sharpen
//! - ch1 TKEO — Teager-Kaiser energy on the bandpassed signal
//! - ch2 matched — 48 ms coherent IQ box (dit-scale)
//! - ch3 long matched — 200 ms coherent IQ box (character-scale)
//!
//! Intermediate math runs in `f64` to track the TS `Float64Array` path; the final
//! interleave casts to `f32`, exactly where dsp.ts assigns into its `Float32Array`.

use std::f64::consts::PI;

/// Sample rate the DSP expects its input audio at, in Hz.
pub const DSP_SAMPLE_RATE: u32 = 8000;
/// Envelope output rate after decimation, in Hz (`DSP_SAMPLE_RATE / DECIMATION`).
pub const ENVELOPE_SR: u32 = 500;
/// Mean-pool decimation factor from audio rate down to the envelope rate.
pub const DECIMATION: usize = 16;
/// Number of envelope channels the model consumes.
pub const IN_CHANNELS: usize = 4;

const BP_BW_HZ: f64 = 25.0;
const TKEO_SMOOTH_MS: f64 = 30.0;
const MATCHED_MS: f64 = 48.0;
const LONG_MATCHED_MS: f64 = 200.0;
const SHARPEN_GAMMA: f64 = 8.0;

// ---------- Radix-2 Cooley-Tukey FFT (port of fft.ts) ----------

/// Smallest power of two `>= n`.
fn next_pow2(n: usize) -> usize {
    let mut p = 1;
    while p < n {
        p <<= 1;
    }
    p
}

/// In-place iterative radix-2 FFT. `re`/`im` must have power-of-two length.
fn fft(re: &mut [f64], im: &mut [f64]) {
    let n = re.len();
    debug_assert!(n & (n - 1) == 0, "fft size must be power of 2");

    // Bit-reversal permutation.
    let mut j = 0usize;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }

    let mut size = 2;
    while size <= n {
        let half = size >> 1;
        let theta = -2.0 * PI / size as f64;
        let w_re_step = theta.cos();
        let w_im_step = theta.sin();
        let mut i = 0;
        while i < n {
            let mut w_re = 1.0;
            let mut w_im = 0.0;
            for k in 0..half {
                let a_re = re[i + k];
                let a_im = im[i + k];
                let b_re = re[i + k + half];
                let b_im = im[i + k + half];
                let t_re = b_re * w_re - b_im * w_im;
                let t_im = b_re * w_im + b_im * w_re;
                re[i + k] = a_re + t_re;
                im[i + k] = a_im + t_im;
                re[i + k + half] = a_re - t_re;
                im[i + k + half] = a_im - t_im;
                let n_re = w_re * w_re_step - w_im * w_im_step;
                w_im = w_re * w_im_step + w_im * w_re_step;
                w_re = n_re;
            }
            i += size;
        }
        size <<= 1;
    }
}

/// In-place inverse FFT (conjugate, forward, conjugate, scale).
fn ifft(re: &mut [f64], im: &mut [f64]) {
    let n = re.len();
    for v in im.iter_mut() {
        *v = -*v;
    }
    fft(re, im);
    let inv = 1.0 / n as f64;
    for i in 0..n {
        re[i] *= inv;
        im[i] = -im[i] * inv;
    }
}

/// Hilbert-transform magnitude (analytic-signal envelope) via FFT.
fn hilbert_mag(x: &[f64]) -> Vec<f64> {
    let n = x.len();
    let big_n = next_pow2(n);
    let mut re = vec![0.0f64; big_n];
    let mut im = vec![0.0f64; big_n];
    re[..n].copy_from_slice(x);

    fft(&mut re, &mut im);

    // Analytic multiplier: 1 at DC/Nyquist, 2 for the positive freqs, 0 above.
    for k in 1..big_n / 2 {
        re[k] *= 2.0;
        im[k] *= 2.0;
    }
    for k in big_n / 2 + 1..big_n {
        re[k] = 0.0;
        im[k] = 0.0;
    }

    ifft(&mut re, &mut im);

    (0..n).map(|i| re[i].hypot(im[i])).collect()
}

// ---------- Order-1 Butterworth bandpass (SOS, forward-backward) ----------

/// A single second-order section in scipy's row layout: `[b0, b1, b2, a0, a1, a2]`.
pub type SosSection = [f64; 6];

/// Order-1 Butterworth bandpass SOS for `[loHz, hiHz]` at sample rate `fs`.
///
/// Matches `scipy.signal.butter(1, ..., output="sos")[0]` to ~1e-15 per
/// coefficient: bilinear-prewarp the band edges, apply the analog bandpass
/// transform of the order-1 lowpass prototype, then bilinear-transform to one
/// digital biquad.
pub fn butter_bandpass_order1_sos(lo_hz: f64, hi_hz: f64, fs: f64) -> SosSection {
    let k = 2.0 * fs;
    let lo_w = k * (PI * lo_hz / fs).tan();
    let hi_w = k * (PI * hi_hz / fs).tan();
    let omega0_sq = lo_w * hi_w;
    let delta = hi_w - lo_w;
    let a0_raw = k * k + delta * k + omega0_sq;
    let b0 = (delta * k) / a0_raw;
    let b2 = -(delta * k) / a0_raw;
    let a1 = (2.0 * omega0_sq - 2.0 * k * k) / a0_raw;
    let a2 = (k * k - delta * k + omega0_sq) / a0_raw;
    [b0, 0.0, b2, 1.0, a1, a2]
}

/// Per-section steady-state initial conditions for unit-step input.
///
/// Mirrors `scipy.signal.sosfilt_zi`: `zi[k]` is multiplied by the first sample
/// fed to section `k` and used as the Direct-Form-II Transposed initial state.
/// Assumes `a0 == 1` (scipy normalizes on construction).
fn sosfilt_zi(sos: &[SosSection]) -> Vec<[f64; 2]> {
    let mut zi = Vec::with_capacity(sos.len());
    let mut scale = 1.0;
    for s in sos {
        let (b0, b1, b2, a1, a2) = (s[0], s[1], s[2], s[4], s[5]);
        let denom = 1.0 + a1 + a2;
        let yss = (b0 + b1 + b2) * scale / denom;
        let s1 = b2 * scale - a2 * yss;
        let s0 = b1 * scale + b2 * scale - (a1 + a2) * yss;
        zi.push([s0, s1]);
        scale = yss;
    }
    zi
}

/// Direct-Form-II Transposed SOS filter with per-section initial state.
///
/// Mirrors `scipy.signal.sosfilt` with the `zi` argument; returns the filtered
/// signal (final state is not needed by the forward-backward caller).
fn sosfilt(sos: &[SosSection], x: &[f64], zi: &[[f64; 2]]) -> Vec<f64> {
    let n = x.len();
    let mut cur = x.to_vec();
    let mut next = vec![0.0f64; n];
    for (k, s) in sos.iter().enumerate() {
        let (b0, b1, b2, a1, a2) = (s[0], s[1], s[2], s[4], s[5]);
        let mut s0 = zi[k][0];
        let mut s1 = zi[k][1];
        for i in 0..n {
            let xi = cur[i];
            let y = b0 * xi + s0;
            s0 = b1 * xi - a1 * y + s1;
            s1 = b2 * xi - a2 * y;
            next[i] = y;
        }
        std::mem::swap(&mut cur, &mut next);
    }
    cur
}

/// `scipy.signal._arraytools.odd_ext`: odd (point-symmetric) reflection of `n`
/// samples on each side about the boundary values. sosfiltfilt's default padtype.
fn odd_extend(x: &[f64], n: usize) -> Vec<f64> {
    if n == 0 {
        return x.to_vec();
    }
    assert!(
        x.len() > n,
        "odd_extend: signal length {} too short for pad {n}",
        x.len()
    );
    let mut out = vec![0.0f64; x.len() + 2 * n];
    let left = x[0];
    let right = x[x.len() - 1];
    for i in 0..n {
        out[i] = 2.0 * left - x[n - i];
    }
    out[n..n + x.len()].copy_from_slice(x);
    for i in 0..n {
        out[n + x.len() + i] = 2.0 * right - x[x.len() - 2 - i];
    }
    out
}

/// Forward-backward SOS filter matching `scipy.signal.sosfiltfilt` with the
/// default `padtype="odd"` and `padlen = 3 * (2*n_sections + 1 - zeros)`.
///
/// Per-section initial conditions are applied on BOTH passes — the edge-matching
/// step that dominates clip-boundary parity.
pub fn sosfiltfilt(sos: &[SosSection], x: &[f64]) -> Vec<f64> {
    let n_sections = sos.len();
    // scipy shrinks the pad by however many sections have a zero b2 AND a2; for
    // the order-1 bandpass neither is zero, so this reduces to 3*(2N+1).
    let zeros_b2 = sos.iter().filter(|s| s[2] == 0.0).count();
    let zeros_a2 = sos.iter().filter(|s| s[5] == 0.0).count();
    let min_z = zeros_b2.min(zeros_a2);
    let edge = 3 * (2 * n_sections + 1 - min_z);

    let ext = odd_extend(x, edge);
    let zi_base = sosfilt_zi(sos);

    // Forward pass: zi scaled by the first padded sample.
    let x0 = ext[0];
    let zi_fwd: Vec<[f64; 2]> = zi_base.iter().map(|z| [z[0] * x0, z[1] * x0]).collect();
    let y_fwd = sosfilt(sos, &ext, &zi_fwd);

    // Backward pass on the reversed forward output.
    let mut y_rev: Vec<f64> = y_fwd.iter().rev().copied().collect();
    let y0 = y_rev[0];
    let zi_back: Vec<[f64; 2]> = zi_base.iter().map(|z| [z[0] * y0, z[1] * y0]).collect();
    let y_back = sosfilt(sos, &y_rev, &zi_back);
    y_rev.clear();

    // Un-reverse and trim the padded edges.
    let mut out = vec![0.0f64; x.len()];
    let len = y_back.len();
    for i in 0..x.len() {
        out[i] = y_back[len - 1 - (i + edge)];
    }
    out
}

/// Zero-phase bandpass around `f0 ± half_bw` via the order-1 Butterworth SOS.
fn bandpass(audio: &[f64], fs: f64, f0: f64, half_bw: f64) -> Vec<f64> {
    let sos = [butter_bandpass_order1_sos(f0 - half_bw, f0 + half_bw, fs)];
    sosfiltfilt(&sos, audio)
}

// ---------- Smoothing ----------

/// Index into a length-`n` signal under `mode="reflect"` (period `2n`).
fn reflect_idx(i: isize, n: usize) -> usize {
    if n == 1 {
        return 0;
    }
    let period = 2 * n as isize;
    let k = ((i % period) + period) % period; // double-mod for negative i
    if (k as usize) < n {
        k as usize
    } else {
        (2 * n as isize - 1 - k) as usize
    }
}

/// Convolve with a centered kernel under reflect boundaries.
fn convolve_reflect(x: &[f64], kernel: &[f64]) -> Vec<f64> {
    let n = x.len();
    let kn = kernel.len();
    let half = (kn / 2) as isize;
    let mut out = vec![0.0f64; n];
    for (i, o) in out.iter_mut().enumerate() {
        let mut acc = 0.0;
        for (k, &kv) in kernel.iter().enumerate() {
            let idx = reflect_idx(i as isize + k as isize - half, n);
            acc += x[idx] * kv;
        }
        *o = acc;
    }
    out
}

/// `scipy.ndimage.gaussian_filter1d` (mode=reflect): truncate=4, normalized.
fn gaussian_filter1d(x: &[f64], sigma: f64) -> Vec<f64> {
    let radius = (sigma * 4.0).ceil().max(1.0) as usize;
    let size = 2 * radius + 1;
    let mut kernel = vec![0.0f64; size];
    let mut sum = 0.0;
    for (i, kv) in kernel.iter_mut().enumerate() {
        let d = i as f64 - radius as f64;
        *kv = (-d * d / (2.0 * sigma * sigma)).exp();
        sum += *kv;
    }
    for kv in kernel.iter_mut() {
        *kv /= sum;
    }
    convolve_reflect(x, &kernel)
}

/// `scipy.ndimage.uniform_filter1d` (odd or even size, centered, mode=reflect).
fn uniform_filter1d(x: &[f64], mut size: usize) -> Vec<f64> {
    if size < 1 {
        size = 1;
    }
    let half = (size / 2) as isize;
    let n = x.len();
    let mut out = vec![0.0f64; n];
    let inv = 1.0 / size as f64;
    for (i, o) in out.iter_mut().enumerate() {
        let mut sum = 0.0;
        let mut k = -half;
        while k < size as isize - half {
            let idx = reflect_idx(i as isize + k, n);
            sum += x[idx];
            k += 1;
        }
        *o = sum * inv;
    }
    out
}

// ---------- Decimate (mean pool by factor) ----------

/// Mean-pool by `factor`, yielding `floor(len / factor)` samples.
fn decimate(x: &[f64], factor: usize) -> Vec<f64> {
    let n_out = x.len() / factor;
    let mut out = vec![0.0f64; n_out];
    for (i, o) in out.iter_mut().enumerate() {
        let base = i * factor;
        let mut sum = 0.0;
        for k in 0..factor {
            sum += x[base + k];
        }
        *o = sum / factor as f64;
    }
    out
}

// ---------- Normalize / sharpen ----------

/// numpy 'linear' interpolation percentile over an ascending-sorted slice.
fn percentile(sorted: &[f64], pct: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let n = sorted.len();
    let rank = (pct / 100.0) * (n - 1) as f64;
    let lo = rank.floor() as usize;
    let hi = rank.ceil() as usize;
    if lo == hi {
        sorted[lo]
    } else {
        sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo as f64)
    }
}

/// Map `[loPct, hiPct]` percentile range onto `[0, 1]`, clamped.
fn percentile_normalize(x: &[f64], lo_pct: f64, hi_pct: f64) -> Vec<f64> {
    let mut sorted = x.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let lo = percentile(&sorted, lo_pct);
    let hi = percentile(&sorted, hi_pct);
    let denom = (hi - lo).max(1e-10);
    x.iter()
        .map(|&v| ((v - lo) / denom).clamp(0.0, 1.0))
        .collect()
}

/// Sigmoidal contrast sharpen: `x^γ / (x^γ + (1-x)^γ)`.
fn sharpen(x: &[f64], gamma: f64) -> Vec<f64> {
    x.iter()
        .map(|&v| {
            let xg = v.powf(gamma);
            xg / (xg + (1.0 - v).powf(gamma) + 1e-12)
        })
        .collect()
}

/// `(x - offset) / scale`, clamped to `[0, 1]`.
fn clip_offset_scale(x: &[f64], offset: f64, scale: f64) -> Vec<f64> {
    x.iter()
        .map(|&v| ((v - offset) / scale).clamp(0.0, 1.0))
        .collect()
}

// ---------- Channels ----------

fn ch0_amplitude(bp: &[f64], n_out: usize) -> Vec<f64> {
    let mag = hilbert_mag(bp);
    let smooth = gaussian_filter1d(&mag, 4.0);
    let dec = &decimate(&smooth, DECIMATION)[..n_out];
    let env = percentile_normalize(dec, 17.0, 88.0);
    let env = clip_offset_scale(&env, 0.05, 0.76);
    let env = sharpen(&env, SHARPEN_GAMMA);
    sharpen(&env, SHARPEN_GAMMA)
}

fn ch_tkeo(bp: &[f64], fs: f64, n_out: usize) -> Vec<f64> {
    let mut psi = vec![0.0f64; bp.len()];
    for i in 1..bp.len() - 1 {
        let v = bp[i] * bp[i] - bp[i - 1] * bp[i + 1];
        psi[i] = if v > 0.0 { v } else { 0.0 };
    }
    let win = ((TKEO_SMOOTH_MS / 1000.0 * fs).round() as usize).max(3);
    let smooth = uniform_filter1d(&psi, win);
    let dec = &decimate(&smooth, DECIMATION)[..n_out];
    percentile_normalize(dec, 17.0, 88.0)
}

fn ch_matched(audio: &[f64], fs: f64, tone_freq: f64, n_out: usize, duration_ms: f64) -> Vec<f64> {
    let n = audio.len();
    let mut i_arr = vec![0.0f64; n];
    let mut q_arr = vec![0.0f64; n];
    let two_pi = 2.0 * PI * tone_freq / fs;
    for i in 0..n {
        // Match dsp.ts exactly: phase grows unbounded as `two_pi * i`, no modular
        // reduction, so the f64 round-off tracks the TS path sample for sample.
        let phase = two_pi * i as f64;
        i_arr[i] = audio[i] * phase.cos();
        q_arr[i] = audio[i] * -phase.sin();
    }
    let win = ((duration_ms / 1000.0 * fs).round() as usize).max(3);
    let i_mf = uniform_filter1d(&i_arr, win);
    let q_mf = uniform_filter1d(&q_arr, win);
    let mag: Vec<f64> = (0..n).map(|i| i_mf[i].hypot(q_mf[i])).collect();
    let dec = &decimate(&mag, DECIMATION)[..n_out];
    percentile_normalize(dec, 17.0, 88.0)
}

// ---------- Public API ----------

/// Extract the `(T, 4)` envelope, interleaved as `f32` (`out[t*4 + c]`),
/// `T = floor(samples.len() / 16)`. `tone_freq` is the CW tone in Hz (default 700).
///
/// Panics if `sample_rate != DSP_SAMPLE_RATE`; the DSP is conformance-locked to
/// 8 kHz input and does not resample.
pub fn extract_envelope(audio: &[f32], sample_rate: u32, tone_freq: f64) -> Vec<f32> {
    assert_eq!(
        sample_rate, DSP_SAMPLE_RATE,
        "expected {DSP_SAMPLE_RATE} Hz audio, got {sample_rate}"
    );
    let fs = sample_rate as f64;
    let audio64: Vec<f64> = audio.iter().map(|&v| v as f64).collect();
    let n = audio64.len();
    let n_out = n / DECIMATION;

    let lo_hz = (tone_freq - BP_BW_HZ).max(1.0);
    let hi_hz = (tone_freq + BP_BW_HZ).min(fs / 2.0 - 1.0);
    let center = (lo_hz + hi_hz) / 2.0;
    let half_bw = (hi_hz - lo_hz) / 2.0;
    let bp = bandpass(&audio64, fs, center, half_bw);

    let ch0 = ch0_amplitude(&bp, n_out);
    let ch1 = ch_tkeo(&bp, fs, n_out);
    let ch2 = ch_matched(&audio64, fs, tone_freq, n_out, MATCHED_MS);
    let ch3 = ch_matched(&audio64, fs, tone_freq, n_out, LONG_MATCHED_MS);

    let mut out = vec![0.0f32; n_out * IN_CHANNELS];
    for i in 0..n_out {
        out[i * 4] = ch0[i] as f32;
        out[i * 4 + 1] = ch1[i] as f32;
        out[i * 4 + 2] = ch2[i] as f32;
        out[i * 4 + 3] = ch3[i] as f32;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use std::path::{Path, PathBuf};

    fn fixture_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/dsp")
    }

    #[derive(Deserialize)]
    struct Index {
        dsp_sample_rate: u32,
        channels: Vec<String>,
        clips: Vec<ClipManifest>,
    }

    #[derive(Deserialize)]
    struct ClipManifest {
        id: String,
        tone_freq_hz: f64,
        n_envelope_frames: usize,
        input_wav: String,
        envelope_json: String,
    }

    #[derive(Deserialize)]
    struct EnvelopeJson {
        shape: [usize; 2],
        data: Vec<f32>,
    }

    fn load_index() -> Index {
        let raw = std::fs::read_to_string(fixture_dir().join("index.json")).unwrap();
        serde_json::from_str(&raw).unwrap()
    }

    fn load_envelope(rel: &str) -> EnvelopeJson {
        let raw = std::fs::read_to_string(fixture_dir().join(rel)).unwrap();
        serde_json::from_str(&raw).unwrap()
    }

    // Minimal mono PCM-16 WAV reader for the fixtures (trusts the fixture writer).
    fn read_wav_pcm16_mono(path: &Path) -> Vec<f32> {
        let buf = std::fs::read(path).unwrap();
        let mut pos = 12usize;
        let (mut data_off, mut data_len) = (None, 0usize);
        while pos + 8 <= buf.len() {
            let id = &buf[pos..pos + 4];
            let size = u32::from_le_bytes(buf[pos + 4..pos + 8].try_into().unwrap()) as usize;
            if id == b"data" {
                data_off = Some(pos + 8);
                data_len = size;
                break;
            }
            pos += 8 + size + (size & 1);
        }
        let off = data_off.expect("no data chunk");
        let n = data_len / 2;
        (0..n)
            .map(|i| {
                let s = i16::from_le_bytes(buf[off + i * 2..off + i * 2 + 2].try_into().unwrap());
                s as f32 / 32768.0
            })
            .collect()
    }

    /// Coefficient unit test: our SOS must match scipy's hardcoded reference.
    #[test]
    fn butter_sos_matches_scipy_reference() {
        // butter(1, [tone-25, tone+25], btype="bandpass", fs=8000, output="sos")[0]
        let refs: [(f64, SosSection); 3] = [
            (
                700.0,
                [
                    0.019259274202335797,
                    0.0,
                    -0.019259274202335797,
                    1.0,
                    -1.6727603077362847,
                    0.9614814515953285,
                ],
            ),
            (
                600.0,
                [
                    0.019259274202335773,
                    0.0,
                    -0.019259274202335773,
                    1.0,
                    -1.7480297198120356,
                    0.9614814515953288,
                ],
            ),
            (
                800.0,
                [
                    0.019259274202335676,
                    0.0,
                    -0.019259274202335676,
                    1.0,
                    -1.5871777721140923,
                    0.961481451595329,
                ],
            ),
        ];
        for (tone, reference) in refs {
            let sos = butter_bandpass_order1_sos(tone - 25.0, tone + 25.0, 8000.0);
            for i in 0..6 {
                assert!(
                    (sos[i] - reference[i]).abs() < 1e-14,
                    "tone={tone} coef[{i}] mine={} ref={}",
                    sos[i],
                    reference[i]
                );
            }
        }
    }

    /// sosfilt_zi must match scipy's reference for the 700 Hz section.
    #[test]
    fn sosfilt_zi_matches_scipy_reference() {
        let sos = butter_bandpass_order1_sos(675.0, 725.0, 8000.0);
        let zi = sosfilt_zi(&[sos]);
        assert!((zi[0][0] - -0.019259274202335797).abs() < 1e-14);
        assert!((zi[0][1] - -0.019259274202335797).abs() < 1e-14);
    }

    /// The conformance lock: every channel must match the Python golden vectors
    /// at the same strict epsilons the TS parity test uses.
    #[test]
    fn extract_envelope_parity_vs_python_golden() {
        // Per-channel max-abs-error gates, identical to dsp.parity.test.ts.
        const EPS: [f32; 4] = [
            5e-4, // ch0 amplitude — FFT/Hilbert floor dominates
            1e-9, // ch1 TKEO
            1e-8, // ch2 matched 48 ms
            1e-6, // ch3 matched 200 ms
        ];

        let index = load_index();
        assert_eq!(index.dsp_sample_rate, DSP_SAMPLE_RATE);
        assert_eq!(index.channels.len(), IN_CHANNELS);

        for clip in &index.clips {
            let audio = read_wav_pcm16_mono(&fixture_dir().join(&clip.input_wav));
            let env = extract_envelope(&audio, DSP_SAMPLE_RATE, clip.tone_freq_hz);
            let golden = load_envelope(&clip.envelope_json);
            assert_eq!(golden.shape[1], IN_CHANNELS);
            assert_eq!(golden.shape[0], clip.n_envelope_frames);
            assert_eq!(env.len(), golden.shape[0] * IN_CHANNELS);

            let t = golden.shape[0];
            let mut max_err = [0.0f32; 4];
            for ti in 0..t {
                for c in 0..IN_CHANNELS {
                    let d = (env[ti * 4 + c] - golden.data[ti * 4 + c]).abs();
                    if d > max_err[c] {
                        max_err[c] = d;
                    }
                }
            }
            for c in 0..IN_CHANNELS {
                assert!(
                    max_err[c] < EPS[c],
                    "{} ch{c} max abs err {:e} exceeds eps {:e} (errs {:?})",
                    clip.id,
                    max_err[c],
                    EPS[c],
                    max_err
                );
            }
        }
    }
}
