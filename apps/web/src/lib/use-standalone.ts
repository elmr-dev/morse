import { useEffect, useState } from 'react';

/** True when launched as an installed PWA / iOS home-screen app. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari predates display-mode; nonstandard flag on navigator.
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

export function useIsStandalone(): boolean {
  // Standalone state is fixed at launch; read once. useState initializer keeps
  // SSR-safe and avoids a flash. A display-mode listener is added defensively
  // in case the app is ever opened in a context that can change it.
  const [standalone, setStandalone] = useState(isStandalone);
  useEffect(() => {
    const mq = window.matchMedia('(display-mode: standalone)');
    const handler = () => setStandalone(isStandalone());
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return standalone;
}
