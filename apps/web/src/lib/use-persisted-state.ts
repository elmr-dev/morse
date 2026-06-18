// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';

/**
 * Like useState, but persists the value to localStorage under `key`.
 * Reads the stored value on first mount (falling back to `initial`), and
 * writes back on every change. JSON-serializes so it works for numbers,
 * booleans, and objects as well as strings. All localStorage access is
 * guarded so a private-mode / quota / parse failure degrades to in-memory
 * state rather than throwing.
 *
 * Pass `validate` to reject payloads from an older schema (e.g. a record
 * shape that changed between releases) — when it returns false, the stored
 * key is removed and we fall back to `initial`. Without it, any JSON that
 * parses is trusted, which silently renders wrong on a shape change.
 */
export function usePersistedState<T>(
  key: string,
  initial: T,
  validate?: (parsed: unknown) => parsed is T
) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return initial;
      const parsed: unknown = JSON.parse(raw);
      if (validate && !validate(parsed)) {
        // Stale shape — discard so we don't render undefined fields as if they
        // were valid data.
        try {
          localStorage.removeItem(key);
        } catch {
          // Ignore.
        }
        return initial;
      }
      return parsed as T;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore write failures (private mode, quota, etc).
    }
  }, [key, value]);

  return [value, setValue] as const;
}

/** Remove persisted keys from localStorage (best-effort). */
export function clearPersisted(...keys: string[]) {
  for (const key of keys) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore.
    }
  }
}
