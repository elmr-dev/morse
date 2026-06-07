import { createPrng, gaussianRandom } from './prng';

/** Default lower audio edge for a 2.4 kHz USB receiver passband. */
export const DEFAULT_USB_LOW_CUT_HZ = 300;

/** Default USB audio bandwidth measured from the sample: ~300-2700 Hz. */
export const DEFAULT_USB_BANDWIDTH_HZ = 2400;

/**
 * Stopband leakage retained below/above the receiver passband.
 *
 * The KiwiSDR sample is not mathematically silent outside the IF/audio filter;
 * rejected regions sit around -24 dB relative to the passband. Mixing a small
 * full-band component back in reproduces that receiver-floor character.
 */
export const DEFAULT_USB_STOPBAND_LEAKAGE_DB = -24;

export interface UsbPassbandNoiseOptions {
  /** Output buffer length in samples. */
  length: number;
  /** Audio sample rate in Hz. */
  sampleRate: number;
  /** Random seed for deterministic noise. */
  seed?: number;
  /** Lower passband edge in Hz. Default: 300. */
  lowCutHz?: number;
  /** USB audio bandwidth in Hz. Default: 2400, so upper edge is 2700 Hz. */
  bandwidthHz?: number;
  /** FIR filter length in taps. Higher values make sharper skirts. Default: 257. */
  filterTaps?: number;
  /** Rejected full-band noise level relative to passband, in dB. Default: -24. */
  stopbandLeakageDb?: number;
  /** Slow receiver/AGC noise-floor wander depth. Default: 0.12. */
  agcDepth?: number;
  /** Slow receiver/AGC noise-floor wander rate in Hz. Default: 0.18. */
  agcRateHz?: number;
  /** Output RMS after shaping. Default: 1. */
  targetRms?: number;
  /** Include sparse receiver pops/bursts like the analyzed KiwiSDR sample. Default: true. */
  pops?: boolean;
  /** Average pop events per second. Default: 0.3. */
  popRateHz?: number;
  /** Pop amplitude before filtering, relative to the base noise RMS. Default: 2.0. */
  popAmplitude?: number;
  /** Minimum pop decay time in milliseconds. Default: 4. */
  popMinDecayMs?: number;
  /** Maximum pop decay time in milliseconds. Default: 18. */
  popMaxDecayMs?: number;
}

function rmsNormalize(samples: Float32Array, targetRms: number): void {
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSq += samples[i] * samples[i];
  }

  const rms = Math.sqrt(sumSq / samples.length);
  if (rms <= 1e-12) return;

  const gain = targetRms / rms;
  for (let i = 0; i < samples.length; i++) {
    samples[i] *= gain;
  }
}

function sinc(x: number): number {
  if (Math.abs(x) < 1e-8) return 1;
  return Math.sin(Math.PI * x) / (Math.PI * x);
}

function makeBandpassKernel(
  lowCutHz: number,
  highCutHz: number,
  sampleRate: number,
  taps: number
): Float32Array {
  const oddTaps = taps % 2 === 0 ? taps + 1 : taps;
  const kernel = new Float32Array(oddTaps);
  const mid = (oddTaps - 1) / 2;
  const low = lowCutHz / sampleRate;
  const high = highCutHz / sampleRate;

  for (let i = 0; i < oddTaps; i++) {
    const n = i - mid;
    const ideal = 2 * high * sinc(2 * high * n) - 2 * low * sinc(2 * low * n);
    const window = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (oddTaps - 1));
    kernel[i] = ideal * window;
  }

  return kernel;
}

function applyFir(samples: Float32Array, kernel: Float32Array): Float32Array {
  const output = new Float32Array(samples.length);
  const mid = Math.floor(kernel.length / 2);

  for (let i = 0; i < samples.length; i++) {
    let y = 0;
    for (let k = 0; k < kernel.length; k++) {
      const j = i + k - mid;
      if (j >= 0 && j < samples.length) y += samples[j] * kernel[k];
    }
    output[i] = y;
  }

  return output;
}

