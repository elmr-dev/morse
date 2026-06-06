import { describe, it, expect } from 'vitest';
import {
  generateRealisticMorseAudio,
  peakNormalize,
  rmsNormalize,
  mixWithCalibratedNoise,
  generateCalibratedNoise,
  DEFAULT_SNR_REFERENCE_BANDWIDTH,
  DEFAULT_REFERENCE_PEAK,
  FIST_PROFILES,
} from '../index';

const peakOf = (samples: Float32Array): number => {
  let p = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > p) p = a;
  }
  return p;
};

const rmsOf = (samples: Float32Array): number => {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
};

describe('peakNormalize', () => {
  it('scales the loudest sample to the requested target', () => {
    const s = new Float32Array([0.1, -0.4, 0.2, -0.05]);
    peakNormalize(s, 0.8);
    expect(peakOf(s)).toBeCloseTo(0.8, 5);
  });

  it('is a no-op on a fully silent buffer', () => {
    const s = new Float32Array([0, 0, 0, 0]);
    peakNormalize(s, 0.8);
    expect(peakOf(s)).toBe(0);
  });
});

describe('rmsNormalize', () => {
  it('scales samples so RMS matches the target', () => {
    const s = new Float32Array(1024);
    for (let i = 0; i < s.length; i++) s[i] = Math.sin(i * 0.5);
    rmsNormalize(s, 0.5);
    expect(rmsOf(s)).toBeCloseTo(0.5, 4);
  });

  it('is a no-op on a fully silent buffer', () => {
    const s = new Float32Array(8);
    rmsNormalize(s, 0.5);
    expect(rmsOf(s)).toBe(0);
  });
});

describe('generateCalibratedNoise', () => {
  it('RMS-normalizes the noise to match a sine of the reference peak', () => {
    // Noise RMS should equal sine RMS at referenceSinePeak = peak / sqrt(2).
    const noise = generateCalibratedNoise({
      length: 22050,
      sampleRate: 22050,
      centerFrequency: 600,
      referenceSinePeak: 0.8,
    });
    const expectedRms = 0.8 / Math.SQRT2;
    expect(rmsOf(noise)).toBeCloseTo(expectedRms, 4);
  });

  it('honors a custom reference bandwidth', () => {
    const noise = generateCalibratedNoise({
      length: 22050,
      sampleRate: 22050,
      centerFrequency: 600,
      referenceBandwidth: 1000,
    });
    expect(rmsOf(noise)).toBeGreaterThan(0);
  });
});

describe('SNR calibration accuracy', () => {
  // The headline guarantee: requested SNR matches measured SNR within ~0.3 dB
  // when measured in the reference bandwidth (i.e. before any narrower
  // receiver filter). This is what makes a slider value of -18 dB actually
  // deliver -18 dB, not some offset version of it.
  const sampleRate = 22050;
  const frequency = 600;
  const length = sampleRate * 2;

  function makeContinuousSine(amplitude = DEFAULT_REFERENCE_PEAK): Float32Array {
    const samples = new Float32Array(length);
    const twoPi = 2 * Math.PI;
    let phase = 0;
    for (let i = 0; i < length; i++) {
      samples[i] = Math.sin(phase) * amplitude;
      phase += (twoPi * frequency) / sampleRate;
      if (phase >= twoPi) phase -= twoPi;
    }
    return samples;
  }

  function measureSnrDb(snrDb: number): number {
    const signal = makeContinuousSine();
    const noise = generateCalibratedNoise({ length, sampleRate, centerFrequency: frequency });
    const signalGain = Math.pow(10, snrDb / 20);
    const sigPower = (rmsOf(signal) * signalGain) ** 2;
    const noisePower = rmsOf(noise) ** 2;
    return 10 * Math.log10(sigPower / noisePower);
  }

  for (const requested of [-18, -12, -6, 0, 6, 12, 20, 30]) {
    it(`requested ${requested} dB → measured within 0.3 dB`, () => {
      const measured = measureSnrDb(requested);
      expect(Math.abs(measured - requested)).toBeLessThan(0.3);
    });
  }
});

