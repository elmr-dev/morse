// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  applyRound,
  type Bests,
  EMPTY_BESTS,
  mergeCloudBests,
  publishableBests,
} from './beat-the-bot';

describe('publishableBests', () => {
  it('skips tiers with a null bestCopyPct', () => {
    const bests: Bests = {
      ...EMPTY_BESTS,
      technician: { bestCopyPct: 80, botCopyPctAtBest: 60, beatCount: 1 },
    };
    const rows = publishableBests(bests);
    expect(rows).toEqual([
      { tier: 'technician', bestCopyPct: 80, botCopyPctAtBest: 60 },
    ]);
  });

  it('coerces a null botCopyPctAtBest to 0', () => {
    const bests: Bests = {
      ...EMPTY_BESTS,
      general: { bestCopyPct: 50, botCopyPctAtBest: null, beatCount: 0 },
    };
    expect(publishableBests(bests)).toEqual([
      { tier: 'general', bestCopyPct: 50, botCopyPctAtBest: 0 },
    ]);
  });
});

describe('mergeCloudBests', () => {
  it('adopts a higher cloud best, including its bot pairing', () => {
    const local: Bests = {
      ...EMPTY_BESTS,
      technician: { bestCopyPct: 70, botCopyPctAtBest: 65, beatCount: 3 },
    };
    const merged = mergeCloudBests(local, [
      { tier: 'technician', bestCopyPct: 90, botCopyPctAtBest: 55 },
    ]);
    expect(merged.technician).toEqual({
      bestCopyPct: 90,
      botCopyPctAtBest: 55,
      beatCount: 3, // local-only, preserved
    });
  });

  it('ignores a lower cloud best', () => {
    const local: Bests = {
      ...EMPTY_BESTS,
      general: { bestCopyPct: 80, botCopyPctAtBest: 70, beatCount: 2 },
    };
    const merged = mergeCloudBests(local, [
      { tier: 'general', bestCopyPct: 50, botCopyPctAtBest: 30 },
    ]);
    expect(merged.general).toEqual({
      bestCopyPct: 80,
      botCopyPctAtBest: 70,
      beatCount: 2,
    });
  });

  it('adopts cloud values for a locally-null tier', () => {
    const merged = mergeCloudBests(EMPTY_BESTS, [
      { tier: 'extra', bestCopyPct: 40, botCopyPctAtBest: 35 },
    ]);
    expect(merged.extra).toEqual({
      bestCopyPct: 40,
      botCopyPctAtBest: 35,
      beatCount: 0,
    });
  });

  it('leaves beatCount untouched on every tier', () => {
    const local: Bests = {
      'no-code': { bestCopyPct: 10, botCopyPctAtBest: 5, beatCount: 7 },
      technician: { bestCopyPct: null, botCopyPctAtBest: null, beatCount: 4 },
      general: { bestCopyPct: 50, botCopyPctAtBest: 40, beatCount: 1 },
      extra: { bestCopyPct: null, botCopyPctAtBest: null, beatCount: 0 },
    };
    const merged = mergeCloudBests(local, [
      { tier: 'no-code', bestCopyPct: 99, botCopyPctAtBest: 88 },
      { tier: 'technician', bestCopyPct: 30, botCopyPctAtBest: 20 },
    ]);
    expect(merged['no-code'].beatCount).toBe(7);
    expect(merged.technician.beatCount).toBe(4);
    expect(merged.general.beatCount).toBe(1);
    expect(merged.extra.beatCount).toBe(0);
  });
});

describe('applyRound (sanity)', () => {
  // Slice-1 behavior, kept colocated so future refactors notice regressions.
  it('sets a new best on the first scoring round', () => {
    const { bests, isNewBest } = applyRound(EMPTY_BESTS, 'general', 50, 30);
    expect(isNewBest).toBe(true);
    expect(bests.general.bestCopyPct).toBe(50);
    expect(bests.general.botCopyPctAtBest).toBe(30);
  });
});
