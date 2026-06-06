/**
 * Pileup simulation module
 *
 * Provides multi-station contest audio generation with:
 * - Per-station frequency offset and signal strength
 * - Per-station effects (Rayleigh fading, flutter, chirp, buzz)
 * - Receiver bandwidth filtering
 * - Atmospheric noise (QRN)
 */

// Types
export type {
  RayleighFadingOptions,
  FlutterOptions,
  ChirpOptions,
  BuzzOptions,
  StationEffectsOptions,
  PileupStation,
  PileupReceiverOptions,
  PileupGeneratorOptions,
  GeneratedPileupAudio,
} from './types';

// Main generator
export {
  generatePileupAudio,
  generatePileupSamples,
  calculateStationAttenuations,
} from './pileup-mixer';

// Station utilities
export {
  generateStationAudio,
  generateEnvelope,
  calculatePileupDuration,
  type StationAudioResult,
} from './station-chain';
