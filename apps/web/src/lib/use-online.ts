import { useSyncExternalStore } from 'react';

function subscribe(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

/** Reactive navigator.onLine. SSR-safe (assumes online on the server). Note the
 *  browser's onLine is best-effort — true can mean "has a network", not "has
 *  real internet" — but it reliably flips false for airplane mode / no network. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true
  );
}
