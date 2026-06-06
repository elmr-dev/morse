/**
 * Flutter processor for auroral distortion simulation
 *
 * Flutter is rapid amplitude modulation caused by signals reflecting
 * off the disturbed ionosphere during geomagnetic storms and auroral
 * events. It produces a characteristic "watery" or "fluttery" sound
 * at 10-30 Hz.
 */

import type { FlutterOptions } from '../pileup/types';

/**
 * Seeded pseudo-random number generator (mulberry32)
 */
function createPrng(seed: number): () => number {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Flutter effect processor
 *
 * Uses multiple modulating oscillators with slight frequency variations
 * to create realistic, organic-sounding flutter.
 */
export class Flutter {
  private rate: number;
  private depth: number;
  private sampleRate: number;
  private phase1: number;
  private phase2: number;
  private phase3: number;
  private rateOffset1: number;
  private rateOffset2: number;

  /**
   * Create a new flutter processor
   *
   * @param options - Flutter configuration
   * @param sampleRate - Audio sample rate in Hz
   * @param seed - Random seed for reproducible patterns
   */
  constructor(
    options: FlutterOptions,
    sampleRate: number,
    seed: number = 11111
  ) {
    const prng = createPrng(seed);

    // Clamp rate to valid range (10-30 Hz)
    this.rate = Math.max(10, Math.min(30, options.rate));
    this.depth = Math.max(0, Math.min(1, options.depth));
    this.sampleRate = sampleRate;

    // Random starting phases for organic sound
    this.phase1 = prng() * 2 * Math.PI;
    this.phase2 = prng() * 2 * Math.PI;
    this.phase3 = prng() * 2 * Math.PI;

    // Slight frequency offsets for complexity
    this.rateOffset1 = 0.7 + prng() * 0.1; // ~0.7-0.8x base rate
    this.rateOffset2 = 1.2 + prng() * 0.2; // ~1.2-1.4x base rate
  }

  /**
   * Get the flutter envelope value for a given sample index
   *
   * @param sampleIndex - Current sample position
   * @returns Amplitude multiplier (typically 0.5-1.0 depending on depth)
   */
  getEnvelope(sampleIndex: number): number {
    const time = sampleIndex / this.sampleRate;

    // Main flutter oscillator
    const mod1 = Math.sin(2 * Math.PI * this.rate * time + this.phase1);

    // Secondary oscillators at offset frequencies for complexity
    const mod2 = Math.sin(
      2 * Math.PI * this.rate * this.rateOffset1 * time + this.phase2
    );
    const mod3 = Math.sin(
      2 * Math.PI * this.rate * this.rateOffset2 * time + this.phase3
    );

    // Combine oscillators (weighted sum)
    const combined = mod1 * 0.6 + mod2 * 0.25 + mod3 * 0.15;

    // Map from [-1, 1] to [1-depth, 1]
    // At depth=0, always returns 1.0
    // At depth=1, ranges from 0.0 to 1.0
    return 1 - this.depth * (1 - (combined + 1) / 2);
  }
}

/**
 * Apply flutter to audio samples
 *
 * @param samples - Input audio samples
 * @param options - Flutter configuration
 * @param sampleRate - Audio sample rate in Hz
 * @param seed - Random seed for reproducible patterns
 * @returns New array with flutter applied
 */
export function applyFlutter(
  samples: Float32Array,
  options: FlutterOptions,
  sampleRate: number,
  seed: number = 11111
): Float32Array {
  const flutter = new Flutter(options, sampleRate, seed);
  const output = new Float32Array(samples.length);

  for (let i = 0; i < samples.length; i++) {
    output[i] = samples[i] * flutter.getEnvelope(i);
  }

  return output;
}

/**
 * Generate a flutter envelope (for mixing scenarios)
 *
 * @param length - Number of samples
 * @param options - Flutter configuration
 * @param sampleRate - Audio sample rate in Hz
 * @param seed - Random seed
 * @returns Float32Array of envelope values
 */
export function generateFlutterEnvelope(
  length: number,
  options: FlutterOptions,
  sampleRate: number,
  seed: number = 11111
): Float32Array {
  const flutter = new Flutter(options, sampleRate, seed);
  const envelope = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    envelope[i] = flutter.getEnvelope(i);
  }

  return envelope;
}
