import {
  Activity,
  AudioLines,
  CircleCheck,
  Clock,
  Cpu,
  Gauge,
  Loader2,
  MonitorSmartphone,
  Radio,
  RotateCcw,
  Shuffle,
  Sparkles,
  TriangleAlert,
  Waves,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import AudioPlayer, { fmt } from '@/components/audio-player';
import PageHeader from '@/components/page-header';
import { Presence } from '@/components/presence';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import VolumeControl from '@/components/volume-control';
import { randomCwMessage } from '@/lib/cw-message';
import { usePersistedState } from '@/lib/use-persisted-state';
import { cer } from '../inference/decode';
import { generateAudio } from '../inference/generate';
import { loadSession } from '../inference/onnx';
import { decodeDataUri, type PipelineResult } from '../inference/pipeline';

const TONE_FREQ = 700;
const DEFAULT_WPM = 25;
const DEFAULT_SNR = 6;
const DEFAULT_QSB = false;

export default function DecodePage() {
  const [text, setText] = useState(() => randomCwMessage());
  const [wpm, setWpm] = usePersistedState('decode.wpm', DEFAULT_WPM);
  const [snr, setSnr] = usePersistedState('decode.snr', DEFAULT_SNR);
  const [qsb, setQsb] = usePersistedState('decode.qsb', DEFAULT_QSB);

  const [dataUri, setDataUri] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(() => {
    const stored = parseFloat(localStorage.getItem('audioVolume') ?? '');
    return Number.isNaN(stored) ? 1 : stored;
  });
  const [playTime, setPlayTime] = useState({ current: 0, duration: 0 });
  const resultsRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  // Guards the auto-scroll so it fires once per generate, not on every render
  // (e.g. play-time ticks). Regenerate re-arms it explicitly in onGenerate.
  const didScrollRef = useRef(false);
  // Auto-grow the message field so a long message wraps into view on narrow
  // screens instead of scrolling off the right edge.
  const textRef = useRef<HTMLTextAreaElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text changes.
  useEffect(() => {
    const ta = textRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [text]);

  const onTime = useCallback((current: number, duration: number) => {
    setPlayTime({ current, duration });
  }, []);

  // The first time a decode completes, gently bring the results into view.
  // Subsequent regenerates don't re-scroll (the results are already on screen,
  // and re-scrolling causes a visible jump, worse with tall/long output).
  useEffect(() => {
    if (!result) return;
    if (didScrollRef.current) return;
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    didScrollRef.current = true;
    const id = window.setTimeout(() => {
      // Bring the model output into view (it's the point of a decode), falling
      // back to the results container if its card isn't mounted yet.
      (modelRef.current ?? resultsRef.current)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 100);
    return () => window.clearTimeout(id);
  }, [result]);

  // Any input change invalidates the current clip + decode; clear them so the
  // stale Audio / Model output cards don't outlive the inputs they came from.
  function clearOutput() {
    setDataUri(null);
    setResult(null);
    setError(null);
    setPlayTime({ current: 0, duration: 0 });
    didScrollRef.current = false;
  }

  function changeText(v: string) {
    setText(v);
    // Only clear stale output if there actually is any; avoids firing several
    // state updates on every keystroke (which can make fast typing feel laggy
    // or drop characters).
    if (dataUri || result || error) clearOutput();
  }
  // While dragging a signal slider, update the value live (so the label and
  // thumb track) but DON'T touch the output yet. Clearing on every intermediate
  // value makes the cards below flicker away mid-drag — very noticeable on iOS,
  // where moving, pausing, and moving again repeatedly tears them down. The
  // stale clip/decode is cleared once, on commit (pointer-up / keyboard), via
  // commitSignal below.
  function changeWpm(v: number) {
    setWpm(v);
  }
  function changeSnr(v: number) {
    setSnr(v);
  }
  // Fired by the sliders' onValueCommit — i.e. the user finished interacting.
  function commitSignal() {
    if (dataUri || result || error) clearOutput();
  }
  function changeQsb(v: boolean) {
    setQsb(v);
    clearOutput();
  }

  function resetSignal() {
    setWpm(DEFAULT_WPM);
    setSnr(DEFAULT_SNR);
    setQsb(DEFAULT_QSB);
    clearOutput();
  }

  const signalIsDefault =
    wpm === DEFAULT_WPM && snr === DEFAULT_SNR && qsb === DEFAULT_QSB;

  function onVolumeChange(v: number) {
    setVolume(v);
    localStorage.setItem('audioVolume', String(v));
  }

  useEffect(() => {
    loadSession()
      .then(() => setModelReady(true))
      .catch((e) => setError(String(e)));
  }, []);

  async function onGenerate() {
    setError(null);
    setResult(null);
    setBusy(true);
    // Regenerate is an explicit user action, so bring the freshly-animated
    // results back into view (the scroll effect is otherwise one-shot).
    didScrollRef.current = false;
    try {
      const out = generateAudio({
        text: text.toUpperCase(),
        wpm,
        snrDb: snr,
        frequency: TONE_FREQ,
        qsb,
      });
      setDataUri(out.dataUri);
      const decoded = await decodeDataUri(out.dataUri, TONE_FREQ);
      setResult(decoded);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Generate & decode" icon={Radio} title="Decode">
        Generate a Morse clip from 12–50 WPM at any SNR, then watch the model
        copy it — entirely in your browser.
      </PageHeader>
      <div className="flex flex-wrap gap-2 mb-4">
        <span className="inline-flex items-center gap-1.5 text-xs bg-muted rounded-full px-3 py-1">
          <Cpu className="size-3.5 text-primary" />
          <span className="font-medium text-foreground">CWNet</span>
          <span className="text-muted-foreground font-mono">
            &middot; 808k &middot; 3.1 MB
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs bg-muted rounded-full px-3 py-1 text-muted-foreground">
          <MonitorSmartphone className="size-3.5" />
          runs in-browser
        </span>
      </div>

      <div className="mb-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <Label htmlFor="text" className="sr-only">
            Text
          </Label>
          <div className="relative flex-1 min-w-0">
            <textarea
              id="text"
              ref={textRef}
              rows={1}
              value={text}
              onChange={(e) => changeText(e.target.value.replace(/\n+/g, ' '))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (modelReady && !busy && text.trim()) void onGenerate();
                }
              }}
              placeholder="Type a message, or hit Random"
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={40}
              disabled={!modelReady}
              className="w-full min-h-10 resize-none overflow-hidden rounded-md border border-input bg-card px-3 py-2 pr-10 font-mono uppercase text-base md:text-sm leading-snug shadow-xs outline-none transition-[color,box-shadow] placeholder:normal-case placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
            />
            {text && modelReady && (
              <button
                type="button"
                onClick={() => changeText('')}
                aria-label="Clear text"
                className="absolute right-1 top-1.5 inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <Button
            variant="secondary"
            onClick={() => changeText(randomCwMessage())}
            type="button"
            disabled={!modelReady}
            className="shrink-0 h-10 w-full sm:w-auto"
          >
            <Shuffle className="size-4" />
            Random
          </Button>
        </div>

        {(text.includes(' ') || text.length >= 30) && (
          <div className="mt-1.5 flex items-start gap-3 text-[11px] text-muted-foreground">
            <span className="flex-1">
              {text.includes(' ') &&
                'Spaces are keyed as word breaks. The model copies letters only, so they don’t count against it.'}
            </span>
            {text.length >= 30 && (
              <span className="shrink-0 font-mono">
                <span className={text.length >= 40 ? 'text-bad' : undefined}>
                  {text.length}
                </span>
                /40
              </span>
            )}
          </div>
        )}

        <div className="mt-4 rounded-lg border border-border bg-card p-3 select-none">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Signal
            </div>
            {!signalIsDefault && (
              <button
                type="button"
                onClick={resetSignal}
                disabled={!modelReady}
                className="inline-flex items-center gap-1.5 -my-1.5 -mr-1.5 rounded-md px-2 py-1.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <RotateCcw className="size-3.5" />
                Reset
              </button>
            )}
          </div>
          <div className="grid grid-cols-[18px_auto_1fr_auto] items-center gap-x-3 gap-y-4">
            <Gauge className="size-4 text-muted-foreground" />
            <Label className="text-[13px]">WPM</Label>
            <Slider
              min={12}
              max={50}
              value={[wpm]}
              onValueChange={([n]) => changeWpm(n)}
              onValueCommit={commitSignal}
              disabled={!modelReady}
            />
            <span className="justify-self-end font-mono text-[13px] font-medium text-foreground bg-muted rounded-md px-2 py-0.5 min-w-[40px] text-center">
              {wpm}
            </span>

            <Activity className="size-4 text-muted-foreground" />
            <Label className="text-[13px]">SNR (dB)</Label>
            <Slider
              min={-15}
              max={20}
              value={[snr]}
              onValueChange={([n]) => changeSnr(n)}
              onValueCommit={commitSignal}
              disabled={!modelReady}
            />
            <span className="justify-self-end font-mono text-[13px] font-medium text-foreground bg-muted rounded-md px-2 py-0.5 min-w-[40px] text-center">
              {snr}
            </span>

            <Waves className="size-4 text-muted-foreground self-start mt-0.5" />
            <div className="col-span-2">
              <Label htmlFor="qsb" className="text-[13px]">
                QSB (fading)
              </Label>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Moderate fading, 0.2 Hz rate
              </div>
            </div>
            <Switch
              id="qsb"
              checked={qsb}
              onCheckedChange={changeQsb}
              disabled={!modelReady}
              className="justify-self-end self-start mt-0.5"
            />
          </div>
        </div>

        <div className="mt-4">
          <Button
            variant="default"
            disabled={busy || !modelReady || !text.trim()}
            onClick={onGenerate}
            className="w-full"
          >
            {!modelReady ? (
              <>
                <Loader2 className="animate-spin size-4" /> Loading model…
              </>
            ) : busy ? (
              <>
                <Loader2 className="animate-spin size-4" /> Decoding…
              </>
            ) : result || dataUri ? (
              <>
                <Shuffle className="size-4" /> Regenerate
              </>
            ) : (
              <>
                <Sparkles className="size-4" /> Generate &amp; decode
              </>
            )}
          </Button>
          {error && (
            <div className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-bad font-mono">
              <TriangleAlert className="size-4 shrink-0" /> {error}
            </div>
          )}
        </div>
      </div>

      <div ref={resultsRef} className="scroll-mt-4">
        <Presence show={!!dataUri}>
          {dataUri && (
            <Card className="mb-4 py-4 gap-3">
              <CardHeader className="[&]:flex [&]:flex-row [&]:items-center [&]:gap-3">
                <CardTitle className="flex-1">
                  <AudioLines className="size-5 text-chart-5" />
                  Generated clip
                </CardTitle>
                <VolumeControl
                  value={volume}
                  onChange={onVolumeChange}
                  align="center"
                />
                <span className="shrink-0 inline-flex items-center gap-1.5 text-xs text-muted-foreground font-mono tabular-nums">
                  <Clock className="size-3.5" />
                  {fmt(playTime.current)} / {fmt(playTime.duration)}
                </span>
              </CardHeader>
              <CardContent>
                <AudioPlayer
                  src={dataUri}
                  bars={result?.envelopeBars}
                  volume={volume}
                  onTime={onTime}
                />
              </CardContent>
            </Card>
          )}
        </Presence>

        <Presence show={!!result} delay={90}>
          {result &&
            (() => {
              // The model's charset has no space, so it never emits word gaps. Grade
              // against the input with spaces removed — otherwise a perfectly copied
              // multi-word phrase shows one "error" per space. Word breaks are a
              // human reading-aid, not something CWNet is trained to output.
              const refText = text.toUpperCase().replace(/\s+/g, '');
              const cerPct = cer(refText, result.text) * 100;
              const diff = diffChars(refText, result.text);
              const errors = diff.filter((d) => !d.match).length;
              const perfect = errors === 0 && result.text.length > 0;
              // Indices (into the space-stripped reference) where a new word begins,
              // derived from where the user put spaces in the original input. Used to
              // re-insert visible word breaks into the spaceless output for reading.
              const wordStarts = wordStartIndices(text.toUpperCase());
              return (
                <Card ref={modelRef} className="mb-4">
                  <CardHeader className="[&]:flex [&]:flex-row [&]:items-center [&]:gap-2">
                    <CardTitle className="flex-1">
                      <Cpu
                        className={`size-5 ${perfect ? 'text-good' : result.text.length > 0 ? 'text-bad' : 'text-primary'}`}
                      />
                      Model output
                    </CardTitle>
                    {result.text.length > 0 &&
                      (perfect ? (
                        <span className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-good/15 text-good">
                          <CircleCheck className="size-3.5" />
                          Perfect copy
                        </span>
                      ) : (
                        <span className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-bad/15 text-bad">
                          <TriangleAlert className="size-3.5" />
                          {errors} {errors === 1 ? 'error' : 'errors'}
                        </span>
                      ))}
                  </CardHeader>
                  <CardContent>
                    <div
                      className={`font-mono text-[22px] px-4 py-3 rounded-md tracking-[2px] break-all min-h-[52px] flex items-center gap-3 ${
                        perfect ? 'bg-good/10' : 'bg-muted'
                      }`}
                    >
                      {result.text ? (
                        <>
                          {perfect && (
                            <CircleCheck className="size-5 text-good shrink-0" />
                          )}
                          <span>
                            {(() => {
                              let refSeen = 0;
                              return diff.map((d, i) => {
                                // Insert a word break before this cell if the ref char
                                // it consumes starts a new word in the original input.
                                const gap =
                                  d.ref !== '·' && wordStarts.has(refSeen);
                                if (d.ref !== '·') refSeen++;
                                return (
                                  // biome-ignore lint/suspicious/noArrayIndexKey: positional ref-character cell; list is regenerated each render
                                  <span key={i}>
                                    {gap && (
                                      <span className="text-muted-foreground/40 mx-0.5">
                                        ·
                                      </span>
                                    )}
                                    <span
                                      className={
                                        d.match
                                          ? perfect
                                            ? 'text-good'
                                            : 'text-foreground'
                                          : 'text-bad'
                                      }
                                    >
                                      {d.hyp}
                                    </span>
                                  </span>
                                );
                              });
                            })()}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground text-[13px]">
                          (no output)
                        </span>
                      )}
                    </div>

                    {!perfect && result.text.length > 0 && (
                      <div className="mt-3 p-3 bg-background border border-border rounded-md">
                        <div className="text-muted-foreground text-xs mb-1.5">
                          vs. ground truth
                        </div>
                        <div className="font-mono text-[20px] tracking-[3px] break-all">
                          {diff.map((d, i) => (
                            <span
                              // biome-ignore lint/suspicious/noArrayIndexKey: stateless positional diff cells; list is regenerated wholesale each render
                              key={i}
                              className={
                                d.match ? 'text-good' : 'text-bad font-bold'
                              }
                            >
                              {d.ref}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <div className="bg-background border border-border rounded-md px-3 py-2">
                        <div className="text-muted-foreground text-xs">
                          Character error
                        </div>
                        <div
                          className={`font-mono text-[22px] font-medium ${perfect ? 'text-good' : 'text-bad'}`}
                        >
                          {cerPct.toFixed(1)}%
                        </div>
                      </div>
                      <div className="bg-background border border-border rounded-md px-3 py-2">
                        <div className="text-muted-foreground text-xs">
                          Confidence
                        </div>
                        <div className="font-mono text-[22px] font-medium text-foreground">
                          {(result.confidence * 100).toFixed(0)}%
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <TimingStat
                        label="Inference"
                        ms={result.timing.modelMs}
                      />
                      <TimingStat label="Total" ms={result.timing.totalMs} />
                      <TimingStat label="DSP" ms={result.timing.dspMs} />
                      <TimingStat label="CTC" ms={result.timing.decodeMs} />
                    </div>
                  </CardContent>
                </Card>
              );
            })()}
        </Presence>
      </div>
    </div>
  );
}

function TimingStat({ label, ms }: { label: string; ms: number }) {
  return (
    <div className="bg-background/50 rounded-md px-3 py-1.5 flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-muted-foreground font-mono text-[13px] tabular-nums">
        {ms.toFixed(0)} ms
      </span>
    </div>
  );
}

function diffChars(
  ref: string,
  hyp: string
): { ref: string; hyp: string; match: boolean }[] {
  // Levenshtein alignment (not positional) so a single dropped/added char
  // doesn't cascade every later position into a false mismatch. Returns
  // aligned cells with '·' marking a gap on either side. Error count and
  // coloring derived from this now agree with cer().
  const m = ref.length;
  const n = hyp.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  const out: { ref: string; hyp: string; match: boolean }[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (
      i > 0 &&
      j > 0 &&
      dp[i][j] === dp[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)
    ) {
      const match = ref[i - 1] === hyp[j - 1];
      out.push({ ref: ref[i - 1], hyp: hyp[j - 1], match });
      i--;
      j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      out.push({ ref: ref[i - 1], hyp: '·', match: false });
      i--; // ref char the model missed
    } else {
      out.push({ ref: '·', hyp: hyp[j - 1], match: false });
      j--; // model emitted an extra char
    }
  }
  out.reverse();
  return out;
}

// Given the original spaced input, return the set of indices (into the
// space-stripped string) where a new word begins, excluding the first word.
// Used to re-insert visible word breaks into the model's spaceless output.
function wordStartIndices(text: string): Set<number> {
  const starts = new Set<number>();
  let stripped = 0;
  let prevWasSpace = false;
  for (let k = 0; k < text.length; k++) {
    if (/\s/.test(text[k])) {
      prevWasSpace = true;
      continue;
    }
    if (prevWasSpace && stripped > 0) starts.add(stripped);
    prevWasSpace = false;
    stripped++;
  }
  return starts;
}
