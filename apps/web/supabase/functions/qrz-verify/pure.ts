// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Pure helpers for the qrz-verify Edge Function. Kept dependency-free (no
// Deno/Node APIs beyond the WebCrypto `crypto` global, which exists in both
// runtimes) so it can be unit-tested from the web project's vitest suite.

export const TOKEN_PREFIX = 'MORSE-VERIFY-';
export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateToken(
  randomBytes: (n: number) => Uint8Array = defaultRandomBytes
): string {
  const bytes = randomBytes(10);
  let out = '';
  for (const b of bytes) out += BASE32_ALPHABET[b & 0x1f];
  return TOKEN_PREFIX + out;
}

function defaultRandomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/**
 * Does the fetched QRZ page contain this token?
 *
 * QRZ embeds the bio body as `Base64.decode("…")` calls that client-side JS
 * unpacks into an iframe — a raw server fetch sees the encoded blobs but
 * never the rendered HTML. We decode them ourselves and search the union of
 * (raw page) + (decoded bio blobs).
 *
 * Smart-punctuation: QRZ's WYSIWYG editor sometimes converts ASCII hyphens
 * to en-dashes, so we normalize dashes back to `-` before matching.
 */
export function tokenInHtml(html: string, token: string): boolean {
  if (!token) return false;
  const needle = normalizeDashes(token);
  const corpus = normalizeDashes(html + '\n' + decodeQrzBase64Blobs(html));
  return corpus.includes(needle);
}

const BASE64_DECODE_RE = /Base64\.decode\("([A-Za-z0-9+/=\s]+)"\)/g;

export function decodeQrzBase64Blobs(html: string): string {
  let out = '';
  for (const m of html.matchAll(BASE64_DECODE_RE)) {
    const b64 = m[1].replace(/\s+/g, '');
    try {
      // atob is available in Deno, Node 16+, and browsers.
      out += atob(b64) + '\n';
    } catch {
      // Skip malformed chunks; do not let one bad blob void the whole match.
    }
  }
  return out;
}

function normalizeDashes(s: string): string {
  // en dash, em dash, minus sign, non-breaking hyphen, figure dash, horizontal bar
  return s.replace(/[‐‑‒–—―−]/g, '-');
}

export function isExpired(
  expiresAt: string | Date,
  now: Date = new Date()
): boolean {
  const exp = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  return exp.getTime() <= now.getTime();
}

export function expiryFromNow(
  now: Date = new Date(),
  ttlMs: number = TOKEN_TTL_MS
): Date {
  return new Date(now.getTime() + ttlMs);
}

export function qrzBioUrl(callSign: string): string {
  return `https://www.qrz.com/db/${encodeURIComponent(callSign)}`;
}

export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const BROWSER_FETCH_HEADERS: Record<string, string> = {
  'user-agent': BROWSER_USER_AGENT,
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};
