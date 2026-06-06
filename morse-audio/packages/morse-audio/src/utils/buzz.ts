/**
 * Buzz processor for AC hum simulation
 *
 * Buzz simulates AC power supply hum that modulates a signal. This is
 * common with older equipment or stations with poor filtering.
 * The effect adds the fundamental frequency (50 or 60 Hz) plus harmonics.
 */

import type { BuzzOptions } from '../pileup/types';

/**
 * Buzz effect processor
 *
 * Generates AC hum with fundamental and harmonics, applied as
 * additive interference to the signal.
 */
export class Buzz {
  private frequency: number;
  private amplitude: number;
  private sampleRate: number;
  private harmonicAmplitudes: number[];

  /**
   * Create a new buzz processor
   *
   * @param options - Buzz configuration
   * @param sampleRate - Audio sample rate in Hz
   */
  constructor(options: BuzzOptions, sampleRate: number) {
    // Only 50 or 60 Hz are valid
    this.frequency = options.frequency === 50 ? 50 : 60;

    // Clamp amplitude to valid range (0-0.3)
    this.amplitude = Math.max(0, Math.min(0.3, options.amplitude));

    this.sampleRate = sampleRate;

    // Harmonic structure typical of rectified AC hum
    // Includes odd and even harmonics with decreasing amplitude
    this.harmonicAmplitudes = [
      1.0,   // Fundamental
      0.5,   // 2nd harmonic (often strong with full-wave rectification)
      0.3,   // 3rd harmonic
      0.15,  // 4th harmonic
      0.08,  // 5th harmonic
    ];
  }

  /**
   * Get the buzz signal value for a given sample index
   *
   * @param sampleIndex - Current sample position
   * @returns Buzz value to add to the signal
   */
  getSample(sampleIndex: number): number {
    const time = sampleIndex / this.sampleRate;
    let buzz = 0;

    // Sum fundamental and harmonics
    for (let h = 0; h < this.harmonicAmplitudes.length; h++) {
      const harmonicFreq = this.frequency * (h + 1);
      buzz += this.harmonicAmplitudes[h] * Math.sin(2 * Math.PI * harmonicFreq * time);
    }

    // Normalize by sum of harmonic amplitudes
    const sum = this.harmonicAmplitudes.reduce((a, b) => a + b, 0);
    buzz /= sum;

    return buzz * this.amplitude;
  }

  /**
   * Get the amplitude modulation factor for a given sample index
   * Use this for AM-style buzz (modulates signal amplitude)
   *
   * @param sampleIndex - Current sample position
   * @returns Amplitude multiplier (0.7 to 1.3 at max amplitude)
   */
  getAmplitudeModulation(sampleIndex: number): number {
    const buzz = this.getSample(sampleIndex) / this.amplitude;
    // Map from [-1, 1] to [1-amp, 1+amp]
    return 1 + buzz * this.amplitude;
  }
}

/**
 * Apply buzz as additive interference to audio samples
 *
 * @param samples - Input audio samples
 * @param options - Buzz configuration
 * @param sampleRate - Audio sample rate in Hz
 * @returns New array with buzz added
 */
export function applyBuzz(
  samples: Float32Array,
  options: BuzzOptions,
  sampleRate: number
): Float32Array {
  const buzz = new Buzz(options, sampleRate);
  const output = new Float32Array(samples.length);

  for (let i = 0; i < samples.length; i++) {
    // Add buzz to the signal
    output[i] = samples[i] + buzz.getSample(i);
  }

  return output;
}

/**
 * Apply buzz as amplitude modulation to audio samples
 *
 * @param samples - Input audio samples
 * @param options - Buzz configuration
 * @param sampleRate - Audio sample rate in Hz
 * @returns New array with buzz modulation applied
 */
export function applyBuzzAM(
  samples: Float32Array,
  options: BuzzOptions,
  sampleRate: number
): Float32Array {
  const buzz = new Buzz(options, sampleRate);
  const output = new Float32Array(samples.length);

  for (let i = 0; i < samples.length; i++) {
    // Modulate signal amplitude with buzz
    output[i] = samples[i] * buzz.getAmplitudeModulation(i);
  }

  return output;
}

/**
 * Generate buzz signal (for mixing scenarios)
 *
 * @param length - Number of samples
 * @param options - Buzz configuration
 * @param sampleRate - Audio sample rate in Hz
 * @returns Float32Array of buzz values
 */
export function generateBuzzSignal(
  length: number,
  options: BuzzOptions,
  sampleRate: number
): Float32Array {
  const buzz = new Buzz(options, sampleRate);
  const signal = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    signal[i] = buzz.getSample(i);
  }

  return signal;
}
