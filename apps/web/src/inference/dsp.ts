// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Port of packages/ml/cw-dsp-research/dsp.py — 4-channel envelope extraction.
//
// ch0: amplitude       — ±25 Hz bandpass + Hilbert + pct-norm + gentle sharpen
// ch1: TKEO            — Teager-Kaiser energy on bandpassed signal
// ch2: matched filter  — 48 ms coherent IQ box (dit-scale, BW ~21 Hz)
// ch3: long matched    — 200 ms coherent IQ box (character-scale, BW ~5 Hz)
//
// Input audio must be at DSP_SAMPLE_RATE. Output is (T, 4) at ENVELOPE_SR, with T = floor(len/16).

import { fft, ifft, nextPow2 } from './fft';

export const DSP_SAMPLE_RATE = 8000;
export const ENVELOPE_SR = 500;
export const DECIMATION = 16;

const BP_BW_HZ = 25.0;
const TKEO_SMOOTH_MS = 30.0;
const MATCHED_MS = 48.0;
const LONG_MATCHED_MS = 200.0;
const SHARPEN_GAMMA = 8.0;

// ---------- Order-1 Butterworth bandpass (SOS, forward-backward) ----------
//
// Matches scipy.signal.butter(1, [lo, hi], btype="bandpass", fs=fs, output="sos")
// + scipy.signal.sosfiltfilt — the authoritative training-side filter in
// packages/ml/cw-dsp-research/dsp.py. Closed-form for order 1: one analog
// section Δs / (s² + Δs + Ω0²) with prewarped band edges, bilinear-transformed
// to a single digital biquad. Conformance is locked by the per-channel parity
// test against fixtures/dsp/.

/** A single second-order section in scipy's row layout: [b0, b1, b2, a0, a1, a2]. */
export type SosSection = [number, number, number, number, number, number];

/**
 * Order-1 Butterworth bandpass SOS for [loHz, hiHz] at sample rate fs.
 * Returns one section, matching `scipy.signal.butter(1, ..., output="sos")[0]`
 * to ~1e-15 absolute on every coefficient (numerical-noise level).
 */
export function butterBandpassOrder1Sos(
  loHz: number,
  hiHz: number,
  fs: number
): SosSection {
  // Bilinear prewarp of the band edges, then analog bandpass transform of the
  // order-1 lowpass prototype 1/(s+1): H_a(s) = Δs / (s² + Δs + Ω0²).
  const K = 2 * fs;
  const loW = K * Math.tan((Math.PI * loHz) / fs);
  const hiW = K * Math.tan((Math.PI * hiHz) / fs);
  const Omega0Sq = loW * hiW;
  const Delta = hiW - loW;
  // Bilinear (s = K(z-1)/(z+1)), then clear (z+1)² from both polynomials.
  const a0Raw = K * K + Delta * K + Omega0Sq;
  const b0 = (Delta * K) / a0Raw;
  const b2 = -(Delta * K) / a0Raw;
  const a1 = (2 * Omega0Sq - 2 * K * K) / a0Raw;
  const a2 = (K * K - Delta * K + Omega0Sq) / a0Raw;
  return [b0, 0, b2, 1, a1, a2];
}

/**
 * Per-section steady-state initial conditions for unit step input. Mirrors
 * scipy.signal.sosfilt_zi: the returned `zi[k]` should be multiplied by the
 * first sample fed to section k for use as the initial state in Direct-Form-II
 * Transposed sosfilt. Assumes a0 == 1 (scipy normalizes on construction).
 */
export function sosfiltZi(sos: SosSection[]): [number, number][] {
  // For DF2T: y = b0*x + s0; s0' = b1*x - a1*y + s1; s1' = b2*x - a2*y.
  // Steady state with x = 1 in isolation gives y_ss = (b0+b1+b2)/(1+a1+a2),
  // s1 = b2 - a2*y_ss, s0 = b1 + b2 - (a1+a2)*y_ss. But sosfilt_zi composes
  // sections: section k receives the previous section's steady-state output
  // (scaled by x), so we propagate scale = y_ss across sections.
  const zi: [number, number][] = [];
  let scale = 1;
  for (const s of sos) {
    const b0 = s[0],
      b1 = s[1],
      b2 = s[2],
      a1 = s[4],
      a2 = s[5];
    const denom = 1 + a1 + a2;
    const yss = ((b0 + b1 + b2) * scale) / denom;
    const s1 = b2 * scale - a2 * yss;
    const s0 = b1 * scale + b2 * scale - (a1 + a2) * yss;
    zi.push([s0, s1]);
    scale = yss;
  }
  return zi;
}

