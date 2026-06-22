// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Check,
  ChevronDown,
  Flag,
  Gauge,
  Hash,
  HelpCircle,
  Keyboard,
  ListChecks,
  type LucideIcon,
  Play,
  RadioTower,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Star,
  Target,
  Trophy,
  Volume2,
  X,
  Zap,
} from 'lucide-react';
import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { NavLink } from 'react-router-dom';
import LeaderboardView from '@/components/leaderboard-view';
import PageHeader from '@/components/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth';
import { useDocumentHead } from '@/lib/use-document-head';
import { usePersistedState } from '@/lib/use-persisted-state';
import { cn } from '@/lib/utils';
import { generateCallsign } from './callsigns';
import { CwPlayer } from './cw-player';
import {
  abortRun,
  advanceFromReview,
  beginNext,
  calculateStats,
  createInitialState,
  markReplayed,
  normalizeCallsign,
  setTyped,
  startRun,
  submitAttempt,
} from './game';
import {
  publishScore,
  reconcile,
  redlineBoard,
  writeLocalBest,
} from './leaderboard';
import Oscilloscope from './Oscilloscope';
import {
  DEFAULT_REDLINE_SETTINGS,
  type RedlineSettings,
  type RedlineSpeedMode,
  type RedlineState,
} from './types';

function isSettings(value: unknown): value is RedlineSettings {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.userCall === 'string' &&
    typeof v.startSpeed === 'number' &&
    typeof v.toneFrequency === 'number' &&
    typeof v.callsignCount === 'number' &&
    typeof v.practiceMode === 'boolean' &&
    (v.speedMode === 'adaptive' || v.speedMode === 'fixed')
  );
}

// ── Small building blocks ──────────────────────────────────────────────────

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded-sm border border-border bg-muted px-1.5 py-0.5 text-center font-mono text-[11px] text-foreground shadow-xs">
      {children}
    </kbd>
  );
}

/** A keycap that sits inside a button, tinted to the button's own text color so
 *  it reads on any variant in both themes. */
function BtnKbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded border border-current/40 px-1 py-0.5 font-mono text-[10px] font-medium leading-none opacity-80">
      {children}
    </kbd>
  );
}

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['F5'], label: 'Start a run (from setup)' },
  { keys: ['Enter', 'Space'], label: 'Submit copy · send next call' },
  { keys: ['F6'], label: 'Replay the current call (−50% points)' },
  { keys: ['Esc'], label: 'Clear the input' },
];

/** A friendly popover listing every keyboard shortcut. The keycaps also live on
 *  the buttons themselves; this is the full reference. */
