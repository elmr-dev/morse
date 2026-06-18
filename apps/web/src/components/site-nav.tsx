// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ChevronDown,
  CircleUser,
  HelpCircle,
  House,
  LogOut,
  type LucideIcon,
  Menu,
  Radio,
  Settings,
  ShieldCheck,
  Trophy,
} from 'lucide-react';
import { type ComponentType, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { isAuthConfigured } from '@/lib/supabase';
import { useIsStandalone } from '@/lib/use-standalone';
import { cn } from '@/lib/utils';
import { BoxingGloveIcon } from './boxing-glove-icon';
import { GITHUB_URL, GithubIcon } from './github';
import Logo from './logo';
import { MoreSheet } from './more-sheet';
import { scrollToTop } from './scroll-to-top';
import ThemeSwitcher from './theme-switcher';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon | ComponentType<{ className?: string }>;
  /** Match only the exact path (needed for "/", which otherwise prefix-matches
   *  every route and stays perpetually active). */
  end?: boolean;
}

// Primary destinations — shown in the desktop header AND the mobile bottom bar.
// GitHub is intentionally excluded (external link, not a site section): it
// lives in the header on desktop and the footer on mobile only.
const NAV_ITEMS: NavItem[] = [
  { to: '/decode', label: 'Decode', icon: Radio },
  { to: '/beat-the-bot', label: 'Beat the Bot', icon: BoxingGloveIcon },
  { to: '/leaderboard', label: 'Leaderboard', icon: Trophy },
];

// Desktop header nav — same primary destinations as the mobile bottom bar,
// plus Leaderboard inserted before FAQ. The mobile bottom bar can't fit
// another route (it's already at its slot cap with NAV_ITEMS + Home + More),
// so Leaderboard surfaces on mobile via the MoreSheet instead.
const DESKTOP_NAV_ITEMS: NavItem[] = [
  { to: '/decode', label: 'Decode', icon: Radio },
  { to: '/beat-the-bot', label: 'Beat the Bot', icon: BoxingGloveIcon },
  { to: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  { to: '/faq', label: 'FAQ', icon: HelpCircle },
];

// Browser-mode bottom bar leads with Home. On desktop the wordmark is the home
// link, so Home isn't repeated in the header nav. In standalone there is no
// landing page, so the bar drops Home and gains a "More" trigger instead.
const HOME_ITEM: NavItem = { to: '/', label: 'Home', icon: House, end: true };

const tabClass =
  'flex flex-1 flex-col items-center justify-center gap-0.5 py-3.5 text-[11px] font-medium text-center leading-tight transition-colors outline-none';

/**
 * Top header — shown on every page in a browser tab, all viewports. Hidden
 * entirely in standalone (installed PWA / iOS home-screen) mode, where the
 * bottom bar is the only chrome. Wordmark (→ home) left; desktop nav links +
 * GitHub + theme right. On mobile the link row is hidden (the bottom bar
 * carries it); wordmark, GitHub, and theme remain up top.
 */
export function SiteHeader() {
  const standalone = useIsStandalone();
  const { status, profile, user, signOut } = useAuth();
  const navigate = useNavigate();
  if (standalone) return null;

  return (
    <header className="mb-5">
      {/* Mobile: wordmark is alone (nav + controls live in the bottom bar), so
          center it. Desktop: space it against the nav/controls on the right. */}
      <div className="flex items-center justify-center sm:justify-between gap-3 py-1">
        {/* Decorative rules flanking the centered mobile wordmark — strongest
            beside the logo, fading out toward the screen edges. Mobile only. */}
        <span
          aria-hidden="true"
          className="h-px flex-1 bg-linear-to-r from-transparent to-primary/60 sm:hidden"
        />
        <NavLink
          to="/"
          onClick={scrollToTop}
          className="group flex items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label="Morse — home"
        >
          <Logo className="h-5 w-auto drop-shadow-[0_0_5px_rgba(157,134,255,0.45)] transition duration-300 group-hover:scale-[1.06] group-hover:drop-shadow-[0_0_12px_rgba(157,134,255,0.9)]" />
          <span className="font-mono font-extrabold text-foreground text-2xl tracking-tight transition-[text-shadow] duration-300 group-hover:[text-shadow:0_0_16px_rgba(157,134,255,0.55)]">
            MORSE
          </span>
        </NavLink>
        <span
          aria-hidden="true"
          className="h-px flex-1 bg-linear-to-l from-transparent to-primary/60 sm:hidden"
        />

        <div className="flex items-center gap-1">
          <nav className="hidden sm:flex items-center gap-1">
            {DESKTOP_NAV_ITEMS.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={scrollToTop}
                className={({ isActive }) =>
                  cn(
                    'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                    isActive
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                  )
                }
              >
                <Icon className="size-4" />
                {label}
              </NavLink>
            ))}
          </nav>

          {/* GitHub + theme live up top on desktop only; on mobile they move
              into the bottom bar's "More" menu. */}
          <div className="hidden sm:flex items-center gap-1">
            {isAuthConfigured &&
              (status === 'ready' && profile ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={`Account: ${profile.call_sign}`}
                    title="Account"
                    className={cn(
                      'inline-flex items-center justify-center gap-1.5 h-9 rounded-md px-2.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                      'data-[state=open]:bg-muted data-[state=open]:text-foreground'
                    )}
                  >
                    <CircleUser className="size-4" />
                    <span className="font-mono text-xs">
                      {profile.call_sign}
                    </span>
                    <ChevronDown
                      className="size-3.5 opacity-60"
                      aria-hidden="true"
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-56">
                    <div className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5 font-mono text-sm font-semibold text-foreground">
                        {profile.call_sign}
                        {profile.verified && (
                          <ShieldCheck
                            className="size-3.5 text-verified"
                            aria-label="Verified"
                          />
                        )}
                      </div>
                      {user?.email && (
                        <div className="truncate text-xs text-muted-foreground">
                          {user.email}
                        </div>
                      )}
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => {
                        scrollToTop();
                        navigate('/account');
                      }}
                    >
                      <Settings className="size-4" />
                      Settings
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => {
                        void signOut();
                      }}
                    >
                      <LogOut className="size-4" />
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <NavLink
                  to="/account"
                  onClick={scrollToTop}
                  aria-label="Settings"
                  title="Settings"
                  className={({ isActive }) =>
                    cn(
                      'inline-flex items-center justify-center size-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                      isActive && 'bg-muted text-foreground'
                    )
                  }
                >
                  <Settings className="size-4" />
                </NavLink>
              ))}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="View source on GitHub"
              title="View source on GitHub"
              className="inline-flex items-center justify-center size-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <GithubIcon className="size-4" />
            </a>
            <ThemeSwitcher />
          </div>
        </div>
      </div>
    </header>
  );
}

