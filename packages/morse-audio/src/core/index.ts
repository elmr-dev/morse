/**
 * Core Morse Audio Generator Module
 *
 * Provides the unified API for generating realistic CW audio
 * with full effects chain: fist modeling, AGC, multipath, fading, etc.
 */

// Broadband interference
export {
  generateBroadbandInterference,
  generateModulatedBroadbandInterference,
  mixBroadbandInterference,
  randomBroadbandInterferenceOptions,
} from './broadband-interference';
export type { FistTimings } from './fist-model';
// Fist model
export {
  applyFistModel,
  FIST_DISTRIBUTION,
  FIST_PROFILES,
  getFistOptions,
  randomFistProfile,
} from './fist-model';
// Main generator
export {
  createMorseAudioGenerator,
  createTrainingSampleGenerator,
  MorseAudioGenerator,
  // Legacy aliases for backward compatibility
  TrainingSampleGenerator,
} from './morse-generator';
// QRM generator
export {
  generateQrmSignal,
  mixQrmSignals,
  randomQrmOptions,
} from './qrm-generator';
// Types
export type {
  BroadbandInterferenceOptions,
  CharacterMetadata,
  CWQrmOptions,
  ElementMetadata,
  FistOptions,
  FistProfile,
  MorseAudioConfig,
  MorseAudioMetadata,
  MorseAudioResult,
  NoiseConfig,
  ParameterDistributions,
  SampleRate,
  TrainingSample,
  // Legacy aliases
  TrainingSampleConfig,
  TrainingSampleMetadata,
} from './types';
export { DEFAULT_DISTRIBUTIONS } from './types';
