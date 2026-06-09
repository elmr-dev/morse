import type { Plugin } from 'vite';
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from './src/lib/site';

/**
 * Injects the SITE-WIDE head tags into index.html at build/dev time:
 *  - the canonical Open Graph + Twitter block, seeded with the site-level
 *    title/description so non-JS crawlers and social unfurlers get correct
 *    metadata for the home page (and as the fallback for any non-prerendered
 *    request). Per-route prerendering overwrites the title/description/url/
 *    canonical in each route's own HTML; in-app navigation overwrites them
 *    client-side via useDocumentHead.
 *  - the WebApplication JSON-LD (true on every route, so it lives here)
 *
 * Why a plugin and not just static tags in index.html: the origin must come
 * from VITE_SITE_URL so the Netlify→Cloudflare cutover is a one-line env change
 * with zero source edits. Vite only substitutes a handful of built-in tokens in
 * index.html, not arbitrary env vars, so we rewrite the HTML string here where
 * we can read loadEnv/process.env at transform time. VITE_SITE_URL is set in
 * apps/web/.env.production (deploys are built locally, not on a CI host).
 *
 * This touches the HTML response body only — it does NOT set or alter any HTTP
 * headers, so the COOP/COEP cross-origin-isolation invariant is untouched.
 */

/** Escape a string for safe interpolation into a double-quoted HTML attribute. */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function seoHead(siteUrl: string, version: string): Plugin {
  const origin = siteUrl.replace(/\/+$/, '');
  const ogImage = `${origin}/og.png`;
  let isBuild = false;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: SITE_NAME,
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any (web browser)',
    browserRequirements:
      'Requires JavaScript and a browser supporting WebAssembly threads (cross-origin isolation).',
    softwareVersion: version,
    url: origin,
    screenshot: ogImage,
    description:
      'A neural decoder that copies Morse code (CW) down to −12 dB SNR, running entirely in the browser via ONNX Runtime on WebAssembly — no server, no install. Includes a Beat the Bot game pitting a human ear against the model.',
    featureList: [
      'Decodes Morse code (CW) buried in noise down to −12 dB SNR',
      'Runs entirely in your browser — no server, no install, nothing uploaded',
      'Generate practice clips at 12–50 WPM with adjustable noise and QSB fading',
      'Beat the Bot: race a neural decoder to copy a callsign by ear',
      'Character error rate and per-character diff against ground truth',
    ],
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    author: [
      { '@type': 'Person', name: 'Mark Percival' },
      { '@type': 'Person', name: 'John Schult' },
    ],
  };

  const title = escapeAttr(SITE_TITLE);
  const description = escapeAttr(SITE_DESCRIPTION);

  // Site-wide block, seeded with the home/site-level title + description. The
  // per-route og:title/description/url + canonical are overwritten by the
  // prerender pass (static HTML) and by useDocumentHead (in-app navigation).
  const block = `
    <meta name="description" content="${description}" />
    <meta property="og:site_name" content="${SITE_NAME}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:image" content="${ogImage}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="MORSE — CW decoded in your browser" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${origin}/" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${ogImage}" />
    <link rel="canonical" href="${origin}/" />
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;

  return {
    name: 'morse-seo-head',
    configResolved(config) {
      isBuild = config.command === 'build';
    },
    transformIndexHtml(html) {
      // Absolute OG/canonical URLs are mandatory in production — a root-relative
      // og:image/og:url silently breaks every social unfurl. Fail the build loud
      // rather than ship broken tags. (Empty is fine for a bare local dev run.)
      if (isBuild && !origin) {
        throw new Error(
          'seoHead: VITE_SITE_URL is empty for a production build. Set it in ' +
            'apps/web/.env.production so og:image / og:url / canonical are absolute.'
        );
      }
      // Remove any hand-written OG/Twitter tags so this plugin is the sole owner
      // (avoids duplicates), then inject the env-driven block.
      const stripped = html
        .replace(/\s*<meta property="og:[^>]*>/g, '')
        .replace(/\s*<meta name="twitter:[^>]*>/g, '');
      return stripped.replace('</head>', `${block}\n  </head>`);
    },
  };
}
