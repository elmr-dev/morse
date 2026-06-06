/**
 * High-level realistic morse audio generator.
 *
 * Single-call entry point that combines the full effects chain:
 *
 *   text → translate → optional fist model →
 *     synthesize tone with chirp/buzz/rayleigh/flutter →
 *     optional QSB →
 *     optional SNR-calibrated USB receiver noise (2.5 kHz reference bandwidth) →
 *     optional receiver bandpass filter (the "final stage" — narrow this and
 *     watch the effective SNR climb) →
 *     WAV data URI.
 *
 * Use this when you want *realistic* CW audio in one shot. For low-level
 * composition use the underlying primitives (`translateWithMetadata`,
 * `applyFistModel`, `RayleighFading`, `Flutter`, `Chirp`, `Buzz`,
 * `generateCalibratedNoise`, `mixWithCalibratedNoise`, `applyBandwidthFilter`).
 */

import {
  DEFAULT_FREQUENCY,
  DEFAULT_PRE_DELAY,
  DEFAULT_POST_DELAY,
  validateWpm,
  validateFwpm,
  validateFrequency,
  validatePreDelay,
  validatePostDelay,
} from '../constants';
import { translateWithMetadata } from './morse-code';
import { applyRadioEffects } from './radio-effects';
import { applyBandwidthFilter } from './bandwidth-filter';
import { getSampleRate } from './audio-generator';
import { getData as getWavData, getMIMEType } from './riffwave';
import { getDataURI } from './datauri';
import {
  generateCalibratedNoise,
  mixWithCalibratedNoise,
  DEFAULT_SNR_REFERENCE_BANDWIDTH,
} from './snr-mixing';
import { applyFistModel } from '../core/fist-model';
import { synthesizeCw } from '../core/cw-synthesis';
import type { FistOptions } from '../core/types';
import type {
  RayleighFadingOptions,
  FlutterOptions,
  ChirpOptions,
  BuzzOptions,
} from '../pileup/types';
import type { QsbOptions } from '../types';

export interface RealisticQrnOptions {
  /** Target SNR in dB. Positive = signal louder than noise floor. */
  snr: number;
  /**
   * Reference noise bandwidth used to calibrate the SNR (Hz). Default: 2500
   * (SSB convention). Narrowing the {@link RealisticBandpassOptions.bandwidth}
   * below this improves the effective SNR — exactly the behavior you'd hear
   * switching from a 2.4 kHz SSB filter to a 300 Hz CW filter.
   */
  referenceBandwidth?: number;
}

export interface RealisticBandpassOptions {
  /** Filter -3 dB bandwidth in Hz (e.g. 500 for a typical CW filter). */
  bandwidth: number;
  /** Filter center frequency in Hz. Default: tone frequency. */
  centerFrequency?: number;
  /** Number of cascaded biquad stages (more = steeper skirts). Default: 4. */
  stages?: number;
}

export interface RealisticMorseOptions {
  /** Text to send. Supports prosigns like `<AR>`, `<SK>`. */
  text: string;
  /** Character speed in WPM. */
  wpm: number;
  /** Farnsworth WPM for inter-character/word spacing. Default: same as wpm. */
  fwpm?: number;
  /** Tone frequency in Hz. Default: 700. */
  frequency?: number;
  /** Pre-roll silence in ms (Bluetooth fade-in headroom). Default: 300. */
  preDelay?: number;
  /** Trailing silence in ms (prevents end clipping). Default: 100. */
  postDelay?: number;

  /** Operator timing imperfections (jitter, dah bias, drift, gap stretch). */
  fist?: FistOptions;

  /** HF Rayleigh multipath fading. */
  rayleigh?: RayleighFadingOptions;
  /** Auroral flutter (10-30 Hz amplitude modulation). */
  flutter?: FlutterOptions;
  /** Frequency drift on keying (old crystal rigs). */
  chirp?: ChirpOptions;
  /** AC mains hum bleeding into the signal. */
  buzz?: BuzzOptions;

  /** Slow ionospheric fading (multi-sinusoid AM on the signal). */
  qsb?: QsbOptions;
  /** USB receiver noise with SNR calibrated to a reference bandwidth. */
  qrn?: RealisticQrnOptions;

  /** Receiver IF filter — apply *after* noise mixing for realistic SNR boost. */
  bandpass?: RealisticBandpassOptions;

