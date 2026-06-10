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
  Radio,
  RadioTower,
  ScanEye,
  Send,
  TriangleAlert,
  Trophy,
  User,
  Zap,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { BoxingGloveIcon } from '@/components/boxing-glove-icon';
import PageHeader from '@/components/page-header';
import { usePrefersReducedMotion } from '@/components/presence';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import VolumeControl from '@/components/volume-control';
import { fireConfetti } from '@/lib/confetti';
import { useDocumentHead } from '@/lib/use-document-head';
import { clearPersisted, usePersistedState } from '@/lib/use-persisted-state';
import {
  callsignCountry,
  callsignRegion,
  randomCallsign,
} from '../inference/callsign';
import { accuracy, cer } from '../inference/decode';
import {
  type DualDecodeResult,
  decodeDualCallsignDataUri,
} from '../inference/dual-decode';
import { generateAudio } from '../inference/generate';
import { loadSession } from '../inference/onnx';

const TONE_FREQ = 700;
// Reveal staging timings (ms). Per-character typing cadence, the bar-race
// easing, and a small pause between stages so each beat reads on its own.
const CHAR_MS = 95;
const BAR_MS = 1300;
const STAGE_PAD = 250;

export interface Tier {
  id: 'no-code' | 'technician' | 'general' | 'extra';
  name: string;
  snr: number; // dB — the HUMAN clip (higher = easier)
  wpm: number; // the HUMAN clip
  icon: LucideIcon;
  accent: string; // CSS custom property reference
}

export const TIERS: readonly Tier[] = [
  {
    id: 'no-code',
    name: 'No-Code',
    snr: 10,
    wpm: 13,
    icon: Headphones,
    accent: 'var(--tier-no-code)',
  },
  {
    id: 'technician',
    name: 'Technician',
    snr: 5,
    wpm: 18,
    icon: Radio,
    accent: 'var(--tier-technician)',
  },
  {
    id: 'general',
    name: 'General',
    snr: 0,
    wpm: 22,
    icon: RadioTower,
    accent: 'var(--tier-general)',
  },
  {
    id: 'extra',
    name: 'Extra',
    snr: -6,
    wpm: 28,
    icon: Zap,
    accent: 'var(--tier-extra)',
  },
];

// The bot copies this fixed hard clip every round, regardless of tier.
// Equal to the Extra human setting, so at Extra the contest is near heads-up.
export const BOT_REF = { snr: -6, wpm: 28 } as const;

interface TierRecord {
  bestCER: number | null; // null = no rounds at this tier yet
  beatCount: number; // strict userCER < botCER
}
type Bests = Record<Tier['id'], TierRecord>;

const EMPTY_BESTS: Bests = {
  'no-code': { bestCER: null, beatCount: 0 },
  technician: { bestCER: null, beatCount: 0 },
  general: { bestCER: null, beatCount: 0 },
  extra: { bestCER: null, beatCount: 0 },
};

type Phase = 'armed' | 'copying' | 'reveal';

interface Round {
  text: string;
  region: 'US' | 'Canada' | 'World';
  tier: Tier['id'];
  human: { wpm: number; snr: number; dataUri: string }; // what the player hears
  bot: { wpm: number; snr: number; dataUri: string }; // what the bot decodes
}

// Format an SNR value with sign: +10, −6, +0, etc. (proper minus sign).
function formatSnr(snr: number): string {
  if (snr >= 0) return `+${snr}`;
  return `−${Math.abs(snr)}`;
}