/**
 * Direct-Form-II Transposed SOS filter. Mirrors scipy.signal.sosfilt with the
 * `zi` argument: pass per-section initial state (already scaled by the first
 * sample if you want sosfiltfilt-style edge matching). Returns `{ y, zf }`.
 */
function sosfilt(
  sos: SosSection[],
  x: Float64Array,
  zi: ReadonlyArray<readonly [number, number]>
): { y: Float64Array; zf: [number, number][] } {
  const n = x.length;
  const zf: [number, number][] = zi.map(([a, b]) => [a, b]);
  let cur = Float64Array.from(x);
  let next = new Float64Array(n);
  for (let k = 0; k < sos.length; k++) {
    const [b0, b1, b2, , a1, a2] = sos[k];
    let s0 = zf[k][0];
    let s1 = zf[k][1];
    for (let i = 0; i < n; i++) {
      const xi = cur[i];
      const y = b0 * xi + s0;
      s0 = b1 * xi - a1 * y + s1;
      s1 = b2 * xi - a2 * y;
      next[i] = y;
    }
    zf[k] = [s0, s1];
    const tmp = cur;
    cur = next;
    next = tmp;
  }
  return { y: cur, zf };
}

/**
 * Forward-backward SOS filter matching scipy.signal.sosfiltfilt with default
 * `padtype="odd"` and `padlen = 3 * (2*n_sections + 1 - zerosInB2A2)`. For
 * order-1 bandpass (n_sections=1, no zero b2/a2) that's an edge of 9 samples.
 *
 * Crucially this uses per-section initial conditions on BOTH forward and
 * backward passes — the bit the previous naive RBJ-biquad filtfilt omitted,
 * which is what dominated the parity gap at the clip edges.
 */
export function sosfiltfilt(sos: SosSection[], x: Float64Array): Float64Array {
  const nSections = sos.length;
  // scipy: padlen default counts b2/a2 zeros to shrink ntaps; for our order-1
  // bandpass neither b2 nor a2 is zero, so this reduces to 3 * (2*N + 1).
  let zerosB2 = 0;
  let zerosA2 = 0;
  for (const s of sos) {
    if (s[2] === 0) zerosB2++;
    if (s[5] === 0) zerosA2++;
  }
  const minZ = Math.min(zerosB2, zerosA2);
  const edge = 3 * (2 * nSections + 1 - minZ);

  const ext = oddExtend(x, edge);
  const ziBase = sosfiltZi(sos);

  // Forward pass: zi scaled by ext[0].
  const x0 = ext[0];
  const ziFwd = ziBase.map(([a, b]) => [a * x0, b * x0] as [number, number]);
  const { y: yFwd } = sosfilt(sos, ext, ziFwd);

  // Backward pass on reversed forward output, with zi scaled by its last sample.
  const yRev = new Float64Array(yFwd.length);
  for (let i = 0; i < yFwd.length; i++) yRev[i] = yFwd[yFwd.length - 1 - i];
  const y0 = yRev[0];
  const ziBack = ziBase.map(([a, b]) => [a * y0, b * y0] as [number, number]);
  const { y: yBack } = sosfilt(sos, yRev, ziBack);

  // Un-reverse and trim the padded edges.
  const yOut = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    yOut[i] = yBack[yBack.length - 1 - (i + edge)];
  }
  return yOut;
}

/**
 * scipy.signal._arraytools.odd_ext: reflect `n` samples on each side about
 * the boundary value. Used by sosfiltfilt's default padtype.
 */
