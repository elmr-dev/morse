/**
 * Doppler spread simulation
 *
 * Simulates frequency smearing caused by ionospheric motion and
 * changing propagation paths. This creates a "fuzzy" or "watery"
 * quality to the tone rather than a clean sine wave.
 *
 * Implemented by summing slightly detuned copies of the signal,
 * similar to a chorus effect but modeling physical propagation.
 */

/**
 * Doppler spread configuration
 */
export interface DopplerSpreadOptions {
  /** Maximum frequency spread in Hz (1-20 Hz typical) */
  spreadHz: number;
  /** Number of frequency components (3-7) */
  components?: number;
}

/**
 * Apply Doppler spread to audio samples
 *
 * Creates frequency smearing by summing slightly detuned copies
 * of the signal with the detuning distributed across the spread range.
 *
 * @param samples - Input audio samples (must be a tone)
 * @param envelope - Keying envelope (0-1 values)
 * @param baseFrequency - Base tone frequency in Hz
 * @param options - Doppler spread configuration
 * @param sampleRate - Sample rate in Hz
 * @param seed - Optional seed for reproducibility
 * @returns New array with Doppler spread applied
 */
export function applyDopplerSpread(
  samples: Float32Array,
  envelope: Float32Array,
  baseFrequency: number,
  options: DopplerSpreadOptions,
  sampleRate: number,
  seed?: number
): Float32Array {
  const prng = seed !== undefined ? createPrng(seed) : Math.random;
  const numComponents = Math.max(3, Math.min(7, options.components ?? 5));
  const spreadHz = Math.max(1, Math.min(20, options.spreadHz));

  const output = new Float32Array(samples.length);
  const twoPi = 2 * Math.PI;

  // Generate frequency offsets distributed across the spread
  const offsets: number[] = [];
  const amplitudes: number[] = [];

  for (let i = 0; i < numComponents; i++) {
    // Distribute offsets evenly with some randomness
    const normalizedPos = (i / (numComponents - 1)) - 0.5; // -0.5 to 0.5
    const randomJitter = (prng() - 0.5) * 0.3; // ±15% jitter
    offsets.push((normalizedPos + randomJitter) * spreadHz * 2);

    // Amplitudes: center component strongest, edges weaker (Gaussian-ish)
    const distFromCenter = Math.abs(normalizedPos);
    amplitudes.push(Math.exp(-distFromCenter * distFromCenter * 4));
  }

  // Normalize amplitudes
  const ampSum = amplitudes.reduce((a, b) => a + b, 0);
  for (let i = 0; i < amplitudes.length; i++) {
    amplitudes[i] /= ampSum;
  }

  // Generate each component and sum
  const phases = offsets.map(() => prng() * twoPi);

  for (let i = 0; i < samples.length; i++) {
    let sum = 0;

    for (let c = 0; c < numComponents; c++) {
      const freq = baseFrequency + offsets[c];
      const phase = phases[c] + (twoPi * freq * i) / sampleRate;
      sum += Math.sin(phase) * amplitudes[c];
    }

    output[i] = sum * envelope[i] * 0.8;
  }

  return output;
}

/**
 * Apply Doppler spread as post-processing to existing audio
 *
 * This version doesn't require regenerating the tone - it applies
 * a smearing effect by mixing in detuned versions.
 *
 * @param samples - Input audio samples
 * @param options - Doppler spread configuration
 * @param sampleRate - Sample rate in Hz
 * @param seed - Optional seed for reproducibility
 * @returns New array with Doppler spread applied
 */
export function applyDopplerSpreadPost(
  samples: Float32Array,
  options: DopplerSpreadOptions,
  sampleRate: number,
  seed?: number
): Float32Array {
  const prng = seed !== undefined ? createPrng(seed) : Math.random;
  const numCopies = 3; // Keep it simple for post-processing
  const spreadHz = Math.max(1, Math.min(20, options.spreadHz));

  const output = new Float32Array(samples.length);
  const twoPi = 2 * Math.PI;

  // Start with original signal at reduced amplitude
  const mainWeight = 0.6;
  for (let i = 0; i < samples.length; i++) {
    output[i] = samples[i] * mainWeight;
  }

  // Add frequency-shifted copies using single-sideband-like modulation
  // This is an approximation that creates frequency shifting effect
  const copyWeight = (1 - mainWeight) / numCopies;

  for (let c = 0; c < numCopies; c++) {
    const freqShift = (prng() - 0.5) * spreadHz * 2;
    const phase = prng() * twoPi;

    for (let i = 0; i < samples.length; i++) {
      // Simple frequency shift via multiplication with complex exponential
      // Only using the real part (cosine) for a basic shift effect
      const shiftPhase = phase + (twoPi * freqShift * i) / sampleRate;
      output[i] += samples[i] * Math.cos(shiftPhase) * copyWeight;
    }
  }

  return output;
}

/**
 * Generate random Doppler spread options
 *
 * @param prng - Optional PRNG function
 * @returns DopplerSpreadOptions
 */
export function randomDopplerSpreadOptions(
  prng: () => number = Math.random
): DopplerSpreadOptions {
  return {
    spreadHz: 1 + prng() * 19, // 1-20 Hz
    components: 3 + Math.floor(prng() * 5), // 3-7 components
  };
}

/**
 * Seeded PRNG
 */
function createPrng(seed: number): () => number {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
