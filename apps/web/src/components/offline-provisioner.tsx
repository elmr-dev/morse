import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useOfflineModel } from '@/lib/use-offline-model';
import { useOnline } from '@/lib/use-online';
import { useIsStandalone } from '@/lib/use-standalone';

/** Once installed and online, just save the decoder for offline use — it's
 *  ~16MB and they've already committed by installing, so there's nothing to ask.
 *  A toast reports progress and completion; we never prompt or block. Provisions
 *  once per session when uncached; a cached model is left alone. Renders nothing.
 */
export function OfflineProvisioner() {
  const standalone = useIsStandalone();
  const online = useOnline();
  const { status, download } = useOfflineModel();
  const started = useRef(false);

  useEffect(() => {
    if (!standalone || !online) return;
    if (status !== 'idle' || started.current) return;
    started.current = true;
    toast.promise(download(), {
      loading: 'Saving the decoder for offline use…',
      success: 'Decoder saved — works offline now',
      error: "Couldn't save for offline — try again from More.",
    });
  }, [standalone, online, status, download]);

  return null;
}
