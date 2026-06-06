import { describe, it, expect } from 'vitest';
import {
  validateWpm,
  validateFrequency,
  validatePreDelay,
  validatePostDelay,
  validateFwpm,
  validateSnr,
  validateFadeDepth,
  validateFadeRate,
  MIN_WPM,
  MAX_WPM,
  MIN_FREQUENCY,
  MAX_FREQUENCY,
  MIN_PRE_DELAY,
  MAX_PRE_DELAY,
  MIN_SNR,
  MAX_SNR,
  MIN_FADE_DEPTH,
  MAX_FADE_DEPTH,
  MIN_FADE_RATE,
  MAX_FADE_RATE,
} from './constants';
import { generateMorseAudio, calculateDuration } from './utils/morse-generator';
import { applyRadioEffects } from './utils/radio-effects';

describe('constants validation', () => {
  describe('validateWpm', () => {
    it('should clamp values below minimum', () => {
      expect(validateWpm(1)).toBe(MIN_WPM);
      expect(validateWpm(0)).toBe(MIN_WPM);
      expect(validateWpm(-10)).toBe(MIN_WPM);
    });

    it('should clamp values above maximum', () => {
      expect(validateWpm(100)).toBe(MAX_WPM);
      expect(validateWpm(999)).toBe(MAX_WPM);
    });

    it('should pass through valid values', () => {
      expect(validateWpm(20)).toBe(20);
      expect(validateWpm(15)).toBe(15);
    });

    it('should round decimal values', () => {
      expect(validateWpm(20.5)).toBe(21);
      expect(validateWpm(20.4)).toBe(20);
    });
  });

  describe('validateFrequency', () => {
    it('should clamp values below minimum', () => {
      expect(validateFrequency(100)).toBe(MIN_FREQUENCY);
      expect(validateFrequency(0)).toBe(MIN_FREQUENCY);
    });

    it('should clamp values above maximum', () => {
      expect(validateFrequency(2000)).toBe(MAX_FREQUENCY);
    });

    it('should pass through valid values', () => {
      expect(validateFrequency(700)).toBe(700);
      expect(validateFrequency(550)).toBe(550);
    });
  });

  describe('validatePreDelay', () => {
    it('should clamp values below minimum', () => {
      expect(validatePreDelay(50)).toBe(MIN_PRE_DELAY);
    });

    it('should clamp values above maximum', () => {
      expect(validatePreDelay(5000)).toBe(MAX_PRE_DELAY);
    });

    it('should pass through valid values', () => {
      expect(validatePreDelay(300)).toBe(300);
    });
  });

  describe('validatePostDelay', () => {
    it('should allow zero', () => {
      expect(validatePostDelay(0)).toBe(0);
    });

    it('should pass through valid values', () => {
      expect(validatePostDelay(100)).toBe(100);
    });
  });

  describe('validateFwpm', () => {
    it('should not exceed wpm', () => {
      expect(validateFwpm(25, 20)).toBe(20);
    });

    it('should allow fwpm less than wpm', () => {
      expect(validateFwpm(15, 20)).toBe(15);
    });

    it('should apply minimum validation', () => {
      expect(validateFwpm(1, 20)).toBe(MIN_WPM);
    });
  });
});

describe('generateMorseAudio', () => {
  it('should generate audio for simple text', () => {
    const result = generateMorseAudio({
      text: 'E',
      wpm: 20,
    });

    expect(result.dataUri).toMatch(/^data:audio\/wav;base64,/);
    expect(result.timings).toBeInstanceOf(Array);
    expect(result.timings.length).toBeGreaterThan(0);
    expect(result.sampleRate).toBeGreaterThan(0);
  });

  it('should include pre-delay in timings', () => {
    const result = generateMorseAudio({
      text: 'E',
      wpm: 20,
      preDelay: 300,
    });

    // First timing should be negative (silence) for pre-delay
    expect(result.timings[0]).toBe(-300);
  });

  it('should include post-delay in timings', () => {
    const result = generateMorseAudio({
      text: 'E',
      wpm: 20,
      postDelay: 100,
    });

    // Post-delay should be included near the end as a negative value
    expect(result.timings).toContain(-100);
  });

  it('should end with zero for clean termination', () => {
    const result = generateMorseAudio({
      text: 'E',
      wpm: 20,
    });

    // Zero should be at the end for clean audio termination
    expect(result.timings).toContain(0);
  });
});

describe('calculateDuration', () => {
  it('should sum absolute values of timings', () => {
    const timings = [100, -50, 100, -50, 0];
    expect(calculateDuration(timings)).toBe(0.3); // 300ms = 0.3s
  });

  it('should handle empty timings', () => {
    expect(calculateDuration([])).toBe(0);
  });

  it('should handle single timing', () => {
    expect(calculateDuration([-300])).toBe(0.3);
  });
});