function randomRound(tier: Tier): Round {
  const text = randomCallsign();
  const region = callsignRegion(text);
  const sentText = `${text} ${text}`; // keyed twice, as today
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
    'general'
  );
  const [bests, setBests] = usePersistedState<Bests>(
    'morse:btb:bests',
    EMPTY_BESTS
  );

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

  const [botResult, setBotResult] = useState<DualDecodeResult | null>(null);
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
  const botPromiseRef = useRef<Promise<DualDecodeResult> | null>(null);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only round init — deferred to avoid blocking first paint
  useEffect(() => {
    setRound(randomRound(tierObj));
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
    const p = decodeDualCallsignDataUri(round.bot.dataUri, TONE_FREQ);
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
    const userLen = alignChars(userText, round.text).length;
    const botLen = alignChars(botText, round.text).length;
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
        (await decodeDualCallsignDataUri(round.bot.dataUri, TONE_FREQ));
      const userText = guess.toUpperCase().trim();
      const userCER = cer(round.text, userText);
      const botCER = cer(round.text, res.text);
      const rec = bests[round.tier];
      const newBestFlag = rec.bestCER === null || userCER < rec.bestCER;
      setIsNewBest(newBestFlag);
      setBests((prev) => {
        const r = prev[round.tier];
        const newBestVal =
          r.bestCER === null ? userCER : Math.min(r.bestCER, userCER);
        const beat = userCER < botCER ? 1 : 0; // STRICT < — a tie does NOT count
        return {
          ...prev,
          [round.tier]: { bestCER: newBestVal, beatCount: r.beatCount + beat },
        };
      });
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
    setRound(randomRound(tierObj));
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
    setRound(randomRound(newTier));
  }

  const userText = guess.toUpperCase().trim();
  const userAcc = botResult && round ? accuracy(round.text, userText) : 0;
  const botAcc = botResult && round ? accuracy(round.text, botResult.text) : 0;
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

          <div className="border-t border-border" />

          {/* Audio + phase panels — hidden for one tick while the initial clip
              generates in useEffect, so first paint is not blocked. */}
          {round && (
            <>
              {/* biome-ignore lint/a11y/useMediaCaption: programmatically generated audio */}
              <audio ref={audioRef} src={round.human.dataUri} preload="auto" />

              {phase === 'armed' && (
                <ArmedPanel
                  round={round}
                  tierObj={tierObj}
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
        const bestPct =
          rec.bestCER === null
            ? null
            : Math.max(0, Math.round((1 - rec.bestCER) * 100));
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
            className={`flex flex-col items-center gap-1 rounded-xl border p-3 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
              isActive && phase === 'reveal'
                ? 'cursor-default'
                : 'cursor-pointer'
            } ${
              isActive
                ? ''
                : 'border-border/50 bg-background hover:border-border hover:bg-muted/30'
            } disabled:opacity-50 disabled:pointer-events-none disabled:cursor-default`}
          >
            <Icon className="size-4" style={{ color: tier.accent }} />
            <span className="text-[13px] font-medium text-foreground">
              {tier.name}
            </span>
            <span className="text-[11px] text-muted-foreground font-mono">
              {formatSnr(tier.snr)} dB · {tier.wpm} wpm
            </span>
            {bestPct === null ? (
              <span className="text-[28px] leading-none text-muted-foreground/40 mt-1 select-none">
                —
              </span>
            ) : (
              <span
                className="font-mono text-[22px] font-semibold leading-none tabular-nums mt-1"
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

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background/60 px-3 py-1.5 text-[13px] text-muted-foreground">
      {children}
    </span>
  );
}

function ArmedPanel({
  round,
  tierObj,
  modelReady,
  isPlaying,
  volume,
  onVolumeChange,
  onPlay,
}: {
  round: Round;
  tierObj: Tier;
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

      <div className="flex flex-wrap items-center justify-center gap-2 font-mono">
        <Chip>
          {/* Sign kept in the same span as the value so it reads tight
              ("~13", "~28"), with chip gaps only around the unit labels. */}
          <span className="text-foreground">~{round.human.wpm}</span>
          <span>WPM</span>
        </Chip>
        <Chip>
          <span>SNR</span>
          <span className="text-foreground">{formatSnr(round.human.snr)}</span>
          <span>dB</span>
        </Chip>
        <Chip>
          <span>KEYED</span>
          <span className="text-foreground">2X</span>
        </Chip>
      </div>

      <button
        type="button"
        onClick={onPlay}
        disabled={!modelReady || isPlaying}
        aria-label="Play the signal once"
        className="size-[72px] rounded-full bg-primary text-primary-foreground flex items-center justify-center transition-transform enabled:hover:scale-105 enabled:active:scale-95 disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {!modelReady || isPlaying ? (
          <Loader2 className="size-8 animate-spin" />
        ) : (
          <Play className="size-8 translate-x-[2px]" fill="currentColor" />
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
}: {
  guess: string;
  setGuess: (v: string) => void;
  botLocked: boolean;
  submitting: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onSubmit: () => void;
  reduce: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
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
              <Loader2 className="animate-spin size-4" /> Grading…
            </>
          ) : (
            <>
              <Send className="size-4" />
              Submit
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
  botResult: DualDecodeResult;
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

  const origin = originDisplay(round);
  const userCells = alignChars(guess, round.text);
  const botCells = alignChars(botResult.text, round.text);
  const userCER = cer(round.text, guess);
  const botCER = cer(round.text, botResult.text);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-center gap-2.5">
        <span className="text-[13px] text-muted-foreground">It was</span>
        <span className="font-mono text-[22px] text-foreground tracking-[2px]">
          {round.text}
        </span>
        <span className="inline-flex items-center gap-1.5 text-[12px] bg-secondary text-secondary-foreground rounded-md px-2 py-0.5">
          {origin.flag && (
            <span aria-hidden="true" className="text-[15px] leading-none">
              {origin.flag}
            </span>
          )}
          {origin.name}
        </span>
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
        ) : userCER < botCER ? (
          <span className="inline-flex items-center gap-2 text-[18px] font-semibold text-good">
            <Trophy className="size-5" />
            You out-copied the bot
          </span>
        ) : userCER === botCER ? (
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

      <TwoLookDetail result={botResult} />

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

function TwoLookDetail({ result }: { result: DualDecodeResult }) {
  const looks = [
    { n: 1, text: result.firstHalf.text, conf: result.firstHalf.confidence },
    { n: 2, text: result.secondHalf.text, conf: result.secondHalf.confidence },
  ];
  const envelopeMax =
    result.envelopeBars.length > 0
      ? Math.max(...result.envelopeBars, 0.0001)
      : 1;
  function onToggle(e: React.SyntheticEvent<HTMLDetailsElement>) {
    if (!e.currentTarget.open) return;
    const reduce = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    window.setTimeout(
      () =>
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: reduce ? 'auto' : 'smooth',
        }),
      60
    );
  }
  return (
    <details onToggle={onToggle} className="group">
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
            <div className="flex items-end gap-[2px] h-9 bg-background rounded-md px-2 py-1.5">
              {result.envelopeBars.map((v, i) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: positional waveform bar; bars are recomputed each render
                  key={i}
                  className="flex-1 rounded-[1px] bg-primary/70"
                  style={{
                    height: `${Math.max(6, (v / envelopeMax) * 100)}%`,
                  }}
                />
              ))}
            </div>
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
