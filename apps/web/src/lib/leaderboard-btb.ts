// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Globe } from 'lucide-react';
import { TIERS, type Tier } from '../inference/beat-the-bot';
import type {
  LeaderboardBoard,
  LeaderboardLoadParams,
  LeaderboardPage,
  LeaderboardRow,
  LeaderboardSegment,
} from './leaderboard';
import { supabase } from './supabase';

const ALL_SEGMENT_ID = 'all';
// Hard cap. We don't paginate — the board shows the top N, plus a pinned
// own-row when the viewer is below it. Search broadens visibility for the
// "find a friend" case.
const DEFAULT_PAGE_SIZE = 25;
const SELECT_COLS =
  'call_sign, verified, best_copy_pct, updated_at, tier, tier_rank_pos, all_rank_pos';

function formatSnr(snr: number): string {
  return snr >= 0 ? `+${snr}` : `−${Math.abs(snr)}`;
}

function segmentFromTier(tier: Tier): LeaderboardSegment {
  return {
    id: tier.id,
    label: tier.name,
    accent: tier.accent,
    icon: tier.icon,
    // Factual difficulty line — the bot's copy % varies per round, so we don't
    // claim a per-tier bot number (the badge does that with the real frozen %).
    context: `${formatSnr(tier.snr)} dB · ${tier.wpm} wpm — the bot copies the same brutal clip`,
  };
}

const ALL_SEGMENT: LeaderboardSegment = {
  id: ALL_SEGMENT_ID,
  label: 'All',
  icon: Globe,
  context: 'Every operator-tier best, ranked together',
};

interface RawRow {
  call_sign: string;
  verified: boolean;
  best_copy_pct: number;
  updated_at: string;
  tier: Tier['id'];
  tier_rank_pos: number;
  all_rank_pos: number;
}

const TIER_BY_ID: Record<Tier['id'], Tier> = Object.fromEntries(
  TIERS.map((t) => [t.id, t])
) as Record<Tier['id'], Tier>;

function toRow(r: RawRow, useAllRank: boolean): LeaderboardRow {
  const tier = TIER_BY_ID[r.tier];
  return {
    rank: useAllRank ? r.all_rank_pos : r.tier_rank_pos,
    callSign: r.call_sign,
    verified: r.verified,
    score: r.best_copy_pct,
    scoreLabel: `${r.best_copy_pct}%`,
    updatedAt: r.updated_at,
    // Tag the row with its tier — useful on the All board (and on tier-
    // segment searches the chip is redundant but harmless).
    tag: tier
      ? { label: tier.name, accent: tier.accent, icon: tier.icon }
      : undefined,
  };
}

const EMPTY_PAGE: LeaderboardPage = { rows: [], hasMore: false };

// Supabase wraps an aborted fetch in a PostgrestError shape (no `name`,
// just `message` / `hint`). React StrictMode double-mounts effects in
// dev, so the cleanup fires before the first request settles — we don't
// want those benign aborts on the console.
function isAbortError(err: { name?: string; message?: string }): boolean {
  if (err.name === 'AbortError') return true;
  return Boolean(err.message?.includes('AbortError'));
}

/**
 * Beat-the-Bot board adapter. Reads `btb_leaderboard` (the public-read view
 * that joins `btb_bests` against `profiles` and exposes server-computed rank
 * columns). Human-only ranking — the bot's frozen % is NOT selected here.
 */
export function beatTheBotBoard(defaultSegmentId?: string): LeaderboardBoard {
  // "All" leads — broadest view first, then narrow to a tier.
  const segments: LeaderboardSegment[] = [
    ALL_SEGMENT,
    ...TIERS.map(segmentFromTier),
  ];
  const fallbackId = segments[0]?.id;
  const defaultId =
    defaultSegmentId && segments.some((s) => s.id === defaultSegmentId)
      ? defaultSegmentId
      : fallbackId;

  return {
    id: 'beat-the-bot',
    label: 'Beat the Bot',
    segments,
    defaultSegmentId: defaultId,
    async load(params: LeaderboardLoadParams): Promise<LeaderboardPage> {
      if (!supabase) return EMPTY_PAGE;
      const seg = params.segmentId ?? defaultId;
      if (!seg) return EMPTY_PAGE;

      const useAllRank = seg === ALL_SEGMENT_ID;
      const offset = params.offset ?? 0;
      const limit = params.limit ?? DEFAULT_PAGE_SIZE;
      // Fetch one extra row so we can tell the shell whether more exist
      // without a second count query.
      const rangeTo = offset + limit;

      let q = supabase.from('btb_leaderboard').select(SELECT_COLS);

      if (!useAllRank) q = q.eq('tier', seg);
      if (params.search?.trim()) {
        // Sanitize wildcards so a stray % / _ doesn't widen the match.
        const safe = params.search.trim().replace(/[%_]/g, '\\$&');
        q = q.ilike('call_sign', `%${safe}%`);
      }

      let ordered = q
        .order(useAllRank ? 'all_rank_pos' : 'tier_rank_pos', {
          ascending: true,
        })
        .range(offset, rangeTo);
      if (params.signal) ordered = ordered.abortSignal(params.signal);
      const { data, error } = await ordered;

      if (error || !data) {
        if (error && !isAbortError(error)) {
          console.error('[leaderboard-btb] load failed', error);
        }
        return EMPTY_PAGE;
      }

      const rows = (data as RawRow[])
        .slice(0, limit)
        .map((r) => toRow(r, useAllRank));
      const hasMore = data.length > limit;
      return { rows, hasMore };
    },
    async findRow(
      callSign: string,
      segmentId?: string,
      signal?: AbortSignal
    ): Promise<LeaderboardRow | null> {
      if (!supabase) return null;
      const seg = segmentId ?? defaultId;
      if (!seg || !callSign) return null;
      const useAllRank = seg === ALL_SEGMENT_ID;

      let q = supabase.from('btb_leaderboard').select(SELECT_COLS);
      if (!useAllRank) q = q.eq('tier', seg);
      // Exact-match lookup. Callsigns are uppercase in both the DB and the
      // viewer's profile, so .eq is safe (and faster than ilike).
      q = q.eq('call_sign', callSign);

      // On All, an operator can hold rows across multiple tiers — pick their
      // best (smallest all_rank_pos). On a tier segment there's at most one.
      let ordered = q
        .order(useAllRank ? 'all_rank_pos' : 'tier_rank_pos', {
          ascending: true,
        })
        .limit(1);
      if (signal) ordered = ordered.abortSignal(signal);
      const { data, error } = await ordered;

      if (error || !data || data.length === 0) {
        if (error && !isAbortError(error)) {
          console.error('[leaderboard-btb] findRow failed', error);
        }
        return null;
      }
      return toRow(data[0] as RawRow, useAllRank);
    },
  };
}
