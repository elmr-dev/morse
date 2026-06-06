/**
 * v11 DSP pipeline — 5-channel feature extraction for CW Morse decoding.
 *
 * All channels operate on 8kHz audio. Channels 0,1,3,4 output at 8kHz and are
 * downsampled to 500Hz via stride-16 average pooling. Channel 2 (STFT) outputs
 * at 500Hz natively (hop=16 samples).
 *
 * Channel layout:
 *   0 — mid40       : IQ envelope, 40Hz LPF
 *   1 — phase50     : phase coherence, 75Hz LPF, 50ms window
 *   2 — stft2048    : STFT spectral contrast, 2048-sample window
 *   3 — autocorr_v11: normalized autocorrelation at carrier period
 *   4 — phase_instfreq: instantaneous frequency stability, 20ms window
 */

import { butterworthLowpass, butterworthBandpass, sosfiltfilt } from './iir.js';

export interface DspResult {
  /** Interleaved (T, 5) row-major float32 array: features[t*5 + ch] = ch value at frame t */
  features: Float32Array;
  /** Number of 500Hz output frames T */
  frames: number;
}

const SAMPLE_RATE = 8000;
const DOWNSAMPLE_STRIDE = 16; // 8000 / 16 = 500 Hz output rate
const OUTPUT_RATE = SAMPLE_RATE / DOWNSAMPLE_STRIDE; // 500 Hz

// ---------------------------------------------------------------------------
// IQ baseband mixing
// ---------------------------------------------------------------------------

function iqMix(
  audio: Float64Array,
  toneHz: number,
  sampleRate: number,
): { I: Float64Array; Q: Float64Array } {
  const n = audio.length;
  const I = new Float64Array(n);
  const Q = new Float64Array(n);
  const twoPiF = 2 * Math.PI * toneHz / sampleRate;
  for (let i = 0; i < n; i++) {
    const phase = twoPiF * i;
    I[i] =  audio[i] * Math.cos(phase);
    Q[i] = -audio[i] * Math.sin(phase);
  }
  return { I, Q };
}

// ---------------------------------------------------------------------------
// Stride-16 average pooling (8kHz → 500Hz)
// ---------------------------------------------------------------------------

function stridePool16(signal: Float64Array): Float64Array {
  const T = Math.floor(signal.length / DOWNSAMPLE_STRIDE);
  const out = new Float64Array(T);
  for (let t = 0; t < T; t++) {
    let sum = 0;
    const base = t * DOWNSAMPLE_STRIDE;
    for (let k = 0; k < DOWNSAMPLE_STRIDE; k++) sum += signal[base + k];
    out[t] = sum / DOWNSAMPLE_STRIDE;
  }
  return out;
}

// ---------------------------------------------------------------------------
// normalize_soft — Python port
// ---------------------------------------------------------------------------

/**
 * Sliding minimum filter (mode=reflect equivalent for 1D signal).
 * Uses a naive O(n*win) approach for simplicity; for typical sizes it's fine.
 * For production with very long audio, a deque-based O(n) implementation would
 * be preferable, but correctness matches scipy minimum_filter1d(mode='reflect').
 */
function slidingMin(signal: Float64Array, win: number): Float64Array {
  const n = signal.length;
  const out = new Float64Array(n);
  const half = Math.floor(win / 2);

  for (let i = 0; i < n; i++) {
    let minVal = Infinity;
    for (let k = -half; k <= half; k++) {
      // reflect padding
      let idx = i + k;
      if (idx < 0) idx = -idx - 1;
      else if (idx >= n) idx = 2 * n - idx - 1;
      idx = Math.max(0, Math.min(n - 1, idx));
      if (signal[idx] < minVal) minVal = signal[idx];
    }
    out[i] = minVal;
  }
  return out;
}

