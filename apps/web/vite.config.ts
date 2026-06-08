import fs from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

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

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Keep the hand-tuned public/manifest.webmanifest (already linked in
      // index.html). The plugin only generates and wires up the service worker.
      manifest: false,
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
        globIgnores: ['**/model/**', '**/ort/**', '**/assets/ort-wasm-*.wasm'],
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
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // ONNX Runtime wasm — large, immutable.
            urlPattern: ({ url }) => url.pathname.startsWith('/ort/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ort-wasm',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 },
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
});
