/**
 * Streaming contest audio simulation module
 *
 * Provides real-time Web Audio API streaming for contest simulation with:
 * - Continuous QRN (band noise/static)
 * - Dynamic station injection with effects
 * - Clean local sidetone playback
 */

// Main engine
export {
  ContestAudioEngine,
  createContestAudioEngine,
} from './contest-audio-engine';
// Worklet utilities (for advanced usage)
export {
  createQrnWorkletUrl,
  QRN_WORKLET_CODE,
  revokeQrnWorkletUrl,
} from './qrn-worklet';
// Types
export type {
  ActiveStation,
  ContestEngineCallbacks,
  ContestEngineOptions,
  ContestEngineStatus,
  IContestAudioEngine,
  PlaySidetoneOptions,
  PlayStationOptions,
} from './types';
export { CONTEST_ENGINE_DEFAULTS } from './types';