/**
 * Apply the measured USB receiver audio passband: flat 300-2700 Hz noise with
 * steep skirts and a small rejected full-band floor.
 */
export function applyUsbPassbandFilter(
  samples: Float32Array,
  sampleRate: number,
  options: Omit<
    UsbPassbandNoiseOptions,
    'length' | 'sampleRate' | 'seed' | 'targetRms' | 'agcDepth' | 'agcRateHz'
  > = {}
): Float32Array {
  const lowCutHz = options.lowCutHz ?? DEFAULT_USB_LOW_CUT_HZ;
  const bandwidthHz = options.bandwidthHz ?? DEFAULT_USB_BANDWIDTH_HZ;
  const highCutHz = Math.min(lowCutHz + bandwidthHz, sampleRate / 2 - 50);
  const filterTaps = options.filterTaps ?? 257;
  const stopbandLeakageDb =
    options.stopbandLeakageDb ?? DEFAULT_USB_STOPBAND_LEAKAGE_DB;
  const leakageGain = 10 ** (stopbandLeakageDb / 20);
  const kernel = makeBandpassKernel(
    lowCutHz,
    highCutHz,
    sampleRate,
    filterTaps
  );
  const output = applyFir(samples, kernel);

  for (let i = 0; i < samples.length; i++) {
    output[i] += samples[i] * leakageGain;
  }

  return output;
}

/**
 * Generate receiver-noise matching the included KiwiSDR USB sample:
 * white receiver noise, hard 2.4 kHz USB audio passband, rejected stopband
 * leakage around -24 dB, and mild slow noise-floor motion.
 */
export function generateUsbPassbandNoise(
  options: UsbPassbandNoiseOptions
): Float32Array {
  const {
    length,
    sampleRate,
    seed = 0x755342, // 'USB'
    agcDepth = 0.12,
    agcRateHz = 0.18,
    targetRms = 1,
    pops = true,
    popRateHz = 0.3,
    popAmplitude = 2.0,
    popMinDecayMs = 4,
    popMaxDecayMs = 18,
  } = options;

  const prng = createPrng(seed);
  const white = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    white[i] = gaussianRandom(prng);
  }

  if (pops && popRateHz > 0 && popAmplitude > 0) {
    const meanGapSamples = sampleRate / popRateHz;
    let popAt = Math.floor(-Math.log(prng() || 0.0001) * meanGapSamples);

    while (popAt < length) {
      const polarity = prng() < 0.5 ? -1 : 1;
      const amplitude = popAmplitude * (0.7 + prng() * 0.8);
      const decayMs =
        popMinDecayMs + prng() * Math.max(0, popMaxDecayMs - popMinDecayMs);
      const decaySamples = Math.max(1, (decayMs / 1000) * sampleRate);
      const burstSamples = Math.min(
        length - popAt,
        Math.ceil(decaySamples * 4)
      );

      for (let j = 0; j < burstSamples; j++) {
        const env = Math.exp(-j / decaySamples);
        const snap = j === 0 ? polarity * amplitude : 0;
        const fizz = gaussianRandom(prng) * amplitude * 0.55;
        white[popAt + j] += (snap + fizz) * env;
      }

      popAt += Math.ceil(-Math.log(prng() || 0.0001) * meanGapSamples);
    }
  }

  const output = applyUsbPassbandFilter(white, sampleRate, options);

  if (agcDepth > 0 && agcRateHz > 0) {
    const phase1 = prng() * 2 * Math.PI;
    const phase2 = prng() * 2 * Math.PI;
    for (let i = 0; i < output.length; i++) {
      const t = i / sampleRate;
      const wander =
        0.65 * Math.sin(2 * Math.PI * agcRateHz * t + phase1) +
        0.35 * Math.sin(2 * Math.PI * agcRateHz * 0.43 * t + phase2);
      output[i] *= 1 + agcDepth * wander;
    }
  }

  rmsNormalize(output, targetRms);
  return output;
}
