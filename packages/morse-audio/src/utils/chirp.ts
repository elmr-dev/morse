/**
 * Chirp processor for frequency drift on keying
 *
 * Chirp simulates the characteristic frequency drift of older or poorly
 * regulated transmitters when the key is pressed. The frequency shifts
 * (typically rises) at key-down and settles back to the nominal frequency.
 *
 * This is a common imperfection heard on HF, especially from:
 * - Older tube transmitters
 * - QRP rigs with simple oscillators
 * - Stations with power supply issues
 */

import type { ChirpOptions } from '../pileup/types';

/**
 * Chirp effect processor
 *
 * Tracks keying state from the audio envelope and applies frequency
 * deviation with exponential decay.
 */
export class Chirp {
  private deviation: number;
  private timeConstant: number;
  private currentDeviation: number;
  private decayFactor: number;
  private attackFactor: number;
  private keyState: boolean;
  private envelopeThreshold: number;

  /**
   * Create a new chirp processor
   *
   * @param options - Chirp configuration
   * @param sampleRate - Audio sample rate in Hz
   */
  constructor(options: ChirpOptions, sampleRate: number) {
    // Clamp deviation to valid range (5-50 Hz)
    this.deviation = Math.max(5, Math.min(50, options.deviation));

    // Time constant in ms (10-100 ms)
    this.timeConstant = Math.max(10, Math.min(100, options.timeConstant));

    this.currentDeviation = 0;
    this.keyState = false;
    this.envelopeThreshold = 0.1; // Detect key-down when envelope > 10%

    // Calculate decay factor for exponential decay
    // After timeConstant ms, deviation should be reduced to ~37% (1/e)
    const timeConstantSamples = (this.timeConstant / 1000) * sampleRate;
    this.decayFactor = Math.exp(-1 / timeConstantSamples);

    // Attack is faster than decay (typical of real chirp)
    this.attackFactor = Math.exp(-4 / timeConstantSamples);
  }

  /**
   * Process a sample and get the frequency offset
   *
   * @param envelope - Current envelope value (0-1, from keying)
   * @returns Frequency offset in Hz to add to base frequency
   */
  getFrequencyOffset(envelope: number): number {
    const isKeyDown = envelope > this.envelopeThreshold;

    if (isKeyDown && !this.keyState) {
      // Key just pressed - jump to full deviation
      this.currentDeviation = this.deviation;
    }

    this.keyState = isKeyDown;

    if (isKeyDown) {
      // During key-down, decay toward zero
      this.currentDeviation *= this.decayFactor;
    } else {
      // During key-up, decay faster (key-up chirp is typically shorter)
      this.currentDeviation *= this.attackFactor;
    }

    return this.currentDeviation;
  }

  /**
   * Reset the chirp state
   */
  reset(): void {
    this.currentDeviation = 0;
    this.keyState = false;
  }
}

/**
 * Apply chirp to audio samples
 *
 * This requires re-synthesizing the tone with varying frequency,
 * so it needs the original envelope and base frequency.
 *
 * @param samples - Input audio samples (must be pure tone with envelope)
 * @param envelope - Keying envelope (0-1 values)
 * @param baseFrequency - Base tone frequency in Hz
 * @param options - Chirp configuration
 * @param sampleRate - Audio sample rate in Hz
 * @returns New array with chirp applied
 */
export function applyChirp(
  samples: Float32Array,
  envelope: Float32Array,
  baseFrequency: number,
  options: ChirpOptions,
  sampleRate: number
): Float32Array {
  const chirp = new Chirp(options, sampleRate);
  const output = new Float32Array(samples.length);

  // We need to regenerate the signal with varying frequency
  let phase = 0;
  const twoPi = 2 * Math.PI;

  for (let i = 0; i < samples.length; i++) {
    // Get frequency offset based on envelope
    const freqOffset = chirp.getFrequencyOffset(envelope[i]);

    // Calculate instantaneous frequency
    const freq = baseFrequency + freqOffset;

    // Generate sample with varying frequency
    output[i] = Math.sin(phase) * envelope[i] * 0.8;

    // Advance phase based on instantaneous frequency
    phase += (twoPi * freq) / sampleRate;
    if (phase >= twoPi) {
      phase -= twoPi;
    }
  }

  return output;
}

/**
 * Generate chirp frequency offset envelope (for mixing scenarios)
 *
 * @param envelope - Keying envelope (0-1 values)
 * @param options - Chirp configuration
 * @param sampleRate - Audio sample rate in Hz
 * @returns Float32Array of frequency offsets in Hz
 */
export function generateChirpOffsets(
  envelope: Float32Array,
  options: ChirpOptions,
  sampleRate: number
): Float32Array {
  const chirp = new Chirp(options, sampleRate);
  const offsets = new Float32Array(envelope.length);

  for (let i = 0; i < envelope.length; i++) {
    offsets[i] = chirp.getFrequencyOffset(envelope[i]);
  }

  return offsets;
}
