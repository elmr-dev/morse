// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The top-level Leaderboards aggregator — every trainer's public board in one
// place, as deep-linkable tabs. `/leaderboards` opens the first trainer;
// `/leaderboards/<trainer>` selects that trainer's tab directly. Each board
// reuses the shared <LeaderboardView> at variant="full" off its trainer's one
// data source — the same adapter the in-trainer embedded mini-board uses, so the
// two views can't drift.

import { Gauge, type LucideIcon, Trophy } from 'lucide-react';
import { type ComponentType, useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, useParams } from 'react-router-dom';
import { BoxingGloveIcon } from '@/components/boxing-glove-icon';
import LeaderboardView from '@/components/leaderboard-view';
import PageHeader from '@/components/page-header';
import { PileupIcon } from '@/components/pileup-icon';
import {
  reconcile as reconcileRedline,
  redlineBoard,
} from '@/features/redline/leaderboard';
import {
  BESTS_STORAGE_KEY,
  EMPTY_BESTS,
  isBests,
} from '@/inference/beat-the-bot';
import { useAuth } from '@/lib/auth';
import { reconcile as reconcileBtb } from '@/lib/bests-sync';
import type { LeaderboardBoard } from '@/lib/leaderboard';
import { beatTheBotBoard } from '@/lib/leaderboard-btb';
import { isAuthConfigured } from '@/lib/supabase';
import { useDocumentHead } from '@/lib/use-document-head';
import { useOnline } from '@/lib/use-online';
import { cn } from '@/lib/utils';

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

interface TrainerConfig {
  slug: string;
  label: string;
  icon: LucideIcon | ComponentType<{ className?: string }>;
  blurb: string;
  makeBoard: () => LeaderboardBoard;
  /** Push this device's local bests up before reading the board back. Called
   *  only for a ready, signed-in viewer; receives their user id. */
  reconcile: (userId: string) => Promise<unknown>;
}

// The built trainers, in tab order.
const TRAINERS: TrainerConfig[] = [
  {
    slug: 'beat-the-bot',
    label: 'Beat the Bot',
    icon: BoxingGloveIcon,
    blurb:
      "Best copy % per license tier — the bot's the same brutal clip every round.",
    // "All" leads — the broadest cross-tier view.
    makeBoard: () => beatTheBotBoard('all'),
    reconcile: (userId) => reconcileBtb(readLocalBests(), userId),
  },
  {
    slug: 'redline',
    label: 'Redline',
    icon: Gauge,
    blurb:
      'Score and top WPM from copying random callsigns at the edge of your speed.',
    makeBoard: () => redlineBoard(),
    reconcile: () => reconcileRedline(),
  },
];

const DEFAULT_SLUG = TRAINERS[0].slug;

// Pileup is named-but-unbuilt (a Morse-Runner-style sim). It shows as a disabled
// "Soon" tab — the IA slot exists, the board doesn't.
const PILEUP_TAB = { label: 'Pileup', icon: PileupIcon } as const;

export default function LeaderboardsPage() {
  const { trainer } = useParams<{ trainer?: string }>();

  // An unknown or not-yet-built trainer slug (e.g. /leaderboards/pileup) bounces
  // to the aggregator rather than 404 on a slot we've named but not built.
  if (trainer && !TRAINERS.some((t) => t.slug === trainer)) {
    return <Navigate to="/leaderboards" replace />;
  }

  const activeSlug = trainer ?? DEFAULT_SLUG;
  const active = TRAINERS.find((t) => t.slug === activeSlug) ?? TRAINERS[0];

  return <LeaderboardsView active={active} hasParam={!!trainer} />;
}

function LeaderboardsView({
  active,
  hasParam,
}: {
  active: TrainerConfig;
  hasParam: boolean;
}) {
  useDocumentHead({
    title: hasParam ? `${active.label} leaderboard` : 'Leaderboards',
    description: `Public standings for every MORSE trainer. ${active.label}: ${active.blurb}`,
    // The bare /leaderboards is the crawlable/canonical surface; per-trainer
    // tabs deep-link client-side.
    path: '/leaderboards',
  });

  return (
    <div>
      <PageHeader
        eyebrow="Standings"
        icon={Trophy}
        title="Leaderboards"
        wideIntro
      >
        Every trainer's public board in one place — each ranks humans against
        each other. Pick a trainer.
      </PageHeader>

      <TabBar activeSlug={active.slug} />
      <p className="mt-4 mb-4 text-[13px] text-muted-foreground">
        {active.blurb}
      </p>
      <TrainerBoard config={active} />
    </div>
  );
}

const tabClass =
  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

/** Deep-linkable tab bar: each built trainer is a NavLink to its slug; Pileup is
 *  a disabled future slot. */
function TabBar({ activeSlug }: { activeSlug: string }) {
  const PileupIcon = PILEUP_TAB.icon;
  return (
    <div
      role="tablist"
      aria-label="Trainer leaderboards"
      className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-muted p-1"
    >
      {TRAINERS.map(({ slug, label, icon: Icon }) => {
        const isActive = slug === activeSlug;
        return (
          <NavLink
            key={slug}
            to={`/leaderboards/${slug}`}
            role="tab"
            aria-selected={isActive}
            className={cn(
              tabClass,
              isActive
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        );
      })}
      <span
        role="tab"
        tabIndex={0}
        aria-selected={false}
        aria-disabled="true"
        className={cn(tabClass, 'cursor-not-allowed text-muted-foreground/50')}
      >
        <PileupIcon className="size-4" />
        {PILEUP_TAB.label}
        <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/70">
          Soon
        </span>
      </span>
    </div>
  );
}

/** One trainer's full board: reconcile-on-open, visibility refetch, and the
 *  shared <LeaderboardView> at variant="full". */
function TrainerBoard({ config }: { config: TrainerConfig }) {
  const { status, user, profile } = useAuth();
  const online = useOnline();
  const ownCallSign = profile?.call_sign ?? null;
  const board = useMemo(() => config.makeBoard(), [config]);
  const [reloadToken, setReloadToken] = useState(0);

  // Reconcile-on-open: push the viewer's latest local bests up, then bump the
  // view's reloadToken so the board refetches with the just-pushed rows visible.
  // Signed-out viewers skip this entirely.
  useEffect(() => {
    if (status !== 'ready' || !user) return;
    let cancelled = false;
    void config.reconcile(user.id).then(() => {
      if (!cancelled) setReloadToken((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [status, user, config]);

  // iOS PWA resume: a backgrounded fetch can be permanently parked. Bump the
  // reload token on visible-again to force a fresh request.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        setReloadToken((n) => n + 1);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  return (
    <>
      <LeaderboardView
        board={board}
        ownCallSign={ownCallSign}
        reloadToken={reloadToken}
      />
      {isAuthConfigured && status === 'signed-out' && online && (
        <p className="mt-4 text-center text-[12px] text-muted-foreground">
          <NavLink
            to="/account"
            className="underline-offset-2 hover:text-foreground hover:underline"
          >
            Sign in to claim your spot
          </NavLink>
        </p>
      )}
    </>
  );
}
