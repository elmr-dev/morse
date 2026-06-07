/**
 * Pink noise generation utilities
 *
 * Implements Paul Kellet's economy method for generating pink noise,
 * which has equal energy per octave (1/f spectrum).
 */

import { createPrng, gaussianRandom, randomSeed } from './prng';

/**
 * Pink noise filter using Paul Kellet's economy method
 *
 * This filter transforms white noise into pink noise by applying
 * a series of IIR filters that approximate the 1/f spectrum.
 */
export class PinkNoiseFilter {
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private b3 = 0;
  private b4 = 0;
  private b5 = 0;
  private b6 = 0;

  /**
   * Process a white noise sample to produce pink noise
   *
   * @param white - White noise input sample
   * @returns Pink noise output sample
   */
  process(white: number): number {
    this.b0 = 0.99886 * this.b0 + white * 0.0555179;
    this.b1 = 0.99332 * this.b1 + white * 0.0750759;
    this.b2 = 0.969 * this.b2 + white * 0.153852;
    this.b3 = 0.8665 * this.b3 + white * 0.3104856;
    this.b4 = 0.55 * this.b4 + white * 0.5329522;
    this.b5 = -0.7616 * this.b5 - white * 0.016898;
    const pink =
      this.b0 +
      this.b1 +
      this.b2 +
      this.b3 +
      this.b4 +
      this.b5 +
      this.b6 +
      white * 0.5362;
    this.b6 = white * 0.115926;
    return pink * 0.11;
  }

  /**
   * Reset filter state
   */
  reset(): void {
    this.b0 = 0;
    this.b1 = 0;
    this.b2 = 0;
    this.b3 = 0;
    this.b4 = 0;
    this.b5 = 0;
    this.b6 = 0;
  }
}

/**
 * Generate pink noise samples
 *
 * @param length - Number of samples to generate
 * @param seed - Optional seed for reproducibility
 * @returns Float32Array of pink noise samples
 */
export function generatePinkNoise(length: number, seed?: number): Float32Array {
  const prng = createPrng(seed ?? randomSeed());
  const filter = new PinkNoiseFilter();
  const output = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    const white = gaussianRandom(prng);
    output[i] = filter.process(white);
  }

  return output;
}

/**
 * Apply pink noise filter to existing white noise samples
 *
 * @param samples - White noise input samples
 * @returns Float32Array of pink noise samples
 */
export function applyPinkNoiseFilter(samples: Float32Array): Float32Array {
  const filter = new PinkNoiseFilter();
  const output = new Float32Array(samples.length);

  for (let i = 0; i < samples.length; i++) {
    output[i] = filter.process(samples[i]);
  }

  return output;
}
