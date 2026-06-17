// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { ClaimResult } from '@/lib/auth';
import type { Profile } from '@/lib/supabase';

const { signIn, signOut, claimCallsign, refreshProfile, getState } = vi.hoisted(
  () => {
    type Profile = {
      id: string;
      call_sign: string;
      verified: boolean;
      created_at: string;
    };
    type State = {
      status: 'loading' | 'signed-out' | 'needs-callsign' | 'ready';
      profile: Profile | null;
      user: { email?: string } | null;
      configured: boolean;
    };
    const state: State = {
      status: 'signed-out',
      profile: null,
      user: null,
      configured: true,
    };
    return {
      signIn: vi.fn(async () => {}),
      signOut: vi.fn(async () => {}),
      claimCallsign: vi.fn(
        async (_raw: string): Promise<ClaimResult> => ({ ok: true })
      ),
      refreshProfile: vi.fn(async () => {}),
      getState: () => state,
    };
  }
);

vi.mock('@/lib/supabase', () => ({
  get isAuthConfigured() {
    return getState().configured;
  },
  supabase: null,
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => {
    const s = getState();
    return {
      status: s.status,
      session: s.user ? { user: s.user } : null,
      user: s.user,
      profile: s.profile,
      signIn,
      signOut,
      claimCallsign,
      refreshProfile,
    };
  },
}));

// Toast is fire-and-forget; tests don't assert on it (mock so it doesn't throw
// inside happy-dom from missing portal targets).
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import AccountPage from './account-page';

function renderPage() {
  return render(
    <MemoryRouter>
      <AccountPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  const s = getState();
  s.status = 'signed-out';
  s.profile = null;
  s.user = null;
  s.configured = true;
});

afterEach(() => {
  cleanup();
});

describe('AccountPage', () => {
  it('signed-out renders all three provider buttons and signs in with the right id', async () => {
    renderPage();
    const google = screen.getByRole('button', {
      name: /continue with google/i,
    });
    const github = screen.getByRole('button', {
      name: /continue with github/i,
    });
    const discord = screen.getByRole('button', {
      name: /continue with discord/i,
    });
    expect(google).toBeInTheDocument();
    expect(github).toBeInTheDocument();
    expect(discord).toBeInTheDocument();

    fireEvent.click(github);
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('github'));
  });

  it('needs-callsign: submitting a valid call calls claimCallsign and on ok flips view to ready', async () => {
    const s = getState();
    s.status = 'needs-callsign';
    s.user = { email: 'op@example.com' };
    claimCallsign.mockImplementationOnce(async (raw: string) => {
      expect(raw).toBe('W1AW');
      // Simulate the provider updating after the claim resolves.
      s.profile = {
        id: 'u1',
        call_sign: 'W1AW',
        verified: false,
        created_at: '2026-06-17T00:00:00Z',
      };
      s.status = 'ready';
      return { ok: true };
    });
    const { rerender } = renderPage();

    fireEvent.change(screen.getByLabelText(/callsign/i), {
      target: { value: 'W1AW' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^claim$/i }));
    await waitFor(() => expect(claimCallsign).toHaveBeenCalledWith('W1AW'));

    // Re-render against the updated state — that's the ready view.
    rerender(
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>
    );
    await screen.findByText('W1AW');
    expect(screen.getByText(/not yet verified/i)).toBeInTheDocument();
  });

  it('needs-callsign: taken shows the "already claimed" helper and stays on the form', async () => {
    const s = getState();
    s.status = 'needs-callsign';
    claimCallsign.mockResolvedValueOnce({ ok: false, reason: 'taken' });
    renderPage();

    fireEvent.change(screen.getByLabelText(/callsign/i), {
      target: { value: 'W1AW' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^claim$/i }));

    await screen.findByText(/already claimed/i);
    // Still on the form.
    expect(screen.getByLabelText(/callsign/i)).toBeInTheDocument();
  });

  it('needs-callsign: invalid shows the invalid helper with no network call', async () => {
    const s = getState();
    s.status = 'needs-callsign';
    claimCallsign.mockImplementationOnce(async () => ({
      ok: false,
      reason: 'invalid',
    }));
    renderPage();

    fireEvent.change(screen.getByLabelText(/callsign/i), {
      target: { value: 'badcall' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^claim$/i }));

    await screen.findByText(/doesn't look like a callsign/i);
  });

  it('ready: verified=true shows ShieldCheck and the callsign', () => {
    const s = getState();
    s.status = 'ready';
    s.user = { email: 'op@example.com' };
    s.profile = {
      id: 'u1',
      call_sign: 'K1ABC',
      verified: true,
      created_at: '2026-06-17T00:00:00Z',
    };
    renderPage();
    expect(screen.getByText('K1ABC')).toBeInTheDocument();
    expect(screen.getByText(/^verified$/i)).toBeInTheDocument();
    expect(screen.queryByText(/not yet verified/i)).toBeNull();
  });

  it('ready: verified=false shows the muted shield + hint', () => {
    const s = getState();
    s.status = 'ready';
    s.user = { email: 'op@example.com' };
    s.profile = {
      id: 'u1',
      call_sign: 'K1ABC',
      verified: false,
      created_at: '2026-06-17T00:00:00Z',
    } satisfies Profile;
    renderPage();
    expect(screen.getByText(/not yet verified/i)).toBeInTheDocument();
    expect(screen.getByText(/verification coming soon/i)).toBeInTheDocument();
  });

  it('renders the "accounts aren\'t enabled" state when !isAuthConfigured', () => {
    const s = getState();
    s.configured = false;
    renderPage();
    expect(screen.getByText(/aren't enabled/i)).toBeInTheDocument();
  });

  describe('accessibility (no axe violations)', () => {
    it('signed-out', async () => {
      const { container } = renderPage();
      expect(await axe(container)).toHaveNoViolations();
    });

    it('needs-callsign', async () => {
      const s = getState();
      s.status = 'needs-callsign';
      const { container } = renderPage();
      expect(await axe(container)).toHaveNoViolations();
    });

    it('ready', async () => {
      const s = getState();
      s.status = 'ready';
      s.user = { email: 'op@example.com' };
      s.profile = {
        id: 'u1',
        call_sign: 'K1ABC',
        verified: false,
        created_at: '2026-06-17T00:00:00Z',
      };
      const { container } = renderPage();
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
