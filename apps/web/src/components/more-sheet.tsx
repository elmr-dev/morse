import {
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  Monitor,
  Moon,
  Share,
  SquarePlus,
  Sun,
} from 'lucide-react';
import { useState } from 'react';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@/components/ui/drawer';
import { useInstall } from '@/lib/use-install';
import { useIsStandalone } from '@/lib/use-standalone';
import { type Theme, useTheme } from '@/lib/use-theme';
import { cn } from '@/lib/utils';
import { FooterContent } from './footer';
import { GITHUB_URL, GithubIcon } from './github';
import { OfflineSection } from './offline-section';

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

const rowClass =
  'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/60 outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

/** Install affordance: native prompt on Android/Chrome, manual how-to on iOS
 *  Safari, nothing elsewhere. Hidden entirely once running as an installed app
 *  (the caller gates on useIsStandalone). */
function InstallSection() {
  const { canInstall, promptInstall, platform } = useInstall();
  const [showSteps, setShowSteps] = useState(false);

  if (platform === 'android' && canInstall) {
    return (
      <div className="border-t border-border pt-1">
        <button
          type="button"
          onClick={() => promptInstall()}
          className={rowClass}
        >
          <Download className="size-5 text-muted-foreground" />
          <span className="flex-1 text-left">Install app</span>
        </button>
      </div>
    );
  }

  if (platform === 'ios') {
    return (
      <div className="border-t border-border pt-1">
        <button
          type="button"
          onClick={() => setShowSteps((v) => !v)}
          aria-expanded={showSteps}
          className={rowClass}
        >
          <Share className="size-5 text-muted-foreground" />
          <span className="flex-1 text-left">Add to Home Screen</span>
          <ChevronDown
            className={cn(
              'size-4 text-muted-foreground transition-transform',
              showSteps && 'rotate-180'
            )}
          />
        </button>
        {showSteps && (
          <p className="px-3 pb-2 text-muted-foreground text-xs leading-relaxed">
            Tap the Share icon{' '}
            <Share className="inline size-3.5 align-text-bottom" aria-hidden />{' '}
            in your browser's toolbar, then choose{' '}
            <SquarePlus
              className="inline size-3.5 align-text-bottom"
              aria-hidden
            />{' '}
            <strong className="font-semibold text-foreground">
              Add to Home Screen
            </strong>
          </p>
        )}
      </div>
    );
  }

  return null;
}

/** Bottom sheet reached from the standalone bottom bar's "More" tab. Houses the
 *  controls the standalone shell hides from the top header/footer: theme,
 *  GitHub link, and the footer line. */
export function MoreSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { theme, setTheme } = useTheme();
  const standalone = useIsStandalone();

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="flex flex-col gap-4 px-5 pt-2 pb-4">
          <DrawerTitle className="sr-only">More</DrawerTitle>
          <DrawerDescription className="sr-only">
            Appearance, source code, and app info.
          </DrawerDescription>

          <div>
            <p className="px-3 pb-1 text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Appearance
            </p>
            <fieldset className="flex flex-col border-0 p-0 m-0">
              <legend className="sr-only">Theme</legend>
              {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
                const active = theme === value;
                return (
                  <label
                    key={value}
                    className={cn(
                      rowClass,
                      'cursor-pointer has-focus-visible:ring-2 has-focus-visible:ring-ring/50'
                    )}
                  >
                    <input
                      type="radio"
                      name="theme"
                      value={value}
                      checked={active}
                      onChange={() => setTheme(value)}
                      className="sr-only"
                    />
                    <Icon className="size-5 text-muted-foreground" />
                    <span className="flex-1 text-left">{label}</span>
                    {active && <Check className="size-4 text-primary" />}
                  </label>
                );
              })}
            </fieldset>
          </div>

          {!standalone && <InstallSection />}

          {/* Offline provisioning is the step after install: installed PWAs get
              durable storage, so the cached 16MB survives — in a plain tab it's
              evictable, so we don't make a promise we can't keep. */}
          {standalone && <OfflineSection />}

          <div className="border-t border-border pt-1">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className={cn(rowClass, 'group')}
            >
              <GithubIcon className="size-5 text-muted-foreground" />
              <span className="flex-1">View source on GitHub</span>
              <ExternalLink className="size-4 text-muted-foreground" />
            </a>
          </div>

          <div className="border-t border-border pt-4">
            <FooterContent />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
