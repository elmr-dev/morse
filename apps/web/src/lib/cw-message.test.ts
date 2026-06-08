import { describe, expect, it } from 'vitest';
import { CHARS } from '../inference/constants';
import { MAX_CW_MESSAGE, randomCwMessage } from './cw-message';

// Everything the decoder model can copy, plus space (keyed as a word break).
const ALLOWED = new Set([...CHARS, ' ']);

describe('randomCwMessage', () => {
  it('produces a non-empty, uppercase message within the input limit', () => {
    for (let i = 0; i < 3000; i++) {
      const msg = randomCwMessage();
      expect(msg.length).toBeGreaterThan(0);
      expect(msg.length).toBeLessThanOrEqual(MAX_CW_MESSAGE);
      expect(msg).toBe(msg.toUpperCase());
    }
  });

  it('only uses characters the model supports', () => {
    for (let i = 0; i < 3000; i++) {
      for (const ch of randomCwMessage()) {
        expect(ALLOWED.has(ch)).toBe(true);
      }
    }
  });

  it('is deterministic for a given rng', () => {
    const seq = () => {
      let s = 0x9e3779b9;
      return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };
    expect(randomCwMessage(seq())).toBe(randomCwMessage(seq()));
  });
});
