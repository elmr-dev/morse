/**
 * Pitch wobble / oscillator drift simulation
 *
 * Simulates the slow frequency drift characteristic of:
 * - Unstable VFOs
 * - Temperature drift
 * - Aging oscillators
 * - Poor frequency stability in QRP rigs
 *
 * Formula: f(t) = f_carrier + A_drift * sin(2*pi * f_drift * t + phase)
 */

/**
 * Pitch wobble configuration
 */
export interface PitchWobbleOptions {
  /** Drift amplitude in Hz (0-3 Hz typical) */
  amplitude: number;
  /** Drift rate in Hz (0.01-0.1 Hz, very slow) */
  rate: number;
  /** Initial phase (0 to 2*PI) */
  phase?: number;
}

/**
 * Pitch wobble processor
 *
 * Applies slow sinusoidal frequency drift to simulate
 * oscillator instability.
 */
export class PitchWobble {
  private amplitude: number;
  private rate: number;
  private phase: number;

  constructor(options: PitchWobbleOptions) {
    this.amplitude = Math.max(0, Math.min(3, options.amplitude));
    this.rate = Math.max(0.01, Math.min(0.1, options.rate));
    this.phase = options.phase ?? 0;
  }

  /**
   * Get frequency offset at a given time
   *
   * @param timeSeconds - Time in seconds
   * @returns Frequency offset in Hz
   */
  getOffset(timeSeconds: number): number {
    return this.amplitude * Math.sin(2 * Math.PI * this.rate * timeSeconds + this.phase);
  }

  /**
   * Get frequency offset at a given sample index
   *
   * @param sampleIndex - Sample index
   * @param sampleRate - Sample rate in Hz
   * @returns Frequency offset in Hz
   */
  getOffsetAtSample(sampleIndex: number, sampleRate: number): number {
    return this.getOffset(sampleIndex / sampleRate);
  }
}

/**
 * Apply pitch wobble to audio samples by re-synthesizing with varying frequency
 *
 * @param samples - Input audio samples (must be pure tone with envelope)
 * @param envelope - Keying envelope (0-1 values)
 * @param baseFrequency - Base tone frequency in Hz
 * @param options - Pitch wobble configuration
 * @param sampleRate - Audio sample rate in Hz
 * @returns New array with pitch wobble applied
 */
export function applyPitchWobble(
  samples: Float32Array,
  envelope: Float32Array,
  baseFrequency: number,
  options: PitchWobbleOptions,
  sampleRate: number
): Float32Array {
  const wobble = new PitchWobble(options);
  const output = new Float32Array(samples.length);

  let phase = 0;
  const twoPi = 2 * Math.PI;

  for (let i = 0; i < samples.length; i++) {
    const freqOffset = wobble.getOffsetAtSample(i, sampleRate);
    const freq = baseFrequency + freqOffset;

    output[i] = Math.sin(phase) * envelope[i] * 0.8;

    phase += (twoPi * freq) / sampleRate;
    if (phase >= twoPi) {
      phase -= twoPi;
    }
  }

  return output;
}

/**
 * Generate pitch wobble offset envelope
 *
 * @param length - Number of samples
 * @param options - Pitch wobble configuration
 * @param sampleRate - Sample rate in Hz
 * @returns Float32Array of frequency offsets in Hz
 */
export function generatePitchWobbleOffsets(
  length: number,
  options: PitchWobbleOptions,
  sampleRate: number
): Float32Array {
  const wobble = new PitchWobble(options);
  const offsets = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    offsets[i] = wobble.getOffsetAtSample(i, sampleRate);
  }

  return offsets;
}

/**
 * Generate random pitch wobble options
 *
 * @param prng - Optional PRNG function (defaults to Math.random)
 * @returns PitchWobbleOptions with random parameters
 */
export function randomPitchWobbleOptions(
  prng: () => number = Math.random
): PitchWobbleOptions {
  return {
    amplitude: prng() * 3, // 0-3 Hz
    rate: 0.01 + prng() * 0.09, // 0.01-0.1 Hz
    phase: prng() * 2 * Math.PI,
  };
}
