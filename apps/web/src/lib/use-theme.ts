import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark' | 'system';

export const THEMES: Theme[] = ['light', 'dark', 'system'];

function readStoredTheme(): Theme {
  const stored = localStorage.getItem('theme');
  if (stored === 'light' || stored === 'dark' || stored === 'system')
    return stored;
  return 'system';
}

function applyTheme(theme: Theme): void {
  const dark =
    theme === 'dark' ||
    (theme === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

// Module-level store so every consumer (header button + "More" drawer rows)
// shares one source of truth — they can be mounted at the same time on mobile,
// so independent useState copies would drift.
let current: Theme =
  typeof window === 'undefined' ? 'system' : readStoredTheme();
const listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  applyTheme(current);
  // Track OS scheme changes while in "system" mode.
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      if (current === 'system') applyTheme('system');
    });
}

function setTheme(next: Theme): void {
  current = next;
  if (next === 'system') {
    localStorage.removeItem('theme');
  } else {
    localStorage.setItem('theme', next);
  }
  applyTheme(next);
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Shared theme state + persistence. Used by the header cycle button (browser
 *  desktop) and the "More" drawer's rows (mobile / standalone). */
export function useTheme(): {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  cycleTheme: () => void;
} {
  const theme = useSyncExternalStore(
    subscribe,
    () => current,
    () => 'system' as Theme
  );

  const cycleTheme = () =>
    setTheme(THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]);

  return { theme, setTheme, cycleTheme };
}
