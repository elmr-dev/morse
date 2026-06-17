-- SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
--
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- ============================================================================
-- MORSE — Slice 6 (Step 2.1): two-phase QRZ verification
-- ============================================================================
-- Adds `present_at` to profile_verifications so verification becomes:
--   1) Check  — server confirms token IS in the QRZ bio, stamps present_at.
--   2) Confirm — server confirms token has been REMOVED, then marks verified.
--
-- Why two phases: with the original one-shot model the token stayed in the
-- operator's bio forever after verification (or required a stale-check banner
-- nudging them to remove it). Splitting Check → Confirm keeps the bio clean —
-- the badge only appears once the token is BOTH proven present and proven
-- removed.
-- ============================================================================

alter table public.profile_verifications
  add column if not exists present_at timestamptz;
