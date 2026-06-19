// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRegisterSW } from 'virtual:pwa-register/react';
import { Check, Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

/** Surfaces a Sonner toast when a new SW version is waiting. The waiting
 *  worker never activates on its own (registerType is 'prompt'), so an
 *  in-flight decode is never yanked out from under them. Renders nothing.
 *
 *  We deliberately ignore useRegisterSW's `offlineReady`: it fires on the
 *  first SW install for every visitor (browser included) and would be
 *  misleading here — the app shell is cached, but the decoder isn't usable
 *  offline until the model is provisioned. That messaging lives in
 *  OfflineProvisioner instead.
 *
 *  The registration polls for updates every 30 min and on visibility-becomes-
 *  visible, so long-running sessions (and PWA-resume on iOS) actually find
 *  new builds without a close-and-reopen.
 *
 *  Mounted once in main.tsx; useRegisterSW also performs the registration. */

const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
// How long the "Updated" check-mark sits before we actually reload — long
// enough to register as confirmation, short enough that it doesn't drag.
const COMPLETION_DWELL_MS = 1200;
const TOAST_ID = 'pwa-update';
// Inner layout for every phase — the Toaster's bg-card is a touch
// lighter than Sonner's default toast bg (which used --normal-bg via
// data-styled). Overlay bg-popover here to match the darker look the
// regular Sonner toasts had, and keep rounded-lg so the outer
// Toaster-applied corners aren't peeking past the overlay.
const TOAST_SHELL =
  'flex w-full items-center gap-2 rounded-lg bg-popover px-4 py-3 text-sm';
// Tighter than shadcn's `size="sm"` default — Sonner's own action
// buttons are compact, and the prompt looked bulky once we built our
// own buttons.
const TOAST_BUTTON_SIZE = 'h-7 px-2.5 text-xs';

export function PwaUpdatePrompt() {
  const activeToastRef = useRef<string | number | null>(null);
  // Soft-snooze: Dismiss hides the toast for this visibility-cycle only.
  // Re-shows on next `visibilitychange → visible` so an update can't be
  // permanently dismissed — we can't count on close-and-reopen.
  const [snoozed, setSnoozed] = useState(false);
  // Update lifecycle: idle → inflight (SW activating, no UI change) →
  // done (toast replaced with "Updated to vX") → reload. We deliberately
  // skip a separate "updating" affordance: the SW activation is fast
  // enough that adding a spinner just adds noise.
  const [phase, setPhase] = useState<'idle' | 'inflight' | 'done'>('idle');
  // Filled in on completion from the *new* SW's precached manifest, so
  // the success line reads "Updated to vX". Falls back to a bare
  // "Updated" if the read fails for any reason.
  const [newVersion, setNewVersion] = useState<string | null>(null);

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      const check = () => {
        if (registration.installing) return;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          return;
        }
        void registration.update();
      };
      window.setInterval(check, UPDATE_CHECK_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });

  // Clear the snooze whenever the user comes back to the app. The render
  // effect below will then re-fire the toast (needRefresh is still true).
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') setSnoozed(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (!needRefresh || snoozed) {
      if (activeToastRef.current !== null) {
        toast.dismiss(activeToastRef.current);
        activeToastRef.current = null;
      }
      return;
    }

    const handleUpdate = () => {
      if (phase !== 'idle') return;
      setPhase('inflight');
      // Activate the waiting SW WITHOUT vite-plugin-pwa's auto-reload so
      // we control the timing: SW activates → success state → reload.
      void Promise.resolve(updateServiceWorker(false))
        .then(async () => {
          // Read the new SW's precached manifest so the success line can
          // name the version we're about to land on. Best-effort: a
          // failure just degrades to "Updated".
          try {
            const res = await fetch('/manifest.webmanifest', {
              cache: 'no-store',
            });
            const manifest = (await res.json()) as { version?: string };
            if (manifest.version) setNewVersion(manifest.version);
          } catch {
            /* leave newVersion null */
          }
          setPhase('done');
          window.setTimeout(() => {
            window.location.reload();
          }, COMPLETION_DWELL_MS);
        })
        .catch(() => setPhase('idle'));
    };

    // Both phases use the same `toast.custom` id so Sonner swaps the
    // render function in place — no exit animation, no nested toasts,
    // and the dark card background stays continuous.
    activeToastRef.current = toast.custom(
      () =>
        phase === 'done' ? (
          <div className={TOAST_SHELL}>
            <Check className="size-4 shrink-0 text-primary" aria-hidden />
            <span>Updated{newVersion ? ` to v${newVersion}` : ''}</span>
          </div>
        ) : (
          <div className={TOAST_SHELL}>
            <Download className="size-4 shrink-0 text-primary" aria-hidden />
            <span className="flex-1">Update available</span>
            {phase === 'idle' && (
              <Button
                size="sm"
                variant="ghost"
                className={TOAST_BUTTON_SIZE}
                onClick={() => setSnoozed(true)}
              >
                Not now
              </Button>
            )}
            <Button
              size="sm"
              className={TOAST_BUTTON_SIZE}
              onClick={handleUpdate}
              disabled={phase !== 'idle'}
            >
              Update
            </Button>
          </div>
        ),
      { id: TOAST_ID, duration: Number.POSITIVE_INFINITY }
    );
  }, [needRefresh, snoozed, phase, newVersion, updateServiceWorker]);

  return null;
}
