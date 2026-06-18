<!--
SPDX-FileCopyrightText: 2026 Mark Percival, John Schult

SPDX-License-Identifier: AGPL-3.0-or-later
-->

# CCC — Slice 7: QRZ standings badge (dynamic SVG Edge Function)

## Context

The final piece of the leaderboard/identity arc: a dynamic SVG badge an operator
embeds as an `<img>` on their public QRZ profile. It shows their MORSE standing —
a growth/distribution loop (other hams see a live scoreboard on a QRZ page → come
try MORSE). A second Supabase Edge Function, sibling to `qrz-verify`.

This is the LAST planned slice of this arc. After it: the leaderboard, accounts,
QRZ verification, and the badge are all shipped.

## Locked design (decided — do not relitigate)

**Endpoint.** A new public Edge Function, e.g. `morse-badge`, served at a
callsign-addressable URL like `…/functions/v1/morse-badge?call=W4GIT` (or a path
form `/morse-badge/W4GIT.svg` if cleaner in Deno routing — either is fine; query
param is simplest). Returns `content-type: image/svg+xml`. PUBLIC — no auth (it's
hit by `<img>` from QRZ pages and crawlers). Carries NO token (fully decoupled
from verification).

**Layout — wide banner, ~320×80** (the mockup John picked):
- Left block: MORSE wordmark + the real favicon glyph (inlined — see below);
  the callsign LARGE; a purple verified shield inline by the callsign WHEN
  verified; the tier name as a small pill/label underneath.
- Right block: STACKED stats, larger numerals — `YOU nn%` above `BOT nn%`. "You"
  is the hero (bright), "Bot" muted. (Colors below.)

**Row rule — HIGHEST TIER REACHED.** The badge headlines the operator's hardest
tier reached (order: extra > general > technician > no-code), showing that tier's
`best_copy_pct` as "You" and that same row's `bot_copy_pct_at_best` as "Bot".
NOT highest copy %. Tier is the identity/claim; the percentages are the detail.
(Rationale is settled — tier is self-contained and on-theme; the badge honestly
shows the human operating in the hard regime, bot-wins-visibly is accepted.)

**Gating — ANY claimed callsign, verified or not.** The badge renders for any
callsign that has a profile + at least one bests row. Verification only adds the
SHIELD, it does not gate the badge. (Gating would throttle adoption and is
circular — verifying requires editing the QRZ bio.)

**Rendering — dynamic per request + Cache-Control.** Render fresh each request;
set `Cache-Control: public, max-age=300` (5 min) so CDN/browser cache absorbs
repeat profile views. NOT prerender-to-Storage (YAGNI; revisit only if load
demands).

**Color — constant MORSE palette, fixed (not theme-switching).** The badge is
always the dark MORSE panel (`#0F0F1A`) with the purple glyph — it does NOT adapt
to the viewer's QRZ light/dark theme (it's an image on an unknown background;
pick one self-contained look). Tier shown in its accent color (the pill only).

## Off-limits

