// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

/**
 * Serves the files in `brandWebDir` as root-relative static assets, identical
 * to Vite's built-in publicDir behaviour but additive — files already present
 * in the app's own publicDir take precedence.
 *
 * Dev/preview: added as a post-middleware so Vite's static-file handler wins.
 * Build: files are copied into outDir after the bundle is written, skipping
 *        any paths already emitted by Vite from the app's publicDir.
 */
export function brandAssets(brandWebDir: string): Plugin {
  function middleware(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void
  ) {
    const url = req.url?.split('?')[0];
    if (!url || url === '/') return next();
    const file = path.join(brandWebDir, url);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      const ext = path.extname(file).toLowerCase();
      res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
      fs.createReadStream(file).pipe(res);
      return;
    }
    next();
  }

  function addMiddleware(server: ViteDevServer | PreviewServer) {
    return () => server.middlewares.use(middleware);
  }

  return {
    name: 'brand-assets',
    configureServer: addMiddleware,
    configurePreviewServer: addMiddleware,
    writeBundle(options) {
      const outDir = options.dir;
      if (!outDir) return;
      for (const name of fs.readdirSync(brandWebDir)) {
        const src = path.join(brandWebDir, name);
        if (!fs.statSync(src).isFile()) continue;
        const dest = path.join(outDir, name);
        if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
      }
    },
  };
}
