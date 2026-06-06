/**
 * Audio sample generator for morse code
 *
 * Generates sine wave audio samples with smooth attack/decay
 * to prevent clicking artifacts.
 */

import { generateEnvelopeWithLeadIn } from './envelope';

const DEFAULT_SAMPLE_RATE = 22050;

/** Supported sample rates for ML training data generation */
export type MLSampleRate = 8000 | 16000;

/** All supported sample rates */
export type SupportedSampleRate = MLSampleRate | 22050 | 44100;

/** Available ML sample rates */
export const ML_SAMPLE_RATES: readonly MLSampleRate[] = [8000, 16000] as const;

/**
 * Generate audio samples from morse timings
 *
 * @param timings - Array of timing values in ms (positive = sound, negative = silence)
 * @param frequency - Tone frequency in Hz
 * @param sampleRate - Sample rate in Hz
 * @param rampDuration - Duration of attack/decay ramp in ms
 * @param leadInMs - Silence padding at start for Bluetooth wake-up (ms)
 * @returns Float32Array of audio samples (-1 to 1)
 */
export function generateSamples(
  timings: number[],
  frequency: number,
  sampleRate: number = DEFAULT_SAMPLE_RATE,
  rampDuration: number = 5,
  leadInMs: number = 300
): Float32Array {
  // Generate envelope using shared utility
  const envelope = generateEnvelopeWithLeadIn(
    timings,
    sampleRate,
    rampDuration,
    leadInMs
  );

  const samples = new Float32Array(envelope.length);

  // Generate sine wave modulated by envelope
  const angularFreq = (2 * Math.PI * frequency) / sampleRate;
  for (let i = 0; i < envelope.length; i++) {
    const sine = Math.sin(angularFreq * i);
    samples[i] = sine * envelope[i] * 0.8; // 0.8 to avoid clipping
  }

  return samples;
}

/**
 * Get the default sample rate used for audio generation
 */
export function getSampleRate(): number {
  return DEFAULT_SAMPLE_RATE;
}
