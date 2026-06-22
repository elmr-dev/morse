// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ExternalLink, Heart } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useIsStandalone } from '@/lib/use-standalone';
import pkg from '../../package.json';
import { GITHUB_URL, GithubIcon } from './github';
import ThemeSwitcher from './theme-switcher';

const NPM_PACKAGES = [
  { name: 'morse-audio', href: 'https://www.npmjs.com/package/morse-audio' },
  {
    name: 'react-morse-audio',
    href: 'https://www.npmjs.com/package/react-morse-audio',
  },
];

/** The "Made with ♥ in Atlanta · v{version}" line. Shared by the browser
 *  footer and the standalone "More" sheet. */
export function FooterContent() {
  return (
    <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        Made with
        <Heart
          className="size-3.5 text-chart-5 fill-chart-5"
          aria-label="love"
        />
        in Atlanta
      </span>
      <span aria-hidden="true">&middot;</span>
      <span className="font-mono">v{pkg.version}</span>
    </div>
  );
}

const linkClass =
  'inline-flex items-center gap-1.5 text-[13px] text-muted-foreground underline-offset-2 outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm';

function ColumnHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
      {children}
    </div>
  );
}

/**
 * Site footer — the home for reference, meta, and utility links now that they're
 * out of the top nav: FAQ, source + npm packages, theme toggle, and the
 * wordmark/attribution/license line. Desktop only; on mobile (browser) and in
 * standalone this content lives in the "More" drawer instead.
 */
export default function Footer() {
  if (useIsStandalone()) return null;
  return (
    <footer className="hidden sm:block border-t border-border mt-10">
      <div className="mx-auto max-w-[900px] px-5 py-8">
        <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
          {/* Brand echo + attribution + license */}
          <div className="flex flex-col gap-2">
            <span className="font-mono text-xl font-extrabold tracking-tight text-foreground">
              MORSE
            </span>
            <p className="text-[13px] text-muted-foreground">
              CW in your browser — built by{' '}
              <span className="font-mono text-foreground">W4GIT</span> +{' '}
              <span className="font-mono text-foreground">KC4T</span>.
            </p>
            <p className="text-[12px] text-muted-foreground/80">
              Licensed{' '}
              <a
                href="https://www.gnu.org/licenses/agpl-3.0.html"
                target="_blank"
                rel="noreferrer"
                className="underline-offset-2 hover:text-foreground hover:underline"
              >
                AGPL-3.0-or-later
              </a>
              .
            </p>
          </div>

          {/* Link columns */}
          <div className="flex gap-10">
            <div className="flex flex-col gap-2.5">
              <ColumnHeading>Reference</ColumnHeading>
              <Link to="/faq" className={linkClass}>
                FAQ
              </Link>
            </div>
            <div className="flex flex-col gap-2.5">
              <ColumnHeading>Source</ColumnHeading>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className={linkClass}
              >
                <GithubIcon className="size-3.5" />
                GitHub
                <ExternalLink
                  className="size-3 opacity-60"
                  aria-hidden="true"
                />
              </a>
              {NPM_PACKAGES.map((p) => (
                <a
                  key={p.name}
                  href={p.href}
                  target="_blank"
                  rel="noreferrer"
                  className={linkClass}
                >
                  <span className="font-mono">{p.name}</span>
                  <ExternalLink
                    className="size-3 opacity-60"
                    aria-hidden="true"
                  />
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Utility row: theme toggle + made-with line */}
        <div className="mt-8 flex flex-col items-center gap-3 border-t border-border pt-6 sm:flex-row sm:justify-between">
          <FooterContent />
          <ThemeSwitcher />
        </div>
      </div>
    </footer>
  );
}
