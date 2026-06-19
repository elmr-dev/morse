// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BadgePercent,
  CircleUser,
  Copy,
  Loader2,
  LogOut,
  Shield,
  ShieldCheck,
  SquareUser,
  UserCog,
  WifiOff,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { useState } from 'react';
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { toast } from 'sonner';
import { GithubIcon } from '@/components/github';
import PageHeader from '@/components/page-header';
import { DiscordIcon, GoogleIcon } from '@/components/provider-icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { type AuthProvider, useAuth } from '@/lib/auth';
import { SITE_URL } from '@/lib/site';
import { isAuthConfigured, supabase } from '@/lib/supabase';
import { useDocumentHead } from '@/lib/use-document-head';
import { useOnline } from '@/lib/use-online';
import { cn } from '@/lib/utils';

interface ProviderEntry {
  id: AuthProvider;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Disable when the OAuth app isn't configured yet on our side. The
   *  button still renders so users can see the option exists. */
  comingSoon?: boolean;
}

const PROVIDERS: readonly ProviderEntry[] = [
  {
    id: 'google',
    label: 'Sign in with Google',
    icon: GoogleIcon,
    comingSoon: true,
  },
  { id: 'github', label: 'Sign in with GitHub', icon: GithubIcon },
  {
    id: 'discord',
    label: 'Sign in with Discord',
    icon: DiscordIcon,
    comingSoon: true,
  },
] as const;

type SectionId = 'identity' | 'badge' | 'session';

interface SectionEntry {
  id: SectionId;
  label: string;
  icon: ComponentType<{ className?: string }>;
  path: string;
}

const SECTIONS: readonly SectionEntry[] = [
  { id: 'identity', label: 'Identity', icon: SquareUser, path: 'identity' },
  { id: 'badge', label: 'Badge', icon: BadgePercent, path: 'badge' },
  { id: 'session', label: 'Account', icon: UserCog, path: 'session' },
] as const;

