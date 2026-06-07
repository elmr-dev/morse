/**
 * ML Training Data Generation Module
 *
 * Provides tools for generating realistic CW audio training data
 * for machine learning models.
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
// QRM generator
export {
  generateQrmSignal,
  mixQrmSignals,
  randomQrmOptions,
} from './qrm-generator';
// Main generator
export {
  createTrainingSampleGenerator,
  TrainingSampleGenerator,
} from './training-generator';
// Types
export type {
  BroadbandInterferenceOptions,
  CharacterMetadata,
  CWQrmOptions,
  ElementMetadata,
  FistOptions,
  FistProfile,
  NoiseConfig,
  ParameterDistributions,
  TrainingSample,
  TrainingSampleConfig,
  TrainingSampleMetadata,
} from './types';
export { DEFAULT_DISTRIBUTIONS } from './types';
