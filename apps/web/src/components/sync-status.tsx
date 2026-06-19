// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { CloudCheck, CloudOff } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { isAuthConfigured } from '@/lib/supabase';
import { useOnline } from '@/lib/use-online';

/**
 * One quiet caption between TierRow and the divider on /beat-the-bot, telling
 * the user whether their bests are syncing to a leaderboard call or just
 * living on this device. Pure indicator — no data behavior. Reads useAuth()
 * itself so the page doesn't have to thread props.
 */
export default function SyncStatus() {
  const { status, profile } = useAuth();
  const online = useOnline();

  if (status === 'loading') return null;

  if (status === 'ready' && profile) {
    // Offline: "Synced as X" would lie about the round-trip. Bests still
    // queue locally and reconcile on reconnect (useBestsSync), so the
    // accurate caption is "Will sync …".
    if (!online) {
      return (
        <p className="flex items-center justify-center gap-1.5 text-[13px] text-muted-foreground">
          <CloudOff className="size-[18px] shrink-0" aria-hidden="true" />
          <span>
            Will sync as{' '}
            <NavLink
              to="/account"
              className="text-foreground underline-offset-2 hover:underline"
            >
              {profile.call_sign}
            </NavLink>{' '}
            when back online
          </span>
        </p>
      );
    }
    return (
      <p className="flex items-center justify-center gap-1.5 text-[13px] text-muted-foreground">
        <CloudCheck className="size-[18px] shrink-0" aria-hidden="true" />
        <span>
          Synced as{' '}
          <NavLink
            to="/account"
            className="text-foreground underline-offset-2 hover:underline"
          >
            {profile.call_sign}
          </NavLink>
        </span>
      </p>
    );
  }

  if (status === 'needs-callsign') {
    // The /account claim flow needs the network, so don't link there
    // offline — just hold the slot for visual balance.
    if (!online) {
      return (
        <p className="text-center text-[12px] text-muted-foreground">
          Claim a callsign to sync
        </p>
      );
    }
    return (
      <p className="text-center text-[12px] text-muted-foreground">
        <NavLink
          to="/account"
          className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Claim a callsign to sync
        </NavLink>
      </p>
    );
  }

  // signed-out (or auth not configured at all). When accounts aren't enabled
  // in this build, /account just says so — skip the dangling link. Same goes
  // when offline: the sign-in flow can't complete, so drop the link.
  return (
    <p className="text-center text-[12px] text-muted-foreground">
      Saved on this device
      {isAuthConfigured && online && (
        <>
          {' · '}
          <NavLink
            to="/account"
            className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Sign in to sync
          </NavLink>
        </>
      )}
    </p>
  );
}
