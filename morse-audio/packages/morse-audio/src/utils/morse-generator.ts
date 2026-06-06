import { translate } from './morse-code';
import { generateSamples, getSampleRate } from './audio-generator';
import { applyRadioEffects } from './radio-effects';
import { getData as getRiffWaveData, getMIMEType } from './riffwave';
import { getDataURI } from './datauri';
import {
  DEFAULT_FREQUENCY,
  DEFAULT_PRE_DELAY,
  DEFAULT_POST_DELAY,
  RAMP_DURATION,
  validateWpm,
  validateFwpm,
  validateFrequency,
  validatePreDelay,
  validatePostDelay,
} from '../constants';
import type { MorseGeneratorOptions, GeneratedMorseAudio } from '../types';

/**
 * Generate morse code audio from text
 *
 * @param options - Generation options including text, wpm, frequency, etc.
 * @returns Object containing the audio data URI and metadata
 */
export function generateMorseAudio(options: MorseGeneratorOptions): GeneratedMorseAudio {
  const {
    text,
    wpm: rawWpm,
    fwpm: rawFwpm,
    frequency: rawFrequency = DEFAULT_FREQUENCY,
    preDelay: rawPreDelay = DEFAULT_PRE_DELAY,
    postDelay: rawPostDelay = DEFAULT_POST_DELAY,
    radioEffects,
  } = options;

  // Validate all inputs
  const wpm = validateWpm(rawWpm);
  const fwpm = validateFwpm(rawFwpm ?? rawWpm, wpm);
  const frequency = validateFrequency(rawFrequency);
  const preDelay = validatePreDelay(rawPreDelay);
  const postDelay = validatePostDelay(rawPostDelay);

  // Translate text to morse timings
  const { timings } = translate(text, wpm, fwpm);

  // Add pre-delay at the start (negative values indicate silence)
  // This helps with Bluetooth audio devices that have fade-in behavior
  timings.unshift(-preDelay);

  // Add post-delay at the end (prevents clipping on Firefox/Windows)
  timings.push(-postDelay);

  // Add zero at the end for clean audio termination on iOS/macOS
  timings.push(0);

  // Get sample rate
  const sampleRate = getSampleRate();

  // Generate audio samples
  let samples = generateSamples(timings, frequency, sampleRate, RAMP_DURATION);

  // Apply radio effects (QRN/QSB) if configured
  samples = applyRadioEffects(samples, sampleRate, radioEffects);

  // Convert to WAV format data URI
  const dataUri = getDataURI(getRiffWaveData(samples, sampleRate), getMIMEType());

  return {
    dataUri,
    timings,
    sampleRate,
  };
}

/**
 * Calculate the approximate duration of morse audio in seconds
 * Based on the timings array (positive = sound, negative = silence)
 */
export function calculateDuration(timings: number[]): number {
  const totalMs = timings.reduce((sum, timing) => sum + Math.abs(timing), 0);
  return totalMs / 1000;
}
