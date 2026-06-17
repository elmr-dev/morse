// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef } from 'react';
import type { Bests } from '../inference/beat-the-bot';
import { useAuth } from './auth';
import { reconcile } from './bests-sync';

/**
 * Wires local↔cloud bests reconcile to its triggers. Mounted from the page
 * that owns the canonical `bests` state — see Slice 4 (page-scoped lifetime is
 * acceptable because bests are only set on that page).
 *
 * Triggers (all gated on `status === 'ready'`):
 *   - mount-into-ready (sign-in / becoming ready): initial push + pull
 *   - `online` event: catch up after a flaky connection
 *   - `visibilitychange` → visible: iOS workhorse (no Background Sync there)
 *     — covers "played offline, reopened the app"
 *
 * Background Sync (`SyncManager`) is an Android-only future enhancement that
 * needs a service worker; online + visibility + sign-in are the cross-platform
 * baseline. A future leaderboard route should also call `syncNow()` on entry.
 */
export function useBestsSync(
  bests: Bests,
  setBests: (next: Bests) => void
): { syncNow: () => void } {
  const { status, user } = useAuth();

  const bestsRef = useRef(bests);
  bestsRef.current = bests;

  const setBestsRef = useRef(setBests);
  setBestsRef.current = setBests;

  const runningRef = useRef(false);
  const statusRef = useRef(status);
  statusRef.current = status;
  const userIdRef = useRef(user?.id ?? null);
  userIdRef.current = user?.id ?? null;

  const runReconcile = useCallback(async () => {
    if (statusRef.current !== 'ready') return;
    const userId = userIdRef.current;
    if (!userId) return;
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      const merged = await reconcile(bestsRef.current, userId);
      setBestsRef.current(merged);
    } catch (err) {
      console.error('[bests-sync] reconcile failed', err);
    } finally {
      runningRef.current = false;
    }
  }, []);

  // Mount-into-ready: when status flips to 'ready', kick off a reconcile.
  useEffect(() => {
    if (status !== 'ready' || !user) return;
    runReconcile();
  }, [status, user, runReconcile]);

  // online + visibilitychange. Only attached while ready so signed-out /
  // needs-callsign sessions are fully inert (no listeners, no calls).
  useEffect(() => {
    if (status !== 'ready' || !user) return;
    const onOnline = () => {
      runReconcile();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') runReconcile();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [status, user, runReconcile]);

  const syncNow = useCallback(() => {
    void runReconcile();
  }, [runReconcile]);

  return { syncNow };
}
