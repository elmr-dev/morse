/**
 * Station audio chain for pileup simulation
 *
 * Each station in a pileup has its own audio processing chain:
 * 1. Generate morse code samples at station's frequency offset
 * 2. Apply per-station effects (Rayleigh, flutter, chirp, buzz)
 * 3. Apply signal strength (gain)
 */

import { translate } from '../utils/morse-code';
import { synthesizeCw } from '../core/cw-synthesis';
import type { PileupStation } from './types';

// Re-export generateEnvelope for backward compatibility
export { generateEnvelope } from '../utils/envelope';

/**
 * Result from generating a single station's audio
 */
export interface StationAudioResult {
  /** Audio samples */
  samples: Float32Array;
  /** Keying envelope (for effects that need it) */
  envelope: Float32Array;
  /** Station ID */
  id: string;
  /** Actual frequency used (center + offset) */
  frequency: number;
  /** Duration in seconds */
  duration: number;
}

/**
 * Generate audio samples for a single station
 *
 * @param station - Station configuration
 * @param centerFrequency - Receiver center frequency in Hz
 * @param sampleRate - Sample rate in Hz
 * @param totalDuration - Total audio duration in ms (for padding)
 * @param seed - Random seed for reproducible effects
 * @returns Station audio result
 */
export function generateStationAudio(
  station: PileupStation,
  centerFrequency: number,
  sampleRate: number,
  totalDuration: number,
  seed: number = 0
): StationAudioResult {
  // Calculate actual frequency (center + offset)
  const frequency = centerFrequency + station.frequencyOffset;

  // Translate text to timings
  const { timings } = translate(
    station.text,
    station.wpm,
    station.fwpm ?? station.wpm
  );

  // Calculate morse duration
  let morseMs = 0;
  for (const timing of timings) {
    morseMs += Math.abs(timing);
  }

  // Create station-specific seed
  const stationSeed = seed + hashString(station.id);
  const gain = Math.pow(10, station.signalStrength / 20);
  const synthesis = synthesizeCw({
    timings,
    frequency,
    sampleRate,
    totalDurationMs: totalDuration,
    startDelayMs: station.startDelay,
    amplitude: 0.8 * gain,
    seed: stationSeed,
    rayleigh: station.effects?.rayleigh,
    flutter: station.effects?.flutter,
    chirp: station.effects?.chirp,
    buzz: station.effects?.buzz,
  });

  return {
    samples: synthesis.samples,
    envelope: synthesis.envelope,
    id: station.id,
    frequency,
    duration: totalDuration / 1000,
  };
}

/**
 * Simple string hash for generating per-station seeds
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * Calculate the total duration needed for a pileup
 *
 * @param stations - Array of station configurations
 * @param preDelay - Pre-delay in ms
 * @param postDelay - Post-delay in ms
 * @returns Total duration in ms
 */
export function calculatePileupDuration(
  stations: PileupStation[],
  preDelay: number = 300,
  postDelay: number = 100
): number {
  let maxEndTime = 0;

  for (const station of stations) {
    // Calculate morse duration
    const { timings } = translate(
      station.text,
      station.wpm,
      station.fwpm ?? station.wpm
    );

    let morseMs = 0;
    for (const timing of timings) {
      morseMs += Math.abs(timing);
    }

    const endTime = station.startDelay + morseMs;
    if (endTime > maxEndTime) {
      maxEndTime = endTime;
    }
  }

  return preDelay + maxEndTime + postDelay;
}
