/**
 * Automatic Gain Control (AGC) simulation
 *
 * Simulates the AGC circuit found in radio receivers that automatically
 * adjusts gain to maintain consistent output level despite varying
 * input signal strength.
 *
 * AGC is characterized by:
 * - Attack time: How quickly gain reduces when signal increases
 * - Release time: How slowly gain increases when signal decreases
 * - Target level: Desired output amplitude
 * - Max gain: Maximum amplification allowed
 */

/**
 * AGC configuration
 */
export interface AGCOptions {
  /** Attack time in milliseconds (how fast to reduce gain) */
  attackMs?: number;
  /** Release time in milliseconds (how slow to increase gain) */
  releaseMs?: number;
  /** Target output level (0-1) */
  targetLevel?: number;
  /** Maximum gain allowed */
  maxGain?: number;
}

/**
 * Default AGC parameters
 */
export const AGC_DEFAULTS: Required<AGCOptions> = {
  attackMs: 10,
  releaseMs: 100,
  targetLevel: 0.7,
  maxGain: 10,
};

/**
 * AGC processor with envelope follower
 */
export class AGC {
  private attackCoeff: number;
  private releaseCoeff: number;
  private targetLevel: number;
  private maxGain: number;
  private envelope: number;
  private gain: number;

  /**
   * Create a new AGC processor
   *
   * @param sampleRate - Audio sample rate in Hz
   * @param options - AGC configuration
   */
  constructor(sampleRate: number, options?: AGCOptions) {
    const opts = { ...AGC_DEFAULTS, ...options };

    // Calculate time constants
    // tau = -1 / (sampleRate * ln(1 - 1/tau_samples))
    // Simplified: coeff = 1 - exp(-1 / (tau * sampleRate))
    this.attackCoeff = 1 - Math.exp(-1000 / (opts.attackMs * sampleRate));
    this.releaseCoeff = 1 - Math.exp(-1000 / (opts.releaseMs * sampleRate));

    this.targetLevel = Math.max(0.1, Math.min(1, opts.targetLevel));
    this.maxGain = Math.max(1, Math.min(100, opts.maxGain));

    this.envelope = 0;
    this.gain = 1;
  }

  /**
   * Process a single sample through the AGC
   *
   * @param sample - Input sample
   * @returns Gain-adjusted output sample
   */
  process(sample: number): number {
    const absInput = Math.abs(sample);

    // Update envelope follower (peak detector with different attack/release)
    if (absInput > this.envelope) {
      // Attack: envelope rises quickly
      this.envelope += this.attackCoeff * (absInput - this.envelope);
    } else {
      // Release: envelope falls slowly
      this.envelope += this.releaseCoeff * (absInput - this.envelope);
    }

    // Prevent divide-by-zero
    const safeEnvelope = Math.max(this.envelope, 0.001);

    // Calculate desired gain to reach target level
    const desiredGain = this.targetLevel / safeEnvelope;

    // Clamp gain to maximum
    const targetGain = Math.min(desiredGain, this.maxGain);

    // Smooth gain changes (use release time constant for stability)
    if (targetGain < this.gain) {
      this.gain += this.attackCoeff * (targetGain - this.gain);
    } else {
      this.gain += this.releaseCoeff * (targetGain - this.gain);
    }

    // Apply gain
    return sample * this.gain;
  }

  /**
   * Reset the AGC state
   */
  reset(): void {
    this.envelope = 0;
    this.gain = 1;
  }

  /**
   * Get current gain value
   */
  getGain(): number {
    return this.gain;
  }

  /**
   * Get current envelope value
   */
  getEnvelope(): number {
    return this.envelope;
  }
}

/**
 * Apply AGC to audio samples
 *
 * @param samples - Input audio samples
 * @param sampleRate - Sample rate in Hz
 * @param options - AGC configuration
 * @returns New array with AGC applied
 */
export function applyAGC(
  samples: Float32Array,
  sampleRate: number,
  options?: AGCOptions
): Float32Array {
  const agc = new AGC(sampleRate, options);
  const output = new Float32Array(samples.length);

  for (let i = 0; i < samples.length; i++) {
    output[i] = agc.process(samples[i]);
  }

  // Final soft clip to prevent any overshoots
  for (let i = 0; i < output.length; i++) {
    if (output[i] > 1) output[i] = 1;
    else if (output[i] < -1) output[i] = -1;
  }

  return output;
}

/**
 * Generate random AGC options with variation
 *
 * @param prng - Optional PRNG function
 * @returns AGCOptions
 */
export function randomAGCOptions(
  prng: () => number = Math.random
): AGCOptions {
  return {
    attackMs: 5 + prng() * 20, // 5-25 ms
    releaseMs: 50 + prng() * 150, // 50-200 ms
    targetLevel: 0.5 + prng() * 0.3, // 0.5-0.8
    maxGain: 5 + prng() * 10, // 5-15
  };
}
