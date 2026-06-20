/**
 * Ionospheric fading simulation
 *
 * Simulates HF propagation fading using sum-of-sinusoids envelope modulation.
 * This is different from the flutter.ts rapid AM modulation - ionospheric
 * fading is slower and more organic, representing the changing propagation
 * path through the ionosphere.
 *
 * Formula:
 *   blended = weighted average of sin(2*pi*f_i*t + phi_i), in [-1, 1]
 *   envelope = 1 - depth * (1 - (blended + 1) / 2)
 */

/**
 * Ionospheric fading configuration
 */
export interface IonosphericFadingOptions {
  /** Fading depth (0-0.9, how deep the fades are) */
  depth: number;
  /** Primary fading rate in Hz (typical slow QSB: 0.05-0.35 Hz) */
  rate: number;
  /** Number of sinusoid components (1-5) */
  components?: number;
  /** Initial phases for each component */
  phases?: number[];
}

/**
 * Fading severity profile
 */
export type FadingSeverity = 'none' | 'mild' | 'moderate' | 'severe';

/**
 * Default parameters for each severity level
 */
export const FADING_PROFILES: Record<
  FadingSeverity,
  IonosphericFadingOptions | null
> = {
  none: null,
  mild: { depth: 0.25, rate: 0.08, components: 1 },
  moderate: { depth: 0.55, rate: 0.16, components: 2 },
  severe: { depth: 0.75, rate: 0.25, components: 3 },
};

/**
 * Distribution of fading severities for ML training
 * none: 25%, mild: 30%, moderate: 30%, severe: 15%
 */
export const FADING_DISTRIBUTION: Array<{
  severity: FadingSeverity;
  probability: number;
}> = [
  { severity: 'none', probability: 0.25 },
  { severity: 'mild', probability: 0.3 },
  { severity: 'moderate', probability: 0.3 },
  { severity: 'severe', probability: 0.15 },
];

/**
 * Ionospheric fading processor
 */
export class IonosphericFading {
  private depth: number;
  private rates: number[];
  private phases: number[];
  private components: number;

  constructor(options: IonosphericFadingOptions, seed?: number) {
    this.depth = Math.max(0, Math.min(0.9, options.depth));
    this.components = Math.max(1, Math.min(5, options.components ?? 2));

    // Slow QSB in real recordings is broad and sinusoidal: a main multi-second
    // swing plus a smaller faster component, not rapid product modulation.
    this.rates = [];
    const factors =
      this.components === 1
        ? [1]
        : this.components === 2
          ? [0.5, 1.7]
          : this.components === 3
            ? [0.5, 1.0, 1.7]
            : [0.45, 0.8, 1.25, 1.7, 2.2];
    for (let i = 0; i < this.components; i++) {
      this.rates.push(options.rate * factors[i]);
    }

    // Use provided phases or generate random ones
    if (options.phases && options.phases.length >= this.components) {
      this.phases = options.phases.slice(0, this.components);
    } else {
      // Generate deterministic phases from seed or random
      const prng = seed !== undefined ? this.createPrng(seed) : Math.random;
      this.phases = [];
      for (let i = 0; i < this.components; i++) {
        this.phases.push(prng() * 2 * Math.PI);
      }
    }
  }

  private createPrng(seed: number): () => number {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Get envelope multiplier at a given time
   *
   * @param timeSeconds - Time in seconds
   * @returns Envelope multiplier (0 to 1)
   */
  getEnvelope(timeSeconds: number): number {
    let combined = 0;
    let totalWeight = 0;

    for (let i = 0; i < this.components; i++) {
      const weight = 1 / 2 ** i;
      combined +=
        weight *
        Math.sin(2 * Math.PI * this.rates[i] * timeSeconds + this.phases[i]);
      totalWeight += weight;
    }

    const modulation = 0.5 + 0.5 * (combined / totalWeight);
    return 1 - this.depth * (1 - modulation);
  }

  /**
   * Get envelope at a sample index
   *
   * @param sampleIndex - Sample index
   * @param sampleRate - Sample rate in Hz
   * @returns Envelope multiplier (0 to 1)
   */
  getEnvelopeAtSample(sampleIndex: number, sampleRate: number): number {
    return this.getEnvelope(sampleIndex / sampleRate);
  }
}

/**
 * Apply ionospheric fading to audio samples
 *
 * @param samples - Input audio samples
 * @param options - Fading configuration
 * @param sampleRate - Sample rate in Hz
 * @param seed - Optional seed for reproducible phases
 * @returns New array with fading applied
 */
export function applyIonosphericFading(
  samples: Float32Array,
  options: IonosphericFadingOptions,
  sampleRate: number,
  seed?: number
): Float32Array {
  const fading = new IonosphericFading(options, seed);
  const output = new Float32Array(samples.length);

  for (let i = 0; i < samples.length; i++) {
    output[i] = samples[i] * fading.getEnvelopeAtSample(i, sampleRate);
  }

  return output;
}

/**
 * Generate ionospheric fading envelope
 *
 * @param length - Number of samples
 * @param options - Fading configuration
 * @param sampleRate - Sample rate in Hz
 * @param seed - Optional seed for reproducible phases
 * @returns Float32Array of envelope values (0 to 1)
 */
export function generateIonosphericFadingEnvelope(
  length: number,
  options: IonosphericFadingOptions,
  sampleRate: number,
  seed?: number
): Float32Array {
  const fading = new IonosphericFading(options, seed);
  const envelope = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    envelope[i] = fading.getEnvelopeAtSample(i, sampleRate);
  }

  return envelope;
}

/**
 * Select random fading severity based on distribution
 *
 * @param prng - Optional PRNG function
 * @returns FadingSeverity
 */
export function randomFadingSeverity(
  prng: () => number = Math.random
): FadingSeverity {
  const r = prng();
  let cumulative = 0;

  for (const { severity, probability } of FADING_DISTRIBUTION) {
    cumulative += probability;
    if (r < cumulative) {
      return severity;
    }
  }

  return 'moderate'; // fallback
}

/**
 * Generate random ionospheric fading options
 *
 * @param severity - Fading severity level
 * @param prng - Optional PRNG function
 * @returns IonosphericFadingOptions or null for 'none'
 */
export function randomIonosphericFadingOptions(
  severity?: FadingSeverity,
  prng: () => number = Math.random
): IonosphericFadingOptions | null {
  const actualSeverity = severity ?? randomFadingSeverity(prng);

  const profile = FADING_PROFILES[actualSeverity];
  if (!profile) {
    return null;
  }

  // Add bounded variation around the slow profile.
  const depth = Math.max(
    0,
    Math.min(0.9, profile.depth * (0.8 + prng() * 0.4))
  );
  const rate = Math.max(
    0.03,
    Math.min(0.45, profile.rate * (0.75 + prng() * 0.5))
  );
  return {
    depth,
    rate,
    components: profile.components,
    phases: Array.from(
      { length: profile.components ?? 3 },
      () => prng() * 2 * Math.PI
    ),
  };
}
