/**
 * Multipath propagation simulation
 *
 * Simulates the delay spread caused by signals arriving via multiple
 * ionospheric paths. This creates a smearing/echo effect that degrades
 * CW copy, particularly at higher speeds.
 *
 * In HF propagation, multipath occurs when the signal travels via
 * multiple hops (e.g., 1-hop and 2-hop paths) arriving at slightly
 * different times.
 */

/**
 * Single path configuration
 */
export interface PathConfig {
  /** Delay in milliseconds (1-10 ms typical for HF) */
  delayMs: number;
  /** Amplitude relative to main signal (0-1) */
  amplitude: number;
  /** Phase offset (0 to 2*PI) */
  phase?: number;
}

/**
 * Multipath configuration
 */
export interface MultipathOptions {
  /** Array of path configurations (main signal is implicit at delay 0) */
  paths: PathConfig[];
}

/**
 * Apply multipath propagation to audio samples
 *
 * Adds delayed copies of the signal with attenuation to simulate
 * multiple propagation paths arriving at different times.
 *
 * @param samples - Input audio samples
 * @param options - Multipath configuration
 * @param sampleRate - Sample rate in Hz
 * @returns New array with multipath effects applied
 */
export function applyMultipath(
  samples: Float32Array,
  options: MultipathOptions,
  sampleRate: number
): Float32Array {
  const output = new Float32Array(samples.length);

  // Start with the original signal
  for (let i = 0; i < samples.length; i++) {
    output[i] = samples[i];
  }

  // Add delayed paths
  for (const path of options.paths) {
    const delaySamples = Math.round((path.delayMs / 1000) * sampleRate);
    const phaseShift = path.phase ?? 0;

    for (let i = 0; i < samples.length; i++) {
      const sourceIndex = i - delaySamples;
      if (sourceIndex >= 0 && sourceIndex < samples.length) {
        // For phase shift, we'd need to do a Hilbert transform, but for
        // simplicity we'll just apply the amplitude. Phase shifts mainly
        // cause interference patterns which we can approximate by varying
        // the sign based on phase.
        const phaseFactor = Math.cos(phaseShift);
        output[i] += samples[sourceIndex] * path.amplitude * phaseFactor;
      }
    }
  }

  // Normalize to prevent clipping
  let maxAmp = 0;
  for (let i = 0; i < output.length; i++) {
    maxAmp = Math.max(maxAmp, Math.abs(output[i]));
  }

  if (maxAmp > 1) {
    const scale = 1 / maxAmp;
    for (let i = 0; i < output.length; i++) {
      output[i] *= scale;
    }
  }

  return output;
}

/**
 * Generate random multipath configuration
 *
 * Creates 2-4 delayed paths with appropriate parameters for HF propagation.
 *
 * @param prng - Optional PRNG function
 * @returns MultipathOptions
 */
export function randomMultipathOptions(
  prng: () => number = Math.random
): MultipathOptions {
  const numPaths = 2 + Math.floor(prng() * 3); // 2-4 paths
  const paths: PathConfig[] = [];

  // Generate paths with increasing delay and decreasing amplitude
  for (let i = 0; i < numPaths; i++) {
    // Delay increases with each path (1-10 ms range)
    const baseDelay = 1 + prng() * 3; // 1-4 ms base
    const delayMs = baseDelay * (i + 1);

    // Decay factor 0.3-0.7 per path
    const decayFactor = 0.3 + prng() * 0.4;
    const amplitude = Math.pow(decayFactor, i + 1);

    // Random phase offset
    const phase = prng() * 2 * Math.PI;

    paths.push({ delayMs, amplitude, phase });
  }

  return { paths };
}

/**
 * Create multipath options with specific delay spread
 *
 * @param maxDelayMs - Maximum delay in ms
 * @param numPaths - Number of paths (2-4)
 * @param decayFactor - Amplitude decay factor (0.3-0.7)
 * @param seed - Optional seed for reproducibility
 * @returns MultipathOptions
 */
export function createMultipathOptions(
  maxDelayMs: number,
  numPaths: number,
  decayFactor: number,
  seed?: number
): MultipathOptions {
  const prng = seed !== undefined ? createPrng(seed) : Math.random;
  const paths: PathConfig[] = [];

  const clampedPaths = Math.max(2, Math.min(4, numPaths));
  const clampedDecay = Math.max(0.3, Math.min(0.7, decayFactor));
  const clampedDelay = Math.max(1, Math.min(10, maxDelayMs));

  for (let i = 0; i < clampedPaths; i++) {
    const delayMs = (clampedDelay / clampedPaths) * (i + 1);
    const amplitude = Math.pow(clampedDecay, i + 1);
    const phase = prng() * 2 * Math.PI;

    paths.push({ delayMs, amplitude, phase });
  }

  return { paths };
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
