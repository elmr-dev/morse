import { useEffect } from 'react';
import { SITE_NAME, canonical as toCanonical } from './site';

/**
 * Per-route document head management — a tiny, dependency-free stand-in for
 * react-helmet-async, which is overkill for four static routes.
 *
 * Call once near the top of a page component:
 *
 *   useDocumentHead({
 *     title: 'Decode',
 *     description: '…',
 *     path: '/decode',
 *     jsonLd: { … },   // optional structured data for this route
 *   });
 *
 * It sets document.title and upserts the description, canonical link, and the
 * Open Graph / Twitter tags that vary per page (title/description/url). The
 * site-wide OG tags (image, type, site_name) and the WebApplication JSON-LD
 * live in index.html via the vite transformIndexHtml plugin so they're present
 * in the raw HTML for non-JS preview bots — this hook only manages the per-route
 * deltas, which the JS-running crawlers (Google) pick up after hydration.
 *
 * NOTE: this is client-side injection. It is correct for Google (renders JS)
 * and for in-app navigation. Non-JS unfurlers get the correct per-route tags
 * from the prerendered static HTML (the build snapshots the rendered head into
 * dist/<route>/index.html); this hook drives the same tags for SPA navigation.
 */
export interface DocumentHead {
  /** Page title; rendered as `${title} — MORSE`. Omit on the landing page to
   *  use the brand title verbatim. */
  title?: string;
  /** Meta description for this route. */
  description: string;
  /** Route path, e.g. '/decode'. Used to build the canonical + og:url. */
  path: string;
  /** Full document title override (skips the `— MORSE` suffix). */
  fullTitle?: string;
  /** Optional JSON-LD object injected as <script type="application/ld+json">
   *  and removed on unmount. */
  jsonLd?: Record<string, unknown>;
}

/** Find an existing managed tag by selector, or create + attach a fresh one. */
function upsertMeta(selector: string, attrs: Record<string, string>): void {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement('meta');
    document.head.appendChild(el);
  }
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
}

function upsertLink(rel: string, href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

export function useDocumentHead({
  title,
  description,
  path,
  fullTitle,
  jsonLd,
}: DocumentHead): void {
  const url = toCanonical(path);
  const docTitle = fullTitle ?? (title ? `${title} — ${SITE_NAME}` : SITE_NAME);

  // biome-ignore lint/correctness/useExhaustiveDependencies: jsonLd is an object literal that changes identity each render; we key the effect on its serialization instead to avoid re-running on every render.
  useEffect(() => {
    const prevTitle = document.title;
    document.title = docTitle;

    upsertMeta('meta[name="description"]', {
      name: 'description',
      content: description,
    });
    upsertLink('canonical', url);

    // Per-route OG/Twitter deltas. The image + static fields stay in index.html.
    upsertMeta('meta[property="og:title"]', {
      property: 'og:title',
      content: docTitle,
    });
    upsertMeta('meta[property="og:description"]', {
      property: 'og:description',
      content: description,
    });
    upsertMeta('meta[property="og:url"]', {
      property: 'og:url',
      content: url,
    });
    upsertMeta('meta[name="twitter:title"]', {
      name: 'twitter:title',
      content: docTitle,
    });
    upsertMeta('meta[name="twitter:description"]', {
      name: 'twitter:description',
      content: description,
    });

    // Per-route JSON-LD: tagged with data-route-jsonld so we own/remove only
    // ours and never touch the static WebApplication block in index.html.
    let script: HTMLScriptElement | null = null;
    if (jsonLd) {
      script = document.createElement('script');
      script.type = 'application/ld+json';
      script.dataset.routeJsonld = path;
      script.textContent = JSON.stringify(jsonLd);
      document.head.appendChild(script);
    }

    return () => {
      // Restore the brand title so an interstitial route never leaves a stale
      // page title; meta tags are overwritten by the next route's effect.
      document.title = prevTitle;
      script?.remove();
    };
  }, [docTitle, description, url, path, JSON.stringify(jsonLd)]);
}
