// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

const { useAuthMock, isAuthConfiguredRef } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  isAuthConfiguredRef: { value: true },
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => useAuthMock(),
}));
vi.mock('@/lib/supabase', () => ({
  get isAuthConfigured() {
    return isAuthConfiguredRef.value;
  },
}));

import SyncStatus from './sync-status';

function setAuth(
  status: 'loading' | 'signed-out' | 'needs-callsign' | 'ready',
  profile: { call_sign: string } | null = null
) {
  useAuthMock.mockReturnValue({
    status,
    session: null,
    user: null,
    profile,
    signIn: vi.fn(),
    signOut: vi.fn(),
    claimCallsign: vi.fn(),
    refreshProfile: vi.fn(),
  });
}

function renderInRouter() {
  return render(
    <MemoryRouter>
      <SyncStatus />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  isAuthConfiguredRef.value = true;
});

afterEach(() => {
  cleanup();
});

describe('SyncStatus', () => {
  it('renders "Synced as W4GIT" with the callsign linking to /account when ready', () => {
    setAuth('ready', { call_sign: 'W4GIT' });
    renderInRouter();
    expect(screen.getByText(/Synced as/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'W4GIT' });
    expect(link).toHaveAttribute('href', '/account');
  });

  it('renders "Saved on this device" with a Sign in link when signed-out', () => {
    setAuth('signed-out');
    renderInRouter();
    expect(screen.getByText(/Saved on this device/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /sign in to sync/i });
    expect(link).toHaveAttribute('href', '/account');
  });

  it('prompts to claim a callsign when needs-callsign', () => {
    setAuth('needs-callsign');
    renderInRouter();
    const link = screen.getByRole('link', {
      name: /claim a callsign to sync/i,
    });
    expect(link).toHaveAttribute('href', '/account');
  });

  it('renders nothing when loading', () => {
    setAuth('loading');
    const { container } = renderInRouter();
    expect(container.textContent).toBe('');
  });

  it('omits the link when auth is not configured', () => {
    isAuthConfiguredRef.value = false;
    setAuth('signed-out');
    renderInRouter();
    expect(screen.getByText(/Saved on this device/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('has no axe violations in the signed-out (link-present) render', async () => {
    setAuth('signed-out');
    const { container } = renderInRouter();
    expect(await axe(container)).toHaveNoViolations();
  });
});
