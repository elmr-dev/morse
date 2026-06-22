-- SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
--
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- ============================================================================
-- MORSE — Redline trainer leaderboard (the second board)
-- ============================================================================
-- REVIEW ARTIFACT — apply with `supabase db push` after review.
--
-- This is the second leaderboard board the schema was built to host (see the
-- rename-to-btb_* migration's rationale). It mirrors the Beat-the-Bot pattern
-- exactly — a `*_bests` table, an improve-guarded `publish_*` RPC, and a
-- server-ranked `*_leaderboard` view over public-read RLS tables — but is
-- SIMPLER: Redline has no tiers, so there's one best row per operator ranked on
-- a single score.
--
-- Design (same locks as btb):
--   * Anonymous play is canonical in localStorage; this DB is a DOWNSTREAM
--     published copy. Local always wins; the client only pushes on improvement.
--   * Auth is OPTIONAL — a row only exists once a signed-in operator with a
--     claimed callsign posts a score.
--   * BEST ONLY. No run history table.
--   * Score is total points (integer, higher is better). top_wpm is the top
--     speed reached on the run that set the best (frozen alongside the score,
--     like btb freezes the bot's % — one honest pair, not a separate max).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- redline_bests — one row per operator (no tiers). PK is user_id so an
-- upsert-on-improve is natural. FK → profiles, cascade on account delete.
-- ---------------------------------------------------------------------------
create table public.redline_bests (
  user_id     uuid        primary key references public.profiles (id) on delete cascade,
  best_score  integer     not null check (best_score >= 0),
  top_wpm     smallint    not null check (top_wpm between 0 and 200),
  updated_at  timestamptz not null default now()
);

create index redline_bests_score on public.redline_bests (best_score desc);

-- ============================================================================
-- Row-Level Security — world-readable (the board is public), write-your-own.
-- Mirrors the btb_bests policies exactly.
-- ============================================================================
alter table public.redline_bests enable row level security;

create policy "redline_bests are public"
  on public.redline_bests for select
  using (true);

create policy "insert own redline_bests"
  on public.redline_bests for insert
  with check (user_id = auth.uid());

create policy "update own redline_bests"
  on public.redline_bests for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "delete own redline_bests"
  on public.redline_bests for delete
  using (user_id = auth.uid());

-- ============================================================================
-- Upsert-on-improve — DB-side guard. localStorage is canonical and the client
-- only pushes on a real improvement, but this makes the sync idempotent and
-- replay/multi-device safe: a stale or out-of-order push can never lower a
-- published best. SECURITY INVOKER (default): runs as the caller, so RLS still
-- applies and it only ever writes the caller's own row (user_id = auth.uid()).
-- ============================================================================
create or replace function public.publish_redline_score(
  p_best_score integer,
  p_top_wpm    smallint
) returns void
language sql
as $$
  insert into public.redline_bests (user_id, best_score, top_wpm, updated_at)
  values (auth.uid(), p_best_score, p_top_wpm, now())
  on conflict (user_id) do update
    set best_score = excluded.best_score,
        top_wpm    = excluded.top_wpm,
        updated_at = now()
    -- IMPROVE GUARD: only overwrite when the incoming score is strictly higher.
    -- A tie or regression is a no-op (the row, and its frozen top_wpm, stay).
    where excluded.best_score > public.redline_bests.best_score;
$$;

-- ============================================================================
-- Public leaderboard view — server-computed rank. Flat (no tiers), so a single
-- rank_pos over the whole board. security_invoker = true so RLS on the base
-- tables governs visibility (both are public-select). RANK() shares numbers on
-- exact ties ("1, 2, 2, 4"); earliest updated_at breaks the ordering within a
-- tie, matching btb.
-- ============================================================================
create or replace view public.redline_leaderboard
  with (security_invoker = true) as
  select
    p.call_sign,
    p.verified,
    b.best_score,
    b.top_wpm,
    b.updated_at,
    rank() over (
      order by b.best_score desc, b.updated_at asc
    ) as rank_pos
  from public.redline_bests b
  join public.profiles p on p.id = b.user_id;

grant select on public.redline_leaderboard to anon, authenticated;

-- ============================================================================
-- Post-apply smoke checks
-- ============================================================================
--   -- View has the rank column:
--   select column_name from information_schema.columns
--     where table_schema = 'public' and table_name = 'redline_leaderboard'
--     order by ordinal_position;
--
--   -- Ranks are a dense-ish sequence starting at 1:
--   select min(rank_pos), max(rank_pos), count(*) from public.redline_leaderboard;
--
--   -- Improve guard holds: a lower re-push is a no-op.
--   --   select public.publish_redline_score(100, 20);  -- as some signed-in user
--   --   select public.publish_redline_score(50, 40);   -- no-op (50 < 100)
-- ============================================================================