/** Running sum convolution with kernel of size pre (ones/pre), mode='same'. */
function movingAverage(signal: Float64Array, pre: number): Float64Array {
  if (pre <= 1) return signal.slice();
  const n = signal.length;
  const out = new Float64Array(n);
  const half = Math.floor((pre - 1) / 2);
  let sum = 0;
  let count = 0;

  // Build initial window
  for (let k = 0; k < pre; k++) {
    const idx = k - half;
    if (idx >= 0 && idx < n) {
      sum += signal[idx];
      count++;
    }
  }

  for (let i = 0; i < n; i++) {
    out[i] = count > 0 ? sum / count : 0;

    // Remove leaving element
    const removeIdx = i - half;
    if (removeIdx >= 0 && removeIdx < n) {
      sum -= signal[removeIdx];
      count--;
    }
    // Add entering element
    const addIdx = i + 1 + half;
    if (addIdx >= 0 && addIdx < n) {
      sum += signal[addIdx];
      count++;
    }
  }
  return out;
}

function percentile(arr: Float64Array, p: number): number {
  if (arr.length === 0) return 0;
  const sorted = arr.slice().sort();
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

function stddev(arr: Float64Array): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  const mean = sum / arr.length;
  let sq = 0;
  for (let i = 0; i < arr.length; i++) sq += (arr[i] - mean) ** 2;
  return Math.sqrt(sq / arr.length);
}

function normalizeSoft(
  env: Float64Array,
  noiseWindowSec: number,
  sampleRate: number,
): Float64Array {
  const n = env.length;
  const win = Math.max(3, Math.round(noiseWindowSec * sampleRate));
  const pre = Math.max(1, Math.floor(win / 8));

  const smoothed   = movingAverage(env, pre);
  const noiseFloor = slidingMin(smoothed, win);

  // Median of noise floor
  const medianNoise = percentile(noiseFloor, 50);
  const signalLevel = percentile(env, 90);

  let denom = signalLevel - medianNoise;
  if (denom < 1e-10) {
    denom = Math.max(stddev(env), 1e-10);
  }

  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = (env[i] - medianNoise) / denom;
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Channel 0: mid40 — MidIQEnvelopePipeline
// ---------------------------------------------------------------------------

function computeMid40(
  audio: Float64Array,
  toneHz: number,
): Float64Array {
  const lpSOS = butterworthLowpass(6, 40, SAMPLE_RATE);
  const { I, Q } = iqMix(audio, toneHz, SAMPLE_RATE);
  const If = sosfiltfilt(lpSOS, I);
  const Qf = sosfiltfilt(lpSOS, Q);

  const env = new Float64Array(audio.length);
  for (let i = 0; i < env.length; i++) {
    env[i] = Math.sqrt(If[i] * If[i] + Qf[i] * Qf[i]);
  }

  const env500 = stridePool16(env);
  const normEnv500 = new Float64Array(env500.length);
  for (let i = 0; i < env500.length; i++) normEnv500[i] = env500[i];

  return normalizeSoft(normEnv500, 2.0, OUTPUT_RATE);
}

// ---------------------------------------------------------------------------
// Channel 1: phase50 — PhaseCoherencePipeline (50ms window at 8kHz)
// ---------------------------------------------------------------------------

function computePhase50(
  audio: Float64Array,
  toneHz: number,
): Float64Array {
  const lpSOS = butterworthLowpass(6, 75, SAMPLE_RATE);
  const { I, Q } = iqMix(audio, toneHz, SAMPLE_RATE);
  const If = sosfiltfilt(lpSOS, I);
  const Qf = sosfiltfilt(lpSOS, Q);

  const n = audio.length;
  const phase = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    phase[i] = Math.atan2(Qf[i], If[i]);
  }

  // 50ms window moving average of cos(phase) and sin(phase)
  const winSamples = Math.max(3, Math.round(0.05 * SAMPLE_RATE)); // 50ms
  const cosPhase = new Float64Array(n);
  const sinPhase = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    cosPhase[i] = Math.cos(phase[i]);
    sinPhase[i] = Math.sin(phase[i]);
  }

  // Simple causal moving average (matches _moving_average_compensated in Python)
  const meanCos = movingAverage(cosPhase, winSamples);
  const meanSin = movingAverage(sinPhase, winSamples);

  const R = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    R[i] = Math.sqrt(meanCos[i] * meanCos[i] + meanSin[i] * meanSin[i]);
  }

  const R500 = stridePool16(R);
  return normalizeSoft(R500, 2.0, OUTPUT_RATE);
}

