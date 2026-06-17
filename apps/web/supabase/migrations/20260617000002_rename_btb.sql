-- SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
--
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- ============================================================================
-- MORSE — Slice 4.5: rename bests/leaderboard → btb_* (board-specific naming)
-- ============================================================================
-- REVIEW ARTIFACT — apply with `supabase db push` after review.
--
-- WHY: the leaderboard is becoming a generic surface that may host multiple
-- "boards" later (Trainer, streaks, etc.), each with its OWN table + view in a
-- common row shape. Under that model `bests` / `leaderboard` are misleadingly
-- generic names for what are actually the Beat-the-Bot board's table + view.
-- Rename them to btb_* now (cheap, prerelease, ~no data) so the names are
-- honest. A future generic `leaderboard` union view can be introduced when a
-- SECOND board actually exists — NOT speculated here (YAGNI).
--
-- The `tier` enum keeps its name (tiers are a BtB concept but the enum is
-- harmless to leave generic; renaming it would churn the column type for no
-- gain). The localStorage key on the client (morse:btb:bests) is already
-- correctly prefixed — no client storage change.
--
-- Renaming preserves data, indexes, constraints, RLS policies, and the PK —
-- ALTER ... RENAME is metadata-only. The view and function must be
-- recreated/repointed explicitly (below).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table: bests → btb_bests
--    Indexes and the PK ride along automatically. RLS policies attached to the
--    table also follow the rename. The FK from bests.user_id → profiles stays.
-- ---------------------------------------------------------------------------
alter table public.bests rename to btb_bests;

-- The secondary index was named bests_tier_score; rename for consistency
-- (optional but keeps grep clean — index names are cosmetic).
alter index if exists public.bests_tier_score rename to btb_bests_tier_score;

-- NOTE on RLS policy NAMES: the policies ("bests are public", "insert own
-- bests", etc.) keep their text names — policy names are per-table and don't
-- collide, and renaming them is pure cosmetics. Left as-is to keep this
-- migration minimal. (If you want them renamed too, that's a separate cosmetic
-- pass; functionally irrelevant.)

-- ---------------------------------------------------------------------------
-- 2. Function: publish_best — repoint its body at btb_bests.
--    CREATE OR REPLACE keeps the same signature, so existing client rpc calls
--    by name still resolve; only the table reference inside changes. (Renaming
--    the function itself to publish_btb_best is optional — deferred to keep the
--    client's supabase.rpc('publish_best', …) call unchanged. Revisit when a
--    second board adds its own publish RPC.)
-- ---------------------------------------------------------------------------
create or replace function public.publish_best(
  p_tier                 public.tier,
  p_best_copy_pct        smallint,
  p_bot_copy_pct_at_best smallint
) returns void
language sql
as $$
  insert into public.btb_bests (user_id, tier, best_copy_pct, bot_copy_pct_at_best, updated_at)
  values (auth.uid(), p_tier, p_best_copy_pct, p_bot_copy_pct_at_best, now())
  on conflict (user_id, tier) do update
    set best_copy_pct        = excluded.best_copy_pct,
        bot_copy_pct_at_best = excluded.bot_copy_pct_at_best,
        updated_at           = now()
    where excluded.best_copy_pct > public.btb_bests.best_copy_pct;
$$;

-- ---------------------------------------------------------------------------
-- 3. View: leaderboard → btb_leaderboard.
--    A view can't be renamed to reference a renamed table cleanly via ALTER in
--    all cases, so drop + recreate against btb_bests under the new name.
--    security_invoker preserved. The OLD `leaderboard` view name is dropped —
--    the slice-5 shell will read `btb_leaderboard`. When a second board exists,
--    introduce a generic `leaderboard` UNION view then.
-- ---------------------------------------------------------------------------
drop view if exists public.leaderboard;

create or replace view public.btb_leaderboard
  with (security_invoker = true) as
  select
    p.call_sign,
    p.verified,
    b.tier,
    b.best_copy_pct,
    b.bot_copy_pct_at_best,
    b.updated_at
  from public.btb_bests b
  join public.profiles p on p.id = b.user_id;

grant select on public.btb_leaderboard to anon, authenticated;

-- ============================================================================
-- Post-apply smoke checks
-- ============================================================================
--   select * from public.btb_bests limit 1;          -- data survived the rename
--   select * from public.btb_leaderboard limit 5;     -- view reads renamed table
--   select public.publish_best('technician', 90, 80); -- RPC writes btb_bests
--   -- confirm the OLD names are gone:
--   select to_regclass('public.bests');               -- NULL
--   select to_regclass('public.leaderboard');         -- NULL
-- ============================================================================

-- ============================================================================
-- CLIENT-SIDE follow-up (NOT in this SQL — do in code, part of slice 5 prep):
--   * apps/web/src/lib/bests-sync.ts:
--       - pullBests: supabase.from('bests')  →  supabase.from('btb_bests')
--       - pushBests: supabase.rpc('publish_best', …)  — UNCHANGED (same name)
--   * The slice-5 leaderboard shell reads from('btb_leaderboard').
--   * No other references (the localStorage key morse:btb:bests is unrelated to
--     the DB name and stays).
-- Grep for the string 'bests' and 'leaderboard' in apps/web/src to confirm the
-- only DB-name references are in bests-sync.ts.
-- ============================================================================
