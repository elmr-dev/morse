/**
 * Contest Audio Engine using Web Audio API
 *
 * Provides real-time audio streaming for contest simulation:
 * - Continuous QRN (band noise) via AudioWorklet
 * - Dynamic station injection with effects
 * - Clean local sidetone playback
 */

import { translate } from '../utils/morse-code';
import { generateSamples } from '../utils/audio-generator';
import { generateEnvelope } from '../utils/envelope';
import { applyRayleighFading } from '../utils/rayleigh-fading';
import { applyFlutter } from '../utils/flutter';
import { applyChirp } from '../utils/chirp';
import { applyBuzz } from '../utils/buzz';
import { applyBandwidthFilter } from '../utils/bandwidth-filter';
import {
  validateWpm,
  validateFwpm,
  validateFrequency,
  validateBandwidth,
  validateFrequencyOffset,
  validateSignalStrength,
  validateSnr,
  clamp,
  DEFAULT_FREQUENCY,
  DEFAULT_BANDWIDTH,
  DEFAULT_SNR,
} from '../constants';
import { createQrnWorkletUrl, revokeQrnWorkletUrl } from './qrn-worklet';
import type {
  ContestEngineOptions,
  ContestEngineStatus,
  ContestEngineCallbacks,
  PlayStationOptions,
  PlaySidetoneOptions,
  ActiveStation,
  IContestAudioEngine,
} from './types';
import type { StationEffectsOptions } from '../pileup/types';

// Web Audio API sample rate
const WEB_AUDIO_SAMPLE_RATE = 44100;

/**
 * Generate a unique ID for transmissions
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Calculate morse timing array from text
 */
function getMorseTimings(text: string, wpm: number, fwpm?: number): number[] {
  const { timings } = translate(text, wpm, fwpm ?? wpm);
  return timings;
}

/**
 * Calculate duration in seconds from timings
 */
function calculateDurationFromTimings(timings: number[]): number {
  let totalMs = 0;
  for (const timing of timings) {
    totalMs += Math.abs(timing);
  }
  return totalMs / 1000;
}

/**
 * Apply station effects to audio samples
 */
function applyStationEffects(
  samples: Float32Array,
  envelope: Float32Array,
  baseFrequency: number,
  sampleRate: number,
  effects?: StationEffectsOptions
): Float32Array {
  if (!effects) {
    return samples;
  }

  let result = samples;

  // Apply Rayleigh fading (HF propagation)
  if (effects.rayleigh) {
    result = applyRayleighFading(result, effects.rayleigh, sampleRate);
  }

  // Apply flutter (auroral distortion)
  if (effects.flutter) {
    result = applyFlutter(result, effects.flutter, sampleRate);
  }

  // Apply chirp (frequency drift)
  if (effects.chirp) {
    result = applyChirp(result, envelope, baseFrequency, effects.chirp, sampleRate);
  }

  // Apply buzz (AC hum)
  if (effects.buzz) {
    result = applyBuzz(result, effects.buzz, sampleRate);
  }

  return result;
}

// generateEnvelope is now imported from '../utils/envelope'

/**
 * Contest Audio Engine Implementation
 */
export class ContestAudioEngine implements IContestAudioEngine {
  private audioContext: AudioContext | null = null;
  private qrnWorkletNode: AudioWorkletNode | null = null;
  private qrnWorkletUrl: string | null = null;
  private masterGain: GainNode | null = null;
  private receiverGain: GainNode | null = null;
  private sidetoneGain: GainNode | null = null;
  private qrnGain: GainNode | null = null;

  private status: ContestEngineStatus = 'stopped';
  private callbacks: ContestEngineCallbacks = {};

  // Settings
  private sampleRate: number;
  private bandwidth: number;
  private centerFrequency: number;
  private sidetoneFrequency: number;
  private sidetoneVolume: number;
  private receiverVolume: number;
  private qrnEnabled: boolean = false;
  private qrnSnr: number = DEFAULT_SNR;

