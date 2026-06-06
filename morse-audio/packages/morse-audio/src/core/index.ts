/**
 * Core Morse Audio Generator Module
 *
 * Provides the unified API for generating realistic CW audio
 * with full effects chain: fist modeling, AGC, multipath, fading, etc.
 */

// Main generator
export {
  MorseAudioGenerator,
  createMorseAudioGenerator,
  // Legacy aliases for backward compatibility
  TrainingSampleGenerator,
  createTrainingSampleGenerator,
} from './morse-generator';

// Types
export type {
  SampleRate,
  FistProfile,
  FistOptions,
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
} from './types';

export { DEFAULT_DISTRIBUTIONS } from './types';

// Fist model
export {
  FIST_PROFILES,
  FIST_DISTRIBUTION,
  randomFistProfile,
  getFistOptions,
  applyFistModel,
} from './fist-model';

export type { FistTimings } from './fist-model';

// QRM generator
export {
  generateQrmSignal,
  randomQrmOptions,
  mixQrmSignals,
} from './qrm-generator';

// Broadband interference
export {
  generateBroadbandInterference,
  generateModulatedBroadbandInterference,
  randomBroadbandInterferenceOptions,
  mixBroadbandInterference,
} from './broadband-interference';
