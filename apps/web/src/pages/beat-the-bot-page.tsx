import {
  Bot,
  Crown,
  Eye,
  Flame,
  GitMerge,
  Headphones,
  Loader2,
  Play,
  RotateCcw,
  Send,
  Swords,
  TriangleAlert,
  User,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import PageHeader from '@/components/page-header';
import { Presence } from '@/components/presence';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import VolumeControl from '@/components/volume-control';
import { fireConfetti } from '@/lib/confetti';
import { useDocumentHead } from '@/lib/use-document-head';
import { usePersistedState } from '@/lib/use-persisted-state';
import { callsignRegion, randomCallsign } from '../inference/callsign';
import { cer } from '../inference/decode';
import {
  type DualDecodeResult,
  decodeDualCallsignDataUri,
} from '../inference/dual-decode';
import { generateAudio } from '../inference/generate';
import { loadSession } from '../inference/onnx';

const TONE_FREQ = 700;
const MAX_LISTENS = 1;

type Phase = 'idle' | 'listening' | 'guessing' | 'graded';

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

export default function BeatTheBotPage() {
  useDocumentHead({
    title: 'Beat the Bot',
    description:
      'One callsign buried in static, keyed twice in a single pass — the same audio you and the model both get. Out-copy a neural CW decoder by ear, if you can.',
    path: '/beat-the-bot',
  });
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [listens, setListens] = useState(0);
  const [guess, setGuess] = useState('');
  const [botResult, setBotResult] = useState<DualDecodeResult | null>(null);
  const [modelReady, setModelReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const [isPlaying, setIsPlaying] = useState(false);
  const roundRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // Keep the audio element's volume in sync.
  // biome-ignore lint/correctness/useExhaustiveDependencies: audioRef is a stable ref
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume, round]);

  function onVolumeChange(v: number) {
    setVolume(v);
    localStorage.setItem('audioVolume', String(v));
  }

  useEffect(() => {
    loadSession()
      .then(() => setModelReady(true))
      .catch((e) => setError(String(e)));
  }, []);

  function startRound() {
    setError(null);
    setBotResult(null);
    setGuess('');
    setListens(0);
    setIsPlaying(false);
    const r = randomRound();
    setRound(r);
    setPhase('listening');
  }

  function resetScore() {
    setScore({ wins: 0, losses: 0, ties: 0 });
    setStreak(0);
    // Also clear any in-progress or graded round so the page returns to the
    // clean idle scoreboard rather than leaving a round/result card behind.
    setRound(null);
    setBotResult(null);
    setGuess('');
    setListens(0);
    setIsPlaying(false);
    setError(null);
    setPhase('idle');
  }

  function playAudio() {
    if (!audioRef.current || !round) return;
    if (listens >= MAX_LISTENS) return;
    if (isPlaying) return;
    setIsPlaying(true);
    setListens((n) => n + 1);
    const audio = audioRef.current;
    audio.currentTime = 0;
    void audio.play();
    const onEnd = () => {
      audio.removeEventListener('ended', onEnd);
      setIsPlaying(false);
    };
    audio.addEventListener('ended', onEnd);
  }

  async function submitGuess() {
    if (!round) return;
    setPhase('guessing');
    try {
      const res = await decodeDualCallsignDataUri(round.dataUri, TONE_FREQ);
      setBotResult(res);
      const userCer = cer(round.text, guess.toUpperCase().trim());
      const botCer = cer(round.text, res.text);
      const userWon = userCer < botCer;
      setScore((s) => {
        if (userWon) return { ...s, wins: s.wins + 1 };
        if (userCer > botCer) return { ...s, losses: s.losses + 1 };
        return { ...s, ties: s.ties + 1 };
      });
      // Streak counts consecutive wins; any non-win resets it.
      setStreak((st) => (userWon ? st + 1 : 0));
      setPhase('graded');
      if (userWon) fireConfetti();
    } catch (e) {
      setError(String(e));
      setPhase('listening');
    }
  }

  const userCerPct =
    round && phase === 'graded'
      ? cer(round.text, guess.toUpperCase().trim()) * 100
      : null;
  const botCerPct =
    round && botResult ? cer(round.text, botResult.text) * 100 : null;

  // Bring each new phase into view as it appears.
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    const target =
      phase === 'graded'
        ? resultRef.current
        : phase === 'listening'
          ? roundRef.current
          : null;
    if (!target) return;
    const id = window.setTimeout(
      () => target.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      100
    );
    return () => window.clearTimeout(id);
  }, [phase]);

  return (
    <div>
      <PageHeader
        eyebrow="Human vs. machine"
        icon={Swords}
        title="Beat the Bot"
      >
        The machine has out-copied humans down to −12 dB. Now it's your turn.
        One callsign, buried in static, keyed twice in a single pass — same
        audio you both get. Prove an ear still beats a model.
      </PageHeader>

      <Scoreboard
        score={score}
        streak={streak}
        modelReady={modelReady}
        hasRound={!!round}
        onStart={startRound}
        onReset={resetScore}
      />

      {error && (
        <div className="flex items-center gap-1.5 text-bad font-mono text-sm mb-4">
          <TriangleAlert className="size-4" /> {error}
        </div>
      )}

      {round && (
        <Presence show={phase === 'listening' || phase === 'guessing'}>
          <div ref={roundRef} className="scroll-mt-4">
            <Card className="mb-4">
              <CardContent>
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div className="text-[12px] text-muted-foreground font-mono">
                    ~{round.wpm} wpm
                    <span className="text-muted-foreground/40 mx-1.5">·</span>
                    SNR {round.snr} dB
                    <span className="text-muted-foreground/40 mx-1.5">·</span>
                    sent twice
                  </div>
                  <VolumeControl value={volume} onChange={onVolumeChange} />
                </div>

                {/* biome-ignore lint/a11y/useMediaCaption: programmatically generated audio */}
                <audio ref={audioRef} src={round.dataUri} preload="auto" />

                <div className="flex flex-col items-center gap-2.5 py-3">
                  <button
                    type="button"
                    onClick={playAudio}
                    disabled={
                      phase !== 'listening' ||
                      listens >= MAX_LISTENS ||
                      isPlaying
                    }
                    aria-label={listens === 0 ? 'Play once' : 'Already played'}
                    className="size-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center transition-transform enabled:hover:scale-105 enabled:active:scale-95 disabled:opacity-50"
                  >
                    {isPlaying ? (
                      <Loader2 className="size-7 animate-spin" />
                    ) : (
                      <Play
                        className="size-7 translate-x-[2px]"
                        fill="currentColor"
                      />
                    )}
                  </button>
                  <span className="inline-flex items-center gap-1.5 text-[13px] text-chart-5">
                    <Headphones className="size-3.5" />
                    {listens === 0
                      ? 'One listen — make it count'
                      : isPlaying
                        ? 'Listen closely…'
                        : 'That was your shot'}
                  </span>
                </div>

                <div className="flex gap-2 mt-2">
                  <Input
                    id="guess"
                    type="text"
                    value={guess}
                    onChange={(e) => setGuess(e.target.value.toUpperCase())}
                    placeholder="Your copy…"
                    aria-label="Your guess"
                    autoCapitalize="characters"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    className="flex-1 min-w-0 h-10 font-mono tracking-[1px]"
                    disabled={phase !== 'listening'}
                    maxLength={20}
                    onKeyDown={(e) => {
                      if (
                        e.key === 'Enter' &&
                        phase === 'listening' &&
                        guess.trim() &&
                        listens > 0
                      )
                        void submitGuess();
                    }}
                  />
                  <Button
                    variant="default"
                    disabled={
                      phase !== 'listening' || !guess.trim() || listens === 0
                    }
                    onClick={submitGuess}
                    className="shrink-0 h-10"
                  >
                    {phase === 'guessing' ? (
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
              </CardContent>
            </Card>
          </div>
        </Presence>
      )}

      <Presence
        show={
          phase === 'graded' &&
          !!round &&
          !!botResult &&
          userCerPct !== null &&
          botCerPct !== null
        }
        delay={90}
      >
        {round && botResult && userCerPct !== null && botCerPct !== null && (
          <div ref={resultRef} className="scroll-mt-4">
            <Card className="mb-4">
              <CardContent>
                <div className="flex items-center justify-center gap-2.5 mb-1">
                  <span className="text-[13px] text-muted-foreground">
                    It was
                  </span>
                  <span className="font-mono text-[22px] text-foreground tracking-[2px]">
                    {round.text}
                  </span>
                  <span className="text-[11px] bg-muted rounded-md px-2 py-0.5 text-muted-foreground">
                    {round.region}
                  </span>
                </div>
                <div className="text-center text-[11px] text-muted-foreground/70 font-mono mb-5">
                  ~{round.wpm} wpm{' '}
                  <span className="text-muted-foreground/40">·</span> SNR{' '}
                  {round.snr} dB
                </div>

                <div className="flex flex-col gap-3">
                  <MeterRow
                    who="You"
                    icon={<User className="size-3.5" />}
                    guess={guess.toUpperCase().trim()}
                    truth={round.text}
                    cerPct={userCerPct}
                    won={userCerPct < botCerPct}
                  />
                  <MeterRow
                    who="Bot"
                    icon={<Bot className="size-3.5" />}
                    guess={botResult.text}
                    truth={round.text}
                    cerPct={botCerPct}
                    won={botCerPct < userCerPct}
                  />
                </div>

                <Verdict
                  userCer={userCerPct}
                  botCer={botCerPct}
                  streak={streak}
                />

                <StaticEnvelope bars={botResult.envelopeBars} />

                <TwoLookDetail result={botResult} />

                <Button
                  variant="default"
                  onClick={startRound}
                  disabled={!modelReady}
                  className="w-full mt-5"
                >
                  <Swords className="size-4" /> Next round
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </Presence>
    </div>
  );
}

function Scoreboard({
  score,
  streak,
  modelReady,
  hasRound,
  onStart,
  onReset,
}: {
  score: { wins: number; losses: number; ties: number };
  streak: number;
  modelReady: boolean;
  hasRound: boolean;
  onStart: () => void;
  onReset: () => void;
}) {
  const lead = score.wins - score.losses;
  const played = score.wins + score.losses + score.ties;
  const standing =
    lead > 0
      ? `You're up by ${lead}`
      : lead < 0
        ? `Bot's up by ${-lead}`
        : score.wins + score.losses === 0
          ? 'First to copy wins'
          : 'Dead even';
  return (
    <Card className="mb-4">
      <CardContent>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div className="flex flex-col items-center gap-1 rounded-lg py-2.5 bg-good/10">
            <span className="inline-flex items-center gap-1.5 text-xs text-good">
              <User className="size-3.5" />
              You
            </span>
            <span className="font-mono text-[34px] leading-none font-semibold text-good">
              {score.wins}
            </span>
          </div>
          <span className="text-xs font-medium text-muted-foreground px-1">
            VS
          </span>
          <div className="flex flex-col items-center gap-1 rounded-lg py-2.5 bg-muted/50">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Bot className="size-3.5" />
              Bot
            </span>
            <span className="font-mono text-[34px] leading-none font-semibold text-foreground">
              {score.losses}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 mt-3 text-xs text-muted-foreground">
          <span>
            {score.ties} {score.ties === 1 ? 'tie' : 'ties'}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-medium text-foreground">{standing}</span>
          {streak >= 2 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 text-chart-5 font-medium">
                <Flame className="size-3.5" />
                {streak} win streak
              </span>
            </>
          )}
          {played > 0 && (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1.5 ml-1 rounded-md border border-border px-2.5 py-1 text-foreground/80 hover:text-foreground hover:bg-muted hover:border-foreground/20 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <RotateCcw className="size-3.5" />
              Reset
            </button>
          )}
        </div>

        <Button
          disabled={!modelReady}
          onClick={onStart}
          className="w-full mt-3"
        >
          {!modelReady ? (
            <>
              <Loader2 className="animate-spin size-4" /> Loading model…
            </>
          ) : (
            <>
              <Swords className="size-4" />
              {hasRound ? 'New round' : 'Start a round'}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
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

function MeterRow({
  who,
  icon,
  guess,
  truth,
  cerPct,
  won,
}: {
  who: string;
  icon: React.ReactNode;
  guess: string;
  truth: string;
  cerPct: number;
  won: boolean;
}) {
  const cells = alignChars(guess, truth);
  const pct = Math.min(100, cerPct);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="inline-flex items-center gap-1.5 text-[13px] text-foreground">
          {icon}
          {who}
          {won && <Crown className="size-3.5 text-good" />}
        </span>
        <span className="font-mono text-[17px] tracking-[1px] break-all text-right">
          {cells.length ? (
            cells.map((c, idx) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: stateless positional diff cells; list is regenerated wholesale each render
                key={idx}
                className={
                  c.kind === 'match'
                    ? 'text-good'
                    : c.kind === 'gap'
                      ? 'text-muted-foreground/40'
                      : 'text-bad'
                }
              >
                {c.ch}
              </span>
            ))
          ) : (
            <span className="text-muted-foreground text-[13px] tracking-normal">
              (nothing)
            </span>
          )}
        </span>
      </div>
      <div className="flex items-center gap-2.5">
        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full ${won ? 'bg-good' : 'bg-bad'}`}
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>
        <span
          className={`font-mono text-[12px] tabular-nums w-12 text-right ${cerPct === 0 ? 'text-good' : won ? 'text-foreground' : 'text-bad'}`}
        >
          {cerPct.toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

function Verdict({
  userCer,
  botCer,
  streak,
}: {
  userCer: number;
  botCer: number;
  streak: number;
}) {
  if (userCer < botCer)
    return (
      <div className="flex items-center justify-center gap-2 mt-5 text-[18px] font-semibold text-good">
        <Crown className="size-5" />
        {streak >= 3
          ? `You out-copied the machine — ${streak} in a row`
          : 'You out-copied the machine'}
      </div>
    );
  if (userCer > botCer)
    return (
      <div className="flex items-center justify-center gap-2 mt-5 text-[18px] font-semibold text-bad">
        <Bot className="size-5" />
        The bot copied it cleaner
      </div>
    );
  return (
    <div className="flex items-center justify-center gap-2 mt-5 text-[18px] font-semibold text-foreground">
      Dead heat — same error rate
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
    <details ref={ref} onToggle={onToggle} className="mt-4 group">
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
    <div className="mt-5">
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