describe('radio effects validation', () => {
  describe('validateSnr', () => {
    it('should clamp values below minimum', () => {
      expect(validateSnr(-10)).toBe(MIN_SNR); // MIN_SNR is -6
      expect(validateSnr(-20)).toBe(MIN_SNR);
    });

    it('should clamp values above maximum', () => {
      expect(validateSnr(100)).toBe(MAX_SNR);
    });

    it('should pass through valid values', () => {
      expect(validateSnr(20)).toBe(20);
      expect(validateSnr(0)).toBe(0); // 0 dB is valid (equal signal/noise)
      expect(validateSnr(-3)).toBe(-3); // Negative SNR is valid
    });
  });

  describe('validateFadeDepth', () => {
    it('should clamp values below minimum', () => {
      expect(validateFadeDepth(-0.5)).toBe(MIN_FADE_DEPTH);
    });

    it('should clamp values above maximum', () => {
      expect(validateFadeDepth(1.0)).toBe(MAX_FADE_DEPTH);
    });

    it('should pass through valid values', () => {
      expect(validateFadeDepth(0.5)).toBe(0.5);
    });
  });

  describe('validateFadeRate', () => {
    it('should clamp values below minimum', () => {
      expect(validateFadeRate(0.01)).toBe(MIN_FADE_RATE);
    });

    it('should clamp values above maximum', () => {
      expect(validateFadeRate(5.0)).toBe(MAX_FADE_RATE);
    });

    it('should pass through valid values', () => {
      expect(validateFadeRate(0.5)).toBe(0.5);
    });
  });
});

describe('applyRadioEffects', () => {
  const sampleRate = 22050;

  it('should return original samples when no options provided', () => {
    const samples = new Float32Array([0, 0.5, 1, 0.5, 0]);
    const result = applyRadioEffects(samples, sampleRate);
    expect(result).toBe(samples);
  });

  it('should return original samples when options is undefined', () => {
    const samples = new Float32Array([0, 0.5, 1, 0.5, 0]);
    const result = applyRadioEffects(samples, sampleRate, undefined);
    expect(result).toBe(samples);
  });

  it('should return original samples when no effects enabled', () => {
    const samples = new Float32Array([0, 0.5, 1, 0.5, 0]);
    const result = applyRadioEffects(samples, sampleRate, {});
    expect(result).toBe(samples);
  });

  it('should add noise when QRN is enabled', () => {
    const samples = new Float32Array(1000).fill(0);
    const result = applyRadioEffects(samples, sampleRate, {
      qrn: { snr: 10 },
    });

    // Result should be different from input (noise added)
    expect(result).not.toBe(samples);

    // Check that noise was actually added (variance should be non-zero)
    let sum = 0;
    for (let i = 0; i < result.length; i++) {
      sum += result[i] * result[i];
    }
    const variance = sum / result.length;
    expect(variance).toBeGreaterThan(0);
  });

  it('should apply fading when QSB is enabled', () => {
    // Create a constant signal
    const samples = new Float32Array(sampleRate).fill(0.8);
    const result = applyRadioEffects(samples, sampleRate, {
      qsb: { depth: 0.5, rate: 1.0 },
    });

    // Result should be different from input (fading applied)
    expect(result).not.toBe(samples);

    // Check that amplitude varies (min < max)
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < result.length; i++) {
      if (result[i] < min) min = result[i];
      if (result[i] > max) max = result[i];
    }
    expect(max - min).toBeGreaterThan(0.1);
  });

  it('should apply both QRN and QSB together', () => {
    const samples = new Float32Array(sampleRate).fill(0.8);
    const result = applyRadioEffects(samples, sampleRate, {
      qrn: { snr: 20 },
      qsb: { depth: 0.3, rate: 0.5 },
    });

    expect(result).not.toBe(samples);
    expect(result.length).toBe(samples.length);
  });

  it('should clip values to -1/+1 range', () => {
    // Create a signal that would exceed bounds with noise
    const samples = new Float32Array(1000).fill(0.99);
    const result = applyRadioEffects(samples, sampleRate, {
      qrn: { snr: 3 }, // Very noisy
    });

    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBeGreaterThanOrEqual(-1);
      expect(result[i]).toBeLessThanOrEqual(1);
    }
  });
});

describe('generateMorseAudio with radio effects', () => {
  it('should generate audio with QRN enabled', () => {
    const result = generateMorseAudio({
      text: 'E',
      wpm: 20,
      radioEffects: {
        qrn: { snr: 15 },
      },
    });

    expect(result.dataUri).toMatch(/^data:audio\/wav;base64,/);
    expect(result.timings.length).toBeGreaterThan(0);
  });

  it('should generate audio with QSB enabled', () => {
    const result = generateMorseAudio({
      text: 'E',
      wpm: 20,
      radioEffects: {
        qsb: { depth: 0.5, rate: 0.2 },
      },
    });

    expect(result.dataUri).toMatch(/^data:audio\/wav;base64,/);
    expect(result.timings.length).toBeGreaterThan(0);
  });

  it('should generate audio with both effects enabled', () => {
    const result = generateMorseAudio({
      text: 'CQ',
      wpm: 20,
      radioEffects: {
        qrn: { snr: 20 },
        qsb: { depth: 0.3, rate: 0.2 },
      },
    });

    expect(result.dataUri).toMatch(/^data:audio\/wav;base64,/);
    expect(result.timings.length).toBeGreaterThan(0);
  });

  it('should be identical to no effects when radioEffects is undefined', () => {
    const withoutEffects = generateMorseAudio({
      text: 'E',
      wpm: 20,
    });

    const withEmptyEffects = generateMorseAudio({
      text: 'E',
      wpm: 20,
      radioEffects: undefined,
    });

    expect(withoutEffects.dataUri).toBe(withEmptyEffects.dataUri);
  });
});
