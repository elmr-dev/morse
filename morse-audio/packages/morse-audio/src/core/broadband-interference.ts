/**
 * Broadband interference generator
 *
 * Generates bandlimited noise to simulate various forms of broadband
 * interference on HF bands:
 * - Plasma TV noise
 * - Switching power supply interference
 * - Computer/LED lighting hash
 * - Power line noise
 *
 * Unlike pure AWGN, this noise is concentrated in a specific
 * frequency band and may have varying power over time.
 */

import { createPrng, gaussianRandom, randomSeed } from '../utils/prng';
import type { BroadbandInterferenceOptions } from './types';

/**
 * Simple biquad bandpass filter
 */
class BiquadBandpass {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private b0: number;
  private b1: number;
  private b2: number;
  private a1: number;
  private a2: number;

  constructor(centerFreq: number, bandwidth: number, sampleRate: number) {
    const Q = centerFreq / bandwidth;
    const omega = (2 * Math.PI * centerFreq) / sampleRate;
    const sinOmega = Math.sin(omega);
    const cosOmega = Math.cos(omega);
    const alpha = sinOmega / (2 * Q);

    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b1 = 0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * cosOmega) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(x: number): number {
    const y =
      this.b0 * x +
      this.b1 * this.x1 +
      this.b2 * this.x2 -
      this.a1 * this.y1 -
      this.a2 * this.y2;

    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;

    return y;
  }
}

/**
 * Generate broadband interference
 *
 * @param length - Number of samples
 * @param options - Interference configuration
 * @param sampleRate - Sample rate in Hz
 * @param seed - Random seed for reproducibility
 * @returns Float32Array of interference samples
 */
export function generateBroadbandInterference(
  length: number,
  options: BroadbandInterferenceOptions,
  sampleRate: number,
  seed?: number
): Float32Array {
  const prng = createPrng(seed ?? randomSeed());

  // Ensure center frequency is valid for the sample rate
  const maxFreq = sampleRate / 2 - options.bandwidth / 2;
  const centerFreq = Math.min(options.centerFrequency, maxFreq);
  const bandwidth = Math.min(options.bandwidth, sampleRate / 2);

  // Create bandpass filter (2 cascaded stages for sharper cutoff)
  const filter1 = new BiquadBandpass(centerFreq, bandwidth, sampleRate);
  const filter2 = new BiquadBandpass(centerFreq, bandwidth, sampleRate);

  const output = new Float32Array(length);

  // Generate and filter white noise
  for (let i = 0; i < length; i++) {
    const white = gaussianRandom(prng);
    const filtered = filter2.process(filter1.process(white));
    output[i] = filtered;
  }

  // Normalize and apply power level
  // Calculate RMS
  let sumSquares = 0;
  for (let i = 0; i < length; i++) {
    sumSquares += output[i] * output[i];
  }
  const rms = Math.sqrt(sumSquares / length);

  // Target RMS based on power level (0 dB = 0.1 RMS reference)
  const targetRms = 0.1 * Math.pow(10, options.powerDb / 20);
  const scale = rms > 0 ? targetRms / rms : 0;

  for (let i = 0; i < length; i++) {
    output[i] *= scale;
  }

  return output;
}

/**
 * Generate broadband interference with amplitude modulation
 *
 * Creates more realistic interference that varies in intensity
 * (like power line noise or intermittent sources).
 *
 * @param length - Number of samples
 * @param options - Interference configuration
 * @param sampleRate - Sample rate in Hz
 * @param modRate - Modulation rate in Hz (0.5-5 Hz typical)
 * @param modDepth - Modulation depth (0-1)
 * @param seed - Random seed
 * @returns Float32Array of modulated interference
 */
export function generateModulatedBroadbandInterference(
  length: number,
  options: BroadbandInterferenceOptions,
  sampleRate: number,
  modRate: number = 1.5,
  modDepth: number = 0.5,
  seed?: number
): Float32Array {
  const prng = createPrng(seed ?? randomSeed());

  // Generate base interference
  const base = generateBroadbandInterference(length, options, sampleRate, seed);

  // Apply slow amplitude modulation
  const modPhase = prng() * 2 * Math.PI;

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const mod =
      1 - modDepth * (0.5 + 0.5 * Math.sin(2 * Math.PI * modRate * t + modPhase));
    base[i] *= mod;
  }

  return base;
}

/**
 * Generate random broadband interference options
 *
 * @param prng - PRNG function
 * @returns BroadbandInterferenceOptions
 */
export function randomBroadbandInterferenceOptions(
  prng: () => number = Math.random
): BroadbandInterferenceOptions {
  return {
    // Center: 200-3000 Hz
    centerFrequency: 200 + prng() * 2800,
    // Bandwidth: 200-2000 Hz
    bandwidth: 200 + prng() * 1800,
    // Power: -10 to +5 dB relative to noise floor
    powerDb: -10 + prng() * 15,
  };
}

/**
 * Mix broadband interference with audio
 *
 * @param audio - Main audio signal
 * @param interference - Broadband interference
 * @returns Mixed audio
 */
export function mixBroadbandInterference(
  audio: Float32Array,
  interference: Float32Array
): Float32Array {
  const output = new Float32Array(audio.length);
  const len = Math.min(audio.length, interference.length);

  for (let i = 0; i < audio.length; i++) {
    output[i] = audio[i];
    if (i < len) {
      output[i] += interference[i];
    }
  }

  return output;
}
