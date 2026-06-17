<!--
SPDX-FileCopyrightText: 2026 Mark Percival, John Schult

SPDX-License-Identifier: AGPL-3.0-or-later
-->

# CCC — Slice 5: Leaderboard page (`/leaderboard`) + sync rename patch

## Context

Migration `0002` renamed the DB objects: `bests → btb_bests`, `leaderboard →
btb_leaderboard` (the `publish_best` RPC name is UNCHANGED; its body now writes
`btb_bests`). This slice (a) patches the client to read the renamed table, and
(b) builds the leaderboard UI: a dedicated `/leaderboard` route reading
`btb_leaderboard`.

**Forward-compatible by design (flavor 2 — clean seams, no speculative
machinery).** The leaderboard may later host multiple "boards" (Trainer,
streaks, …), each with its own table+view in a common row shape. So the page is
a generic SHELL that knows only "a board has optional segments and ranked rows,"
plus ONE board adapter (Beat the Bot) that knows the CW/tier specifics. Do NOT
hardcode tier/CW concepts into the shell. Do NOT build a multi-board registry,
board switcher, or union view yet — there's one board. Just keep the seam clean
so board #2 is an addition, not a rewrite.

## Off-limits

`vite.config.ts`, `public/_headers`, `optimizeDeps`, `src/inference/` (except
reading `beat-the-bot.ts` for `TIERS`/`Tier`). No schema changes (0002 is
applied). Don't break COOP/COEP — verify `crossOriginIsolated === true` after.

---

## Step 0 — Sync rename patch (do FIRST, it's one line + a test)

`src/lib/bests-sync.ts`, `pullBests`:
- `supabase.from('bests')` → `supabase.from('btb_bests')`.
- `pushBests` is UNCHANGED (`rpc('publish_best', …)` — same RPC name).
Update `bests-sync.test.ts` if it asserts the table name string `'bests'` in the
`from` mock → `'btb_bests'`. Re-run sync tests green.

(After this lands the bidirectional pull works again — it was 404ing on the gone
`bests` table in the window since 0002 was applied. Note in the gate to
re-verify a real push+pull round-trip.)

## Step 1 — The common leaderboard row shape (shell contract)

`src/lib/leaderboard.ts` — the generic seam. Defines the shape the shell renders
and the board-adapter interface. No CW specifics here.

```ts
/** One ranked entry, board-agnostic. */
export interface LeaderboardRow {
  callSign: string;
  verified: boolean;
  /** The ranking value, higher = better. Displayed via `format`. */
  score: number;
  /** Pre-formatted display string for `score` (e.g. "88%"). */
  scoreLabel: string;
  /** ISO timestamp of when this entry was set (for an "as of" hint). */
  updatedAt: string;
}

/** A segment within a board (e.g. a tier). Boards with no segments omit this. */
export interface LeaderboardSegment {
  id: string;
  label: string;
  /** Optional accent (CSS color / var) for the segment selector. */
  accent?: string;
  /** Optional one-line context shown above the rows (e.g. the bot's reference). */
  context?: string;
}

/** A board adapter: how to fetch + shape one board's standings. */
export interface LeaderboardBoard {
  id: string;
  label: string;
  /** Segments to sub-divide the board, or undefined for a flat board. */
  segments?: LeaderboardSegment[];
  /** Default segment id to open on (e.g. the viewer's active tier). */
  defaultSegmentId?: string;
  /** Fetch rows for a segment (or the whole board when segmentless), already
   *  sorted best-first. */
  load: (segmentId?: string) => Promise<LeaderboardRow[]>;
}
```

The shell consumes `LeaderboardBoard`; it never imports CW/tier types.

## Step 2 — The Beat the Bot board adapter

`src/lib/leaderboard-btb.ts` — the BtB-specific piece. Imports `TIERS`/`Tier`
from `../inference/beat-the-bot` and `supabase`.

- `segments`: map `TIERS` → `{ id: tier.id, label: tier.name, accent: tier.accent,
  context: … }`. The `context` is the per-tier bot reference, e.g.
  `"The bot copies this tier at NN%"` — BUT the bot's copy % varies per round and
  isn't a fixed per-tier constant in the data (it's `bot_copy_pct_at_best`, frozen
  per operator's best round). So DON'T claim a single bot number per tier. Instead
  make `context` a fixed factual line about the tier's difficulty, e.g. using the
  tier's SNR/WPM: `"{snr} dB · {wpm} wpm — the bot copies the same brutal clip"`.
  (Reuse the `formatSnr` idea; keep it one short line.) Confirm wording with a
  TODO(john) if unsure.
- `defaultSegmentId`: accept it as a param the page passes in (the viewer's
  active tier from `morse:btb:tier` localStorage, or 'technician' fallback) —
  see Step 4. The adapter itself can default to the first tier.
