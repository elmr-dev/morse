// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LucideIcon } from 'lucide-react';
import {
  Bot,
  Cpu,
  Crown,
  Eye,
  GitMerge,
  Headphones,
  Loader2,
  Lock,
  Play,
  RadioTower,
  ScanEye,
  Send,
  Shuffle,
  TriangleAlert,
  Trophy,
  User,
} from 'lucide-react';
import { calculateDuration, translate } from 'morse-audio';
import { Fragment, useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { BoxingGloveIcon } from '@/components/boxing-glove-icon';
import PageHeader from '@/components/page-header';
import { usePrefersReducedMotion } from '@/components/presence';
import SyncStatus from '@/components/sync-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import VolumeControl from '@/components/volume-control';
import { fireConfetti } from '@/lib/confetti';
import { randomCwMessage } from '@/lib/cw-message';
import { useBestsSync } from '@/lib/use-bests-sync';
import { useDocumentHead } from '@/lib/use-document-head';
import { clearPersisted, usePersistedState } from '@/lib/use-persisted-state';
import {
  applyRound,
  BESTS_STORAGE_KEY,
  type Bests,
  BOT_REF,
  EMPTY_BESTS,
  isBests,
  TIERS,
  type Tier,
} from '../inference/beat-the-bot';
import {
  callsignCountry,
  callsignRegion,
  randomCallsign,
} from '../inference/callsign';
import { accuracy } from '../inference/decode';
import {
  type DualDecodeResult,
  decodeDualCallsignDataUri,
} from '../inference/dual-decode';
import { generateAudio } from '../inference/generate';
import { loadSession } from '../inference/onnx';
import { decodeDataUri, type PipelineResult } from '../inference/pipeline';

const TONE_FREQ = 700;
// Reveal staging timings (ms). Per-character typing cadence, the bar-race
// easing, and a small pause between stages so each beat reads on its own.
const CHAR_MS = 95;
const BAR_MS = 1300;
const STAGE_PAD = 250;

type Phase = 'armed' | 'copying' | 'reveal';

// The round's copy is either a real callsign (keyed twice, with a country) or a
// random on-air group reused from DecodePage's generator (keyed once, no origin).
type TextMode = 'callsigns' | 'random';

interface Round {
  text: string; // the truth — single callsign, or the random string
  mode: TextMode;
  region: 'US' | 'Canada' | 'World'; // callsign rounds only; unused for random
  tier: Tier['id'];
  human: { wpm: number; snr: number; dataUri: string }; // what the player hears
  bot: { wpm: number; snr: number; dataUri: string }; // what the bot decodes
}

// The model envelope tops out at MAX_FRAMES / ENVELOPE_SR = 16 s (see onnx.ts);
// past that runInference *throws* (it doesn't silently truncate). The slowest
// tier (No-Code, 13 WPM) produces the LONGEST clip, so if a single send fits the
// envelope there, it fits at every faster tier — and the bot's fixed 28 WPM
// decode clip (the only clip actually fed to the model) clears it with room to
// spare (~7 s vs 16 s). randomCwMessage caps at 40 chars, which at 13 WPM can run
// to ~24 s, so we reject over-budget candidates and regenerate.
const SLOWEST_WPM = 13;
const CLIP_BUDGET_SEC = 15; // 16 s envelope − ~1 s (≈0.4 s generator padding + margin)

// Keyed duration (seconds) of one send of `text` at `wpm`, from the same element
// timing the generator uses — no audio synthesis needed.
function keyedDurationSec(text: string, wpm: number): number {
  return calculateDuration(translate(text, wpm, wpm).timings);
}

// A random on-air group from DecodePage's generator, length-bounded so its single
// send stays inside the 16 s envelope at the slowest tier (avg ~2 tries).
function randomString(): string {
  for (let i = 0; i < 40; i++) {
    const msg = randomCwMessage();
    if (keyedDurationSec(msg, SLOWEST_WPM) <= CLIP_BUDGET_SEC) return msg;
  }
  return 'CQ TEST'; // guaranteed-short fallback (~2 s at 13 WPM)
}

// Format an SNR value with sign: +10, −6, +0, etc. (proper minus sign).
function formatSnr(snr: number): string {
  if (snr >= 0) return `+${snr}`;
  return `−${Math.abs(snr)}`;
}

// Strip spaces for grading and alignment. CW word gaps are a reading aid — the
// model's charset has no space, so it never emits one (same rule as DecodePage).
// Random messages carry spaces; callsigns don't. Grading letters-only keeps both
// sides fair (the bot isn't dinged for gaps it can't key) and lets the player
// type word breaks or not. The spaced text is still shown verbatim on reveal.
function lettersOnly(s: string): string {
  return s.replace(/\s+/g, '');
}

function randomRound(tier: Tier, mode: TextMode): Round {
  // Callsigns are keyed twice (the on-air convention — you send a call twice so
  // the other op catches it); random groups are sent once, as they would be.
  const text = mode === 'callsigns' ? randomCallsign() : randomString();
  const region = mode === 'callsigns' ? callsignRegion(text) : 'World';
  const sentText = mode === 'callsigns' ? `${text} ${text}` : text;
  const human = generateAudio({
    text: sentText,
    wpm: tier.wpm,
    snrDb: tier.snr,
    frequency: TONE_FREQ,
  });
  const bot = generateAudio({
    text: sentText,
    wpm: BOT_REF.wpm,
    snrDb: BOT_REF.snr,
    frequency: TONE_FREQ,
  });
  return {
    text,
    mode,
    region,
    tier: tier.id,
    human: { wpm: tier.wpm, snr: tier.snr, dataUri: human.dataUri },
    bot: { wpm: BOT_REF.wpm, snr: BOT_REF.snr, dataUri: bot.dataUri },
  };
}

const REGION_LABEL: Record<Round['region'], string> = {
  US: 'United States',
  Canada: 'Canada',
  World: 'International',
};

// Resolve the round's call to a flag + country pill. Prefer the ITU prefix
// table (real country); fall back to the broad region label (with a globe) when
// the prefix doesn't resolve. The flag is garnish — the name pill is the signal.
function originDisplay(round: Round): { flag: string; name: string } {
  const c = callsignCountry(round.text);
  if (c) return { flag: c.flag, name: c.country };
  return {
    flag: round.region === 'World' ? '🌐' : '',
    name: REGION_LABEL[round.region],
  };
}

export default function BeatTheBotPage() {
  useDocumentHead({
    title: 'Beat the Bot',
    description:
      'One callsign buried in static — pick your license class, copy an eased signal, and out-copy a neural CW decoder working from a brutal one.',
    path: '/beat-the-bot',
  });

  const reduce = usePrefersReducedMotion();

  const [activeTier, setActiveTier] = usePersistedState<Tier['id']>(
    'morse:btb:tier',
    'technician'
  );
  const [bests, setBests] = usePersistedState<Bests>(
    BESTS_STORAGE_KEY,
    EMPTY_BESTS,
    isBests
  );
  const [textMode, setTextMode] = usePersistedState<TextMode>(
    'morse:btb:textmode',
    'callsigns'
  );

  // Cloud sync (slice 4). Page-scoped: the only triggers that fire while this
  // page is mounted are sign-in / online / visibilitychange. That's fine — bests
  // are only earned here, and the sign-in reconcile catches anything missed
  // next visit. A future leaderboard route should also call syncNow() on entry.
  const { syncNow } = useBestsSync(bests, setBests);

  const tierObj = TIERS.find((t) => t.id === activeTier) ?? TIERS[2];

  const [phase, setPhase] = useState<Phase>('armed');
  const [round, setRound] = useState<Round | null>(null);
  const [guess, setGuess] = useState('');
  const [played, setPlayed] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [botLocked, setBotLocked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Callsign rounds dual-decode (two looks merged); random rounds single-decode.
  // Both shapes expose `.text` and `.envelopeBars`, which is all the reveal needs.
  const [botResult, setBotResult] = useState<
    DualDecodeResult | PipelineResult | null
  >(null);
  const [isNewBest, setIsNewBest] = useState(false);
  // 0 = nothing, 1 = your copy typed, 2 = bot copy typed, 3 = bars race,
  // 4 = gap + best.
  const [revealStep, setRevealStep] = useState(0);

  const [volume, setVolume] = useState(() => {
    const stored = parseFloat(localStorage.getItem('audioVolume') ?? '');
    return Number.isNaN(stored) ? 1 : stored;
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // The bot's decode lives only here until submit — never in state during the
  // copying phase, so its text can't leak into the DOM (anti-cheat).
  const botPromiseRef = useRef<Promise<
    DualDecodeResult | PipelineResult
  > | null>(null);
  const timers = useRef<number[]>([]);

  function clearTimers() {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  }

  // One-time cleanup of retired persisted keys from the old win/loss model.
  useEffect(() => {
    clearPersisted('beat.score', 'beat.streak');
  }, []);

  useEffect(() => {
    loadSession()
      .then(() => setModelReady(true))
      .catch((e) => setError(String(e)));
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only round init — double-rAF guarantees the browser paints the skeleton before the synchronous audio generation blocks the main thread
  useEffect(() => {
    // Honor a `?tier=` deep-link (e.g. from the leaderboard's "rank here"
    // CTA) before the first round generates, so the user lands on the
    // requested tier with no flicker. We strip the param after consuming it
    // so a reload doesn't keep overriding the user's later tier choices.
    let startTier = tierObj;
    try {
      const url = new URL(window.location.href);
      const param = url.searchParams.get('tier');
      const match = param ? TIERS.find((t) => t.id === param) : null;
      if (match) {
        startTier = match;
        if (match.id !== activeTier) setActiveTier(match.id);
        url.searchParams.delete('tier');
        window.history.replaceState({}, '', url.toString());
      }
    } catch {
      // Bad URL / no window — fall through to the persisted tier.
    }

    let r1: number;
    let r2: number;
    r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() =>
        setRound(randomRound(startTier, textMode))
      );
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, []);

  // Clear any pending reveal timers on unmount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: clearTimers only touches a ref; run once
  useEffect(() => () => clearTimers(), []);

  // Keep the audio element's volume in sync.
  // biome-ignore lint/correctness/useExhaustiveDependencies: audioRef is a stable ref
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume, round]);

  // Focus the copy field as soon as the player starts copying.
  useEffect(() => {
    if (phase === 'copying') inputRef.current?.focus();
  }, [phase]);

  function onVolumeChange(v: number) {
    setVolume(v);
    localStorage.setItem('audioVolume', String(v));
  }

  function onPlay() {
    if (!audioRef.current || !round || !modelReady || played || isPlaying)
      return;
    setPlayed(true);
    setIsPlaying(true);
    const audio = audioRef.current;
    audio.currentTime = 0;
    // Hold "copying…" until the clip finishes, then flip to "locked" — the
    // decode resolves much faster, but locking at clip-end keeps the bot's
    // copy feeling like it took the whole transmission (and stays sealed).
    const lockIn = () => {
      setIsPlaying(false);
      setBotLocked(true);
    };
    const onEnd = () => {
      audio.removeEventListener('ended', onEnd);
      lockIn();
    };
    audio.addEventListener('ended', onEnd);
    const playResult = audio.play();
    // If playback can't start (e.g. autoplay blocked), don't strand the panel
    // in the copying state — lock immediately so the round can still proceed.
    if (playResult?.catch) playResult.catch(lockIn);

    // Seal the bot's copy against its harder clip. Store only the promise; its
    // text never reaches state (and so never the DOM) until the player submits.
    // Callsigns are sent twice → dual-look merge; random groups are sent once →
    // a single decode, the same copy a human gets.
    const p =
      round.mode === 'callsigns'
        ? decodeDualCallsignDataUri(round.bot.dataUri, TONE_FREQ)
        : decodeDataUri(round.bot.dataUri, TONE_FREQ);
    botPromiseRef.current = p;
    p.catch(() => {});

    setPhase('copying');
  }

  function startReveal(userText: string, botText: string, newBest: boolean) {
    if (!round) return;
    clearTimers();
    if (reduce) {
      setRevealStep(4);
      if (newBest) fireConfetti();
      return;
    }
    const truth = lettersOnly(round.text);
    const userLen = alignChars(userText, truth).length;
    const botLen = alignChars(botText, truth).length;
    setRevealStep(1);
    const id1 = window.setTimeout(
      () => {
        setRevealStep(2);
        const id2 = window.setTimeout(
          () => {
            setRevealStep(3);
            const id3 = window.setTimeout(() => {
              setRevealStep(4);
              if (newBest) fireConfetti();
            }, BAR_MS + STAGE_PAD);
            timers.current.push(id3);
          },
          botLen * CHAR_MS + STAGE_PAD
        );
        timers.current.push(id2);
      },
      userLen * CHAR_MS + STAGE_PAD
    );
    timers.current.push(id1);
  }

  async function submitGuess() {
    if (phase !== 'copying' || !round || !guess.trim() || submitting) return;
    // Cut the audio the instant they commit — the listen is over.
    audioRef.current?.pause();
    setIsPlaying(false);
    setSubmitting(true);
    try {
      const res =
        (await botPromiseRef.current) ??
        (await (round.mode === 'callsigns'
          ? decodeDualCallsignDataUri(round.bot.dataUri, TONE_FREQ)
          : decodeDataUri(round.bot.dataUri, TONE_FREQ)));
      const truth = lettersOnly(round.text);
      const userText = lettersOnly(guess.toUpperCase().trim());
      const userCopyPct = Math.round(accuracy(truth, userText) * 100);
      const botCopyPct = Math.round(accuracy(truth, res.text) * 100);
      const { bests: nextBests, isNewBest: newBestFlag } = applyRound(
        bests,
        round.tier,
        userCopyPct,
        botCopyPct
      );
      setIsNewBest(newBestFlag);
      setBests(nextBests);
      // Publish the fresh best to the cloud immediately rather than waiting
      // for the next online/visibility trigger. We pass nextBests explicitly
      // — useBestsSync's ref hasn't re-rendered yet, so without the override
      // it would push the PRE-round bests and the new score would be lost
      // until the next visibility/online trigger. Fire-and-forget.
      if (newBestFlag) syncNow(nextBests);
      setBotResult(res);
      setPhase('reveal');
      setSubmitting(false);
      startReveal(userText, res.text, newBestFlag);
    } catch (e) {
      setError(String(e));
      setSubmitting(false);
    }
  }

  function nextRound() {
    clearTimers();
    setError(null);
    setGuess('');
    setPlayed(false);
    setIsPlaying(false);
    setBotLocked(false);
    setBotResult(null);
    setIsNewBest(false);
    setRevealStep(0);
    botPromiseRef.current = null;
    setRound(randomRound(tierObj, textMode));
    setPhase('armed');
  }

  function onTierChange(id: Tier['id']) {
    if (phase === 'reveal' && id === activeTier) return;
    const newTier = TIERS.find((t) => t.id === id) ?? TIERS[2];
    setActiveTier(id);
    if (phase === 'reveal') {
      clearTimers();
      setError(null);
      setGuess('');
      setPlayed(false);
      setIsPlaying(false);
      setBotLocked(false);
      setBotResult(null);
      setIsNewBest(false);
      setRevealStep(0);
      botPromiseRef.current = null;
      setPhase('armed');
    }
    setRound(randomRound(newTier, textMode));
  }

  // The toggle only shows in the armed phase, so flipping it just re-arms the
  // round with the new text mode (same idea as changing tier).
  function onTextModeChange(mode: TextMode) {
    if (mode === textMode) return;
    setTextMode(mode);
    setRound(randomRound(tierObj, mode));
  }

  const userText = lettersOnly(guess.toUpperCase().trim());
  const truth = round ? lettersOnly(round.text) : '';
  const userAcc = botResult && round ? accuracy(truth, userText) : 0;
  const botAcc = botResult && round ? accuracy(truth, botResult.text) : 0;
  const userPct = Math.round(userAcc * 100);
  const botPct = Math.round(botAcc * 100);
  return (
    <div>
      <PageHeader
        eyebrow="Human vs. machine"
        icon={BoxingGloveIcon}
        title="Beat the Bot"
        wideIntro
      >
        The machine has out-copied humans down to −12 dB. Pick your class. We
        hand you an easier signal than the bot — less and less of one as you
        climb, until Extra, where you&apos;re both copying the same brutal clip.
        Out-copy it anyway.
      </PageHeader>

      <Card>
        <CardContent className="flex flex-col gap-5">
          <TierRow
            bests={bests}
            activeTier={activeTier}
            phase={phase}
            onTierChange={onTierChange}
            disabled={phase === 'copying'}
          />

          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[13px]">
            <SyncStatus />
            <span aria-hidden="true" className="text-muted-foreground/50">
              ·
            </span>
            <NavLink
              to="/leaderboard"
              className="inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              <Trophy className="size-[14px]" aria-hidden="true" />
              View leaderboard
            </NavLink>
          </div>

          <div className="border-t border-border" />

          {/* Audio + phase panels — skeleton shown while the initial clip generates
              after the first paint, then swapped for the real content. */}
          {round ? (
            <>
              {/* biome-ignore lint/a11y/useMediaCaption: programmatically generated audio */}
              <audio ref={audioRef} src={round.human.dataUri} preload="auto" />

              {phase === 'armed' && (
                <ArmedPanel
                  round={round}
                  tierObj={tierObj}
                  textMode={textMode}
                  onTextModeChange={onTextModeChange}
                  modelReady={modelReady}
                  isPlaying={isPlaying}
                  volume={volume}
                  onVolumeChange={onVolumeChange}
                  onPlay={onPlay}
                />
              )}

              {phase === 'copying' && (
                <CopyingPanel
                  guess={guess}
                  setGuess={setGuess}
                  botLocked={botLocked}
                  submitting={submitting}
                  inputRef={inputRef}
                  onSubmit={submitGuess}
                  reduce={reduce}
                  devTruth={
                    import.meta.env.MODE === 'development' ? round.text : null
                  }
                />
              )}

              {phase === 'reveal' && botResult && (
                <RevealPanel
                  round={round}
                  guess={userText}
                  botResult={botResult}
                  isNewBest={isNewBest}
                  tierName={tierObj.name}
                  revealStep={revealStep}
                  userPct={userPct}
                  botPct={botPct}
                  reduce={reduce}
                  onNext={nextRound}
                />
              )}
            </>
          ) : (
            /* Skeleton: disabled play button shown while the clip is being generated */
            <div className="flex flex-col items-center gap-4">
              <div className="size-[60px] sm:size-[72px] rounded-full bg-primary flex items-center justify-center opacity-50">
                <Loader2 className="size-7 sm:size-8 animate-spin text-primary-foreground" />
              </div>
              <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <Cpu className="size-3.5" />
                Generating signal…
              </span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-1.5 text-bad font-mono text-sm">
              <TriangleAlert className="size-4" /> {error}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TierRow({
  bests,
  activeTier,
  phase,
  onTierChange,
  disabled = false,
}: {
  bests: Bests;
  activeTier: Tier['id'];
  phase: Phase;
  onTierChange: (id: Tier['id']) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {TIERS.map((tier) => {
        const rec = bests[tier.id];
        const isActive = tier.id === activeTier;
        const Icon = tier.icon;
        const bestPct = rec.bestCopyPct;
        return (
          <button
            key={tier.id}
            type="button"
            onClick={() => onTierChange(tier.id)}
            aria-pressed={isActive}
            disabled={disabled}
            style={
              isActive
                ? {
                    borderColor: tier.accent,
                    boxShadow: `0 0 0 1px ${tier.accent}`,
                    backgroundColor: `color-mix(in oklch, ${tier.accent} 8%, transparent)`,
                  }
                : undefined
            }
            className={`flex flex-col items-center gap-1 rounded-xl border px-3 py-2 sm:p-3 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
              isActive && phase === 'reveal'
                ? 'cursor-default'
                : 'cursor-pointer'
            } ${
              isActive
                ? ''
                : 'border-border/50 bg-background hover:border-border hover:bg-muted/30'
            } disabled:opacity-50 disabled:pointer-events-none disabled:cursor-default`}
          >
            <span className="flex items-center gap-1.5">
              <Icon
                className="size-4 shrink-0"
                style={{ color: tier.accent }}
              />
              <span className="text-[13px] font-medium text-foreground">
                {tier.name}
              </span>
            </span>
            <span className="text-[11px] text-muted-foreground font-mono">
              {formatSnr(tier.snr)} dB · {tier.wpm} wpm
            </span>
            {bestPct === null ? (
              <span className="text-[28px] leading-none text-muted-foreground/40 mt-0.5 sm:mt-1 select-none">
                —
              </span>
            ) : (
              <span
                className="font-mono text-[22px] font-semibold leading-none tabular-nums mt-0.5 sm:mt-1"
                style={{
                  color: isActive ? tier.accent : 'var(--muted-foreground)',
                }}
              >
                {bestPct}%
              </span>
            )}
            {rec.beatCount >= 1 && (
              <span className="inline-flex items-center gap-1 text-[12px] text-dial mt-0.5">
                <Trophy className="size-3" />
                {rec.beatCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// Quiet, non-interactive readout pill. Deliberately borderless and hover-free so
// it reads as metadata, not a control — the play button and the mode toggle are
// the only things meant to look pressable. Two-tone: faint label, bright value.
function SpecPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
      {children}
    </span>
  );
}

// Single-select segmented control for the round's text mode. A real radio group
// (role="radiogroup" + role="radio") so keyboard / assistive tech announce
// "1 of 2 selected" rather than two independent toggles.
function TextModeToggle({
  value,
  onChange,
}: {
  value: TextMode;
  onChange: (m: TextMode) => void;
}) {
  const options: { id: TextMode; label: string; icon: LucideIcon }[] = [
    { id: 'callsigns', label: 'Callsigns', icon: RadioTower },
    { id: 'random', label: 'Random', icon: Shuffle },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Round text"
      className="flex w-full sm:inline-flex sm:w-auto items-stretch gap-0.5 rounded-lg border border-border bg-background/60 p-0.5"
    >
      {options.map((o) => {
        const active = value === o.id;
        const Icon = o.icon;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a segmented single-select control — role="radio" buttons in a radiogroup give the "1 of 2 selected" semantics without native radios' default styling/layout
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.id)}
            className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 sm:py-1.5 text-[14px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="size-3.5" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ArmedPanel({
  round,
  tierObj,
  textMode,
  onTextModeChange,
  modelReady,
  isPlaying,
  volume,
  onVolumeChange,
  onPlay,
}: {
  round: Round;
  tierObj: Tier;
  textMode: TextMode;
  onTextModeChange: (m: TextMode) => void;
  modelReady: boolean;
  isPlaying: boolean;
  volume: number;
  onVolumeChange: (v: number) => void;
  onPlay: () => void;
}) {
  return (
    <div className="relative flex flex-col items-center gap-4">
      {/* Volume floats in the corner (fine pointers only) so it never adds a
          row of dead space above the chips; hidden entirely on touch. */}
      <div className="absolute right-0 top-0 pointer-coarse:hidden">
        <VolumeControl value={volume} onChange={onVolumeChange} />
      </div>

      {/* The interactive control sits above the quiet spec readout, centered in
          the same column as the play button. Its helper line explains the
          CURRENT mode (not a static caption). */}
      <div className="flex w-full sm:w-auto flex-col items-center gap-1.5">
        <TextModeToggle value={textMode} onChange={onTextModeChange} />
        <span className="text-[12px] text-muted-foreground/80 text-center">
          {textMode === 'callsigns' ? (
            'Real callsigns — lean on the format.'
          ) : (
            <>
              Random groups — no patterns to lean on. Sent once;{' '}
              <strong className="font-semibold">
                spaces don&apos;t count.
              </strong>
            </>
          )}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-1.5 font-mono">
        <SpecPill>
          {/* Sign kept in the same span as the value so it reads tight
              ("~13", "~28"), with gaps only around the unit labels. */}
          <span className="text-foreground">~{round.human.wpm}</span>
          <span>WPM</span>
        </SpecPill>
        <SpecPill>
          <span>SNR</span>
          <span className="text-foreground">{formatSnr(round.human.snr)}</span>
          <span>dB</span>
        </SpecPill>
        {/* Callsigns are keyed twice; random groups are sent once, so the chip
            only applies to callsign rounds. */}
        {round.mode === 'callsigns' && (
          <SpecPill>
            <span>KEYED</span>
            <span className="text-foreground">2X</span>
          </SpecPill>
        )}
      </div>

      <button
        type="button"
        onClick={onPlay}
        disabled={!modelReady || isPlaying}
        aria-label="Play the signal once"
        className="size-[60px] sm:size-[72px] rounded-full bg-primary text-primary-foreground flex items-center justify-center transition-transform enabled:hover:scale-105 enabled:active:scale-95 disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {!modelReady || isPlaying ? (
          <Loader2 className="size-7 sm:size-8 animate-spin" />
        ) : (
          <Play
            className="size-7 sm:size-8 translate-x-[2px]"
            fill="currentColor"
          />
        )}
      </button>

      <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
        {modelReady ? (
          <Headphones className="size-3.5" />
        ) : (
          <Cpu className="size-3.5" />
        )}
        {modelReady
          ? `One listen — close the gap on ${tierObj.name}`
          : 'Loading model…'}
      </span>
    </div>
  );
}

function CopyingPanel({
  guess,
  setGuess,
  botLocked,
  submitting,
  inputRef,
  onSubmit,
  reduce,
  devTruth,
}: {
  guess: string;
  setGuess: (v: string) => void;
  botLocked: boolean;
  submitting: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onSubmit: () => void;
  reduce: boolean;
  devTruth: string | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* DEV-ONLY: the round's truth, so you can copy it by hand to test the
          flow. Gated on import.meta.env.DEV — never rendered in a prod build. */}
      {devTruth && (
        <div className="rounded-md border border-dashed border-bad/50 bg-bad/5 px-3 py-1.5 font-mono text-[13px] text-bad">
          dev · truth: {devTruth}
        </div>
      )}
      <div className="flex items-center gap-3 rounded-lg border border-border bg-background/40 p-4">
        {/* Abstract activity only — never any text derived from the bot copy. */}
        <div
          className="flex items-end gap-[3px] h-8 w-14 shrink-0"
          aria-hidden="true"
        >
          {[0.1, 0.5, 0.2, 0.7, 0.35, 0.6].map((delay, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative equalizer bars
              key={i}
              className={`flex-1 rounded-[1px] bg-primary/70 origin-bottom ${reduce ? '' : 'animate-eq-bounce'}`}
              style={{ height: '100%', animationDelay: `${delay}s` }}
            />
          ))}
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="flex items-center gap-1.5 text-[15px] font-medium text-primary"
            role="status"
            aria-live="polite"
          >
            {botLocked ? (
              <>
                <Lock className="size-4" />
                Bot has locked its copy
              </>
            ) : (
              <>
                <Bot className="size-4" />
                Bot is copying the signal…
              </>
            )}
          </div>
          {!botLocked && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full w-1/3 rounded-full bg-primary ${reduce ? '' : 'animate-sweep'}`}
              />
            </div>
          )}
          <div className="mt-1.5 text-[12px] text-muted-foreground">
            Copy sealed until you submit
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <Input
          ref={inputRef}
          id="guess"
          type="text"
          value={guess}
          onChange={(e) => setGuess(e.target.value.toUpperCase())}
          placeholder="Your copy…"
          aria-label="Your copy"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="flex-1 min-w-0 h-11 font-mono tracking-[2px] uppercase"
          maxLength={20}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && guess.trim()) onSubmit();
          }}
        />
        <Button
          variant="default"
          disabled={!guess.trim() || submitting}
          onClick={onSubmit}
          className="shrink-0 h-11"
        >
          {submitting ? (
            <>
              <Loader2 className="animate-spin size-4" />{' '}
              <span className="hidden sm:inline">Grading…</span>
            </>
          ) : (
            <>
              <Send className="size-4" />
              <span className="hidden sm:inline">Submit</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function RevealPanel({
  round,
  guess,
  botResult,
  isNewBest,
  tierName,
  revealStep,
  userPct,
  botPct,
  reduce,
  onNext,
}: {
  round: Round;
  guess: string;
  botResult: DualDecodeResult | PipelineResult;
  isNewBest: boolean;
  tierName: string;
  revealStep: number;
  userPct: number;
  botPct: number;
  reduce: boolean;
  onNext: () => void;
}) {
  const bottomRef = useRef<HTMLButtonElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-only scroll
  useEffect(() => {
    window.setTimeout(
      () =>
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: reduce ? 'auto' : 'smooth',
        }),
      60
    );
  }, []);

  // Random rounds have no country/region, so the origin pill is callsign-only.
  const origin = round.mode === 'callsigns' ? originDisplay(round) : null;
  // Grade/align letters-only (see lettersOnly); the spaced text is still shown
  // verbatim in the "It was" line. `guess` arrives already stripped.
  const truth = lettersOnly(round.text);
  const userCells = alignChars(guess, truth);
  const botCells = alignChars(botResult.text, truth);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-center gap-2.5">
        <span className="text-[13px] text-muted-foreground">It was</span>
        <span className="font-mono text-[22px] text-foreground tracking-[2px] break-all">
          {/* Render word breaks as subtle dots so a random message reads as
              distinct groups ("AJ2KKM · 2A · AL"); callsigns have no spaces. */}
          {round.text.split(/\s+/).map((word, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: positional word cells; regenerated each render
            <Fragment key={i}>
              {i > 0 && (
                <span className="mx-1 text-muted-foreground/40">·</span>
              )}
              {word}
            </Fragment>
          ))}
        </span>
        {origin && (
          <span className="inline-flex items-center gap-1.5 text-[12px] bg-secondary text-secondary-foreground rounded-md px-2 py-0.5">
            {origin.flag && (
              <span aria-hidden="true" className="text-[15px] leading-none">
                {origin.flag}
              </span>
            )}
            {origin.name}
          </span>
        )}
      </div>

      {/* One line per competitor: name · accuracy bar (grows to fill) · copy.
          A shared grid keeps the name/copy columns aligned across both rows
          (so the bars share an axis) while the bar column (1fr) fills the rest
          on any viewport. */}
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-3">
        <CompetitorRow
          who="You"
          tone="you"
          icon={<User className="size-5" />}
          cells={userCells}
          typePlay={revealStep >= 1}
          barShow={revealStep >= 1}
          pct={userPct}
          win={false}
          reduce={reduce}
        />
        <CompetitorRow
          who="Bot"
          tone="bot"
          icon={<Bot className="size-5" />}
          cells={botCells}
          typePlay={revealStep >= 2}
          barShow={revealStep >= 1}
          pct={botPct}
          win={false}
          reduce={reduce}
        />
      </div>

      <div className="flex flex-col items-center gap-1.5 text-center">
        {/* Result line — loudest element of the zone */}
        {isNewBest ? (
          <span className="inline-flex items-center gap-1.5 text-[18px] font-semibold text-good">
            <Trophy className="size-5" />
            New best at {tierName}
          </span>
        ) : userPct > botPct ? (
          <span className="inline-flex items-center gap-2 text-[18px] font-semibold text-good">
            <Trophy className="size-5" />
            You out-copied the bot
          </span>
        ) : userPct === botPct ? (
          <span className="text-[18px] font-semibold text-foreground">
            You matched the bot
          </span>
        ) : (
          // TODO(john): final wording undecided — placeholder
          <span className="text-[18px] font-semibold text-foreground">
            You copied {userPct}%
          </span>
        )}
        {/* Context line — one quiet tertiary line below the result */}
        {round.tier === 'extra' ? (
          <span className="text-[12px] text-muted-foreground">
            Even ground — same clip
          </span>
        ) : (
          <span className="text-[12px] text-muted-foreground">
            Your clip {formatSnr(round.human.snr)} dB · the bot&apos;s{' '}
            {formatSnr(round.bot.snr)} dB
          </span>
        )}
      </div>

      {/* Callsigns get the full two-looks merge story (sent twice); random rounds
          were sent once — there's no second look to explain, so we show just the
          signal envelope under a plainer disclosure. */}
      {round.mode === 'callsigns' ? (
        <TwoLookDetail result={botResult as DualDecodeResult} />
      ) : (
        <SignalEnvelopeDetail bars={botResult.envelopeBars} />
      )}

      <Button
        ref={bottomRef}
        variant="default"
        onClick={onNext}
        disabled={revealStep < 4}
        className="w-full mt-1"
      >
        <BoxingGloveIcon className="size-4" /> Another round
      </Button>
    </div>
  );
}

// Levenshtein-align guess against truth and return display cells. Matched
// characters render green; substituted/inserted characters render red; a
// truth char the guess missed renders as a faint gap so lengths read honestly.
function alignChars(
  guess: string,
  truth: string
): { ch: string; kind: 'match' | 'wrong' | 'gap' }[] {
  const m = guess.length;
  const n = truth.length;
  if (m === 0 && n === 0) return [];
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = guess[i - 1] === truth[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  const cells: { ch: string; kind: 'match' | 'wrong' | 'gap' }[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && guess[i - 1] === truth[j - 1]) {
      cells.push({ ch: guess[i - 1], kind: 'match' });
      i--;
      j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      cells.push({ ch: guess[i - 1], kind: 'wrong' });
      i--;
      j--; // substitution
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      cells.push({ ch: guess[i - 1], kind: 'wrong' });
      i--; // extra char in guess
    } else {
      cells.push({ ch: '·', kind: 'gap' });
      j--; // missed a truth char
    }
  }
  cells.reverse();
  return cells;
}

// Per-competitor identity. You = blue, Bot = orange.
// Bars are thin pill tracks; percentage shown to the right of the track.
const TONE = {
  you: { text: 'text-you' },
  bot: { text: 'text-bot' },
} as const;

// One competitor on a single line: name + icon (left), the accuracy bar growing
// to fill the middle, and the copied call (right). The copy types in L→R; the
// bar fills from 0 to pct when `barShow` flips true. Name and copy columns are
// fixed-width so both rows' bars line up as a shared axis. Reduced motion shows
// the final state immediately.
function CompetitorRow({
  who,
  tone,
  icon,
  cells,
  typePlay,
  barShow,
  pct,
  win,
  reduce,
}: {
  who: string;
  tone: 'you' | 'bot';
  icon: React.ReactNode;
  cells: { ch: string; kind: 'match' | 'wrong' | 'gap' }[];
  typePlay: boolean;
  barShow: boolean;
  pct: number;
  win: boolean;
  reduce: boolean;
}) {
  const [shown, setShown] = useState(reduce ? cells.length : 0);
  useEffect(() => {
    if (!typePlay) {
      setShown(0);
      return;
    }
    if (reduce) {
      setShown(cells.length);
      return;
    }
    setShown(0);
    let i = 0;
    const id = window.setInterval(() => {
      i++;
      setShown(i);
      if (i >= cells.length) window.clearInterval(id);
    }, CHAR_MS);
    return () => window.clearInterval(id);
  }, [typePlay, reduce, cells.length]);

  const [w, setW] = useState(reduce && barShow ? pct : 0);
  useEffect(() => {
    if (!barShow) {
      setW(0);
      return;
    }
    if (reduce) {
      setW(pct);
      return;
    }
    const id = requestAnimationFrame(() => setW(pct));
    return () => cancelAnimationFrame(id);
  }, [barShow, pct, reduce]);

  const color = TONE[tone];
  // Three grid cells (name · bar · copy). The parent grid shares column tracks
  // across both rows, so the bar (1fr) fills all remaining width on any
  // viewport while the name/copy columns size to content and stay aligned.
  return (
    <>
      <span
        className={`inline-flex items-center gap-1.5 text-[16px] font-medium ${color.text}`}
      >
        {icon}
        {who}
        {win && <Crown className="size-4 text-dial" />}
      </span>

      {/* Thin pill track. Both fills use dashed segments; You = blue, Bot = orange. */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="absolute inset-y-0 left-0"
            style={{
              width: `${w}%`,
              background:
                tone === 'you'
                  ? 'repeating-linear-gradient(90deg, var(--you) 0, var(--you) 5px, color-mix(in oklch, var(--you) 35%, transparent) 5px, color-mix(in oklch, var(--you) 35%, transparent) 6px)'
                  : 'repeating-linear-gradient(90deg, var(--bot) 0, var(--bot) 5px, color-mix(in oklch, var(--bot) 35%, transparent) 5px, color-mix(in oklch, var(--bot) 35%, transparent) 6px)',
              transition: reduce ? 'none' : `width ${BAR_MS}ms ease-out`,
            }}
          />
        </div>
        <span
          aria-hidden={barShow ? undefined : true}
          className={`font-mono text-[11px] font-semibold tabular-nums w-8 text-right shrink-0 ${barShow ? color.text : 'opacity-0'}`}
        >
          {pct}%
        </span>
      </div>

      {/* All cells render up front (un-typed ones invisible) so width is
          reserved and characters appear in place, L→R, never sliding in. */}
      <span className="text-right font-mono text-[16px] tracking-[1px] break-all">
        {cells.length === 0 ? (
          <span className="text-[12px] tracking-normal text-muted-foreground">
            (nothing)
          </span>
        ) : (
          cells.map((c, idx) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: positional diff cells; regenerated wholesale each render
              key={idx}
              className={`${idx >= shown ? 'invisible' : ''} ${
                c.kind === 'match'
                  ? 'text-good'
                  : c.kind === 'gap'
                    ? 'text-muted-foreground/40'
                    : 'text-bad'
              }`}
            >
              {c.ch}
            </span>
          ))
        )}
      </span>
    </>
  );
}

// On opening a reveal disclosure, ease the newly-revealed content into view.
function scrollDisclosureIntoView(e: React.SyntheticEvent<HTMLDetailsElement>) {
  if (!e.currentTarget.open) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.setTimeout(
    () =>
      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: reduce ? 'auto' : 'smooth',
      }),
    60
  );
}

// Envelope bar strip shared by both disclosures: the keying the bot copied.
function EnvelopeBars({ bars }: { bars: number[] }) {
  const max = bars.length > 0 ? Math.max(...bars, 0.0001) : 1;
  return (
    <div className="flex items-end gap-[2px] h-9 bg-background rounded-md px-2 py-1.5">
      {bars.map((v, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: positional waveform bar; bars are recomputed each render
          key={i}
          className="flex-1 rounded-[1px] bg-primary/70"
          style={{ height: `${Math.max(6, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

// Random rounds are a single send — no second look, no merge to explain. Show
// only the signal envelope (the noisy clip the bot copied, same as the human).
function SignalEnvelopeDetail({ bars }: { bars: number[] }) {
  return (
    <details onToggle={scrollDisclosureIntoView} className="group">
      <summary className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none list-none">
        <ScanEye className="size-3.5" />
        What you were up against
        <span className="text-[16px] leading-none text-muted-foreground/50 group-open:rotate-90 transition-transform">
          ›
        </span>
      </summary>
      {bars.length > 0 && (
        <div className="mt-2.5">
          <EnvelopeBars bars={bars} />
          <p className="mt-1.5 text-[12px] text-muted-foreground">
            The signal you both copied — a random group, sent once. The bot
            decoded this same noisy clip in one pass, just like you.
          </p>
        </div>
      )}
    </details>
  );
}

function TwoLookDetail({ result }: { result: DualDecodeResult }) {
  const looks = [
    { n: 1, text: result.firstHalf.text, conf: result.firstHalf.confidence },
    { n: 2, text: result.secondHalf.text, conf: result.secondHalf.confidence },
  ];
  return (
    <details onToggle={scrollDisclosureIntoView} className="group">
      <summary className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none list-none">
        <ScanEye className="size-3.5" />
        How the bot got two looks
        <span className="text-[16px] leading-none text-muted-foreground/50 group-open:rotate-90 transition-transform">
          ›
        </span>
      </summary>
      <div className="mt-2.5 flex flex-col gap-3">
        {result.envelopeBars.length > 0 && (
          <div>
            <EnvelopeBars bars={result.envelopeBars} />
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              The signal you both copied — the call is keyed twice, with a gap
              between.
            </p>
          </div>
        )}
        <div className="rounded-lg border border-border bg-background/40 p-3">
          <p className="text-[12px] text-muted-foreground leading-relaxed mb-3">
            The call is sent twice, so the bot decodes each send separately —
            two independent shots at the same noise — then combines them. Same
            trick as asking "again?" on the air.
          </p>
          <div className="flex flex-col gap-2">
            {looks.map((l) => (
              <div key={l.n} className="flex items-center gap-2.5">
                <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground w-14 shrink-0">
                  <Eye className="size-3.5" />
                  look {l.n}
                </span>
                <span className="font-mono text-[13px] text-foreground flex-1 tracking-[1px] break-all">
                  {l.text || (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums shrink-0">
                  {(l.conf * 100).toFixed(0)}%
                </span>
              </div>
            ))}
            <div className="flex items-center gap-2.5 border-t border-border pt-2 mt-0.5">
              <span className="inline-flex items-center gap-1.5 text-[11px] text-foreground w-14 shrink-0">
                <GitMerge className="size-3.5" />
                final
              </span>
              <span className="font-mono text-[13px] text-foreground flex-1 tracking-[1px] break-all">
                {result.text || '—'}
              </span>
              <span className="text-[11px] text-muted-foreground shrink-0">
                {result.agreement ? 'both agreed' : 'merged'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </details>
  );
}
