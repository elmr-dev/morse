// Unit tests for the greedy CTC decoder. Synthesizes log-prob frames and
// asserts the decoder collapses runs and applies the entropy/blank-ratio
// gates correctly.

import { describe, expect, it } from 'vitest';
import { BLANK_IDX, CHARS, IDX_TO_CHAR, NUM_CLASSES } from './constants';
import { cer, greedyDecode } from './decode';

// Build a (T * NUM_CLASSES) Float32Array from a list of "winner" class indices,
// where each winner gets logit 0 (≈ p=1 after softmax) and others get -10.
// Returns a CTC-style log-probabilities tensor.
function logProbsFromWinners(winners: number[]): Float32Array {
  const T = winners.length;
  const out = new Float32Array(T * NUM_CLASSES);
  for (let t = 0; t < T; t++) {
    for (let c = 0; c < NUM_CLASSES; c++) {
      out[t * NUM_CLASSES + c] = c === winners[t] ? 0 : -10;
    }
  }
  return out;
}

describe('greedyDecode', () => {
  it('collapses repeated frames into one character', () => {
    const E = CHARS.indexOf('E') + 1; // E is char index 5 (1-based after blank)
    const winners = Array(20).fill(E);
    const lp = logProbsFromWinners(winners);
    // High blank-ratio threshold to avoid tripping the empty-output guard
    const r = greedyDecode(lp, 20, {
      entropyThreshold: 0,
      blankRatioThreshold: 0.99,
    });
    expect(r.text).toBe('E');
    expect(r.indices).toEqual([E]);
  });

  it('separates same character with blank between', () => {
    const E = CHARS.indexOf('E') + 1;
    const winners = [
      ...Array(10).fill(E),
      ...Array(10).fill(BLANK_IDX),
      ...Array(10).fill(E),
    ];
    const lp = logProbsFromWinners(winners);
    const r = greedyDecode(lp, winners.length, {
      entropyThreshold: 0,
      blankRatioThreshold: 0.99,
    });
    expect(r.text).toBe('EE');
  });

  it('returns "" when blank ratio exceeds the threshold', () => {
    const winners = Array(100).fill(BLANK_IDX);
    const lp = logProbsFromWinners(winners);
    const r = greedyDecode(lp, 100);
    expect(r.text).toBe('');
    expect(r.confidence).toBe(0);
  });

  it('IDX_TO_CHAR + CHARS round-trip is consistent', () => {
    expect(NUM_CLASSES).toBe(CHARS.length + 1);
    for (let i = 0; i < CHARS.length; i++) {
      expect(IDX_TO_CHAR[i + 1]).toBe(CHARS[i]);
    }
    expect(IDX_TO_CHAR[BLANK_IDX]).toBe('');
  });
});

describe('cer', () => {
  it('returns 0 for identical strings', () => {
    expect(cer('PARIS', 'PARIS')).toBe(0);
  });
  it('returns 1.0 for empty hypothesis on non-empty reference', () => {
    expect(cer('PARIS', '')).toBe(1);
  });
  it('handles single substitution', () => {
    expect(cer('PARIS', 'PARIZ')).toBe(1 / 5);
  });
  it('handles single deletion', () => {
    expect(cer('PARIS', 'PARI')).toBe(1 / 5);
  });
  it('handles single insertion', () => {
    expect(cer('PARIS', 'PARISX')).toBe(1 / 5);
  });
  it('returns 0 for both empty', () => {
    expect(cer('', '')).toBe(0);
  });
});
