// Prerender the SPA's crawlable routes to static HTML, and emit sitemap.xml +
// robots.txt — the SEO completion step for a client-rendered app.
//
// Why a real browser (Playwright) and not react-dom/server SSG: the app is too
// browser-coupled to render in Node (window at module eval, localStorage, the
// hero canvas, the onnxruntime-web import). A headless browser runs the actual
// built app unchanged, so each route's useDocumentHead writes the correct
// per-route <head>, and the rendered FAQ accordion text lands in the HTML —
// which is what Google needs to grant FAQ rich results.
//
// This is SEO-only: the app uses createRoot (not hydrateRoot), so real users'
// React clears and re-renders the prerendered DOM. The static files exist for
// non-JS crawlers/unfurlers (Slack, iMessage, Bing, …) and a faster first paint.
//
// Runs AFTER `vite build` (see package.json), so the per-route files are written
// after the PWA precache manifest — they're naturally excluded from precache,
// and real in-app navigation is served the SPA shell via the SW navigateFallback.
//
// Run (from apps/web):  bun scripts/prerender.ts   (normally via `bun run build`)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { SEO_ROUTES } from '../src/lib/site';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, '../dist');

if (!existsSync(join(distDir, 'index.html'))) {
  throw new Error(
    `prerender: ${distDir}/index.html not found — run \`vite build\` first.`
  );
}

// VITE_SITE_URL is baked into the JS at build time, but this Node process needs
// it too (for the absolute sitemap/robots URLs). Read it from the same
// .env.production that drove the build so there's a single source of truth.
function readSiteUrl(): string {
  const fromEnv = process.env.VITE_SITE_URL;
  if (fromEnv) return fromEnv;
  const envFile = resolve(here, '../.env.production');
  if (existsSync(envFile)) {
    const match = readFileSync(envFile, 'utf8').match(
      /^\s*VITE_SITE_URL\s*=\s*(.+?)\s*$/m
    );
    if (match) return match[1].replace(/^["']|["']$/g, '');
  }
  return '';
}

const origin = readSiteUrl().replace(/\/+$/, '');
if (!origin) {
  throw new Error(
    'prerender: VITE_SITE_URL is empty — set it in apps/web/.env.production so ' +
      'sitemap/robots URLs are absolute.'
  );
}

// --- Static server over dist/, faithful to production: COOP/COEP headers (so
// the app boots cross-origin-isolated, as in public/_headers) and SPA fallback
// to index.html for routes that have no prerendered file yet (the whole point —
// React Router then renders the route so we can snapshot it).
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const candidate = join(distDir, pathname);
    // Serve a real asset when one exists (and the path isn't a bare directory);
    // otherwise fall back to the SPA shell so client routing can render.
    const file =
      pathname !== '/' && existsSync(candidate) && !candidate.endsWith('/')
        ? Bun.file(candidate)
        : Bun.file(join(distDir, 'index.html'));
    if (!(await file.exists())) {
      return new Response('Not found', { status: 404 });
    }
    return new Response(file, { headers: isolation });
  },
});

const base = `http://localhost:${server.port}`;
const browser = await chromium.launch();
// Block the service worker: on a real first visit it isn't active yet, and we
// never want it intercepting and serving the cached shell during the crawl.
const context = await browser.newContext({ serviceWorkers: 'block' });

let failed = false;
try {
  for (const route of SEO_ROUTES) {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    try {
      await page.goto(`${base}${route}`, { waitUntil: 'load' });
      // Wait until React has mounted AND useDocumentHead has run for THIS route
      // (canonical's path matches) — snapshotting on `load` alone races the
      // effect and would capture the static home-page tags on every route.
      await page.waitForFunction(
        (r) => {
          const root = document.getElementById('root');
          if (!root || root.children.length === 0) return false;
          const link = document.querySelector('link[rel="canonical"]');
          const href = link?.getAttribute('href');
          if (!href) return false;
          try {
            const path = new URL(href, location.href).pathname;
            return r === '/' ? path === '/' || path === '' : path === r;
          } catch {
            return false;
          }
        },
        route,
        { timeout: 15000 }
      );

      const html = `<!doctype html>\n${await page.content()}`;
      const outPath =
        route === '/'
          ? join(distDir, 'index.html')
          : join(distDir, route.replace(/^\//, ''), 'index.html');
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, html);
      console.log(
        `prerendered ${route.padEnd(16)} → ${outPath.replace(`${distDir}/`, '')}`
      );
      if (errors.length) {
        console.warn(
          `  ⚠ page errors on ${route}:\n    ${errors.join('\n    ')}`
        );
      }
    } catch (err) {
      failed = true;
      console.error(`prerender FAILED for ${route}:`, err);
    } finally {
      await page.close();
    }
  }
} finally {
  await context.close();
  await browser.close();
  server.stop(true);
}

if (failed) {
  throw new Error('prerender: one or more routes failed — see errors above.');
}

// --- sitemap.xml + robots.txt, from the same route list (single source). No
// <lastmod>: a per-build timestamp with no content change just misleads crawlers,
// and it'd make the build non-deterministic.
const urls = SEO_ROUTES.map((r) => {
  const loc = r === '/' ? `${origin}/` : `${origin}${r}`;
  return `  <url>\n    <loc>${loc}</loc>\n  </url>`;
}).join('\n');
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
writeFileSync(join(distDir, 'sitemap.xml'), sitemap);

const robots = `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;
writeFileSync(join(distDir, 'robots.txt'), robots);

console.log(`wrote sitemap.xml (${SEO_ROUTES.length} urls) + robots.txt`);