  // Active transmissions
  private activeStations: Map<string, { source: AudioBufferSourceNode; gain: GainNode; info: ActiveStation }> = new Map();
  private activeSidetone: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private sidetoneActive: boolean = false;

  // Fade-out duration for stopping audio (prevents clicks)
  private static readonly FADE_OUT_DURATION = 0.02; // 20ms

  constructor(options: ContestEngineOptions = {}) {
    this.sampleRate = options.sampleRate ?? WEB_AUDIO_SAMPLE_RATE;
    this.bandwidth = validateBandwidth(options.bandwidth ?? DEFAULT_BANDWIDTH);
    this.centerFrequency = validateFrequency(options.centerFrequency ?? DEFAULT_FREQUENCY);
    this.sidetoneFrequency = validateFrequency(options.sidetoneFrequency ?? DEFAULT_FREQUENCY);
    this.sidetoneVolume = clamp(options.sidetoneVolume ?? 0.8, 0, 1);
    this.receiverVolume = clamp(options.receiverVolume ?? 0.5, 0, 1);

    if (options.qrn) {
      this.qrnEnabled = true;
      this.qrnSnr = validateSnr(options.qrn.snr ?? DEFAULT_SNR);
    }
  }

  private setStatus(newStatus: ContestEngineStatus): void {
    this.status = newStatus;
    this.callbacks.onStatusChange?.(newStatus);
  }

