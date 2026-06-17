-- SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
--
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- ============================================================================
-- MORSE — Slice 5.1: server-side ranks + tier tiebreak on btb_leaderboard
-- ============================================================================
-- REVIEW ARTIFACT — apply with `supabase db push` after review.
--
-- WHY: the leaderboard needs callsign search and paging beyond a hard 100-row
-- window. The honest version of "what's this operator's rank?" can only come
-- from the database — a client-side fetch can never see past its window. This
-- migration replaces the view with one that exposes:
--
--   * tier_rank_pos — 1 = best at this tier (RANK over (partition by tier))
--   * all_rank_pos  — 1 = best across all tiers, with tier-difficulty tiebreak
--                     (Extra > General > Technician > No-Code on equal score)
--   * tier_rank     — the tier's difficulty index (0–3), exposed so the client
--                     could re-sort if it ever needed to; mainly here so the
--                     all_rank_pos formula's tiebreak is grep-able.
--
-- Both ranks come from RANK() window functions, so ties get the same number
-- (1, 2, 2, 4) — semantically correct for a leaderboard. updated_at is the
-- final tiebreak (earlier set ranks higher), matching the existing client sort.
--
-- This is a pure VIEW change: no data moved, no table touched, no RLS change.
-- security_invoker stays true so RLS on the base tables governs visibility.
-- The btb_bests insert/update guard (publish_best's improve guard) is
-- unaffected.
-- ============================================================================

-- A view's column list is fixed at create-time; we're adding columns, so drop
-- and recreate. CREATE OR REPLACE would refuse a column-list change.
drop view if exists public.btb_leaderboard;

create view public.btb_leaderboard
  with (security_invoker = true) as
  select
    p.call_sign,
    p.verified,
    b.tier,
    -- Tier difficulty index (mirrors TIERS array order in beat-the-bot.ts):
    -- no-code=0, technician=1, general=2, extra=3. Used as the tier tiebreak
    -- in all_rank_pos and exposed for any future client sort.
    case b.tier
      when 'extra' then 3
      when 'general' then 2
      when 'technician' then 1
      when 'no-code' then 0
    end as tier_rank,
    b.best_copy_pct,
    b.bot_copy_pct_at_best,
    b.updated_at,
    -- Per-tier rank: 1 = best at this tier. Ties on score share a rank;
    -- earlier updated_at breaks the tie within a rank's ordering only (RANK
    -- still assigns identical numbers to equal score+tier pairs, which is
    -- the leaderboard-correct behavior).
    rank() over (
      partition by b.tier
      order by b.best_copy_pct desc, b.updated_at asc
    ) as tier_rank_pos,
    -- Global rank across all tiers. Score desc, then tier difficulty desc
    -- (Extra wins ties), then earliest updated_at. RANK() shares numbers on
    -- exact ties — two operators at 85% Extra at the same instant tie.
    rank() over (
      order by
        b.best_copy_pct desc,
        case b.tier
          when 'extra' then 3
          when 'general' then 2
          when 'technician' then 1
          when 'no-code' then 0
        end desc,
        b.updated_at asc
    ) as all_rank_pos
  from public.btb_bests b
  join public.profiles p on p.id = b.user_id;

-- The base tables are public-select, so this view is public-read too. Grant
-- explicitly for clarity (matches the previous view's grants).
grant select on public.btb_leaderboard to anon, authenticated;

-- ============================================================================
-- Post-apply smoke checks
-- ============================================================================
--   -- View has the new rank columns:
--   select column_name from information_schema.columns
--     where table_schema = 'public' and table_name = 'btb_leaderboard'
--     order by ordinal_position;
--
--   -- Sanity: per-tier ranks start at 1 within each tier, no nulls.
--   select tier, min(tier_rank_pos), max(tier_rank_pos) from public.btb_leaderboard group by tier;
--
--   -- Sanity: global ranks are a dense-ish sequence starting at 1.
--   select min(all_rank_pos), max(all_rank_pos), count(*) from public.btb_leaderboard;
--
--   -- Sanity: a tier-tied score puts Extra above General.
--   -- (Insert two test rows at the same score in different tiers and confirm.)
-- ============================================================================

-- ============================================================================
-- CLIENT-SIDE follow-up (next commit):
--   * leaderboard-btb.ts:
--       - Replace client rankAll() + TIER_DIFFICULTY with server `.order()`
--         on all_rank_pos / tier_rank_pos.
--       - Adapter `load` signature gains { search?, offset?, limit? } and
--         returns { rows, hasMore }.
--       - Use `.ilike('call_sign', '%q%')` for search; keep `.eq('tier', X)`
--         when a tier segment is active, drop it on All.
--   * LeaderboardRow gains `rank: number` (the server-computed rank for the
--     active segment).
--   * leaderboard-view.tsx: search box above segments, "Show more" under the
--     list, no client-side rank math.
-- ============================================================================
