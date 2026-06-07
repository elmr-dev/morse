/**
 * Pileup simulation module
 *
 * Provides multi-station contest audio generation with:
 * - Per-station frequency offset and signal strength
 * - Per-station effects (Rayleigh fading, flutter, chirp, buzz)
 * - Receiver bandwidth filtering
 * - Atmospheric noise (QRN)
 */

// Main generator
export {
  calculateStationAttenuations,
  generatePileupAudio,
  generatePileupSamples,
} from './pileup-mixer';
// Station utilities
export {
  calculatePileupDuration,
  generateEnvelope,
  generateStationAudio,
  type StationAudioResult,
} from './station-chain';
// Types
export type {
  BuzzOptions,
  ChirpOptions,
  FlutterOptions,
  GeneratedPileupAudio,
  PileupGeneratorOptions,
  PileupReceiverOptions,
  PileupStation,
  RayleighFadingOptions,
  StationEffectsOptions,
} from './types';
