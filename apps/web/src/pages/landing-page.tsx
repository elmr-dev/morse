// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowRight,
  Cpu,
  Download,
  Gauge,
  HelpCircle,
  Radio,
  ShieldCheck,
  Waves,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { BoxingGloveIcon } from '@/components/boxing-glove-icon';
import DecodeDemo from '@/components/decode-demo';
import { Reveal } from '@/components/reveal';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SITE_DESCRIPTION, SITE_TITLE } from '@/lib/site';
import { useDocumentHead } from '@/lib/use-document-head';
import { cn } from '@/lib/utils';

export default function LandingPage() {
  useDocumentHead({
    fullTitle: SITE_TITLE,
    description: SITE_DESCRIPTION,
    path: '/',
  });
  return (
    <div className="flex flex-col gap-14 pb-6">
      <Hero />
      <Reveal>
        <Trainers />
      </Reveal>
      <Reveal>
        <SignalChain />
      </Reveal>
      <Reveal>
        <OnDevice />
      </Reveal>
      <Reveal>
        <BeatTheBotTeaser />
      </Reveal>
      <style>{HERO_CSS}</style>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Hero — the live decode demo. Bury text in noise and watch CWNet copy it in  */
/* the very first interaction. This is a DEMO, not the real decoder: the real  */
/* one is the future Tauri desktop app ("decode for real").                   */
/* -------------------------------------------------------------------------- */

function Hero() {
  return (
    <section className="relative pt-0 sm:pt-6 text-center">
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
        the noise carrying ~16× the power of the signal, well below where a tone
        stops being a tone to the ear. Try it right here: key a message, bury
        it, and watch the model copy it back.
      </p>

      {/* The demo itself — left-aligned chrome inside a centered hero. */}
      <div className="mt-9 mx-auto max-w-2xl text-left">
        <DecodeDemo />
      </div>
      <p className="mt-3 text-[12px] text-muted-foreground">
        This is a live demo. The full decoder ships as a desktop app — see
        below.
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Trainers — a full-bleed band (distinct from the demo above) pointing at the */
/* two scored trainers, plus the deferred desktop decoder.                    */
/* -------------------------------------------------------------------------- */

const TRAINER_CARDS = [
  {
    to: '/beat-the-bot',
    icon: BoxingGloveIcon,
    title: 'Beat the Bot',
    body: 'A callsign buried in static, keyed twice — copy it before a neural decoder does. Pick your license class; climb the public board.',
    cta: 'Take the bot on',
  },
  {
    to: '/redline',
    icon: Gauge,
    title: 'Redline',
    body: 'Copy random callsigns at the edge of your speed. Every clean copy nudges the WPM up; your best score and top WPM land on the board.',
    cta: 'Push your speed',
  },
] as const;

function Trainers() {
  return (
    // Full-bleed colored band: breaks out of the centered content column, with
    // its own inner column re-aligned to the same width as the blocks around it.
    <section className="w-screen ml-[calc(50%-50vw)] border-y border-border bg-card">
      <div className="mx-auto max-w-[900px] px-5 py-12">
        <SectionLabel>Train your copy</SectionLabel>
        <h2 className="mt-3 font-mono text-2xl font-bold tracking-tight text-foreground">
          Two ways to drill — both scored
        </h2>
        <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
          The demo proves the model can read CW. These put{' '}
          <span className="text-foreground">you</span> on the key — each a
          trainer with its own public leaderboard.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {TRAINER_CARDS.map(({ to, icon: Icon, title, body, cta }) => (
            <Link
              key={to}
              to={to}
              className="group flex flex-col gap-3 rounded-xl border border-border bg-background p-5 transition-colors hover:border-primary/50 hover:bg-muted/30 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <div className="flex items-center gap-2.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
                  <Icon className="size-4" />
                </span>
                <span className="font-mono text-lg font-semibold text-foreground">
                  {title}
                </span>
              </div>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                {body}
              </p>
              <span className="mt-auto inline-flex items-center gap-1 font-mono text-[13px] text-primary">
                {cta}
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>

        {/* Deferred desktop decoder — named, not linked (the Tauri app isn't
            built yet, so no Download page). */}
        <div className="mt-5 flex flex-col items-start gap-2 rounded-lg border border-dashed border-border px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
          <span className="inline-flex items-center gap-2 font-mono text-[13px] font-medium text-foreground">
            <Download className="size-4 text-muted-foreground" />
            Decode for real
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              Soon
            </span>
          </span>
          <span className="text-[13px] text-muted-foreground">
            The demo above is in-browser; the full decoder ships as a desktop
            app.
          </span>
        </div>
      </div>
    </section>
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
        <BoxingGloveIcon className="size-3.5 text-primary" />
        Beat the Bot
      </SectionLabel>
      <div className="mt-4 grid gap-5 sm:grid-cols-[1fr_minmax(0,20rem)] sm:items-center">
        {/* main pitch */}
        <div>
          <p className="max-w-lg text-[15px] leading-relaxed text-foreground/85">
            A callsign, buried in static, keyed{' '}
            <span className="text-dial-strong font-mono">twice</span> in one
            clip — yours eased to your tier, the bot’s cranked to Extra. You
            stitch the repeats together in your head on the fly; the model
            decodes each send on its own and merges them. Same trick, different
            hardware.
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
        <div className="rounded-lg border border-dial/40 border-l-2 border-l-dial bg-dial/6 p-4">
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
/* Hero accents.                                                              */
/* -------------------------------------------------------------------------- */

const HERO_CSS = `
/* a brighter amber for inline emphasis that still reads on light + dark */
.text-dial-strong { color: color-mix(in oklch, var(--dial) 78%, var(--foreground)); }

@keyframes rx-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.35; }
}
.animate-rx-pulse { animation: rx-pulse 1.8s ease-in-out infinite; }

@media (prefers-reduced-motion: reduce) {
  .animate-rx-pulse { animation: none; }
}
`;
