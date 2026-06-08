import {
  ArrowRight,
  Cpu,
  HelpCircle,
  Radio,
  ShieldCheck,
  Swords,
  Waves,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Reveal } from '@/components/reveal';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  HERO_CONFIDENCE,
  HERO_DECODED,
  HERO_KEYING,
  HERO_NOISY,
  HERO_SNR_DB,
} from '@/lib/hero-signal.generated';
import { cn } from '@/lib/utils';

export default function LandingPage() {
  return (
    <div className="flex flex-col gap-14 pb-6">
      <Hero />
      <Reveal>
        <SignalChain />
      </Reveal>
      <Reveal>
        <OnDevice />
      </Reveal>
      <Reveal>
        <BeatTheBotTeaser />
      </Reveal>
      <style>{WATERFALL_CSS}</style>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Hero — a REAL "CQ CQ DE KC4T" clip at −12 dB SNR. The raw signal arrives as */
/* a wall of noise (top band); the matched-filter front-end recovers clean     */
/* keying from that same clip (bottom band). Both layers are baked from one    */
/* genuine morse-audio clip — see lib/hero-signal.generated.ts. Messy in →     */
/* clean out: the pitch in one image, with nothing faked.                      */
/* -------------------------------------------------------------------------- */

function Hero() {
  return (
    <section className="relative pt-0 sm:pt-6 text-center">
      <div className="relative">
        <div className="flex items-center justify-center gap-2 mb-6 font-mono text-[11px] tracking-[0.2em] uppercase text-muted-foreground">
          <span className="inline-block size-1.5 rounded-full bg-dial shadow-[0_0_8px_2px] shadow-dial/60 animate-rx-pulse" />
          Receiver online · 700 Hz · in-browser
        </div>

        <h1 className="font-mono font-bold tracking-tight text-foreground text-3xl sm:text-5xl leading-[1.05] text-balance">
          Pull Morse out of
          <br />
          the <span className="text-primary">noise floor</span>
        </h1>

        <p className="mt-5 mx-auto max-w-2xl text-[15px] leading-relaxed text-muted-foreground text-balance">
          A neural decoder that copies CW down to{' '}
          <span className="font-mono text-dial-strong">−12&nbsp;dB</span> SNR —
          the noise carrying ~16× the power of the signal, well below where a
          tone stops being a tone to the ear. Runs entirely on your device.
        </p>

        <HeroWaveform />

        <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/decode"
            className={cn(
              buttonVariants({ variant: 'default', size: 'lg' }),
              'w-full sm:w-auto font-mono transition duration-200 hover:scale-[1.04] active:scale-[0.98]'
            )}
          >
            <Radio className="size-4" />
            Open the decoder
          </Link>
          <Link
            to="/beat-the-bot"
            className={cn(
              buttonVariants({ variant: 'secondary', size: 'lg' }),
              'w-full sm:w-auto font-mono transition duration-200 hover:scale-[1.04] active:scale-[0.98]'
            )}
          >
            <Swords className="size-4" />
            Beat the Bot
          </Link>
        </div>
      </div>
    </section>
  );
}

function HeroWaveform() {
  const snr = `−${Math.abs(HERO_SNR_DB)} dB SNR`;
  return (
    <div className="mt-10 mx-auto max-w-2xl sm:px-4">
      {/* Both scope rows share one time axis: identical width and the faint
          vertical grid behind them tie "this mush up here" to "this clean
          keying down here at the same moment." */}
      <div className="relative">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
        >
          {[0, 25, 50, 75, 100].map((p) => (
            <div
              key={p}
              className="absolute inset-y-0 w-px bg-border/50"
              style={{ left: `${p}%` }}
            />
          ))}
        </div>

        {/* Input — real raw amplitude of the −12 dB clip: a chaotic noise floor
            the keying is buried under. You can't read the message by eye here;
            that's the point. */}
        <BandLabel>Raw signal · {snr}</BandLabel>
        <div
          className="relative h-20 flex items-end justify-between gap-[2px]"
          aria-hidden="true"
        >
          {HERO_NOISY.map((v, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: positional waveform bar
              key={i}
              className="flex-1 rounded-[1px] origin-bottom bg-primary animate-rx-rise"
              style={{
                height: `${6 + v * 66}px`,
                opacity: 0.22 + v * 0.5,
                animationDelay: `${(i / HERO_NOISY.length) * 420}ms`,
              }}
            />
          ))}
          {/* amber tuner needle, sweeping the full width edge to edge */}
          <div className="absolute inset-y-0 w-px bg-dial shadow-[0_0_8px_1px] shadow-dial/60 animate-rx-sweep pointer-events-none" />
        </div>

        <div className="my-3 h-px bg-border" />

        {/* Output — the same message as a real CW timing diagram: on/off
            keying at true dit/dah ratios (dit 1, dah 3, gaps 1/3/7), so a ham
            can read the code by eye. Baked from the message, full call. */}
        <BandLabel>Recovered keying · matched filter</BandLabel>
        <div className="relative flex items-end h-8" aria-hidden="true">
          {HERO_KEYING.map(([on, units], i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: positional keying segment
              key={i}
              className="flex items-end self-stretch"
              style={{ flexGrow: units, flexBasis: 0 }}
            >
              {on ? (
                <div
                  className="w-full h-6 rounded-[2px] bg-key shadow-[0_0_6px_0] shadow-primary/30 origin-bottom animate-rx-rise"
                  style={{
                    animationDelay: `${480 + (i / HERO_KEYING.length) * 360}ms`,
                  }}
                />
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {/* Decoded text — the payoff. HERO_DECODED is CWNet's genuine output for
          this exact clip (the bake refuses to ship unless it's letter-perfect),
          and the percentage is the model's real confidence. */}
      <div className="mt-3.5 flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <span className="font-mono text-sm sm:text-lg tracking-[0.1em] sm:tracking-[0.18em] text-foreground">
          {HERO_DECODED}
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.15em] text-good shrink-0">
          <span className="inline-block size-1.5 rounded-full bg-good shadow-[0_0_8px_1px] shadow-good/60 animate-rx-pulse" />
          decoded · {Math.round(HERO_CONFIDENCE * 100)}%
        </span>
      </div>
    </div>
  );
}

function BandLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Signal chain — Generate → Decode → Compare.                                */
/* -------------------------------------------------------------------------- */

const STAGES = [
  {
    icon: Waves,
    label: '01 · Generate',
    body: 'Key any text at 12–50 WPM, then bury it: set the SNR and add the impairments real bands throw at you — AWGN, QSB fading — all synthesized in-browser.',
  },
  {
    icon: Cpu,
    label: '02 · Decode',
    body: 'CWNet — an 808k-param CNN→TCN→BiGRU with a CTC head (3.1 MB) — reads the signal envelope and copies the characters. Pure WASM, no server.',
  },
  {
    icon: Radio,
    label: '03 · Compare',
    body: 'The copy is graded against ground truth with a Levenshtein-aligned diff — character error rate, confidence, per-stage timing. No black box.',
  },
];

function SignalChain() {
  return (
    <section>
      <SectionLabel>The signal chain</SectionLabel>
      <div className="mt-5 grid sm:grid-cols-[1fr_auto_1fr_auto_1fr] gap-y-4 items-stretch">
        {STAGES.map((stage, i) => (
          <Stage
            key={stage.label}
            stage={stage}
            last={i === STAGES.length - 1}
            delay={i * 110}
          />
        ))}
      </div>
    </section>
  );
}

function Stage({
  stage,
  last,
  delay,
}: {
  stage: (typeof STAGES)[number];
  last: boolean;
  delay: number;
}) {
  const Icon = stage.icon;
  return (
    <>
      <Reveal delay={delay}>
        <Card className="py-0 h-full">
          <CardContent className="p-4 flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <Icon className="size-4 text-primary" />
              <span className="font-mono text-[11px] tracking-[0.15em] uppercase text-muted-foreground">
                {stage.label}
              </span>
            </div>
            <p className="text-[13px] leading-relaxed text-foreground/80">
              {stage.body}
            </p>
          </CardContent>
        </Card>
      </Reveal>
      {!last && (
        <div className="hidden sm:flex items-center justify-center px-2 text-muted-foreground/40">
          <ArrowRight className="size-4" />
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* On-device strip.                                                           */
/* -------------------------------------------------------------------------- */

function OnDevice() {
  return (
    <Card>
      <CardContent className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <ShieldCheck className="size-7 text-good shrink-0" />
        <div>
          <h3 className="font-mono text-sm tracking-wide text-foreground">
            Nothing leaves your device
          </h3>
          <p className="text-[13px] leading-relaxed text-muted-foreground mt-1">
            CWNet runs locally on the WASM backend of ONNX Runtime, threaded
            across your cores. There is no backend — your audio never leaves the
            tab. Pop open the network panel and watch: once the{' '}
            <span className="font-mono">.onnx</span> weights load, decoding
            fires zero requests.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Beat the Bot — the honest fairness hook.                                   */
/* -------------------------------------------------------------------------- */

function BeatTheBotTeaser() {
  return (
    <section>
      <SectionLabel>
        <Swords className="size-3.5 text-primary" />
        Beat the Bot
      </SectionLabel>
      <div className="mt-4 grid gap-5 sm:grid-cols-[1fr_minmax(0,20rem)] sm:items-center">
        {/* main pitch */}
        <div>
          <p className="max-w-lg text-[15px] leading-relaxed text-foreground/85">
            A callsign, buried in static, keyed{' '}
            <span className="text-dial-strong font-mono">twice</span> in one
            clip — the same audio you both get. You stitch the two repeats
            together in your head on the fly; the model decodes each send on its
            own and merges them. Same trick, different hardware.
          </p>
          <div className="mt-6">
            <Link
              to="/faq#is-it-rigged"
              className={cn(
                buttonVariants({ variant: 'secondary' }),
                'w-full sm:w-auto font-mono'
              )}
            >
              <HelpCircle className="size-4" />
              How the matchup works
            </Link>
          </div>
        </div>

        {/* fairness callout — amber accent to draw the eye */}
        <div className="rounded-lg border border-dial/40 border-l-2 border-l-dial bg-dial/[0.06] p-4">
          <div className="font-mono text-[11px] tracking-[0.15em] uppercase text-dial-strong mb-2">
            Is that a fair fight?
          </div>
          <p className="text-[13px] leading-relaxed text-foreground/80">
            It's the interesting question, and we don't hide it — every round
            shows exactly how the bot used its two looks.
          </p>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Bits.                                                                      */
/* -------------------------------------------------------------------------- */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.2em] uppercase text-muted-foreground">
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Hero animations + inline accent.                                           */
/* -------------------------------------------------------------------------- */

const WATERFALL_CSS = `
/* a brighter amber for inline emphasis that still reads on light + dark */
.text-dial-strong { color: color-mix(in oklch, var(--dial) 78%, var(--foreground)); }

/* bright lavender for the recovered-keying marks — same hue family as the
   purple noise floor, but lifted toward white so it reads as "clean" above it */
.bg-key { background-color: color-mix(in oklch, var(--primary) 42%, white); }

@keyframes rx-rise {
  from { transform: scaleY(0); opacity: 0; }
  to   { transform: scaleY(1); opacity: 1; }
}
.animate-rx-rise { animation: rx-rise 0.5s cubic-bezier(0.22,1,0.36,1) both; }

@keyframes rx-sweep {
  /* sweep the full width edge to edge, then hold off the rest of the cycle so
     the needle passes occasionally rather than constantly. ~2.7s in a 12s loop. */
  0%    { left: 0%; opacity: 0; }
  2%    { opacity: 1; }
  20%   { left: 100%; opacity: 1; }
  23%   { left: 100%; opacity: 0; }
  100%  { left: 0%; opacity: 0; }
}
.animate-rx-sweep { animation: rx-sweep 12s ease-in-out infinite; }

@keyframes rx-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.35; }
}
.animate-rx-pulse { animation: rx-pulse 1.8s ease-in-out infinite; }

@media (prefers-reduced-motion: reduce) {
  .animate-rx-rise, .animate-rx-sweep, .animate-rx-pulse {
    animation: none;
  }
  .animate-rx-rise { transform: scaleY(1); opacity: 1; }
}
`;
