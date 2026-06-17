<!--
SPDX-FileCopyrightText: 2026 Mark Percival, John Schult

SPDX-License-Identifier: AGPL-3.0-or-later
-->

# CCC — Slice 6: QRZ verify Edge Function (+ lock the `verified` write-path)

## Context

This is the first server-side slice — a Supabase Edge Function (Deno) that
verifies callsign ownership by reading a token from the operator's public QRZ
bio, then sets `profiles.verified = true`. It also closes the security hole left
open since slice 2: `anon`/`authenticated` currently hold UPDATE on
`profiles.verified` (confirmed via column grants), so a user can self-verify
today. Slice 6 revokes that and makes the Edge Function (service_role) the ONLY
writer of `verified`.

**The whole slice rests on one untested assumption: that `qrz.com/db/CALLSIGN`
returns the bio HTML to an unauthenticated server-side fetch.** A datacenter IP
with no QRZ session is a different fetch than you viewing your own logged-in
profile. So this slice is structured to PROVE that first (Step 1 is a probe you
deploy and hit once), and only build the real verification on top if it holds. Do
NOT write the full flow assuming QRZ cooperates — gate it on the probe result.

## The verification model (locked, recap)

- Proof = the SERVER fetches the canonical QRZ page for a callsign and finds a
  secret token in that page's HTML. NOT the badge rendering, NOT a request
  arriving at an endpoint.
- A token is minted server-side, bound to (user, callsign), single-use-ish, with
  an expiry. The user pastes it into their QRZ bio. The function re-fetches and
  matches.
- The badge (`<img>`) is slice 7 and carries NO token — keep them decoupled.

## Off-limits

`vite.config.ts`, `public/_headers`, `optimizeDeps`, `src/inference/`. Do not
touch the decode path. The Edge Function is server-side and CANNOT affect
browser COOP/COEP — but the client code this slice adds (the "verify" UI on
`/account`) must not, so re-verify `crossOriginIsolated === true` after.

---

## Step 0 — Schema: lock the `verified` write-path (migration 0004)

`supabase/migrations/20260617000004_lock_verified.sql`:

```sql
-- service_role (the Edge Function) keeps full access and bypasses these anyway.
-- Strip verified from client roles so only the function can set it.
revoke update (verified) on public.profiles from anon, authenticated;
revoke insert (verified) on public.profiles from anon, authenticated;
```

Rationale (comment it): the `update own profile` RLS policy lets a user update
their own row; without this column revoke they could set `verified=true`
themselves. Revoking the column grant closes it while leaving the rest of the row
updatable (call_sign). INSERT(verified) is revoked too so a claim can't insert a
pre-verified row — `verified` defaults false and only the function flips it.
`service_role` is unaffected (it bypasses grants + RLS), so the function still
writes it.

NOTE: after this, the slice-3 `claimCallsign` insert must NOT include `verified`
in its column list (it currently inserts `{ id, call_sign }` — confirm it
doesn't send `verified`; if it does, drop it, or the insert will fail the revoke).

Apply via `supabase db push`, verify with the column-grant query (anon/auth no
longer have UPDATE/INSERT on verified; service_role does).

## Step 1 — PROBE FIRST: does QRZ serve the bio to a server fetch?

Create the function `supabase/functions/qrz-verify/index.ts` but in this step it
does ONLY a diagnostic. Given a `?probe=CALLSIGN` query param, it:

1. `fetch('https://www.qrz.com/db/' + encodeURIComponent(call.toUpperCase()))`
   with a realistic browser `User-Agent` header (QRZ may reject non-browser UAs).
2. Returns JSON: `{ status, ok, length, hasBioMarker, snippet }` where
   `hasBioMarker` checks whether the response contains some text you KNOW is in
   your W4GIT bio (the function can't know your bio, so: return the first ~2KB of
   the body as `snippet` so you can eyeball whether real bio content is present,
   plus the HTTP status and content length).
3. No DB writes, no auth, no token logic yet.

Deploy: `supabase functions deploy qrz-verify`. Then hit
`https://qhmtjowsknqjkoieqxqk.supabase.co/functions/v1/qrz-verify?probe=W4GIT`
(with the anon key as the `Authorization: Bearer` header — functions require it
by default; or set `--no-verify-jwt` for the probe).

**STOP and report the probe result to John before building Step 2+.** Three
outcomes:
- **Bio HTML present** in the snippet → great, proceed to Step 2.
- **A login wall / stub / 403 / empty** → the token-in-bio approach as designed
  doesn't work from a server fetch. STOP and rethink (options: a different QRZ
  surface, an authenticated fetch, or a different proof entirely). Do NOT build
  the rest of the slice on a broken fetch.
- **JS-rendered (HTML present but bio missing, loaded by client JS)** → raw fetch
  won't see it; same stop-and-rethink.

This step exists so we spend one tiny function discovering QRZ's behavior, not a
whole slice. Everything below is CONTINGENT on the probe succeeding.

## Step 2 — Token mint + verify (only if Step 1 passed)

