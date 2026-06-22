// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LucideIcon } from 'lucide-react';

/**
 * Generic leaderboard seam. The shell consumes a `LeaderboardBoard` and
 * renders ranked rows; it never imports board-specific types (CW tiers,
 * streaks, etc.). A future second board adds a new adapter alongside the
 * Beat-the-Bot one — no shell change required.
 */

/** A small per-row chip (e.g. which tier an "All"-board row came from). */
export interface LeaderboardRowTag {
  label: string;
  /** Optional CSS color / var. */
  accent?: string;
  icon?: LucideIcon;
}

/** One ranked entry, board-agnostic. */
export interface LeaderboardRow {
  /** Server-computed rank within the active segment. 1 = best. Ties share a
   *  number (RANK() semantics — "1, 2, 2, 4"). */
  rank: number;
  callSign: string;
  verified: boolean;
  /** The ranking value, higher = better. Displayed via `scoreLabel`. */
  score: number;
  /** Pre-formatted display string for `score` (e.g. "88%"). */
  scoreLabel: string;
  /** ISO timestamp of when this entry was set (for an "as of" hint). */
  updatedAt: string;
  /** Optional per-row chip — used e.g. for the tier on the All board. */
  tag?: LeaderboardRowTag;
}

/** Parameters the shell passes to `load`. All optional — a flat board with no
 *  search/paging just ignores them. */
export interface LeaderboardLoadParams {
  segmentId?: string;
  /** Case-insensitive substring on callsign. Empty/undefined = no filter. */
  search?: string;
  /** Zero-based offset for paging. Defaults to 0. */
  offset?: number;
  /** Max rows to return. Defaults to whatever the adapter picks. */
  limit?: number;
  /** Optional abort signal. Adapters that hit the network should forward it
   *  so suspended/stale fetches can be cancelled (notably on iOS PWA resume,
   *  where the prior request may never settle). */
  signal?: AbortSignal;
}

export interface LeaderboardPage {
  rows: LeaderboardRow[];
  /** True if there are more rows beyond this slice — drives "Show more". */
  hasMore: boolean;
}

/** A segment within a board (e.g. a tier). Boards with no segments omit this. */
export interface LeaderboardSegment {
  id: string;
  label: string;
  /** Optional accent (CSS color / var) for the segment selector. */
  accent?: string;
  /** Optional one-line context shown above the rows. */
  context?: string;
  /** Optional lucide icon for the segment selector. */
  icon?: LucideIcon;
}

/** A board adapter: how to fetch + shape one board's standings. */
export interface LeaderboardBoard {
  id: string;
  label: string;
  /** Segments to sub-divide the board, or undefined for a flat board. */
  segments?: LeaderboardSegment[];
  /** Default segment id to open on (e.g. the viewer's active tier). */
  defaultSegmentId?: string;
  /** Header for the per-row chip column. Defaults to "Tier" (the Beat-the-Bot
   *  board's chip). Redline overrides this to "Top WPM". */
  tagHeader?: string;
  /** Header for the ranking-value column. Defaults to "Score". */
  scoreHeader?: string;
  /** Where the empty-state / "haven't ranked here" CTAs send the viewer to
   *  earn a spot. Defaults to "/beat-the-bot". A board with tier segments
   *  treats the active non-"all" segment id as a `?tier=` deep-link param. */
  playHref?: string;
  /** Fetch one page of rows, server-sorted. Adapters that don't support
   *  search/paging may ignore those params. */
  load: (params: LeaderboardLoadParams) => Promise<LeaderboardPage>;
  /** Fetch a single row by callsign, with its true rank inside the active
   *  segment. Returns null if no entry. Used by the shell to pin the
   *  viewer's own row even when it's outside the visible top-N. Optional. */
  findRow?: (
    callSign: string,
    segmentId?: string,
    signal?: AbortSignal
  ) => Promise<LeaderboardRow | null>;
}
