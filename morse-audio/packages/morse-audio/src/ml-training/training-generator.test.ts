import { describe, it, expect } from 'vitest';
import {
  TrainingSampleGenerator,
  createTrainingSampleGenerator,
  FIST_PROFILES,
  FIST_DISTRIBUTION,
  randomFistProfile,
  getFistOptions,
  applyFistModel,
  DEFAULT_DISTRIBUTIONS,
} from './index';
import { translateWithMetadata } from '../utils/morse-code';
import { applyAWGN, generateAWGN } from '../utils/awgn';
import { applyIonosphericFading, randomIonosphericFadingOptions } from '../utils/ionospheric-fading';
import { applyMultipath, randomMultipathOptions } from '../utils/multipath';
import { applyAGC } from '../utils/agc';
import type { TrainingSampleConfig } from './types';

describe('TrainingSampleGenerator', () => {
  it('should create a generator instance', () => {
    const generator = createTrainingSampleGenerator();
    expect(generator).toBeInstanceOf(TrainingSampleGenerator);
  });

  it('should generate a basic training sample', () => {
    const generator = createTrainingSampleGenerator();
    const config: TrainingSampleConfig = {
      text: 'CQ',
      wpm: 20,
      frequency: 700,
      sampleRate: 8000,
      noise: { snrDb: 10 },

      durationSec: 5,
      seed: 12345,
    };

    const sample = generator.generate(config);

    expect(sample.audio).toBeInstanceOf(Float32Array);
    expect(sample.audio.length).toBe(5 * 8000); // 5 seconds at 8000 Hz
    expect(sample.metadata.config).toEqual(config);
    expect(sample.metadata.fullText).toBe('CQ');
    expect(sample.metadata.characters.length).toBe(2); // C and Q
  });

  it('should generate reproducible samples with same seed', () => {
    const generator = createTrainingSampleGenerator();
    const config: TrainingSampleConfig = {
      text: 'E',
      wpm: 25,
      frequency: 600,
      sampleRate: 8000,
      noise: { snrDb: 15 },

      durationSec: 2,
      seed: 42,
    };

    const sample1 = generator.generate(config);
    const sample2 = generator.generate(config);

    // Audio should be identical with same seed
    expect(sample1.audio.length).toBe(sample2.audio.length);
    for (let i = 0; i < sample1.audio.length; i++) {
      expect(sample1.audio[i]).toBeCloseTo(sample2.audio[i], 5);
    }
  });

  it('should generate different samples with different seeds', () => {
    const generator = createTrainingSampleGenerator();
    const baseConfig: Omit<TrainingSampleConfig, 'seed'> = {
      text: 'E',
      wpm: 25,
      frequency: 600,
      sampleRate: 8000,
      noise: { snrDb: 15 },

      durationSec: 2,
    };

    const sample1 = generator.generate({ ...baseConfig, seed: 1 });
    const sample2 = generator.generate({ ...baseConfig, seed: 2 });

    // Some samples should differ
    let differentCount = 0;
    for (let i = 0; i < sample1.audio.length; i += 100) {
      if (Math.abs(sample1.audio[i] - sample2.audio[i]) > 0.001) {
        differentCount++;
      }
    }
    expect(differentCount).toBeGreaterThan(0);
  });

  it('should apply fist model when configured', () => {
    const generator = createTrainingSampleGenerator();
    const config: TrainingSampleConfig = {
      text: 'TEST',
      wpm: 20,
      frequency: 700,
      sampleRate: 8000,
      noise: { snrDb: 20 },

      durationSec: 10,
      seed: 12345,
      fist: FIST_PROFILES.average,
    };

    const sample = generator.generate(config);

    // Effective WPM should differ from nominal due to fist timing
    expect(sample.metadata.effectiveWpm).not.toBe(config.wpm);
    expect(sample.metadata.elements).toBeDefined();
    expect(sample.metadata.elements!.length).toBeGreaterThan(0);
  });

  it('should apply ionospheric fading when configured', () => {
    const generator = createTrainingSampleGenerator();
    const configWithFading: TrainingSampleConfig = {
      text: 'E',
      wpm: 20,
      frequency: 700,
      sampleRate: 8000,
      noise: { snrDb: 30 }, // Low noise to see fading effect

      durationSec: 5,
      seed: 12345,
      ionosphericFading: {
        depth: 0.7,
        rate: 1.0,
        components: 3,
      },
    };

    const configWithoutFading: TrainingSampleConfig = {
      ...configWithFading,
      ionosphericFading: undefined,
    };

    const withFading = generator.generate(configWithFading);
    const withoutFading = generator.generate(configWithoutFading);

    // Samples should be different
    let differentCount = 0;
    for (let i = 0; i < withFading.audio.length; i += 100) {
      if (Math.abs(withFading.audio[i] - withoutFading.audio[i]) > 0.01) {
        differentCount++;
      }
    }
    expect(differentCount).toBeGreaterThan(0);
  });

  it('should convert to WAV buffer', () => {
    const generator = createTrainingSampleGenerator();
    const sample = generator.generate({
      text: 'E',
      wpm: 20,
      frequency: 700,
      sampleRate: 8000,
      noise: { snrDb: 15 },

      durationSec: 1,
      seed: 12345,
    });

    const wavBuffer = generator.toWavBuffer(sample);

    expect(wavBuffer).toBeInstanceOf(ArrayBuffer);
    expect(wavBuffer.byteLength).toBeGreaterThan(44); // At least WAV header

    // Check WAV header
    const view = new Uint8Array(wavBuffer);
    expect(String.fromCharCode(view[0], view[1], view[2], view[3])).toBe('RIFF');
    expect(String.fromCharCode(view[8], view[9], view[10], view[11])).toBe('WAVE');
  });

  it('should convert metadata to JSON', () => {
    const generator = createTrainingSampleGenerator();
    const sample = generator.generate({
      text: 'CQ',
      wpm: 20,
      frequency: 700,
      sampleRate: 8000,
      noise: { snrDb: 15 },

      durationSec: 5,
      seed: 12345,
    });

    const json = generator.toMetadataJson(sample);

    expect(typeof json).toBe('string');
    const parsed = JSON.parse(json);
    expect(parsed.fullText).toBe('CQ');
    expect(parsed.characters).toHaveLength(2);
  });

  it('should generate batch of samples', () => {
    const generator = createTrainingSampleGenerator();
    const texts = ['CQ', 'DE', 'TEST'];

    const samples = generator.generateBatch(5, texts, DEFAULT_DISTRIBUTIONS, 12345);

    expect(samples).toHaveLength(5);
    for (const sample of samples) {
      expect(sample.audio).toBeInstanceOf(Float32Array);
      expect(texts).toContain(sample.metadata.fullText);
    }
  });
});