function ShortcutsHelp({ size = 'default' }: { size?: 'sm' | 'default' }) {
  return (
    <Popover>
      <PopoverTrigger
        className={cn(buttonVariants({ variant: 'outline', size }))}
      >
        <Keyboard className="size-4" />
        Shortcuts
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="mb-3 font-semibold text-sm">Keyboard shortcuts</div>
        <ul className="grid gap-2.5">
          {SHORTCUTS.map(({ keys, label }) => (
            <li
              key={label}
              className="flex items-center justify-between gap-4 text-sm"
            >
              <span className="text-muted-foreground">{label}</span>
              <span className="flex shrink-0 items-center gap-1">
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

const HOW_IT_WORKS: { icon: typeof Volume2; title: string; body: string }[] = [
  {
    icon: Volume2,
    title: 'Listen',
    body: 'A random amateur callsign sends in CW.',
  },
  {
    icon: Check,
    title: 'Copy & send',
    body: 'Type what you hear and press Enter — the next call is already on the air.',
  },
  {
    icon: Gauge,
    title: 'Push the redline',
    body: 'Clean copies raise the speed; misses ease it back. Score rewards speed and accuracy.',
  },
];

const SETTINGS_HELP: { label: string; body: string }[] = [
  {
    label: 'Speed mode',
    body: 'Adaptive nudges the speed up after a clean copy (+2, more on a streak) and down after a miss; Fixed holds your start speed all run.',
  },
  {
    label: 'Start speed',
    body: 'WPM the first callsign is sent at — your jumping-off point.',
  },
  {
    label: 'Callsigns',
    body: 'How many calls a run sends before the summary.',
  },
  { label: 'Tone', body: 'Pitch of the CW sidetone, in Hz.' },
];

/** A visual primer shown on the setup screen, in place of a paragraph of prose.
 *  Calls out the loop and — prominently — the replay penalty. Collapsible, with
 *  its open/closed state remembered across visits (open by default first time). */
function HowItWorks({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl bg-muted">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-2 px-5 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="flex items-center gap-2">
          <HelpCircle className="size-3.5 text-primary" />
          How it works
        </span>
        <ChevronDown
          className={cn(
            'size-4 transition-transform',
            open ? 'rotate-180' : 'rotate-0'
          )}
        />
      </button>
      {/* grid-rows 0fr→1fr animates the reveal smoothly without a fixed height */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="overflow-hidden">
          <div className="px-5 pb-5">
            <ol className="grid gap-5 sm:grid-cols-3">
              {HOW_IT_WORKS.map((step, i) => {
                const StepIcon = step.icon;
                return (
                  <li key={step.title} className="flex gap-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-sm font-semibold text-primary">
                      {i + 1}
                    </span>
                    <div className="grid gap-1">
                      <div className="flex items-center gap-1.5 font-medium text-foreground">
                        <StepIcon className="size-4 text-muted-foreground" />
                        {step.title}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {step.body}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
            <dl className="mt-5 grid gap-x-6 gap-y-3 border-t border-border/60 pt-5 sm:grid-cols-2">
              {SETTINGS_HELP.map((s) => (
                <div key={s.label} className="text-sm">
                  <dt className="font-medium text-foreground">{s.label}</dt>
                  <dd className="text-muted-foreground">{s.body}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 flex items-start gap-2 rounded-lg border border-dial/30 bg-dial/5 px-3 py-2.5 text-sm text-muted-foreground">
              <RotateCcw className="mt-0.5 size-4 shrink-0 text-dial" />
              <span>
                <span className="font-medium text-foreground">Missed one?</span>{' '}
                Press <Kbd>F6</Kbd> to replay a call once — but it costs{' '}
                <span className="font-semibold text-dial">
                  50% of that call's points
                </span>
                .
              </span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function VolumeControl({
  volume,
  onChange,
}: {
  volume: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <Volume2 className="size-4" />
      <span className="sr-only">Volume</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        onChange={(e) => {
          const n = Number(e.currentTarget.value);
          if (Number.isFinite(n)) onChange(Math.min(1, Math.max(0, n)));
        }}
        className="w-28 accent-primary"
        aria-label="Volume"
      />
      <span className="w-8 text-right font-mono">
        {Math.round(volume * 100)}%
      </span>
    </label>
  );
}

type StatTone = 'neutral' | 'primary' | 'dial' | 'good';

const STAT_CHIP: Record<StatTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  primary: 'bg-primary/10 text-primary',
  dial: 'bg-dial/10 text-dial',
  good: 'bg-good/10 text-good',
};

const STAT_VALUE: Record<StatTone, string> = {
  neutral: 'text-foreground',
  primary: 'text-foreground',
  dial: 'text-dial',
  good: 'text-good',
};

function StatTile({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: StatTone;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-3.5 py-3 shadow-sm transition-colors hover:border-border/80">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            'flex size-6 items-center justify-center rounded-md',
            STAT_CHIP[tone]
          )}
        >
          <Icon className="size-3.5" />
        </span>
      </div>
      <div
        className={cn(
          'mt-1.5 font-mono text-2xl font-semibold tabular-nums',
          STAT_VALUE[tone]
        )}
      >
        {value}
      </div>
    </div>
  );
}

/** Reference callsign rendered char-by-char with a per-character copy diff. */
function DiffCallsign({
  sent,
  received,
  size = 'md',
}: {
  sent: string;
  received: string;
  size?: 'sm' | 'md';
}) {
  const ref = normalizeCallsign(sent);
  const got = normalizeCallsign(received);
  const len = Math.max(ref.length, got.length);
  const cells = Array.from({ length: len }, (_, i) => {
    const expected = ref[i] ?? '';
    const actual = got[i] ?? '';
    return {
      id: `${i}:${expected}:${actual}`,
      // For positions past the reference, show what was wrongly typed.
      ch: expected || actual,
      ok: expected !== '' && actual === expected,
    };
  });
  return (
    <span
      className={cn(
        'inline-flex flex-wrap gap-0.5 font-mono tracking-[0.15em]',
        size === 'sm' ? 'text-sm' : 'text-base'
      )}
    >
      {cells.map(({ id, ch, ok }) => (
        <span
          key={id}
          className={cn(ok ? 'text-good' : 'text-destructive font-semibold')}
        >
          {ch}
        </span>
      ))}
    </span>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function RedlinePage() {
  useDocumentHead({
    title: 'Redline',
    description:
      'Push your CW callsign copy to the redline — an adaptive-speed trainer that sends random amateur callsigns and scores accuracy plus speed.',
    path: '/redline',
  });

  const [settings, setSettings] = usePersistedState<RedlineSettings>(
    'morse:redline:settings',
    DEFAULT_REDLINE_SETTINGS,
    isSettings
  );
  const [volume, setVolume] = usePersistedState('morse:redline:volume', 0.85);
  const [state, setState] = useState<RedlineState>(() =>
    createInitialState(settings)
  );
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState<'log' | 'leaderboard'>('log');
  const [reloadToken, setReloadToken] = useState(0);
  const [posted, setPosted] = useState(false);

  // The embedded mini-board and the full /leaderboards/redline view share this
  // one adapter (one data source, two variants — see lib/leaderboard.ts).
  const board = useMemo(() => redlineBoard(), []);
  const [howOpen, setHowOpen] = usePersistedState(
    'morse:redline:how-it-works-open',
    true,
    (v): v is boolean => typeof v === 'boolean'
  );

  // A signed-in operator with a claimed callsign appears on the board under
  // that callsign (verified adds a shield). Everyone else can play and keep a
  // local best, but must sign in to claim a spot on the public toplist.
  const { status, user, profile } = useAuth();
  const signedIn = status === 'ready' && !!user && !!profile;
  const claimedCall = signedIn ? profile.call_sign : null;
  const isVerified = signedIn && profile.verified;
  const operatorCall = claimedCall ?? settings.userCall;

  const playerRef = useRef<CwPlayer | null>(null);
  if (!playerRef.current) playerRef.current = new CwPlayer();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Reconcile-on-open: a signed-in operator pushes their local best up first,
  // then we bump the board's reload token so the embedded view refetches with
  // the just-pushed row visible. The board fetch itself lives in
  // <LeaderboardView> (via the redlineBoard adapter) — same read path as the
  // full /leaderboards/redline view, no second fetch path.
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void reconcile().then(() => {
      if (!cancelled) setReloadToken((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  // iOS PWA resume / reconnect: refetch when the tab becomes visible again.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        setReloadToken((n) => n + 1);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const stats = calculateStats(state.attempts);
  const progress =
    state.phase === 'setup'
      ? `0 / ${settings.callsignCount}`
      : `${Math.min(state.index + 1, state.total)} / ${state.total}`;

  // Sticky focus: grab the copy input when a run starts. During the continuous
  // loop the input never blurs (its value just resets); practice mode refocuses
  // explicitly in `advance` after the disabled review input re-enables.
  useEffect(() => {
    if (state.phase === 'playing') inputRef.current?.focus();
  }, [state.phase]);

  // Release audio on unmount.
  useEffect(() => {
    const player = playerRef.current;
    return () => player?.dispose();
  }, []);

  function playCall(text: string, speed: number) {
    const player = playerRef.current;
    if (!player) return;
    setPlaying(true);
    const handle = player.play(text, {
      wpm: speed,
      frequency: settings.toneFrequency,
      volume,
    });
    void handle.done.then(() => {
      // Guard against a stale resolve when the next call has already started.
      if (!player.isPlaying) setPlaying(false);
    });
  }

  function start() {
    playerRef.current?.ensure();
    const first = generateCallsign();
    const next = startRun(settings, first, Date.now());
    setState(next);
    setPosted(false);
    setTab('log');
    setHowOpen(false); // collapse the primer — it's distracting mid-run
    playCall(first, next.speed);
  }

  function submit() {
    const s = stateRef.current;
    if (s.phase !== 'playing') return;
    if (s.reviewing) {
      advance();
      return;
    }
    const scored = submitAttempt(s, Date.now());
    if (s.settings.practiceMode) {
      playerRef.current?.stop();
      setState(scored);
      return;
    }
    if (scored.phase === 'done') {
      playerRef.current?.stop();
      setState(scored);
      setTab('log');
      return;
    }
    const next = generateCallsign();
    const advanced = beginNext(scored, next, Date.now());
    setState(advanced);
    playCall(next, advanced.speed);
  }

  function advance() {
    const s = stateRef.current;
    if (!s.reviewing) return;
    const isLast = s.index + 1 >= s.total;
    if (isLast) {
      setState(advanceFromReview(s, '', Date.now()));
      setTab('log');
      return;
    }
    const next = generateCallsign();
    const advanced = advanceFromReview(s, next, Date.now());
    setState(advanced);
    inputRef.current?.focus();
    playCall(next, advanced.speed);
  }

  function replay() {
    const s = stateRef.current;
    if (s.phase !== 'playing' || s.reviewing || s.replayed) return;
    setState(markReplayed(s));
    playCall(s.current, s.speed);
  }

  function endRun() {
    playerRef.current?.stop();
    const s = abortRun(stateRef.current);
    setState(s);
    if (s.phase === 'done') setTab('log');
  }

  function backToSetup() {
    playerRef.current?.stop();
    setState(createInitialState(settings));
    setPosted(false);
  }

  async function postRun() {
    const runStats = calculateStats(stateRef.current.attempts);
    writeLocalBest(runStats.score, runStats.topSpeed);
    if (!signedIn) return; // button is disabled when signed out
    setPosted(true);
    setTab('leaderboard');
    await publishScore(runStats.score, runStats.topSpeed);
    setReloadToken((n) => n + 1); // refetch so the new standing shows
  }

  // F5 (start) and F6 (replay) are global so they fire even when the copy input
  // isn't focused (e.g. on the setup screen). Enter/Space/Esc are handled on the
  // input itself. The listener binds once and reads the latest handlers through
  // a ref so it never goes stale.
  const handlersRef = useRef({ start, replay });
  handlersRef.current = { start, replay };
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'F5') {
        e.preventDefault();
        if (stateRef.current.phase === 'setup') handlersRef.current.start();
      } else if (e.key === 'F6') {
        if (stateRef.current.phase === 'playing') {
          e.preventDefault();
          handlersRef.current.replay();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function onInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setState((cur) => setTyped(cur, ''));
    }
  }

  // Sticky focus: a click on non-interactive chrome inside the trainer card
  // returns focus to the copy input. Bound natively (not via an onClick prop) so
  // the card stays a plain, non-interactive container for accessibility.
  const trainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = trainerRef.current;
    if (!el) return;
    const onClick = (e: globalThis.MouseEvent) => {
      if (stateRef.current.phase !== 'playing') return;
      const target = e.target as HTMLElement;
      if (
        target.closest(
          'button, a, input, select, [role="tab"], [role="slider"]'
        )
      )
        return;
      inputRef.current?.focus();
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, []);

  // Record the run's best locally as soon as it ends, so a later reconcile can
  // push it even if the operator never hits "Post". Improve-guarded, so the
  // repeated call while the summary is shown is a harmless no-op.
  useEffect(() => {
    if (state.phase !== 'done') return;
    const s = calculateStats(state.attempts);
    writeLocalBest(s.score, s.topSpeed);
  }, [state.phase, state.attempts]);

  // Freshen the board when the operator opens the Leaderboard tab.
  useEffect(() => {
    if (tab === 'leaderboard') setReloadToken((n) => n + 1);
  }, [tab]);

  // The trainer card swaps contents between phases; a labeled header keeps the
  // operator oriented as it changes.
  const phaseMeta = {
    setup: { icon: Settings2, label: 'Setup' },
    playing: { icon: RadioTower, label: 'Playing' },
    done: { icon: Trophy, label: 'Results' },
  }[state.phase];
  const PhaseIcon = phaseMeta.icon;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-10">
      <PageHeader eyebrow="Redline" icon={Gauge} title="Callsign trainer">
        Copy random callsigns in CW at the edge of your speed.
      </PageHeader>

      <HowItWorks open={howOpen} onToggle={() => setHowOpen((o) => !o)} />

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Progress" value={progress} icon={Hash} />
        <StatTile
          label="Speed"
          value={`${state.speed} WPM`}
          icon={Zap}
          tone="dial"
        />
        <StatTile
          label="Score"
          value={String(state.score)}
          icon={Star}
          tone="good"
        />
        <StatTile
          label="Accuracy"
          value={`${Math.round(stats.accuracy)}%`}
          icon={Target}
          tone="primary"
        />
      </div>

      <div
        ref={trainerRef}
        className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
      >
        <div className="flex items-center gap-2 border-b border-border px-5 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          <PhaseIcon className="size-3.5 text-primary" />
          {phaseMeta.label}
        </div>
        <div className="p-5">
          {state.phase === 'setup' && (
            <SetupForm
              settings={settings}
              setSettings={setSettings}
              claimedCall={claimedCall}
              verified={isVerified}
              onStart={start}
            />
          )}

          {state.phase === 'playing' && (
            <div className="grid gap-4">
              <div className="flex items-center justify-between gap-3">
                <span
                  className={cn(
                    'font-mono text-[11px] uppercase tracking-wide',
                    state.reviewing ? 'text-primary' : 'text-dial'
                  )}
                >
                  {state.reviewing
                    ? '⏸ Reviewing'
                    : playing
                      ? '● Receiving'
                      : '○ Idle'}
                </span>
                <div className="flex items-center gap-3">
                  <VolumeControl volume={volume} onChange={setVolume} />
                  <ShortcutsHelp size="sm" />
                </div>
              </div>
              <Oscilloscope
                analyser={playerRef.current?.getAnalyser() ?? null}
                active={playing}
              />

              <div className="grid gap-2">
                <div className="flex items-baseline justify-between">
                  <Label htmlFor="redline-copy">Your copy</Label>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {state.speed} WPM
                    {state.replayed && ' · replayed'}
                  </span>
                </div>
                <Input
                  ref={inputRef}
                  id="redline-copy"
                  value={state.typed}
                  disabled={state.reviewing}
                  onChange={(e) => {
                    // Capture before the updater runs — React nulls currentTarget
                    // once the handler returns, and setState may defer the call.
                    const v = e.currentTarget.value;
                    setState((cur) => setTyped(cur, v));
                  }}
                  onKeyDown={onInputKeyDown}
                  className="h-14 font-mono text-3xl uppercase tracking-[0.2em]"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  aria-label="Type the callsign you copied"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {state.reviewing ? (
                  <Button type="button" onClick={advance}>
                    <Play className="size-4" />
                    Next callsign
                    <BtnKbd>Enter</BtnKbd>
                  </Button>
                ) : (
                  <Button type="button" onClick={submit}>
                    <Check className="size-4" />
                    Submit
                    <BtnKbd>Enter</BtnKbd>
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={replay}
                  disabled={state.replayed || state.reviewing || playing}
                >
                  <RotateCcw className="size-4" />
                  {state.replayed ? 'Replayed' : 'Replay'}
                  {!state.replayed && <BtnKbd>F6</BtnKbd>}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={endRun}
                  className="ml-auto"
                >
                  <Flag className="size-4" />
                  Finish
                </Button>
              </div>

              <LastStrip state={state} />

              {state.reviewing && (
                <p className="flex flex-wrap items-center justify-center gap-1.5 rounded-lg bg-primary/5 px-4 py-2.5 text-center text-sm text-muted-foreground">
                  Practice mode — study the call above, then press
                  <Kbd>Enter</Kbd> (or{' '}
                  <span className="font-medium">Next callsign</span>) for the
                  next one.
                </p>
              )}
            </div>
          )}

          {state.phase === 'done' && (
            <RunSummary
              state={state}
              operatorCall={operatorCall}
              posted={posted}
              signedIn={signedIn}
              onAgain={start}
              onBackToSetup={backToSetup}
              onPost={postRun}
            />
          )}
        </div>
      </div>

      {/* Copy log + Leaderboard tabs */}
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as 'log' | 'leaderboard')}
      >
        <TabsList variant="line">
          <TabsTrigger
            value="log"
            className="cursor-pointer data-[state=active]:text-primary data-[state=active]:after:bg-primary"
          >
            <ListChecks className="size-4" />
            Copy log
          </TabsTrigger>
          <TabsTrigger
            value="leaderboard"
            className="cursor-pointer data-[state=active]:text-primary data-[state=active]:after:bg-primary"
          >
            <Trophy className="size-4" />
            Leaderboard
          </TabsTrigger>
        </TabsList>

        <TabsContent value="log">
          <CopyLog state={state} stats={stats} />
        </TabsContent>

        <TabsContent value="leaderboard">
          <LeaderboardView
            board={board}
            ownCallSign={claimedCall}
            reloadToken={reloadToken}
            variant="embedded"
            fullStandingsHref="/leaderboards/redline"
          />
          {!signedIn && (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              <NavLink
                to="/account"
                className="underline-offset-2 hover:text-foreground hover:underline"
              >
                Sign in
              </NavLink>{' '}
              and post a run to earn your ranking.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
}

// ── Setup form ───────────────────────────────────────────────────────────────

function NumberField({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const n = Number(e.currentTarget.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
      />
    </div>
  );
}

function SetupForm({
  settings,
  setSettings,
  claimedCall,
  verified,
  onStart,
}: {
  settings: RedlineSettings;
  setSettings: (
    updater: RedlineSettings | ((cur: RedlineSettings) => RedlineSettings)
  ) => void;
  /** When set, the operator is signed in — show their claimed callsign
   *  read-only (it's their board identity); a shield marks it if verified. */
  claimedCall: string | null;
  verified: boolean;
  onStart: () => void;
}) {
  return (
    <div className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <NumberField
          id="redline-start-speed"
          label="Start speed (WPM)"
          value={settings.startSpeed}
          min={5}
          max={70}
          onChange={(startSpeed) =>
            setSettings((cur) => ({ ...cur, startSpeed }))
          }
        />
        <NumberField
          id="redline-count"
          label="Callsigns"
          value={settings.callsignCount}
          min={5}
          max={100}
          onChange={(callsignCount) =>
            setSettings((cur) => ({ ...cur, callsignCount }))
          }
        />
        <NumberField
          id="redline-tone"
          label="Tone (Hz)"
          value={settings.toneFrequency}
          min={300}
          max={1000}
          step={10}
          onChange={(toneFrequency) =>
            setSettings((cur) => ({ ...cur, toneFrequency }))
          }
        />
        <div className="grid gap-2">
          <Label htmlFor="redline-speed-mode">Speed mode</Label>
          <Select
            value={settings.speedMode}
            onValueChange={(speedMode: RedlineSpeedMode) =>
              setSettings((cur) => ({ ...cur, speedMode }))
            }
          >
            <SelectTrigger id="redline-speed-mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="adaptive">Adaptive</SelectItem>
              <SelectItem value="fixed">Fixed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="redline-user-call">
          {claimedCall ? 'Your callsign' : 'Your callsign (optional)'}
        </Label>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {claimedCall ? (
            <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-muted/40 px-3 font-mono text-sm uppercase tracking-widest sm:max-w-xs">
              <span className="text-foreground">{claimedCall}</span>
              {verified && (
                <>
                  <ShieldCheck
                    className="size-3.5 text-verified"
                    aria-label="Verified"
                  />
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Verified
                  </span>
                </>
              )}
            </div>
          ) : (
            <Input
              id="redline-user-call"
              value={settings.userCall}
              onChange={(e) => {
                const v = normalizeCallsign(e.currentTarget.value);
                setSettings((cur) => ({ ...cur, userCall: v }));
              }}
              className="font-mono uppercase tracking-widest sm:max-w-xs"
              placeholder="N0CALL"
            />
          )}
          <div className="flex items-center gap-2.5 text-sm">
            <Switch
              id="redline-practice"
              checked={settings.practiceMode}
              onCheckedChange={(practiceMode) =>
                setSettings((cur) => ({ ...cur, practiceMode }))
              }
            />
            <Label htmlFor="redline-practice" className="font-normal">
              <span className="font-medium text-foreground">Practice mode</span>
              <span className="block text-xs text-muted-foreground">
                Pause and reveal each call before the next.
              </span>
            </Label>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button type="button" onClick={onStart}>
          <Play className="size-4" />
          Start
          <BtnKbd>F5</BtnKbd>
        </Button>
        <ShortcutsHelp />
      </div>
    </div>
  );
}

// ── Last callsign strip ──────────────────────────────────────────────────────

function LastStrip({ state }: { state: RedlineState }) {
  const last = state.last;
  if (!last) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
        Last callsign will appear here after your first submit.
      </div>
    );
  }
  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3',
        last.perfect
          ? 'border-good/40 bg-good/5'
          : 'border-destructive/40 bg-destructive/5'
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DiffCallsign sent={last.sent} received={last.received} />
        <span
          className={cn(
            'font-mono text-sm font-semibold',
            last.perfect ? 'text-good' : 'text-destructive'
          )}
        >
          {last.perfect ? 'Clean copy' : `${last.errors} err`}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
        <span>{last.speed} WPM</span>
        <span>
          +{last.points} / {last.maxPoints} pts
        </span>
        {last.replayed && <span className="text-dial">replayed</span>}
        <span>{last.timeMs} ms</span>
      </div>
    </div>
  );
}

// ── Run summary ──────────────────────────────────────────────────────────────

function RunSummary({
  state,
  operatorCall,
  posted,
  signedIn,
  onAgain,
  onBackToSetup,
  onPost,
}: {
  state: RedlineState;
  operatorCall: string;
  posted: boolean;
  signedIn: boolean;
  onAgain: () => void;
  onBackToSetup: () => void;
  onPost: () => void;
}) {
  const stats = calculateStats(state.attempts);
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-baseline gap-2.5">
          <span className="font-mono text-4xl font-bold text-good">
            {state.score}
          </span>
          <span className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            points
          </span>
        </div>
        <div className="font-mono text-sm text-muted-foreground">
          <span className="font-semibold tracking-wider text-foreground">
            {operatorCall || 'Operator'}
          </span>
          <span className="mx-2 text-border">·</span>
          {stats.perfect}/{stats.attempts} clean
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Accuracy"
          value={`${Math.round(stats.accuracy)}%`}
          icon={Target}
          tone="primary"
        />
        <StatTile
          label="Top speed"
          value={`${stats.topSpeed} WPM`}
          icon={Zap}
          tone="dial"
        />
        <StatTile
          label="Perfect"
          value={`${stats.perfect}`}
          icon={Check}
          tone="good"
        />
        <StatTile label="Errors" value={`${stats.totalErrors}`} icon={X} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={onAgain}>
          <Play className="size-4" />
          Start again
        </Button>
        <Button type="button" variant="secondary" onClick={onBackToSetup}>
          <Settings2 className="size-4" />
          Setup
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onPost}
          disabled={!signedIn || posted}
          className="ml-auto"
        >
          <Trophy className="size-4" />
          {posted ? 'Posted' : 'Post to toplist'}
        </Button>
      </div>
      {!signedIn && (
        <p className="text-xs text-muted-foreground">
          <NavLink
            to="/account"
            className="underline-offset-2 hover:text-foreground hover:underline"
          >
            Sign in
          </NavLink>{' '}
          to post your score to the public toplist.
        </p>
      )}
    </div>
  );
}

// ── Copy log ─────────────────────────────────────────────────────────────────

function CopyLog({
  state,
  stats,
}: {
  state: RedlineState;
  stats: ReturnType<typeof calculateStats>;
}) {
  const rows = [...state.attempts].reverse();
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
        <span>{stats.attempts} attempts</span>
        <span className="flex gap-3">
          <span className="text-good">{stats.perfect} clean</span>
          <span className="text-destructive">
            {stats.attempts - stats.perfect} missed
          </span>
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          No attempts yet — start a run to fill the log.
        </div>
      ) : (
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-card text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border text-left">
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">Callsign</th>
                <th className="px-4 py-2 font-medium">Your copy</th>
                <th className="px-4 py-2 text-right font-medium">WPM</th>
                <th className="px-4 py-2 text-right font-medium">Pts</th>
                <th className="px-4 py-2 text-right font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr
                  key={a.index}
                  className="border-b border-border/60 last:border-0"
                >
                  <td className="px-4 py-2 font-mono text-muted-foreground">
                    {a.index + 1}
                  </td>
                  <td className="px-4 py-2">
                    <DiffCallsign
                      sent={a.sent}
                      received={a.received}
                      size="sm"
                    />
                  </td>
                  <td className="px-4 py-2 font-mono tracking-wider text-muted-foreground">
                    {a.received || '—'}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-dial">
                    {a.speed}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-good">
                    {a.points}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {a.perfect ? (
                      <span className="text-good">clean</span>
                    ) : (
                      <span className="text-destructive">{a.errors} err</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
