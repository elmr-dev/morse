/**
 * Fist model - Operator timing imperfection simulation
 *
 * Simulates the natural timing variations in human CW sending,
 * often called the operator's "fist". Each operator has characteristic
 * timing patterns that deviate from perfect machine-generated code.
 *
 * Key imperfections modeled:
 * - Per-element Gaussian jitter on all timings
 * - Dah length bias (some ops send long or short dahs)
 * - Speed drift over time
 * - Character gap stretching (hesitation between some characters)
 */

import { createPrng, gaussianRandom, randomSeed } from '../utils/prng';
import type { FistOptions, FistProfile, ElementMetadata } from './types';
import type { TranslationWithMetadata } from '../utils/morse-code';

/**
 * Fist profile parameters
 * Distribution: machine 10%, good 25%, average 35%, poor 20%, very_poor 10%
 */
export const FIST_PROFILES: Record<FistProfile, FistOptions> = {
  machine: {
    jitter: 0.005, // ~0.5%
    dahBias: 0,
    speedDriftWpmPerSec: 0,
    charGapStretchFraction: 0,
    charGapStretchRange: [1, 1],
  },
  good: {
    jitter: 0.05, // ~3-7%
    dahBias: -0.02, // Slight short dahs
    speedDriftWpmPerSec: 0.1,
    charGapStretchFraction: 0.05,
    charGapStretchRange: [1.2, 1.5],
  },
  average: {
    jitter: 0.11, // ~8-15%
    dahBias: -0.05,
    speedDriftWpmPerSec: 0.2,
    charGapStretchFraction: 0.12,
    charGapStretchRange: [1.3, 2.0],
  },
  // Vibroplex bug, banana-boat swing. Mechanical pendulum keeps dits machine-tight,
  // but dahs are manually held and famously dragged out ("dahhhh"). Minimal gap
  // stretching: bug ops run legato character-to-character, not hesitant.
  bug: {
    jitter: 0.04,
    dahBias: 0.4,
    speedDriftWpmPerSec: 0.05,
    charGapStretchFraction: 0.02,
    charGapStretchRange: [1.1, 1.3],
  },
  poor: {
    jitter: 0.20, // ~15-25%
    dahBias: -0.08,
    speedDriftWpmPerSec: 0.35,
    charGapStretchFraction: 0.18,
    charGapStretchRange: [1.5, 2.5],
  },
  very_poor: {
    jitter: 0.32, // ~25-40%
    dahBias: -0.12,
    speedDriftWpmPerSec: 0.5,
    charGapStretchFraction: 0.25,
    charGapStretchRange: [1.5, 3.0],
  },
};

/**
 * Distribution of fist profiles for random selection
 */
export const FIST_DISTRIBUTION: Array<{
  profile: FistProfile;
  probability: number;
}> = [
  { profile: 'machine', probability: 0.1 },
  { profile: 'good', probability: 0.25 },
  { profile: 'average', probability: 0.35 },
  { profile: 'poor', probability: 0.2 },
  { profile: 'very_poor', probability: 0.1 },
];

/**
 * Select random fist profile based on distribution
 */
export function randomFistProfile(
  prng: () => number = Math.random
): FistProfile {
  const r = prng();
  let cumulative = 0;

  for (const { profile, probability } of FIST_DISTRIBUTION) {
    cumulative += probability;
    if (r < cumulative) {
      return profile;
    }
  }

  return 'average';
}

/**
 * Get fist options for a profile with some random variation
 */
export function getFistOptions(
  profile: FistProfile,
  prng: () => number = Math.random
): FistOptions {
  const base = FIST_PROFILES[profile];

  // Add ±20% variation to parameters
  const vary = (val: number) => val * (0.8 + prng() * 0.4);

  return {
    jitter: vary(base.jitter),
    dahBias: base.dahBias * (0.5 + prng()), // 50-150% of base
    speedDriftWpmPerSec: vary(base.speedDriftWpmPerSec),
    charGapStretchFraction: Math.min(0.3, vary(base.charGapStretchFraction)),
    charGapStretchRange: base.charGapStretchRange,
  };
}

/**
 * Result of applying fist model to timings
 */
export interface FistTimings {
  /** Modified timings array */
  timings: number[];
  /** Element-level metadata with actual durations */
  elements: ElementMetadata[];
  /** Character-level metadata */
  characters: Array<{ char: string; startMs: number; endMs: number }>;
  /** Effective WPM after modifications */
  effectiveWpm: number;
}

/**
 * Apply fist model to morse code timings
 *
 * @param translation - Translation with metadata from translateWithMetadata()
 * @param options - Fist model options
 * @param nominalWpm - Original WPM for the translation
 * @param seed - Optional seed for reproducibility
 * @returns Modified timings with metadata
 */
