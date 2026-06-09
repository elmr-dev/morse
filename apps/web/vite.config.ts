import fs from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { SITE_DESCRIPTION, SITE_TITLE } from './src/lib/site';
import { seoHead } from './vite-plugin-seo-head';

// Opt-in HTTPS for LAN / on-device PWA testing: service workers need a secure
// context, which a plain http://<lan-ip> origin isn't. Drop an mkcert-issued
// pair in apps/web/.certs/ (gitignored) and `vite preview`/`dev` serve over
// TLS. Absent the files this is undefined — normal HTTP, no effect on prod.
const certDir = path.resolve(__dirname, '.certs');
const https =
  fs.existsSync(path.join(certDir, 'cert.pem')) &&
  fs.existsSync(path.join(certDir, 'key.pem'))
    ? {
        cert: fs.readFileSync(path.join(certDir, 'cert.pem')),
        key: fs.readFileSync(path.join(certDir, 'key.pem')),
      }
    : undefined;

export default defineConfig(({ mode }) => {
  // VITE_SITE_URL drives the absolute OG/canonical URLs. Unset locally is fine
  // (the tags degrade to root-relative); set it in every deployed environment.
  const env = loadEnv(mode, __dirname, '');
  const siteUrl = env.VITE_SITE_URL || '';
  // Single source of truth for the version (same package.json the footer reads),
  // surfaced into the WebApplication JSON-LD's softwareVersion.
  const { version } = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')
  );
  return {
    plugins: [
      react(),
      tailwindcss(),
      seoHead(siteUrl, version),
      VitePWA({
        // Generate the manifest from shared constants so name/description can't
        // drift from the rest of the site (SITE_TITLE/SITE_DESCRIPTION live in
        // src/lib/site.ts). The plugin emits manifest.webmanifest and injects the
        // <link> — no hand-maintained public/ copy. (theme_color also lives in the
        // theme-color meta + CSS token; centralizing color is a separate job.)
        manifest: {
          name: SITE_TITLE,
          short_name: 'Morse',
          description: SITE_DESCRIPTION,
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#0F0F1A',
          theme_color: '#0F0F1A',
          icons: [
            {
              src: '/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        // Surface a "new version" prompt instead of silently swapping the app out
        // from under an in-progress decode. Driven by useRegisterSW in
        // src/components/pwa-update-prompt.tsx.
        registerType: 'prompt',
        injectRegister: 'auto',
        workbox: {
          // Take control of the already-open page as soon as the SW activates.
          // Without this, the first launch runs uncontrolled, so the "Download
          // for offline" fetches bypass the SW and never hit the runtime caches.
          // (skipWaiting stays off so updates remain prompt-gated.)
          clientsClaim: true,
          // SPA deep links resolve offline. Base is '/', so '/index.html' is
          // correct; the model/ort asset requests must not get the HTML shell.
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/model\//, /^\/ort\//],
          // Precache the app shell. woff2 is included so the self-hosted fonts
          // (@fontsource-variable) cache for offline use.
          globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
          // Exclude the heavy ONNX binaries (runtime-cached below) and the
          // duplicate hashed wasm that onnxruntime-web/wasm's JS import emits into
          // assets/ — only the /ort/ copy is loaded at runtime via wasmPaths.
          globIgnores: [
            '**/model/**',
            '**/ort/**',
            '**/assets/ort-wasm-*.wasm',
          ],
          // Guard only: the 3MB model and 13MB wasm are runtime-cached, never
          // precached, so this keeps the precache small and Lighthouse-clean.
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          runtimeCaching: [
            {
              // ONNX model — large, immutable, fetched once on first decode.
              urlPattern: ({ url }) => url.pathname.startsWith('/model/'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'onnx-model',
                expiration: {
                  maxEntries: 4,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // ONNX Runtime wasm — large, immutable.
              urlPattern: ({ url }) => url.pathname.startsWith('/ort/'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'ort-wasm',
                expiration: {
                  maxEntries: 8,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
        // Let the SW run under `vite dev` so offline behaviour is testable
        // without a full build.
        devOptions: {
          enabled: true,
          type: 'module',
          navigateFallback: 'index.html',
        },
      }),
    ],
    optimizeDeps: {
      exclude: ['onnxruntime-web'],
    },
    server: {
      https,
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
    // `vite preview` serves the production build (real generated SW) — the most
    // faithful local PWA test. HTTPS only when the mkcert pair is present.
    preview: {
      https,
      host: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  };
});