  /**
   * Random seed for reproducibility. Same seed + same options ⇒ identical
   * audio. Default: deterministic per-call constant.
   */
  seed?: number;
  /**
   * Sample rate. Default: 22050 (library default — sufficient for CW). Use
   * 44100 for higher fidelity.
   */
  sampleRate?: number;
}

export interface RealisticMorseResult {
  /** Base64-encoded WAV data URI ready for `<audio>`. */
  dataUri: string;
  /** Raw audio samples (post-bandpass if enabled). */
  samples: Float32Array;
  /** Sample rate used for synthesis. */
  sampleRate: number;
  /** Total duration in seconds (includes pre/post delay). */
  duration: number;
  /**
   * Effective WPM after fist modifications. Equals the requested WPM when no
   * fist model is applied; lower than requested if fist gap-stretching or
   * speed drift slowed things down on average.
   */
  effectiveWpm: number;
}

const DEFAULT_SEED = 0x4d3243; // 'M3C' - just a stable, recognizable constant

/**
 * Generate realistic morse code audio with the full effects chain.
 *
 * @example
 * ```ts
 * const { dataUri } = generateRealisticMorseAudio({
 *   text: 'CQ DE W1AW',
 *   wpm: 22,
 *   frequency: 600,
 *   fist: FIST_PROFILES.bug,
 *   qrn: { snr: 6 },              // calibrated against 2.5 kHz reference
 *   bandpass: { bandwidth: 300 }, // narrow CW filter — boosts effective SNR
 * });
 * new Audio(dataUri).play();
 * ```
 */
export function generateRealisticMorseAudio(
  options: RealisticMorseOptions
): RealisticMorseResult {
  const {
    text,
    wpm: rawWpm,
    fwpm: rawFwpm,
    frequency: rawFrequency = DEFAULT_FREQUENCY,
    preDelay: rawPreDelay = DEFAULT_PRE_DELAY,
    postDelay: rawPostDelay = DEFAULT_POST_DELAY,
    fist,
    rayleigh,
    flutter,
    chirp,
    buzz,
    qsb,
    qrn,
    bandpass,
    seed = DEFAULT_SEED,
    sampleRate: rawSampleRate,
  } = options;

  const wpm = validateWpm(rawWpm);
  const fwpm = validateFwpm(rawFwpm ?? rawWpm, wpm);
  const frequency = validateFrequency(rawFrequency);
  const preDelay = validatePreDelay(rawPreDelay);
  const postDelay = validatePostDelay(rawPostDelay);
  const sampleRate = rawSampleRate ?? getSampleRate();

  // 1. Translate to timings, optionally pass through the fist model.
  const translation = translateWithMetadata(text || ' ', wpm, fwpm);
  let timings = translation.timings;
  let effectiveWpm = wpm;
  if (fist) {
    const fistResult = applyFistModel(translation, fist, wpm, seed);
    timings = fistResult.timings;
    effectiveWpm = fistResult.effectiveWpm;
  }

  // 2. Pad with pre/post silence and synthesize the tone with per-element effects.
  const paddedTimings = [-preDelay, ...timings, -postDelay];
  let signal = synthesizeCw({
    timings: paddedTimings,
    frequency,
    sampleRate,
    rayleigh,
    flutter,
    chirp,
    buzz,
    seed,
  }).samples;

  // 3. QSB acts on the signal alone, before any noise is mixed in.
  if (qsb) {
    signal = applyRadioEffects(signal, sampleRate, { qsb });
  }

  // 4. SNR-calibrated noise mixing (AGC-style constant loudness).
  let processed: Float32Array = signal;
  if (qrn) {
    const noise = generateCalibratedNoise({
      length: signal.length,
      sampleRate,
      centerFrequency: frequency,
      referenceBandwidth: qrn.referenceBandwidth ?? DEFAULT_SNR_REFERENCE_BANDWIDTH,
      seed: seed + 101,
    });
    processed = mixWithCalibratedNoise(signal, noise, { snrDb: qrn.snr });
  }

  // 5. Receiver bandpass — runs *after* noise mixing so narrowing the filter
  //    cuts noise without cutting the on-frequency signal.
  if (bandpass) {
    const center = bandpass.centerFrequency ?? frequency;
    processed = applyBandwidthFilter(
      processed,
      center,
      bandpass.bandwidth,
      sampleRate,
      bandpass.stages ?? 4
    );
  }

  const dataUri = getDataURI(getWavData(processed, sampleRate), getMIMEType());

  return {
    dataUri,
    samples: processed,
    sampleRate,
    duration: processed.length / sampleRate,
    effectiveWpm,
  };
}
