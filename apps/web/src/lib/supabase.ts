// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase client singleton. Optional by design — when the env vars aren't set
 * (local dev without accounts, or a build with no backend), `supabase` is
 * `null` and every auth surface degrades to "accounts aren't enabled in this
 * build." Anonymous play stays 100% unchanged.
 *
 * Both env vars are public-by-design: `VITE_`-prefixed ships in the bundle,
 * and the publishable key is meant to be exposed — Row-Level Security in the
 * schema (see supabase/migrations) is what protects data, not key secrecy.
 */

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: {
          // We exchange the PKCE `?code=` ourselves in AuthProvider — the
          // auto-detector races React StrictMode's double-mount (the code is
          // single-use, so the second attempt always fails) and the spinner
          // never clears.
          detectSessionInUrl: false,
          persistSession: true,
          autoRefreshToken: true,
          flowType: 'pkce',
        },
      })
    : null;

export const isAuthConfigured = supabase !== null;

export interface Profile {
  id: string;
  call_sign: string;
  verified: boolean;
  created_at: string;
}
