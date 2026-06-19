// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Session, User } from '@supabase/supabase-js';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { toast } from 'sonner';
import { isAuthConfigured, type Profile, supabase } from './supabase';

export type AuthProvider = 'google' | 'github' | 'discord';

export type AuthStatus = 'loading' | 'signed-out' | 'needs-callsign' | 'ready';

export type ClaimResult =
  | { ok: true }
  | { ok: false; reason: 'taken' | 'invalid' | 'error' };

export interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  signIn: (provider: AuthProvider) => Promise<void>;
  signOut: () => Promise<void>;
  claimCallsign: (raw: string) => Promise<ClaimResult>;
  refreshProfile: () => Promise<void>;
}

/** Same shape the DB enforces (see profiles.call_sign check). */
export const CALLSIGN_REGEX = /^[A-Z0-9/]{1,10}$/;

const AuthContext = createContext<AuthContextValue | null>(null);

// Module-level guard for the single-use PKCE code exchange — shared across
// StrictMode's double-mount of <AuthProvider> so the code is only ever sent
// once. Resolves to the supabase response (or rejects) so both effect runs
// await the same outcome.
let pkceExchange: Promise<unknown> | null = null;

async function fetchProfile(userId: string): Promise<Profile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.error('[auth] fetch profile failed', error);
    return null;
  }
  return (data as Profile | null) ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(isAuthConfigured);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function init() {
      if (!supabase) return;
      // Manual PKCE handoff. A module-level guard (`pkceExchange`) keeps
      // StrictMode's double-mount from trying to exchange the single-use code
      // twice — the second attempt would fail (code consumed) and leave the
      // app spinning forever.
      const code =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('code')
          : null;
      if (code) {
        if (!pkceExchange) {
          pkceExchange = supabase.auth.exchangeCodeForSession(code);
        }
        try {
          await pkceExchange;
        } catch (err) {
          console.error('[auth] code exchange failed', err);
        }
        // Strip the code from the URL so a reload can't reopen this path.
        if (typeof window !== 'undefined') {
          const u = new URL(window.location.href);
          u.search = '';
          window.history.replaceState({}, '', u.toString());
        }
      }

      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setSession(data.session);
      if (data.session?.user) {
        const p = await fetchProfile(data.session.user.id);
        if (!cancelled) setProfile(p);
      }
      if (!cancelled) setLoading(false);
    }

    init();

    const { data: sub } = supabase.auth.onAuthStateChange(
      async (_event, next) => {
        if (cancelled) return;
        setSession(next);
        if (next?.user) {
          const p = await fetchProfile(next.user.id);
          if (!cancelled) setProfile(p);
        } else {
          setProfile(null);
        }
      }
    );

    // iOS PWA resume: while the app is suspended, supabase's autoRefresh
    // timer can fire against a dead network and rotate the refresh token
    // into a broken state — on wake we'd surface as signed-out until a
    // hard-kill. Re-asking on `visible` either confirms the session, gets
    // a fresh one, or cleanly emits SIGNED_OUT via onAuthStateChange.
    const onVisibility = () => {
      const sb = supabase;
      if (!sb || cancelled) return;
      if (document.visibilityState !== 'visible') return;
      void sb.auth.refreshSession().then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          // Refresh failed (no network, rotated token, etc.). Fall back to
          // whatever's in storage so we don't strand the user as signed-out
          // when they actually still have a valid session.
          void sb.auth.getSession().then(({ data: d }) => {
            if (!cancelled) setSession(d.session);
          });
          return;
        }
        setSession(data.session);
      });
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!supabase || !session?.user) return;
    const p = await fetchProfile(session.user.id);
    setProfile(p);
  }, [session]);

  const signIn = useCallback(async (provider: AuthProvider) => {
    if (!supabase) {
      toast.error("Accounts aren't enabled in this build.");
      return;
    }
    const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}account`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo },
    });
    if (error) {
      console.error('[auth] signIn failed', error);
      toast.error("Couldn't start sign-in. Try again?");
    }
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    const online =
      typeof navigator === 'undefined' || navigator.onLine !== false;

    // Offline path: skip supabase.auth.signOut entirely. Even `scope:
    // 'local'` makes a POST /logout call (see @supabase/auth-js), and when
    // that fails offline the SDK returns early WITHOUT clearing the
    // persisted token — leaving the user "signed in" but stuck. Wipe the
    // sb-*-auth-token keys ourselves and force the in-memory state. The
    // remote session lives on until its TTL — fine, we don't manage
    // multi-device session UX.
    if (!online) {
      try {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
            localStorage.removeItem(key);
          }
        }
      } catch {
        /* storage access denied — best-effort */
      }
      setSession(null);
      setProfile(null);
      toast.success('Signed out.');
      return;
    }

    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('[auth] signOut failed', error);
      toast.error("Couldn't sign out. Try again?");
      return;
    }
    toast.success('Signed out.');
  }, []);

  const claimCallsign = useCallback(
    async (raw: string): Promise<ClaimResult> => {
      if (!supabase || !session?.user) return { ok: false, reason: 'error' };
      const call = raw.trim().toUpperCase();
      if (!CALLSIGN_REGEX.test(call)) return { ok: false, reason: 'invalid' };

      const { error } = await supabase
        .from('profiles')
        .insert({ id: session.user.id, call_sign: call });

      if (error) {
        // Postgres unique-violation = 23505 (case-insensitive call_sign index).
        if ((error as { code?: string }).code === '23505') {
          return { ok: false, reason: 'taken' };
        }
        console.error('[auth] claimCallsign failed', error);
        return { ok: false, reason: 'error' };
      }

      await refreshProfile();
      return { ok: true };
    },
    [session, refreshProfile]
  );

  const status: AuthStatus = useMemo(() => {
    if (!isAuthConfigured) return 'signed-out';
    if (loading) return 'loading';
    if (!session) return 'signed-out';
    if (!profile) return 'needs-callsign';
    return 'ready';
  }, [loading, session, profile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      user: session?.user ?? null,
      profile,
      signIn,
      signOut,
      claimCallsign,
      refreshProfile,
    }),
    [status, session, profile, signIn, signOut, claimCallsign, refreshProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