// ---------------------------------------------------------------------------
// Channel 2: stft2048 — STFTSubbandPipeline
// ---------------------------------------------------------------------------

/**
 * Radix-2 Cooley-Tukey FFT (in-place, power-of-2 length).
 * Returns complex array [re0, im0, re1, im1, ...].
 */
function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  // Bit-reversal permutation
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  // FFT butterfly
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k]           = uRe + vRe;
        im[i + k]           = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

function computeSTFT2048(
  audio: Float64Array,
  toneHz: number,
): Float64Array {
  const winSize = 2048;
  const hop     = 16;
  const nFFT    = winSize;
  // Match scipy.signal.stft(..., boundary='zeros'): prepend nFFT/2 zeros so
  // that frame k is centered at original sample k*hop (not k*hop + nFFT/2).
  const BOUNDARY_PAD = nFFT / 2; // 1024

  // Pre-compute Hann window
  const hann = new Float64Array(winSize);
  for (let i = 0; i < winSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (winSize - 1)));
  }

  // Frequency resolution: df = sampleRate / nFFT
  const df = SAMPLE_RATE / nFFT;
  const halfBw   = 15;  // ±15 Hz
  const refOffset = 60; // reference bins ±60 Hz from tone

  // Determine which bins to include for each subband
  const toneLoIdx   = Math.floor((toneHz - halfBw)   / df);
  const toneHiIdx   = Math.ceil( (toneHz + halfBw)   / df);
  const loRefLoIdx  = Math.floor((toneHz - refOffset - halfBw) / df);
  const loRefHiIdx  = Math.ceil( (toneHz - refOffset + halfBw) / df);
  const hiRefLoIdx  = Math.floor((toneHz + refOffset - halfBw) / df);
  const hiRefHiIdx  = Math.ceil( (toneHz + refOffset + halfBw) / df);

  const clampBin = (idx: number) => Math.max(0, Math.min(nFFT / 2, idx));

  const toneLo = clampBin(toneLoIdx);
  const toneHi = clampBin(toneHiIdx);
  const loRefLo = clampBin(loRefLoIdx);
  const loRefHi = clampBin(loRefHiIdx);
  const hiRefLo = clampBin(hiRefLoIdx);
  const hiRefHi = clampBin(hiRefHiIdx);

  const n_orig = audio.length;
  // Output frames aligned with stride-16 IQ channels: floor(n_orig / hop)
  const nFrames = Math.floor(n_orig / hop);
  // Padded audio: 1024 zeros + original signal
  const n_pad = n_orig + BOUNDARY_PAD;

  const onTone = new Float64Array(nFrames);
  const loRef  = new Float64Array(nFrames);
  const hiRef  = new Float64Array(nFrames);

  const reArr = new Float64Array(nFFT);
  const imArr = new Float64Array(nFFT);

  for (let frame = 0; frame < nFrames; frame++) {
    const start = frame * hop; // index into padded signal

    // Fill windowed frame (padded signal: indices [0, BOUNDARY_PAD) = 0,
    // indices [BOUNDARY_PAD, n_pad) = original audio[0..n_orig-1])
    for (let k = 0; k < nFFT; k++) {
      const srcIdx = start + k;
      let sample = 0;
      if (srcIdx >= BOUNDARY_PAD && srcIdx < n_pad) {
        sample = audio[srcIdx - BOUNDARY_PAD];
      }
      reArr[k] = sample * hann[k];
      imArr[k] = 0;
    }

    fftInPlace(reArr, imArr);

    // Compute bin magnitudes and average within subbands
    const avgBins = (lo: number, hi: number): number => {
      if (lo >= hi) return 0;
      let sum = 0;
      for (let b = lo; b <= hi; b++) {
        const mag = Math.sqrt(reArr[b] * reArr[b] + imArr[b] * imArr[b]);
        sum += mag;
      }
      return sum / (hi - lo + 1);
    };

    onTone[frame] = avgBins(toneLo, toneHi);
    loRef[frame]  = avgBins(loRefLo, loRefHi);
    hiRef[frame]  = avgBins(hiRefLo, hiRefHi);
  }

  // Spectral contrast
  const contrast = new Float64Array(nFrames);
  for (let i = 0; i < nFrames; i++) {
    const noiseRef = (loRef[i] + hiRef[i]) / 2 + 1e-9;
    contrast[i] = onTone[i] / noiseRef;
  }

  return normalizeSoft(contrast, 2.0, OUTPUT_RATE);
}