describe('translateWithMetadata', () => {
  it('should return timings and element metadata', () => {
    const result = translateWithMetadata('AB', 20, 20);

    expect(result.timings).toBeInstanceOf(Array);
    expect(result.timings.length).toBeGreaterThan(0);
    expect(result.elements).toBeInstanceOf(Array);
    expect(result.elements.length).toBeGreaterThan(0);
    expect(result.characters).toHaveLength(2);
  });

  it('should track character timing boundaries', () => {
    const result = translateWithMetadata('CQ', 20, 20);

    expect(result.characters[0].char).toBe('C');
    expect(result.characters[1].char).toBe('Q');
    expect(result.characters[0].endMs).toBeLessThanOrEqual(result.characters[1].startMs);
  });

  it('should label element types correctly', () => {
    const result = translateWithMetadata('A', 20, 20);

    // A is .- (dit dah)
    const dits = result.elements.filter(e => e.elementType === 'dit');
    const dahs = result.elements.filter(e => e.elementType === 'dah');

    expect(dits.length).toBe(1);
    expect(dahs.length).toBe(1);
  });

  it('should include word gaps', () => {
    const result = translateWithMetadata('A B', 20, 20);

    const wordGaps = result.elements.filter(e => e.elementType === 'word_gap');
    expect(wordGaps.length).toBe(1);
  });
});

