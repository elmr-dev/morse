import {
  Check,
  CloudDownload,
  CloudOff,
  Loader2,
  TriangleAlert,
} from 'lucide-react';
import { useOfflineModel } from '@/lib/use-offline-model';
import { useOnline } from '@/lib/use-online';
import { cn } from '@/lib/utils';

// Mirrors the row style used by the other More-sheet rows (see more-sheet.tsx),
// but items-start so the two-line label (heading + subline) aligns to the icon.
const rowBase =
  'flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium text-foreground';
const rowInteractive =
  'transition-colors hover:bg-muted/60 outline-none focus-visible:ring-2 focus-visible:ring-ring/50';
const subline = 'font-normal text-muted-foreground text-xs';

/** Manual "save for offline" control / status, shown in the More sheet. The
 *  install-time provisioner (offline-provisioner.tsx) handles the common cases
 *  automatically; this is the fallback for anyone who declined that prompt and
 *  the at-a-glance saved status. */
export function OfflineSection() {
  const { status, download } = useOfflineModel();
  const online = useOnline();

  // Don't flash a "Save…" prompt before we know whether it's already cached.
  if (status === 'checking') return null;

  if (status === 'ready') {
    return (
      <div className="border-t border-border pt-1">
        <div className={rowBase}>
          <Check className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <span className="flex flex-1 flex-col">
            Saved for offline
            <span className={subline}>
              The decoder lives on your device — no connection needed.
            </span>
          </span>
        </div>
      </div>
    );
  }

  // Saving needs the network, so don't offer it offline — that button could
  // only fail. Explain the prerequisite instead.
  if (!online) {
    return (
      <div className="border-t border-border pt-1">
        <div className={rowBase}>
          <CloudOff
            className="mt-0.5 size-5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="flex flex-1 flex-col">
            Not saved for offline
            <span className={subline}>
              Reconnect to the internet to save the decoder for offline use.
            </span>
          </span>
        </div>
      </div>
    );
  }

  const downloading = status === 'downloading';
  const failed = status === 'error';

  return (
    <div className="border-t border-border pt-1">
      <button
        type="button"
        onClick={() => void download().catch(() => {})}
        disabled={downloading}
        aria-busy={downloading}
        className={cn(rowBase, rowInteractive)}
      >
        {downloading ? (
          <Loader2
            className="mt-0.5 size-5 shrink-0 animate-spin text-muted-foreground"
            aria-hidden
          />
        ) : failed ? (
          <TriangleAlert
            className="mt-0.5 size-5 shrink-0 text-destructive"
            aria-hidden
          />
        ) : (
          <CloudDownload
            className="mt-0.5 size-5 shrink-0 text-muted-foreground"
            aria-hidden
          />
        )}
        <span className="flex flex-1 flex-col" aria-live="polite">
          {downloading
            ? 'Saving for offline…'
            : failed
              ? 'Download failed — try again'
              : 'Save for offline use'}
          {!(downloading || failed) && (
            <span className={subline}>
              Download the decoder (~16&nbsp;MB) to use without a connection.
            </span>
          )}
        </span>
      </button>
    </div>
  );
}
