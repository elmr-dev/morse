/**
 * ML Training Data Generation Module
 *
 * Provides tools for generating realistic CW audio training data
 * for machine learning models.
 */

// Main generator
export {
  TrainingSampleGenerator,
  createTrainingSampleGenerator,
} from './training-generator';

// Types
export type {
  FistProfile,
  FistOptions,
  NoiseConfig,
  CWQrmOptions,
  BroadbandInterferenceOptions,
  TrainingSampleConfig,
  CharacterMetadata,
  ElementMetadata,
  TrainingSampleMetadata,
  TrainingSample,
  ParameterDistributions,
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
