// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { CircleUser, Loader2, LogOut, Shield, ShieldCheck } from 'lucide-react';
import type { ComponentType } from 'react';
import { useState } from 'react';
import { toast } from 'sonner';
import { GithubIcon } from '@/components/github';
import PageHeader from '@/components/page-header';
import { DiscordIcon, GoogleIcon } from '@/components/provider-icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type AuthProvider, useAuth } from '@/lib/auth';
import { isAuthConfigured } from '@/lib/supabase';
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

  const { status, user, profile, signIn, signOut, claimCallsign } = useAuth();

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
}: {
  callsign: string;
  verified: boolean;
  email: string | null;
  onSignOut: () => Promise<void>;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="font-mono text-2xl font-bold tracking-wider text-foreground">
            {callsign}
          </span>
          {verified ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-primary">
              <ShieldCheck className="size-4" aria-hidden="true" />
              Verified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Shield className="size-4" aria-hidden="true" />
              Not yet verified
            </span>
          )}
        </div>
        {!verified && (
          <p className="text-xs text-muted-foreground">
            Verification coming soon.
          </p>
        )}
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