function oddExtend(x: Float64Array, n: number): Float64Array {
  if (n === 0) return Float64Array.from(x);
  if (x.length < n + 1) {
    throw new Error(
      `oddExtend: signal length ${x.length} too short for pad ${n}`
    );
  }
  const out = new Float64Array(x.length + 2 * n);
  const left = x[0];
  const right = x[x.length - 1];
  for (let i = 0; i < n; i++) {
    // left_ext[i] = 2*x[0] - x[n - i]  (mirrors x[n], x[n-1], ..., x[1])
    out[i] = 2 * left - x[n - i];
  }
  for (let i = 0; i < x.length; i++) {
    out[n + i] = x[i];
  }
  for (let i = 0; i < n; i++) {
    // right_ext[i] = 2*x[-1] - x[-2 - i]
    out[n + x.length + i] = 2 * right - x[x.length - 2 - i];
  }
  return out;
}

export function bandpass(
  audio: Float64Array,
  fs: number,
  f0: number,
  halfBw: number
): Float64Array {
  const loHz = f0 - halfBw;
  const hiHz = f0 + halfBw;
  const sos = [butterBandpassOrder1Sos(loHz, hiHz, fs)];
  return sosfiltfilt(sos, audio);
}

// ---------- Hilbert transform magnitude via FFT ----------

export function hilbertMag(x: Float64Array): Float64Array {
  const n = x.length;
  const N = nextPow2(n);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < n; i++) re[i] = x[i];

  fft(re, im);

  // Multiplier: 1 for DC and Nyquist, 2 for 1..N/2-1, 0 for N/2+1..N-1
  for (let k = 1; k < N / 2; k++) {
    re[k] *= 2;
    im[k] *= 2;
  }
  for (let k = N / 2 + 1; k < N; k++) {
    re[k] = 0;
    im[k] = 0;
  }

  ifft(re, im);

  const mag = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    mag[i] = Math.hypot(re[i], im[i]);
  }
  return mag;
}

// ---------- Smoothing ----------

export function gaussianFilter1d(x: Float64Array, sigma: number): Float64Array {
  const radius = Math.max(1, Math.ceil(sigma * 4));
  const size = 2 * radius + 1;
  const kernel = new Float64Array(size);
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const d = i - radius;
    kernel[i] = Math.exp((-d * d) / (2 * sigma * sigma));
    sum += kernel[i];
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;
  return convolveReflect(x, kernel);
}

export function uniformFilter1d(x: Float64Array, size: number): Float64Array {
  // scipy.ndimage.uniform_filter1d: odd size, centered; mode=reflect
  if (size < 1) size = 1;
  const half = Math.floor(size / 2);
  const n = x.length;
  const out = new Float64Array(n);
  const inv = 1 / size;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -half; k < size - half; k++) {
      const idx = reflectIdx(i + k, n);
      sum += x[idx];
    }
    out[i] = sum * inv;
  }
  return out;
}

function reflectIdx(i: number, n: number): number {
  if (n === 1) return 0;
  const period = 2 * n - 2;
  let k = i % period;
  if (k < 0) k += period;
  return k < n ? k : period - k;
}

function convolveReflect(x: Float64Array, kernel: Float64Array): Float64Array {
  const n = x.length;
  const kn = kernel.length;
  const half = Math.floor(kn / 2);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = 0; k < kn; k++) {
      const idx = reflectIdx(i + k - half, n);
      acc += x[idx] * kernel[k];
    }
    out[i] = acc;
  }
  return out;
}

// ---------- Decimate (mean pool by factor) ----------

export function decimate(x: Float64Array, factor: number): Float64Array {
  const nOut = Math.floor(x.length / factor);
  const out = new Float64Array(nOut);
  for (let i = 0; i < nOut; i++) {
    let sum = 0;
    const base = i * factor;
    for (let k = 0; k < factor; k++) sum += x[base + k];
    out[i] = sum / factor;
  }
  return out;
}

// ---------- Normalize / sharpen ----------

export function percentileNormalize(
  x: Float64Array,
  loPct = 17.0,
  hiPct = 88.0
): Float64Array {
  const sorted = Float64Array.from(x).sort();
  const lo = percentile(sorted, loPct);
  const hi = percentile(sorted, hiPct);
  const denom = Math.max(hi - lo, 1e-10);
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = (x[i] - lo) / denom;
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}

