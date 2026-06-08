import { Heart } from 'lucide-react';
import { useIsStandalone } from '@/lib/use-standalone';
import pkg from '../../package.json';

/** The "Made with ♥ in Atlanta · v{version}" line. Shared by the browser
 *  footer and the standalone "More" sheet. */
export function FooterContent() {
  return (
    <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        Made with
        <Heart
          className="size-3.5 text-chart-5 fill-chart-5"
          aria-label="love"
        />
        in Atlanta
      </span>
      <span aria-hidden="true">&middot;</span>
      <span className="font-mono">v{pkg.version}</span>
    </div>
  );
}

export default function Footer() {
  // In standalone the footer content lives in the "More" drawer instead.
  if (useIsStandalone()) return null;
  // On mobile (browser) the footer also moves into the "More" drawer; it shows
  // up top only on desktop.
  return (
    <footer className="hidden sm:block">
      <div className="max-w-[900px] mx-auto px-5 py-5">
        <FooterContent />
      </div>
    </footer>
  );
}
