import { useEffect, useState } from 'react'

/**
 * Like useState, but persists the value to localStorage under `key`.
 * Reads the stored value on first mount (falling back to `initial`), and
 * writes back on every change. JSON-serializes so it works for numbers,
 * booleans, and objects as well as strings. All localStorage access is
 * guarded so a private-mode / quota / parse failure degrades to in-memory
 * state rather than throwing.
 */
export function usePersistedState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw === null) return initial
      return JSON.parse(raw) as T
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // Ignore write failures (private mode, quota, etc).
    }
  }, [key, value])

  return [value, setValue] as const
}

/** Remove persisted keys from localStorage (best-effort). */
export function clearPersisted(...keys: string[]) {
  for (const key of keys) {
    try {
      localStorage.removeItem(key)
    } catch {
      // Ignore.
    }
  }
}