  async start(): Promise<void> {
    if (this.status === 'running' || this.status === 'starting') {
      return;
    }

    this.setStatus('starting');

    try {
      // Create AudioContext
      this.audioContext = new AudioContext({ sampleRate: this.sampleRate });

      // Create gain nodes for mixing
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = 1.0;
      this.masterGain.connect(this.audioContext.destination);

      this.receiverGain = this.audioContext.createGain();
      this.receiverGain.gain.value = this.receiverVolume;
      this.receiverGain.connect(this.masterGain);

      this.sidetoneGain = this.audioContext.createGain();
      this.sidetoneGain.gain.value = this.sidetoneVolume;
      this.sidetoneGain.connect(this.masterGain);

      this.qrnGain = this.audioContext.createGain();
      this.qrnGain.gain.value = 1.0;
      this.qrnGain.connect(this.receiverGain);

      // Try to set up AudioWorklet for QRN
      try {
        this.qrnWorkletUrl = createQrnWorkletUrl();
        await this.audioContext.audioWorklet.addModule(this.qrnWorkletUrl);

        this.qrnWorkletNode = new AudioWorkletNode(this.audioContext, 'qrn-processor');
        this.qrnWorkletNode.connect(this.qrnGain);

        // Configure initial QRN state
        this.qrnWorkletNode.port.postMessage({
          type: 'setSampleRate',
          data: { sampleRate: this.sampleRate },
        });
        this.qrnWorkletNode.port.postMessage({
          type: 'setSnr',
          data: { snr: this.qrnSnr },
        });
        this.qrnWorkletNode.port.postMessage({
          type: 'setEnabled',
          data: { enabled: this.qrnEnabled },
        });
      } catch (workletError) {
        // AudioWorklet not supported, fall back to no continuous noise
        console.warn('AudioWorklet not supported, QRN will be disabled:', workletError);
        this.qrnWorkletNode = null;
      }

      this.setStatus('running');
    } catch (error) {
      this.setStatus('error');
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  stop(): void {
    // Stop all active transmissions
    this.stopAllStations();
    this.stopSidetone();

    // Clean up QRN worklet
    if (this.qrnWorkletNode) {
      this.qrnWorkletNode.disconnect();
      this.qrnWorkletNode = null;
    }

    if (this.qrnWorkletUrl) {
      revokeQrnWorkletUrl(this.qrnWorkletUrl);
      this.qrnWorkletUrl = null;
    }

    // Clean up audio context
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.masterGain = null;
    this.receiverGain = null;
    this.sidetoneGain = null;
    this.qrnGain = null;

    this.setStatus('stopped');
  }

  isRunning(): boolean {
    return this.status === 'running';
  }

  getStatus(): ContestEngineStatus {
    return this.status;
  }

  setQRN(options: { snr?: number } | null): void {
    if (options === null) {
      this.qrnEnabled = false;
      if (this.qrnWorkletNode) {
        this.qrnWorkletNode.port.postMessage({
          type: 'setEnabled',
          data: { enabled: false },
        });
      }
    } else {
      this.qrnEnabled = true;
      this.qrnSnr = validateSnr(options.snr ?? DEFAULT_SNR);
      if (this.qrnWorkletNode) {
        this.qrnWorkletNode.port.postMessage({
          type: 'setSnr',
          data: { snr: this.qrnSnr },
        });
        this.qrnWorkletNode.port.postMessage({
          type: 'setEnabled',
          data: { enabled: true },
        });
      }
    }
  }

  setBandwidth(hz: number): void {
    this.bandwidth = validateBandwidth(hz);
  }

  setCenterFrequency(hz: number): void {
    this.centerFrequency = validateFrequency(hz);
  }

  setReceiverVolume(volume: number): void {
    this.receiverVolume = clamp(volume, 0, 1);
    if (this.receiverGain) {
      this.receiverGain.gain.value = this.receiverVolume;
    }
  }

  setSidetoneFrequency(hz: number): void {
    this.sidetoneFrequency = validateFrequency(hz);
  }

  setSidetoneVolume(volume: number): void {
    this.sidetoneVolume = clamp(volume, 0, 1);
    if (this.sidetoneGain) {
      this.sidetoneGain.gain.value = this.sidetoneVolume;
    }
  }

  async playStation(options: PlayStationOptions): Promise<string> {
    if (!this.audioContext || this.status !== 'running') {
      throw new Error('Engine not running');
    }

    const id = options.id ?? generateId();
    const wpm = validateWpm(options.wpm);
    const fwpm = options.fwpm !== undefined ? validateFwpm(options.fwpm, wpm) : undefined;
    const frequencyOffset = validateFrequencyOffset(options.frequencyOffset ?? 0);
    const signalStrength = validateSignalStrength(options.signalStrength ?? 0);

    // Calculate the actual frequency for this station
    const stationFrequency = this.centerFrequency + frequencyOffset;

    // Generate morse timings
    const timings = getMorseTimings(options.text, wpm, fwpm);
    const duration = calculateDurationFromTimings(timings);

    // Generate audio samples at the station's frequency
    let samples = generateSamples(timings, stationFrequency, this.sampleRate);
    const envelope = generateEnvelope(timings, this.sampleRate);

    // Apply station effects
    samples = applyStationEffects(samples, envelope, stationFrequency, this.sampleRate, options.effects);

    // Apply bandwidth filter centered on receiver
    // applyBandwidthFilter(samples, centerFreq, bandwidth, sampleRate)
    samples = applyBandwidthFilter(
      samples,
      this.centerFrequency,
      this.bandwidth,
      this.sampleRate
    );

    // Apply signal strength (convert dB to linear)
    const gain = Math.pow(10, signalStrength / 20);
    for (let i = 0; i < samples.length; i++) {
      samples[i] *= gain;
    }

    // Create audio buffer
    const audioBuffer = this.audioContext.createBuffer(1, samples.length, this.sampleRate);
    // Copy samples to buffer (use slice to ensure correct ArrayBuffer type)
    audioBuffer.getChannelData(0).set(samples);

    // Create source with its own gain node for fade-out control
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;

    const stationGain = this.audioContext.createGain();
    stationGain.gain.value = 1.0;
    source.connect(stationGain);
    stationGain.connect(this.receiverGain!);

    const startTime = this.audioContext.currentTime;
    const endTime = startTime + duration;

    // Track this station
    const stationInfo: ActiveStation = {
      id,
      text: options.text,
      startTime,
      endTime,
    };

    this.activeStations.set(id, { source, gain: stationGain, info: stationInfo });

    // Return a promise that resolves when playback completes
    return new Promise<string>((resolve) => {
      source.onended = () => {
        this.activeStations.delete(id);
        this.callbacks.onStationComplete?.(id);
        options.onComplete?.();
        resolve(id);
      };

      // Start playback
      source.start();
    });
  }

  async playSidetone(options: PlaySidetoneOptions): Promise<void> {
    if (!this.audioContext || this.status !== 'running') {
      throw new Error('Engine not running');
    }

    // Stop any existing sidetone
    this.stopSidetone();

    const wpm = validateWpm(options.wpm);
    const fwpm = options.fwpm !== undefined ? validateFwpm(options.fwpm, wpm) : undefined;
    const frequency = validateFrequency(options.frequency ?? this.sidetoneFrequency);
    const volume = clamp(options.volume ?? this.sidetoneVolume, 0, 1);

    // Generate morse timings
    const timings = getMorseTimings(options.text, wpm, fwpm);

    // Generate clean audio samples (no effects)
    const samples = generateSamples(timings, frequency, this.sampleRate);

    // Create audio buffer
    const audioBuffer = this.audioContext.createBuffer(1, samples.length, this.sampleRate);
    // Copy samples to buffer
    audioBuffer.getChannelData(0).set(samples);

    // Create source with its own gain for volume control and fade-out
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;

    // Create a dedicated gain node for this sidetone instance
    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = volume;
    source.connect(gainNode);
    gainNode.connect(this.sidetoneGain!);

    this.activeSidetone = { source, gain: gainNode };
    this.sidetoneActive = true;

    // Return a promise that resolves when playback completes
    return new Promise<void>((resolve) => {
      source.onended = () => {
        if (this.activeSidetone?.source === source) {
          this.activeSidetone = null;
          this.sidetoneActive = false;
          this.callbacks.onSidetoneComplete?.();
          options.onComplete?.();
        }
        resolve();
      };

      // Start playback immediately
      source.start();
    });
  }

  stopStation(id: string): void {
    const station = this.activeStations.get(id);
    if (station && this.audioContext) {
      const currentTime = this.audioContext.currentTime;
      // Fade out to prevent click
      station.gain.gain.setValueAtTime(station.gain.gain.value, currentTime);
      station.gain.gain.exponentialRampToValueAtTime(0.001, currentTime + ContestAudioEngine.FADE_OUT_DURATION);
      // Stop after fade-out completes
      try {
        station.source.stop(currentTime + ContestAudioEngine.FADE_OUT_DURATION);
      } catch {
        // Ignore if already stopped
      }
      this.activeStations.delete(id);
    }
  }

  stopSidetone(): void {
    if (this.activeSidetone && this.audioContext) {
      const currentTime = this.audioContext.currentTime;
      // Fade out to prevent click
      this.activeSidetone.gain.gain.setValueAtTime(this.activeSidetone.gain.gain.value, currentTime);
      this.activeSidetone.gain.gain.exponentialRampToValueAtTime(0.001, currentTime + ContestAudioEngine.FADE_OUT_DURATION);
      // Stop after fade-out completes
      try {
        this.activeSidetone.source.stop(currentTime + ContestAudioEngine.FADE_OUT_DURATION);
      } catch {
        // Ignore if already stopped
      }
      this.activeSidetone = null;
      this.sidetoneActive = false;
    }
  }

  stopAllStations(): void {
    for (const [id] of this.activeStations) {
      this.stopStation(id);
    }
  }

  getActiveStations(): ActiveStation[] {
    return Array.from(this.activeStations.values()).map(({ info }) => info);
  }

  isSidetoneActive(): boolean {
    return this.sidetoneActive;
  }

  setCallbacks(callbacks: ContestEngineCallbacks): void {
    this.callbacks = callbacks;
  }
}

/**
 * Create a new contest audio engine instance
 */
export function createContestAudioEngine(options?: ContestEngineOptions): IContestAudioEngine {
  return new ContestAudioEngine(options);
}
