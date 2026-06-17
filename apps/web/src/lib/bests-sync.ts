// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type Bests,
  mergeCloudBests,
  publishableBests,
  type Tier,
} from '../inference/beat-the-bot';
import { supabase } from './supabase';

export interface CloudBest {
  tier: Tier['id'];
  bestCopyPct: number;
  botCopyPctAtBest: number;
}

/**
 * Push every non-null local best to the cloud via the `publish_best` RPC. The
 * server is idempotent + improve-guarded, so a lower/equal push is a no-op and
 * re-pushing an unchanged row is safe. We run all tiers concurrently with
 * `allSettled` so one failing tier never aborts the others, and we swallow
 * errors here — the caller (and gameplay) must never see a network failure.
 */
export async function pushBests(bests: Bests): Promise<void> {
  if (!supabase) return;
  const client = supabase;
  const rows = publishableBests(bests);
  if (rows.length === 0) return;
  await Promise.allSettled(
    rows.map((r) =>
      client
        .rpc('publish_best', {
          p_tier: r.tier,
          p_best_copy_pct: r.bestCopyPct,
          p_bot_copy_pct_at_best: r.botCopyPctAtBest,
        })
        .then(({ error }) => {
          if (error) console.error('[bests-sync] publish_best failed', error);
        })
    )
  );
}

/**
 * Read the current user's bests rows. `bests` is public-read, so we filter to
 * the caller explicitly rather than rely on RLS scope. Returns `[]` on any
 * error so callers can blindly merge without try/catch.
 */
export async function pullBests(userId: string): Promise<CloudBest[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('bests')
    .select('tier, best_copy_pct, bot_copy_pct_at_best')
    .eq('user_id', userId);
  if (error || !data) {
    if (error) console.error('[bests-sync] pull failed', error);
    return [];
  }
  return data.map((r) => ({
    tier: r.tier as Tier['id'],
    bestCopyPct: r.best_copy_pct as number,
    botCopyPctAtBest: r.bot_copy_pct_at_best as number,
  }));
}

/**
 * Push-then-pull-then-merge. Push first so the cloud reflects this device's
 * improvements before we read maxima back. Returns the merged local Bests (the
 * caller persists it). Never throws.
 */
export async function reconcile(local: Bests, userId: string): Promise<Bests> {
  await pushBests(local);
  const cloud = await pullBests(userId);
  return mergeCloudBests(local, cloud);
}
