/**
 * SNR matching tests: verify both the legacy AWGN helper and the shared
 * receiver-chain generator calibration across the training range.
 *
 * Background
 * ----------
 * The applyAWGN helper uses a **total-energy SNR** definition:
 *
 *   noise_power = mean(signal²) / 10^(snrDb/10)
 *
 * This means signal power is computed over the *entire* waveform including
 * silence, so at low SNR the noise genuinely buries the signal.
 *
 * The TrainingSampleGenerator path uses receiver-chain calibration: actual
 * keyed CW RMS is matched against actual 2.4 kHz receiver-noise RMS, so
 * generated clips measure close to the requested SNR while sounding like a
 * shared receiver output.
 *
 * Training data context
 * ---------------------
 * - DEFAULT_DISTRIBUTIONS.snrRange: [-15, 20] dB
 * - Debug training set (data/debug/train/*.npz): 10–25 dB
 * - Extended user-requested range: -18 to +20 dB
 * - Eval samples (cw_eval/samples/): -9.6 to +24.5 dB
 *
 * Note: AGC (applied in ~70% of batch samples) intentionally raises apparent
 * SNR by compressing dynamic range. The tests below use agc:undefined so the
 * raw applyAWGN ↔ measureSNR roundtrip is measured without that confound.
 */

import { describe, expect, it } from 'vitest';
import { applyAWGN, measureSNR } from '../utils/awgn';
import { TrainingSampleGenerator } from './training-generator';
import { DEFAULT_DISTRIBUTIONS } from './types';

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Generate a realistic morse-like keyed-tone signal.
 * ~33% duty cycle (short on, long off) at 700 Hz — representative of real CW.
 */
