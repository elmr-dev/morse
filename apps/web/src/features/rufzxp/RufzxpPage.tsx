// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AudioLines,
  Gauge,
  Loader2,
  Play,
  RotateCcw,
  Square,
  Trophy,
} from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { generateAudio } from '@/inference/generate';
import { useDocumentHead } from '@/lib/use-document-head';
import { usePersistedState } from '@/lib/use-persisted-state';
import { cn } from '@/lib/utils';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { loadRufzxpCallsigns, pickRufzxpCallsigns } from './callsigns';
import {
  calculateStats,
  createInitialState,
  normalizeCallsign,
  startGame,
  submitAnswer,
} from './game';
import {
  DEFAULT_RUFZXP_SETTINGS,
  type RufzxpSettings,
  type RufzxpSpeedMode,
  type RufzxpState,
} from './types';

function isSettings(value: unknown): value is RufzxpSettings {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.userCall === 'string' &&
    typeof v.startSpeed === 'number' &&
    typeof v.toneFrequency === 'number' &&
    typeof v.callsignsPerAttempt === 'number' &&
    (v.speedMode === 'adaptive' || v.speedMode === 'fixed')
  );
}

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
  onChange: (value: number) => void;
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
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (Number.isFinite(next))
            onChange(Math.min(max, Math.max(min, next)));
        }}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'dial' | 'good';
}) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <div className="text-[11px] font-medium uppercase text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          'mt-1 font-mono text-xl font-semibold text-foreground',
          tone === 'dial' && 'text-dial-strong',
          tone === 'good' && 'text-good'
        )}
      >
        {value}
      </div>
    </div>
  );
}

function ResultMark({ sent, received }: { sent: string; received: string }) {
  const normalized = normalizeCallsign(received);
  const max = Math.max(sent.length, normalized.length);
  const cells = Array.from({ length: max }, (_, position) => ({
    id: `${position}:${sent[position] ?? ''}:${normalized[position] ?? '_'}`,
    actual: normalized[position] ?? '_',
    expected: sent[position] ?? '',
  }));

  return (
    <div className="flex flex-wrap gap-1 font-mono text-sm">
      {cells.map(({ id, actual, expected }) => {
        const ok = actual === expected;
        return (
          <span
            key={id}
            className={cn(
              'inline-flex min-w-6 justify-center rounded-sm border px-1 py-0.5',
              ok
                ? 'border-good/30 bg-good/10 text-good'
                : 'border-bad/30 bg-bad/10 text-bad'
            )}
          >
            {actual}
          </span>
        );
      })}
    </div>
  );
}

