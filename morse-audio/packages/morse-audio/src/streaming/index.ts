/**
 * Streaming contest audio simulation module
 *
 * Provides real-time Web Audio API streaming for contest simulation with:
 * - Continuous QRN (band noise/static)
 * - Dynamic station injection with effects
 * - Clean local sidetone playback
 */

// Main engine
export { ContestAudioEngine, createContestAudioEngine } from './contest-audio-engine';

// Types
export type {
  ContestEngineOptions,
  ContestEngineStatus,
  ContestEngineCallbacks,
  PlayStationOptions,
  PlaySidetoneOptions,
  ActiveStation,
  IContestAudioEngine,
} from './types';

export { CONTEST_ENGINE_DEFAULTS } from './types';

// Worklet utilities (for advanced usage)
export { createQrnWorkletUrl, revokeQrnWorkletUrl, QRN_WORKLET_CODE } from './qrn-worklet';
