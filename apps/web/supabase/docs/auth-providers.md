<!--
SPDX-FileCopyrightText: 2026 Mark Percival, John Schult

SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Auth providers — dashboard checklist

The slice-3 client code is inert until each provider is configured both in the
provider's developer console AND in the Supabase dashboard. Do this once per
provider; do it carefully — wrong redirect URLs are the #1 cause of "OAuth says
hello, then dies on the way back."

**Project:** `qhmtjowsknqjkoieqxqk`
**Supabase OAuth callback (every provider points here):**
`https://qhmtjowsknqjkoieqxqk.supabase.co/auth/v1/callback`

## 0. Supabase Auth settings (do this FIRST)

Dashboard → Authentication → URL Configuration:

- **Site URL** → the prod origin (matches `VITE_SITE_URL` in
  `apps/web/.env.production`, currently `https://morse-ml.netlify.app`).
- **Additional Redirect URLs** — add both:
  - `https://morse-ml.netlify.app/account`
  - `http://localhost:5173/account` (the Vite dev port — `apps/web` runs `vite`
    with its default port; confirm from `bun run dev` if you've customized it)

Supabase only allows the OAuth callback to redirect back to URLs on this list.
Forgetting `/account` is what makes "sign in works but the app never picks up
the session."

## 1. Google

1. Google Cloud Console → **APIs & Services → OAuth consent screen**. Create
   one (External, app name = MORSE, support email = yours). Add the prod origin
   under "Authorized domains" (`netlify.app` if hosting there; the apex domain,
   not the full URL).
2. **Credentials → Create credentials → OAuth client ID → Web application.**
   - **Authorized redirect URIs:** the Supabase callback URL above.
3. Copy the **Client ID** and **Client secret**.
4. Supabase Dashboard → **Authentication → Providers → Google** → Enable; paste
   Client ID + Secret; save.

## 2. GitHub

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**.
   - Application name: MORSE
   - Homepage URL: the prod origin
   - **Authorization callback URL:** the Supabase callback URL above
2. Generate a **Client secret**; copy it (you only see it once).
3. Supabase Dashboard → **Authentication → Providers → GitHub** → Enable; paste
   Client ID + Secret; save.

## 3. Discord

1. Discord Developer Portal → **Applications → New Application** (name: MORSE).
2. **OAuth2 → General → Redirects:** add the Supabase callback URL above.
3. Copy the **Client ID** and the **Client secret** (OAuth2 page).
4. Supabase Dashboard → **Authentication → Providers → Discord** → Enable;
   paste Client ID + Secret; save.

## Verifying end-to-end

After each provider is wired up:

1. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in
   `apps/web/.env.local` (dev) and the host's env (prod). See
   `apps/web/.env.production.example` for the canonical names.
2. `bun run dev`, hit `/account`, click the provider button.
3. You should land back at `/account` with the claim form (a brand-new account
   has no `profiles` row yet — that's the `needs-callsign` state).
4. Claim a unique callsign → the page flips to the profile card with a muted
   shield ("Not yet verified" — verification is slice 5).
5. Sign out, try again. Try claiming a callsign a second account already holds
   — expect "That callsign's already claimed."

If sign-in succeeds but the redirect lands somewhere unexpected, the Site URL /
Additional Redirect URLs list in Supabase is almost certainly the culprit.