export default function AccountPage() {
  useDocumentHead({
    title: 'Settings',
    description:
      'Optional sign-in to claim a callsign and publish your Beat the Bot bests.',
    path: '/account',
  });

  const { status, signIn, claimCallsign, signOut } = useAuth();
  const online = useOnline();

  if (!isAuthConfigured) {
    return (
      <Shell>
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Accounts aren't enabled in this build.
            </p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (status === 'loading') {
    return (
      <Shell>
        <div
          className="flex items-center justify-center py-12 text-muted-foreground"
          role="status"
          aria-label="Loading account"
        >
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        </div>
      </Shell>
    );
  }

  if (status === 'signed-out') {
    return (
      <Shell showIntro>
        <SignedOutView onSignIn={signIn} />
      </Shell>
    );
  }

  // Signed in (or mid-claim) but offline. Every section past this point
  // — callsign claim, badge preview, sign-out (Supabase round-trip),
  // session controls — needs the network. Render one explicit offline
  // card instead of a half-working settings UI. SignedOutView above has
  // its own offline treatment (disabled OAuth buttons + inline note).
  if (!online) {
    return (
      <Shell>
        <OfflineSettings />
      </Shell>
    );
  }

  if (status === 'needs-callsign') {
    return (
      <Shell>
        <ClaimView onClaim={claimCallsign} onSignOut={signOut} />
      </Shell>
    );
  }

  return (
    <Shell>
      <SettingsLayout>
        <Outlet />
      </SettingsLayout>
    </Shell>
  );
}

function Shell({
  children,
  showIntro = false,
}: {
  children: React.ReactNode;
  showIntro?: boolean;
}) {
  return (
    <>
      <PageHeader
        eyebrow="Account"
        icon={CircleUser}
        title="Settings"
        wideIntro
      >
        {showIntro
          ? 'Playing is anonymous and needs no account. Sign in only to claim your callsign and put your bests on the leaderboard.'
          : undefined}
      </PageHeader>
      <hr className="mb-6 hidden border-border md:block" />
      {children}
    </>
  );
}

/** Shown when the user is past sign-in but the device is offline. Every
 *  remaining settings surface (callsign claim, badge preview, sign-out,
 *  session controls) needs the network; one explicit card beats a
 *  half-working UI. */
function OfflineSettings() {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center"
    >
      <WifiOff className="size-6 text-muted-foreground" aria-hidden />
      <p className="font-medium text-sm text-foreground">
        Settings need an internet connection
      </p>
      <p className="text-xs text-muted-foreground">
        They'll be available again when you're back online.
      </p>
    </div>
  );
}

function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const current =
    SECTIONS.find((s) => pathname.endsWith(`/${s.path}`))?.id ?? 'identity';

  return (
    <div className="grid gap-6 md:grid-cols-[200px_1fr]">
      {/* Desktop sidebar */}
      <nav
        aria-label="Settings sections"
        className="hidden md:flex flex-col gap-1"
      >
        {SECTIONS.map(({ id, label, icon: Icon, path }) => (
          <NavLink
            key={id}
            to={path}
            className={({ isActive }) =>
              cn(
                'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                isActive
                  ? 'bg-accent text-accent-foreground ring-1 ring-inset ring-primary/60'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="flex flex-col gap-4">
        {/* Mobile section picker */}
        <div className="md:hidden">
          <Select
            value={current}
            onValueChange={(v) => {
              const next = SECTIONS.find((s) => s.id === v);
              if (next) navigate(next.path);
            }}
          >
            <SelectTrigger
              aria-label="Settings section"
              className="h-12 w-full justify-between bg-card text-base dark:bg-card dark:hover:bg-muted [&_svg:not([class*='size-'])]:size-5"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SECTIONS.map(({ id, label, icon: Icon }) => (
                <SelectItem
                  key={id}
                  value={id}
                  className="min-h-11 text-base sm:min-h-0 sm:text-sm"
                >
                  <Icon className="size-4" />
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {children}
      </div>
    </div>
  );
}

function SectionIntro({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function KeyValueRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border/60 py-3 text-sm first:border-t-0 first:pt-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground text-right">{children}</span>
    </div>
  );
}

export function IdentitySection() {
  const { profile, refreshProfile } = useAuth();
  const callsign = profile?.call_sign ?? '';
  const verified = profile?.verified ?? false;

  return (
    <section className="flex flex-col gap-4">
      <SectionIntro>
        Your callsign is how you show up on the leaderboard. Verify it against
        your QRZ bio so other operators can trust it's really you.
      </SectionIntro>
      <Card>
        <CardContent className="flex flex-col gap-1">
          <div className="flex items-center gap-3 pb-3">
            <span className="font-mono text-2xl font-bold tracking-wider text-foreground">
              {callsign}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={
                    verified ? 'Verified callsign' : 'Callsign not yet verified'
                  }
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                    verified
                      ? 'bg-primary/10 text-verified'
                      : 'bg-amber-500/10 text-amber-500'
                  )}
                >
                  {verified ? (
                    <>
                      <ShieldCheck className="size-3.5" aria-hidden="true" />
                      Verified
                    </>
                  ) : (
                    <>
                      <Shield className="size-3.5" aria-hidden="true" />
                      Not yet verified
                    </>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  {verified
                    ? 'Verified via your QRZ bio. '
                    : 'Optional — verify your callsign via your QRZ bio. '}
                  <Link
                    to="/faq#verified-badge"
                    className="underline underline-offset-2"
                  >
                    Learn more
                  </Link>
                  .
                </span>
              </TooltipContent>
            </Tooltip>
          </div>
          <KeyValueRow label="Callsign">
            <span className="font-mono">{callsign}</span>
          </KeyValueRow>
          <KeyValueRow label="QRZ verification">
            {verified ? (
              <span className="inline-flex items-center gap-1.5 text-verified">
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                Verified via QRZ bio
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-amber-500">
                <Shield className="size-3.5" aria-hidden="true" />
                Not verified
              </span>
            )}
          </KeyValueRow>
          <KeyValueRow label="Leaderboard">
            <span className="text-muted-foreground">Bests published</span>
          </KeyValueRow>
          {!verified && (
            <div className="pt-3">
              <VerifySection callsign={callsign} onVerified={refreshProfile} />
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

export function BadgeSectionRoute() {
  const { profile } = useAuth();
  const callsign = profile?.call_sign ?? '';
  return (
    <section className="flex flex-col gap-4">
      <SectionIntro>
        A live snapshot of your best scores. Drop the snippet into your QRZ bio,
        a blog, or a club page — it refreshes itself every time you set a new
        best.
      </SectionIntro>
      <Card>
        <CardContent>
          <BadgeSection callsign={callsign} />
        </CardContent>
      </Card>
    </section>
  );
}

const PROVIDER_DISPLAY: Record<
  string,
  { label: string; icon: ComponentType<{ className?: string }> }
> = {
  github: { label: 'GitHub', icon: GithubIcon },
  google: { label: 'Google', icon: GoogleIcon },
  discord: { label: 'Discord', icon: DiscordIcon },
};

export function SessionSection() {
  const { user, signOut } = useAuth();
  const email = user?.email ?? null;
  const providerId =
    (user?.app_metadata?.provider as string | undefined) ?? null;
  const provider = providerId ? PROVIDER_DISPLAY[providerId] : null;

  return (
    <section className="flex flex-col gap-4">
      <SectionIntro>
        The account that owns this callsign. Signing out keeps your bests on the
        leaderboard — they're tied to the callsign, not the session.
      </SectionIntro>
      <Card>
        <CardContent className="flex flex-col gap-0">
          <KeyValueRow label="Signed in as">
            <span>{email ?? '—'}</span>
          </KeyValueRow>
          {provider && (
            <KeyValueRow label="Provider">
              <span className="inline-flex items-center gap-1.5">
                <provider.icon className="size-4" />
                {provider.label}
              </span>
            </KeyValueRow>
          )}
          <KeyValueRow label="Session">
            <Button variant="outline" size="sm" onClick={signOut}>
              <LogOut className="size-4" />
              Sign out
            </Button>
          </KeyValueRow>
        </CardContent>
      </Card>
    </section>
  );
}

function SignedOutView({
  onSignIn,
}: {
  onSignIn: (p: AuthProvider) => Promise<void>;
}) {
  const [pending, setPending] = useState<AuthProvider | null>(null);
  const online = useOnline();
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex flex-wrap items-center justify-center gap-3">
        {PROVIDERS.map(({ id, label, icon: Icon, comingSoon }) => (
          <Button
            key={id}
            // `secondary` reads better than `outline` against the page bg
            // in light mode (outline buttons sat ~the same lightness as
            // the background and faded into it).
            variant="secondary"
            size="lg"
            onClick={async () => {
              setPending(id);
              await onSignIn(id);
              // Leave `pending` set so all buttons stay disabled while the
              // OAuth redirect is in flight.
            }}
            // Disable while another provider is in-flight, when offline
            // (OAuth needs the network round-trip), OR when the provider
            // isn't configured on our side yet.
            disabled={pending !== null || !online || comingSoon}
            className="w-full justify-center sm:w-auto"
          >
            {pending === id ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Icon className="size-4" />
            )}
            {label}
            {comingSoon && (
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                (soon)
              </span>
            )}
          </Button>
        ))}
      </div>
      {!online && (
        <p
          role="status"
          className="inline-flex items-center gap-2 text-xs text-muted-foreground"
        >
          <WifiOff className="size-3.5" aria-hidden />
          Sign-in needs an internet connection.
        </p>
      )}
    </div>
  );
}

function ClaimView({
  onClaim,
  onSignOut,
}: {
  onClaim: (
    raw: string
  ) => Promise<
    { ok: true } | { ok: false; reason: 'taken' | 'invalid' | 'error' }
  >;
  onSignOut: () => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    const result = await onClaim(value);
    setPending(false);
    if (result.ok) {
      toast.success('Callsign claimed.');
      return;
    }
    if (result.reason === 'invalid') {
      setError("That doesn't look like a callsign.");
    } else if (result.reason === 'taken') {
      setError("That callsign's already claimed.");
    } else {
      toast.error('Something went wrong. Try again?');
    }
  }

  return (
    <div className="max-w-md">
      <Card>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="callsign">Callsign</Label>
              <Input
                id="callsign"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value.toUpperCase());
                  if (error) setError(null);
                }}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                maxLength={10}
                placeholder="Your callsign"
                className="font-mono uppercase tracking-wider"
                aria-invalid={error != null}
                aria-describedby={error ? 'callsign-error' : undefined}
              />
              {error && (
                <p
                  id="callsign-error"
                  className="text-sm text-destructive"
                  role="alert"
                >
                  {error}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" disabled={pending || value.length === 0}>
                {pending && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                Claim
              </Button>
              <Button type="button" variant="ghost" onClick={onSignOut}>
                <LogOut className="size-4" />
                Sign out
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

type MintResponse = { token: string; expiresAt: string; callSign: string };

type VerifyState =
  | 'verified'
  | 'present-now-remove'
  | 'still-present'
  | 'not-checked-yet'
  | 'token-not-found'
  | 'no-pending-token'
  | 'expired'
  | 'callsign-changed'
  | 'qrz-fetch-failed'
  | 'present-stamp-failed'
  | 'verified-write-failed'
  | 'verification-read-failed';

type VerifyResponse = { state: VerifyState; token?: string };

const STATE_COPY: Record<VerifyState, string> = {
  verified: 'Callsign verified.',
  'present-now-remove': '',
  'still-present':
    "The token's still on your QRZ page. Remove it from your bio, save, then click Confirm.",
  'not-checked-yet': 'Click Check first so we can confirm the token is there.',
  'token-not-found':
    "We couldn't find the token on your QRZ page. Did you paste it into your bio and save?",
  'no-pending-token':
    'No pending token. Click "Get token" to start, paste it into your QRZ bio, then check.',
  expired: 'That token expired. Get a new one and try again.',
  'callsign-changed':
    'Your callsign changed since you got that token. Get a new one for your current callsign.',
  'qrz-fetch-failed':
    "We couldn't reach qrz.com right now. Try again in a moment.",
  'present-stamp-failed': "Something didn't line up. Try again?",
  'verified-write-failed': "Something didn't line up. Try again?",
  'verification-read-failed': "Something didn't line up. Try again?",
};

type Phase = 'idle' | 'token-shown' | 'needs-removal';

function VerifySection({
  callsign,
  onVerified,
}: {
  callsign: string;
  onVerified: () => Promise<void>;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [minting, setMinting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleMint() {
    if (!supabase || minting) return;
    setMinting(true);
    setError(null);
    try {
      const { data, error: invokeErr } =
        await supabase.functions.invoke<MintResponse>('qrz-verify', {
          body: { action: 'mint' },
        });
      if (invokeErr || !data?.token) {
        setError("Couldn't generate a token. Try again?");
        return;
      }
      setToken(data.token);
      setPhase('token-shown');
    } finally {
      setMinting(false);
    }
  }

  async function handleCheck() {
    if (!supabase || checking) return;
    setChecking(true);
    setError(null);
    try {
      const { data, error: invokeErr } =
        await supabase.functions.invoke<VerifyResponse>('qrz-verify', {
          body: { action: 'check' },
        });
      if (invokeErr || !data) {
        setError("Couldn't reach the verifier. Try again?");
        return;
      }
      if (data.state === 'present-now-remove') {
        setPhase('needs-removal');
        return;
      }
      setError(STATE_COPY[data.state]);
    } finally {
      setChecking(false);
    }
  }

  async function handleConfirm() {
    if (!supabase || confirming) return;
    setConfirming(true);
    setError(null);
    try {
      const { data, error: invokeErr } =
        await supabase.functions.invoke<VerifyResponse>('qrz-verify', {
          body: { action: 'confirm-removed' },
        });
      if (invokeErr || !data) {
        setError("Couldn't reach the verifier. Try again?");
        return;
      }
      if (data.state === 'verified') {
        toast.success('Callsign verified.');
        await onRefreshProfileSafely(onVerified);
        return;
      }
      setError(STATE_COPY[data.state]);
    } finally {
      setConfirming(false);
    }
  }

  async function handleCopy() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      toast.success('Token copied.');
    } catch {
      toast.error("Couldn't copy. Select and copy it manually.");
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/30 p-3">
      <div>
        <p className="text-sm font-medium text-foreground">
          Verify your callsign
        </p>
        <p className="text-xs text-muted-foreground">
          We mint a token, you paste it into your{' '}
          <span className="font-mono">{callsign}</span> QRZ bio and save. We
          confirm it's there, then ask you to remove it. Once it's gone, you're
          verified — your bio stays clean.
        </p>
      </div>

      {phase === 'idle' && (
        <Button
          type="button"
          variant="outline"
          onClick={handleMint}
          disabled={minting}
          className="self-start"
        >
          {minting && (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          )}
          Get token
        </Button>
      )}

      {phase !== 'idle' && token && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="verify-token" className="text-xs">
            Your token
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="verify-token"
              value={token}
              readOnly
              className="font-mono text-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleCopy}
              aria-label="Copy token"
            >
              <Copy className="size-4" aria-hidden="true" />
            </Button>
          </div>
          {phase === 'token-shown' && (
            <p className="text-xs text-muted-foreground">
              Paste it anywhere in your QRZ bio, save the bio, then click Check.
            </p>
          )}
          {phase === 'needs-removal' && (
            <p className="text-xs text-foreground">
              Found it. Now <strong>remove the token</strong> from your QRZ bio,
              save the bio, then click Confirm.
            </p>
          )}
        </div>
      )}

      {phase === 'token-shown' && (
        <Button
          type="button"
          onClick={handleCheck}
          disabled={checking}
          className="self-start"
        >
          {checking && (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          )}
          Check
        </Button>
      )}

      {phase === 'needs-removal' && (
        <Button
          type="button"
          onClick={handleConfirm}
          disabled={confirming}
          className="self-start"
        >
          {confirming && (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          )}
          Confirm removed
        </Button>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// Until a public /u/CALL operator page exists, the snippet link points at the
// site root via VITE_SITE_URL. Falls back to morse-ml.netlify.app so the badge
// preview still works in a bare local dev with no env file.
const BADGE_LINK_ORIGIN = SITE_URL || 'https://morse-ml.netlify.app';

function badgeUrlFor(callsign: string): string {
  return `${BADGE_LINK_ORIGIN}/badge/${encodeURIComponent(callsign)}.svg`;
}

function badgeSnippetFor(callsign: string, url: string): string {
  return `<a href="${BADGE_LINK_ORIGIN}" target="_blank" rel="noopener noreferrer"><img src="${url}" alt="${callsign} on MORSE" /></a>`;
}

function BadgeSection({ callsign }: { callsign: string }) {
  const url = badgeUrlFor(callsign);
  const snippet = badgeSnippetFor(callsign, url);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(snippet);
      toast.success('Snippet copied.');
    } catch {
      toast.error("Couldn't copy. Select and copy it manually.");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <img
        src={url}
        alt={`${callsign} on MORSE`}
        width={340}
        height={88}
        className="h-auto w-full max-w-[340px]"
      />
      <div className="flex flex-col gap-2">
        <Label htmlFor="badge-snippet" className="text-xs">
          Snippet
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="badge-snippet"
            value={snippet}
            readOnly
            className="min-w-0 flex-1 font-mono text-base sm:text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleCopy}
            aria-label="Copy badge snippet"
          >
            <Copy className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}

async function onRefreshProfileSafely(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error('[account] refresh profile failed', err);
  }
}