- `load(segmentId)`: query the renamed view:
  ```ts
  supabase.from('btb_leaderboard')
    .select('call_sign, verified, best_copy_pct, updated_at')
    .eq('tier', segmentId)
    .order('best_copy_pct', { ascending: false })
    .order('updated_at', { ascending: true })  // tiebreak: earlier set ranks higher
    .limit(100)
  ```
  Map rows → `LeaderboardRow` (`callSign`, `verified`, `score = best_copy_pct`,
  `scoreLabel = `${best_copy_pct}%``, `updatedAt`). **Human-only** — do NOT select
  or show `bot_copy_pct_at_best` here (that's the badge's job; the board ranks
  operators against each other). Return `[]` on error (never throw).
  - `!supabase` → `load` returns `[]` (page shows the "accounts not enabled" /
    empty state).

Export a factory `beatTheBotBoard(defaultSegmentId?: string): LeaderboardBoard`.

## Step 3 — The generic shell components

`src/components/leaderboard-view.tsx` — renders a `LeaderboardBoard`. Pure
presentation + fetch-on-segment. Props: `{ board: LeaderboardBoard;
ownCallSign: string | null }`.

- If `board.segments`, render a **segment selector** reusing the tier-pill visual
  language from the BtB page's `TierRow` (the rounded pill, accent border on
  active) — but generic: it iterates `board.segments`, not `TIERS`. Active
  segment state lives here, initialized to `board.defaultSegmentId`.
- On segment change (and on mount), call `board.load(segmentId)` → rows. Show a
  loading state (the Loader2 idiom) while fetching; cache per-segment so
  re-selecting doesn't refetch (a simple `Record<segmentId, rows>` in state is
  fine).
- Render the segment's `context` line (if present) above the rows, quiet/muted.
- **Rows**: a ranked list — rank number, call sign (mono), verified shield
  (lucide `ShieldCheck` when `row.verified`, else nothing — NOT a muted shield
  per-row, that's noise; absence = unverified on a list), the `scoreLabel`
  (mono, prominent), and a faint "as of" date is optional (skip if it crowds).
  - **Own-row anchor**: when `row.callSign === ownCallSign`, highlight it
    (accent ring/background, like the active-tier card). AND if the own row is
    outside the visible top-N or just to make it findable, render a pinned copy
    of the viewer's row at the top labeled with their actual rank ("You · #42").
    Compute rank from position in the sorted list. If the viewer has no entry in
    this segment, show a quiet "You haven't ranked here yet" line instead of a
    pinned row.
- **Empty state**: segment with zero rows → a graceful "No entries yet — be the
  first" (not a broken-looking blank). Sparse (1–2 rows) must look intentional.
- Accessibility: the segment selector is a radiogroup (reuse the BtB
  `TextModeToggle`/`TierRow` a11y pattern — role=radio pills); the list is an
  ordered list (`<ol>`); shield icons `aria-hidden` with adjacent text or an
  `aria-label` on the row indicating verified. Must pass axe.

## Step 4 — The page + route

`src/pages/leaderboard-page.tsx`:
- `useDocumentHead({ title: 'Leaderboard', description: '…', path: '/leaderboard' })`.
- Read the viewer's active tier from `morse:btb:tier` localStorage (the BtB page
  persists it) to pass as `defaultSegmentId` — so the leaderboard opens on the
  tier they were last playing. Fallback `'technician'`. (Read it directly; don't
  import the BtB page. A tiny `localStorage.getItem` read is fine, guarded.)
