/**
 * CW QRM (interference) generator
 *
 * Generates independent CW signals at offset frequencies to simulate
 * adjacent-channel interference from other stations on the band.
 *
 * In real-world conditions, CW operators often have to copy through
 * QRM from nearby stations, especially during contests or on crowded bands.
 */

import { translate } from '../utils/morse-code';
import { generateSamples } from '../utils/audio-generator';
import type { CWQrmOptions } from './types';

/**
 * Seeded PRNG
 */
function createPrng(seed: number): () => number {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a random callsign-like string for QRM
 */
function generateRandomCallsign(prng: () => number): string {
  const prefixes = ['W', 'K', 'N', 'AA', 'AB', 'AC', 'WA', 'KB', 'KD', 'DL', 'G', 'F', 'JA', 'UA', 'VE'];
  const prefix = prefixes[Math.floor(prng() * prefixes.length)];

  const numDigits = 1 + Math.floor(prng() * 2); // 1-2 digits
  let number = '';
  for (let i = 0; i < numDigits; i++) {
    number += Math.floor(prng() * 10);
  }

  const suffixLength = 1 + Math.floor(prng() * 3); // 1-3 letters
  let suffix = '';
  for (let i = 0; i < suffixLength; i++) {
    suffix += String.fromCharCode(65 + Math.floor(prng() * 26));
  }

  return `${prefix}${number}${suffix}`;
}

/**
 * Generate random QRM text (callsigns, exchanges, etc.)
 */
function generateQrmText(length: number, prng: () => number): string {
  const parts: string[] = [];
  let currentLength = 0;

  while (currentLength < length) {
    // Mix of callsigns, numbers, and common CW abbreviations
    const r = prng();
    let part: string;

    if (r < 0.4) {
      // Callsign
      part = generateRandomCallsign(prng);
    } else if (r < 0.6) {
      // Contest exchange (5NN + number)
      part = `5NN ${Math.floor(prng() * 1000).toString().padStart(3, '0')}`;
    } else if (r < 0.8) {
      // Common CW words
      const words = ['CQ', 'DE', 'K', 'TU', 'RST', '599', 'QSL', 'TEST', 'AGN', 'PSE'];
      part = words[Math.floor(prng() * words.length)];
    } else {
      // Random letters
      const len = 2 + Math.floor(prng() * 4);
      part = '';
      for (let i = 0; i < len; i++) {
        part += String.fromCharCode(65 + Math.floor(prng() * 26));
      }
    }

    parts.push(part);
    currentLength += part.length + 1;
  }

  return parts.join(' ');
}

/**
 * Generate a QRM signal
 *
 * @param targetLength - Target length in samples
 * @param centerFrequency - Main signal frequency (QRM will be offset from this)
 * @param options - QRM configuration
 * @param sampleRate - Sample rate in Hz
 * @param seed - Random seed for reproducibility
 * @returns Float32Array of QRM samples
 */
export function generateQrmSignal(
  targetLength: number,
  centerFrequency: number,
  options: CWQrmOptions,
  sampleRate: number,
  seed?: number
): Float32Array {
  const prng = createPrng(seed ?? Math.floor(Math.random() * 2147483647));

  // Determine QRM frequency
  const qrmFrequency = centerFrequency + options.frequencySeparation;

  // Determine QRM WPM
  const qrmWpm = options.wpm ?? 15 + Math.floor(prng() * 25); // 15-40 WPM

  // Generate QRM text
  const targetDurationSec = targetLength / sampleRate;
  // Estimate characters needed (rough: 1 char ≈ 50ms at 25 WPM)
  const charsNeeded = Math.ceil(targetDurationSec / (50 / 1000 * (25 / qrmWpm)));
  const qrmText = options.text ?? generateQrmText(charsNeeded, prng);

  // Generate morse timings
  const { timings } = translate(qrmText, qrmWpm, qrmWpm);

  // Generate audio
  const qrmSamples = generateSamples(timings, qrmFrequency, sampleRate, 5, 0);

  // Adjust to target length
  const output = new Float32Array(targetLength);

  // Random start offset (QRM doesn't align with our signal)
  const startOffset = Math.floor(prng() * Math.min(sampleRate, targetLength / 4));

  // Copy samples, potentially wrapping around
  for (let i = 0; i < targetLength; i++) {
    const qrmIndex = (i + startOffset) % qrmSamples.length;
    if (qrmIndex < qrmSamples.length) {
      output[i] = qrmSamples[qrmIndex];
    }
  }

  // Apply power level
  // Power in dB relative to main signal (which has 0.8 peak)
  const linearGain = Math.pow(10, options.powerDb / 20) * 0.8;
  for (let i = 0; i < output.length; i++) {
    output[i] *= linearGain;
  }

  return output;
}

/**
 * Generate random QRM options
 *
 * @param prng - PRNG function
 * @returns CWQrmOptions
 */
export function randomQrmOptions(prng: () => number = Math.random): CWQrmOptions {
  // Frequency separation: 50-800 Hz, can be positive or negative
  const separation = (50 + prng() * 750) * (prng() < 0.5 ? 1 : -1);

  // Power: -10 to +10 dB relative to main signal
  const powerDb = -10 + prng() * 20;

  // WPM: 15-40
  const wpm = 15 + Math.floor(prng() * 26);

  return {
    frequencySeparation: separation,
    powerDb,
    wpm,
  };
}

/**
 * Mix QRM signals with main audio
 *
 * @param mainSignal - Main CW signal
 * @param qrmSignals - Array of QRM signals to mix in
 * @returns Mixed audio
 */
export function mixQrmSignals(
  mainSignal: Float32Array,
  qrmSignals: Float32Array[]
): Float32Array {
  const output = new Float32Array(mainSignal.length);

  // Start with main signal
  for (let i = 0; i < mainSignal.length; i++) {
    output[i] = mainSignal[i];
  }

  // Add QRM signals
  for (const qrm of qrmSignals) {
    const len = Math.min(output.length, qrm.length);
    for (let i = 0; i < len; i++) {
      output[i] += qrm[i];
    }
  }

  return output;
}
