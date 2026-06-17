// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Slice 7: dynamic SVG badge for QRZ profiles.
//
// GET …/functions/v1/morse-badge?call=W4GIT → image/svg+xml
//
// Public — no auth, no token. Hit by <img> from QRZ pages and crawlers.
// Reads the public btb_leaderboard view (RLS-protected) with the anon key;
// service-role is intentionally not used (least privilege for a public
// endpoint that only reads).
//
// Env (auto-injected): SUPABASE_URL, SUPABASE_ANON_KEY.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.2';
import {
  pickHighestTier,
  renderBadgeSvg,
  renderEmptyBadgeSvg,
  TIER_NAMES,
  type BestsRow,
  type TierId,
} from './pure.ts';

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

const SVG_HEADERS: Record<string, string> = {
  'content-type': 'image/svg+xml; charset=utf-8',
  'cache-control': 'public, max-age=300',
  // Supabase's gateway defaults SVG responses to `attachment` (download).
  // Force inline so <img> on QRZ / any page renders the badge.
  'content-disposition': 'inline; filename="morse-badge.svg"',
  ...CORS_HEADERS,
};

function svgResponse(svg: string, status = 200): Response {
  return new Response(svg, { status, headers: SVG_HEADERS });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'GET') {
    return new Response('method-not-allowed', {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  const url = new URL(req.url);
  // Accept either ?call=W4GIT or a path-style /morse-badge/W4GIT(.svg).
  const callParam =
    url.searchParams.get('call') ??
    url.pathname.split('/').pop()?.replace(/\.svg$/i, '') ??
    '';
  const callSign = callParam.trim().toUpperCase();

  if (!callSign || !/^[A-Z0-9/]{3,10}$/.test(callSign)) {
    return svgResponse(renderEmptyBadgeSvg('no callsign'));
  }

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client
    .from('btb_leaderboard')
    .select('call_sign, verified, tier, best_copy_pct, bot_copy_pct_at_best')
    .ilike('call_sign', callSign);

  if (error) {
    return svgResponse(renderEmptyBadgeSvg('no standing yet'));
  }

  const rows = (data ?? []) as Array<{
    call_sign: string;
    verified: boolean;
    tier: TierId;
    best_copy_pct: number;
    bot_copy_pct_at_best: number;
  }>;

  if (rows.length === 0) {
    return svgResponse(renderEmptyBadgeSvg(`${callSign} — no standing yet`));
  }

  const bestsRows: Array<BestsRow & { verified: boolean; call_sign: string }> =
    rows.map((r) => ({
      tier: r.tier,
      best_copy_pct: r.best_copy_pct,
      bot_copy_pct_at_best: r.bot_copy_pct_at_best,
      verified: r.verified,
      call_sign: r.call_sign,
    }));
  const pick = pickHighestTier(bestsRows);
  if (!pick) {
    return svgResponse(renderEmptyBadgeSvg(`${callSign} — no standing yet`));
  }

  return svgResponse(
    renderBadgeSvg({
      callSign: pick.call_sign,
      tier: pick.tier,
      tierName: TIER_NAMES[pick.tier],
      youCopyPct: pick.best_copy_pct,
      botCopyPct: pick.bot_copy_pct_at_best,
      verified: pick.verified,
    })
  );
});