// ---------------------------------------------------------------------------
// Channel 3: autocorr_v11 — AutocorrelationCarrierPipeline
// ---------------------------------------------------------------------------

/** numpy sinc: sin(π*x)/(π*x), sinc(0)=1 */
function sinc(x: number): number {
  if (Math.abs(x) < 1e-12) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

function computeAutocorrV11(
  audio: Float64Array,
  toneHz: number,
): Float64Array {
  const bpSOS = butterworthBandpass(4, toneHz, 75, SAMPLE_RATE);
  const x = sosfiltfilt(bpSOS, audio);

  const n = x.length;
  const lag = Math.max(1, Math.round(SAMPLE_RATE / toneHz));
  const winSamples = Math.max(lag * 2, Math.round(0.04 * SAMPLE_RATE)); // 40ms

  const xn = x.subarray(0, n - lag);
  const xl = x.subarray(lag);
  const m  = xn.length;

  // Sliding cross-correlation and autocorrelations using prefix sums
  // For sliding window of size winSamples:
  const halfWin = Math.floor(winSamples / 2);

  // Build prefix sums for sc = xn*xl, sa = xn², sb = xl²
  const sc = new Float64Array(m);
  const sa = new Float64Array(m);
  const sb = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    sc[i] = xn[i] * xl[i];
    sa[i] = xn[i] * xn[i];
    sb[i] = xl[i] * xl[i];
  }

  const acorrFull = new Float64Array(m);

  // Use prefix sum approach for sliding window
  const prefSC = new Float64Array(m + 1);
  const prefSA = new Float64Array(m + 1);
  const prefSB = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) {
    prefSC[i + 1] = prefSC[i] + sc[i];
    prefSA[i + 1] = prefSA[i] + sa[i];
    prefSB[i + 1] = prefSB[i] + sb[i];
  }

  for (let i = 0; i < m; i++) {
    const lo = Math.max(0, i - halfWin);
    const hi = Math.min(m, i + halfWin + 1);
    const sumSC = prefSC[hi] - prefSC[lo];
    const sumSA = prefSA[hi] - prefSA[lo];
    const sumSB = prefSB[hi] - prefSB[lo];
    const denom = Math.sqrt(sumSA * sumSB);
    acorrFull[i] = denom < 1e-12 ? 0 : sumSC / denom;
  }

  // Noise bias correction with integer-lag cosine correction (v12).
  // The true on-key correlation at lag L is cos(2π·f0·L/sr), not 1.0.
  // Without the cosine factor, frequencies like 700 Hz (lag=11, T=11.43)
  // have a smaller scale denominator and ~1.6× worse channel SNR than 650 Hz.
  // Must match data/dsp.py AutocorrelationCarrierPipeline exactly.
  const cosAtLag = Math.cos(2 * Math.PI * toneHz * lag / SAMPLE_RATE);
  const noiseR = cosAtLag * sinc(2.0 * 75 / toneHz);
  const scale  = Math.max(cosAtLag - noiseR, 1e-3);

  const envFull = new Float64Array(n);
  for (let i = 0; i < m; i++) {
    const v = (acorrFull[i] - noiseR) / scale;
    envFull[i] = v < 0 ? 0 : v;
  }
  // Pad tail
  const lastVal = m > 0 ? envFull[m - 1] : 0;
  for (let i = m; i < n; i++) envFull[i] = lastVal;

  const env500 = stridePool16(envFull);
  return normalizeSoft(env500, 2.0, OUTPUT_RATE);
}

