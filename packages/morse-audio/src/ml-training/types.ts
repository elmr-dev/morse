/**
 * Type definitions for ML training data generation
 */

import type {
  BuzzOptions,
  ChirpOptions,
  FlutterOptions,
  RayleighFadingOptions,
} from '../pileup/types';
import type { AGCOptions } from '../utils/agc';
import type { MLSampleRate } from '../utils/audio-generator';
import type { DopplerSpreadOptions } from '../utils/doppler-spread';
import type { IonosphericFadingOptions } from '../utils/ionospheric-fading';
import type { MultipathOptions } from '../utils/multipath';
import type { PitchWobbleOptions } from '../utils/pitch-wobble';

/**
 * Fist profile for operator timing simulation
 */
export type FistProfile = 'machine' | 'good' | 'average' | 'poor' | 'very_poor';

/**
 * Fist model configuration
 */
export interface FistOptions {
  /** Timing jitter as fraction of nominal duration (0–1, e.g. 0.05 = 5%) */
  jitter: number;
  /** Dah length bias (-15% to +5% of nominal dah duration) */
  dahBias: number;
  /** Speed drift in WPM per second */
  speedDriftWpmPerSec: number;
  /** Fraction of character gaps to stretch (0-1) */
  charGapStretchFraction: number;
  /** Stretch factor range for character gaps [min, max] */
  charGapStretchRange: [number, number];
}

/**
 * Noise configuration for training samples
 */
export interface NoiseConfig {
  /** Target SNR in dB (total-energy ratio, Kaggle/ARRL standard) */
  snrDb: number;
  /**
   * Slow QSB: sinusoidal amplitude modulation of the noise floor.
   * Models propagation-induced noise-level variation (1–30 Hz fading).
   */
  qsb?: {
    /** Fractional amplitude depth (0–1, e.g. 0.08 = ±8 % variation) */
    depth: number;
    /** Modulation frequency in Hz (e.g. 0.3) */
    freqHz: number;
  };
  /**
   * Poisson-process atmospheric impulse noise (QRN / lightning static).
   * Adds sparse sharp spikes that are characteristic of HF band noise.
   */
  qrn?: {
    /** Average burst events per second */
    rate: number;
    /** Peak amplitude as a multiple of the noise-floor RMS (e.g. 5 = 5×) */
    amplitudeMultiplier: number;
  };
  /**
   * Power-line interference synthesiser.
   * Three-layer model: sawtooth oscillator (with slow ±0.2 Hz drift) → soft-clip
   * waveshaper (4× oversampled) → 2×f AM envelope (full-wave rectified) + corona
   * discharge noise (BPF at 2×f, peaking EQ at 4×f).
   */
  powerLine?: {
    /** Base mains frequency in Hz (60 for Americas, 50 for EU/Asia) */
    baseHz: 50 | 60;
    /** Master level in dB above the AWGN noise floor (e.g. 10–22) */
    level: number;
    /**
     * Full-wave rectified AM depth (0–1).
     * 0 = steady transformer hum, 1 = maximum rectifier chopping buzz.
     * The 120/100 Hz "pulse" is the most recognisable feature of this noise.
     */
    buzzDepth: number;
    /**
     * Corona / discharge noise mix level (0–1, default 0.3).
     * Adds the crackling, non-tonal texture of high-voltage corona discharge.
     */
    coronaLevel?: number;
  };
}

/**
 * CW QRM (interference) configuration
 */
export interface CWQrmOptions {
  /** Frequency separation from main signal in Hz */
  frequencySeparation: number;
  /** Power relative to main signal in dB */
  powerDb: number;
  /** Text to send (random callsign-like if not specified) */
  text?: string;
  /** WPM of interfering signal */
  wpm?: number;
}

/**
 * Broadband interference configuration
 */
export interface BroadbandInterferenceOptions {
  /** Center frequency in Hz */
  centerFrequency: number;
  /** Bandwidth in Hz */
  bandwidth: number;
  /** Power relative to noise floor in dB */
  powerDb: number;
}

/**
 * Complete training sample configuration
 */
export interface TrainingSampleConfig {
  /** Text to encode in Morse */
  text: string;
  /** Character speed in WPM */
  wpm: number;
  /** Farnsworth WPM (effective speed with extended gaps) */
  fwpm?: number;
  /** Fist (operator timing) options */
  fist?: FistOptions;
  /** Tone frequency in Hz */
  frequency: number;
  /** Audio sample rate */
  sampleRate: MLSampleRate;
  /** Noise configuration */
  noise: NoiseConfig;
  /** Ionospheric fading options */
  ionosphericFading?: IonosphericFadingOptions;
  /** Multipath propagation options */
  multipath?: MultipathOptions;
  /** Doppler spread options */
  dopplerSpread?: DopplerSpreadOptions;
  /** CW QRM (interference) signals */
  cwQrm?: CWQrmOptions[];
  /** Broadband interference */
  broadbandInterference?: BroadbandInterferenceOptions;
  /** AGC options */
  agc?: AGCOptions;
  /** Pitch wobble (oscillator drift) options */
  pitchWobble?: PitchWobbleOptions;
  /** HF Rayleigh fading options */
  rayleigh?: RayleighFadingOptions;
  /** Auroral flutter options */
  flutter?: FlutterOptions;
  /** Chirp (key-down frequency drift) options */
  chirp?: ChirpOptions;
  /** AC hum bleeding into keyed tone */
  buzz?: BuzzOptions;
  /** Target duration in seconds */
  durationSec: number;
  /** Random seed for reproducibility */
  seed?: number;
  /** If set, write a noise-only WAV (same noise, no CW signal) to this path */
  outputNoisePath?: string;
}

