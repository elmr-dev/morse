-- SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
--
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- ============================================================================
-- MORSE — DEV SEED: 50 synthetic operators for leaderboard testing
-- ============================================================================
-- ⚠️  DEV / STAGING ONLY. DO NOT RUN AGAINST PRODUCTION. ⚠️
--
-- This is NOT a migration — it lives in supabase/seed/, never migrations/, so
-- `supabase db push` never applies it. Run it MANUALLY against your dev project
-- (SQL editor, or `psql`/service-role) when you want test data, and tear it
-- down with seed_btb_leaderboard_teardown.sql before launch.
--
-- WHY synthetic auth.users rows: profiles.id is an FK to auth.users, and RLS +
-- the publish_best improve-guard mean you can't just INSERT btb_bests as
-- arbitrary callsigns from the client. The leaderboard only READS profiles +
-- btb_bests (never authenticates as these users), so synthetic auth rows with
-- valid UUIDs that satisfy the FK are sufficient. These accounts cannot log in
-- and have no real session — they exist only to own leaderboard rows.
--
-- TEARDOWN IS EXACT: every seeded row uses a deterministic UUID in the
-- '0000seed'-prefixed namespace (see below), so teardown deletes precisely
-- these rows and nothing real. Callsigns are realistic for demo screenshots but
-- the UUIDs are the source of truth for cleanup — never delete by callsign.
--
-- Distribution is deliberate, to exercise:
--   * 25+ entries in multiple tiers   → pagination + "outside top 25" pin fire
--   * operators with bests in 2–4 tiers → All-view rank/dedup behavior is visible
--   * a verified/unverified mix         → both shield states render
--   * score spread 38–100%             → realistic ranking, ties on round numbers
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Synthetic operators. Deterministic UUIDs: '0000seed-0000-0000-0000-NNNNNNNNNNNN'
--    where NNNN... is the zero-padded index — so teardown matches the prefix.
--    50 operators. Callsigns are plausible US/intl formats. `verified` ~40% true.
-- ---------------------------------------------------------------------------
with ops as (
  select
    n,
    ('0000seed-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid as id,
    -- Realistic-looking callsigns. Mix of 1x2, 1x3, 2x1, 2x3 US-style + a few intl.
    (array[
      'W4ABC','K2DEF','N7GHI','AC4JKL','KD9MNO','W1PQR','N0STU','K6VWX',
      'AB1YZA','W5BCD','KE4EFG','N3HIJ','W9KLM','K8NOP','AA2QRS','W7TUV',
      'N5WXY','KG4ZAB','W3CDE','K4FGH','N1IJK','W8LMN','AD5OPQ','K0RST',
      'W6UVW','N2XYZ','KF7ABD','W0CEF','K5GHJ','N4KLN','AE6MOP','W2QRT',
      'KB8UVX','N9YZA','K3BCE','W5DFG','N6HJK','AC7LMO','K1PQS','W4TUW',
      'KD2XYB','N8CDF','W7GHK','K9LMP','AB5QRT','N0UVW','W1XYZ','KE6ABC',
      'G3XYZ','VK2ABC'
    ])[n] as call_sign,
    -- ~40% verified (every 5th + every 3rd, deduped by the boolean).
    (n % 5 = 0 or n % 3 = 0) as verified
  from generate_series(1, 50) as n
)
insert into public.profiles (id, call_sign, verified, created_at)
select id, call_sign, verified, now() - (n || ' hours')::interval
from ops
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Bests. We want a realistic spread AND multi-tier operators. Strategy:
--    * EVERY operator gets a 'technician' best (so Technician is the dense tier,
--      well past 25 rows → pin + pagination fire there).
--    * The first 20 operators ALSO get a 'no-code' best.
--    * The first 12 ALSO get 'general'.
--    * The first 6 ALSO get 'extra' (so a handful are multi-tier across all 4 —
--      these are the ones that expose the All-view rank/dedup question).
--    Scores: a spread that creates ties on round numbers (to verify RANK()
--    shares numbers) and puts low scorers outside the top 25.
--
--    bot_copy_pct_at_best is set plausibly (the bot is strong: 70–99), but the
--    leaderboard view is human-only so it won't show — it's here for badge
--    testing later (slice 7) and schema realism.
-- ---------------------------------------------------------------------------

-- Helper: a pseudo-random-but-deterministic score per (op, tier) in a sane band.
-- We derive from the index so re-running is stable and teardown-safe.

-- Technician — all 50. Scores 38..99, descending-ish with some collisions.
insert into public.btb_bests (user_id, tier, best_copy_pct, bot_copy_pct_at_best, updated_at)
select
  ('0000seed-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  'technician'::public.tier,
  -- 100 - (n*1.2) clamped, rounded to create some equal values
  greatest(38, least(99, round(100 - n * 1.15)))::smallint,
  (72 + (n * 7) % 28)::smallint,                     -- bot 72..99
  now() - (n * 13 || ' minutes')::interval
from generate_series(1, 50) as n
on conflict (user_id, tier) do nothing;

-- No-Code — first 20. Higher band (easier tier).
insert into public.btb_bests (user_id, tier, best_copy_pct, bot_copy_pct_at_best, updated_at)
select
  ('0000seed-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  'no-code'::public.tier,
  greatest(60, least(100, round(102 - n * 1.6)))::smallint,
  (80 + (n * 5) % 20)::smallint,
  now() - (n * 17 || ' minutes')::interval
from generate_series(1, 20) as n
on conflict (user_id, tier) do nothing;

-- General — first 12. Mid band.
insert into public.btb_bests (user_id, tier, best_copy_pct, bot_copy_pct_at_best, updated_at)
select
  ('0000seed-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  'general'::public.tier,
  greatest(45, least(95, round(92 - n * 2.0)))::smallint,
  (75 + (n * 9) % 25)::smallint,
  now() - (n * 23 || ' minutes')::interval
from generate_series(1, 12) as n
on conflict (user_id, tier) do nothing;

-- Extra — first 6. Brutal band (low scores, the hardest tier).
insert into public.btb_bests (user_id, tier, best_copy_pct, bot_copy_pct_at_best, updated_at)
select
  ('0000seed-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  'extra'::public.tier,
  greatest(40, least(85, round(80 - n * 3.0)))::smallint,
  (88 + (n * 3) % 12)::smallint,
  now() - (n * 31 || ' minutes')::interval
from generate_series(1, 6) as n
on conflict (user_id, tier) do nothing;

commit;

-- ============================================================================
-- Post-seed smoke checks — these answer the All-view rank question
-- ============================================================================
--   -- Technician should have 50 rows → pin + pagination fire there:
--   select count(*) from public.btb_leaderboard where tier = 'technician';
--
--   -- Per-tier ranks start at 1, dense within tier:
--   select tier, min(tier_rank_pos), max(tier_rank_pos), count(*)
--     from public.btb_leaderboard group by tier order by tier;
--
--   -- THE KEY ONE — a multi-tier operator (ops 1–6 are in all four tiers).
--   -- See how many times op #1's callsign appears and at what all_rank_pos:
--   select call_sign, tier, best_copy_pct, tier_rank_pos, all_rank_pos
--     from public.btb_leaderboard
--     where call_sign = (select call_sign from public.profiles
--                        where id = '0000seed-0000-0000-0000-000000000001')
--     order by all_rank_pos;
--   -- If the All view dedups to one row per operator, confirm the displayed
--   -- rank for this op is contiguous with neighbours (no gap from their hidden
--   -- lower-tier rows). If All shows every per-tier row, expect 4 rows here.
--
--   -- Verified mix present (both shield states):
--   select verified, count(*) from public.profiles
--     where id::text like '0000seed-%' group by verified;
-- ============================================================================
