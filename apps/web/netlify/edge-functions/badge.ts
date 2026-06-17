// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Netlify Edge Function: proxy the morse-badge Supabase function under the
// app's own domain. Supabase's *.supabase.co gateway force-adds
// `Content-Disposition: attachment` + a `default-src 'none'; sandbox` CSP to
// every Edge Function response — by design, to prevent `*.supabase.co` from
// being abused as a content host. Those headers stop browsers from rendering
// the SVG inside an <img>. This proxy fetches the upstream SVG and serves it
// from morse.radio with inline + image-friendly headers.
//
// Path: /badge/:call.svg  →  rewrites here via _redirects.

const SUPABASE_FN_URL =
  // deno-lint-ignore no-explicit-any
  ((globalThis as any).Deno?.env?.get?.('MORSE_BADGE_UPSTREAM_URL') as
    | string
    | undefined) ??
  'https://qhmtjowsknqjkoieqxqk.supabase.co/functions/v1/morse-badge';

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // Accept either /badge/W4GIT.svg or ?call=W4GIT (the redirect captures
  // :call and re-passes it as a query param).
  const fromQuery = url.searchParams.get('call');
  const fromPath = url.pathname
    .replace(/^.*\/badge\//, '')
    .replace(/\.svg$/i, '');
  const call = (fromQuery || fromPath).trim().toUpperCase();

  const upstream = new URL(SUPABASE_FN_URL);
  if (call) upstream.searchParams.set('call', call);

  const res = await fetch(upstream.toString(), {
    method: 'GET',
    headers: { accept: 'image/svg+xml' },
  });
  const body = await res.text();

  return new Response(body, {
    status: res.status,
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'content-disposition': 'inline',
      'access-control-allow-origin': '*',
    },
  });
}

export const config = {
  path: '/badge/*',
};