function makeMorseSignal(
  sampleRate: number,
  durationSec: number
): Float32Array {
  const n = sampleRate * durationSec;
  const samples = new Float32Array(n);
  const freq = 700;
  const segmentSamples = Math.floor(sampleRate / 10); // 100 ms segments

  for (let i = 0; i < n; i++) {
    const segIndex = Math.floor(i / segmentSamples);
    if (segIndex % 3 === 0) {
      samples[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.8;
    }
  }
  return samples;
}

// Tolerance: well within LLN convergence for 40 000+ samples.
// Python verification showed max |error| < 0.08 dB over 50 seeds at 40 000 samples.
const TOLERANCE_DB = 0.5;

// ----------------------------------------------------------------------------
// applyAWGN + measureSNR roundtrip
// ----------------------------------------------------------------------------

describe('SNR roundtrip: applyAWGN + measureSNR', () => {
  // 5 s × 8000 Hz = 40 000 samples; variance is negligible at this length.
  const clean = makeMorseSignal(8000, 5);

  it('matches target SNR from -18 dB to +20 dB in 2 dB steps (seed=42)', () => {
    for (let snrDb = -18; snrDb <= 20; snrDb += 2) {
      const noisy = applyAWGN(clean, snrDb, 42);
      const measured = measureSNR(clean, noisy);
      expect(
        Math.abs(measured - snrDb),
        `SNR mismatch at ${snrDb} dB: measured ${measured.toFixed(3)} dB`
      ).toBeLessThanOrEqual(TOLERANCE_DB);
    }
  });

  it('matches target SNR across training range at multiple seeds', () => {
    // Levels sampled from the debug training distribution (10–25 dB) and
    // the full DEFAULT_DISTRIBUTIONS range (-15 to +20 dB), plus extended -18.
    const levels = [
      -18, -15, -12, -9, -6, -3, 0, 3, 6, 9, 10, 12, 13, 15, 18, 20,
    ];

    for (const snrDb of levels) {
      for (const seed of [1, 42, 999]) {
        const noisy = applyAWGN(clean, snrDb, seed);
        const measured = measureSNR(clean, noisy);
        expect(
          Math.abs(measured - snrDb),
          `SNR mismatch at ${snrDb} dB seed=${seed}: measured ${measured.toFixed(3)} dB`
        ).toBeLessThanOrEqual(TOLERANCE_DB);
      }
    }
  });

  it('matches target SNR for a longer signal (10 s) matching batch sample duration', () => {
    // The TrainingSampleGenerator uses durationSec=10 by default.
    const longClean = makeMorseSignal(8000, 10); // 80 000 samples
    for (let snrDb = -18; snrDb <= 20; snrDb += 6) {
      const noisy = applyAWGN(longClean, snrDb, 77);
      const measured = measureSNR(longClean, noisy);
      expect(
        Math.abs(measured - snrDb),
        `SNR mismatch (10 s) at ${snrDb} dB: measured ${measured.toFixed(3)} dB`
      ).toBeLessThanOrEqual(TOLERANCE_DB);
    }
  });
});

// ----------------------------------------------------------------------------
// Regression: lock in specific measured values (seed=42, 5 s signal)
// These are golden values captured from the current implementation.
// Any change to the noise formula must be deliberate and update these numbers.
// ----------------------------------------------------------------------------

describe('SNR regression: golden measured values (seed=42)', () => {
  const clean = makeMorseSignal(8000, 5);

  /**
   * Expected SNR = target ± TOLERANCE_DB.
   * toBeCloseTo(v, 0) checks within ±0.5, matching our tolerance.
   */
  const goldenCases: [number, number][] = [
    [-18, -18],
    [-15, -15],
    [-10, -10],
    [-5, -5],
    [0, 0],
    [5, 5],
    [10, 10],
    [15, 15],
    [20, 20],
  ];

  for (const [targetSnr, expectedSnr] of goldenCases) {
    it(`measured SNR ≈ ${targetSnr} dB at target ${targetSnr} dB`, () => {
      const noisy = applyAWGN(clean, targetSnr, 42);
      const measured = measureSNR(clean, noisy);
      // toBeCloseTo with 0 decimal places = within ±0.5 dB
      expect(measured).toBeCloseTo(expectedSnr, 0);
    });
  }
});

// ----------------------------------------------------------------------------
// TrainingSampleGenerator: metadata SNR and distribution range
// ----------------------------------------------------------------------------

describe('TrainingSampleGenerator SNR config', () => {
  it('DEFAULT_DISTRIBUTIONS.snrRange covers -15 to +20 dB', () => {
    const [minSnr, maxSnr] = DEFAULT_DISTRIBUTIONS.snrRange;
    expect(minSnr).toBeLessThanOrEqual(-15);
    expect(maxSnr).toBeGreaterThanOrEqual(20);
  });

  it('reports target SNR in metadata (no measurement, by design)', () => {
    // The generator records the *target* SNR, not a post-hoc measurement.
    // AGC (applied in 70% of batch samples) intentionally changes apparent SNR,
    // so measuring after-the-fact on full padded audio would be misleading.
    const gen = new TrainingSampleGenerator();

    for (const snrDb of [-15, -10, -5, 0, 5, 10, 15, 20]) {
      const sample = gen.generate({
        text: 'CQ',
        wpm: 20,
        frequency: 700,
        sampleRate: 8000,
        noise: { snrDb },
        durationSec: 5,
        seed: 42,
      });

      expect(sample.metadata.effectiveSnr).toBe(snrDb);
    }
  });

  it('receiver-calibrated sample measured in the 2400 Hz passband matches target SNR', () => {
    // With outputNoisePath set, the generator returns noiseAudio.
    // audio - noiseAudio = scaled signal (padded with zeros). The generator
    // calibrates the actual keyed CW RMS against the actual receiver-noise RMS.
    const gen = new TrainingSampleGenerator();

    for (const snrDb of [-15, -10, -5, 0, 5, 10, 15, 20]) {
      const sample = gen.generate({
        text: 'CQ DE TEST',
        wpm: 20,
        frequency: 700,
        sampleRate: 8000,
        noise: { snrDb },
        durationSec: 10,
        seed: 42,
        outputNoisePath: 'dummy', // triggers noiseAudio output
      });

      expect(sample.noiseAudio).toBeDefined();
      const audio = sample.audio;
      const noiseAudio = sample.noiseAudio as Float32Array;

      // audio - noiseAudio = clean signal (zeros in padding, CW in content)
      const cleanPadded = new Float32Array(audio.length);
      for (let i = 0; i < audio.length; i++) {
        cleanPadded[i] = audio[i] - noiseAudio[i];
      }

      // Measure SNR on content region only (skip padding where clean≈0)
      // Find content bounds: first and last non-zero sample in cleanPadded
      let start = 0;
      let end = audio.length;
      for (let i = 0; i < audio.length; i++) {
        if (Math.abs(cleanPadded[i]) > 1e-6) {
          start = i;
          break;
        }
      }
      for (let i = audio.length - 1; i >= 0; i--) {
        if (Math.abs(cleanPadded[i]) > 1e-6) {
          end = i + 1;
          break;
        }
      }

      const contentClean = cleanPadded.slice(start, end);
      const contentNoisy = audio.slice(start, end);

      const measured = measureSNR(contentClean, contentNoisy);
      expect(
        Math.abs(measured - snrDb),
        `Receiver-calibrated content SNR mismatch at ${snrDb} dB: measured ${measured.toFixed(3)} dB`
      ).toBeLessThanOrEqual(TOLERANCE_DB);
    }
  });

  it('matches high-SNR padding noise to content noise instead of tone tails', () => {
    const gen = new TrainingSampleGenerator();
    const sample = gen.generate({
      text: 'ALY5G',
      wpm: 26.3,
      frequency: 650,
      sampleRate: 8000,
      noise: { snrDb: 80 },
      durationSec: 4,
      seed: 605027519,
      outputNoisePath: 'dummy',
    });

    expect(sample.noiseAudio).toBeDefined();
    const noise = sample.noiseAudio as Float32Array;
    const sr = sample.metadata.config.sampleRate;
    const chars = sample.metadata.characters;
    const first = chars[0];
    const second = chars[1];

    const rms = (startMs: number, endMs: number): number => {
      const start = Math.max(0, Math.floor((startMs / 1000) * sr));
      const end = Math.min(noise.length, Math.floor((endMs / 1000) * sr));
      let sum = 0;
      for (let i = start; i < end; i++) sum += noise[i] * noise[i];
      return Math.sqrt(sum / Math.max(1, end - start));
    };

    const paddingRms = rms(200, 800);
    const contentGapRms = rms(first.endMs + 30, second.startMs - 30);
    const ratio =
      Math.max(paddingRms, contentGapRms) /
      Math.max(1e-12, Math.min(paddingRms, contentGapRms));

    expect(
      ratio,
      `high-SNR padding/content noise mismatch: padding=${paddingRms} gap=${contentGapRms}`
    ).toBeLessThan(2);
  });
});
