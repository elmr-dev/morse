// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Pin the backend to "not configured" so these stay pure, offline unit tests —
// the env in CI may have VITE_SUPABASE_* set, which would otherwise make the
// cloud helpers hit a real project.
vi.mock('@/lib/supabase', () => ({ supabase: null, isAuthConfigured: false }));

import {
  fetchLeaderboard,
  publishScore,
  readLocalBest,
  reconcile,
  writeLocalBest,
} from './leaderboard';

// happy-dom's localStorage here is a partial stub (no clear/removeItem), so
// swap in a real in-memory Storage per test for isolated persisted-state reads.
function stubLocalStorage() {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, String(v)),
    removeItem: (k: string) => map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  });
}

beforeEach(() => {
  stubLocalStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('local best store', () => {
  it('starts empty', () => {
    expect(readLocalBest()).toBeNull();
  });

  it('records and reads back a best', () => {
    expect(writeLocalBest(1200, 30)).toEqual({ score: 1200, topWpm: 30 });
    expect(readLocalBest()).toEqual({ score: 1200, topWpm: 30 });
  });

  it('keeps the higher score and freezes its top WPM (improve-guarded)', () => {
    writeLocalBest(1200, 30);
    // A lower-scoring run never lowers the best, even with a higher WPM.
    expect(writeLocalBest(800, 45)).toEqual({ score: 1200, topWpm: 30 });
    // A higher-scoring run replaces it, carrying that run's top WPM.
    expect(writeLocalBest(1500, 28)).toEqual({ score: 1500, topWpm: 28 });
  });
});

describe('cloud calls without a backend configured', () => {
  // No VITE_SUPABASE_* in tests → supabase is null. These must degrade
  // gracefully rather than throw, so gameplay never sees a backend absence.
  it('returns an empty board', async () => {
    await expect(fetchLeaderboard()).resolves.toEqual([]);
  });

  it('publish and reconcile are safe no-ops', async () => {
    await expect(publishScore(1000, 25)).resolves.toBeUndefined();
    writeLocalBest(1000, 25);
    await expect(reconcile()).resolves.toBeUndefined();
  });
});
