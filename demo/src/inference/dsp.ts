// Port of cw-ml/cw-dsp-research/dsp.py — 4-channel envelope extraction.
//
// ch0: amplitude       — ±25 Hz bandpass + Hilbert + pct-norm + gentle sharpen
// ch1: TKEO            — Teager-Kaiser energy on bandpassed signal
// ch2: matched filter  — 48 ms coherent IQ box (dit-scale, BW ~21 Hz)
// ch3: long matched    — 200 ms coherent IQ box (character-scale, BW ~5 Hz)
//
// Input audio must be at DSP_SAMPLE_RATE. Output is (T, 4) at ENVELOPE_SR, with T = floor(len/16).

import { fft, ifft, nextPow2 } from './fft'

export const DSP_SAMPLE_RATE = 8000
export const ENVELOPE_SR = 500
export const DECIMATION = 16

const BP_BW_HZ = 25.0
const TKEO_SMOOTH_MS = 30.0
const MATCHED_MS = 48.0
const LONG_MATCHED_MS = 200.0
const SHARPEN_GAMMA = 8.0

// ---------- Biquad filter (RBJ BPF), forward-backward for ~zero phase ----------

function rbjBandpass(f0: number, bw: number, fs: number): [number, number, number, number, number] {
  const w0 = (2 * Math.PI * f0) / fs
  const cosW = Math.cos(w0)
  const sinW = Math.sin(w0)
  // BW in Hz → Q
  const Q = f0 / bw
  const alpha = sinW / (2 * Q)
  const b0 = alpha
  const b1 = 0
  const b2 = -alpha
  const a0 = 1 + alpha
  const a1 = -2 * cosW
  const a2 = 1 - alpha
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0]
}

function biquad(x: Float64Array, coefs: [number, number, number, number, number]): Float64Array {
  const [b0, b1, b2, a1, a2] = coefs
  const n = x.length
  const out = new Float64Array(n)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < n; i++) {
    const y = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1; x1 = x[i]
    y2 = y1; y1 = y
    out[i] = y
  }
  return out
}

function filtfilt(x: Float64Array, coefs: [number, number, number, number, number]): Float64Array {
  const fwd = biquad(x, coefs)
  const rev = new Float64Array(fwd.length)
  for (let i = 0; i < fwd.length; i++) rev[i] = fwd[fwd.length - 1 - i]
  const back = biquad(rev, coefs)
  const out = new Float64Array(back.length)
  for (let i = 0; i < back.length; i++) out[i] = back[back.length - 1 - i]
  return out
}

export function bandpass(audio: Float64Array, fs: number, f0: number, halfBw: number): Float64Array {
  const bw = 2 * halfBw
  const coefs = rbjBandpass(f0, bw, fs)
  return filtfilt(audio, coefs)
}

// ---------- Hilbert transform magnitude via FFT ----------

export function hilbertMag(x: Float64Array): Float64Array {
  const n = x.length
  const N = nextPow2(n)
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  for (let i = 0; i < n; i++) re[i] = x[i]

  fft(re, im)

  // Multiplier: 1 for DC and Nyquist, 2 for 1..N/2-1, 0 for N/2+1..N-1
  for (let k = 1; k < N / 2; k++) {
    re[k] *= 2
    im[k] *= 2
  }
  for (let k = N / 2 + 1; k < N; k++) {
    re[k] = 0
    im[k] = 0
  }

  ifft(re, im)

  const mag = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    mag[i] = Math.hypot(re[i], im[i])
  }
  return mag
}

// ---------- Smoothing ----------

export function gaussianFilter1d(x: Float64Array, sigma: number): Float64Array {
  const radius = Math.max(1, Math.ceil(sigma * 4))
  const size = 2 * radius + 1
  const kernel = new Float64Array(size)
  let sum = 0
  for (let i = 0; i < size; i++) {
    const d = i - radius
    kernel[i] = Math.exp((-d * d) / (2 * sigma * sigma))
    sum += kernel[i]
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum
  return convolveReflect(x, kernel)
}

export function uniformFilter1d(x: Float64Array, size: number): Float64Array {
  // scipy.ndimage.uniform_filter1d: odd size, centered; mode=reflect
  if (size < 1) size = 1
  const half = Math.floor(size / 2)
  const n = x.length
  const out = new Float64Array(n)
  const inv = 1 / size
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (let k = -half; k < size - half; k++) {
      const idx = reflectIdx(i + k, n)
      sum += x[idx]
    }
    out[i] = sum * inv
  }
  return out
}

function reflectIdx(i: number, n: number): number {
  if (n === 1) return 0
  const period = 2 * n - 2
  let k = i % period
  if (k < 0) k += period
  return k < n ? k : period - k
}

function convolveReflect(x: Float64Array, kernel: Float64Array): Float64Array {
  const n = x.length
  const kn = kernel.length
  const half = Math.floor(kn / 2)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let acc = 0
    for (let k = 0; k < kn; k++) {
      const idx = reflectIdx(i + k - half, n)
      acc += x[idx] * kernel[k]
    }
    out[i] = acc
  }
  return out
}

// ---------- Decimate (mean pool by factor) ----------