function percentile(sorted: Float64Array, pct: number): number {
  // Match numpy 'linear' interpolation
  if (sorted.length === 0) return 0;
  const n = sorted.length;
  const rank = (pct / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

export function sharpen(x: Float64Array, gamma: number): Float64Array {
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const xg = v ** gamma;
    out[i] = xg / (xg + (1 - v) ** gamma + 1e-12);
  }
  return out;
}

function clipOffsetScale(
  x: Float64Array,
  offset: number,
  scale: number
): Float64Array {
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = (x[i] - offset) / scale;
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}

// ---------- Channels ----------

function ch0Amplitude(bp: Float64Array, nOut: number): Float64Array {
  const mag = hilbertMag(bp);
  const smooth = gaussianFilter1d(mag, 4.0);
  const dec = decimate(smooth, DECIMATION).subarray(0, nOut) as Float64Array;
  let env = percentileNormalize(dec);
  env = clipOffsetScale(env, 0.05, 0.76);
  env = sharpen(env, SHARPEN_GAMMA);
  env = sharpen(env, SHARPEN_GAMMA);
  return env;
}

function tkeo(bp: Float64Array, fs: number, nOut: number): Float64Array {
  const psi = new Float64Array(bp.length);
  for (let i = 1; i < bp.length - 1; i++) {
    const v = bp[i] * bp[i] - bp[i - 1] * bp[i + 1];
    psi[i] = v > 0 ? v : 0;
  }
  const win = Math.max(3, Math.round((TKEO_SMOOTH_MS / 1000) * fs));
  const smooth = uniformFilter1d(psi, win);
  const dec = decimate(smooth, DECIMATION).subarray(0, nOut) as Float64Array;
  return percentileNormalize(dec);
}

function matched(
  audio: Float64Array,
  fs: number,
  toneFreq: number,
  nOut: number,
  durationMs: number
): Float64Array {
  const n = audio.length;
  const I = new Float64Array(n);
  const Q = new Float64Array(n);
  const twoPi = (2 * Math.PI * toneFreq) / fs;
  for (let i = 0; i < n; i++) {
    const phase = twoPi * i;
    I[i] = audio[i] * Math.cos(phase);
    Q[i] = audio[i] * -Math.sin(phase);
  }
  const win = Math.max(3, Math.round((durationMs / 1000) * fs));
  const Imf = uniformFilter1d(I, win);
  const Qmf = uniformFilter1d(Q, win);
  const mag = new Float64Array(n);
  for (let i = 0; i < n; i++) mag[i] = Math.hypot(Imf[i], Qmf[i]);
  const dec = decimate(mag, DECIMATION).subarray(0, nOut) as Float64Array;
  return percentileNormalize(dec);
}

// ---------- Public API ----------

export function extractEnvelope(
  audio: Float32Array | Float64Array,
  sampleRate: number = DSP_SAMPLE_RATE,
  toneFreq: number = 700
): Float32Array {
  if (sampleRate !== DSP_SAMPLE_RATE) {
    throw new Error(`expected ${DSP_SAMPLE_RATE} Hz audio, got ${sampleRate}`);
  }
  const audio64 =
    audio instanceof Float64Array ? audio : Float64Array.from(audio);
  const n = audio64.length;
  const nOut = Math.floor(n / DECIMATION);

  const loHz = Math.max(toneFreq - BP_BW_HZ, 1);
  const hiHz = Math.min(toneFreq + BP_BW_HZ, sampleRate / 2 - 1);
  const center = (loHz + hiHz) / 2;
  const halfBw = (hiHz - loHz) / 2;
  const bp = bandpass(audio64, sampleRate, center, halfBw);

  const ch0 = ch0Amplitude(bp, nOut);
  const ch1 = tkeo(bp, sampleRate, nOut);
  const ch2 = matched(audio64, sampleRate, toneFreq, nOut, MATCHED_MS);
  const ch3 = matched(audio64, sampleRate, toneFreq, nOut, LONG_MATCHED_MS);

  // Interleave as (T, 4)
  const out = new Float32Array(nOut * 4);
  for (let i = 0; i < nOut; i++) {
    out[i * 4 + 0] = ch0[i];
    out[i * 4 + 1] = ch1[i];
    out[i * 4 + 2] = ch2[i];
    out[i * 4 + 3] = ch3[i];
  }
  return out;
}