`vite.config.ts`, `public/_headers`, `optimizeDeps`, `src/inference/` (read
`beat-the-bot.ts` for `TIERS` only). The decode path. The `qrz-verify` function
(this is a NEW sibling function; don't modify the verify one).

---

## Step 1 — Brand + tier palette, resolved to hex (in the function's `pure.ts`)

CRITICAL: the app defines tier/you/bot colors as **theme-dependent OKLCH CSS
variables** (`src/index.css`). The Edge Function renders SVG server-side — no CSS
vars, and `oklch()` in an SVG `fill` is unreliable in a sandboxed QRZ `<img>`
renderer. So the badge needs a FIXED HEX palette baked in. Define it in
`supabase/functions/morse-badge/pure.ts` as a small table, documented as "the
in-app colors resolved to hex for server-side SVG; keep in visual sync with
src/index.css".

Brand (from `public/favicon.svg`, exact):
- panel bg `#0F0F1A`, glyph purple `#A48FFF`, glyph pink `#FF79C6`
- MORSE wordmark + callsign text `#FFFFFF`
- verified shield `#A48FFF` (MORSE purple — matches the leaderboard shield)

You / Bot (the app uses blue "You" / orange "Bot" — match it so the badge looks
like in-app, NOT the teal/gray from the rough mockup):
- You (hero) — blue, approx `#7FB2F2` (resolve from dark `--you`
  `oklch(0.72 0.15 252)`)
- Bot (muted) — a muted warm/orange-gray, approx `#C08A5E` or a desaturated gray
  `#9A958C` (John: confirm whether Bot reads better as muted-orange to match the
  app's orange `--bot`, or as neutral gray for "lesser"; default to muted-orange
  to match in-app identity). TODO(john): eyeball.

Tier accents (resolve from the DARK-theme tier vars in src/index.css):
- no-code — cyan/teal `oklch(0.72 0.14 195)` → approx `#3FC9C2`
- technician — blue (= `--you`) → approx `#7FB2F2`
- general — purple (= `--primary` dark `oklch(0.7162 0.1597 290)`) → approx `#A48FFF`
- extra — pink `oklch(0.75 0.18 347)` → approx `#F46FB0`

Provide these as exact hex constants. The approximations above are starting
points — Sonnet/John may fine-tune against the in-app swatches. Each tier pill
uses its accent for the border + text, with a low-opacity fill of the same.

## Step 2 — The favicon glyph, inlined

The glyph must be inlined as SVG primitives (NOT `<image href>` to an external
URL — won't render in a sandboxed `<img>`). It's four rects from favicon.svg
(viewBox 0 0 512 512), scale into the badge's top-left ~24–28px box:

```
<rect width=512 height=512 rx=92 fill=#0F0F1A/>   (the panel — or omit, badge bg already dark)
<rect x=106 y=79  width=300 height=150 rx=75 fill=#A48FFF/>
<rect x=79  y=283 width=150 height=150 rx=75 fill=#A48FFF/>
<rect x=283 y=283 width=150 height=150 rx=75 fill=#FF79C6/>
```

Wrap the three lamp rects in a `<g transform="translate(x,y) scale(s)">` to place
+ size them (scale ≈ targetPx/512). Put this in a `glyphSvg()` helper in pure.ts
returning the `<g>…</g>` string, so it's testable and reusable.

## Step 3 — The badge builder (pure, testable)

In `pure.ts`, a pure `renderBadgeSvg(data): string` taking the shaped data and
returning the full `<svg>…</svg>` string. NO Deno/network APIs — so vitest tests
it directly. Input shape:

```ts
interface BadgeData {
  callSign: string;
  tier: 'no-code' | 'technician' | 'general' | 'extra';
  tierName: string;      // 'General'
  youCopyPct: number;    // best_copy_pct at that tier
  botCopyPct: number;    // bot_copy_pct_at_best from that row
  verified: boolean;
}
```

Builder rules:
- Escape the callsign for XML (`&<>"'`) — it's user data going into markup. A
  `escapeXml()` helper, tested. (Callsigns are `[A-Z0-9/]` so low-risk, but
  escape anyway — defense in depth.)
- Round percentages to integers (`Math.round`), clamp 0–100, suffix `%`.
- Font: `font-family="'JetBrains Mono', ui-monospace, monospace"` — JetBrains
  Mono won't load in the QRZ `<img>` sandbox (font-sandboxed, the slice-6
  lesson), so the generic-mono fallback is what actually renders. That's
  ACCEPTED — design for the fallback looking fine, don't rely on JetBrains Mono.
- The verified shield: a small inline shield-check path in MORSE purple, drawn
  next to the callsign, ONLY when `verified`. Hand-draw a simple shield+check
  path (lucide ShieldCheck is a React component, not usable here — replicate the
  silhouette as a small `<path>`). Keep it ~14px.
- Dimensions: viewBox `0 0 320 80` (or the exact size from the chosen mockup).
  Verify all elements fit; no overflow.
- Set `role="img"` + a `<title>` like `"W4GIT — MORSE: General, You 60% / Bot
  80%"` for accessibility (screen readers on the QRZ page).

## Step 4 — The handler (`index.ts`)

Mirror `qrz-verify/index.ts` structure (the `json`/CORS helpers, the esm.sh
supabase import, the Deno.serve shape):
- Accept GET (and OPTIONS for CORS). Reject other methods.
- Read the callsign from `?call=` (or the path). Uppercase it. If missing/empty →
  return a small SVG "no callsign" placeholder (still `image/svg+xml`, 200 or
  400 — a broken `<img>` on a QRZ page looks bad, so prefer a rendered "unknown"
  badge over an error status).
- Use a SERVICE-ROLE client? NO — the badge reads PUBLIC data (profiles +
  btb_bests are public-read under RLS). Use the ANON key client
  (`SUPABASE_URL` + `SUPABASE_ANON_KEY`, both auto-injected). No service-role
  needed (it only reads). This keeps the public endpoint least-privilege.
- Query: join btb_bests → profiles by call_sign (case-insensitive), select tier,
  best_copy_pct, bot_copy_pct_at_best, verified. Pick the HIGHEST tier present
  (order extra>general>technician>no-code) in JS after fetching the operator's
  rows. (Or do it in SQL with an order-by-tier-rank limit 1 — but fetching all
  of one operator's ≤4 rows and picking in JS is trivial and clearer.)
- If the callsign has no profile or no bests → render a "not found" / "no
  standing yet" badge (rendered SVG, not an error) so the `<img>` still shows
  something tasteful. Decide the copy: e.g. the callsign + "no MORSE standing
  yet" — or for an unknown call, a generic MORSE badge inviting play. Keep it
  non-broken.
- Set headers: `content-type: image/svg+xml; charset=utf-8`,
  `Cache-Control: public, max-age=300`, plus CORS `access-control-allow-origin: *`.
- Build the SVG via `renderBadgeSvg(...)` and return it.

Env note (same as slice 6): `SUPABASE_URL` + `SUPABASE_ANON_KEY` are
auto-injected; do NOT set custom `SUPABASE_*` secrets.

## Step 5 — The /account "get your badge" snippet UI

On `/account`, for a `ready` operator (claimed callsign — verified OR not), add a
"Your QRZ badge" section:
- Render a LIVE preview (an `<img>` pointing at the deployed function URL for
  their callsign, OR inline the SVG by calling the same builder client-side —
  simplest is an `<img src={badgeUrl}>` once deployed).
- Show the copy-paste snippet for their QRZ bio. The snippet pairs the verify
  link + the badge image (single paste does both jobs), per the locked pattern:
  ```html
  <a href="https://morse.<domain>/u/W4GIT"><img src="https://<project>.supabase.co/functions/v1/morse-badge?call=W4GIT" alt="W4GIT on MORSE" /></a>
  ```
  - The badge `<img>` carries NO token (decoupled). The `<a href>` can point at a
    public operator page (or just the MORSE site) — if there's no `/u/CALL` page
    yet, link to the leaderboard or site root; do NOT invent a token-bearing URL
    here. (Token-in-href was a FUTURE single-paste idea; for THIS slice the badge
    snippet is just the `<img>`, optionally wrapped in a link to the site. Keep
    it simple: ship the `<img>` snippet; the verify flow is already its own thing
    on /account.)
- A copy button (reuse the token copy-button pattern from slice 6).
- One line of guidance: "Paste this into your QRZ bio to show your MORSE standing.
  It updates automatically as you set new bests."
- Available to any claimed callsign (verified not required) — matches the gating
  decision. (Verified operators' badges show the shield; that's the only diff.)

## Step 6 — Tests

- `morse-badge` pure tests (`src/lib/morse-badge-pure.test.ts`, mirroring
  `qrz-verify-pure.test.ts`): `renderBadgeSvg` contains the callsign, the tier
  name, You/Bot percentages, the shield path only when `verified`, escapes a
  callsign with an XML-special char, rounds/clamps percentages; `glyphSvg`
  returns the three lamp rects; highest-tier selection picks extra over general
  etc.; the "no standing" branch renders a valid SVG.
- Account-page test: the badge section renders for a ready operator (verified and
  unverified), shows the snippet + copy button.
- Keep `supabase/functions/**` excluded from the web tsc/biome/knip (already done
  in slice 6 — confirm the new dir is covered by the same glob).
- All existing tests stay green.

## Verification gate (do NOT auto-commit)

1. `bunx turbo check typecheck build test --filter=morse-web` green.
2. `supabase functions deploy morse-badge`. (No migration this slice — it only
   reads existing tables. No secret to set.)
3. Live:
   - `…/functions/v1/morse-badge?call=W4GIT` returns an SVG; open it in a browser
     → the wide banner renders: glyph, MORSE, W4GIT + purple shield (W4GIT is
     verified), `General` pill, `You 60% / Bot 80%`. Numbers match btb_bests.
   - A seeded UNVERIFIED call (e.g. one of the `@seed.morse.invalid` operators,
     after un-verifying) → renders WITHOUT the shield, with their tier + numbers.
   - An unknown callsign → renders a tasteful "no standing" badge, not a broken
     image / error.
   - Embed it as `<img src=…>` on a test HTML page on a WHITE background and a
     DARK background → the fixed dark panel reads fine on both (it's
     self-contained, doesn't depend on page bg).
   - `/account` shows the badge preview + copy-paste snippet for a claimed
     callsign; copying gives a working `<img>` snippet.
   - Cache-Control header present (`curl -I`).
4. `crossOriginIsolated === true` unaffected on the web app.

## Out of scope

- No `/u/CALL` public operator page (future — the snippet links to site/leaderboard
  for now).
- No token in the badge URL (decoupled, permanent rule).
- No prerender-to-Storage (dynamic + cache only).
- No per-viewer theming (fixed dark panel).
- No LoTW/TQSL, no changes to verification.
