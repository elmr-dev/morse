-- SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
--
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- ============================================================================
-- MORSE — Slice 6 (Step 0): lock the `verified` write-path
-- ============================================================================
-- REVIEW ARTIFACT — apply with `supabase db push` after review.
--
-- WHY: `verified` must be set ONLY by the QRZ verify Edge Function (which uses
-- the service_role key). But the "update own profile" RLS policy lets a user
-- update their own row — and anon/authenticated currently hold a column-level
-- UPDATE grant on `verified` (confirmed via information_schema.column_privileges),
-- so a signed-in user could flip their own verified=true today. This closes that.
--
-- Revoking the COLUMN grant leaves the rest of the row updatable (the user can
-- still change call_sign under the existing RLS policy) — it only removes their
-- ability to write `verified`. service_role bypasses RLS *and* column grants, so
-- the Edge Function can still set it. INSERT(verified) is revoked too, so a
-- profile can't be claimed pre-verified — `verified` defaults false and only the
-- function flips it.
--
-- Safe to apply independently of the rest of slice 6 (the QRZ probe / token
-- flow): closing this hole is correct regardless of how verification is built.
-- ============================================================================

revoke update (verified) on public.profiles from anon, authenticated;
revoke insert (verified) on public.profiles from anon, authenticated;

-- ============================================================================
-- Post-apply smoke checks
-- ============================================================================
--   -- anon/authenticated should no longer have UPDATE or INSERT on verified;
--   -- service_role (and postgres) still do:
--   select grantee, privilege_type
--     from information_schema.column_privileges
--     where table_schema='public' and table_name='profiles'
--       and column_name='verified'
--     order by grantee, privilege_type;
--
--   -- As an authenticated user, this should now FAIL (column not grantable),
--   -- while updating call_sign still works:
--   --   update public.profiles set verified = true where id = auth.uid();   -- rejected
--   --   update public.profiles set call_sign = 'W4GIT' where id = auth.uid(); -- ok
-- ============================================================================

-- ============================================================================
-- CLIENT-SIDE follow-up (verify before/with this):
--   * apps/web/src/lib/auth.tsx claimCallsign(): the insert is
--     { id, call_sign } — it must NOT include `verified`, or the insert will
--     fail the revoked INSERT(verified) grant. Confirm it doesn't (slice 3 wrote
--     it as id + call_sign only, so this should already be fine — just verify).
-- ============================================================================
