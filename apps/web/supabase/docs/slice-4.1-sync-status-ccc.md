<!--
SPDX-FileCopyrightText: 2026 Mark Percival, John Schult

SPDX-License-Identifier: AGPL-3.0-or-later
-->

# CCC — Slice 4.1: "synced as W4GIT / saved on this device" affordance

## Context

Slice 4 shipped bests→cloud sync with policy A: localStorage is canonical and
sign-out does NOT touch it. That's correct, but it leaves a UX gap — a user can't
tell whether the tier numbers they're looking at are syncing to their account or
are just local. This adds a single quiet status line so the state is legible.
No data-behavior change; this is purely an indicator.

## The states (read `useAuth().status` + `profile`)

One line, rendered between the `TierRow` and the `border-t` divider in
`beat-the-bot-page.tsx`. Four cases:

- **`ready`** (signed in + callsign claimed): `Synced as {profile.call_sign}` with
  a small cloud/check icon. Muted text; the callsign slightly emphasized
  (foreground or a tier-neutral accent — match the existing `text-foreground`
  on a muted line, like the SpecPill two-tone idiom). This says: your bests are
  published to the leaderboard as this call.
- **`signed-out`**: `Saved on this device · ` + a `Sign in to sync` link to
  `/account`. The "saved on this device" half is the key copy — it tells the user
  their bests live locally regardless of auth (so signing out never loses them),
  resolving the "did sign-out wipe my scores?" confusion. The link frames auth as
  additive (publish to the leaderboard), not as owning the data.
- **`needs-callsign`** (signed in, no callsign yet): `Claim a callsign to sync` →
  link to `/account`. Sync can't run without a claimed call.
- **`loading`**: render nothing (avoid a flash); it resolves to one of the above
  within a tick.

When `!isAuthConfigured` (no Supabase env), treat as `signed-out` — but you may
omit the "Sign in to sync" link if accounts aren't enabled (a plain "Saved on
this device" with no link is fine, since /account would just say "accounts aren't
enabled"). Pick one; keep it from dangling a link that goes nowhere useful.

## Implementation

Prefer a small dedicated component `src/components/sync-status.tsx` (keeps the
page from growing another inline sub-component, and it's independently testable).
It reads `useAuth()` itself — no new props threaded through the page. The page
just renders `<SyncStatus />` in the slot.

- Icon: lucide. `CloudCheck` if available in the installed lucide version, else
  `Check` / `CloudUpload` — pick one that exists (check lucide-react@1.17.0).
  Keep it `size-3.5`, muted.
- Layout: a centered or left-aligned single line, `text-[12px]
  text-muted-foreground`, matching the quiet-metadata tone already used on the
  page (see the SpecPill / helper-line styling). Not a card, not a banner — a
  caption.
- Links go to `/account` via `NavLink` (react-router) — same pattern as the
  nav's account entry. Use the muted→foreground hover treatment consistent with
  other inline links on the site.
- The line must be unobtrusive: it's metadata about the row above it, not a
  call-to-action competing with the play button. No background, no border.

Placement in `beat-the-bot-page.tsx`:

```tsx
<TierRow … />
<SyncStatus />                 {/* new */}
<div className="border-t border-border" />
```

(If `SyncStatus` returns `null` for the `loading` case, the divider must still
sit right under the row — make sure an empty render doesn't leave a gap. A
`null` return collapses cleanly in a flex-col with gap; verify it looks right.)

## Accessibility

- The status line is informational; if it contains a link, the link is a normal
  focusable `<a>`/`NavLink`. No `role` needed.
- The icon is decorative → `aria-hidden`.
- Must not introduce axe violations (the page test runs axe).

## Tests

`src/components/sync-status.test.tsx`, mocking `@/lib/auth`'s `useAuth`:
- `ready` + a profile → renders "Synced as W4GIT", no link to /account.
- `signed-out` → renders "Saved on this device" and a link to `/account`.
- `needs-callsign` → renders "Claim a callsign to sync" linking to `/account`.
- `loading` → renders nothing (`container` empty / no text).
- `!isAuthConfigured` path → "Saved on this device" with no dangling link (per
  the choice above).
- axe clean for the signed-out (link-present) render.

Keep the existing BtB page test green — it mocks `useBestsSync`; it may now also
need to not crash on `<SyncStatus />`. Since `SyncStatus` reads `useAuth`, the
page test must provide an `AuthProvider` wrapper OR mock `useAuth` (the simplest:
mock `@/lib/auth` in the page test so `SyncStatus` gets a deterministic status —
e.g. `signed-out`). Confirm the page test still passes.

## Verification gate (do NOT auto-commit)

1. `cd /Users/johnschult/code/morse`
2. `bunx turbo check typecheck build test --filter=morse-web`
   - Biome/knip/typecheck/build clean; SPDX header on the new file.
   - all tests green incl. the new sync-status tests and the (possibly adjusted)
     page test.
3. `bun run dev`, manually:
   - Signed out on `/beat-the-bot`: the line reads "Saved on this device · Sign
     in to sync"; the link goes to `/account`.
   - Sign in + claim → the line flips to "Synced as W4GIT".
   - Sign out → the line returns to "Saved on this device", and the tier numbers
     DO NOT change (policy A confirmed visually — this is the whole point).
   - `crossOriginIsolated === true` unaffected.

## Out of scope

- No data-behavior change (sign-out still leaves localStorage untouched — A).
- No per-tier-card sync badges (one account-level line, not four).
- No "sign out and clear" option, no shared-browser handling (separate decision,
  deferred).
- Not on Decode or other pages — this line is specific to the bests on
  `/beat-the-bot`. (A future leaderboard page may want its own "you're not
  signed in" affordance; not here.)
