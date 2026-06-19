// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Wifi, WifiOff } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useOnline } from '@/lib/use-online';

/** Small header icon that only renders when offline. Sits in the same
 *  `size-9` slot as the GitHub link / theme switcher / callsign dropdown so
 *  it doesn't shift the layout when it appears. Online = nothing, no
 *  permanent "all clear" badge cluttering the header in the 99% case. */
export function OfflineIndicator() {
  const online = useOnline();
  if (online) return null;
  return (
    <span
      role="status"
      aria-label="Offline"
      title="You're offline — some features unavailable"
      className="inline-flex items-center justify-center size-9 text-muted-foreground"
    >
      <WifiOff className="size-4" aria-hidden />
    </span>
  );
}

/** Fires a Sonner toast each time the connection flips. Pairs with the
 *  always-visible OfflineIndicator: the toast catches attention on the
 *  state change, the icon persists as the steady-state reminder. The first
 *  render is skipped so we don't toast on mount. */
export function useOnlineTransitionToasts(): void {
  const online = useOnline();
  // null until we've observed the initial state once. After that, holds the
  // previous value so the effect can detect actual transitions.
  const previousRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (previousRef.current === null) {
      previousRef.current = online;
      return;
    }
    if (previousRef.current === online) return;
    previousRef.current = online;
    if (online) {
      toast('Back online', {
        id: 'connectivity',
        icon: <Wifi className="size-4 text-primary" aria-hidden />,
      });
    } else {
      toast("You're offline — some features unavailable", {
        id: 'connectivity',
        icon: <WifiOff className="size-4 text-muted-foreground" aria-hidden />,
      });
    }
  }, [online]);
}
