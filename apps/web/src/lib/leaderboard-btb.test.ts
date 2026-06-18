// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  rangeMock,
  limitMock,
  orderMock,
  ilikeMock,
  eqMock,
  selectMock,
  fromMock,
} = vi.hoisted(() => {
  // Every builder method returns the same chainable object — that way we
  // don't have to thread which method follows which in test setup. Tests
  // override the resolving terminal (range or limit) per-case.
  const rangeMock = vi.fn();
  const limitMock = vi.fn();
  const chain: Record<string, unknown> = {};
  const orderMock = vi.fn(() => chain);
  const ilikeMock = vi.fn(() => chain);
  const eqMock = vi.fn(() => chain);
  const selectMock = vi.fn(() => chain);
  chain.eq = eqMock;
  chain.ilike = ilikeMock;
  chain.order = orderMock;
  chain.range = rangeMock;
  chain.limit = limitMock;
  const fromMock = vi.fn(() => ({ select: selectMock }));
  return {
    rangeMock,
    limitMock,
    orderMock,
    ilikeMock,
    eqMock,
    selectMock,
    fromMock,
  };
});

vi.mock('./supabase', () => ({
  supabase: { from: fromMock },
}));

beforeEach(() => {
  vi.clearAllMocks();
  rangeMock.mockResolvedValue({ data: [], error: null });
  limitMock.mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function load() {
  return await import('./leaderboard-btb');
}

function rawRow(over: Partial<Record<string, unknown>>) {
  return {
    call_sign: 'W1AW',
    verified: false,
    best_copy_pct: 80,
    updated_at: '2026-06-01T00:00:00Z',
    tier: 'technician',
    tier_rank_pos: 1,
    all_rank_pos: 5,
    ...over,
  };
}

describe('beatTheBotBoard', () => {
  it('exposes an All segment followed by one per tier', async () => {
    const { beatTheBotBoard } = await load();
    const board = beatTheBotBoard();
    expect(board.segments?.map((s) => s.id)).toEqual([
      'all',
      'no-code',
      'technician',
      'general',
      'extra',
    ]);
    for (const seg of board.segments ?? []) {
      if (seg.id === 'all') continue;
      expect(seg.accent).toBeTruthy();
      expect(seg.context).toMatch(/dB · \d+ wpm/);
    }
  });

  it('uses the provided default segment when valid, else falls back to All', async () => {
    const { beatTheBotBoard } = await load();
    expect(beatTheBotBoard('extra').defaultSegmentId).toBe('extra');
    expect(beatTheBotBoard('bogus').defaultSegmentId).toBe('all');
    expect(beatTheBotBoard().defaultSegmentId).toBe('all');
  });

  it('tier-segment load: filters by tier, orders by tier_rank_pos, ranks come from the server', async () => {
    rangeMock.mockResolvedValueOnce({
      data: [
        rawRow({ call_sign: 'W1AW', best_copy_pct: 92, tier_rank_pos: 1 }),
        rawRow({ call_sign: 'K1ABC', best_copy_pct: 80, tier_rank_pos: 2 }),
      ],
      error: null,
    });
    const { beatTheBotBoard } = await load();
    const page = await beatTheBotBoard().load({ segmentId: 'technician' });

    expect(fromMock).toHaveBeenCalledWith('btb_leaderboard');
    const cols = selectMock.mock.calls[0]?.[0] as string;
    expect(cols).toContain('tier_rank_pos');
    expect(cols).toContain('all_rank_pos');
    expect(cols).not.toContain('bot_copy_pct');
    expect(eqMock).toHaveBeenCalledWith('tier', 'technician');
    expect(orderMock).toHaveBeenCalledWith('tier_rank_pos', {
      ascending: true,
    });
    expect(ilikeMock).not.toHaveBeenCalled();
    expect(page.rows.map((r) => [r.callSign, r.rank])).toEqual([
      ['W1AW', 1],
      ['K1ABC', 2],
    ]);
  });

  it('All segment: no tier filter, orders by all_rank_pos, every row gets its tier tag', async () => {
    rangeMock.mockResolvedValueOnce({
      data: [
        rawRow({ call_sign: 'W1AW', tier: 'extra', all_rank_pos: 1 }),
        rawRow({ call_sign: 'K1ABC', tier: 'general', all_rank_pos: 2 }),
        rawRow({ call_sign: 'W1AW', tier: 'technician', all_rank_pos: 7 }),
      ],
      error: null,
    });
    const { beatTheBotBoard } = await load();
    const page = await beatTheBotBoard().load({ segmentId: 'all' });

    expect(eqMock).not.toHaveBeenCalled();
    expect(orderMock).toHaveBeenCalledWith('all_rank_pos', { ascending: true });
    expect(page.rows.map((r) => [r.callSign, r.rank, r.tag?.label])).toEqual([
      ['W1AW', 1, 'Extra'],
      ['K1ABC', 2, 'General'],
      ['W1AW', 7, 'Technician'],
    ]);
  });

  it('search: ilike on call_sign, sanitizes wildcards', async () => {
    rangeMock.mockResolvedValueOnce({ data: [], error: null });
    const { beatTheBotBoard } = await load();
    await beatTheBotBoard().load({ segmentId: 'all', search: '50%_OFF' });
    // The sanitizer escapes raw % / _ so they match literally.
    expect(ilikeMock).toHaveBeenCalledWith('call_sign', '%50\\%\\_OFF%');
  });

  it('findRow: looks up the viewer by callsign in the active segment, returns their row with rank', async () => {
    limitMock.mockResolvedValueOnce({
      data: [
        rawRow({ call_sign: 'W4GIT', best_copy_pct: 60, tier_rank_pos: 42 }),
      ],
      error: null,
    });
    const { beatTheBotBoard } = await load();
    const found = await beatTheBotBoard().findRow?.('W4GIT', 'technician');
    expect(eqMock).toHaveBeenCalledWith('tier', 'technician');
    expect(eqMock).toHaveBeenCalledWith('call_sign', 'W4GIT');
    expect(limitMock).toHaveBeenCalledWith(1);
    expect(found).toMatchObject({ callSign: 'W4GIT', rank: 42 });
  });

  it('findRow: returns null when there is no row for that callsign', async () => {
    limitMock.mockResolvedValueOnce({ data: [], error: null });
    const { beatTheBotBoard } = await load();
    await expect(
      beatTheBotBoard().findRow?.('NOBODY', 'technician')
    ).resolves.toBeNull();
  });

  it('paging: requests one extra row to detect hasMore', async () => {
    // Return exactly limit+1 rows so the adapter trims the last and reports
    // hasMore=true.
    rangeMock.mockResolvedValueOnce({
      data: Array.from({ length: 51 }, (_, i) =>
        rawRow({ call_sign: `OP${i}`, tier_rank_pos: i + 1 })
      ),
      error: null,
    });
    const { beatTheBotBoard } = await load();
    const page = await beatTheBotBoard().load({
      segmentId: 'technician',
      offset: 0,
      limit: 50,
    });
    expect(rangeMock).toHaveBeenCalledWith(0, 50); // offset → offset+limit (one extra)
    expect(page.rows).toHaveLength(50);
    expect(page.hasMore).toBe(true);
  });

  it('paging: at the tail, hasMore is false', async () => {
    rangeMock.mockResolvedValueOnce({
      data: Array.from({ length: 3 }, (_, i) =>
        rawRow({ call_sign: `OP${i}` })
      ),
      error: null,
    });
    const { beatTheBotBoard } = await load();
    const page = await beatTheBotBoard().load({
      segmentId: 'technician',
      offset: 100,
      limit: 50,
    });
    expect(rangeMock).toHaveBeenCalledWith(100, 150);
    expect(page.rows).toHaveLength(3);
    expect(page.hasMore).toBe(false);
  });

  it('returns an empty page on error', async () => {
    rangeMock.mockResolvedValueOnce({ data: null, error: { message: 'no' } });
    const { beatTheBotBoard } = await load();
    const page = await beatTheBotBoard().load({ segmentId: 'technician' });
    expect(page).toEqual({ rows: [], hasMore: false });
  });

  it('returns an empty page when supabase is unconfigured', async () => {
    vi.resetModules();
    vi.doMock('./supabase', () => ({ supabase: null }));
    const mod = await import('./leaderboard-btb');
    await expect(
      mod.beatTheBotBoard().load({ segmentId: 'technician' })
    ).resolves.toEqual({ rows: [], hasMore: false });
    vi.doUnmock('./supabase');
    vi.resetModules();
  });
});
