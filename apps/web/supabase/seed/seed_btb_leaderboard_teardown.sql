-- SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
--
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- ============================================================================
-- MORSE — DEV SEED TEARDOWN: remove the 50 synthetic operators
-- ============================================================================
-- Deletes EXACTLY the rows created by seed_btb_leaderboard.sql, matched by the
-- deterministic '0000seed-' UUID prefix. Never matches real operators (a real
-- auth.users id is a random v4 UUID and won't collide with this prefix).
--
-- Run this before launch, or any time you want a clean leaderboard. Safe to run
-- even if the seed was never applied (deletes nothing).
--
-- Order matters: btb_bests + profiles FK to auth.users with ON DELETE CASCADE,
-- so deleting the profiles (or the auth.users) cascades. We delete explicitly at
-- each level anyway for clarity and to work whether or not cascade is trusted.
-- ============================================================================

begin;

-- Bests first (child of profiles).
delete from public.btb_bests
where user_id::text like '0000seed-%';

-- Profiles (child of auth.users).
delete from public.profiles
where id::text like '0000seed-%';

-- The synthetic auth.users rows. (If you seeded profiles against rows that
-- cascade-delete, this may already be empty — harmless.)
-- NOTE: requires privileges on auth schema (service role / SQL editor).
delete from auth.users
where id::text like '0000seed-%';

commit;

-- ============================================================================
-- Verify clean:
--   select count(*) from public.profiles  where id::text like '0000seed-%'; -- 0
--   select count(*) from public.btb_bests where user_id::text like '0000seed-%'; -- 0
--   select count(*) from auth.users        where id::text like '0000seed-%'; -- 0
-- ============================================================================