// ---------------------------------------------------------------------------
// Channel 4: phase_instfreq — PhaseInstFreqPipeline (20ms window)
// ---------------------------------------------------------------------------

function computePhaseInstFreq(
  audio: Float64Array,
  toneHz: number,
): Float64Array {
  const lpSOS = butterworthLowpass(6, 75, SAMPLE_RATE);
  const { I, Q } = iqMix(audio, toneHz, SAMPLE_RATE);
  const If = sosfiltfilt(lpSOS, I);
  const Qf = sosfiltfilt(lpSOS, Q);

  const n = audio.length;

  // Instantaneous phase
  const phase = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    phase[i] = Math.atan2(Qf[i], If[i]);
  }

  // Wrapped phase derivative: dphi[i] = angle(exp(j*(phase[i]-phase[i-1])))
  const dphi = new Float64Array(n);
  dphi[0] = 0;
  for (let i = 1; i < n; i++) {
    let d = phase[i] - phase[i - 1];
    // Wrap to [-π, π]
    while (d >  Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    dphi[i] = d;
  }

  // Rolling variance of dphi over 20ms window
  const winSamples = Math.max(3, Math.round(0.02 * SAMPLE_RATE)); // 20ms

  // Compute rolling mean and mean-of-squares, then var = mean(x²) - mean(x)²
  const meanDP  = movingAverage(dphi, winSamples);
  const dphi2   = new Float64Array(n);
  for (let i = 0; i < n; i++) dphi2[i] = dphi[i] * dphi[i];
  const meanDP2 = movingAverage(dphi2, winSamples);

  const stability = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const varDp = Math.max(0, meanDP2[i] - meanDP[i] * meanDP[i]);
    stability[i] = Math.exp(-varDp * 2.0);
  }

  const stab500 = stridePool16(stability);
  return normalizeSoft(stab500, 2.0, OUTPUT_RATE);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Compute the 5-channel v11 DSP feature matrix from 8kHz PCM audio.
 *
 * Returns a row-major Float32Array of shape (T, 5), where T is the number
 * of 500Hz output frames. Access: features[t * 5 + ch].
 */
export function computeV11Features(
  audio: Float32Array,
  sampleRate: number,
  toneFreqHz: number,
): DspResult {
  if (sampleRate !== SAMPLE_RATE) {
    throw new Error(`computeV11Features requires sampleRate=8000, got ${sampleRate}`);
  }

  // Convert to Float64 for numerical precision
  const audio64 = new Float64Array(audio.length);
  for (let i = 0; i < audio.length; i++) audio64[i] = audio[i];

  // Compute all 5 channels
  const ch0 = computeMid40(audio64, toneFreqHz);
  const ch1 = computePhase50(audio64, toneFreqHz);
  const ch2 = computeSTFT2048(audio64, toneFreqHz);
  const ch3 = computeAutocorrV11(audio64, toneFreqHz);
  const ch4 = computePhaseInstFreq(audio64, toneFreqHz);

  // All channels should be at 500Hz. Use the minimum length for safety.
  const T = Math.min(ch0.length, ch1.length, ch2.length, ch3.length, ch4.length);

  const features = new Float32Array(T * 5);
  for (let t = 0; t < T; t++) {
    features[t * 5 + 0] = ch0[t];
    features[t * 5 + 1] = ch1[t];
    features[t * 5 + 2] = ch2[t];
    features[t * 5 + 3] = ch3[t];
    features[t * 5 + 4] = ch4[t];
  }

  return { features, frames: T };
}