/**
 * Character timing metadata in the generated sample
 */
export interface CharacterMetadata {
  /** The character */
  char: string;
  /** Start time in milliseconds from audio start */
  startMs: number;
  /** End time in milliseconds from audio start */
  endMs: number;
}

/**
 * Element-level metadata (dits, dahs, gaps)
 */
export interface ElementMetadata {
  /** Character this element belongs to */
  char: string;
  /** Element type */
  elementType: 'dit' | 'dah' | 'intra_char_gap' | 'char_gap' | 'word_gap';
  /** Start time in ms */
  startMs: number;
  /** End time in ms */
  endMs: number;
  /** Nominal duration before jitter */
  nominalDurationMs: number;
  /** Actual duration after jitter */
  actualDurationMs: number;
}

/**
 * Complete metadata for a training sample
 */
export interface TrainingSampleMetadata {
  /** Original configuration */
  config: TrainingSampleConfig;
  /** Character-level timing information */
  characters: CharacterMetadata[];
  /** Element-level timing (optional, for detailed analysis) */
  elements?: ElementMetadata[];
  /** The full text that was encoded */
  fullText: string;
  /** Effective WPM after fist simulation */
  effectiveWpm: number;
  /** Measured SNR after noise was applied */
  effectiveSnr: number;
  /** Actual audio duration in seconds */
  actualDurationSec: number;
  /** Total number of samples */
  totalSamples: number;
}

/**
 * Generated training sample
 */
export interface TrainingSample {
  /** Audio samples */
  audio: Float32Array;
  /** Sample metadata */
  metadata: TrainingSampleMetadata;
  /** Noise-only audio (same noise applied to silence, no CW signal).
   *  Present when config.outputNoisePath is set. Same length as audio. */
  noiseAudio?: Float32Array;
}

/**
 * Parameter distributions for batch generation
 */
export interface ParameterDistributions {
  /** WPM range [min, max] */
  wpmRange: [number, number];
  /** SNR range in dB [min, max] */
  snrRange: [number, number];
  /** Frequency range in Hz [min, max] */
  frequencyRange: [number, number];
  /** Fist profile distribution */
  fistDistribution: Partial<Record<FistProfile, number>>;
  /** Probability of applying ionospheric fading */
  ionosphericFadingProbability: number;
  /** Probability of applying multipath */
  multipathProbability: number;
  /** Probability of applying Doppler spread */
  dopplerSpreadProbability: number;
  /** Probability of CW QRM */
  cwQrmProbability: number;
  /** Probability of multiple QRM signals when QRM is present */
  multipleQrmProbability: number;
  /** Probability of broadband interference */
  broadbandInterferenceProbability: number;
  /** Probability of applying AGC */
  agcProbability: number;
  /** Probability of applying pitch wobble */
  pitchWobbleProbability: number;
  /** Probability of applying chirp */
  chirpProbability: number;
  /** Probability of adding slow QSB to the noise floor */
  qsbProbability: number;
  /** Probability of adding Poisson impulse QRN bursts */
  qrnProbability: number;
  /** Probability of adding power-line interference (60/50 Hz comb + buzz) */
  powerLineProbability: number;
}

/**
 * Default parameter distributions matching the plan
 */
export const DEFAULT_DISTRIBUTIONS: ParameterDistributions = {
  wpmRange: [12, 40],
  snrRange: [-15, 20],
  frequencyRange: [400, 900],
  fistDistribution: {
    machine: 0.1,
    good: 0.25,
    average: 0.35,
    poor: 0.2,
    very_poor: 0.1,
  },
  ionosphericFadingProbability: 0.75, // 75% (25% none)
  multipathProbability: 0.35,
  dopplerSpreadProbability: 0.25,
  cwQrmProbability: 0.3,
  multipleQrmProbability: 0.1, // Of QRM samples, 10% have 2 signals
  broadbandInterferenceProbability: 0.15,
  agcProbability: 0.7,
  pitchWobbleProbability: 0.3,
  chirpProbability: 0.2,
  qsbProbability: 0.6, // 60% of samples get slow noise-floor QSB
  qrnProbability: 0.4, // 40% of samples get Poisson impulse bursts
  powerLineProbability: 0.15, // 15% of samples get power-line interference
};
