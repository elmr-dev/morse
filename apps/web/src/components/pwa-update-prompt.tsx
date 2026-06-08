import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Prompts the user to reload when a new version has been deployed. The waiting
 *  worker never activates on its own (registerType is 'prompt'), so an in-flight
 *  decode is never yanked out from under them. Renders nothing otherwise.
 *
 *  We deliberately ignore useRegisterSW's `offlineReady`: it fires on the first
 *  SW install for every visitor (browser included) and would be misleading here
 *  — the app shell is cached, but the decoder isn't usable offline until the
 *  model is provisioned. That messaging lives in OfflineProvisioner instead.
 *  Mounted once in main.tsx; useRegisterSW also performs the registration. */
export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div className="fixed bottom-24 inset-x-4 z-50 sm:bottom-4 sm:left-auto sm:right-4 sm:w-80 rounded-lg border border-border bg-card text-card-foreground shadow-lg">
      <div className="flex items-start gap-3 p-4">
        <RefreshCw
          className="mt-0.5 size-5 shrink-0 text-primary"
          aria-hidden
        />
        <div className="flex-1">
          <p className="font-medium text-sm">A new version is available.</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => updateServiceWorker(true)}>
              Reload
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setNeedRefresh(false)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
