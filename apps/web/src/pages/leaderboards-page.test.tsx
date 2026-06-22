// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  reconcileBtb,
  reconcileRedline,
  beatTheBotBoard,
  redlineBoard,
  getAuthState,
  btbLoad,
  redlineLoad,
} = vi.hoisted(() => {
  type State = {
    status: 'loading' | 'signed-out' | 'needs-callsign' | 'ready';
    profile: { call_sign: string; verified: boolean } | null;
    user: { id: string } | null;
  };
  const state: State = { status: 'signed-out', profile: null, user: null };
  const btbLoad = vi.fn(async () => ({ rows: [], hasMore: false }));
  const redlineLoad = vi.fn(async () => ({ rows: [], hasMore: false }));
  return {
    reconcileBtb: vi.fn(async (..._args: unknown[]) => ({})),
    reconcileRedline: vi.fn(async (..._args: unknown[]) => undefined),
    beatTheBotBoard: vi.fn((defaultSeg?: string) => ({
      id: 'beat-the-bot',
      label: 'Beat the Bot',
      segments: [{ id: 'all', label: 'All' }],
      defaultSegmentId: defaultSeg ?? 'all',
      load: btbLoad,
    })),
    redlineBoard: vi.fn(() => ({
      id: 'redline',
      label: 'Redline',
      tagHeader: 'Top WPM',
      playHref: '/redline',
      load: redlineLoad,
    })),
    getAuthState: () => state,
    btbLoad,
    redlineLoad,
  };
});

vi.mock('@/lib/auth', () => ({
  useAuth: () => {
    const s = getAuthState();
    return {
      status: s.status,
      session: s.user ? { user: s.user } : null,
      user: s.user,
      profile: s.profile,
      signIn: vi.fn(),
      signOut: vi.fn(),
      claimCallsign: vi.fn(),
      refreshProfile: vi.fn(),
    };
  },
}));

vi.mock('@/lib/supabase', () => ({ supabase: null, isAuthConfigured: true }));

vi.mock('@/lib/bests-sync', () => ({
  reconcile: (...args: unknown[]) => reconcileBtb(...args),
}));

vi.mock('@/lib/leaderboard-btb', () => ({
  beatTheBotBoard: (defaultSeg?: string) => beatTheBotBoard(defaultSeg),
}));

vi.mock('@/features/redline/leaderboard', () => ({
  reconcile: (...args: unknown[]) => reconcileRedline(...args),
  redlineBoard: () => redlineBoard(),
}));

import LeaderboardsPage from './leaderboards-page';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/leaderboards" element={<LeaderboardsPage />} />
        <Route path="/leaderboards/:trainer" element={<LeaderboardsPage />} />
        <Route path="/redline" element={<div>redline page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

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
  vi.clearAllMocks();
  btbLoad.mockResolvedValue({ rows: [], hasMore: false });
  redlineLoad.mockResolvedValue({ rows: [], hasMore: false });
  stubLocalStorage();
  const s = getAuthState();
  s.status = 'signed-out';
  s.profile = null;
  s.user = null;
});

afterEach(() => {
  cleanup();
});

describe('LeaderboardsPage tabs', () => {
  it('renders a deep-linkable tab per built trainer plus a disabled Pileup slot', async () => {
    renderAt('/leaderboards');
    await screen.findByRole('heading', { name: /^leaderboards$/i });
    const btbTab = screen.getByRole('tab', { name: /beat the bot/i });
    const redlineTab = screen.getByRole('tab', { name: /redline/i });
    const pileupTab = screen.getByRole('tab', { name: /pileup/i });
    expect(btbTab).toHaveAttribute('href', '/leaderboards/beat-the-bot');
    expect(redlineTab).toHaveAttribute('href', '/leaderboards/redline');
    // Pileup is a future slot — disabled, not a link.
    expect(pileupTab).toHaveAttribute('aria-disabled', 'true');
    expect(pileupTab).not.toHaveAttribute('href');
  });

  it('defaults to the Beat-the-Bot tab on the All segment, without reconciling when signed out', async () => {
    renderAt('/leaderboards');
    await screen.findByRole('heading', { name: /^leaderboards$/i });
    expect(beatTheBotBoard).toHaveBeenCalledWith('all');
    expect(redlineBoard).not.toHaveBeenCalled();
    expect(reconcileBtb).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: /beat the bot/i })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('reconciles only the active board on open for a ready viewer', async () => {
    const s = getAuthState();
    s.status = 'ready';
    s.user = { id: 'u1' };
    s.profile = { call_sign: 'W4GIT', verified: false };
    renderAt('/leaderboards');
    await waitFor(() =>
      expect(reconcileBtb).toHaveBeenCalledWith(expect.any(Object), 'u1')
    );
    expect(reconcileRedline).not.toHaveBeenCalled();
  });
});

describe('LeaderboardsPage per-trainer deep link', () => {
  it('selects and renders only the Redline board at /leaderboards/redline', async () => {
    renderAt('/leaderboards/redline');
    await screen.findByRole('heading', { name: /^leaderboards$/i });
    expect(redlineBoard).toHaveBeenCalled();
    expect(beatTheBotBoard).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: /redline/i })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('redirects an unknown trainer back to the aggregator', async () => {
    renderAt('/leaderboards/nope');
    await screen.findByRole('heading', { name: /^leaderboards$/i });
    // Default (Beat the Bot) board renders after the redirect.
    expect(beatTheBotBoard).toHaveBeenCalledWith('all');
  });
});
