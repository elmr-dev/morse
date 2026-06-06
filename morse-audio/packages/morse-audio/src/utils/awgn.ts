/**
 * Additive White Gaussian Noise (AWGN) generator
 *
 * SNR is defined as a total-energy ratio over the full waveform (including silence),
 * matching the Kaggle dataset definition:
 *   SNR_dB = 10 * log10(signal_power_total / noise_power_per_sample)
 *
 * This means at -12 dB the noise energy equals ~16x the total signal energy,
 * so the signal is genuinely buried — matching real-world and Kaggle samples.
 * DSP filtering (bandpass, CW filter) is applied separately before the model.
 */

/**
 * Seeded pseudo-random number generator (mulberry32)
 * Provides reproducible noise generation
 */
function createPrng(seed: number): () => number {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a single Gaussian noise sample using Box-Muller transform
 */
function gaussianSample(prng: () => number): number {
  const u1 = prng() || 0.0001;
  const u2 = prng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Apply additive white Gaussian noise to audio samples.
 *
 * SNR is defined as total-energy ratio over the full waveform (including silence),
 * matching the Kaggle/real-world definition:
 *   noise_power = total_signal_power / 10^(snrDb/10)
 *
 * @param samples - Input audio samples (clean signal)
 * @param snrDb - Target SNR in dB (total-energy ratio, full waveform)
 * @param seed - Optional seed for reproducible noise
 * @returns New array with AWGN added
 */
export function applyAWGN(
  samples: Float32Array,
  snrDb: number,
  seed?: number,
): Float32Array {
  const prng = createPrng(seed ?? Math.floor(Math.random() * 2147483647));
  const output = new Float32Array(samples.length);

  // Total signal power per sample (including silence) — Kaggle norm ratio
  let totalPower = 0;
  for (let i = 0; i < samples.length; i++) {
    totalPower += samples[i] * samples[i];
  }
  totalPower /= samples.length;

  if (totalPower < 1e-10) {
    const noiseLevel = 0.01;
    for (let i = 0; i < samples.length; i++) {
      output[i] = samples[i] + gaussianSample(prng) * noiseLevel;
    }
    return output;
  }

  const noisePower = totalPower / Math.pow(10, snrDb / 10);
  const noiseStdDev = Math.sqrt(noisePower);

  for (let i = 0; i < samples.length; i++) {
    output[i] = samples[i] + gaussianSample(prng) * noiseStdDev;
  }

  return output;
}

/**
 * Generate pure AWGN samples (no signal)
 *
 * @param length - Number of samples to generate
 * @param rmsLevel - RMS amplitude of noise (0-1)
 * @param seed - Optional seed for reproducible noise
 * @returns Float32Array of Gaussian noise samples
 */
export function generateAWGN(
  length: number,
  rmsLevel: number = 0.1,
  seed?: number
): Float32Array {
  const prng = createPrng(seed ?? Math.floor(Math.random() * 2147483647));
  const output = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    output[i] = gaussianSample(prng) * rmsLevel;
  }

  return output;
}

/**
 * Measure actual SNR of a signal with noise
 *
 * @param cleanSignal - Original signal without noise
 * @param noisySignal - Signal with noise added
 * @returns Measured SNR in dB
 */
export function measureSNR(
  cleanSignal: Float32Array,
  noisySignal: Float32Array
): number {
  if (cleanSignal.length !== noisySignal.length) {
    throw new Error('Signal lengths must match');
  }

  // Extract noise by subtracting signals
  let signalPower = 0;
  let noisePower = 0;

  for (let i = 0; i < cleanSignal.length; i++) {
    const signal = cleanSignal[i];
    const noise = noisySignal[i] - cleanSignal[i];
    signalPower += signal * signal;
    noisePower += noise * noise;
  }

  if (noisePower === 0) {
    return Infinity;
  }

  return 10 * Math.log10(signalPower / noisePower);
}

export { createPrng, gaussianSample };
