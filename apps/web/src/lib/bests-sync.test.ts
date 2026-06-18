// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Bests, EMPTY_BESTS } from '../inference/beat-the-bot';

const { rpc, eqMock, fromMock } = vi.hoisted(() => {
  const eqMock = vi.fn();
  const selectMock = vi.fn(() => ({ eq: eqMock }));
  const fromMock = vi.fn(() => ({ select: selectMock }));
  const rpc = vi.fn();
  return { rpc, eqMock, fromMock };
});

vi.mock('./supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args), from: fromMock },
}));

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ error: null });
  eqMock.mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function load() {
  return await import('./bests-sync');
}

function bestsWith(over: Partial<Bests>): Bests {
  return { ...EMPTY_BESTS, ...over };
}

describe('pushBests', () => {
  it('calls publish_best with snake_case params for each non-null tier', async () => {
    const { pushBests } = await load();
    const bests = bestsWith({
      technician: { bestCopyPct: 80, botCopyPctAtBest: 60, beatCount: 0 },
      general: { bestCopyPct: 70, botCopyPctAtBest: 65, beatCount: 0 },
    });
    await pushBests(bests);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith('publish_best', {
      p_tier: 'technician',
      p_best_copy_pct: 80,
      p_bot_copy_pct_at_best: 60,
    });
    expect(rpc).toHaveBeenCalledWith('publish_best', {
      p_tier: 'general',
      p_best_copy_pct: 70,
      p_bot_copy_pct_at_best: 65,
    });
  });

  it('does not abort other tiers when one rejects', async () => {
    rpc.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    rpc.mockResolvedValueOnce({ error: null });
    const { pushBests } = await load();
    const bests = bestsWith({
      technician: { bestCopyPct: 80, botCopyPctAtBest: 60, beatCount: 0 },
      general: { bestCopyPct: 70, botCopyPctAtBest: 65, beatCount: 0 },
    });
    await expect(pushBests(bests)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when there are no publishable rows', async () => {
    const { pushBests } = await load();
    await pushBests(EMPTY_BESTS);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('pullBests', () => {
  it('maps snake_case → camelCase', async () => {
    eqMock.mockResolvedValueOnce({
      data: [
        { tier: 'technician', best_copy_pct: 80, bot_copy_pct_at_best: 60 },
        { tier: 'extra', best_copy_pct: 40, bot_copy_pct_at_best: 35 },
      ],
      error: null,
    });
    const { pullBests } = await load();
    const rows = await pullBests('user-1');
    expect(fromMock).toHaveBeenCalledWith('btb_bests');
    expect(eqMock).toHaveBeenCalledWith('user_id', 'user-1');
    expect(rows).toEqual([
      { tier: 'technician', bestCopyPct: 80, botCopyPctAtBest: 60 },
      { tier: 'extra', bestCopyPct: 40, botCopyPctAtBest: 35 },
    ]);
  });

  it('returns [] on error', async () => {
    eqMock.mockResolvedValueOnce({ data: null, error: { message: 'no' } });
    const { pullBests } = await load();
    await expect(pullBests('user-1')).resolves.toEqual([]);
  });
});

describe('reconcile', () => {
  it('pushes before pulling, then returns merged bests', async () => {
    const order: string[] = [];
    rpc.mockImplementation(() => {
      order.push('push');
      return Promise.resolve({ error: null });
    });
    eqMock.mockImplementation(() => {
      order.push('pull');
      return Promise.resolve({
        data: [
          { tier: 'general', best_copy_pct: 99, bot_copy_pct_at_best: 50 },
        ],
        error: null,
      });
    });
    const local = bestsWith({
      general: { bestCopyPct: 40, botCopyPctAtBest: 20, beatCount: 2 },
    });
    const { reconcile } = await load();
    const merged = await reconcile(local, 'user-1');
    expect(order[0]).toBe('push');
    expect(order.at(-1)).toBe('pull');
    expect(merged.general).toEqual({
      bestCopyPct: 99,
      botCopyPctAtBest: 50,
      beatCount: 2,
    });
  });

  it('never throws when supabase errors', async () => {
    rpc.mockRejectedValue(new Error('rpc boom'));
    eqMock.mockResolvedValue({ data: null, error: { message: 'pull boom' } });
    const { reconcile } = await load();
    await expect(reconcile(EMPTY_BESTS, 'user-1')).resolves.toEqual(
      EMPTY_BESTS
    );
  });
});

describe('without supabase configured', () => {
  it('pushBests / pullBests / reconcile are inert', async () => {
    vi.resetModules();
    vi.doMock('./supabase', () => ({ supabase: null }));
    const mod = await import('./bests-sync');
    await expect(mod.pushBests(EMPTY_BESTS)).resolves.toBeUndefined();
    await expect(mod.pullBests('u')).resolves.toEqual([]);
    await expect(mod.reconcile(EMPTY_BESTS, 'u')).resolves.toEqual(EMPTY_BESTS);
    vi.doUnmock('./supabase');
    vi.resetModules();
  });
});
