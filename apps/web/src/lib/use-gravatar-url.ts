// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';

// Gravatar accepts the trimmed/lowercased email hashed as SHA-256 (since
// 2023) or the legacy MD5. SHA-256 lets us stay in the browser's SubtleCrypto
// without pulling in an MD5 dep. `d=identicon` returns a deterministic
// pixel-pattern when the address has no profile — always renders, never 404s.
export function useGravatarUrl(
  email: string | undefined,
  size = 64
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!email) {
      setUrl(null);
      return;
    }
    const normalized = email.trim().toLowerCase();
    const bytes = new TextEncoder().encode(normalized);
    let cancelled = false;
    crypto.subtle.digest('SHA-256', bytes).then((buf) => {
      if (cancelled) return;
      const hex = Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      setUrl(`https://www.gravatar.com/avatar/${hex}?d=identicon&s=${size}`);
    });
    return () => {
      cancelled = true;
    };
  }, [email, size]);
  return url;
}