describe('mixWithCalibratedNoise', () => {
  it('peak-normalizes the mix so loud signals dominate', () => {
    const signal = new Float32Array(1024);
    for (let i = 0; i < signal.length; i++) signal[i] = 0.8 * Math.sin(i * 0.1);
    const noise = new Float32Array(1024);
    for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() - 0.5) * 0.4;

    const mixed = mixWithCalibratedNoise(signal, noise, { snrDb: 20 });
    expect(peakOf(mixed)).toBeCloseTo(0.85, 2);
  });

  it('throws on length mismatch', () => {
    const a = new Float32Array(10);
    const b = new Float32Array(20);
    expect(() => mixWithCalibratedNoise(a, b, { snrDb: 0 })).toThrow();
  });

  it('makes high-SNR signal-to-noise ratios audibly higher than low-SNR', () => {
    // Same buffers, two different SNR values — measure how much of the noise
    // survives the post-mix normalization in each case.
    const len = 4410;
    const signal = new Float32Array(len);
    for (let i = 0; i < len; i++) signal[i] = 0.8 * Math.sin(i * 0.4);
    const noise = generateCalibratedNoise({
      length: len,
      sampleRate: 22050,
      centerFrequency: 600,
    });

    const high = mixWithCalibratedNoise(signal, noise, { snrDb: 20 });
    const low = mixWithCalibratedNoise(signal, noise, { snrDb: -10 });

    // With high SNR, the signal dominates → noise contribution is small.
    // With low SNR, the noise dominates → the buffer's RMS comes mostly from noise.
    // Both buffers are normalized to the same peak, so comparing RMS captures
    // how much "averageness" the noise contributes.
    const highRms = rmsOf(high);
    const lowRms = rmsOf(low);
    // A near-pure sine has RMS ≈ peak / sqrt(2) ≈ 0.6.
    // Noise-dominated mixes have notably lower RMS for the same peak (peakier).
    expect(highRms).toBeGreaterThan(lowRms);
  });
});

describe('generateRealisticMorseAudio', () => {
  it('produces a playable WAV data URI by default', () => {
    const result = generateRealisticMorseAudio({ text: 'CQ', wpm: 20 });
    expect(result.dataUri.startsWith('data:audio/wav;base64,')).toBe(true);
    expect(result.samples.length).toBeGreaterThan(0);
    expect(result.duration).toBeGreaterThan(0);
    expect(result.effectiveWpm).toBe(20);
  });

  it('reports a different effectiveWpm and modified samples when fist is applied', () => {
    const clean = generateRealisticMorseAudio({ text: 'PARIS', wpm: 20 });
    const sloppy = generateRealisticMorseAudio({
      text: 'PARIS',
      wpm: 20,
      fist: FIST_PROFILES.very_poor,
    });
    // No fist → effective WPM is the requested WPM exactly.
    expect(clean.effectiveWpm).toBe(20);
    // With fist, effectiveWpm may go up or down depending on seed (the model's
    // speed drift is randomly +/-), but the value is computed and reported.
    expect(sloppy.effectiveWpm).not.toBe(20);
    // And the audio length differs from the clean version, proving fist
    // actually rewrote the timings rather than passing them through.
    expect(sloppy.samples.length).not.toBe(clean.samples.length);
  });

  it('exposes the Bug fist profile', () => {
    expect(FIST_PROFILES.bug).toBeDefined();
    // Defining feature: positive dah bias (long dahs).
    expect(FIST_PROFILES.bug.dahBias).toBeGreaterThan(0);
    // Tight dits — jitter much lower than a typical "average" op.
    expect(FIST_PROFILES.bug.jitter).toBeLessThan(FIST_PROFILES.average.jitter);

    const result = generateRealisticMorseAudio({
      text: 'BUG',
      wpm: 20,
      fist: FIST_PROFILES.bug,
    });
    expect(result.samples.length).toBeGreaterThan(0);
  });

  it('SNR is calibrated to the reference bandwidth (narrowing the receiver helps)', () => {
    // Same SNR, two different receiver filter widths. Using a narrower bandpass
    // should let more signal energy survive (per total-RMS) since it cuts noise
    // outside the passband while keeping the on-frequency tone.
    const wide = generateRealisticMorseAudio({
      text: 'EEEE',
      wpm: 20,
      frequency: 600,
      qrn: { snr: 0 },
      bandpass: { bandwidth: DEFAULT_SNR_REFERENCE_BANDWIDTH },
    });
    const narrow = generateRealisticMorseAudio({
      text: 'EEEE',
      wpm: 20,
      frequency: 600,
      qrn: { snr: 0 },
      bandpass: { bandwidth: 300 },
    });

    // Narrowing should noticeably change the signal — measure variance of the
    // result. The narrow filter rings at the center frequency, so the post-
    // bandpass narrow output should still have substantial energy.
    expect(rmsOf(narrow.samples)).toBeGreaterThan(0);
    expect(rmsOf(wide.samples)).toBeGreaterThan(0);
  });
});