export function applyFistModel(
  translation: TranslationWithMetadata,
  options: FistOptions,
  nominalWpm: number,
  seed?: number
): FistTimings {
  const prng = createPrng(seed ?? randomSeed());

  const { timings: originalTimings, elements: originalElements } = translation;

  // Generate per-sample dah bias (consistent within sample)
  // Range: -15% to +5%
  const dahBias = -0.15 + prng() * 0.2;

  // Determine which character gaps to stretch
  const charGapIndices: number[] = [];
  for (let i = 0; i < originalElements.length; i++) {
    if (originalElements[i].elementType === 'char_gap') {
      if (prng() < options.charGapStretchFraction) {
        charGapIndices.push(i);
      }
    }
  }

  // Process timings
  const newTimings: number[] = [];
  const newElements: ElementMetadata[] = [];
  let currentTimeMs = 0;

  // Track speed drift
  let currentWpmDrift = 0;
  const driftDirection = prng() < 0.5 ? 1 : -1;

  for (let i = 0; i < originalTimings.length; i++) {
    const originalDuration = Math.abs(originalTimings[i]);
    const isSound = originalTimings[i] > 0;
    const element = originalElements[i];

    // Apply speed drift (accumulates over time)
    currentWpmDrift +=
      driftDirection * options.speedDriftWpmPerSec * (originalDuration / 1000);
    // Clamp drift to reasonable bounds
    currentWpmDrift = Math.max(-2, Math.min(2, currentWpmDrift));

    // Calculate drift factor (faster WPM = shorter durations)
    const driftFactor = nominalWpm / (nominalWpm + currentWpmDrift);

    let newDuration = originalDuration * driftFactor;

    // Apply element-specific modifications
    if (element.elementType === 'dah') {
      // Apply dah bias
      newDuration *= 1 + dahBias + options.dahBias;
    }

    // Apply Gaussian jitter
    const jitterStdDev = newDuration * options.jitter;
    const jitter = gaussianRandom(prng) * jitterStdDev;
    newDuration = Math.max(newDuration * 0.4, newDuration + jitter);

    // Apply character gap stretching
    if (element.elementType === 'char_gap' && charGapIndices.includes(i)) {
      const [minStretch, maxStretch] = options.charGapStretchRange;
      const stretch = minStretch + prng() * (maxStretch - minStretch);
      newDuration *= stretch;
    }

    // Store the timing
    newTimings.push(isSound ? newDuration : -newDuration);

    // Store element metadata
    newElements.push({
      char: element.char,
      elementType: element.elementType,
      startMs: currentTimeMs,
      endMs: currentTimeMs + newDuration,
      nominalDurationMs: originalDuration,
      actualDurationMs: newDuration,
    });

    currentTimeMs += newDuration;
  }

  // Rebuild character timings from elements
  const newCharacters: Array<{ char: string; startMs: number; endMs: number }> =
    [];
  let currentChar = '';
  let charStartMs = 0;
  let charEndMs = 0;

  for (const elem of newElements) {
    if (elem.elementType === 'word_gap') {
      // Finalize previous character if any
      if (currentChar) {
        newCharacters.push({
          char: currentChar,
          startMs: charStartMs,
          endMs: charEndMs,
        });
        currentChar = '';
      }
      continue;
    }

    if (elem.elementType === 'char_gap') {
      // Finalize previous character
      if (currentChar) {
        newCharacters.push({
          char: currentChar,
          startMs: charStartMs,
          endMs: charEndMs,
        });
      }
      currentChar = '';
      continue;
    }

    // dit, dah, or intra_char_gap
    if (currentChar !== elem.char) {
      if (currentChar) {
        newCharacters.push({
          char: currentChar,
          startMs: charStartMs,
          endMs: charEndMs,
        });
      }
      currentChar = elem.char;
      charStartMs = elem.startMs;
    }
    charEndMs = elem.endMs;
  }

  // Don't forget the last character
  if (currentChar) {
    newCharacters.push({
      char: currentChar,
      startMs: charStartMs,
      endMs: charEndMs,
    });
  }

  // Calculate effective WPM
  // PARIS = 50 units, measure actual time vs theoretical
  const totalTimeMs = currentTimeMs;
  const originalTotalMs = originalTimings.reduce(
    (sum, t) => sum + Math.abs(t),
    0
  );
  const effectiveWpm = nominalWpm * (originalTotalMs / totalTimeMs);

  return {
    timings: newTimings,
    elements: newElements,
    characters: newCharacters,
    effectiveWpm,
  };
}
