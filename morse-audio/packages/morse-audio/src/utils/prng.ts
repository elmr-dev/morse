/**
 * Seeded pseudo-random number generator utilities
 *
 * Provides deterministic random number generation for reproducible
 * audio generation and effect processing.
 */

/**
 * Create a seeded PRNG using the Mulberry32 algorithm
 *
 * Returns a function that generates random numbers in [0, 1)
 * with the same sequence for the same seed.
 *
 * @param seed - Initial seed value
 * @returns Function that returns random numbers in [0, 1)
 */
export function createPrng(seed: number): () => number {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a Gaussian (normally distributed) random number
 *
 * Uses the Box-Muller transform to convert uniform random numbers
 * to a standard normal distribution (mean=0, stddev=1).
 *
 * @param prng - PRNG function returning values in [0, 1)
 * @returns Gaussian random number with mean=0 and stddev=1
 */
export function gaussianRandom(prng: () => number): number {
  const u1 = prng() || 0.0001; // Avoid log(0)
  const u2 = prng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Generate a random integer seed
 *
 * @returns Random seed value suitable for createPrng
 */
export function randomSeed(): number {
  return Math.floor(Math.random() * 2147483647);
}
