// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Redline toplist — the second leaderboard board, backed by Supabase exactly
// like Beat-the-Bot (see lib/leaderboard-btb.ts + lib/bests-sync.ts). Reads the
// public-read `redline_leaderboard` view (server-ranked), and publishes the
// operator's best via the improve-guarded `publish_redline_score` RPC. A
// signed-in operator with a claimed callsign appears on the board.
//
// localStorage holds the operator's OWN best only (mirrors btb's local bests):
// it's canonical, survives offline play, and is pushed up on reconcile. The
// board itself always comes from the server — there are no synthetic rows.

import { callsignCountry } from '@/inference/callsign';
import type {
  LeaderboardBoard,
  LeaderboardLoadParams,
  LeaderboardPage,
  LeaderboardRow,
} from '@/lib/leaderboard';
import { supabase } from '@/lib/supabase';

const LOCAL_BEST_KEY = 'morse:redline:best';
const DEFAULT_LIMIT = 50;

/** One ranked operator on the board. */
export interface RankedEntry {
  rank: number;
  call: string;
  verified: boolean;
  score: number;
  topWpm: number;
  updatedAt: string;
  country: string | null;
  flag: string | null;
}

/** The operator's own best, kept locally and pushed to the cloud on reconcile. */
export interface LocalBest {
  score: number;
  topWpm: number;
}

interface RawRow {
  call_sign: string;
  verified: boolean;
  best_score: number;
  top_wpm: number;
  updated_at: string;
  rank_pos: number;
}

const SELECT_COLS =
  'call_sign, verified, best_score, top_wpm, updated_at, rank_pos';

// Supabase wraps an aborted fetch in a PostgrestError shape (no `name`). React
// StrictMode double-mounts effects in dev, so cleanup aborts the first request
// — we don't want those benign aborts on the console.
function isAbortError(err: { name?: string; message?: string }): boolean {
  if (err.name === 'AbortError') return true;
  return Boolean(err.message?.includes('AbortError'));
}

function toEntry(r: RawRow): RankedEntry {
  const cc = callsignCountry(r.call_sign);
  return {
    rank: r.rank_pos,
    call: r.call_sign,
    verified: r.verified,
    score: r.best_score,
    topWpm: r.top_wpm,
    updatedAt: r.updated_at,
    country: cc?.country ?? null,
    flag: cc?.flag ?? null,
  };
}

// ── Local own-best (canonical, offline-safe) ────────────────────────────────

function isLocalBest(value: unknown): value is LocalBest {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.score === 'number' && typeof v.topWpm === 'number';
}

export function readLocalBest(): LocalBest | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LOCAL_BEST_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isLocalBest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Record a run's result locally, keeping the best score (improve-guarded, like
 * the DB). top_wpm is frozen alongside the winning score. Returns the new best.
 */
export function writeLocalBest(score: number, topWpm: number): LocalBest {
  const current = readLocalBest();
  const next: LocalBest =
    current && current.score >= score ? current : { score, topWpm };
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(LOCAL_BEST_KEY, JSON.stringify(next));
    } catch {
      // Storage full / unavailable — the best just won't persist.
    }
  }
  return next;
}

// ── Cloud read/write ────────────────────────────────────────────────────────

/** Options for a board fetch — all optional. */
export interface FetchOptions {
  /** Case-insensitive substring on callsign. Empty/undefined = no filter. */
  search?: string;
  /** Zero-based offset for paging. Defaults to 0. */
  offset?: number;
  /** Max rows to return. */
  limit?: number;
  signal?: AbortSignal;
}

/** The ranked board, server-sorted. Empty when the backend isn't configured.
 *  This is the single read path for the Redline board — both the embedded
 *  mini-board and the full `/leaderboards/redline` view go through here (via
 *  the `redlineBoard()` adapter below). */