export function decimate(x: Float64Array, factor: number): Float64Array {
  const nOut = Math.floor(x.length / factor)
  const out = new Float64Array(nOut)
  for (let i = 0; i < nOut; i++) {
    let sum = 0
    const base = i * factor
    for (let k = 0; k < factor; k++) sum += x[base + k]
    out[i] = sum / factor
  }
  return out
}

// ---------- Normalize / sharpen ----------

export function percentileNormalize(x: Float64Array, loPct = 17.0, hiPct = 88.0): Float64Array {
  const sorted = Float64Array.from(x).sort()
  const lo = percentile(sorted, loPct)
  const hi = percentile(sorted, hiPct)
  const denom = Math.max(hi - lo, 1e-10)
  const out = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) {
    const v = (x[i] - lo) / denom
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v
  }
  return out
}

function percentile(sorted: Float64Array, pct: number): number {
  // Match numpy 'linear' interpolation
  if (sorted.length === 0) return 0
  const n = sorted.length
  const rank = (pct / 100) * (n - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo)
}

export function sharpen(x: Float64Array, gamma: number): Float64Array {
  const out = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) {
    const v = x[i]
    const xg = Math.pow(v, gamma)
    out[i] = xg / (xg + Math.pow(1 - v, gamma) + 1e-12)
  }
  return out
}

function clipOffsetScale(x: Float64Array, offset: number, scale: number): Float64Array {
  const out = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) {
    const v = (x[i] - offset) / scale
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v
  }
  return out
}

// ---------- Channels ----------

function ch0Amplitude(bp: Float64Array, nOut: number): Float64Array {
  const mag = hilbertMag(bp)
  const smooth = gaussianFilter1d(mag, 4.0)
  const dec = decimate(smooth, DECIMATION).subarray(0, nOut) as Float64Array
  let env = percentileNormalize(dec)
  env = clipOffsetScale(env, 0.05, 0.76)
  env = sharpen(env, SHARPEN_GAMMA)
  env = sharpen(env, SHARPEN_GAMMA)
  return env
}

function tkeo(bp: Float64Array, fs: number, nOut: number): Float64Array {
  const psi = new Float64Array(bp.length)
  for (let i = 1; i < bp.length - 1; i++) {
    const v = bp[i] * bp[i] - bp[i - 1] * bp[i + 1]
    psi[i] = v > 0 ? v : 0
  }
  const win = Math.max(3, Math.round(TKEO_SMOOTH_MS / 1000 * fs))
  const smooth = uniformFilter1d(psi, win)
  const dec = decimate(smooth, DECIMATION).subarray(0, nOut) as Float64Array
  return percentileNormalize(dec)
}

function matched(audio: Float64Array, fs: number, toneFreq: number, nOut: number, durationMs: number): Float64Array {
  const n = audio.length
  const I = new Float64Array(n)
  const Q = new Float64Array(n)
  const twoPi = 2 * Math.PI * toneFreq / fs
  for (let i = 0; i < n; i++) {
    const phase = twoPi * i
    I[i] = audio[i] * Math.cos(phase)
    Q[i] = audio[i] * -Math.sin(phase)
  }
  const win = Math.max(3, Math.round(durationMs / 1000 * fs))
  const Imf = uniformFilter1d(I, win)
  const Qmf = uniformFilter1d(Q, win)
  const mag = new Float64Array(n)
  for (let i = 0; i < n; i++) mag[i] = Math.hypot(Imf[i], Qmf[i])
  const dec = decimate(mag, DECIMATION).subarray(0, nOut) as Float64Array
  return percentileNormalize(dec)
}

// ---------- Public API ----------

export function extractEnvelope(
  audio: Float32Array | Float64Array,
  sampleRate: number = DSP_SAMPLE_RATE,
  toneFreq: number = 700,
): Float32Array {
  if (sampleRate !== DSP_SAMPLE_RATE) {
    throw new Error(`expected ${DSP_SAMPLE_RATE} Hz audio, got ${sampleRate}`)
  }
  const audio64 = audio instanceof Float64Array ? audio : Float64Array.from(audio)
  const n = audio64.length
  const nOut = Math.floor(n / DECIMATION)

  const loHz = Math.max(toneFreq - BP_BW_HZ, 1)
  const hiHz = Math.min(toneFreq + BP_BW_HZ, sampleRate / 2 - 1)
  const center = (loHz + hiHz) / 2
  const halfBw = (hiHz - loHz) / 2
  const bp = bandpass(audio64, sampleRate, center, halfBw)

  const ch0 = ch0Amplitude(bp, nOut)
  const ch1 = tkeo(bp, sampleRate, nOut)
  const ch2 = matched(audio64, sampleRate, toneFreq, nOut, MATCHED_MS)
  const ch3 = matched(audio64, sampleRate, toneFreq, nOut, LONG_MATCHED_MS)

  // Interleave as (T, 4)
  const out = new Float32Array(nOut * 4)
  for (let i = 0; i < nOut; i++) {
    out[i * 4 + 0] = ch0[i]
    out[i * 4 + 1] = ch1[i]
    out[i * 4 + 2] = ch2[i]
    out[i * 4 + 3] = ch3[i]
  }
  return out
}
