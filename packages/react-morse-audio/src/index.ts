// Components

export type {
  ActiveStation,
  BroadbandInterferenceOptions,
  BuzzOptions,
  CalibratedNoiseOptions,
  CharacterMetadata,
  ChirpOptions,
  ContestEngineCallbacks,
  ContestEngineOptions,
  ContestEngineStatus,
  CWQrmOptions,
  ElementMetadata,
  FistOptions,
  FistProfile,
  FlutterOptions,
  GeneratedMorseAudio,
  IContestAudioEngine,
  MorseAudioConfig,
  MorseAudioMetadata,
  MorseAudioResult,
  MorseGeneratorOptions,
  NoiseConfig,
  ParameterDistributions,
  PlaySidetoneOptions,
  PlayStationOptions,
  QrnOptions,
  QsbOptions,
  RadioEffectsOptions,
  RayleighFadingOptions,
  RealisticBandpassOptions,
  RealisticMorseOptions,
  RealisticMorseResult,
  RealisticQrnOptions,
  SampleRate,
  SnrMixOptions,
  StationEffectsOptions,
  TrainingSample,
  // Legacy aliases
  TrainingSampleConfig,
  TrainingSampleMetadata,
} from 'morse-audio';
// Re-export constants from morse-audio for convenience
// Re-export utilities from morse-audio for advanced usage
// Realistic morse audio generator with full effects chain (AGC-calibrated SNR,
// fist model, per-element effects, receiver bandpass).
// SNR-calibrated mixing primitives for custom pipelines.
// Re-export streaming types from morse-audio
// Re-export core generator (primary API for realistic audio)
export {
  // Filters
  applyBandwidthFilter,
  // Buzz / AC hum
  applyBuzz,
  applyBuzzAM,
  CONTEST_ENGINE_DEFAULTS,
  calculateDuration,
  createContestAudioEngine,
  createMorseAudioGenerator,
  createTrainingSampleGenerator,
  // Defaults
  DEFAULT_DISTRIBUTIONS,
  DEFAULT_FADE_DEPTH,
  DEFAULT_FADE_RATE,
  DEFAULT_FREQUENCY,
  DEFAULT_POST_DELAY,
  DEFAULT_PRE_DELAY,
  DEFAULT_SNR,
  DEFAULT_SNR_REFERENCE_BANDWIDTH,
  DEFAULT_WPM,
  FIST_DISTRIBUTION,
  // Fist model
  FIST_PROFILES,
  // Noise
  generateAWGN,
  generateCalibratedNoise,
  generateMorseAudio,
  generateRealisticMorseAudio,
  getFistOptions,
  MAX_FADE_DEPTH,
  MAX_FADE_RATE,
  MAX_FREQUENCY,
  MAX_ML_SNR,
  MAX_POST_DELAY,
  MAX_PRE_DELAY,
  MAX_SNR,
  MAX_WPM,
  // QSB (fading) constants
  MIN_FADE_DEPTH,
  MIN_FADE_RATE,
  MIN_FREQUENCY,
  MIN_ML_SNR,
  MIN_POST_DELAY,
  MIN_PRE_DELAY,
  // QRN (noise) constants
  MIN_SNR,
  MIN_WPM,
  MorseAudioGenerator,
  mixWithCalibratedNoise,
  peakNormalize,
  randomFistProfile,
  rmsNormalize,
  // Legacy aliases
  TrainingSampleGenerator,
} from 'morse-audio';
export { MorseAudio } from './MorseAudio';
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
export { useContestAudio } from './useContestAudio';
// Hooks
export { useMorseAudio } from './useMorseAudio';
