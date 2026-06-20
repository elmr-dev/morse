// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Decode-regression gate for the RBJ→Butterworth bandpass switch.
//
// For each fixture clip we build TWO 4-channel envelopes that differ ONLY in
// the bandpass stage feeding ch0/ch1 — one with the old RBJ biquad+filtfilt
// and one with the current Butterworth sosfiltfilt — then push both through
// the SAME ONNX model and the SAME CTC decode. ch2/ch3 (matched filters) are
// shared between both envelopes and computed once.
//
// Gate: the Butterworth decode's character-error rate per clip must be ≤ the
// RBJ decode's, with a small slack budget for tied outputs. A full table of
// `old → new` decoded text is printed so the diff is auditable at review time.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ort from 'onnxruntime-node';
import { describe, expect, it } from 'vitest';
import { IN_CHANNELS, NUM_CLASSES } from './constants';
import { greedyDecode } from './decode';
import {
  DSP_SAMPLE_RATE,
  decimate,
  ENVELOPE_SR,
  extractEnvelope,
  gaussianFilter1d,
  hilbertMag,
  percentileNormalize,
  sharpen,
  uniformFilter1d,
} from './dsp';
import { MAX_FRAMES } from './onnx';

const MODEL_PATH = resolve(__dirname, '../../public/model/cw_model_full.onnx');
let _session: ort.InferenceSession | null = null;
async function getSession(): Promise<ort.InferenceSession> {
  if (!_session) {
    _session = await ort.InferenceSession.create(readFileSync(MODEL_PATH), {
      executionProviders: ['cpu'],
    });
  }
  return _session;
}

const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/dsp');

interface ClipManifest {
  id: string;
  text: string;
  wpm: number;
  snr_db: number;
  tone_freq_hz: number;
  input_wav: string;
}
interface Index {
  clips: ClipManifest[];
}

function loadIndex(): Index {
  return JSON.parse(readFileSync(resolve(FIXTURE_DIR, 'index.json'), 'utf8'));
}

function readWavPcm16Mono(path: string): Float32Array {
  const buf = readFileSync(path);
  let pos = 12;
  let dataOffset = -1;
  let dataLen = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.slice(pos, pos + 4).toString('ascii');
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'data') {
      dataOffset = pos + 8;
      dataLen = size;
      break;
    }
    pos += 8 + size + (size & 1);
  }
  if (dataOffset < 0) throw new Error(`${path}: no data chunk`);
  const n = dataLen >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = buf.readInt16LE(dataOffset + i * 2) / 32768;
  }
  return out;
}

// ----- old RBJ bandpass (pasted from pre-fix dsp.ts; for regression only) -----
function rbjBandpass(
  audio: Float64Array,
  fs: number,
  f0: number,
  halfBw: number
): Float64Array {
  const bw = 2 * halfBw;
  const w0 = (2 * Math.PI * f0) / fs;
  const cosW = Math.cos(w0);
  const sinW = Math.sin(w0);
  const Q = f0 / bw;
  const alpha = sinW / (2 * Q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b1 = 0;
  const b2 = -alpha / a0;
  const a1 = (-2 * cosW) / a0;
  const a2 = (1 - alpha) / a0;
  const biq = (x: Float64Array): Float64Array => {
    const out = new Float64Array(x.length);
    let x1 = 0,
      x2 = 0,
      y1 = 0,
      y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const y = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x[i];
      y2 = y1;
      y1 = y;
      out[i] = y;
    }
    return out;
  };
  const fwd = biq(audio);
  const rev = new Float64Array(fwd.length);
  for (let i = 0; i < fwd.length; i++) rev[i] = fwd[fwd.length - 1 - i];
  const back = biq(rev);
  const out = new Float64Array(back.length);
  for (let i = 0; i < back.length; i++) out[i] = back[back.length - 1 - i];
  return out;
}

const DECIMATION = 16;
const TKEO_SMOOTH_MS = 30.0;
const MATCHED_MS = 48.0;
const LONG_MATCHED_MS = 200.0;
const SHARPEN_GAMMA = 8.0;
const BP_BW_HZ = 25.0;

