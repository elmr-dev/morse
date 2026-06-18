// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Slice 6 Step 2: QRZ callsign verification.
//
// Two POST actions, both authed via the caller's `Authorization: Bearer <jwt>`:
//
//   { action: 'mint' }  → generate a fresh MORSE-VERIFY-<base32> token, upsert
//                          it into profile_verifications with a 24h expiry,
//                          return { token, expiresAt }.
//   { action: 'check' } → re-fetch the user's QRZ bio page, search the FULL
//                          body for their pending token. On match (and not
//                          expired) flip profiles.verified=true (service_role,
//                          the only role that can post-0004), delete the
//                          verification row, return { verified: true }. Else
//                          return { verified: false, reason }.
//
// Trust model: proof comes from the SERVER reading the token off the canonical
// QRZ page. A token submitted in the request body is never accepted as proof.
//
// Env (auto-injected by Supabase Edge Functions — DO NOT set as custom
// secrets; the SUPABASE_ prefix is reserved):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.2';
import {
  BROWSER_FETCH_HEADERS,
  expiryFromNow,
  generateToken,
  isExpired,
  qrzBioUrl,
  tokenInHtml,
} from './pure.ts';

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers':
    'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
    },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method-not-allowed' }, 405);
  }

  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return json({ error: 'missing-bearer' }, 401);
  }

  let body: { action?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid-json' }, 400);
  }
  const action = body?.action;
  if (
    action !== 'mint' &&
    action !== 'check' &&
    action !== 'confirm-removed'
  ) {
    return json({ error: 'invalid-action' }, 400);
  }

  // User-scoped client: forwards the caller's JWT so auth.getUser() and any
  // PostgREST read runs as that user.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) {
    return json({ error: 'unauthenticated' }, 401);
  }

  // Service-role client: bypasses RLS + column grants. The only role that can
  // write profiles.verified after migration 0004.
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Fetch the user's profile to learn their claimed callsign.
  const { data: profile, error: profileErr } = await adminClient
    .from('profiles')
    .select('id, call_sign, verified')
    .eq('id', user.id)
    .maybeSingle();
  if (profileErr) {
    return json({ error: 'profile-read-failed' }, 500);
  }
  if (!profile?.call_sign) {
    return json({ error: 'no-callsign' }, 400);
  }

  if (action === 'mint') {
    return await handleMint(adminClient, user.id, profile.call_sign);
  }
  if (action === 'check') {
    return await handleCheck(adminClient, user.id, profile.call_sign);
  }
  return await handleConfirmRemoved(adminClient, user.id, profile.call_sign);
});

type AdminClient = ReturnType<typeof createClient>;

async function handleMint(
  admin: AdminClient,
  userId: string,
  callSign: string
): Promise<Response> {
  const token = generateToken();
  const expiresAt = expiryFromNow();

  const { error } = await admin.from('profile_verifications').upsert(
    {
      user_id: userId,
      token,
      call_sign: callSign,
      expires_at: expiresAt.toISOString(),
      created_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );
  if (error) {
    return json({ error: 'mint-failed', detail: error.message }, 500);
  }
  return json({ token, expiresAt: expiresAt.toISOString(), callSign });
}

// Phase 1: confirm the token IS in the QRZ bio. Stamps present_at so the
// follow-up Confirm step knows we've already seen it.
async function handleCheck(
  admin: AdminClient,
  userId: string,
  callSign: string
): Promise<Response> {
  const guard = await loadPendingRow(admin, userId, callSign);
  if ('errorResponse' in guard) return guard.errorResponse;
  const { row } = guard;

  const fetched = await fetchQrz(callSign);
  if ('errorResponse' in fetched) return fetched.errorResponse;
  const { html } = fetched;

  if (!tokenInHtml(html, row.token)) {
    return json({ state: 'token-not-found' }, 200);
  }

  const { error: stampErr } = await admin
    .from('profile_verifications')
    .update({ present_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (stampErr) {
    return json({ state: 'present-stamp-failed' }, 500);
  }
  return json({ state: 'present-now-remove', token: row.token });
}

// Phase 2: the user says they've removed the token from their bio. Re-fetch,
// require it to be GONE, and only then mark verified.
async function handleConfirmRemoved(
  admin: AdminClient,
  userId: string,
  callSign: string
): Promise<Response> {
  const guard = await loadPendingRow(admin, userId, callSign);
  if ('errorResponse' in guard) return guard.errorResponse;
  const { row } = guard;

  if (!row.present_at) {
    // Caller skipped Check, or the row was re-minted between Check and Confirm.
    return json({ state: 'not-checked-yet' }, 200);
  }

  const fetched = await fetchQrz(callSign);
  if ('errorResponse' in fetched) return fetched.errorResponse;
  const { html } = fetched;

  if (tokenInHtml(html, row.token)) {
    return json({ state: 'still-present' }, 200);
  }

  const { error: updErr } = await admin
    .from('profiles')
    .update({ verified: true })
    .eq('id', userId);
  if (updErr) {
    return json({ state: 'verified-write-failed' }, 500);
  }
  await admin.from('profile_verifications').delete().eq('user_id', userId);
  return json({ state: 'verified' });
}

type PendingRow = {
  token: string;
  call_sign: string;
  expires_at: string;
  present_at: string | null;
};

async function loadPendingRow(
  admin: AdminClient,
  userId: string,
  callSign: string
): Promise<{ row: PendingRow } | { errorResponse: Response }> {
  const { data: row, error } = await admin
    .from('profile_verifications')
    .select('token, call_sign, expires_at, present_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    return { errorResponse: json({ state: 'verification-read-failed' }, 500) };
  }
  if (!row) {
    return { errorResponse: json({ state: 'no-pending-token' }, 200) };
  }
  if (row.call_sign !== callSign) {
    return { errorResponse: json({ state: 'callsign-changed' }, 200) };
  }
  if (isExpired(row.expires_at)) {
    return { errorResponse: json({ state: 'expired' }, 200) };
  }
  return { row: row as PendingRow };
}

async function fetchQrz(
  callSign: string
): Promise<{ html: string } | { errorResponse: Response }> {
  let upstream: Response;
  try {
    upstream = await fetch(qrzBioUrl(callSign), {
      headers: BROWSER_FETCH_HEADERS,
      redirect: 'follow',
    });
  } catch (err) {
    return {
      errorResponse: json(
        { state: 'qrz-fetch-failed', detail: String(err) },
        502
      ),
    };
  }
  if (!upstream.ok) {
    return {
      errorResponse: json(
        { state: 'qrz-fetch-failed', status: upstream.status },
        502
      ),
    };
  }
  return { html: await upstream.text() };
}
