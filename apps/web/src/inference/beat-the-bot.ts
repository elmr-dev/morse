// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LucideIcon } from 'lucide-react';
import { Headphones, Radio, RadioTower, Zap } from 'lucide-react';

export interface Tier {
  id: 'no-code' | 'technician' | 'general' | 'extra';
  name: string;
  snr: number; // dB — the HUMAN clip (higher = easier)
  wpm: number; // the HUMAN clip
  icon: LucideIcon;
  accent: string; // CSS custom property reference
}

export const TIERS: readonly Tier[] = [
  {
    id: 'no-code',
    name: 'No-Code',
    snr: 10,
    wpm: 13,
    icon: Headphones,
    accent: 'var(--tier-no-code)',
  },
  {
    id: 'technician',
    name: 'Technician',
    snr: 5,
    wpm: 18,
    icon: Radio,
    accent: 'var(--tier-technician)',
  },
  {
    id: 'general',
    name: 'General',
    snr: 0,
    wpm: 22,
    icon: RadioTower,
    accent: 'var(--tier-general)',
  },
  {
    id: 'extra',
    name: 'Extra',
    snr: -6,
    wpm: 28,
    icon: Zap,
    accent: 'var(--tier-extra)',
  },
];

// The bot copies this fixed hard clip every round, regardless of tier.
// Equal to the Extra human setting, so at Extra the contest is near heads-up.
export const BOT_REF = { snr: -6, wpm: 28 } as const;

export interface TierRecord {
  /** Best copy % (0–100, higher is better). null = no rounds at this tier yet. */
  bestCopyPct: number | null;
  /** Bot's copy % from the round that set bestCopyPct. null = no best yet. */
  botCopyPctAtBest: number | null;
  /** Times the human strictly out-copied the bot (userCopyPct > botCopyPct). */
  beatCount: number;
}

export type Bests = Record<Tier['id'], TierRecord>;

export const EMPTY_BESTS: Bests = {
  'no-code': { bestCopyPct: null, botCopyPctAtBest: null, beatCount: 0 },
  technician: { bestCopyPct: null, botCopyPctAtBest: null, beatCount: 0 },
  general: { bestCopyPct: null, botCopyPctAtBest: null, beatCount: 0 },
  extra: { bestCopyPct: null, botCopyPctAtBest: null, beatCount: 0 },
};

export const BESTS_STORAGE_KEY = 'morse:btb:bests';

/**
 * Shape guard for a parsed `morse:btb:bests` payload. The record shape changed
 * when we moved from CER to copy %; any pre-migration payload is missing
 * `bestCopyPct` / `botCopyPctAtBest` / `beatCount` and must be discarded
 * rather than silently rendered (a missing `bestCopyPct` is `undefined`, not
 * `null`, and slips past the empty-state check).
 */
export function isBests(value: unknown): value is Bests {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return TIERS.every((tier) => {
    const r = v[tier.id];
    if (typeof r !== 'object' || r === null) return false;
    const rec = r as Record<string, unknown>;
    return (
      (rec.bestCopyPct === null || typeof rec.bestCopyPct === 'number') &&
      (rec.botCopyPctAtBest === null ||
        typeof rec.botCopyPctAtBest === 'number') &&
      typeof rec.beatCount === 'number'
    );
  });
}

/**
 * Compute the next bests map after a graded round. Pure: no storage, no React.
 *
 * Inputs are copy percentages in [0, 100]. A round only sets a new best when
 * the human copied at least one character (copyPct > 0) AND beat their prior
 * best for the tier. When a new best is set, the bot's copy % for THAT round
 * is frozen alongside it. beatCount increments on a STRICT win
 * (userCopyPct > botCopyPct); a tie does not count.
 */
/** A single tier's publishable row — the shape publish_best takes. */
export interface PublishableBest {
  tier: Tier['id'];
  bestCopyPct: number;
  botCopyPctAtBest: number;
}

/**
 * The local bests that are worth publishing: tiers with a non-null bestCopyPct.
 * botCopyPctAtBest may be null on a best set before slice 1's freeze shipped (or
 * any legacy/edge row) — coerce a null bot value to 0 so the row is still
 * publishable and honest-ish (0 = "unknown/none", never blocks the human's %).
 */
export function publishableBests(bests: Bests): PublishableBest[] {
  const out: PublishableBest[] = [];
  for (const t of TIERS) {
    const r = bests[t.id];
    if (r.bestCopyPct !== null) {
      out.push({
        tier: t.id,
        bestCopyPct: r.bestCopyPct,
        botCopyPctAtBest: r.botCopyPctAtBest ?? 0,
      });
    }
  }
  return out;
}

/**
 * Merge cloud rows into local bests, taking the higher bestCopyPct per tier.
 * When the cloud's best is higher, adopt its bot pairing too (so You/Bot stays
 * the pair from the round that actually set the winning best). beatCount is
 * LOCAL-ONLY and never touched here.
 */
export function mergeCloudBests(
  local: Bests,
  cloud: { tier: Tier['id']; bestCopyPct: number; botCopyPctAtBest: number }[]
): Bests {
  const next: Bests = structuredClone(local);
  for (const row of cloud) {
    const cur = next[row.tier];
    if (cur.bestCopyPct === null || row.bestCopyPct > cur.bestCopyPct) {
      next[row.tier] = {
        bestCopyPct: row.bestCopyPct,
        botCopyPctAtBest: row.botCopyPctAtBest,
        beatCount: cur.beatCount,
      };
    }
  }
  return next;
}

export function applyRound(
  prev: Bests,
  tier: Tier['id'],
  userCopyPct: number,
  botCopyPct: number
): { bests: Bests; isNewBest: boolean } {
  const r = prev[tier];
  const isNewBest =
    userCopyPct > 0 && (r.bestCopyPct === null || userCopyPct > r.bestCopyPct);
  const beat = userCopyPct > botCopyPct ? 1 : 0;
  const next: TierRecord = {
    bestCopyPct: isNewBest ? userCopyPct : r.bestCopyPct,
    botCopyPctAtBest: isNewBest ? botCopyPct : r.botCopyPctAtBest,
    beatCount: r.beatCount + beat,
  };
  return { bests: { ...prev, [tier]: next }, isNewBest };
}
