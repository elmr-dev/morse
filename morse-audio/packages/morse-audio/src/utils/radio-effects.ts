/**
 * Radio effects simulation for realistic HF conditions
 *
 * QRN (static): Realistic radio static with:
 *   - Pink noise (1/f spectrum) with band-pass filtering
 *   - Crackling impulse noise (Poisson-distributed bursts)
 *   - Slow amplitude modulation ("breathing" quality)
 *   - Faint heterodyne tones with drift
 *   - AGC-style soft compression
 *
 * QSB (fading): Signal amplitude variation simulating ionospheric propagation
 */

import {
  DEFAULT_SNR,
  DEFAULT_FADE_DEPTH,
  DEFAULT_FADE_RATE,
  validateSnr,
  validateFadeDepth,
  validateFadeRate,
} from '../constants';
import type { RadioEffectsOptions } from '../types';

/**
 * Simple pseudo-random number generator (mulberry32)
 * Using a seeded PRNG for reproducible noise generation
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
 * Generate Gaussian white noise sample
 */
function gaussianNoise(prng: () => number): number {
  const u1 = prng();
  const u2 = prng();
  return Math.sqrt(-2 * Math.log(u1 || 0.0001)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Simple one-pole low-pass filter
 */
class OnePoleLP {
  private y1 = 0;
  private a: number;

  constructor(cutoffHz: number, sampleRate: number) {
    const rc = 1 / (2 * Math.PI * cutoffHz);
    const dt = 1 / sampleRate;
    this.a = dt / (rc + dt);
  }

  process(x: number): number {
    this.y1 = this.y1 + this.a * (x - this.y1);
    return this.y1;
  }
}

/**
 * Simple one-pole high-pass filter
 */
class OnePoleHP {
  private x1 = 0;
  private y1 = 0;
  private a: number;

  constructor(cutoffHz: number, sampleRate: number) {
    const rc = 1 / (2 * Math.PI * cutoffHz);
    const dt = 1 / sampleRate;
    this.a = rc / (rc + dt);
  }

  process(x: number): number {
    this.y1 = this.a * (this.y1 + x - this.x1);
    this.x1 = x;
    return this.y1;
  }
}

/**
 * Pink noise filter using Paul Kellet's economy method
 * Approximates -3dB/octave slope
 */
class PinkNoiseFilter {
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private b3 = 0;
  private b4 = 0;
  private b5 = 0;
  private b6 = 0;

  process(white: number): number {
    this.b0 = 0.99886 * this.b0 + white * 0.0555179;
    this.b1 = 0.99332 * this.b1 + white * 0.0750759;
    this.b2 = 0.96900 * this.b2 + white * 0.1538520;
    this.b3 = 0.86650 * this.b3 + white * 0.3104856;
    this.b4 = 0.55000 * this.b4 + white * 0.5329522;
    this.b5 = -0.7616 * this.b5 - white * 0.0168980;
    const pink = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + white * 0.5362;
    this.b6 = white * 0.115926;
    return pink * 0.11; // Normalize
  }
}

/**
 * Generate realistic radio static (QRN)
 *
 * Recipe:
 * 1. Generate white noise
 * 2. Convert to pink noise (-3dB/octave)
 * 3. Band-pass filter (200Hz - 4kHz for AM-style)
 * 4. Add crackling impulse layer
 * 5. Apply slow amplitude modulation
 * 6. Add faint heterodyne tones
 * 7. Apply soft compression (AGC simulation)
 * 8. Mix in tiny amount of raw white noise for "air"
 */
function generateRealisticStatic(
  length: number,
  sampleRate: number,
  amplitude: number,
  prng: () => number
): Float32Array {
  const static_ = new Float32Array(length);

  // Filters for spectral shaping
  const pinkFilter = new PinkNoiseFilter();
  const hpFilter = new OnePoleHP(200, sampleRate); // High-pass at 200Hz
  const lpFilter = new OnePoleLP(4000, sampleRate); // Low-pass at 4kHz

  // Slow amplitude modulation parameters (0.5-3 Hz "breathing")
  const modFreq1 = 0.5 + prng() * 1.5; // 0.5-2 Hz
  const modFreq2 = 1.0 + prng() * 2.0; // 1-3 Hz
  const modPhase1 = prng() * 2 * Math.PI;
  const modPhase2 = prng() * 2 * Math.PI;

  // Heterodyne tone parameters (faint tones with drift)
  const toneFreq1 = 500 + prng() * 1500; // 500-2000 Hz
  const toneFreq2 = 600 + prng() * 1200; // 600-1800 Hz
  const toneDrift1 = (prng() - 0.5) * 0.5; // Slow drift rate
  const toneDrift2 = (prng() - 0.5) * 0.3;
  const toneAmp = 0.03; // Faint but audible heterodyne

  // Crackle parameters
  const crackleRate = 15 + prng() * 20; // 15-35 impulses per second
  let nextCrackle = Math.floor(-Math.log(prng()) / crackleRate * sampleRate);
  let crackleEnvelope = 0;

  // Smoothing filter for crackle envelope
  const crackleSmooth = new OnePoleLP(500, sampleRate);

  // Boost factor to compensate for processing chain attenuation
  // Pink filter (~0.11) * band-pass (~0.5) * modulation (~0.85) = ~0.047
  // We want the final RMS to match the target amplitude
  const processingBoost = 12.0;

  // Generate static sample by sample
  for (let i = 0; i < length; i++) {
    const time = i / sampleRate;

    // 1. Generate white noise
    const white = gaussianNoise(prng);

    // 2. Convert to pink noise
    const pink = pinkFilter.process(white);

    // 3. Band-pass filter
    const filtered = lpFilter.process(hpFilter.process(pink));

    // 4. Crackling impulse layer
    if (i >= nextCrackle) {
      // Trigger new crackle
      crackleEnvelope = 0.5 + prng() * 0.5; // Random intensity
      // Schedule next crackle (Poisson process)
      nextCrackle = i + Math.floor(-Math.log(prng() || 0.001) / crackleRate * sampleRate);
    }
    // Exponential decay for crackle
    crackleEnvelope *= 0.995;
    const crackle = crackleSmooth.process(gaussianNoise(prng) * crackleEnvelope);

    // 5. Combine noise and crackle (boost to compensate for filtering)
    let noise = (filtered * processingBoost) + (crackle * 2.0);

    // 6. Apply slow amplitude modulation ("breathing")
    const mod = 0.7 + 0.3 * (
      0.6 * Math.sin(2 * Math.PI * modFreq1 * time + modPhase1) +
      0.4 * Math.sin(2 * Math.PI * modFreq2 * time + modPhase2)
    );
    noise *= mod;

    // 7. Add faint heterodyne tones with drift
    const tone1 = Math.sin(2 * Math.PI * (toneFreq1 + toneDrift1 * time) * time);
    const tone2 = Math.sin(2 * Math.PI * (toneFreq2 + toneDrift2 * time) * time);
    noise += (tone1 + tone2 * 0.7) * toneAmp;

    // 8. Add tiny bit of raw white noise for "air"
    noise += white * 0.08;

    // 9. Soft compression (AGC simulation) - tanh soft clipping
    noise = Math.tanh(noise * 1.2) / Math.tanh(1.2);

    static_[i] = noise * amplitude;
  }

  return static_;
}

/**
 * Calculate QSB fade envelope using multi-sinusoid modulation
 * Creates organic fading by combining 3 sine waves with random phases
 */
function calculateFadeEnvelope(
  sampleIndex: number,
  sampleRate: number,
  depth: number,
  rate: number,
  phases: [number, number, number]
): number {
  const time = sampleIndex / sampleRate;

  // Three sine waves at different rates for organic fading
  const sin1 = Math.sin(2 * Math.PI * rate * time + phases[0]);
  const sin2 = Math.sin(2 * Math.PI * rate * 0.7 * time + phases[1]);
  const sin3 = Math.sin(2 * Math.PI * rate * 1.3 * time + phases[2]);

  // Combine waves (weighted average)
  const combined = (sin1 * 0.5 + sin2 * 0.3 + sin3 * 0.2);

  // Map from [-1, 1] to [1-depth, 1]
  const fadeAmount = (combined + 1) / 2; // 0 to 1
  return 1 - depth * (1 - fadeAmount);
}

/**
 * Apply radio effects (QRN and QSB) to audio samples
 *
 * @param samples - Float32Array of audio samples (-1 to 1)
 * @param sampleRate - Sample rate in Hz
 * @param options - Radio effects configuration
 * @returns Modified samples with radio effects applied
 */
export function applyRadioEffects(
  samples: Float32Array,
  sampleRate: number,
  options?: RadioEffectsOptions
): Float32Array {
  // If no radio effects specified, return original samples
  if (!options || (!options.qrn && !options.qsb)) {
    return samples;
  }

  const result = new Float32Array(samples.length);

  // QRN settings
  const hasQrn = !!options.qrn;
  const snr = hasQrn ? validateSnr(options.qrn!.snr ?? DEFAULT_SNR) : 0;
  // Convert SNR (dB) to noise amplitude
  // Signal is ~0.8, so noise amplitude = 0.8 / 10^(snr/20)
  const noiseAmplitude = hasQrn ? (0.8 / Math.pow(10, snr / 20)) : 0;

  // QSB settings
  const hasQsb = !!options.qsb;
  const fadeDepth = hasQsb
    ? validateFadeDepth(options.qsb!.depth ?? DEFAULT_FADE_DEPTH)
    : 0;
  const fadeRate = hasQsb
    ? validateFadeRate(options.qsb!.rate ?? DEFAULT_FADE_RATE)
    : 0;

  // Initialize PRNGs
  const prng = createPrng(12345);
  const qsbPhases: [number, number, number] = [
    prng() * 2 * Math.PI,
    prng() * 2 * Math.PI,
    prng() * 2 * Math.PI,
  ];

  // Generate static layer if QRN enabled
  const staticPrng = createPrng(67890);
  const staticLayer = hasQrn
    ? generateRealisticStatic(samples.length, sampleRate, noiseAmplitude, staticPrng)
    : null;

  // Process each sample
  for (let i = 0; i < samples.length; i++) {
    let sample = samples[i];

    // Apply QSB (fading) - modulates the signal amplitude
    if (hasQsb) {
      const fadeMultiplier = calculateFadeEnvelope(
        i,
        sampleRate,
        fadeDepth,
        fadeRate,
        qsbPhases
      );
      sample *= fadeMultiplier;
    }

    // Add QRN (realistic static)
    if (staticLayer) {
      sample += staticLayer[i];
    }

    // Final soft clip to prevent distortion
    if (sample > 1) sample = 1;
    else if (sample < -1) sample = -1;

    result[i] = sample;
  }

  return result;
}
