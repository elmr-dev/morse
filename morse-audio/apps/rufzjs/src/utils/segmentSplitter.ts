import { getConfusableCharacters } from './morseConfusables';

export interface SegmentChallenge {
  segment: string;
  choices: string[];
  correctIndex: number;
}

/**
 * Split a callsign into segments at the boundary after the last digit.
 * E.g. "K5CT" → ["K5", "CT"], "VE3ABC" → ["VE3", "ABC"]
 * Segments longer than 4 chars are subdivided.
 */
export function splitCallsign(call: string): string[] {
  const upper = call.toUpperCase();

  // Find the last digit position
  let lastDigitIdx = -1;
  for (let i = 0; i < upper.length; i++) {
    if (upper[i] >= '0' && upper[i] <= '9') {
      lastDigitIdx = i;
    }
  }

  let segments: string[];
  if (lastDigitIdx === -1 || lastDigitIdx === upper.length - 1) {
    // No digit or digit is last char — treat as single segment
    segments = [upper];
  } else {
    segments = [upper.slice(0, lastDigitIdx + 1), upper.slice(lastDigitIdx + 1)];
  }

  // Subdivide any segment > 4 chars
  const result: string[] = [];
  for (const seg of segments) {
    if (seg.length > 4) {
      const mid = Math.ceil(seg.length / 2);
      result.push(seg.slice(0, mid), seg.slice(mid));
    } else {
      result.push(seg);
    }
  }

  return result;
}

/**
 * Build distractor choices for a segment by swapping 1–2 characters
 * with morse-confusable alternatives.
 */
export function generateSegmentChoices(segment: string, numChoices: number = 5): SegmentChallenge {
  const choices = new Set<string>();
  choices.add(segment);

  let attempts = 0;
  while (choices.size < numChoices && attempts < 100) {
    attempts++;
    const chars = segment.split('');
    // Swap 1 or 2 characters
    const numSwaps = Math.random() < 0.5 ? 1 : Math.min(2, chars.length);
    const indices = shuffle(Array.from({ length: chars.length }, (_, i) => i)).slice(0, numSwaps);

    for (const idx of indices) {
      const confusables = getConfusableCharacters(chars[idx], 3);
      if (confusables.length > 0) {
        chars[idx] = confusables[Math.floor(Math.random() * confusables.length)];
      }
    }

    const distractor = chars.join('');
    if (distractor !== segment) {
      choices.add(distractor);
    }
  }

  // Convert to array and shuffle
  const choiceArray = shuffle([...choices]);
  const correctIndex = choiceArray.indexOf(segment);

  return { segment, choices: choiceArray, correctIndex };
}

/**
 * Build a full set of segment challenges for a callsign.
 */
export function buildCallsignChallenge(callsign: string): SegmentChallenge[] {
  const segments = splitCallsign(callsign);
  return segments.map(seg => generateSegmentChoices(seg, 5));
}

/** Fisher-Yates shuffle (returns new array) */
function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
