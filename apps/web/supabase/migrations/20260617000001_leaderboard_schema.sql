-- SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
--
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- ============================================================================
-- MORSE — Slice 2: leaderboard schema (profiles + bests) + RLS + public view
-- ============================================================================
-- REVIEW ARTIFACT — not yet applied. Apply with `supabase db push` (or paste
-- into the SQL editor) only after review. See ../README.md for the model.
--
-- Design (locked June 2026):
--   * Anonymous play is canonical in localStorage; this DB is a DOWNSTREAM
--     published copy for the leaderboard + QRZ badge. Local always wins.
--   * Auth is OPTIONAL — these tables only matter once a user opts in to claim
--     a callsign and publish bests.
--   * BESTS ONLY. No attempts/history table.
--   * Tier ids mirror the TS union in apps/web/src/inference/beat-the-bot.ts:
--     'no-code' | 'technician' | 'general' | 'extra'.
--   * Copy % everywhere (0–100, higher is better). No CER in the DB.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tier enum — mirrors Tier['id'] in beat-the-bot.ts. Stable (license classes),
-- so an enum's integrity is worth more than the flexibility of text+check.
-- NOTE: enum *value order* here is the natural tier ordering (easiest →
-- hardest), so "highest tier reached" can sort on the enum directly rather than
-- a hand-maintained CASE.
-- ---------------------------------------------------------------------------
create type public.tier as enum ('no-code', 'technician', 'general', 'extra');

-- ---------------------------------------------------------------------------
-- profiles — one row per authenticated user who has claimed a callsign.
-- id is the auth.users FK (1:1). call_sign is the public identity on the board.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid        primary key references auth.users (id) on delete cascade,
  call_sign   text        not null,
  verified    boolean     not null default false,
  created_at  timestamptz not null default now()
);

-- Case-insensitive uniqueness. The app ALWAYS inserts uppercase, but this index
-- guarantees 'W4GIT' and 'w4git' can never both be claimed regardless of how a
-- row gets in. Enforced on upper() rather than citext to avoid the extension.
create unique index profiles_call_sign_unique on public.profiles (upper(call_sign));

