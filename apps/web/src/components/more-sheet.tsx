// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  HelpCircle,
  LogOut,
  Monitor,
  Moon,
  Settings,
  Share,
  ShieldCheck,
  SquarePlus,
  Sun,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@/components/ui/drawer';
import { useAuth } from '@/lib/auth';
import { isAuthConfigured } from '@/lib/supabase';
import { useGravatarUrl } from '@/lib/use-gravatar-url';
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
      <div className="border-t border-foreground/15 pt-3">
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
      <div className="border-t border-foreground/15 pt-3">
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
  const { status, profile, user, signOut } = useAuth();
  const signedIn = status === 'ready' && profile;
  const avatarUrl = useGravatarUrl(user?.email, 80);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="flex flex-col px-5 pt-2 pb-4">
          <DrawerTitle className="sr-only">More</DrawerTitle>
          <DrawerDescription className="sr-only">
            Appearance, source code, and app info.
          </DrawerDescription>

          {/* Signed-in identity banner — anchors the sheet so the user
              immediately sees who's logged in before the nav rows. */}
          {isAuthConfigured && signedIn && (
            <div className="flex items-center gap-3 rounded-lg bg-accent px-3 py-3 ring-1 ring-inset ring-primary/40">
              <img
                src={avatarUrl ?? undefined}
                alt=""
                aria-hidden="true"
                crossOrigin="anonymous"
                width={40}
                height={40}
                className="size-10 rounded-full bg-muted"
              />
              <div className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="flex items-center gap-1.5 font-mono text-base font-semibold text-foreground">
                  {profile.call_sign}
                  {profile.verified && (
                    <ShieldCheck
                      className="size-4 text-verified"
                      aria-label="Verified"
                    />
                  )}
                </span>
                {user?.email && (
                  <span className="truncate text-xs text-muted-foreground">
                    {user.email}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Destinations — the main reason to open this sheet on mobile is
              to navigate to a page that doesn't fit the bottom bar. */}
          <div className={cn(isAuthConfigured && signedIn && 'mt-3')}>
            <NavLink
              to="/faq"
              onClick={() => onOpenChange(false)}
              className={rowClass}
            >
              <HelpCircle className="size-5 text-muted-foreground" />
              <span className="flex-1 text-left">FAQ</span>
            </NavLink>
            {isAuthConfigured &&
              (signedIn ? (
                <>
                  <NavLink
                    to="/account"
                    onClick={() => onOpenChange(false)}
                    className={rowClass}
                  >
                    <Settings className="size-5 text-muted-foreground" />
                    <span className="flex-1 text-left">Settings</span>
                  </NavLink>
                  <button
                    type="button"
                    onClick={() => {
                      onOpenChange(false);
                      void signOut();
                    }}
                    className={cn(rowClass, 'text-destructive')}
                  >
                    <LogOut className="size-5 text-destructive" />
                    <span className="flex-1 text-left">Sign out</span>
                  </button>
                </>
              ) : (
                <NavLink
                  to="/account"
                  onClick={() => onOpenChange(false)}
                  className={rowClass}
                >
                  <Settings className="size-5 text-muted-foreground" />
                  <span className="flex-1 text-left">Settings</span>
                </NavLink>
              ))}
          </div>

          <div className="border-t border-foreground/15 pt-3">
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

          {/* App-level affordances: install on mobile, or provisioning the
              offline model once installed. Each is conditional on platform. */}
          {!standalone && <InstallSection />}
          {standalone && <OfflineSection />}

          <div className="border-t border-foreground/15 pt-3">
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

          <div className="border-t border-foreground/15 pt-3">
            <FooterContent />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
