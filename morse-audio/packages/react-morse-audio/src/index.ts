// Components
export { MorseAudio } from './MorseAudio';

// Hooks
export { useMorseAudio } from './useMorseAudio';
export { useContestAudio } from './useContestAudio';

// Types
export type {
  MorseAudioProps,
  MorseAudioRef,
  MorsePlaybackStatus,
  UseMorseAudioOptions,
  UseMorseAudioReturn,
} from './types';

export type {
  UseContestAudioOptions,
  UseContestAudioReturn,
} from './useContestAudio';

// Re-export constants from morse-audio for convenience
export {
  MIN_WPM,
  MAX_WPM,
  DEFAULT_WPM,
  MIN_FREQUENCY,
  MAX_FREQUENCY,
  DEFAULT_FREQUENCY,
  MIN_PRE_DELAY,
  MAX_PRE_DELAY,
  DEFAULT_PRE_DELAY,
  MIN_POST_DELAY,
  MAX_POST_DELAY,
  DEFAULT_POST_DELAY,
  // QRN (noise) constants
  MIN_SNR,
  MAX_SNR,
  DEFAULT_SNR,
  // QSB (fading) constants
  MIN_FADE_DEPTH,
  MAX_FADE_DEPTH,
  DEFAULT_FADE_DEPTH,
  MIN_FADE_RATE,
  MAX_FADE_RATE,
  DEFAULT_FADE_RATE,
} from 'morse-audio';

// Re-export utilities from morse-audio for advanced usage
export { generateMorseAudio, calculateDuration } from 'morse-audio';
export type {
  MorseGeneratorOptions,
  GeneratedMorseAudio,
  RadioEffectsOptions,
  QrnOptions,
  QsbOptions,
} from 'morse-audio';

// Realistic morse audio generator with full effects chain (AGC-calibrated SNR,
// fist model, per-element effects, receiver bandpass).
export { generateRealisticMorseAudio } from 'morse-audio';
export type {
  RealisticMorseOptions,
  RealisticMorseResult,
  RealisticQrnOptions,
  RealisticBandpassOptions,
} from 'morse-audio';

// SNR-calibrated mixing primitives for custom pipelines.
export {
  peakNormalize,
  rmsNormalize,
  generateCalibratedNoise,
  mixWithCalibratedNoise,
  DEFAULT_SNR_REFERENCE_BANDWIDTH,
} from 'morse-audio';
export type { CalibratedNoiseOptions, SnrMixOptions } from 'morse-audio';

// Re-export streaming types from morse-audio
export {
  createContestAudioEngine,
  CONTEST_ENGINE_DEFAULTS,
} from 'morse-audio';

export type {
  ContestEngineOptions,
  ContestEngineStatus,
  ContestEngineCallbacks,
  PlayStationOptions,
  PlaySidetoneOptions,
  ActiveStation,
  IContestAudioEngine,
  StationEffectsOptions,
  RayleighFadingOptions,
  FlutterOptions,
  ChirpOptions,
} from 'morse-audio';

// Re-export core generator (primary API for realistic audio)
export {
  MorseAudioGenerator,
  createMorseAudioGenerator,
  // Buzz / AC hum
  applyBuzz,
  applyBuzzAM,
  // Noise
  generateAWGN,
  // Filters
  applyBandwidthFilter,
  // Legacy aliases
  TrainingSampleGenerator,
  createTrainingSampleGenerator,
  // Fist model
  FIST_PROFILES,
  FIST_DISTRIBUTION,
  randomFistProfile,
  getFistOptions,
  // Defaults
  DEFAULT_DISTRIBUTIONS,
  MIN_ML_SNR,
  MAX_ML_SNR,
} from 'morse-audio';

export type {
  SampleRate,
  FistProfile,
  FistOptions,
  BuzzOptions,
  NoiseConfig,
  CWQrmOptions,
  BroadbandInterferenceOptions,
  MorseAudioConfig,
  CharacterMetadata,
  ElementMetadata,
  MorseAudioMetadata,
  MorseAudioResult,
  ParameterDistributions,
  // Legacy aliases
  TrainingSampleConfig,
  TrainingSampleMetadata,
  TrainingSample,
} from 'morse-audio';
