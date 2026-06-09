import {
  Bot,
  Crown,
  Eye,
  GitMerge,
  Headphones,
  Loader2,
  Lock,
  Play,
  RotateCcw,
  Send,
  Swords,
  TriangleAlert,
  Trophy,
  User,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { BoxingGloveIcon } from '@/components/boxing-glove-icon';
import PageHeader from '@/components/page-header';
import { usePrefersReducedMotion } from '@/components/presence';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import VolumeControl from '@/components/volume-control';
import { fireConfetti } from '@/lib/confetti';
import { useDocumentHead } from '@/lib/use-document-head';
import { usePersistedState } from '@/lib/use-persisted-state';
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

const TONE_FREQ = 700;
// Reveal staging timings (ms). Per-character typing cadence, the bar-race
// easing, and a small pause between stages so each beat reads on its own.
const CHAR_MS = 95;
const BAR_MS = 1300;
const STAGE_PAD = 250;

type Phase = 'armed' | 'copying' | 'reveal';
type Outcome = 'win' | 'loss' | 'tie';

interface Round {
  text: string;
  region: 'US' | 'Canada' | 'World';
  wpm: number;
  snr: number;
  dataUri: string;
}

function randomRound(): Round {
  const wpm = 20 + Math.floor(Math.random() * 11);
  const snr = -14 + Math.floor(Math.random() * 7);
  const text = randomCallsign();
  const region = callsignRegion(text);
  const sentText = `${text} ${text}`;
  const out = generateAudio({
    text: sentText,
    wpm,
    snrDb: snr,
    frequency: TONE_FREQ,
  });
  return { text, region, wpm, snr, dataUri: out.dataUri };
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
      'One callsign buried in static, keyed twice in a single pass — the same audio you and the model both get. Out-copy a neural CW decoder by ear, if you can.',
    path: '/beat-the-bot',
  });

  const reduce = usePrefersReducedMotion();

  const [phase, setPhase] = useState<Phase>('armed');
  const [round, setRound] = useState<Round>(() => randomRound());
  const [guess, setGuess] = useState('');
  const [played, setPlayed] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [botLocked, setBotLocked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [botResult, setBotResult] = useState<DualDecodeResult | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // 0 = nothing, 1 = your copy typed, 2 = bot copy typed, 3 = bars race,
  // 4 = verdict + score + glow.
  const [revealStep, setRevealStep] = useState(0);

  const [score, setScore] = usePersistedState('beat.score', {
    wins: 0,
    losses: 0,
    ties: 0,
  });
  const [streak, setStreak] = usePersistedState('beat.streak', 0);
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

  useEffect(() => {
    loadSession()
      .then(() => setModelReady(true))
      .catch((e) => setError(String(e)));
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
    if (!audioRef.current || !modelReady || played || isPlaying) return;
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

    // Seal the bot's copy now, on the same audio. Store only the promise; its
    // text never reaches state (and so never the DOM) until the player submits.
    const p = decodeDualCallsignDataUri(round.dataUri, TONE_FREQ);
    botPromiseRef.current = p;
    p.catch(() => {});

    setPhase('copying');
  }

  function applyOutcome(out: Outcome) {
    setScore((s) =>
      out === 'win'
        ? { ...s, wins: s.wins + 1 }
        : out === 'loss'
          ? { ...s, losses: s.losses + 1 }
          : { ...s, ties: s.ties + 1 }
    );
    setStreak((st) => (out === 'win' ? st + 1 : 0));
    if (out === 'win') fireConfetti();
  }

  function startReveal(userText: string, botText: string, out: Outcome) {
    clearTimers();
    if (reduce) {
      setRevealStep(4);
      applyOutcome(out);
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
              applyOutcome(out);
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
    if (phase !== 'copying' || !guess.trim() || submitting) return;
    // Cut the audio the instant they commit — the listen is over.
    audioRef.current?.pause();
    setIsPlaying(false);
    setSubmitting(true);
    try {
      const res =
        (await botPromiseRef.current) ??
        (await decodeDualCallsignDataUri(round.dataUri, TONE_FREQ));
      const userText = guess.toUpperCase().trim();
      const userAcc = accuracy(round.text, userText);
      const botAcc = accuracy(round.text, res.text);
      const out: Outcome =
        userAcc > botAcc ? 'win' : userAcc < botAcc ? 'loss' : 'tie';
      setBotResult(res);
      setOutcome(out);
      setPhase('reveal');
      setSubmitting(false);
      startReveal(userText, res.text, out);
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
    setOutcome(null);
    setRevealStep(0);
    botPromiseRef.current = null;
    setRound(randomRound());
    setPhase('armed');
  }

  function resetScore() {
    setScore({ wins: 0, losses: 0, ties: 0 });
    setStreak(0);
    nextRound();
  }

  const userText = guess.toUpperCase().trim();
  const userAcc = botResult ? accuracy(round.text, userText) : 0;
  const botAcc = botResult ? accuracy(round.text, botResult.text) : 0;
  const userPct = Math.round(userAcc * 100);
  const botPct = Math.round(botAcc * 100);
  const glow: Outcome | null = revealStep >= 4 ? outcome : null;
  const played_total = score.wins + score.losses + score.ties;

  return (
    <div>
      <PageHeader
        eyebrow="Human vs. machine"
        icon={Swords}
        title="Beat the Bot"
        wideIntro
      >
        The machine has out-copied humans down to −12 dB. Now it's your turn.
        One callsign, buried in static, keyed twice in a single pass — same
        audio you both get. Cleaner copy wins.
      </PageHeader>

      <Card>
        <CardContent className="flex flex-col gap-5">
          <Scoreboard score={score} streak={streak} glow={glow} />

          <div className="-mt-2 flex flex-col items-center gap-2 text-[12px] text-muted-foreground">
            <span className="text-center">
              Cleaner copy wins · same audio, sealed copies
            </span>
            {played_total > 0 && (
              <AlertDialog>
                <AlertDialogTrigger className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-foreground/70 hover:text-foreground hover:bg-muted transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                  <RotateCcw className="size-3" />
                  Reset
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset the scoreboard?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This clears your wins, the bot's wins, ties, and your
                      streak — {played_total}{' '}
                      {played_total === 1 ? 'round' : 'rounds'} of history. This
                      can't be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep my scores</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={resetScore}
                    >
                      Reset scores
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>

          <div className="border-t border-border" />

          {/* Audio is rendered once and reused across phases. */}
          {/* biome-ignore lint/a11y/useMediaCaption: programmatically generated audio */}
          <audio ref={audioRef} src={round.dataUri} preload="auto" />

          {phase === 'armed' && (
            <ArmedPanel
              round={round}
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
              outcome={outcome}
              streak={streak}
              revealStep={revealStep}
              userPct={userPct}
              botPct={botPct}
              reduce={reduce}
              onNext={nextRound}
            />
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

function Scoreboard({
  score,
  streak,
  glow,
}: {
  score: { wins: number; losses: number; ties: number };
  streak: number;
  glow: Outcome | null;
}) {
  const glowRing =
    glow === 'win'
      ? 'ring-2 ring-inset ring-you/70'
      : glow === 'loss'
        ? 'ring-2 ring-inset ring-bot/70'
        : glow === 'tie'
          ? 'ring-2 ring-inset ring-muted-foreground/50'
          : 'ring-0';
  return (
    <div
      className={`rounded-xl border border-border/50 bg-background p-4 transition-shadow ${glowRing}`}
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex flex-col items-center gap-1">
          <span className="inline-flex items-center gap-1.5 text-[15px] font-medium text-you">
            <User className="size-[18px]" />
            YOU
          </span>
          <span className="font-dseg7 text-[44px] leading-none text-you tabular-nums">
            {score.wins}
          </span>
        </div>
        <div className="flex flex-col items-center gap-1 px-2 text-muted-foreground">
          <span className="text-sm font-medium">VS</span>
          <span className="text-[13px]">
            {score.ties} {score.ties === 1 ? 'tie' : 'ties'}
          </span>
          {streak >= 2 && (
            <span className="text-[11px] text-you">{streak} streak</span>
          )}
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="inline-flex items-center gap-1.5 text-[15px] font-medium text-bot">
            <Bot className="size-[18px]" />
            BOT
            {glow === 'loss' && (
              <Crown className="size-4 text-dial animate-crown-drop" />
            )}
          </span>
          <span className="font-dseg7 text-[44px] leading-none text-bot tabular-nums">
            {score.losses}
          </span>
        </div>
      </div>
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
  modelReady,
  isPlaying,
  volume,
  onVolumeChange,
  onPlay,
}: {
  round: Round;
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
              ("~20", "−10"), with chip gaps only around the unit labels. */}
          <span className="text-foreground">~{round.wpm}</span>
          <span>WPM</span>
        </Chip>
        <Chip>
          <span>SNR</span>
          <span className="text-foreground">−{Math.abs(round.snr)}</span>
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
        <Headphones className="size-3.5" />
        {modelReady ? 'One listen — make it count' : 'Loading model…'}
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
  outcome,
  streak,
  revealStep,
  userPct,
  botPct,
  reduce,
  onNext,
}: {
  round: Round;
  guess: string;
  botResult: DualDecodeResult;
  outcome: Outcome | null;
  streak: number;
  revealStep: number;
  userPct: number;
  botPct: number;
  reduce: boolean;
  onNext: () => void;
}) {
  const origin = originDisplay(round);
  const userCells = alignChars(guess, round.text);
  const botCells = alignChars(botResult.text, round.text);
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
          barShow={revealStep >= 3}
          pct={userPct}
          win={revealStep >= 4 && outcome === 'win'}
          reduce={reduce}
        />
        <CompetitorRow
          who="Bot"
          tone="bot"
          icon={<Bot className="size-5" />}
          cells={botCells}
          typePlay={revealStep >= 2}
          barShow={revealStep >= 3}
          pct={botPct}
          win={revealStep >= 4 && outcome === 'loss'}
          reduce={reduce}
        />
      </div>

      {revealStep >= 4 && <Verdict outcome={outcome} streak={streak} />}

      {revealStep >= 4 && (
        <>
          <StaticEnvelope bars={botResult.envelopeBars} />
          <TwoLookDetail result={botResult} />
        </>
      )}

      <Button variant="default" onClick={onNext} className="w-full mt-1">
        <BoxingGloveIcon className="size-4" /> Next round
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

// Per-competitor identity color (chart palette). Kept distinct from green
// (which means "correct character") and from the app's primary purple (which is
// everywhere). You = blue, Bot = pink.
const TONE = {
  you: { text: 'text-you', fill: 'bg-you' },
  bot: { text: 'text-bot', fill: 'bg-bot' },
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

      <div className="relative h-9 overflow-hidden rounded-lg bg-background/60">
        {/* The % label rides the fill's trailing edge so it reads on the light
            fill (which also gives axe a correct background to measure). */}
        <div
          className={`absolute inset-y-0 left-0 flex items-center justify-end rounded-lg pr-2.5 ${color.fill}`}
          style={{
            width: `${w}%`,
            transition: reduce ? 'none' : `width ${BAR_MS}ms ease-out`,
          }}
        >
          <span className="font-mono text-[12px] font-semibold tabular-nums whitespace-nowrap text-background">
            {pct}%
          </span>
        </div>
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

function Verdict({
  outcome,
  streak,
}: {
  outcome: Outcome | null;
  streak: number;
}) {
  if (outcome === 'win')
    return (
      <div className="flex items-center justify-center gap-2 text-[18px] font-semibold text-good">
        <Trophy className="size-5" />
        {streak >= 3
          ? `You out-copied the bot — ${streak} in a row`
          : 'You out-copied the bot'}
      </div>
    );
  if (outcome === 'loss')
    return (
      <div className="flex items-center justify-center gap-2 text-[18px] font-semibold text-primary">
        <Bot className="size-5" />
        The bot copied it cleaner
      </div>
    );
  return (
    <div className="flex items-center justify-center gap-2 text-[18px] font-semibold text-foreground">
      Dead heat — same copy
    </div>
  );
}

function TwoLookDetail({ result }: { result: DualDecodeResult }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const looks = [
    { n: 1, text: result.firstHalf.text, conf: result.firstHalf.confidence },
    { n: 2, text: result.secondHalf.text, conf: result.secondHalf.confidence },
  ];
  function onToggle(e: React.SyntheticEvent<HTMLDetailsElement>) {
    if (!e.currentTarget.open) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    window.setTimeout(
      () => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }),
      60
    );
  }
  return (
    <details ref={ref} onToggle={onToggle} className="group">
      <summary className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none list-none">
        <GitMerge className="size-3.5" />
        How the bot got two looks
        <span className="text-muted-foreground/50 group-open:rotate-90 transition-transform">
          ›
        </span>
      </summary>
      <div className="mt-2.5 rounded-lg border border-border bg-background/40 p-3">
        <p className="text-[12px] text-muted-foreground leading-relaxed mb-3">
          The call is sent twice, so the bot decodes each send separately — two
          independent shots at the same noise — then combines them. Same trick
          as asking “again?” on the air.
        </p>
        <div className="flex flex-col gap-2">
          {looks.map((l) => (
            <div key={l.n} className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground w-14 shrink-0">
                <Eye className="size-3.5" />
                look {l.n}
              </span>
              <span className="font-mono text-[13px] text-foreground flex-1 tracking-[1px] break-all">
                {l.text || <span className="text-muted-foreground/50">—</span>}
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
    </details>
  );
}

function StaticEnvelope({ bars }: { bars: number[] }) {
  if (!bars || bars.length === 0) return null;
  const max = Math.max(...bars, 0.0001);
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1.5">
        <Headphones className="size-3.5" />
        what you were up against
      </div>
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
    </div>
  );
}
