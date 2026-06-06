/**
 * Rayleigh fading processor for realistic HF ionospheric propagation
 *
 * Implements true Rayleigh fading using the formula:
 *   envelope = sqrt(I² + Q²)
 * where I and Q are independent lowpass-filtered Gaussian noise signals.
 *
 * This models multipath propagation where signals arrive via multiple
 * ionospheric reflections with random phases.
 */

import type { RayleighFadingOptions } from '../pileup/types';

/**
 * Simple one-pole lowpass filter for shaping Gaussian noise
 */
class OnePoleLowpass {
  private y1 = 0;
  private alpha: number;

  constructor(cutoffHz: number, sampleRate: number) {
    // Calculate filter coefficient
    const rc = 1 / (2 * Math.PI * cutoffHz);
    const dt = 1 / sampleRate;
    this.alpha = dt / (rc + dt);
  }

  process(x: number): number {
    this.y1 = this.y1 + this.alpha * (x - this.y1);
    return this.y1;
  }

  reset(): void {
    this.y1 = 0;
  }
}

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
 * Generate Gaussian white noise sample using Box-Muller transform
 */
function gaussianNoise(prng: () => number): number {
  const u1 = prng();
  const u2 = prng();
  return Math.sqrt(-2 * Math.log(u1 || 0.0001)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Rayleigh fading envelope generator
 *
 * Generates a time-varying amplitude envelope following Rayleigh statistics,
 * which is the natural distribution for signal fading caused by multipath
 * propagation through the ionosphere.
 */
export class RayleighFading {
  private filterI: OnePoleLowpass;
  private filterQ: OnePoleLowpass;
  private prng: () => number;
  private depth: number;

  /**
   * Create a new Rayleigh fading processor
   *
   * @param options - Fading configuration
   * @param sampleRate - Audio sample rate in Hz
   * @param seed - Random seed for reproducible fading patterns
   */
  constructor(
    options: RayleighFadingOptions,
    sampleRate: number,
    seed: number = 12345
  ) {
    // Bandwidth controls how fast fades occur
    // Typical HF values: 0.1-2 Hz (slow to moderate fading)
    const { bandwidth, depth } = options;

    // Create lowpass filters for I and Q channels
    // The cutoff determines the fading rate (Doppler spread)
    this.filterI = new OnePoleLowpass(bandwidth, sampleRate);
    this.filterQ = new OnePoleLowpass(bandwidth, sampleRate);

    this.prng = createPrng(seed);
    this.depth = Math.max(0, Math.min(1, depth));

    // Warm up filters to avoid initial transient
    for (let i = 0; i < sampleRate * 0.5; i++) {
      this.filterI.process(gaussianNoise(this.prng));
      this.filterQ.process(gaussianNoise(this.prng));
    }
  }

  /**
   * Get the next fading envelope value
   *
   * @returns Amplitude multiplier (0 to ~1, following Rayleigh distribution)
   */
  nextSample(): number {
    // Generate lowpass-filtered Gaussian noise for I and Q
    const i = this.filterI.process(gaussianNoise(this.prng));
    const q = this.filterQ.process(gaussianNoise(this.prng));

    // Rayleigh envelope = sqrt(I² + Q²)
    // Scale to have mean ~1 (raw Rayleigh has mean of sqrt(π/2) ≈ 1.25)
    const rayleigh = Math.sqrt(i * i + q * q) * 0.8;

    // Apply depth control: lerp between 1.0 (no fading) and rayleigh envelope
    // At depth=0, output is always 1.0 (no fading)
    // At depth=1, output follows full Rayleigh statistics
    return 1 - this.depth * (1 - Math.min(rayleigh, 1));
  }
}

/**
 * Apply Rayleigh fading to audio samples
 *
 * @param samples - Input audio samples
 * @param options - Fading configuration
 * @param sampleRate - Audio sample rate in Hz
 * @param seed - Random seed for reproducible fading
 * @returns New array with fading applied
 */
export function applyRayleighFading(
  samples: Float32Array,
  options: RayleighFadingOptions,
  sampleRate: number,
  seed: number = 12345
): Float32Array {
  const fader = new RayleighFading(options, sampleRate, seed);
  const output = new Float32Array(samples.length);

  for (let i = 0; i < samples.length; i++) {
    output[i] = samples[i] * fader.nextSample();
  }

  return output;
}

/**
 * Generate a Rayleigh fading envelope (for mixing scenarios)
 *
 * @param length - Number of samples
 * @param options - Fading configuration
 * @param sampleRate - Audio sample rate in Hz
 * @param seed - Random seed
 * @returns Float32Array of envelope values
 */
export function generateRayleighEnvelope(
  length: number,
  options: RayleighFadingOptions,
  sampleRate: number,
  seed: number = 12345
): Float32Array {
  const fader = new RayleighFading(options, sampleRate, seed);
  const envelope = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    envelope[i] = fader.nextSample();
  }

  return envelope;
}
