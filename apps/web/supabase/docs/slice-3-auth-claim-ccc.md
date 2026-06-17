<!--
SPDX-FileCopyrightText: 2026 Mark Percival, John Schult

SPDX-License-Identifier: AGPL-3.0-or-later
-->

# CCC — Slice 3: Auth + callsign claim (`/account`), identity only

## Context

The Supabase schema (slice 2) is live: `profiles(id, call_sign, verified,
created_at)` + `bests` + the `publish_best` RPC + a public `leaderboard` view,
all under RLS (public read, write-your-own). This slice adds the **client-side
identity layer**: sign in with a social provider, claim a unique callsign, see
your verified status. Nothing else.

**Hard scope boundary — identity ONLY.** No bests sync, no `publish_best` call,
no leaderboard UI, no QRZ badge, no verify flow. Those are slices 4–6. If you
find yourself touching `morse:btb:bests`, `publish_best`, or the `leaderboard`
view, stop — that's out of scope.

**Auth is OPTIONAL and LAZY.** Anonymous play stays 100% unchanged. A signed-out
user sees and does exactly what they do today on every page. Auth is purely
additive: a new `/account` route and a small entry affordance. Nothing gates
gameplay behind sign-in. Do not add auth checks to Decode or Beat the Bot.

## The real shell (already read — build against this, don't assume)

- Router: `react-router-dom` v7, `<BrowserRouter basename={import.meta.env.BASE_URL}>`
  in `main.tsx`; routes in `app.tsx` (`/`, `/decode`, `/beat-the-bot`, `/faq`,
  plus a `/beat`→`/beat-the-bot` redirect).
- Nav: `SiteHeader` (desktop, hidden in standalone) + `MobileTabBar`
  (mobile/standalone) in `components/site-nav.tsx`. `NAV_ITEMS` drives both.
- Toasts: `sonner` `<Toaster />` is mounted in `main.tsx` — use `toast()` from
  `sonner` for success/error feedback. Already a dependency.
- Per-route head: `useDocumentHead({ title, description, path })` —
  `lib/use-document-head.ts`. Call it in the new page.
- The "More" sheet (`components/more-sheet.tsx`) is a Vaul drawer with a
  `rowClass` idiom; mobile entry to account can live here.
- `@supabase/supabase-js` is NOT installed. The `supabase` CLI is a devDep but
  that's the CLI, not the JS client. This slice adds the client lib.
- Env vars (publishable, public-by-design) come from slice 2's `.env` setup:
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Conventions: SPDX header on every file (see any existing file), Biome
  (check:fix), knip (no dead exports), lefthook pre-commit, tests via vitest +
  testing-library + vitest-axe.

## Off-limits (do not touch)

`vite.config.ts`, `public/_headers`, `optimizeDeps`, anything under
`src/inference/`, the `morse:btb:bests` storage, `beat-the-bot.ts`. Auth must not
alter the COOP/COEP isolation — it's a runtime fetch to Supabase, which is fine,
but do NOT add any header/CORS/build config. Verify `crossOriginIsolated === true`
still holds after.

---

## Step 1 — Install the client

```bash
cd apps/web && bun add @supabase/supabase-js
```

(Pin to the current major; let Bun resolve the latest 2.x.)

## Step 2 — Supabase client singleton

`src/lib/supabase.ts`:

- Read `import.meta.env.VITE_SUPABASE_URL` and
  `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY`.
