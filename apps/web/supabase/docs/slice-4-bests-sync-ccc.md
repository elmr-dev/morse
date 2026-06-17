<!--
SPDX-FileCopyrightText: 2026 Mark Percival, John Schult

SPDX-License-Identifier: AGPL-3.0-or-later
-->

# CCC — Slice 4: bests → cloud sync (reconcile-from-canonical, no queue)

## Context

Slices 1–3 are live: canonical local bests in `morse:btb:bests`
(`apps/web/src/inference/beat-the-bot.ts`), a Supabase schema with a
`publish_best(p_tier, p_best_copy_pct, p_bot_copy_pct_at_best)` RPC that is
**idempotent + improve-guarded** (a lower/equal push is a server-side no-op), and
auth via `useAuth()` exposing `status: 'loading' | 'signed-out' |
'needs-callsign' | 'ready'`. This slice is the bridge: publish a signed-in user's
local bests to the cloud and pull the cloud's per-tier maxima back, so the
public leaderboard (later) reflects reality and multi-device play converges.

**Architecture decision — RECONCILE, NOT A QUEUE.** Do NOT build an outbox
queue. Canonical truth is already `morse:btb:bests`. Because `publish_best` is
idempotent and improve-guarded, "push every non-null local best on each trigger"
is inherently safe and self-healing — re-pushing an unchanged best is a no-op,
so there is nothing "dirty" to track. With only 4 tiers, bests-only, this is
strictly simpler and has fewer failure modes than a queue. The reconcile is
bidirectional: push local→cloud (per tier), pull cloud→local taking the max per
tier (so a device shows the account's true best, not just its own).

**This supersedes the "outbox queue" language in earlier design notes** — the
queue was a means to idempotent-safe sync, and the improve-guard already
provides that. Same intent, less machinery.

## Hard scope boundary

- ONLY local↔cloud bests reconcile. No leaderboard UI, no QRZ verify, no badge.
- Gameplay NEVER awaits or fails on the network. Sync is fire-and-forget in the
  background; a failed/absent network leaves local untouched and canonical.
- Anonymous play unchanged. Sync only runs when `status === 'ready'` (signed in
  AND callsign claimed). Signed-out or needs-callsign → sync is fully inert.
- Do NOT alter the COOP/COEP isolation. Verify `crossOriginIsolated === true`
  after. The sync is a cross-origin fetch to Supabase (fine); add no headers/
  build/CORS config.

## Off-limits (do not touch)

`vite.config.ts`, `public/_headers`, `optimizeDeps`, `src/inference/` EXCEPT you
may ADD pure helpers to `beat-the-bot.ts` if needed (see Step 1). Do not modify
`decode.ts`/`dual-decode.ts`/`pipeline.ts`/`onnx.ts`/`generate.ts`/`dsp.ts`/
`callsign.ts`/`constants.ts`. Do not change the schema (slice 2 is applied).

---

## Step 1 — Reconcile primitives (pure, in `beat-the-bot.ts`)

Add to `apps/web/src/inference/beat-the-bot.ts` (it already owns `Bests`,
`TierRecord`, `TIERS`, `EMPTY_BESTS`, `isBests`):

```ts
/** A single tier's publishable row — the shape publish_best takes. */
export interface PublishableBest {
  tier: Tier['id'];
  bestCopyPct: number;       // 0–100
  botCopyPctAtBest: number;  // 0–100
}

/**
 * The local bests that are worth publishing: tiers with a non-null bestCopyPct.
 * botCopyPctAtBest may be null on a best set before slice 1's freeze shipped (or
 * any legacy/edge row) — coerce a null bot value to 0 so the row is still
 * publishable and honest-ish (0 = "unknown/none", never blocks the human's %).
 */
export function publishableBests(bests: Bests): PublishableBest[] {
  const out: PublishableBest[] = [];
  for (const t of TIERS) {
    const r = bests[t.id];
    if (r.bestCopyPct !== null) {
      out.push({
        tier: t.id,
        bestCopyPct: r.bestCopyPct,
        botCopyPctAtBest: r.botCopyPctAtBest ?? 0,
      });
    }
  }
  return out;
}

/**
 * Merge cloud rows into local bests, taking the higher bestCopyPct per tier.
 * When the cloud's best is higher, adopt its bot pairing too (so You/Bot stays
 * the pair from the round that actually set the winning best). beatCount is
 * LOCAL-ONLY and never touched here. Returns a new Bests (pure).
 */
export function mergeCloudBests(
  local: Bests,
  cloud: { tier: Tier['id']; bestCopyPct: number; botCopyPctAtBest: number }[]
): Bests {
  const next: Bests = structuredClone(local);
  for (const row of cloud) {
    const cur = next[row.tier];
    if (cur.bestCopyPct === null || row.bestCopyPct > cur.bestCopyPct) {
      next[row.tier] = {
        bestCopyPct: row.bestCopyPct,
        botCopyPctAtBest: row.botCopyPctAtBest,
        beatCount: cur.beatCount, // local-only, preserved
      };
    }
  }
  return next;
}
```

Add unit tests in the existing `beat-the-bot.test.ts` (or create it if absent —
check; slice 1 added `applyRound` tests somewhere, co-locate with those):
- `publishableBests` skips null-bestCopyPct tiers, coerces null bot → 0.
- `mergeCloudBests` adopts a higher cloud best (incl. its bot pairing), ignores a
  lower cloud best, leaves `beatCount` untouched, and handles a local-null tier.

## Step 2 — The sync module (`src/lib/bests-sync.ts`)

A small, framework-light module the hook drives. No React here — pure async
functions taking the supabase client + data, so they're unit-testable.

```ts
import { supabase } from './supabase';
import {
  type Bests,
  mergeCloudBests,
  publishableBests,
  type Tier,
} from '../inference/beat-the-bot';
```

Functions:

- `async function pushBests(bests: Bests): Promise<void>` — for each
  `publishableBests(bests)` row, call
  `supabase.rpc('publish_best', { p_tier, p_best_copy_pct, p_bot_copy_pct_at_best })`.
  Run them with `Promise.allSettled` (one tier failing must not abort the rest).
  Swallow/log errors — never throw to the caller. No-op if `!supabase`.
  (4 calls max. The server improve-guard makes each idempotent.)

- `async function pullBests(): Promise<{ tier: Tier['id']; bestCopyPct: number; botCopyPctAtBest: number }[]>`
  — read the CURRENT user's own rows:
  `supabase.from('bests').select('tier, best_copy_pct, bot_copy_pct_at_best')`.
  (RLS scopes select to readable rows, but `bests` is public-read, so filter to
  the user explicitly: `.eq('user_id', userId)` — pass `userId` in, OR rely on a
  `.select()` after an `auth.getUser()`; simplest is to accept `userId` as a
  param.) Map snake_case → camelCase. Return `[]` on error or `!supabase`.

- `async function reconcile(local: Bests, userId: string): Promise<Bests>` — the
  orchestrator: `await pushBests(local)`, then `const cloud = await pullBests(userId)`,
  then `return mergeCloudBests(local, cloud)`. Push-before-pull so the cloud
  reflects this device's improvements before we read maxima back. Returns the
  merged local (caller persists it). Never throws.

Decide `userId` plumbing: `pullBests`/`reconcile` take a `userId: string` param
(the caller has it from `useAuth().user.id`). Cleaner than re-fetching the user
inside the module.

## Step 3 — The hook (`src/lib/use-bests-sync.ts`)

`useBestsSync(bests, setBests)` — wires reconcile to triggers. Mounted once,
high in the tree (see Step 4). Signature takes the canonical bests state +
setter (the same `usePersistedState` pair the page uses) so a pull can write
merged results back to localStorage, and a push reads the latest.

Behavior:

- Read `useAuth()` → `status`, `user`.
- A sync runs ONLY when `status === 'ready'` and `user` is non-null. Otherwise
  fully inert (no listeners firing reconciles, no calls).
- Maintain a ref to the latest `bests` so trigger handlers always push current
  data without re-subscribing on every best change.
- An internal `runReconcile()`:
  - guard: `status === 'ready'`, `user`, `supabase` all present, else return.
  - guard against overlap: a `runningRef` boolean so two triggers can't reconcile
    concurrently (skip if already running).
  - `const merged = await reconcile(bestsRef.current, user.id); setBests(merged);`
  - The `setBests` is safe even if merged === structurally-equal; `usePersistedState`
    re-writes localStorage but that's harmless. (If you want to avoid a redundant
    write, shallow-compare and skip — optional, not required.)