A `profile_verifications` table (migration 0005, written after the probe passes):

```sql
create table public.profile_verifications (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  token      text not null,
  call_sign  text not null,           -- the call this token authorizes
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.profile_verifications enable row level security;
-- The user may READ their own pending token (to display it) and INSERT/refresh
-- it; the Edge Function (service_role) reads it to match. No public read.
create policy "read own verification" on public.profile_verifications
  for select using (user_id = auth.uid());
```

Token minting can be a client insert (RLS-scoped to own row) OR a function
endpoint. Prefer: the Edge Function has two actions:
- `POST { action: 'mint' }` (authed) → generates a token like
  `MORSE-VERIFY-<base32 random>`, upserts the row with a 24h expiry, returns the
  token for the user to paste.
- `POST { action: 'check' }` (authed) → fetches the user's pending token + their
  claimed call_sign from `profiles`, fetches `qrz.com/db/CALLSIGN`, checks the
  token string is present in the HTML. If found and not expired → set
  `profiles.verified = true` (service_role), delete the verification row, return
  `{ verified: true }`. Else `{ verified: false, reason }`.

The function authenticates the caller: read the `Authorization` bearer, use it to
identify the user (a user-scoped client for reading auth.uid()), but use the
SERVICE_ROLE client for the `verified` write (the only thing that can, post-0004).
Get the secret via `Deno.env.get('SUPABASE_SECRET_KEY')` — set it with
`supabase secrets set SUPABASE_SECRET_KEY=sb_secret_…` (NOT in source).

Security notes to honor:
- The token is matched by the SERVER reading the canonical QRZ page — never trust
  a token submitted in the request body as proof (that's forgeable).
- Bind the token to the call_sign in `profiles` at check time — verify the call
  on the QRZ page matches the claimed call (the URL is built from the claimed
  call, so this is inherent, but assert the profile's call_sign is what's fetched).
- Expiry enforced (24h). Expired → reject, require re-mint.
- Rate-limit conceptually (a user spamming 'check' hammers QRZ) — at minimum,
  don't allow check more than every few seconds per user; note as a TODO if full
  rate-limiting is out of scope for this slice.

## Step 3 — Account-page verify UI (only if Step 1 passed)

Extend `/account`'s `ready` state (currently shows callsign + muted shield +
"Verification coming soon"). Replace "coming soon" with the real flow:
- If `verified` → `ShieldCheck` + "Verified" (done, no action).
- If not verified → a "Verify your callsign" disclosure:
  1. "Get token" button → calls the function `mint` → shows the token + copy
     button + instructions: "Paste this anywhere in your QRZ bio, save, then come
     back and click Check."
  2. "Check" button → calls the function `check` → on success flips to Verified
     (toast + refetch profile via `useAuth().refreshProfile`); on failure a clear
     reason ("token not found on your QRZ page — did you save the bio?").
- All function calls go through `supabase.functions.invoke('qrz-verify', …)`,
  which attaches the user's auth automatically.

Keep it honest about the manual step (paste → save → check). Don't over-promise
"instant."

## Step 4 — Tests

- Migration 0004: a test (or manual smoke) that an `authenticated` role can no
  longer update `verified` but CAN still update `call_sign`.
- Function logic: unit-test the token-match logic (given HTML containing /not
  containing the token, expired/valid) as a pure function extracted from the
  handler. The QRZ fetch itself is mocked.
- Account page: mock `supabase.functions.invoke` — mint shows the token, check
  success flips to verified, check failure shows the reason. axe clean.

## Verification gate (do NOT auto-commit)

1. **Step 1 probe result reported to John FIRST** — do not proceed past Step 1
   without confirming QRZ serves the bio.
2. `bunx turbo check typecheck build test --filter=morse-web` green (the Edge
   Function is Deno, outside the web build — ensure it's excluded from the web
   app's tsc/biome/knip, like the seed script; it has its own Deno-typed world).
3. `supabase db push` applies 0004 (and 0005 after probe) cleanly; column grants
   confirm anon/auth can't write `verified`.
4. Live: mint a token as W4GIT, paste into the real QRZ bio, save, click Check →
   `profiles.verified` flips true, the shield lights up on `/account` AND on the
   leaderboard row (the shield you built in slice 5).
5. Self-verify attempt blocked: as a normal authed user, try to
   `update profiles set verified=true` via the client → rejected (the revoke
   holds).
6. `crossOriginIsolated === true` unaffected.

## Out of scope

- No badge (slice 7) — verification and badge stay decoupled.
- No QRZ XML API (proves existence, not ownership — wrong tool).
- TQSL/LoTW cert verification (the future "gold" tier) — not here.
- Full rate-limiting infra if it's heavy — note as TODO, ship a minimal guard.

## A note on sequencing within this slice

Steps 0 and 1 are independent and safe: 0004 (lock verified) can apply now, and
the Step 1 probe is read-only. Do those, report the probe, THEN build 2–4. If the
probe fails, 0004 still stands (closing the hole is correct regardless), and we
redesign verification.
