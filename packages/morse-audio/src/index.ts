// Main API

// Constants
export {
  BANDWIDTH_STEP,
  // Validation functions
  clamp,
  DEFAULT_BANDWIDTH,
  DEFAULT_BUZZ_AMPLITUDE,
  DEFAULT_CHIRP_DEVIATION,
  DEFAULT_CHIRP_TIME_CONSTANT,
  DEFAULT_FADE_DEPTH,
  DEFAULT_FADE_RATE,
  DEFAULT_FLUTTER_DEPTH,
  DEFAULT_FLUTTER_RATE,
  DEFAULT_FREQUENCY,
  DEFAULT_POST_DELAY,
  DEFAULT_PRE_DELAY,
  DEFAULT_RAYLEIGH_BANDWIDTH,
  DEFAULT_RAYLEIGH_DEPTH,
  DEFAULT_SIGNAL_STRENGTH,
  DEFAULT_SNR,
  DEFAULT_WPM,
  MAX_BANDWIDTH,
  MAX_BUZZ_AMPLITUDE,
  MAX_CHIRP_DEVIATION,
  MAX_CHIRP_TIME_CONSTANT,
  MAX_FADE_DEPTH,
  MAX_FADE_RATE,
  MAX_FLUTTER_DEPTH,
  MAX_FLUTTER_RATE,
  MAX_FREQUENCY,
  MAX_FREQUENCY_OFFSET,
  MAX_ML_SNR,
  MAX_POST_DELAY,
  MAX_PRE_DELAY,
  MAX_RAMP_DURATION,
  MAX_RAYLEIGH_BANDWIDTH,
  MAX_RAYLEIGH_DEPTH,
  MAX_SIGNAL_STRENGTH,
  MAX_SNR,
  // Station constants
  MAX_STATIONS,
  MAX_WPM,
  // Bandwidth filter constants
  MIN_BANDWIDTH,
  // Buzz constants
  MIN_BUZZ_AMPLITUDE,
  // Chirp constants
  MIN_CHIRP_DEVIATION,
  MIN_CHIRP_TIME_CONSTANT,
  // QSB (fading) constants
  MIN_FADE_DEPTH,
  MIN_FADE_RATE,
  MIN_FLUTTER_DEPTH,
  // Flutter constants
  MIN_FLUTTER_RATE,
  MIN_FREQUENCY,
  MIN_FREQUENCY_OFFSET,
  // ML training SNR range
  MIN_ML_SNR,
  MIN_POST_DELAY,
  MIN_PRE_DELAY,
  MIN_RAMP_DURATION,
  // Rayleigh fading constants
  MIN_RAYLEIGH_BANDWIDTH,
  MIN_RAYLEIGH_DEPTH,
  MIN_SIGNAL_STRENGTH,
  // QRN (noise) constants
  MIN_SNR,
  MIN_WPM,
  RAMP_DURATION,
  validateBandwidth,
  validateBuzzAmplitude,
  validateChirpDeviation,
  validateChirpTimeConstant,
  validateFadeDepth,
  validateFadeRate,
  validateFlutterDepth,
  validateFlutterRate,
  validateFrequency,
  validateFrequencyOffset,
  validateFwpm,
  validatePostDelay,
  validatePreDelay,
  validateRayleighBandwidth,
  validateRayleighDepth,
  validateSignalStrength,
  validateSnr,
  validateWpm,
} from './constants';
export type {
  BroadbandInterferenceOptions,
  CharacterMetadata,
  CWQrmOptions,
  ElementMetadata,
  FistOptions,
  FistProfile,
  FistTimings,
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
} from './core';
// Core Generator (primary API for realistic audio)
export {
  applyFistModel,
  createMorseAudioGenerator,
  createTrainingSampleGenerator,
  // Defaults
  DEFAULT_DISTRIBUTIONS,
  FIST_DISTRIBUTION,
  // Fist model
  FIST_PROFILES,
  // Broadband interference
  generateBroadbandInterference,
  generateModulatedBroadbandInterference,
  // QRM generator
  generateQrmSignal,
  getFistOptions,
  MorseAudioGenerator,
  mixBroadbandInterference,
  mixQrmSignals,
  randomBroadbandInterferenceOptions,
  randomFistProfile,
  randomQrmOptions,
  // Legacy aliases for backward compatibility
  TrainingSampleGenerator,
} from './core';
// Types - pileup
export type {
  BuzzOptions,
  ChirpOptions,
  FlutterOptions,
  GeneratedPileupAudio,
  PileupGeneratorOptions,
  PileupReceiverOptions,
  PileupStation,
  RayleighFadingOptions,
  StationAudioResult,
  StationEffectsOptions,
} from './pileup';
// Pileup API
export {
  calculatePileupDuration,
  calculateStationAttenuations,
  generatePileupAudio,
  generatePileupSamples,
  generateStationAudio,
} from './pileup';
export type {
  ActiveStation,
  ContestEngineCallbacks,
  ContestEngineOptions,
  ContestEngineStatus,
  IContestAudioEngine,
  PlaySidetoneOptions,
  PlayStationOptions,
} from './streaming';
// Streaming API (real-time Web Audio)
export {
  CONTEST_ENGINE_DEFAULTS,
  ContestAudioEngine,
  createContestAudioEngine,
  createQrnWorkletUrl,
  QRN_WORKLET_CODE,
  revokeQrnWorkletUrl,
} from './streaming';
// Types - single station
export type {
  GeneratedMorseAudio,
  MorseGeneratorOptions,
  QrnOptions,
  QsbOptions,
  RadioEffectsOptions,
} from './types';
export type { AGCOptions } from './utils/agc';
// AGC (automatic gain control)
export {
  AGC,
  AGC_DEFAULTS,
  applyAGC,
  randomAGCOptions,
} from './utils/agc';
export type {
  MLSampleRate,
  SupportedSampleRate,
} from './utils/audio-generator';
export {
  generateSamples,
  getSampleRate,
  ML_SAMPLE_RATES,
} from './utils/audio-generator';
// AWGN (additive white Gaussian noise)
export {
  applyAWGN,
  generateAWGN,
  measureSNR,
} from './utils/awgn';
export {
  applyBandwidthFilter,
  BANDWIDTH_PRESETS,
  BandwidthFilter,
  roundBandwidthTo50Hz,
} from './utils/bandwidth-filter';
export {
  applyBuzz,
  applyBuzzAM,
  Buzz,
  generateBuzzSignal,
} from './utils/buzz';
export {
  applyChirp,
  Chirp,
  generateChirpOffsets,
} from './utils/chirp';
export { getDataURI } from './utils/datauri';
// Statistical distributions for contest simulation
export {
  generateCallerWpm,
  generatePatience,
  generatePitchOffset,
  generateQsbBandwidth,
  generateReplyTimeout,
  generateSendDelay,
  generateSignalStrength,
  rndExponential,
  rndGauss,
  rndGaussLim,
  rndPoisson,
  rndRayleigh,
  rndUShaped,
} from './utils/distributions';
export type { DopplerSpreadOptions } from './utils/doppler-spread';
// Doppler spread
export {
  applyDopplerSpread,
  applyDopplerSpreadPost,
  randomDopplerSpreadOptions,
} from './utils/doppler-spread';
// Shared envelope utility (re-exported from pileup for backward compatibility)
// Shared utilities for advanced usage
export { generateEnvelope, generateEnvelopeWithLeadIn } from './utils/envelope';
export {
  applyFlutter,
  Flutter,
  generateFlutterEnvelope,
} from './utils/flutter';
export type {
  FadingSeverity,
  IonosphericFadingOptions,
} from './utils/ionospheric-fading';
// Ionospheric fading
export {
  applyIonosphericFading,
  FADING_DISTRIBUTION,
  FADING_PROFILES,
  generateIonosphericFadingEnvelope,
  IonosphericFading,
  randomFadingSeverity,
  randomIonosphericFadingOptions,
} from './utils/ionospheric-fading';
export type {
  MorseElementMetadata,
  MorseElementType,
  TranslationWithMetadata,
} from './utils/morse-code';
// Low-level utilities (for advanced usage)
export { translate, translateWithMetadata } from './utils/morse-code';
export { calculateDuration, generateMorseAudio } from './utils/morse-generator';
export type { MultipathOptions, PathConfig } from './utils/multipath';
// Multipath propagation
export {
  applyMultipath,
  createMultipathOptions,
  randomMultipathOptions,
} from './utils/multipath';
export {
  applyPinkNoiseFilter,
  generatePinkNoise,
  PinkNoiseFilter,
} from './utils/pink-noise';
export type { PitchWobbleOptions } from './utils/pitch-wobble';
// Pitch wobble (oscillator drift)
export {
  applyPitchWobble,
  generatePitchWobbleOffsets,
  PitchWobble,
  randomPitchWobbleOptions,
} from './utils/pitch-wobble';
export { createPrng, gaussianRandom, randomSeed } from './utils/prng';
export { applyRadioEffects } from './utils/radio-effects';
// Effect processors
export {
  applyRayleighFading,
  generateRayleighEnvelope,
  RayleighFading,
} from './utils/rayleigh-fading';
export type {
  RealisticBandpassOptions,
  RealisticMorseOptions,
  RealisticMorseResult,
  RealisticQrnOptions,
} from './utils/realistic-generator';
export { generateRealisticMorseAudio } from './utils/realistic-generator';
export { getData as getWavData, getMIMEType } from './utils/riffwave';
export type {
  CalibratedNoiseOptions,
  SnrMixOptions,
} from './utils/snr-mixing';
// SNR-calibrated mixing utilities (AGC-style constant-loudness model)
export {
  DEFAULT_OUTPUT_PEAK,
  DEFAULT_REFERENCE_PEAK,
  DEFAULT_SNR_REFERENCE_BANDWIDTH,
  generateCalibratedNoise,
  mixWithCalibratedNoise,
  peakNormalize,
  rmsNormalize,
} from './utils/snr-mixing';
export type { UsbPassbandNoiseOptions } from './utils/usb-passband-noise';
export {
  applyUsbPassbandFilter,
  DEFAULT_USB_BANDWIDTH_HZ,
  DEFAULT_USB_LOW_CUT_HZ,
  DEFAULT_USB_STOPBAND_LEAKAGE_DB,
  generateUsbPassbandNoise,
} from './utils/usb-passband-noise';
