// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, render } from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
import { EMPTY_BESTS } from '../inference/beat-the-bot';

const { useAuthMock, reconcileMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  reconcileMock: vi.fn(),
}));

vi.mock('./auth', () => ({
  useAuth: () => useAuthMock(),
}));
vi.mock('./bests-sync', () => ({
  reconcile: (...args: unknown[]) => reconcileMock(...args),
}));

import { useBestsSync } from './use-bests-sync';

function ready() {
  useAuthMock.mockReturnValue({
    status: 'ready',
    user: { id: 'user-1' },
    session: null,
    profile: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
    claimCallsign: vi.fn(),
    refreshProfile: vi.fn(),
  });
}

function notReady(status: 'loading' | 'signed-out' | 'needs-callsign') {
  useAuthMock.mockReturnValue({
    status,
    user: null,
    session: null,
    profile: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
    claimCallsign: vi.fn(),
    refreshProfile: vi.fn(),
  });
}

let lastSyncNow: (() => void) | null = null;

function Harness() {
  const { syncNow } = useBestsSync(EMPTY_BESTS, () => {});
  lastSyncNow = syncNow;
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  lastSyncNow = null;
  reconcileMock.mockResolvedValue(EMPTY_BESTS);
});

afterEach(() => {
  cleanup();
});

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useBestsSync', () => {
  it('reconciles on mount when status is ready', async () => {
    ready();
    render(<Harness />);
    await flushMicrotasks();
    expect(reconcileMock).toHaveBeenCalledTimes(1);
    expect(reconcileMock).toHaveBeenCalledWith(EMPTY_BESTS, 'user-1');
  });

  it('reconciles on the online event', async () => {
    ready();
    render(<Harness />);
    await flushMicrotasks();
    (reconcileMock as Mock).mockClear();
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
    });
    expect(reconcileMock).toHaveBeenCalledTimes(1);
  });

  it('reconciles on visibilitychange → visible', async () => {
    ready();
    render(<Harness />);
    await flushMicrotasks();
    (reconcileMock as Mock).mockClear();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(reconcileMock).toHaveBeenCalledTimes(1);
  });

  it('does not reconcile when status is signed-out', async () => {
    notReady('signed-out');
    render(<Harness />);
    await flushMicrotasks();
    expect(reconcileMock).not.toHaveBeenCalled();
    // Triggers do nothing either.
    window.dispatchEvent(new Event('online'));
    await flushMicrotasks();
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it('does not reconcile when status is needs-callsign', async () => {
    notReady('needs-callsign');
    render(<Harness />);
    await flushMicrotasks();
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it('syncNow() is inert when not ready', async () => {
    notReady('signed-out');
    render(<Harness />);
    await flushMicrotasks();
    expect(lastSyncNow).not.toBeNull();
    await act(async () => {
      lastSyncNow?.();
      await Promise.resolve();
    });
    expect(reconcileMock).not.toHaveBeenCalled();
  });
});
