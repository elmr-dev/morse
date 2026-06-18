-- SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
--
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- ============================================================================
-- MORSE — Slice 6 (Step 2): QRZ verification token storage
-- ============================================================================
-- REVIEW ARTIFACT — apply with `supabase db push` after review.
--
-- Written AFTER the Step 1 probe confirmed qrz.com/db/CALLSIGN returns the full
-- profile HTML (status 200, 93KB, server-rendered, no login wall) to an
-- anonymous server-side fetch. The token-in-bio proof is viable.
--
-- One pending verification per user: a minted token bound to the callsign it
-- authorizes, with a 24h expiry. The user pastes the token into their public
-- QRZ bio; the verify Edge Function (service_role) re-fetches the QRZ page,
-- confirms the token is present, sets profiles.verified = true, and deletes
-- this row. The token's power is ONLY that the SERVER reads it off the canonical
-- QRZ page — never trust a token submitted in a request body as proof.
-- ============================================================================

create table public.profile_verifications (
  user_id    uuid        primary key references public.profiles(id) on delete cascade,
  token      text        not null,
  call_sign  text        not null,   -- the call this token authorizes (matches profiles.call_sign at mint time)
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.profile_verifications enable row level security;

-- The user may READ their own pending token (the /account UI displays it to
-- paste) and INSERT/UPSERT their own (mint / re-mint). No public read — a
-- pending token is a secret until it's in the bio. The Edge Function uses
-- service_role and bypasses RLS to read it for matching and to delete on success.
create policy "read own verification" on public.profile_verifications
  for select using (user_id = auth.uid());

create policy "insert own verification" on public.profile_verifications
  for insert with check (user_id = auth.uid());

create policy "update own verification" on public.profile_verifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "delete own verification" on public.profile_verifications
  for delete using (user_id = auth.uid());

-- ============================================================================
-- Post-apply smoke checks
-- ============================================================================
--   select * from public.profile_verifications;            -- empty
--   select relrowsecurity from pg_class where relname = 'profile_verifications'; -- true
-- ============================================================================

-- ============================================================================
-- DESIGN NOTES for the Edge Function (qrz-verify), action='check':
--   1. Identify the caller from the Authorization bearer (user-scoped client →
--      auth.uid()).
--   2. Read their pending row from profile_verifications + their call_sign from
--      profiles (service_role read, or user-scoped — both work; the token is
--      readable by the user under RLS anyway).
--   3. Reject if no pending token or expires_at < now().
--   4. fetch('https://www.qrz.com/db/' + call_sign) with a browser User-Agent.
--   5. If the page HTML contains the token string → set profiles.verified=true
--      (SERVICE_ROLE — the only role that can, post-0004), delete this row,
--      return { verified: true }.
--   6. Else return { verified: false, reason: 'token-not-found' | 'expired' }.
--   The call_sign fetched is the user's OWN claimed call (built from profiles),
--   so ownership is inherent: the token only proves they control THAT call's bio.
-- ============================================================================
