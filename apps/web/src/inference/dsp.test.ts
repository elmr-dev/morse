// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Tests for the 4-channel DSP pipeline.
//
// Strategy: synthesize a known CW tone in pure JS (no browser AudioContext),
// run extractEnvelope, assert shape and per-channel behavior. Doesn't touch
// ONNX — that's covered in onnx.test.ts.

import { describe, expect, it } from 'vitest';
import { IN_CHANNELS } from './constants';
import {
  DECIMATION,
  DSP_SAMPLE_RATE,
  ENVELOPE_SR,
  extractEnvelope,
  reflectIdx,
} from './dsp';

// Synthesize 8 kHz mono audio with a single keyed tone (one dah at the
// requested freq, surrounded by silence). Returns Float64Array.
function synthesizeKeyedTone(opts: {
  durationSec: number;
  toneFreq: number;
  keyOnSec: number;
  keyOffSec: number;
  amplitude?: number;
  noiseAmp?: number;
  sampleRate?: number;
}): Float64Array {
  const sr = opts.sampleRate ?? DSP_SAMPLE_RATE;
  const n = Math.floor(opts.durationSec * sr);
  const out = new Float64Array(n);
  const amp = opts.amplitude ?? 0.5;
  const onStart = Math.floor(opts.keyOnSec * sr);
  const onEnd = Math.floor(opts.keyOffSec * sr);
  const noiseAmp = opts.noiseAmp ?? 0;
  // Cheap deterministic LCG (don't pollute Math.random).
  let s = 0xdeadbeef;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const noise = noiseAmp ? noiseAmp * (s / 0xffffffff - 0.5) * 2 : 0;
    if (i >= onStart && i < onEnd) {
      out[i] = amp * Math.sin((2 * Math.PI * opts.toneFreq * i) / sr) + noise;
    } else {
      out[i] = noise;
    }
  }
  return out;
}

describe('reflectIdx — scipy mode="reflect" boundary', () => {
  // scipy mode='reflect' (half-sample symmetric): the edge sample IS duplicated
  // across the boundary. Extension for n=5 [a,b,c,d,e]:
  //   (e d c b a | a b c d e | e d c b a ...)  period = 2*n = 10
  //
  // Reference values verified against scipy.ndimage for n=5.
  const n = 5;
  const cases: [number, number][] = [
    // interior — identity
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    // right boundary: edge (4) is duplicated
    [5, 4],
    [6, 3],
    [7, 2],
    [8, 1],
    [9, 0],
    // second period right
    [10, 0],
    [11, 1],
    // left boundary: edge (0) is duplicated (reflect, not mirror)
    [-1, 0],
    [-2, 1],
    [-3, 2],
    [-4, 3],
    [-5, 4],
    // multi-period left
    [-10, 0],
    [-11, 0],
  ];
  for (const [i, expected] of cases) {
    it(`reflectIdx(${i}, ${n}) === ${expected}`, () => {
      expect(reflectIdx(i, n)).toBe(expected);
    });
  }

  it('n=1 always returns 0', () => {
    expect(reflectIdx(-5, 1)).toBe(0);
    expect(reflectIdx(0, 1)).toBe(0);
    expect(reflectIdx(3, 1)).toBe(0);
  });
});

