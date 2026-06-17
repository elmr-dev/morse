<!--
SPDX-FileCopyrightText: 2026 Mark Percival, John Schult

SPDX-License-Identifier: AGPL-3.0-or-later
-->

# MORSE — Supabase backend

Backend for the **optional** accounts / leaderboard / QRZ-badge layer. Nothing
here is wired into the web build — `apps/web` is a static SPA that *talks to*
Supabase at runtime via the publishable key; it does not *contain* this. These
files are **review artifacts**: read them, then apply deliberately. Nothing runs
until you run it.

> Lives under `apps/web/` because Supabase is only relevant to the web app.
> If a `supabase/` toolchain is later set up at the repo root for the CLI, move
> `migrations/` and `functions/` there and drop a `config.toml`.

**Project:** `qhmtjowsknqjkoieqxqk` · `https://qhmtjowsknqjkoieqxqk.supabase.co`

## The model (locked June 2026)

- **Anonymous play is canonical**, forever. Gameplay bests live in
  `localStorage` (`morse:btb:bests`). This database is a **downstream published
  copy** for the public leaderboard + QRZ badge. **Local always wins**; the
  cloud is strictly downstream.
- **Auth is opt-in only.** You never need an account to play. Signing in
  (Supabase OAuth, slice 3) exists solely to claim a callsign, publish bests,
  and earn the QRZ badge.
- **Bests only — no history.** One row per `(user, tier)`. No attempts table.
  (A future trainer page would need raw attempts; that's a separate decision, not
  free from this schema.)
- **Copy % everywhere.** Storage and display both speak copy % (0–100, higher is
  better). CER does not exist in the DB. Mirrors the client shape in
  `apps/web/src/inference/beat-the-bot.ts` (`bestCopyPct` / `botCopyPctAtBest`).

## What `20260617000001_leaderboard_schema.sql` creates

| Object | Purpose |
| --- | --- |
| `type tier` | enum `'no-code' \| 'technician' \| 'general' \| 'extra'` — mirrors `Tier['id']`. Value order = easiest→hardest, so "highest tier reached" sorts on the enum. |
| `table profiles` | `id` (FK `auth.users`), `call_sign`, `verified`, `created_at`. One row per claimed callsign. |
| `table bests` | PK `(user_id, tier)`. `best_copy_pct`, `bot_copy_pct_at_best`, `updated_at`. The published copy of local bests. |
| RLS policies | Both tables: **public read**, **write-your-own-only** (`= auth.uid()`). |
| `function publish_best(...)` | Upsert-on-improve RPC with a **DB-side improve guard** — a stale/replayed push can never lower a published best. Clients call this, not a raw upsert. |
| `view leaderboard` | Public, **long format** (one row per operator+tier): `call_sign, verified, tier, best_copy_pct, bot_copy_pct_at_best, updated_at`. `security_invoker` so it enforces the caller's RLS. App pivots client-side. |

### Why these specific choices

- **Enum tier**, not text+check — license classes are stable; the enum order
  gives free tier sorting.
- **Composite PK `(user_id, tier)`** — natural upsert, one row per tier per user.
- **DB-side improve guard** — localStorage is canonical and the client only
  pushes real improvements, but the guard makes sync **idempotent + replay-safe**
  so the outbox queue (slice 4) and multi-device play can never regress a best.
- **Case-insensitive callsign uniqueness** via `unique index on upper(call_sign)`
  — app always inserts uppercase, but `W4GIT` / `w4git` can't both be claimed.
- **`verified` is a boolean in the view, not extra columns** — the UI renders a
  shield icon from the flag.
- **`beatCount` is NOT synced** — local flavor, not leaderboard data.

## ⚠️ One decision deferred to slice 5 (flagged, not yet shipped)

`verified` must be set **only** by the verify Edge Function (slice 5), never by
the client. But the "update own profile" RLS policy lets a user update their own
row — including `verified`. The fix is a **column-level revoke**, left
**commented** in the migration:

```sql
revoke update (verified) on public.profiles from authenticated, anon;
```

The Edge Function uses the **secret** key (`sb_secret_…`), which bypasses RLS +
column grants, so it can still flip `verified`. Uncomment when slice 5 lands (or
swap for a trigger). **Until then, `verified` is client-writable** — fine
pre-launch, must close before the leaderboard is public with a verification
story.

## Client env vars (set these for slice 3)

`apps/web` reads these `VITE_`-prefixed (and therefore public-by-design) vars:

```
VITE_SUPABASE_URL=https://qhmtjowsknqjkoieqxqk.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_………
```

- **Local dev:** put them in `apps/web/.env.local` (gitignored via `*.local`).
- **Prod:** prefer Netlify → Environment variables over committing to
  `.env.production`. Both values are public (RLS protects data), but keeping them
  out of git is cleaner.
- **Secret key (`sb_secret_…`):** never here, never `VITE_`-prefixed. Slice 5
  only, via `supabase secrets set`.

Find both in the dashboard: Settings → API Keys (publishable + secret) and the
Project URL.

## Applying (when you're ready — not now)

### 0. Remove the superseded migration filename

An earlier draft was written as `0001_leaderboard_schema.sql`; it's been renamed
to the CLI-native timestamp form. **Delete the old one** so `db push` doesn't try
to apply both (the second would fail on "type tier already exists"):

```bash
rm apps/web/supabase/migrations/0001_leaderboard_schema.sql
```

### 1. One-time CLI setup

There is no `config.toml` / `supabase init` yet — this dir is just `migrations/`.
First time:

```bash
cd apps/web                     # or wherever the supabase root ends up living
supabase init                   # creates supabase/config.toml
supabase link --project-ref qhmtjowsknqjkoieqxqk
# paste the DB password when prompted (stored in your password manager)
```

If anything already exists in the remote DB (e.g. you poked the SQL editor),
baseline it first so history doesn't diverge:

```bash
supabase db pull                # captures current remote state as a migration
```

On a clean project this returns nothing — skip it.

### 2. Push

```bash
supabase db push                # applies migrations/*.sql not yet recorded
```

`db push` tracks applied versions in the remote `supabase_migrations.schema_migrations`
table (keyed by the filename's timestamp prefix) and only runs what's missing.
**Once a migration is pushed, treat it as immutable** — never edit an applied
file; add a new migration instead.

Alternative (no CLI): paste the SQL into the dashboard SQL editor and run. Still
commit the file as the source of truth.

## Verifying after apply (smoke checks)

```sql
-- enum present
select unnest(enum_range(null::public.tier));

-- RLS on
select relname, relrowsecurity from pg_class
where relname in ('profiles', 'bests');

-- improve guard: second, lower push is a no-op (run as an authed user)
select public.publish_best('technician', 88, 94);
select public.publish_best('technician', 70, 99);  -- should NOT change the row
select * from public.bests where tier = 'technician';

-- leaderboard reads
select * from public.leaderboard order by tier, best_copy_pct desc;
```

## Not in this slice

- **No auth flow / callsign claim UI** — slice 3.
- **No client sync / outbox queue** — slice 4 (calls `publish_best`).
- **No verify or badge Edge Functions** — slices 5–6 (`functions/` dir, TBD).
- **No seed data.**
