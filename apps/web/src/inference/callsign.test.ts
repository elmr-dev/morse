// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  callsignCountry,
  callsignRegion,
  randomCallsign,
  randomCanadianCallsign,
  randomUsCallsign,
  randomWorldCallsign,
} from './callsign';

// Mulberry32 — small deterministic PRNG so test sequences are reproducible.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('callsign generators', () => {
  it('US callsigns start with K/W/N or A[A-L]', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 200; i++) {
      const call = randomUsCallsign(rng);
      // [letter prefix][digit][2-3 letters]
      expect(call).toMatch(/^([KWN][A-Z]?|A[A-L])\d[A-Z]{2,3}$/);
    }
  });

  it('Canadian callsigns start with V[A-Y] or CG/CY', () => {
    const rng = mulberry32(2);
    for (let i = 0; i < 200; i++) {
      const call = randomCanadianCallsign(rng);
      expect(call).toMatch(/^(V[ACEOGY]|CG|CY)\d[A-Z]{2,3}$/);
      // Canadian digits are 1-9, not 0
      const digit = call.match(/\d/)?.[0] ?? '0';
      expect(parseInt(digit, 10)).toBeGreaterThanOrEqual(1);
      expect(parseInt(digit, 10)).toBeLessThanOrEqual(9);
    }
  });

  it('World callsigns are not US/Canada', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 200; i++) {
      const call = randomWorldCallsign(rng);
      expect(call).toMatch(/^[A-Z0-9]+\d[A-Z]{2,3}$/);
      expect(callsignRegion(call)).toBe('World');
    }
  });
});

describe('randomCallsign weighting', () => {
  it('roughly hits 60/25/15 US/Canada/World', () => {
    const rng = mulberry32(42);
    const counts = { US: 0, Canada: 0, World: 0 };
    const N = 5000;
    for (let i = 0; i < N; i++) {
      const call = randomCallsign({ rng });
      counts[callsignRegion(call)]++;
    }
    const us = counts.US / N;
    const ca = counts.Canada / N;
    const wo = counts.World / N;
    // Allow ±5 percentage points for sample noise.
    expect(us).toBeGreaterThan(0.55);
    expect(us).toBeLessThan(0.65);
    expect(ca).toBeGreaterThan(0.2);
    expect(ca).toBeLessThan(0.3);
    expect(wo).toBeGreaterThan(0.1);
    expect(wo).toBeLessThan(0.2);
  });

  it('respects custom weights', () => {
    const rng = mulberry32(7);
    const counts = { US: 0, Canada: 0, World: 0 };
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const call = randomCallsign({
        rng,
        weights: { us: 0, canada: 1, world: 0 },
      });
      counts[callsignRegion(call)]++;
    }
    expect(counts.Canada).toBe(N);
    expect(counts.US).toBe(0);
    expect(counts.World).toBe(0);
  });
});

describe('callsignRegion', () => {
  it('classifies known callsigns', () => {
    // US — 1×1
    expect(callsignRegion('K1ABC')).toBe('US');
    expect(callsignRegion('W2DEF')).toBe('US');
    expect(callsignRegion('N3GHI')).toBe('US');
    // US — 1×2
    expect(callsignRegion('KA1XYZ')).toBe('US');
    expect(callsignRegion('WB6ABC')).toBe('US');
    // US — 2×1 Extra
    expect(callsignRegion('AA1AA')).toBe('US');
    expect(callsignRegion('AL7DE')).toBe('US');
    // Canada
    expect(callsignRegion('VE3ABC')).toBe('Canada');
    expect(callsignRegion('VA7DEF')).toBe('Canada');
    expect(callsignRegion('VO1XYZ')).toBe('Canada');
    expect(callsignRegion('VY1AAA')).toBe('Canada');
    // World
    expect(callsignRegion('G0ABC')).toBe('World');
    expect(callsignRegion('DL1XYZ')).toBe('World');
    expect(callsignRegion('JA1ABC')).toBe('World');
    expect(callsignRegion('VK2DEF')).toBe('World');
  });

  it('handles lowercase input', () => {
    expect(callsignRegion('ve3abc')).toBe('Canada');
    expect(callsignRegion('k1abc')).toBe('US');
  });
});

describe('callsignCountry', () => {
  it('resolves a US call to the United States', () => {
    expect(callsignCountry('W1AW')).toEqual({
      country: 'United States',
      flag: '🇺🇸',
    });
    expect(callsignCountry('K3ABC')).toEqual({
      country: 'United States',
      flag: '🇺🇸',
    });
  });

  it('resolves a 2x1 (A-prefix, digit in 3rd position) US call', () => {
    // Exercises the trailing A–Z wildcard accepting a digit where the series
    // notation has a letter ("AAA-ALZ" covers AA1, AL9, …).
    expect(callsignCountry('AA1BC')).toEqual({
      country: 'United States',
      flag: '🇺🇸',
    });
  });

  it('resolves world calls to their country', () => {
    expect(callsignCountry('JA1XYZ')).toEqual({ country: 'Japan', flag: '🇯🇵' });
    expect(callsignCountry('G3XYZ')).toEqual({
      country: 'United Kingdom',
      flag: '🇬🇧',
    });
    expect(callsignCountry('DL1ABC')).toEqual({
      country: 'Germany',
      flag: '🇩🇪',
    });
  });

  it('is case-insensitive', () => {
    expect(callsignCountry('w1aw')).toEqual({
      country: 'United States',
      flag: '🇺🇸',
    });
  });

  it('returns null for a reserved series (empty flag)', () => {
    // QAA-QNZ is reserved → no flag → caller falls back to the region label.
    expect(callsignCountry('Q3ABC')).toBeNull();
  });

  it('returns null for empty / unresolvable input', () => {
    expect(callsignCountry('')).toBeNull();
    expect(callsignCountry('123')).toBeNull();
  });

  it('resolves Canadian VE/VC calls to Canada', () => {
    expect(callsignCountry('VE5AGZ')).toEqual({
      country: 'Canada',
      flag: '🇨🇦',
    });
    expect(callsignCountry('VC3XYZ')).toEqual({
      country: 'Canada',
      flag: '🇨🇦',
    });
  });

  it('resolves ZL calls to New Zealand', () => {
    expect(callsignCountry('ZL2ABC')).toEqual({
      country: 'New Zealand',
      flag: '🇳🇿',
    });
  });
});