describe('extractEnvelope', () => {
  const TONE_FREQ = 700;
  const DUR_SEC = 2.0;
  // Keyed from 0.5s to 1.5s — a dah-like burst.
  const KEY_ON = 0.5;
  const KEY_OFF = 1.5;

  it('returns 4 channels at the envelope rate', () => {
    const audio = synthesizeKeyedTone({
      durationSec: DUR_SEC,
      toneFreq: TONE_FREQ,
      keyOnSec: KEY_ON,
      keyOffSec: KEY_OFF,
    });
    const env = extractEnvelope(audio, DSP_SAMPLE_RATE, TONE_FREQ);
    expect(env).toBeInstanceOf(Float32Array);
    const expectedT = Math.floor(audio.length / DECIMATION);
    expect(env.length).toBe(expectedT * IN_CHANNELS);
    expect(IN_CHANNELS).toBe(4); // catch a stale constant if someone changes it
  });

  it('produces values in [0, 1]', () => {
    const audio = synthesizeKeyedTone({
      durationSec: DUR_SEC,
      toneFreq: TONE_FREQ,
      keyOnSec: KEY_ON,
      keyOffSec: KEY_OFF,
    });
    const env = extractEnvelope(audio, DSP_SAMPLE_RATE, TONE_FREQ);
    let lo = Infinity,
      hi = -Infinity;
    for (let i = 0; i < env.length; i++) {
      if (env[i] < lo) lo = env[i];
      if (env[i] > hi) hi = env[i];
    }
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(1);
  });

  it('all four channels fire on tone-on frames', () => {
    const audio = synthesizeKeyedTone({
      durationSec: DUR_SEC,
      toneFreq: TONE_FREQ,
      keyOnSec: KEY_ON,
      keyOffSec: KEY_OFF,
    });
    const env = extractEnvelope(audio, DSP_SAMPLE_RATE, TONE_FREQ);
    const T = env.length / IN_CHANNELS;

    // Compare mean envelope value during keyed window vs silence.
    const onStartFrame = Math.floor(KEY_ON * ENVELOPE_SR);
    const onEndFrame = Math.floor(KEY_OFF * ENVELOPE_SR);
    // Skip 100 ms after key-on for filter rise; sample inside the steady-on plateau.
    const sampleStart = onStartFrame + Math.floor(0.1 * ENVELOPE_SR);
    const sampleEnd = onEndFrame - Math.floor(0.1 * ENVELOPE_SR);

    for (let ch = 0; ch < IN_CHANNELS; ch++) {
      let onSum = 0,
        onN = 0;
      let offSum = 0,
        offN = 0;
      for (let t = 0; t < T; t++) {
        const v = env[t * IN_CHANNELS + ch];
        if (t >= sampleStart && t < sampleEnd) {
          onSum += v;
          onN++;
        } else if (
          t < onStartFrame - Math.floor(0.1 * ENVELOPE_SR) ||
          t > onEndFrame + Math.floor(0.1 * ENVELOPE_SR)
        ) {
          offSum += v;
          offN++;
        }
      }
      const onMean = onSum / onN;
      const offMean = offSum / offN;
      // Each channel should clearly distinguish tone-on from silence.
      // Use a generous threshold (0.2) — the percentile normalize means
      // even weakly-discriminating channels show meaningful separation.
      expect(
        onMean - offMean,
        `ch${ch}: on=${onMean.toFixed(3)} off=${offMean.toFixed(3)}`
      ).toBeGreaterThan(0.2);
    }
  });

  it('long-MF channel (ch3) has slower rise than short-MF (ch2)', () => {
    // The 200ms long matched filter integrates over more of the
    // post-onset window, so its rise edge should be slower than the
    // 48ms one. Check by measuring the first frame each channel
    // exceeds 0.5 after the key-on moment.
    const audio = synthesizeKeyedTone({
      durationSec: DUR_SEC,
      toneFreq: TONE_FREQ,
      keyOnSec: KEY_ON,
      keyOffSec: KEY_OFF,
    });
    const env = extractEnvelope(audio, DSP_SAMPLE_RATE, TONE_FREQ);
    const T = env.length / IN_CHANNELS;
    const onStartFrame = Math.floor(KEY_ON * ENVELOPE_SR);

    function firstFrameAbove(ch: number, threshold: number): number {
      for (let t = onStartFrame; t < T; t++) {
        if (env[t * IN_CHANNELS + ch] > threshold) return t;
      }
      return T;
    }
    const tCh2 = firstFrameAbove(2, 0.5);
    const tCh3 = firstFrameAbove(3, 0.5);
    // ch3 (200ms) should rise no earlier than ch2 (48ms). They might
    // tie due to percentile-normalize bringing them similar, but ch3
    // strictly later under matched-filter physics.
    expect(tCh3).toBeGreaterThanOrEqual(tCh2);
  });

  it('extracts envelope at expected rate', () => {
    const audio = synthesizeKeyedTone({
      durationSec: 1.0,
      toneFreq: TONE_FREQ,
      keyOnSec: 0.2,
      keyOffSec: 0.4,
    });
    const env = extractEnvelope(audio, DSP_SAMPLE_RATE, TONE_FREQ);
    const T = env.length / IN_CHANNELS;
    // 1 second at 8000 Hz / 16 = 500 frames at 500 Hz envelope rate.
    expect(T).toBe(ENVELOPE_SR);
  });

  it('rejects non-DSP-rate audio', () => {
    const audio = new Float64Array(8000);
    expect(() => extractEnvelope(audio, 16000, TONE_FREQ)).toThrow(/8000/);
  });
});