- Build the board: `const board = useMemo(() => beatTheBotBoard(defaultSeg), [defaultSeg])`.
- `ownCallSign` from `useAuth().profile?.call_sign ?? null`.
- **Reconcile-on-open** (the deferred slice-4 hook, now realized): on mount, if
  the viewer is `ready`, fire a reconcile so their latest local best is pushed to
  the cloud BEFORE the board loads — so they see themselves correctly ranked.
  Cleanest: the page imports `reconcile` from `bests-sync` and, when
  `status==='ready'` and `user`, does `await reconcile(localBests, user.id)`
  then loads the board. BUT the page doesn't own the bests state (it lives in the
  BtB page). Simplest correct approach: read `morse:btb:bests` from localStorage
  directly (it's canonical), reconcile with it, and let the board fetch after.
  Read via the same `isBests`-guarded parse the BtB page uses (import `isBests`,
  `BESTS_STORAGE_KEY`, `EMPTY_BESTS` from `beat-the-bot.ts`). Fire-and-forget is
  acceptable too (load board immediately, reconcile in parallel, refetch board
  when reconcile resolves) — but the simplest honest version is: reconcile first
  if ready, then load. Don't block an anonymous viewer on anything.
- Render `<LeaderboardView board={board} ownCallSign={ownCallSign} />`.
- **Public**: works fully for anonymous/signed-out viewers (the view is
  public-read). No auth gate. A signed-out viewer just has `ownCallSign = null`
  (no anchor). Optionally a quiet "Sign in to claim your spot" line linking to
  `/account` for signed-out viewers — nice, not required.

Route in `app.tsx`: `<Route path="/leaderboard" element={<LeaderboardPage />} />`.

## Step 5 — Nav entries

- **Desktop header** (`site-nav.tsx`): add Leaderboard to `NAV_ITEMS` (it's a
  primary destination now) — icon e.g. lucide `Trophy` or `BarChart3`. It'll
  appear in the desktop link row. (4 links is fine on desktop.)
- **Mobile**: the bottom bar is full (Home/Decode/Beat the Bot/FAQ + More in
  standalone). Do NOT add a 5th/6th bottom tab. Instead add a **Leaderboard row
  to the `MoreSheet`** (`more-sheet.tsx`) using the existing `rowClass` idiom —
  `NavLink to="/leaderboard"` with the same icon. 
  - NOTE: adding Leaderboard to `NAV_ITEMS` will also try to put it in the mobile
    bottom bar (which renders `NAV_ITEMS`). Check `site-nav.tsx`'s `MobileTabBar`
    — if it renders all of `NAV_ITEMS`, adding a 4th makes the bar 5 route tabs +
    More = 6 slots, too many. So EITHER keep Leaderboard out of `NAV_ITEMS` and
    add it only to the desktop nav + MoreSheet, OR split the desktop nav list
    from the mobile-tab list. Simplest: a separate constant for the desktop-only
    extra, and a MoreSheet row for mobile. Pick the approach that keeps the
    mobile bar at its current slot count. Verify the bar isn't overcrowded.
- **"View standings" link from the BtB page**: add a small, quiet link near the
  `TierRow` (or just under the `SyncStatus` line) — `NavLink to="/leaderboard"`,
  e.g. "View standings →". Unobtrusive, muted, matches the SyncStatus tone. This
  is the play→rank path.

## Step 6 — Tests

- `bests-sync.test.ts`: updated table-name assertion (`btb_bests`).
- `leaderboard-btb.test.ts`: `load` queries `btb_leaderboard` filtered by tier,
  ordered desc, maps to `LeaderboardRow` (human-only — assert `bot_copy_pct` is
  NOT in the select), returns `[]` on error / no supabase.
- `leaderboard-view.test.tsx` (mock a `LeaderboardBoard`):
  - renders the segment selector from `board.segments`; switching segment calls
    `load(segmentId)` and renders its rows.
  - renders rank numbers, call signs, `scoreLabel`, and a shield only on verified
    rows.
  - own-row highlight when `ownCallSign` matches; pinned "You · #N" when present;
    "you haven't ranked here yet" when the viewer has no row.
  - empty segment → "be the first" state.
  - axe clean.
- `leaderboard-page.test.tsx`: renders for a signed-out viewer (ownCallSign null,
  no anchor, no crash); for a `ready` viewer triggers reconcile-on-open (mock
  `reconcile`); reads default segment from `morse:btb:tier`.
- Existing BtB page test stays green (the new "View standings" link must not
  break it; it mocks auth/sync already).

## Verification gate (do NOT auto-commit)

1. `cd /Users/johnschult/code/morse`
2. `bunx turbo check typecheck build test --filter=morse-web` — biome/knip/
   typecheck/build/tests all green; SPDX headers on new files.
3. `bun run dev`:
   - **Sync round-trip restored**: signed in, set a new best → row updates in
     Supabase `btb_bests`; the pull works again (bump a row higher in the table
     editor, foreground → local pulls up). (Confirms Step 0 fixed the 404 window.)
   - `/leaderboard` loads for an ANONYMOUS viewer, shows the per-tier segments,
     ranked human-only rows, verified shields where applicable, graceful empty
     states on sparse tiers.
   - Signed in as W4GIT: your row is highlighted/anchored; opening the page
     reconciled your latest best up first (you appear at the right rank).
   - Segment switch changes the tier board; default segment matches your last-
     played tier.
   - Desktop header shows Leaderboard; mobile shows it in More (bottom bar NOT
     overcrowded); BtB page has a "View standings" link.
   - `crossOriginIsolated === true` on `/leaderboard`.

## Out of scope

- No multi-board registry / board switcher / union view (one board; flavor 2).
- No QRZ verify (slice 6) or badge (slice 7) — but the verified shield renders
  from the existing boolean (all false until slice 6).
- No head-to-head/bot column on the board (human-only; bot is the badge's job).
- No new bottom tab.
- `bot_copy_pct_at_best` is intentionally NOT read by the board.