- **Triggers** (all gated on ready):
  - **sign-in / becoming ready**: an effect keyed on `status` — when it flips to
    `'ready'`, run a reconcile (this is the "one-time push of existing local
    bests on sign-in" + initial pull).
  - **online**: `window.addEventListener('online', …)` → reconcile.
  - **foreground**: `document.addEventListener('visibilitychange', …)` → when
    `document.visibilityState === 'visible'`, reconcile. THIS is the iOS
    workhorse (Background Sync is unsupported there; visibilitychange covers
    "played offline, reopened the app"). Write a comment saying so.
  - Clean up all listeners on unmount / when leaving ready.
- Do NOT add a `setInterval`/polling trigger (rejected anti-pattern — burns
  battery, no gain over visibilitychange).
- Background Sync (SW `SyncManager`) is explicitly NOT in this slice — it's an
  Android-only future enhancement layered on the SW (which doesn't exist yet).
  Leave a one-line comment noting that the online+visibility+sign-in triggers
  are the cross-platform baseline.

- **Leaderboard-route trigger**: there's no leaderboard route yet (later slice).
  Do NOT invent one. The three triggers above are sufficient for this slice;
  note in a comment that a future leaderboard route should also call a reconcile
  on entry.

## Step 4 — Mount the hook + enqueue the new-best push

Two integration points:

**(a) Mount the reconcile hook.** The hook needs the canonical bests state. That
state currently lives INSIDE `beat-the-bot-page.tsx` via
`usePersistedState<Bests>(BESTS_STORAGE_KEY, EMPTY_BESTS, isBests)`. Two options
— pick the lower-blast-radius one:

- **Preferred:** mount `useBestsSync` INSIDE `beat-the-bot-page.tsx`, passing the
  page's existing `bests`/`setBests`. The page is the only place bests are read/
  written today, so the sync naturally lives there. The triggers (online,
  visibility, sign-in) still fire regardless of which page is mounted — but they
  only fire while the BtB page is mounted. That's an ACCEPTABLE limitation for
  this slice: a user sets bests on the BtB page, so it's mounted when they earn
  one; sign-in reconcile catches anything missed next time they visit. Document
  this.
- If you find the page-scoped lifetime too limiting, the alternative is lifting
  bests into a small context/provider mounted in `main.tsx` so sync runs app-
  wide. That's a bigger change touching the page's state ownership — do NOT do
  it in this slice unless the page-scoped version proves unworkable. Default to
  page-scoped.

**(b) Immediate push on a new best.** In `submitGuess`, you already compute
`newBestFlag` and `userCopyPct`/`botCopyPct` for the round. When `newBestFlag` is
true AND the sync hook is active (`status === 'ready'`), trigger an immediate
reconcile/push so a fresh best publishes promptly rather than waiting for the
next trigger. Expose a `syncNow()` callback from `useBestsSync` and call it
(fire-and-forget, not awaited — gameplay must not block) right after `setBests`
in the new-best branch. `syncNow()` is a no-op when not ready. Do NOT await it,
do NOT let it throw into `submitGuess`.

## Step 5 — Tests

- `beat-the-bot.test.ts`: the `publishableBests` / `mergeCloudBests` cases (Step 1).
- `bests-sync.test.ts`: mock `supabase` (the rpc + from().select() chain).
  - `pushBests` calls `publish_best` once per non-null tier with snake_case
    params; a rejecting tier doesn't abort the others (allSettled).
  - `pullBests` maps snake_case→camelCase; returns `[]` on error.
  - `reconcile` pushes then pulls then merges (assert order: push resolves before
    pull is called); returns the merged bests; never throws when supabase errors.
  - `!supabase` → pushBests/pullBests/reconcile are inert ([], no throw).
- `use-bests-sync.test.tsx`: with a mocked `useAuth` returning `ready` + a user,
  assert reconcile fires on mount-into-ready, on a dispatched `online` event, and
  on `visibilitychange`→visible; assert it does NOT fire when status is
  `signed-out`/`needs-callsign`; assert `syncNow()` is inert when not ready.
- Keep the existing BtB page tests green — the new-best `syncNow()` call must be
  fire-and-forget and not change any existing assertion (mock `useBestsSync` in
  the page test so it's a no-op there).

## Verification gate (must pass — do NOT auto-commit)

1. `cd /Users/johnschult/code/morse`
2. `bunx turbo check typecheck build test --filter=morse-web`
   - Biome clean (SPDX headers on new files; no unused imports).
   - knip clean (new exports are used; if `pushBests`/`pullBests` are only used
     via `reconcile`, either keep them exported for tests or mark appropriately —
     knip must pass).
   - typecheck, build, all tests green.
3. `bun run dev`, signed in as a claimed callsign (W4GIT), then manually:
   - Play a round, set a NEW best → within a moment a row appears/updates in the
     Supabase `bests` table editor for your user (`tier`, `best_copy_pct`,
     `bot_copy_pct_at_best`). A worse subsequent round does NOT lower it (improve
     guard).
   - Manually bump a `best_copy_pct` higher in the Supabase table editor, then
     background/foreground the tab (or toggle offline→online) → the local tier
     card pulls UP to the cloud value (bidirectional reconcile).
   - Signed OUT: play and set bests → nothing hits the network, no `bests` rows
     written (anonymous stays local-only).
   - `crossOriginIsolated === true` on `/beat-the-bot`.
   - Anonymous play on `/decode` + `/beat-the-bot` unchanged, no console errors
     from the sync layer.

## Out of scope (NOT in this slice)

- No leaderboard page/query (later) — but leave the comment noting it should
  trigger a reconcile on entry.
- No QRZ verify (slice 5), no badge (slice 6).
- No outbox queue, no Background Sync, no `setInterval` polling.
- No lifting bests into app-wide context unless page-scoped proves unworkable
  (default: page-scoped).
- `beatCount` is never synced — local-only, preserved across merges.
