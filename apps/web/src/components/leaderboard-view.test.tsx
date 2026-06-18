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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type {
  LeaderboardBoard,
  LeaderboardLoadParams,
  LeaderboardPage,
  LeaderboardRow,
} from '@/lib/leaderboard';
import LeaderboardView from './leaderboard-view';

function row(
  callSign: string,
  rank: number,
  score: number,
  verified = false
): LeaderboardRow {
  return {
    rank,
    callSign,
    verified,
    score,
    scoreLabel: `${score}%`,
    updatedAt: '2026-06-17T00:00:00Z',
  };
}

function makeBoard(
  pages: Record<string, LeaderboardPage>,
  ownRows: Record<string, LeaderboardRow | null> = {}
) {
  const load = vi.fn(
    async (p: LeaderboardLoadParams) =>
      pages[p.segmentId ?? 'technician'] ?? { rows: [], hasMore: false }
  );
  const findRow = vi.fn(
    async (callSign: string, segmentId?: string) =>
      ownRows[`${segmentId ?? 'technician'}:${callSign}`] ?? null
  );
  const board: LeaderboardBoard = {
    id: 'demo',
    label: 'Demo',
    segments: [
      { id: 'technician', label: 'Technician', accent: '#fff' },
      { id: 'extra', label: 'Extra', accent: '#000' },
    ],
    defaultSegmentId: 'technician',
    load,
    findRow,
  };
  return { board, load, findRow };
}

function renderView(
  board: LeaderboardBoard,
  ownCallSign: string | null = null
) {
  return render(
    <MemoryRouter>
      <LeaderboardView board={board} ownCallSign={ownCallSign} />
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
});

describe('LeaderboardView', () => {
  it('renders the default segment with server ranks', async () => {
    const { board } = makeBoard({
      technician: {
        rows: [row('W1AW', 1, 92, true), row('K1ABC', 2, 80)],
        hasMore: false,
      },
    });
    renderView(board);
    await screen.findByText('W1AW');
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
    expect(screen.getByText('92%')).toBeInTheDocument();
  });

  it('switching segment calls load with the new segmentId', async () => {
    const { board, load } = makeBoard({
      technician: { rows: [row('W1AW', 1, 92)], hasMore: false },
      extra: { rows: [row('N0ABC', 1, 50)], hasMore: false },
    });
    renderView(board);
    await screen.findByText('W1AW');
    fireEvent.click(screen.getByRole('radio', { name: 'Extra' }));
    await screen.findByText('N0ABC');
    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({ segmentId: 'extra', search: '' })
    );
  });

  it('typing in the search box re-queries with the search term', async () => {
    const { board, load } = makeBoard({
      technician: { rows: [row('W1AW', 1, 92)], hasMore: false },
    });
    renderView(board);
    await screen.findByText('W1AW');
    fireEvent.change(screen.getByLabelText(/search callsign/i), {
      target: { value: 'W4G' },
    });
    await waitFor(() =>
      expect(load).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'W4G' })
      )
    );
  });

  it('shows "No callsigns match" when a search returns nothing', async () => {
    const { board, load } = makeBoard({
      technician: { rows: [row('W1AW', 1, 92)], hasMore: false },
    });
    load.mockImplementation(async (p) =>
      p.search
        ? { rows: [], hasMore: false }
        : { rows: [row('W1AW', 1, 92)], hasMore: false }
    );
    renderView(board);
    await screen.findByText('W1AW');
    fireEvent.change(screen.getByLabelText(/search callsign/i), {
      target: { value: 'ZZZ' },
    });
    await screen.findByText(/no callsigns match/i);
  });

  it('caps the visible list at the top N (no "Show more" button)', async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      row(`OP${i + 1}`, i + 1, 100 - i)
    );
    const { board } = makeBoard({
      technician: { rows: many, hasMore: true },
    });
    renderView(board);
    await screen.findByText('OP1');
    expect(
      screen.queryByRole('button', { name: /show more/i })
    ).not.toBeInTheDocument();
  });

  it('pins own row at the top when the viewer is outside the visible top-N', async () => {
    const top = Array.from({ length: 25 }, (_, i) =>
      row(`OP${i + 1}`, i + 1, 100 - i)
    );
    const { board, findRow } = makeBoard(
      { technician: { rows: top, hasMore: true } },
      { 'technician:W4GIT': row('W4GIT', 42, 79) }
    );
    renderView(board, 'W4GIT');
    await screen.findByText(/You · #42/);
    expect(findRow).toHaveBeenCalledWith('W4GIT', 'technician');
  });

  it('does NOT pin own row when the viewer is already visible in the list', async () => {
    const own = row('W4GIT', 3, 80);
    const { board } = makeBoard(
      {
        technician: {
          rows: [row('A', 1, 99), row('B', 2, 90), own],
          hasMore: false,
        },
      },
      { 'technician:W4GIT': own }
    );
    renderView(board, 'W4GIT');
    await screen.findByText('W4GIT');
    expect(screen.queryByText(/You ·/)).not.toBeInTheDocument();
  });

  it('shows the "haven\'t ranked here yet" nudge with a tier-specific BtB deep link', async () => {
    const { board } = makeBoard(
      { technician: { rows: [row('A', 1, 99)], hasMore: false } },
      { 'technician:W4GIT': null }
    );
    renderView(board, 'W4GIT');
    const link = await screen.findByRole('link', { name: /play a round/i });
    expect(link).toHaveAttribute('href', '/beat-the-bot?tier=technician');
  });

  it('highlights the own row when callsign matches', async () => {
    const { board } = makeBoard({
      technician: {
        rows: [row('W1AW', 1, 92), row('K1ABC', 2, 80)],
        hasMore: false,
      },
    });
    const { container } = renderView(board, 'K1ABC');
    await screen.findByText('K1ABC');
    const rows = container.querySelectorAll('tbody tr');
    expect(rows[1].getAttribute('data-own')).toBe('true');
    expect(rows[0].getAttribute('data-own')).toBeNull();
  });

  it('renders the empty state when the default segment has zero rows', async () => {
    const { board } = makeBoard({
      technician: { rows: [], hasMore: false },
    });
    renderView(board);
    const link = await screen.findByRole('link', { name: /be the first/i });
    expect(link).toHaveAttribute('href', '/beat-the-bot');
  });

  it('axe clean', async () => {
    const { board } = makeBoard({
      technician: {
        rows: [row('W1AW', 1, 92, true), row('K1ABC', 2, 80)],
        hasMore: false,
      },
    });
    const { container } = renderView(board, 'K1ABC');
    await waitFor(() => expect(screen.queryByText('W1AW')).not.toBeNull());
    expect(await axe(container)).toHaveNoViolations();
  });
});
