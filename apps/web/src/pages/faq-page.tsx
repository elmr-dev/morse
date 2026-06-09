import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  Code,
  Cpu,
  Mic,
  Plus,
  Radio,
  Scale,
  Swords,
  Trophy,
} from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { GITHUB_URL } from '@/components/github';
import { Reveal } from '@/components/reveal';
import { useDocumentHead } from '@/lib/use-document-head';
import { cn } from '@/lib/utils';

interface QA {
  q: string;
  /** Plain-language answer — paragraphs. */
  a: string[];
  /** Optional rich answer node, rendered in place of `a` when present (for
   *  inline links etc.). */
  node?: React.ReactNode;
  /** Optional deeper, ham/technical expansion. */
  technical?: string[];
  /** Stable deep-link anchor (e.g. /faq#is-it-rigged). Falls back to a slug of
   *  the question, but set this explicitly for any question linked to from
   *  elsewhere so the URL survives copy edits. */
  anchor?: string;
}

/** URL-safe id for a question — its explicit anchor or a slug of the text. */
function faqId(item: QA): string {
  return (
    item.anchor ??
    item.q
      .toLowerCase()
      .replace(/[''“”]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
  );
}

const hamQthUrl = (call: string) =>
  `https://www.hamqth.com/${call.toLowerCase()}`;

/** A callsign rendered as a link to its HamQTH profile. */
function Op({ call }: { call: string }) {
  return (
    <a
      href={hamQthUrl(call)}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-dial-strong underline decoration-dial/40 underline-offset-2 hover:decoration-dial transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm"
    >
      {call}
    </a>
  );
}

/** The two operators behind MORSE, shown as cards in the "Who made this"
 *  answer — name, HamQTH-linked call sign, and what they built. */
const BUILDERS = [
  {
    icon: Cpu,
    name: 'Mark Percival',
    call: 'KC4T',
    role: 'Creator & ML/DSP — started MORSE, trained CWNet, and built the morse-audio signal chain.',
  },
  {
    icon: Code,
    name: 'John Schult',
    call: 'W4GIT',
    role: 'Engineering & UX — the frontend, plus the tooling and infrastructure holding the repo together.',
  },
] satisfies ReadonlyArray<{
  icon: typeof Cpu;
  name: string;
  call: string;
  role: string;
}>;

function Builders() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground leading-relaxed">
        MORSE is a two-person project — we built the decoder and the game
        together, with different centers of gravity.
      </p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {BUILDERS.map(({ icon: Icon, name, call, role }) => (
          <div
            key={call}
            className="flex gap-3 rounded-md border border-border bg-background p-3"
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Icon className="size-4" />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-[13px] font-medium text-foreground">
                  {name}
                </span>
                <Op call={call} />
              </div>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                {role}
              </p>
            </div>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">
        The source is public on{' '}
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="text-dial-strong underline decoration-dial/40 underline-offset-2 hover:decoration-dial transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm"
        >
          GitHub
        </a>
        .
      </p>
    </div>
  );
}

/** Forward-looking work, shown as distinct cards in the "What's next?" answer.
 *  `accent` lifts an item into the amber dial treatment to draw the eye. */
const ROADMAP = [
  {
    icon: Trophy,
    title: 'Accounts & leaderboard',
    status: 'Coming soon',
    accent: true,
    body: 'Sign in, claim your call sign, and save your Beat-the-Bot results. A leaderboard ranks the top performances so you can see how you stack up against other operators — and licensed hams can optionally verify their call sign to earn a badge.',
  },
  {
    icon: Mic,
    title: 'Live decoding',
    status: 'Planned',
    body: 'Feed a real microphone or receiver into the model and copy CW as it arrives, in streaming chunks. The pieces are specced in the code — not wired up yet.',
  },
  {
    icon: Scale,
    title: 'Matchup & fairness tuning',
    status: 'Ongoing',
    body: 'Continued refinement of the Beat-the-Bot matchup and the fairness model behind it.',
  },
] satisfies ReadonlyArray<{
  icon: typeof Mic;
  title: string;
  status: string;
  body: string;
  accent?: boolean;
}>;

function Roadmap() {
  return (
    <div className="flex flex-col gap-2.5">
      {ROADMAP.map(({ icon: Icon, title, status, body, accent }) => (
        <div
          key={title}
          className={cn(
            'flex gap-3 rounded-md border p-3',
            accent
              ? 'border-dial/40 border-l-2 border-l-dial bg-dial/6'
              : 'border-border bg-background'
          )}
        >
          <div
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-md',
              accent
                ? 'bg-dial/15 text-dial-strong'
                : 'bg-muted text-muted-foreground'
            )}
          >
            <Icon className="size-4" />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[13px] font-medium text-foreground">
                {title}
              </span>
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest',
                  accent
                    ? 'bg-dial/15 text-dial-strong'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                {status}
              </span>
            </div>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {body}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

interface FaqSection {
  heading: string;
  items: QA[];
}

const SECTIONS: FaqSection[] = [
  {
    heading: 'The basics',
    items: [
      {
        q: 'What is MORSE?',
        a: [
          'MORSE is a browser app that generates Morse code (CW) audio and decodes it with a small machine-learning model — all on your own device. You can dial in the speed and how much noise to bury the signal under, then watch the model copy it. There is also a game where you try to out-copy the model by ear.',
        ],
      },
      {
        q: 'What is CW / Morse code?',
        a: [
          'CW (“continuous wave”) is the on-off keying of a single tone into the dots and dashes of Morse code. It is one of the oldest modes in radio and is still used by amateur radio operators today because it gets through when voice cannot — a faint, narrow CW signal can be copied where a phone signal is just mush.',
        ],
      },
      {
        q: 'Do I need a radio or any special hardware?',
        a: [
          'No. MORSE generates the audio itself, right in the page. You do not need a radio, a key, or any software install. Live decoding from a microphone or a real receiver is on the roadmap, but everything today runs from synthesized clips.',
        ],
      },
    ],
  },
  {
    heading: 'How the decoding works',
    items: [
      {
        q: 'How does the decoder actually work?',
        a: [
          'The audio is turned into a simple picture of its energy over time, and a neural network reads that picture and predicts the sequence of characters. It was trained on huge amounts of synthetic CW at many speeds and noise levels, so it learns to copy through interference rather than relying on clean, perfectly-timed code.',
        ],
        technical: [
          'The network is CWNet — a CNN front end into a TCN and a bidirectional GRU, trained with a CTC objective (~808k parameters, exported to a 3.1 MB ONNX file). Input is a 4-channel envelope sampled at 500 Hz; output is per-frame log-probabilities over 42 classes (a CTC blank, A–Z, 0–9, and . , ? = /) at 250 Hz. A greedy CTC decode on the JavaScript side — gated by output entropy, blank ratio, and a run-length filter — collapses that into text.',
          'The DSP that builds the envelope is hand-ported from the training pipeline (Python → TypeScript) so the browser sees exactly what the model was trained on.',
        ],
      },
      {
        q: 'How can machine learning run in a browser with no server?',
        a: [
          'The trained model is just a file the page downloads once, like an image. It then runs directly on your device using WebAssembly — a fast, low-level way for browsers to run compiled code. No request ever goes out to decode your audio, because there is nothing on the other end to ask.',
        ],
        technical: [
          'Inference runs through onnxruntime-web on the WASM backend, with multi-threading enabled. That requires the page to be cross-origin isolated (COOP/COEP headers), which is set both in dev and on the production host. The .onnx file is served as a static asset alongside the app.',
        ],
      },
      {
        q: 'How good is it, really?',
        a: [
          'It can copy CW down to roughly −12 dB signal-to-noise ratio — meaning the noise is several times stronger than the signal, well past the point where the code sounds like a steady tone to most ears. At easier signal levels it is essentially perfect; as you push the noise up, error rate climbs, and the decoder page shows you exactly where it breaks.',
        ],
        technical: [
          'SNR here is measured in the CW bandwidth of the synthesized clip. “−12 dB” is a headline figure for the favorable end of the speed range; very fast sending, deep fading (QSB), and short transmissions all make it harder. The decode page reports character error rate and a per-character diff so you can probe the failure modes yourself.',
        ],
      },
      {
        q: 'Is my audio or data sent anywhere?',
        a: [
          'No. Everything — generating the clip, running the model, grading the result — happens locally. There is no backend, no account, and no telemetry on the decode path. You can confirm it in your browser’s network tab: after the model file loads, decoding makes no network requests.',
        ],
      },
    ],
  },
  {
    heading: 'Beat the Bot',
    items: [
      {
        q: 'What is Beat the Bot?',
        a: [
          'A game. You are given one callsign buried in noise and a single listen to copy it. The model decodes the same clip, and you are scored side-by-side on who got closer. Win and your streak grows; lose and the bot gloats a little.',
        ],
      },
      {
        q: 'Is it rigged? Does the bot get an unfair advantage?',
        anchor: 'is-it-rigged',
        a: [
          'Here is the honest answer: you and the model work from the exact same audio. The callsign is keyed twice inside one clip, and you hear that whole clip once — both repeats included — just as the model does. Neither side gets extra plays or a cleaner signal.',
          'The model’s one edge is what it does after the audio: it decodes each of the two sends separately and merges the two copies, while you have to listen in real time and commit to a single copy on the spot. That is a processing advantage, not an access advantage — and combining two noisy copies of the same signal is a genuine low-SNR technique, the machine equivalent of a human catching on the second repeat what they missed on the first. The interesting question is not “can a machine beat a human” but how much that merge step is worth against a trained ear — and the game shows you exactly how the model used its two looks after every round.',
        ],
        technical: [
          'The clip contains the call sent twice (e.g. “K1ABC K1ABC”). The decoder splits the envelope at the inter-send silence, runs inference on each half independently, greedy-decodes both, then combines them: if the two agree it takes the higher-confidence copy; if they disagree it Levenshtein-aligns them and fills missing characters from whichever look had them. This is post-decode ensembling, not coherent integration — summing per-frame log-probabilities before the CTC decode (for a true ~√2 SNR gain) is noted as future work.',
          'The human, by contrast, is capped at one listen (MAX_LISTENS = 1). The asymmetry is deliberate and surfaced in the “How the bot got two looks” detail after each round.',
        ],
      },
    ],
  },
  {
    heading: 'The project',
    items: [
      {
        q: 'Who made this, and is it open source?',
        a: [
          'MORSE is a two-person project — the decoder and the game were built together. Mark Percival (KC4T) started it and leads the ML and DSP; John Schult (W4GIT) leads engineering, UX, and the frontend. The source is public on GitHub.',
        ],
        node: <Builders />,
      },
      {
        q: 'What’s next?',
        a: [
          'Live decoding from a real microphone or receiver, accounts with a Beat-the-Bot leaderboard and verified call-sign badges, and ongoing tuning of the matchup and fairness model.',
        ],
        node: <Roadmap />,
      },
    ],
  },
];

/**
 * FAQPage structured data built from the real SECTIONS content above, so the
 * schema can never drift from what's on the page. Uses the plain-language
 * `a[]` answers (crawler-safe text), joining paragraphs into one answer string
 * (the rich `node` variants are JSX, not text, and are simply not referenced).
 *
 * Google only grants FAQ rich results when the answer text is present in the
 * RENDERED HTML. Our answers live inside <details> accordions, so this is fully
 * effective on the prerendered /faq route (the build snapshots the rendered DOM)
 * and for crawlers that execute JS.
 */
export function faqJsonLd(): Record<string, unknown> {
  // Schema text must be plain text, not HTML/JSX \u2014 normalize the curly quotes
  // used in the copy to straight quotes so the JSON-LD reads cleanly.
  const normalizeQuotes = (s: string) =>
    s.replace(/[\u201c\u201d\u2018\u2019]/g, (m) =>
      m === '\u2018' || m === '\u2019' ? "'" : '"'
    );
  const entities = SECTIONS.flatMap((section) =>
    section.items.map((item) => ({
      '@type': 'Question',
      name: normalizeQuotes(item.q),
      acceptedAnswer: {
        '@type': 'Answer',
        text: normalizeQuotes(item.a.join(' ')),
      },
    }))
  );
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entities,
  };
}

export default function FaqPage() {
  useDocumentHead({
    title: 'FAQ',
    description:
      'How the MORSE neural CW decoder works, how good it is, why Beat the Bot is set up the way it is, who built it, and what is coming next.',
    path: '/faq',
    jsonLd: faqJsonLd(),
  });
  // Deep-linking: /faq#<id> opens that question and scrolls it into view, with
  // a brief highlight. Runs on mount and on later hash changes. (ScrollToTop
  // bails when a hash is present so it doesn't fight this.)
  useEffect(() => {
    let flashTimer = 0;
    const openFromHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const el = document.getElementById(id);
      if (!(el instanceof HTMLDetailsElement)) return;
      el.open = true;
      const reduce = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
      ).matches;
      el.scrollIntoView({
        behavior: reduce ? 'auto' : 'smooth',
        block: 'start',
      });
      el.classList.add('faq-flash');
      window.clearTimeout(flashTimer);
      flashTimer = window.setTimeout(
        () => el.classList.remove('faq-flash'),
        1900
      );
    };
    const initial = window.setTimeout(openFromHash, 0);
    window.addEventListener('hashchange', openFromHash);
    return () => {
      window.clearTimeout(initial);
      window.clearTimeout(flashTimer);
      window.removeEventListener('hashchange', openFromHash);
    };
  }, []);

  return (
    <div className="pb-6">
      {/* hero header — matches the landing receiver tone */}
      <header className="mb-10">
        <div className="flex items-center gap-1.5 font-mono text-[11px] tracking-[0.2em] uppercase text-muted-foreground">
          <BookOpen className="size-3.5 text-primary" />
          Operator's manual
        </div>
        <h1 className="mt-2 font-mono font-bold tracking-tight text-foreground text-3xl sm:text-4xl">
          Frequently asked
        </h1>
        <p className="mt-3 max-w-xl text-[15px] text-muted-foreground leading-relaxed">
          How the decoder works, what the model can do, why the Beat-the-Bot
          matchup is set up the way it is, who built it, and what’s coming next.
          Tap any question; expand{' '}
          <span className="text-dial-strong font-mono">
            the technical version
          </span>{' '}
          for the ham-radio and ML detail.
        </p>
      </header>

      <div className="flex flex-col gap-10">
        {SECTIONS.map((section, si) => (
          <Reveal key={section.heading}>
            <section>
              <div className="flex items-center gap-2 mb-3 font-mono text-[11px] tracking-[0.2em] uppercase text-muted-foreground">
                <span className="text-dial-strong">
                  {String(si + 1).padStart(2, '0')}
                </span>
                <span className="text-muted-foreground/40">·</span>
                {section.heading}
              </div>
              <div className="flex flex-col rounded-lg border border-border overflow-hidden divide-y divide-border">
                {section.items.map((item) => (
                  <FaqRow key={item.q} item={item} id={faqId(item)} />
                ))}
              </div>
            </section>
          </Reveal>
        ))}

        {/* Closing CTA — two destination tiles */}
        <Reveal>
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center gap-1.5 font-mono text-[11px] tracking-[0.2em] uppercase text-muted-foreground">
              <span className="inline-block size-1.5 rounded-full bg-dial shadow-[0_0_8px_2px] shadow-dial/60" />
              Your turn on the key
            </div>
            <p className="mt-2 font-mono text-sm text-foreground">
              Enough reading — go pull something out of the noise.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Link
                to="/decode"
                className="group flex items-center gap-3 rounded-lg border border-border bg-background p-3.5 transition-colors hover:border-primary/50 hover:bg-muted/40 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
                  <Radio className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-sm text-foreground">
                    Open the decoder
                  </span>
                  <span className="block text-[12px] leading-snug text-muted-foreground">
                    Bury text in noise; watch CWNet copy it.
                  </span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                to="/beat-the-bot"
                className="group flex items-center gap-3 rounded-lg border border-dial/40 border-l-2 border-l-dial bg-dial/6 p-3.5 transition-colors hover:border-dial/60 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-dial/15 text-dial-strong">
                  <Swords className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-sm text-foreground">
                    Beat the Bot
                  </span>
                  <span className="block text-[12px] leading-snug text-muted-foreground">
                    Out-copy the model on a buried call sign.
                  </span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-dial-strong/50 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>
        </Reveal>
      </div>

      <style>{FAQ_CSS}</style>
    </div>
  );
}

/* Single accordion row: <details> for free keyboard + a11y, styled as a
   receiver readout. The nested "technical version" is a second <details>. */
function FaqRow({ item, id }: { item: QA; id: string }) {
  return (
    <details id={id} className="faq-row group bg-card scroll-mt-20">
      <summary className="flex items-center gap-3 px-4 py-3.5 cursor-pointer select-none list-none hover:bg-muted/40 transition-colors">
        <Plus className="size-4 text-dial-strong shrink-0 transition-transform duration-200 group-open:rotate-45" />
        <span className="flex-1 font-mono text-[14px] sm:text-[15px] text-foreground leading-snug">
          {item.q}
        </span>
      </summary>
      <div className="px-4 pb-4 pl-11 flex flex-col gap-3">
        {item.node ??
          item.a.map((para) => (
            <p
              key={para.slice(0, 32)}
              className="text-sm text-muted-foreground leading-relaxed"
            >
              {para}
            </p>
          ))}
        {item.technical && (
          <details className="tech group/tech mt-1">
            <summary className="inline-flex items-center gap-1 text-xs font-mono font-medium text-dial-strong cursor-pointer select-none list-none">
              <ChevronRight className="size-3.5 transition-transform group-open/tech:rotate-90" />
              The technical version
            </summary>
            <div className="mt-2.5 flex flex-col gap-2.5 rounded-md border-l-2 border-l-dial border border-border bg-dial/5 p-3">
              {item.technical.map((para) => (
                <p
                  key={para.slice(0, 32)}
                  className="text-[13px] text-muted-foreground leading-relaxed"
                >
                  {para}
                </p>
              ))}
            </div>
          </details>
        )}
      </div>
    </details>
  );
}

const FAQ_CSS = `
.text-dial-strong { color: color-mix(in oklch, var(--dial) 78%, var(--foreground)); }
/* hide the default disclosure triangle across browsers */
.faq-row > summary::-webkit-details-marker,
.tech > summary::-webkit-details-marker { display: none; }

/* brief amber wash when a question is opened via a deep link, fading back to
   the card colour so nothing snaps */
@keyframes faq-flash {
  from { background-color: color-mix(in oklch, var(--dial) 22%, var(--card)); }
  to   { background-color: var(--card); }
}
.faq-flash { animation: faq-flash 1.8s ease-out; }
@media (prefers-reduced-motion: reduce) {
  .faq-flash { animation: none; }
}
`;
