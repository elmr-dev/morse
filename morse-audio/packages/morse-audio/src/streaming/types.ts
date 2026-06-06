/**
 * Types for streaming contest audio simulation
 *
 * Enables real-time audio streaming with:
 * - Continuous QRN (band noise/static)
 * - Dynamic station injection with effects
 * - Clean local sidetone playback
 */

import type { StationEffectsOptions } from '../pileup/types';
import type { QrnOptions } from '../types';

/**
 * Options for initializing the contest audio engine
 */
export interface ContestEngineOptions {
  /** Audio sample rate (default: 44100 for Web Audio API) */
  sampleRate?: number;
  /** Initial QRN (noise) settings */
  qrn?: QrnOptions;
  /** Receiver bandwidth in Hz (default: 500) */
  bandwidth?: number;
  /** Center frequency of the receiver passband in Hz (default: 700) */
  centerFrequency?: number;
  /** Sidetone frequency in Hz (default: 700) */
  sidetoneFrequency?: number;
  /** Sidetone volume 0-1 (default: 0.8) */
  sidetoneVolume?: number;
  /** Receiver volume 0-1 (default: 0.5) */
  receiverVolume?: number;
}

/**
 * Options for playing a station through the receiver
 */
export interface PlayStationOptions {
  /** Unique identifier for this transmission */
  id?: string;
  /** Text to send in morse code */
  text: string;
  /** Words per minute for character speed */
  wpm: number;
  /** Farnsworth WPM for spacing (defaults to wpm) */
  fwpm?: number;
  /** Frequency offset from receiver center in Hz (-500 to +500) */
  frequencyOffset?: number;
  /** Signal strength in dB relative to S9 (-30 to +20) */
  signalStrength?: number;
  /** Per-station effects (rayleigh, flutter, chirp, buzz) */
  effects?: StationEffectsOptions;
  /** Called when this transmission completes */
  onComplete?: () => void;
}

/**
 * Options for playing local sidetone (your own sending)
 */
export interface PlaySidetoneOptions {
  /** Text to send in morse code */
  text: string;
  /** Words per minute for character speed */
  wpm: number;
  /** Farnsworth WPM for spacing (defaults to wpm) */
  fwpm?: number;
  /** Override sidetone frequency in Hz */
  frequency?: number;
  /** Override sidetone volume 0-1 */
  volume?: number;
  /** Called when sidetone playback completes */
  onComplete?: () => void;
}

/**
 * Status of the contest audio engine
 */
export type ContestEngineStatus = 'stopped' | 'starting' | 'running' | 'error';

/**
 * Information about a currently playing station
 */
export interface ActiveStation {
  /** Station identifier */
  id: string;
  /** Text being transmitted */
  text: string;
  /** Start time in audio context time */
  startTime: number;
  /** Expected end time in audio context time */
  endTime: number;
}

/**
 * Event callbacks for the contest audio engine
 */
export interface ContestEngineCallbacks {
  /** Called when engine status changes */
  onStatusChange?: (status: ContestEngineStatus) => void;
  /** Called when a station transmission completes */
  onStationComplete?: (id: string) => void;
  /** Called when sidetone playback completes */
  onSidetoneComplete?: () => void;
  /** Called when an error occurs */
  onError?: (error: Error) => void;
}

/**
 * Interface for the contest audio engine
 */
export interface IContestAudioEngine {
  // Lifecycle
  start(): Promise<void>;
  stop(): void;
  isRunning(): boolean;
  getStatus(): ContestEngineStatus;

  // Receiver settings
  setQRN(options: QrnOptions | null): void;
  setBandwidth(hz: number): void;
  setCenterFrequency(hz: number): void;
  setReceiverVolume(volume: number): void;

  // Sidetone settings
  setSidetoneFrequency(hz: number): void;
  setSidetoneVolume(volume: number): void;

  // Play audio
  playStation(options: PlayStationOptions): Promise<string>;
  playSidetone(options: PlaySidetoneOptions): Promise<void>;

  // Stop specific playback
  stopStation(id: string): void;
  stopSidetone(): void;
  stopAllStations(): void;

  // Query state
  getActiveStations(): ActiveStation[];
  isSidetoneActive(): boolean;

  // Callbacks
  setCallbacks(callbacks: ContestEngineCallbacks): void;
}

/**
 * Default values for contest engine
 */
export const CONTEST_ENGINE_DEFAULTS = {
  sampleRate: 44100,
  bandwidth: 500,
  centerFrequency: 700,
  sidetoneFrequency: 700,
  sidetoneVolume: 0.8,
  receiverVolume: 0.5,
} as const;