function ch0Amplitude(bp: Float64Array, nOut: number): Float32Array {
  const mag = hilbertMag(bp);
  const smooth = gaussianFilter1d(mag, 4.0);
  const dec = decimate(smooth, DECIMATION).subarray(0, nOut) as Float64Array;
  let env = percentileNormalize(dec);
  const offset = 0.05,
    scale = 0.76;
  const tmp = new Float64Array(env.length);
  for (let i = 0; i < env.length; i++) {
    const v = (env[i] - offset) / scale;
    tmp[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  env = sharpen(tmp, SHARPEN_GAMMA);
  env = sharpen(env, SHARPEN_GAMMA);
  return Float32Array.from(env);
}
function chTkeo(bp: Float64Array, fs: number, nOut: number): Float32Array {
  const psi = new Float64Array(bp.length);
  for (let i = 1; i < bp.length - 1; i++) {
    const v = bp[i] * bp[i] - bp[i - 1] * bp[i + 1];
    psi[i] = v > 0 ? v : 0;
  }
  const win = Math.max(3, Math.round((TKEO_SMOOTH_MS / 1000) * fs));
  const smooth = uniformFilter1d(psi, win);
  const dec = decimate(smooth, DECIMATION).subarray(0, nOut) as Float64Array;
  return Float32Array.from(percentileNormalize(dec));
}
function chMatched(
  audio: Float64Array,
  fs: number,
  toneFreq: number,
  nOut: number,
  durationMs: number
): Float32Array {
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
  return Float32Array.from(percentileNormalize(dec));
}

function extractEnvelopeRbj(
  audio: Float32Array,
  toneFreq: number
): Float32Array {
  const audio64 = Float64Array.from(audio);
  const n = audio64.length;
  const nOut = Math.floor(n / DECIMATION);
  const loHz = Math.max(toneFreq - BP_BW_HZ, 1);
  const hiHz = Math.min(toneFreq + BP_BW_HZ, DSP_SAMPLE_RATE / 2 - 1);
  const center = (loHz + hiHz) / 2;
  const halfBw = (hiHz - loHz) / 2;
  const bp = rbjBandpass(audio64, DSP_SAMPLE_RATE, center, halfBw);
  const c0 = ch0Amplitude(bp, nOut);
  const c1 = chTkeo(bp, DSP_SAMPLE_RATE, nOut);
  const c2 = chMatched(audio64, DSP_SAMPLE_RATE, toneFreq, nOut, MATCHED_MS);
  const c3 = chMatched(
    audio64,
    DSP_SAMPLE_RATE,
    toneFreq,
    nOut,
    LONG_MATCHED_MS
  );
  const out = new Float32Array(nOut * 4);
  for (let i = 0; i < nOut; i++) {
    out[i * 4 + 0] = c0[i];
    out[i * 4 + 1] = c1[i];
    out[i * 4 + 2] = c2[i];
    out[i * 4 + 3] = c3[i];
  }
  return out;
}

async function decodeEnvelope(env: Float32Array): Promise<string> {
  const session = await getSession();
  const T = env.length / IN_CHANNELS;
  if (T > MAX_FRAMES)
    throw new Error(`envelope too long: ${T} > ${MAX_FRAMES}`);
  const padded = new Float32Array(MAX_FRAMES * IN_CHANNELS);
  padded.set(env, 0);
  const input = new ort.Tensor('float32', padded, [1, MAX_FRAMES, IN_CHANNELS]);
  const out = await session.run({ envelopes: input });
  const full = out.log_probs.data as Float32Array;
  const Tout = Math.floor(T / 2);
  const lp = new Float32Array(
    full.buffer,
    full.byteOffset,
    Tout * NUM_CLASSES
  ).slice();
  return greedyDecode(lp, Tout).text;
}

// Standard edit-distance CER.
function cer(a: string, b: string): number {
  if (!a && !b) return 0;
  const m = a.length,
    n = b.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] =
        a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n] / Math.max(a.length, b.length);
}

describe('decode regression — Butterworth vs old RBJ bandpass', () => {
  const index = loadIndex();
  // Bail out gracefully if the ONNX model file is missing (e.g. fresh checkout).
  it('runs decode on each clip and reports old → new', {
    timeout: 120_000,
  }, async () => {
    const rows: Array<{
      clip: string;
      truth: string;
      old: string;
      neu: string;
      cerOld: number;
      cerNew: number;
    }> = [];

    for (const clip of index.clips) {
      const audio = readWavPcm16Mono(resolve(FIXTURE_DIR, clip.input_wav));
      const envOld = extractEnvelopeRbj(audio, clip.tone_freq_hz);
      const envNew = extractEnvelope(audio, DSP_SAMPLE_RATE, clip.tone_freq_hz);
      const [textOld, textNew] = await Promise.all([
        decodeEnvelope(envOld),
        decodeEnvelope(envNew),
      ]);
      rows.push({
        clip: clip.id,
        truth: clip.text,
        old: textOld,
        neu: textNew,
        cerOld: cer(textOld, clip.text),
        cerNew: cer(textNew, clip.text),
      });
    }

    let summary = '\n[decode regression]\n';
    summary += `  ${'clip'.padEnd(24)}  ${'cer_old'.padStart(8)}  ${'cer_new'.padStart(8)}\n`;
    for (const r of rows) {
      summary += `  ${r.clip.padEnd(24)}  ${r.cerOld.toFixed(3).padStart(8)}  ${r.cerNew.toFixed(3).padStart(8)}\n`;
      summary += `    truth: ${r.truth}\n`;
      summary += `    old  : ${r.old}\n`;
      summary += `    new  : ${r.neu}\n`;
    }
    console.log(summary);

    // ENVELOPE_SR is the contract constant for the rate the table is computed at.
    expect(ENVELOPE_SR).toBe(500);

    // Gate: Butterworth must not regress vs RBJ. Allow a tiny slack
    // (0.01 absolute CER) for ties that are off-by-one due to the model
    // breaking symmetry between two near-identical envelopes.
    const SLACK = 0.01;
    const regressions = rows.filter((r) => r.cerNew > r.cerOld + SLACK);
    expect(
      regressions.map(
        (r) => `${r.clip}: cer ${r.cerOld.toFixed(3)} → ${r.cerNew.toFixed(3)}`
      ),
      'no clip should decode worse under Butterworth than under RBJ'
    ).toEqual([]);
  });
});
