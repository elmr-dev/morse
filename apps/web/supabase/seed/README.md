<!--
SPDX-FileCopyrightText: 2026 Mark Percival, John Schult

SPDX-License-Identifier: AGPL-3.0-or-later
-->

# MORSE — dev seed (leaderboard test data)

⚠️ **DEV / STAGING ONLY.** Requires the **secret** key (`sb_secret_…`). Never run
against production. Never commit the key.

## Use `seed.ts` (the script). Ignore the `.sql` files.

The raw-SQL seed (`seed_btb_leaderboard.sql` / `…_teardown.sql`) is **dead** —
it can't create valid `auth.users` rows portably, so the `profiles` FK insert
fails. Use the TypeScript script instead, which creates real, FK-valid auth
users via the Admin API. The `.sql` files are kept only for reference; do not run
them.

## Seed 50 synthetic operators

```bash
SUPABASE_URL=https://qhmtjowsknqjkoieqxqk.supabase.co \
SUPABASE_SECRET_KEY=sb_secret_xxxxxxxx \
bun apps/web/supabase/seed/seed.ts
```

Find the secret key in the Supabase dashboard → Settings → API Keys (the
`sb_secret_…` one, blurred behind a reveal). It's the same key slice 6's Edge
Function will use. Don't put it in any committed `.env` — pass it inline as above,
or export it in your shell for the session.

## Tear down (before launch, or any time)

```bash
SUPABASE_URL=… SUPABASE_SECRET_KEY=… bun apps/web/supabase/seed/seed.ts --teardown
```

Deletes every user with an `@seed.morse.invalid` email; `ON DELETE CASCADE`
removes their profiles + bests. `.invalid` is a reserved TLD — it can never
collide with a real signup, so teardown is exact.

## What it creates

50 operators, realistic callsigns, ~40% verified (both shield states). Bests
distribution:

| Tier | Operators | Why |
| --- | --- | --- |
| Technician | all 50 | 50 rows → pagination + "outside top 25" pin fire |
| No-Code | first 20 | dense-ish second tier |
| General | first 12 | mid |
| Extra | first 6 | a handful in all 4 tiers |

Operators 1–6 have bests in **all four tiers** — these are the ones that expose
the **All-view rank/dedup question**: open the leaderboard's All segment and
check whether a multi-tier operator appears once or per-tier, and whether the
pinned `You · #N` rank is contiguous (no gap from their hidden lower-tier rows).

## Smoke checks after seeding

```sql
-- Technician should have 50 rows
select count(*) from public.btb_leaderboard where tier = 'technician';

-- Per-tier ranks dense from 1
select tier, min(tier_rank_pos), max(tier_rank_pos), count(*)
  from public.btb_leaderboard group by tier order by tier;

-- THE KEY ONE — a 4-tier operator's All-view ranks (op #1 = op01@…):
select call_sign, tier, best_copy_pct, tier_rank_pos, all_rank_pos
  from public.btb_leaderboard
  where call_sign = (select call_sign from public.profiles p
                     join auth.users u on u.id = p.id
                     where u.email = 'op01@seed.morse.invalid')
  order by all_rank_pos;
```

## Notes

- The script is re-runnable (idempotent): existing seed users are looked up and
  their profiles/bests upserted, so a second run won't duplicate or error.
- These accounts can't really log in (random unknown password). They exist only
  to own leaderboard rows, which the app only reads.
- `@supabase/supabase-js` is already a dependency (added in slice 3), so no
  install needed.
