// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Pure-function unit tests for the qrz-verify Edge Function. The handler lives
// under apps/web/supabase/functions/ (Deno) and is excluded from the web app's
// tsc/biome/knip, but the pure helpers it imports are dependency-free and we
// reach across into them here so vitest can exercise the token-match + expiry
// logic without booting Deno.

import { describe, expect, it } from 'vitest';
import {
  expiryFromNow,
  generateToken,
  isExpired,
  qrzBioUrl,
  TOKEN_PREFIX,
  TOKEN_TTL_MS,
  tokenInHtml,
} from '../../supabase/functions/qrz-verify/pure';

describe('generateToken', () => {
  it('prefixes MORSE-VERIFY- and adds a base32 suffix', () => {
    const t = generateToken();
    expect(t.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(t.length).toBe(TOKEN_PREFIX.length + 10);
    expect(t.slice(TOKEN_PREFIX.length)).toMatch(/^[A-Z2-7]{10}$/);
  });

  it('is deterministic when randomness is injected', () => {
    const fixed = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(generateToken(() => fixed)).toBe(`${TOKEN_PREFIX}ABCDEFGHIJ`);
  });
});

describe('tokenInHtml', () => {
  const token = 'MORSE-VERIFY-ABCDEFGHIJ';

  it('matches when the token appears anywhere in the body', () => {
    const html = `<html><body>${'x'.repeat(50_000)}${token}${'y'.repeat(
      50_000
    )}</body></html>`;
    expect(tokenInHtml(html, token)).toBe(true);
  });

  it('returns false when the token is absent', () => {
    expect(tokenInHtml('<html>nothing here</html>', token)).toBe(false);
  });

  it('returns false for an empty token (defensive)', () => {
    expect(tokenInHtml('anything', '')).toBe(false);
  });

  it("matches when QRZ's editor smart-quotes the hyphens into en-dashes", () => {
    // U+2013 EN DASH — what QRZ actually renders.
    const enDashed = 'MORSE–VERIFY–ABCDEFGHIJ';
    expect(tokenInHtml(`<p>${enDashed}</p>`, token)).toBe(true);
  });

  it('also tolerates em-dashes and minus signs', () => {
    expect(tokenInHtml('MORSE—VERIFY—ABCDEFGHIJ', token)).toBe(true);
    expect(tokenInHtml('MORSE−VERIFY−ABCDEFGHIJ', token)).toBe(true);
  });

  it("decodes QRZ's Base64.decode(...) bio blob and matches the token inside", () => {
    // QRZ ships the bio HTML as Base64.decode("...") that client JS unpacks
    // into an iframe — raw fetches see only the encoded blob.
    const bioHtml = `<p>${token}</p>`;
    const b64 = btoa(bioHtml);
    const page = `<html><body><script>Base64.decode("${b64}")</script></body></html>`;
    expect(tokenInHtml(page, token)).toBe(true);
  });

  it('ignores malformed Base64.decode chunks without throwing', () => {
    const page = `Base64.decode("not!valid!base64===") Base64.decode("${btoa(
      token
    )}")`;
    expect(tokenInHtml(page, token)).toBe(true);
  });
});

describe('isExpired', () => {
  it('is false when expiry is in the future', () => {
    const now = new Date('2026-06-17T12:00:00Z');
    const exp = new Date('2026-06-18T12:00:00Z');
    expect(isExpired(exp, now)).toBe(false);
  });

  it('is true when expiry is in the past', () => {
    const now = new Date('2026-06-17T12:00:00Z');
    const exp = new Date('2026-06-17T11:59:59Z');
    expect(isExpired(exp, now)).toBe(true);
  });

  it('accepts ISO strings', () => {
    const now = new Date('2026-06-17T12:00:00Z');
    expect(isExpired('2026-06-17T11:59:59Z', now)).toBe(true);
    expect(isExpired('2026-06-18T00:00:00Z', now)).toBe(false);
  });
});

describe('expiryFromNow', () => {
  it('is now + 24h by default', () => {
    const now = new Date('2026-06-17T12:00:00Z');
    expect(expiryFromNow(now).getTime() - now.getTime()).toBe(TOKEN_TTL_MS);
  });
});

describe('qrzBioUrl', () => {
  it('builds the canonical URL and URL-encodes the slash in portable callsigns', () => {
    expect(qrzBioUrl('W4GIT')).toBe('https://www.qrz.com/db/W4GIT');
    expect(qrzBioUrl('W4GIT/P')).toBe('https://www.qrz.com/db/W4GIT%2FP');
  });
});