/**
 * Bottom tab bar — the mobile nav (and the only chrome in standalone). Always
 * ends with a "More" trigger that opens a drawer holding the theme controls,
 * GitHub link, and footer text — on mobile those are hidden from the header and
 * footer and live here instead. In a browser tab it's mobile-only (`sm:hidden`)
 * and leads with Home; in standalone it's visible at all widths and drops Home
 * (no landing page).
 *
 * Fixed to the viewport bottom, full-bleed (outside the centered content
 * column). The content wrapper reserves bottom padding so nothing hides behind
 * it (see main.tsx).
 */
export function MobileTabBar() {
  const standalone = useIsStandalone();
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  // Route tabs only — the "More" trigger is not a route and is appended after
  // these. The sliding indicator tracks route tabs exclusively.
  const routeItems = standalone ? NAV_ITEMS : [HOME_ITEM, ...NAV_ITEMS];
  const totalSlots = routeItems.length + 1; // + the always-present "More" tab

  const activeIndex = routeItems.findIndex((it) =>
    it.to === '/'
      ? pathname === '/'
      : pathname === it.to || pathname.startsWith(`${it.to}/`)
  );

  return (
    <>
      <nav
        className={cn(
          'fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur-sm',
          // Standalone clears the iOS home indicator AND adds breathing room
          // above it so the tabs don't clash with the white bar.
          standalone
            ? 'pb-[calc(env(safe-area-inset-bottom)+1.25rem)]'
            : 'pb-[env(safe-area-inset-bottom)] sm:hidden'
        )}
        aria-label="Primary"
      >
        {/* sliding purple indicator on the active route tab's top edge */}
        <span
          aria-hidden="true"
          className="absolute top-0 left-0 h-0.5 rounded-full bg-primary transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none"
          style={{
            width: `${100 / totalSlots}%`,
            transform: `translateX(${Math.max(activeIndex, 0) * 100}%)`,
            opacity: activeIndex < 0 ? 0 : 1,
          }}
        />
        <div className="flex items-stretch justify-around">
          {routeItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={scrollToTop}
              className={({ isActive }) =>
                cn(
                  tabClass,
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                )
              }
            >
              <Icon className="size-5" />
              {label}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className={cn(
              tabClass,
              moreOpen
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Menu className="size-5" />
            More
          </button>
        </div>
      </nav>
      <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} />
    </>
  );
}