-- Light sanity on the shape of a callsign string (not a full ITU validation —
-- just length + charset, so the column can't hold junk). 1–10 chars, A–Z/0–9
-- and the slash used in portable/operating-location calls (e.g. W4GIT/M).
alter table public.profiles
  add constraint profiles_call_sign_format
  check (call_sign ~ '^[A-Z0-9/]{1,10}$');

-- ---------------------------------------------------------------------------
-- bests — one row per (user, tier). The published copy of localStorage
-- morse:btb:bests. PK is composite so an upsert-on-improve is natural.
--   best_copy_pct        — the human's best at this tier (0–100)
--   bot_copy_pct_at_best — the bot's copy % FROM THE SAME ROUND that set the
--                          best (frozen; honest You/Bot pair for the badge)
-- beatCount is intentionally NOT synced — it's local flavor, not leaderboard
-- data. (Revisit only if the board ever ranks on it.)
-- ---------------------------------------------------------------------------
create table public.bests (
  user_id              uuid        not null references public.profiles (id) on delete cascade,
  tier                 public.tier not null,
  best_copy_pct        smallint    not null check (best_copy_pct between 0 and 100),
  bot_copy_pct_at_best smallint    not null check (bot_copy_pct_at_best between 0 and 100),
  updated_at           timestamptz not null default now(),
  primary key (user_id, tier)
);

create index bests_tier_score on public.bests (tier, best_copy_pct desc);

-- ============================================================================
-- Row-Level Security
-- ============================================================================
-- profiles: world-readable (the leaderboard is public), but a user may only
-- insert/update/delete THEIR OWN row (id = auth.uid()). verified is protected —
-- see the column note below.
-- bests: world-readable, write-your-own only.
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.bests    enable row level security;

-- profiles — read
create policy "profiles are public"
  on public.profiles for select
  using (true);

-- profiles — claim your own row (id must equal the caller)
create policy "insert own profile"
  on public.profiles for insert
  with check (id = auth.uid());

-- profiles — update your own row only
create policy "update own profile"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- profiles — delete your own row only
create policy "delete own profile"
  on public.profiles for delete
  using (id = auth.uid());

-- bests — read
create policy "bests are public"
  on public.bests for select
  using (true);

-- bests — insert your own
create policy "insert own bests"
  on public.bests for insert
  with check (user_id = auth.uid());

-- bests — update your own
create policy "update own bests"
  on public.bests for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- bests — delete your own
create policy "delete own bests"
  on public.bests for delete
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- IMPORTANT — `verified` is set by the VERIFY EDGE FUNCTION (slice 5), never by
-- the client. The "update own profile" policy above would let a user flip their
-- own verified=true. Close that hole with a COLUMN-level revoke so the client
-- can update call_sign but not verified; the Edge Function uses the
-- secret/service_role key, which bypasses RLS + column grants and can still
-- set it.
--
-- Left COMMENTED until slice 5 wires the function (so review can see it now):
--
--   revoke update (verified) on public.profiles from authenticated, anon;
--
-- (Option B if you prefer a trigger over a column grant: a BEFORE UPDATE
-- trigger that raises if NEW.verified <> OLD.verified and the caller isn't
-- service_role. The column revoke is simpler and recommended.)
-- ---------------------------------------------------------------------------

-- ============================================================================
-- Upsert-on-improve — DB-side guard
-- ============================================================================
-- localStorage is canonical and the client only pushes on a real improvement,
-- BUT a DB-side guard makes the sync idempotent and replay/multi-device safe:
-- a stale or out-of-order push can never lower a published best. Clients call
-- this RPC instead of a raw upsert.
--
-- SECURITY INVOKER (default): runs as the caller, so RLS on bests still applies.
-- The function only ever writes the caller's own row because it passes
-- auth.uid() as user_id. Calling with no session (auth.uid() IS NULL) inserts
-- nothing meaningful and is blocked by the bests insert policy.
-- ============================================================================
create or replace function public.publish_best(
  p_tier                 public.tier,
  p_best_copy_pct        smallint,
  p_bot_copy_pct_at_best smallint
) returns void
language sql
as $$
  insert into public.bests (user_id, tier, best_copy_pct, bot_copy_pct_at_best, updated_at)
  values (auth.uid(), p_tier, p_best_copy_pct, p_bot_copy_pct_at_best, now())
  on conflict (user_id, tier) do update
    set best_copy_pct        = excluded.best_copy_pct,
        bot_copy_pct_at_best = excluded.bot_copy_pct_at_best,
        updated_at           = now()
    -- IMPROVE GUARD: only overwrite when the incoming best is strictly higher.
    -- A tie or regression is a no-op (the row stays as-is).
    where excluded.best_copy_pct > public.bests.best_copy_pct;
$$;

-- ============================================================================
-- Public leaderboard view — LONG format (one row per operator+tier).
-- The app pivots client-side for "highest tier reached + that tier's pair".
-- Exposes verified as a boolean so the UI can render a shield icon (no separate
-- columns), plus updated_at as the as-of date.
--
-- security_invoker = true: the view runs with the QUERYING user's privileges
-- and RLS, not the view owner's. Harmless today (both base tables are
-- public-read), but it means the view can never silently leak past a future
-- RLS tightening. Always set this on views over RLS tables.
-- ============================================================================
create or replace view public.leaderboard
  with (security_invoker = true) as
  select
    p.call_sign,
    p.verified,
    b.tier,
    b.best_copy_pct,
    b.bot_copy_pct_at_best,
    b.updated_at
  from public.bests b
  join public.profiles p on p.id = b.user_id;

-- A view over RLS-protected base tables inherits their row visibility. Both base
-- tables are public-select, so the leaderboard is fully readable by anon. Grant
-- select explicitly for clarity.
grant select on public.leaderboard to anon, authenticated;
