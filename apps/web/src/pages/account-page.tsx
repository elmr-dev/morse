// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CircleUser,
  Copy,
  Loader2,
  LogOut,
  Shield,
  ShieldCheck,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { GithubIcon } from '@/components/github';
import PageHeader from '@/components/page-header';
import { DiscordIcon, GoogleIcon } from '@/components/provider-icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { type AuthProvider, useAuth } from '@/lib/auth';
import { SITE_URL } from '@/lib/site';
import { isAuthConfigured, supabase } from '@/lib/supabase';
import { useDocumentHead } from '@/lib/use-document-head';

interface ProviderEntry {
  id: AuthProvider;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const PROVIDERS: readonly ProviderEntry[] = [
  { id: 'google', label: 'Continue with Google', icon: GoogleIcon },
  { id: 'github', label: 'Continue with GitHub', icon: GithubIcon },
  { id: 'discord', label: 'Continue with Discord', icon: DiscordIcon },
] as const;

export default function AccountPage() {
  useDocumentHead({
    title: 'Account',
    description:
      'Optional sign-in to claim a callsign and publish your Beat the Bot bests.',
    path: '/account',
  });

  const {
    status,
    user,
    profile,
    signIn,
    signOut,
    claimCallsign,
    refreshProfile,
  } = useAuth();

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
      <Shell>
        <SignedOutView onSignIn={signIn} />
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
      <ReadyView
        callsign={profile?.call_sign ?? ''}
        verified={profile?.verified ?? false}
        email={user?.email ?? null}
        onSignOut={signOut}
        onRefreshProfile={refreshProfile}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader eyebrow="Account" icon={CircleUser} title="Your account">
        Playing is anonymous and needs no account. Sign in only to claim your
        callsign and put your bests on the leaderboard.
      </PageHeader>
      <div className="max-w-md">{children}</div>
    </>
  );
}

function SignedOutView({
  onSignIn,
}: {
  onSignIn: (p: AuthProvider) => Promise<void>;
}) {
  const [pending, setPending] = useState<AuthProvider | null>(null);
  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        {PROVIDERS.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            variant="outline"
            onClick={async () => {
              setPending(id);
              try {
                await onSignIn(id);
              } finally {
                setPending(null);
              }
            }}
            disabled={pending !== null}
            className="justify-start"
          >
            {pending === id ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Icon className="size-4" />
            )}
            {label}
          </Button>
        ))}
      </CardContent>
    </Card>
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
  );
}

function ReadyView({
  callsign,
  verified,
  email,
  onSignOut,
  onRefreshProfile,
}: {
  callsign: string;
  verified: boolean;
  email: string | null;
  onSignOut: () => Promise<void>;
  onRefreshProfile: () => Promise<void>;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
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
                className={`inline-flex items-center gap-1.5 text-sm rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                  verified ? 'text-verified' : 'text-muted-foreground'
                }`}
              >
                {verified ? (
                  <>
                    <ShieldCheck className="size-4" aria-hidden="true" />
                    Verified
                  </>
                ) : (
                  <>
                    <Shield className="size-4" aria-hidden="true" />
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
        {!verified && (
          <VerifySection callsign={callsign} onVerified={onRefreshProfile} />
        )}
        <BadgeSection callsign={callsign} />
        {email && (
          <p className="text-sm text-muted-foreground">
            Signed in as <span className="text-foreground">{email}</span>
          </p>
        )}
        <div>
          <Button variant="ghost" onClick={onSignOut}>
            <LogOut className="size-4" />
            Sign out
          </Button>
        </div>
      </CardContent>
    </Card>
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
    <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/30 p-3">
      <div>
        <p className="text-sm font-medium text-foreground">Your MORSE badge</p>
        <p className="text-xs text-muted-foreground">
          Paste this anywhere on the web — your QRZ bio, a blog, a club page —
          to show your MORSE standing. It updates automatically as you set new
          bests.
        </p>
      </div>
      <img src={url} alt={`${callsign} on MORSE`} width={340} height={88} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="badge-snippet" className="text-xs">
          Snippet
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="badge-snippet"
            value={snippet}
            readOnly
            className="font-mono text-xs"
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