export default function RufzxpPage() {
  useDocumentHead({
    title: 'RufZXP',
    description:
      'A RufZXP-style callsign copying trainer with adaptive speed and classic scoring.',
    path: '/rufzxp',
  });

  const [settings, setSettings] = usePersistedState<RufzxpSettings>(
    'morse:rufzxp:settings',
    DEFAULT_RUFZXP_SETTINGS,
    isSettings
  );
  const [state, setState] = useState<RufzxpState>(() =>
    createInitialState(settings)
  );
  const [callsignPool, setCallsignPool] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = usePersistedState('morse:rufzxp:volume', 0.9);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const stats = calculateStats(state.results);
  const progress =
    state.phase === 'playing'
      ? `${state.callsignIndex + 1} / ${state.callsigns.length}`
      : `${state.results.length} / ${state.settings.callsignsPerAttempt}`;

  useEffect(() => {
    if (state.phase === 'playing') inputRef.current?.focus();
  }, [state.phase]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadRufzxpCallsigns()
      .then((pool) => {
        if (!cancelled) setCallsignPool(pool);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function playSignal({
    callsign,
    speed,
    frequency,
    markReplay,
  }: {
    callsign: string;
    speed: number;
    frequency: number;
    markReplay: boolean;
  }) {
    audioRef.current?.pause();
    const clip = generateAudio({
      text: callsign,
      wpm: speed,
      frequency,
      snrDb: 50,
    });
    const audio = new Audio(clip.dataUri);
    audio.volume = volume;
    audioRef.current = audio;

    setState((current) => ({
      ...current,
      isPlaying: true,
      hasReplayed: current.hasReplayed || markReplay,
      callsignStartedAt: current.callsignStartedAt ?? Date.now(),
    }));

    try {
      await audio.play();
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onpause = () => resolve();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      audio.onended = null;
      setState((current) => ({ ...current, isPlaying: false }));
    }
  }

  async function playCurrent(replay: boolean) {
    if (!state.currentCallsign || state.isPlaying) return;
    if (replay && state.hasReplayed) return;

    await playSignal({
      callsign: state.currentCallsign,
      speed: state.currentSpeed,
      frequency: state.settings.toneFrequency,
      markReplay: replay,
    });
  }

  async function handleStart() {
    setLoading(true);
    setError(null);
    try {
      const pool = callsignPool ?? (await loadRufzxpCallsigns());
      setCallsignPool(pool);
      const callsigns = pickRufzxpCallsigns(pool, settings.callsignsPerAttempt);
      const next = startGame(callsigns, settings);
      setState(next);
      if (next.currentCallsign) {
        window.setTimeout(
          () =>
            void playSignal({
              callsign: next.currentCallsign,
              speed: next.currentSpeed,
              frequency: next.settings.toneFrequency,
              markReplay: false,
            }),
          0
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = submitAnswer(state);
    setState(next);
    if (next.phase === 'playing' && next.currentCallsign) {
      window.setTimeout(
        () =>
          void playSignal({
            callsign: next.currentCallsign,
            speed: next.currentSpeed,
            frequency: next.settings.toneFrequency,
            markReplay: false,
          }),
        0
      );
    }
  }

  function reset() {
    audioRef.current?.pause();
    setState(createInitialState(settings));
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 pb-8">
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-4">
          <div>
            <div className="flex items-center gap-2 text-dial-strong">
              <AudioLines className="size-5" />
              <span className="font-mono text-sm font-semibold uppercase">
                RufZXP
              </span>
            </div>
            <h1 className="mt-2 text-3xl font-bold tracking-normal text-foreground sm:text-4xl">
              Callsign trainer
            </h1>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Progress" value={progress} />
            <Stat
              label="Speed"
              value={`${state.currentSpeed} WPM`}
              tone="dial"
            />
            <Stat label="Score" value={String(stats.totalScore)} tone="good" />
            <Stat label="Accuracy" value={`${Math.round(stats.accuracy)}%`} />
          </div>

          <div className="rounded-md border border-border bg-card p-4 shadow-sm">
            {state.phase === 'setup' && (
              <div className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <NumberField
                    id="rufz-start-speed"
                    label="Start speed"
                    value={settings.startSpeed}
                    min={5}
                    max={80}
                    onChange={(startSpeed) =>
                      setSettings((current) => ({ ...current, startSpeed }))
                    }
                  />
                  <NumberField
                    id="rufz-count"
                    label="Callsigns"
                    value={settings.callsignsPerAttempt}
                    min={5}
                    max={100}
                    onChange={(callsignsPerAttempt) =>
                      setSettings((current) => ({
                        ...current,
                        callsignsPerAttempt,
                      }))
                    }
                  />
                  <NumberField
                    id="rufz-tone"
                    label="Tone"
                    value={settings.toneFrequency}
                    min={300}
                    max={1000}
                    step={10}
                    onChange={(toneFrequency) =>
                      setSettings((current) => ({
                        ...current,
                        toneFrequency,
                      }))
                    }
                  />
                  <div className="grid gap-2">
                    <Label htmlFor="rufz-speed-mode">Speed mode</Label>
                    <Select
                      value={settings.speedMode}
                      onValueChange={(speedMode: RufzxpSpeedMode) =>
                        setSettings((current) => ({ ...current, speedMode }))
                      }
                    >
                      <SelectTrigger id="rufz-speed-mode" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="adaptive">Adaptive</SelectItem>
                        <SelectItem value="fixed">Fixed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-2 sm:max-w-xs">
                  <Label htmlFor="rufz-user-call">Call</Label>
                  <Input
                    id="rufz-user-call"
                    value={settings.userCall}
                    onChange={(event) => {
                      const userCall = normalizeCallsign(
                        event.currentTarget.value
                      );
                      setSettings((current) => ({
                        ...current,
                        userCall,
                      }));
                    }}
                    className="font-mono uppercase"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    onClick={handleStart}
                    disabled={loading || !callsignPool}
                  >
                    {loading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Play className="size-4" />
                    )}
                    Start
                  </Button>
                  {error && (
                    <span className="text-sm text-bad" role="alert">
                      {error}
                    </span>
                  )}
                </div>
              </div>
            )}

            {state.phase === 'playing' && (
              <form onSubmit={handleSubmit} className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="rufz-answer">Copy</Label>
                  <Input
                    ref={inputRef}
                    id="rufz-answer"
                    value={state.userAnswer}
                    onChange={(event) => {
                      const userAnswer = normalizeCallsign(
                        event.currentTarget.value
                      );
                      setState((current) => ({
                        ...current,
                        userAnswer,
                      }));
                    }}
                    className="h-14 font-mono text-3xl uppercase tracking-normal"
                    autoComplete="off"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" disabled={!state.userAnswer}>
                    <Square className="size-4" />
                    Enter
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void playCurrent(false)}
                    disabled={state.isPlaying}
                  >
                    <Play className="size-4" />
                    Play
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void playCurrent(true)}
                    disabled={state.isPlaying || state.hasReplayed}
                  >
                    <RotateCcw className="size-4" />
                    Replay
                  </Button>
                  <Button type="button" variant="ghost" onClick={reset}>
                    Abort
                  </Button>
                </div>
              </form>
            )}

            {state.phase === 'results' && (
              <div className="grid gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-md bg-dial/10 text-dial-strong">
                    <Trophy className="size-5" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-foreground text-xl">
                      {settings.userCall || 'Operator'}: {stats.totalScore}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {stats.correctCount} of {stats.totalCount} copied, peak{' '}
                      {stats.peakSpeed} WPM
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="button" onClick={handleStart}>
                    <Play className="size-4" />
                    Again
                  </Button>
                  <Button type="button" variant="secondary" onClick={reset}>
                    Settings
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <aside className="flex flex-col gap-3">
          <div className="rounded-md border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2 text-foreground">
              <Gauge className="size-4 text-muted-foreground" />
              <h2 className="font-semibold">Session</h2>
            </div>
            <div className="mt-3 grid gap-2 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Mode</span>
                <span className="font-mono">{state.settings.speedMode}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Start</span>
                <span className="font-mono">
                  {stats.startSpeed || settings.startSpeed} WPM
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">End</span>
                <span className="font-mono">
                  {stats.endSpeed || state.currentSpeed} WPM
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="rufz-volume" className="text-muted-foreground">
                  Volume
                </Label>
                <Input
                  id="rufz-volume"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  onChange={(event) => {
                    const next = Number(event.currentTarget.value);
                    if (Number.isFinite(next)) {
                      setVolume(Math.min(1, Math.max(0, next)));
                    }
                  }}
                  className="h-8 w-20 text-right"
                />
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-md border border-border bg-card shadow-sm">
            <div className="border-b border-border px-4 py-3 font-semibold">
              Copy log
            </div>
            <div className="max-h-[30rem] overflow-auto">
              {state.results.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">
                  No attempts yet.
                </div>
              ) : (
                <ol className="divide-y divide-border">
                  {state.results
                    .slice()
                    .reverse()
                    .map((result) => (
                      <li key={result.index} className="grid gap-2 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-mono font-semibold">
                            {result.sent}
                          </span>
                          <span className="font-mono text-dial-strong">
                            {result.points}
                          </span>
                        </div>
                        <ResultMark
                          sent={result.sent}
                          received={result.received}
                        />
                        <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                          <span>{result.speed} WPM</span>
                          <span>
                            {result.errors} errors
                            {result.replayed ? ', replayed' : ''}
                          </span>
                        </div>
                      </li>
                    ))}
                </ol>
              )}
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
