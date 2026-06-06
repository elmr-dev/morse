/**
 * Bandwidth filter for receiver selectivity simulation
 *
 * Simulates the IF (intermediate frequency) filter of a receiver,
 * attenuating signals that are off-center from the receiver's
 * tuned frequency. This is essential for pileup simulation where
 * different stations are spread across the audio passband.
 */

/**
 * Biquad bandpass filter implementation
 *
 * Uses standard biquad filter equations for a bandpass response
 * centered on the desired frequency.
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

  /**
   * Create a bandpass filter
   *
   * @param centerFreq - Center frequency in Hz
   * @param bandwidth - Bandwidth in Hz (-3dB points)
   * @param sampleRate - Sample rate in Hz
   */
  constructor(centerFreq: number, bandwidth: number, sampleRate: number) {
    // Q factor determines the width of the passband
    const Q = centerFreq / bandwidth;

    const omega = (2 * Math.PI * centerFreq) / sampleRate;
    const sinOmega = Math.sin(omega);
    const cosOmega = Math.cos(omega);
    const alpha = sinOmega / (2 * Q);

    const a0 = 1 + alpha;

    // Bandpass filter coefficients (constant-0dB peak gain)
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

  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
}

/**
 * Multi-stage bandwidth filter for sharper selectivity
 *
 * Cascades multiple filter stages for steeper roll-off,
 * similar to multi-pole crystal or mechanical filters
 * found in real receivers.
 */
export class BandwidthFilter {
  private stages: BiquadBandpass[];
  private centerFreq: number;
  private bandwidth: number;

  /**
   * Create a bandwidth filter
   *
   * @param centerFreq - Center frequency in Hz (receiver sidetone)
   * @param bandwidth - Bandwidth in Hz (100-2400, typically 50 Hz steps)
   * @param sampleRate - Sample rate in Hz
   * @param stages - Number of filter stages (more = sharper, default: 4)
   */
  constructor(
    centerFreq: number,
    bandwidth: number,
    sampleRate: number,
    stages: number = 4
  ) {
    this.centerFreq = centerFreq;
    this.bandwidth = bandwidth;

    // Create cascaded filter stages
    // Each stage adds more selectivity (steeper skirts)
    this.stages = [];
    for (let i = 0; i < stages; i++) {
      this.stages.push(new BiquadBandpass(centerFreq, bandwidth, sampleRate));
    }
  }

  /**
   * Process a single sample through the filter
   *
   * @param x - Input sample
   * @returns Filtered sample
   */
  process(x: number): number {
    let y = x;
    for (const stage of this.stages) {
      y = stage.process(y);
    }
    return y;
  }

  /**
   * Reset the filter state
   */
  reset(): void {
    for (const stage of this.stages) {
      stage.reset();
    }
  }

  /**
   * Calculate the attenuation (in dB) for a signal at a given frequency offset
   *
   * @param frequencyOffset - Offset from center frequency in Hz
   * @returns Attenuation in dB (negative value, 0 = no attenuation)
   */
  calculateAttenuation(frequencyOffset: number): number {
    // Single-stage bandpass has 20 dB/decade roll-off
    // Multi-stage has steeper roll-off
    const stages = this.stages.length;
    const halfBandwidth = this.bandwidth / 2;
    const absOffset = Math.abs(frequencyOffset);

    if (absOffset <= halfBandwidth) {
      // Within passband - minimal attenuation
      // Actually follows a curve, but approximately flat near center
      const normalized = absOffset / halfBandwidth;
      return -3 * Math.pow(normalized, 2) * stages * 0.1;
    } else {
      // Outside passband - calculate roll-off
      // Each stage adds roughly 6 dB/octave
      const octavesFromEdge = Math.log2(absOffset / halfBandwidth);
      return -6 * stages * octavesFromEdge;
    }
  }

  /**
   * Calculate the linear gain for a signal at a given frequency offset
   *
   * @param frequencyOffset - Offset from center frequency in Hz
   * @returns Linear gain multiplier (0 to 1)
   */
  calculateGain(frequencyOffset: number): number {
    const attenuationDb = this.calculateAttenuation(frequencyOffset);
    return Math.pow(10, attenuationDb / 20);
  }

  /**
   * Get filter parameters
   */
  getParams(): { centerFreq: number; bandwidth: number } {
    return {
      centerFreq: this.centerFreq,
      bandwidth: this.bandwidth,
    };
  }
}

/**
 * Apply bandwidth filter to audio samples
 *
 * @param samples - Input audio samples
 * @param centerFreq - Center frequency in Hz
 * @param bandwidth - Bandwidth in Hz
 * @param sampleRate - Sample rate in Hz
 * @param stages - Number of filter stages (default: 4)
 * @returns Filtered samples
 */
export function applyBandwidthFilter(
  samples: Float32Array,
  centerFreq: number,
  bandwidth: number,
  sampleRate: number,
  stages: number = 4
): Float32Array {
  const filter = new BandwidthFilter(centerFreq, bandwidth, sampleRate, stages);
  const output = new Float32Array(samples.length);

  for (let i = 0; i < samples.length; i++) {
    output[i] = filter.process(samples[i]);
  }

  return output;
}

/**
 * Round bandwidth to nearest 50 Hz step (common receiver increments)
 *
 * @param bandwidth - Desired bandwidth in Hz
 * @returns Bandwidth rounded to 50 Hz
 */
export function roundBandwidthTo50Hz(bandwidth: number): number {
  return Math.round(bandwidth / 50) * 50;
}

/**
 * Standard CW bandwidth presets (Hz)
 */
export const BANDWIDTH_PRESETS = {
  NARROW: 100,      // Very selective, for single signal copy
  NORMAL: 250,      // Normal CW operation
  MEDIUM: 500,      // Moderate selectivity
  WIDE: 1000,       // Wide, for searching
  VERY_WIDE: 2400,  // Full audio passband
} as const;