- If EITHER is missing/empty, the module must NOT throw at import time (that
  would break the whole app for anonymous users when env isn't set). Instead
  export a nullable client: `export const supabase = (url && key) ? createClient(...) : null;`
  and an `export const isAuthConfigured = supabase !== null;`. Every auth
  surface checks `isAuthConfigured` and degrades gracefully (the `/account` page
  shows "accounts aren't enabled in this build" rather than crashing). This keeps
  anonymous play working even with no Supabase env — critical, since auth is
  optional.
- Client options: `{ auth: { detectSessionInUrl: true, persistSession: true,
  autoRefreshToken: true, flowType: 'pkce' } }`. PKCE is the correct flow for a
  public SPA.
- Add a typed shape for the profile row:
  ```ts
  export interface Profile {
    id: string;
    call_sign: string;
    verified: boolean;
    created_at: string;
  }
  ```

Add `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` typing to
`src/vite-env.d.ts` (or wherever `ImportMetaEnv` is declared — check; if there's
no such file, the env is `string | undefined` by default and that's fine, but
prefer typing them if an `ImportMetaEnv` interface already exists).

## Step 3 — Auth context + hook

`src/lib/auth.tsx` (tsx — it provides context):

- `AuthProvider` component wrapping the app (mount it in `main.tsx` ABOVE
  `<App />`, inside `BrowserRouter` so navigation works from auth callbacks).
- On mount: `supabase.auth.getSession()` to hydrate, then subscribe via
  `supabase.auth.onAuthStateChange((_event, session) => …)`. Clean up the
  subscription on unmount.
- When a session exists, fetch the user's profile row:
  `supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()`.
  `maybeSingle()` (not `.single()`) because a freshly-signed-in user has NO
  profile yet — that's the "needs to claim" state, not an error.
- Expose a `useAuth()` hook returning:
  ```ts
  {
    status: 'loading' | 'signed-out' | 'needs-callsign' | 'ready',
    session: Session | null,
    user: User | null,
    profile: Profile | null,
    signIn: (provider: 'google' | 'github' | 'discord') => Promise<void>,
    signOut: () => Promise<void>,
    claimCallsign: (raw: string) => Promise<{ ok: true } | { ok: false; reason: 'taken' | 'invalid' | 'error' }>,
    refreshProfile: () => Promise<void>,
  }
  ```
  - `status` derivation: no session → `signed-out`; session but `profile === null`
    → `needs-callsign`; session + profile → `ready`. `loading` while the initial
    getSession/profile fetch is in flight.
  - If `!isAuthConfigured`, `status` is permanently `signed-out` and `signIn`
    is a no-op that toasts "accounts aren't enabled."
- `signIn(provider)`: `supabase.auth.signInWithOAuth({ provider, options: {
  redirectTo: \`${window.location.origin}${import.meta.env.BASE_URL}account\` } })`.
  Redirect back to `/account` so the claim flow picks up right there.
- `signOut()`: `supabase.auth.signOut()`; toast confirmation.
- `claimCallsign(raw)`:
  - Normalize: `const call = raw.trim().toUpperCase();`
  - Validate client-side against the same shape the DB enforces:
    `/^[A-Z0-9/]{1,10}$/`. Invalid → return `{ ok: false, reason: 'invalid' }`
    (no network call).
  - Insert: `supabase.from('profiles').insert({ id: user.id, call_sign: call })`.
  - On unique-violation (Postgres error code `23505`, from the
    `upper(call_sign)` index) → `{ ok: false, reason: 'taken' }`.
  - Any other error → `{ ok: false, reason: 'error' }`.
  - Success → `await refreshProfile()` then `{ ok: true }`. The status flips to
    `ready` and the UI reflects the claimed call.

## Step 4 — `/account` page

`src/pages/account-page.tsx`. Single combined sign-in → claim flow (one flow, per
the decision). `useDocumentHead({ title: 'Account', description: '…', path:
'/account' })`. Render by `status`:

- **`loading`** — a spinner/skeleton (reuse the existing Loader2 idiom).
- **`signed-out`** — a stack of provider sign-in buttons, driven off an array so
  providers are trivial to add/remove later:
  ```ts
  const PROVIDERS = [
    { id: 'google',  label: 'Continue with Google',  icon: … },
    { id: 'github',  label: 'Continue with GitHub',  icon: GithubIcon },
    { id: 'discord', label: 'Continue with Discord', icon: … },
  ] as const;
  ```
  GitHub already has `GithubIcon` in `components/github.tsx`. Google and Discord
  have no Lucide glyphs (lucide-react has no brand icons) — add small inline SVG
  brand marks in a new `components/provider-icons.tsx` (simple monochrome paths,
  `currentColor`, `aria-hidden`). Keep them minimal; they inherit size/color.
  Copy above the buttons must make the optional nature explicit: something like
  "Playing is anonymous and needs no account. Sign in only to claim your
  callsign and put your bests on the leaderboard." (final wording John's to
  tweak — leave a TODO(john) if unsure.)
- **`needs-callsign`** — the claim form: a single uppercase text input
  (`autoCapitalize="characters"`, `maxLength={10}`, mono font to match the app),
  a Claim button, and inline error text. On submit call `claimCallsign`:
  - `invalid` → "That doesn't look like a callsign." (helper text, not a toast)
  - `taken` → "That callsign's already claimed." (helper text)
  - `error` → toast an apologetic generic error.
  - `ok` → toast success, view flips to `ready`.
  Also show a "Sign out" affordance here — a user who signed in but doesn't want
  to claim can leave. (Signed-in-without-callsign is a valid resting state; do
  NOT force the claim or trap them.)
- **`ready`** — the profile card: callsign (mono, prominent), a verified
  indicator using a **shield** (lucide `ShieldCheck` when `profile.verified`,
  muted `Shield` when not, with a one-line "Not yet verified" hint — verification
  is slice 5, so just reflect the boolean, link nowhere yet), the account email
  (from `user.email`, secondary), and a Sign out button. A small "verification
  coming soon" line is fine; do NOT build the verify flow here.

Accessibility: the page must pass vitest-axe with no violations (there are
existing examples in `beat-the-bot-page.test.tsx`). Inputs labelled, buttons
named, the shield icon `aria-hidden` with adjacent text.

