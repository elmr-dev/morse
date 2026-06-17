// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Trophy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import LeaderboardView from '@/components/leaderboard-view';
import PageHeader from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';
import { reconcile } from '@/lib/bests-sync';
import { beatTheBotBoard } from '@/lib/leaderboard-btb';
import { isAuthConfigured } from '@/lib/supabase';
import { useDocumentHead } from '@/lib/use-document-head';
import {
  BESTS_STORAGE_KEY,
  EMPTY_BESTS,
  isBests,
} from '../inference/beat-the-bot';

// "All" is the default — broadest view first; users can narrow to their tier.
const DEFAULT_SEGMENT = 'all';

function readLocalBests() {
  try {
    const raw = localStorage.getItem(BESTS_STORAGE_KEY);
    if (raw === null) return EMPTY_BESTS;
    const parsed: unknown = JSON.parse(raw);
    return isBests(parsed) ? parsed : EMPTY_BESTS;
  } catch {
    return EMPTY_BESTS;
  }
}

export default function LeaderboardPage() {
  useDocumentHead({
    title: 'Leaderboard',
    description:
      'Beat-the-Bot standings — ranked by best copy % per license tier.',
    path: '/leaderboard',
  });

  const { status, user, profile } = useAuth();
  const ownCallSign = profile?.call_sign ?? null;

  const board = useMemo(() => beatTheBotBoard(DEFAULT_SEGMENT), []);
  const [reloadToken, setReloadToken] = useState(0);

  // Reconcile-on-open: push the viewer's latest local bests up, then bump
  // the view's reloadToken so the board refetches with the just-pushed rows
  // visible (without this the initial fetch races reconcile and freezes a
  // stale snapshot). Signed-out viewers skip this entirely.
  useEffect(() => {
    if (status !== 'ready' || !user) return;
    let cancelled = false;
    void reconcile(readLocalBests(), user.id).then(() => {
      if (!cancelled) setReloadToken((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [status, user]);

  return (
    <div>
      <PageHeader
        eyebrow="Standings"
        icon={Trophy}
        title="Leaderboard"
        wideIntro
      >
        Who's copying cleanest at each tier. The bot gets the same brutal clip
        every round — this board ranks humans against each other.
      </PageHeader>

      <Card>
        <CardContent>
          <LeaderboardView
            board={board}
            ownCallSign={ownCallSign}
            reloadToken={reloadToken}
          />
          {isAuthConfigured && status === 'signed-out' && (
            <p className="mt-4 text-center text-[12px] text-muted-foreground">
              <NavLink
                to="/account"
                className="underline-offset-2 hover:text-foreground hover:underline"
              >
                Sign in to claim your spot
              </NavLink>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
