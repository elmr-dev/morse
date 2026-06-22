// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Site-wide identity + canonical URL helpers.
 *
 * The origin is read from VITE_SITE_URL so the Netlify→Cloudflare cutover is a
 * one-line env change with zero source edits. Deploys are built locally and
 * uploaded, so the value lives in apps/web/.env.production (not a hosting
 * dashboard). When unset (e.g. a bare local `bun run dev`) the origin is an empty
 * string, so canonical/og:url fall back to root-relative paths — fine locally,
 * where no unfurler is reading absolute URLs anyway. A production `vite build`
 * fails fast if it's empty (see vite-plugin-seo-head.ts).
 */

/** Absolute site origin, no trailing slash. Empty when VITE_SITE_URL is unset.
 *  Optional-chained so this module is import-safe from the build-time Vite
 *  plugin too, where `import.meta.env` is undefined (Node, not a Vite build). */
export const SITE_URL: string = (import.meta.env?.VITE_SITE_URL || '').replace(
  /\/+$/,
  ''
);

/** The wordmark / brand name. */
export const SITE_NAME = 'MORSE';

/** The home-page / site-level document title. Used verbatim on the landing page
 *  and as the static `og:title`/`twitter:title` default for non-JS crawlers. */
export const SITE_TITLE = 'Morse — CW in your browser';

/** One-line site description, reused as the default meta + OG description. */
export const SITE_DESCRIPTION =
  'A neural decoder that copies Morse code (CW) down to −12 dB SNR — buried under noise far below where a tone is still a tone. Runs entirely in your browser, no server, no install.';

/**
 * Build an absolute canonical URL for a route path. With SITE_URL set this is
 * absolute (`https://…/decode`); with it empty (local dev) it degrades to a
 * root-relative path (`/decode`).
 */
export function canonical(path: string): string {
  if (!path || path === '/') return SITE_URL || '/';
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * The crawlable routes, in sitemap order. Single source of truth consumed by
 * the prerender script (one static HTML file per route) and the generated
 * sitemap.xml / robots.txt. Redirect-only paths like `/beat` are deliberately
 * excluded — they carry no content of their own.
 */
export const SEO_ROUTES: readonly string[] = [
  '/',
  '/beat-the-bot',
  '/redline',
  '/leaderboards',
  '/faq',
];
