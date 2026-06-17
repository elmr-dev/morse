// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { reconcile, beatTheBotBoard, getAuthState, loadMock } = vi.hoisted(
  () => {
    type State = {
      status: 'loading' | 'signed-out' | 'needs-callsign' | 'ready';
      profile: { call_sign: string; verified: boolean } | null;
      user: { id: string } | null;
    };
    const state: State = { status: 'signed-out', profile: null, user: null };
    const loadMock = vi.fn(async () => ({ rows: [], hasMore: false }));
    return {
      reconcile: vi.fn(async () => ({})),
      beatTheBotBoard: vi.fn((defaultSeg?: string) => ({
        id: 'beat-the-bot',
        label: 'Beat the Bot',
        segments: [
          { id: 'no-code', label: 'No-Code' },
          { id: 'technician', label: 'Technician' },
          { id: 'general', label: 'General' },
          { id: 'extra', label: 'Extra' },
        ],
        defaultSegmentId: defaultSeg ?? 'no-code',
        load: loadMock,
      })),
      getAuthState: () => state,
      loadMock,
    };
  }
);

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

vi.mock('@/lib/supabase', () => ({
  supabase: null,
  isAuthConfigured: true,
}));

vi.mock('@/lib/bests-sync', () => ({
  reconcile: (...args: Parameters<typeof reconcile>) => reconcile(...args),
}));

vi.mock('@/lib/leaderboard-btb', () => ({
  beatTheBotBoard: (defaultSeg?: string) => beatTheBotBoard(defaultSeg),
}));

import LeaderboardPage from './leaderboard-page';

function renderPage() {
  return render(
    <MemoryRouter>
      <LeaderboardPage />
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
  loadMock.mockResolvedValue({ rows: [], hasMore: false });
  stubLocalStorage();
  const s = getAuthState();
  s.status = 'signed-out';
  s.profile = null;
  s.user = null;
});

afterEach(() => {
  cleanup();
});

describe('LeaderboardPage', () => {
  it('renders for a signed-out viewer without crashing or reconciling', async () => {
    renderPage();
    await screen.findByRole('heading', { name: /leaderboard/i });
    expect(reconcile).not.toHaveBeenCalled();
    // Sign-in nudge for anonymous viewers.
    expect(screen.getByText(/sign in to claim/i)).toBeInTheDocument();
  });

  it('opens on the All segment regardless of morse:btb:tier', () => {
    localStorage.setItem('morse:btb:tier', JSON.stringify('extra'));
    renderPage();
    expect(beatTheBotBoard).toHaveBeenCalledWith('all');
  });

  it('triggers reconcile-on-open for a ready viewer', async () => {
    const s = getAuthState();
    s.status = 'ready';
    s.user = { id: 'u1' };
    s.profile = { call_sign: 'W4GIT', verified: false };
    renderPage();
    await waitFor(() =>
      expect(reconcile).toHaveBeenCalledWith(expect.any(Object), 'u1')
    );
  });
});