export async function fetchLeaderboard(
  opts: FetchOptions = {}
): Promise<RankedEntry[]> {
  if (!supabase) return [];
  const { search, offset = 0, limit = DEFAULT_LIMIT, signal } = opts;
  let q = supabase.from('redline_leaderboard').select(SELECT_COLS);
  if (search?.trim()) {
    // Sanitize wildcards so a stray % / _ doesn't widen the match.
    const safe = search.trim().replace(/[%_]/g, '\\$&');
    q = q.ilike('call_sign', `%${safe}%`);
  }
  let ordered = q
    .order('rank_pos', { ascending: true })
    .range(offset, offset + limit - 1);
  if (signal) ordered = ordered.abortSignal(signal);
  const { data, error } = await ordered;
  if (error || !data) {
    if (error && !isAbortError(error)) {
      console.error('[redline-leaderboard] load failed', error);
    }
    return [];
  }
  return (data as RawRow[]).map(toEntry);
}

/** The operator's own row (with true rank), even if outside the visible top-N. */
export async function fetchOwnRow(
  call: string,
  signal?: AbortSignal
): Promise<RankedEntry | null> {
  const trimmed = call.trim().toUpperCase();
  if (!supabase || !trimmed) return null;
  let q = supabase
    .from('redline_leaderboard')
    .select(SELECT_COLS)
    .eq('call_sign', trimmed)
    .limit(1);
  if (signal) q = q.abortSignal(signal);
  const { data, error } = await q;
  if (error || !data || data.length === 0) {
    if (error && !isAbortError(error)) {
      console.error('[redline-leaderboard] findRow failed', error);
    }
    return null;
  }
  return toEntry(data[0] as RawRow);
}

/**
 * Push a score via the improve-guarded RPC. The server attaches the caller's
 * identity (auth.uid() → their claimed callsign), so no callsign is passed.
 * Idempotent and improve-guarded server-side; swallows errors (gameplay must
 * never see a network failure). No-op when signed out / backend absent.
 */
export async function publishScore(
  score: number,
  topWpm: number
): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc('publish_redline_score', {
    p_best_score: score,
    p_top_wpm: topWpm,
  });
  if (error) console.error('[redline-leaderboard] publish failed', error);
}

/**
 * Push-then-confirm. Pushes the local best so the cloud reflects this device's
 * improvement; the caller refetches the board afterwards. Never throws.
 */
export async function reconcile(): Promise<void> {
  const best = readLocalBest();
  if (!best) return;
  await publishScore(best.score, best.topWpm);
}

// ── Generic board adapter (one component, two views) ────────────────────────

// Shape a server entry into the board-agnostic row the shared <LeaderboardView>
// renders. Score is the ranking value; Top WPM rides along in the chip slot
// (the board overrides that column's header to "Top WPM").
function toLeaderboardRow(e: RankedEntry): LeaderboardRow {
  return {
    rank: e.rank,
    callSign: e.call,
    verified: e.verified,
    score: e.score,
    scoreLabel: e.score.toLocaleString(),
    updatedAt: e.updatedAt,
    tag: { label: `${e.topWpm} WPM` },
  };
}

/**
 * Redline board adapter for the shared <LeaderboardView>. A flat board (no
 * tiers), ranked by best score with Top WPM shown alongside. Reuses the same
 * `fetchLeaderboard` / `fetchOwnRow` read path used everywhere else — no second
 * fetch path, no divergence.
 */
export function redlineBoard(): LeaderboardBoard {
  return {
    id: 'redline',
    label: 'Redline',
    tagHeader: 'Top WPM',
    scoreHeader: 'Score',
    playHref: '/redline',
    async load(params: LeaderboardLoadParams): Promise<LeaderboardPage> {
      const limit = params.limit ?? DEFAULT_LIMIT;
      const offset = params.offset ?? 0;
      // Fetch one extra to tell the shell whether more rows exist.
      const entries = await fetchLeaderboard({
        search: params.search,
        offset,
        limit: limit + 1,
        signal: params.signal,
      });
      const rows = entries.slice(0, limit).map(toLeaderboardRow);
      return { rows, hasMore: entries.length > limit };
    },
    async findRow(
      callSign: string,
      _segmentId?: string,
      signal?: AbortSignal
    ): Promise<LeaderboardRow | null> {
      const own = await fetchOwnRow(callSign, signal);
      return own ? toLeaderboardRow(own) : null;
    },
  };
}
