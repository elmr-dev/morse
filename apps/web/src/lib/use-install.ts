import { useEffect, useState } from 'react';

/** The Android/Chrome install prompt event. Not in the standard lib DOM types. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallPlatform = 'android' | 'ios' | 'other';

/** iOS exposes no install API, so it needs the manual Add to Home Screen
 *  how-to. Every iOS browser (Safari, Chrome, Firefox, Comet, …) is WebKit and
 *  can Add to Home Screen via the system Share sheet, so we key off the device,
 *  not the browser brand. */
function detectPlatform(): InstallPlatform {
  if (typeof window === 'undefined') return 'other';
  const ua = window.navigator.userAgent;
  // iPadOS 13+ Safari reports a desktop Macintosh UA; touch points disambiguate.
  const isIpad =
    /Macintosh/.test(ua) && (window.navigator.maxTouchPoints ?? 0) > 1;
  if (/iphone|ipad|ipod/i.test(ua) || isIpad) {
    return 'ios';
  }
  // Android/Chrome announces installability via beforeinstallprompt; treat any
  // non-iOS platform as a potential 'android' candidate and let canInstall gate
  // whether the native prompt is actually offered.
  return 'android';
}

/** Surfaces install affordances: the native Android/Chrome prompt where the
 *  platform fires beforeinstallprompt, and platform info so iOS can show its
 *  manual how-to. SSR-safe; mirrors use-standalone.ts. */
export function useInstall(): {
  canInstall: boolean;
  promptInstall: () => Promise<void>;
  platform: InstallPlatform;
} {
  const [platform] = useState(detectPlatform);
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      // Stop Chrome's default mini-infobar and stash the event for our button.
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => setDeferredPrompt(null);

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const promptInstall = async (): Promise<void> => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    // The event is single-use; discard it whatever the user chose.
    setDeferredPrompt(null);
  };

  return { canInstall: deferredPrompt !== null, promptInstall, platform };
}