## Step 5 — Route + nav entry

- `app.tsx`: add `<Route path="/account" element={<AccountPage />} />`.
- Entry affordance (kept minimal — a full nav redesign is out of scope):
  - **Desktop header** (`site-nav.tsx`): add a small account control to the
    right-side controls cluster (next to GitHub/theme) — a `NavLink to="/account"`
    with a `User`/`CircleUser` lucide icon. When `status === 'ready'`, it MAY
    show the callsign; when signed-out, just the icon. Keep it icon-sized to
    match the GitHub/theme buttons; don't add it to the main `NAV_ITEMS` link row
    (that row is the three primary destinations).
  - **Mobile**: add an "Account" row to the `MoreSheet`
    (`components/more-sheet.tsx`) using the existing `rowClass` idiom — a
    `NavLink to="/account"` with a user icon, label "Account" (or the callsign
    when ready). Do NOT add a 6th tab to the bottom bar (it's full).
  - Both entries must render fine when `!isAuthConfigured` — they just lead to
    the "accounts aren't enabled" state. If you'd rather hide them entirely when
    unconfigured, that's acceptable too; pick one and be consistent.

## Step 6 — Mount the provider

`main.tsx`: wrap `<App />` in `<AuthProvider>`, inside `<BrowserRouter>` and
above `<ScrollToTop />`/content so any component can `useAuth()`. Order:
`BrowserRouter > AuthProvider > (ScrollToTop, content, MobileTabBar, …)`.

## Step 7 — Tests

`src/pages/account-page.test.tsx`, mocking `@/lib/supabase` and `@/lib/auth` the
way `beat-the-bot-page.test.tsx` mocks its deps (vi.hoisted + vi.mock). Cover:

- signed-out renders all three provider buttons; clicking one calls `signIn`
  with the right provider id.
- `needs-callsign` renders the claim input; submitting a valid call calls
  `claimCallsign` and on `ok` flips to the ready view.
- `claimCallsign` returning `taken` shows the "already claimed" helper, does NOT
  toast-success, and stays on the form.
- `invalid` (e.g. lowercase-only after a bad regex, or too long) shows the
  invalid helper with NO network call.
- `ready` renders the callsign and a shield; verified=true shows `ShieldCheck`,
  verified=false shows the muted shield + hint.
- `!isAuthConfigured` renders the "accounts aren't enabled" state without
  throwing.
- axe: no violations in signed-out, needs-callsign, and ready states.

## Step 8 — Provider setup doc (dashboard config — John does this, doc it)

Write `supabase/docs/auth-providers.md` documenting the EXACT dashboard steps to
enable Google, GitHub, and Discord, since the code is inert until each provider
is configured. For each: where to create the OAuth app, which redirect/callback
URL to register (the Supabase callback is
`https://qhmtjowsknqjkoieqxqk.supabase.co/auth/v1/callback`), which
client-id/secret to paste into Supabase (Authentication → Providers), and the
site URL / additional redirect URLs to set in Supabase Auth settings (must
include the prod origin AND `http://localhost:5173` for dev — confirm the dev
port from `vite.config.ts`/`package.json dev` script). Note that Google needs an
OAuth consent screen, GitHub needs a registered OAuth App (callback = the
Supabase callback URL), and Discord needs an application + OAuth2 redirect. Keep
it a checklist John can follow.

---

## Verification gate (must pass before commit — do NOT auto-commit)

1. `cd /Users/johnschult/code/morse`
2. `bunx turbo check typecheck build test --filter=morse-web`
   - Biome clean (SPDX headers present on every new file; no unused imports).
   - knip clean (no dead exports — the `PROVIDERS`/`Profile` exports are used).
   - typecheck clean.
   - build succeeds (the nullable-client pattern must let the build pass even if
     env vars are absent in the build environment).
   - all tests green incl. the new account-page tests.
3. `bun run dev`, then manually:
   - Anonymous: Decode and Beat the Bot work exactly as before, no auth prompts,
     no console errors from the auth layer. (The optional-auth promise.)
   - `/account` signed-out shows the three provider buttons.
   - With real provider config + env set: sign in → redirected back to
     `/account` → claim form → claim a call → ready card with callsign + muted
     shield. Sign out returns to signed-out.
   - Claiming a call a second account already holds shows "already claimed."
   - `crossOriginIsolated === true` still true in the console on every route.

## Out of scope (explicitly NOT in this slice)

- No bests sync / `publish_best` / outbox queue (slice 4).
- No leaderboard page or query (later).
- No QRZ verify flow or `verified`-setting (slice 5) — the page only READS the
  `verified` boolean and shows a shield.
- No QRZ badge (slice 6).
- No 6th bottom-tab; no nav redesign beyond the single account entry.
- No email/magic-link provider (Google/GitHub/Discord only; the PROVIDERS array
  makes adding one later trivial).