describe('Fist Model', () => {
  it('should have all profile definitions', () => {
    expect(FIST_PROFILES.machine).toBeDefined();
    expect(FIST_PROFILES.good).toBeDefined();
    expect(FIST_PROFILES.average).toBeDefined();
    expect(FIST_PROFILES.poor).toBeDefined();
    expect(FIST_PROFILES.very_poor).toBeDefined();
  });

  it('should have distribution summing to 1', () => {
    const sum = FIST_DISTRIBUTION.reduce((acc, d) => acc + d.probability, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('should select random profile', () => {
    const profiles = new Set<string>();
    // With enough iterations, should get variety
    for (let i = 0; i < 100; i++) {
      profiles.add(randomFistProfile());
    }
    expect(profiles.size).toBeGreaterThan(1);
  });

  it('should apply jitter to timings', () => {
    const translation = translateWithMetadata('E', 20, 20);
    const fistOptions = getFistOptions('poor');

    const result = applyFistModel(translation, fistOptions, 20, 12345);

    // Timings should differ from original
    expect(result.timings.length).toBe(translation.timings.length);

    let totalDiff = 0;
    for (let i = 0; i < result.timings.length; i++) {
      totalDiff += Math.abs(Math.abs(result.timings[i]) - Math.abs(translation.timings[i]));
    }
    expect(totalDiff).toBeGreaterThan(0);
  });

  it('should calculate effective WPM', () => {
    const translation = translateWithMetadata('TEST', 20, 20);
    const fistOptions = getFistOptions('poor');

    const result = applyFistModel(translation, fistOptions, 20, 12345);

    // Effective WPM should be close to but not exactly nominal
    expect(result.effectiveWpm).toBeGreaterThan(10);
    expect(result.effectiveWpm).toBeLessThan(30);
  });
});

describe('AWGN', () => {
  it('should add noise to signal', () => {
    const clean = new Float32Array(1000).fill(0);
    const noisy = applyAWGN(clean, 10, 12345);

    // Should have non-zero variance
    let variance = 0;
    for (let i = 0; i < noisy.length; i++) {
      variance += noisy[i] * noisy[i];
    }
    variance /= noisy.length;
    expect(variance).toBeGreaterThan(0);
  });

  it('should generate pure AWGN', () => {
    const noise = generateAWGN(10000, 0.5, 12345);

    // Check approximate Gaussian properties
    let sum = 0;
    for (let i = 0; i < noise.length; i++) {
      sum += noise[i];
    }
    const mean = sum / noise.length;
    expect(Math.abs(mean)).toBeLessThan(0.1); // Mean should be near 0

    let sumSq = 0;
    for (let i = 0; i < noise.length; i++) {
      sumSq += noise[i] * noise[i];
    }
    const rms = Math.sqrt(sumSq / noise.length);
    expect(rms).toBeCloseTo(0.5, 1); // RMS should match target
  });

  it('should produce reproducible noise with seed', () => {
    const noise1 = generateAWGN(100, 0.5, 42);
    const noise2 = generateAWGN(100, 0.5, 42);

    for (let i = 0; i < noise1.length; i++) {
      expect(noise1[i]).toBe(noise2[i]);
    }
  });
});

describe('Ionospheric Fading', () => {
  it('should apply amplitude modulation', () => {
    const samples = new Float32Array(8000).fill(0.8);
    const faded = applyIonosphericFading(samples, {
      depth: 0.7,
      rate: 2.0,
      components: 3,
    }, 8000, 12345);

    // Find min and max
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < faded.length; i++) {
      if (faded[i] < min) min = faded[i];
      if (faded[i] > max) max = faded[i];
    }

    // Should have significant variation
    expect(max - min).toBeGreaterThan(0.2);
  });

  it('should generate random options', () => {
    const opts1 = randomIonosphericFadingOptions('moderate');
    const opts2 = randomIonosphericFadingOptions('moderate');

    expect(opts1).not.toBeNull();
    expect(opts2).not.toBeNull();
    // Should have some variation
    expect(opts1!.depth).not.toBe(opts2!.depth);
  });
});

describe('Multipath', () => {
  it('should add delayed copies', () => {
    // Create impulse
    const samples = new Float32Array(1000).fill(0);
    samples[100] = 1.0;

    const multipath = applyMultipath(samples, {
      paths: [
        { delayMs: 5, amplitude: 0.5 },
        { delayMs: 10, amplitude: 0.3 },
      ],
    }, 8000);

    // Should have impulses at delayed positions
    const delay1Samples = Math.round((5 / 1000) * 8000);
    const delay2Samples = Math.round((10 / 1000) * 8000);

    expect(multipath[100 + delay1Samples]).toBeGreaterThan(0);
    expect(multipath[100 + delay2Samples]).toBeGreaterThan(0);
  });

  it('should generate random options', () => {
    const opts = randomMultipathOptions();
    expect(opts.paths.length).toBeGreaterThanOrEqual(2);
    expect(opts.paths.length).toBeLessThanOrEqual(4);
  });
});

describe('AGC', () => {
  it('should level varying amplitude signal', () => {
    // Create signal with varying amplitude
    const samples = new Float32Array(8000);
    for (let i = 0; i < samples.length; i++) {
      const amplitude = 0.2 + 0.6 * Math.sin(2 * Math.PI * 0.5 * i / 8000);
      samples[i] = amplitude * Math.sin(2 * Math.PI * 700 * i / 8000);
    }

    const agced = applyAGC(samples, 8000, {
      attackMs: 10,
      releaseMs: 100,
      targetLevel: 0.7,
    });

    // Find amplitude variation after AGC
    // Should be more consistent than input
    const windowSize = 800;
    const inputVariances: number[] = [];
    const outputVariances: number[] = [];

    for (let w = 0; w < 5; w++) {
      const start = w * windowSize;
      let inputMax = 0;
      let outputMax = 0;
      for (let i = start; i < start + windowSize; i++) {
        inputMax = Math.max(inputMax, Math.abs(samples[i]));
        outputMax = Math.max(outputMax, Math.abs(agced[i]));
      }
      inputVariances.push(inputMax);
      outputVariances.push(outputMax);
    }

    // Output should have less variance
    const inputRange = Math.max(...inputVariances) - Math.min(...inputVariances);
    const outputRange = Math.max(...outputVariances) - Math.min(...outputVariances);
    expect(outputRange).toBeLessThan(inputRange);
  });
});

describe('DEFAULT_DISTRIBUTIONS', () => {
  it('should have valid probability ranges', () => {
    expect(DEFAULT_DISTRIBUTIONS.wpmRange[0]).toBeLessThan(DEFAULT_DISTRIBUTIONS.wpmRange[1]);
    expect(DEFAULT_DISTRIBUTIONS.snrRange[0]).toBeLessThan(DEFAULT_DISTRIBUTIONS.snrRange[1]);
    expect(DEFAULT_DISTRIBUTIONS.frequencyRange[0]).toBeLessThan(DEFAULT_DISTRIBUTIONS.frequencyRange[1]);
  });

  it('should have valid fist distribution', () => {
    const sum = Object.values(DEFAULT_DISTRIBUTIONS.fistDistribution).reduce((a, b) => a + (b ?? 0), 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('should have probabilities between 0 and 1', () => {
    expect(DEFAULT_DISTRIBUTIONS.ionosphericFadingProbability).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_DISTRIBUTIONS.ionosphericFadingProbability).toBeLessThanOrEqual(1);
    expect(DEFAULT_DISTRIBUTIONS.multipathProbability).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_DISTRIBUTIONS.multipathProbability).toBeLessThanOrEqual(1);
    expect(DEFAULT_DISTRIBUTIONS.agcProbability).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_DISTRIBUTIONS.agcProbability).toBeLessThanOrEqual(1);
  });
});
