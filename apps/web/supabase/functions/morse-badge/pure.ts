// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Pure helpers for the morse-badge Edge Function. Dependency-free so the
// web project's vitest suite can import them directly (the Edge Function
// itself runs in Deno but the SVG builder is plain string manipulation).

export type TierId = 'no-code' | 'technician' | 'general' | 'extra';

// The in-app palette resolved to fixed hex. Server-side SVG can't read CSS
// vars and `oklch()` is unreliable inside QRZ's <img> sandbox, so we bake
// concrete hex here. Keep visually in sync with apps/web/src/index.css
// (dark-theme variants — the badge is always the dark MORSE panel).
export const BADGE_PALETTE = {
  panelBg: '#0F0F1A',
  glyphPurple: '#A48FFF',
  glyphPink: '#FF79C6',
  wordmark: '#FFFFFF',
  callsign: '#FFFFFF',
  shield: '#A48FFF',
  you: '#7FB2F2', // dark --you ~ oklch(0.72 0.15 252)
  bot: '#E0A87A', // dark --bot ~ oklch(0.80 0.18 40), muted-orange to match in-app
  muted: '#8A8AA0',
} as const;

export const TIER_ACCENTS: Record<TierId, string> = {
  'no-code': '#3FC9C2',
  technician: '#7FB2F2',
  general: '#A48FFF',
  extra: '#F46FB0',
};

export const TIER_NAMES: Record<TierId, string> = {
  'no-code': 'No-Code',
  technician: 'Technician',
  general: 'General',
  extra: 'Extra',
};

// Difficulty ordering — mirrors the leaderboard's tier_rank.
const TIER_RANK: Record<TierId, number> = {
  'no-code': 0,
  technician: 1,
  general: 2,
  extra: 3,
};

export interface BestsRow {
  tier: TierId;
  best_copy_pct: number;
  bot_copy_pct_at_best: number;
}

/**
 * Pick the operator's HIGHEST tier reached (extra > general > technician >
 * no-code). The badge headlines tier identity, not raw copy %. Returns null
 * if no rows.
 */
export function pickHighestTier<T extends { tier: TierId }>(
  rows: readonly T[]
): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (!best || TIER_RANK[r.tier] > TIER_RANK[best.tier]) best = r;
  }
  return best;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n);
  if (r < 0) return 0;
  if (r > 100) return 100;
  return r;
}

/**
 * The favicon glyph as inline SVG primitives. `<image href>` to an external
 * URL is blocked by QRZ's sandboxed <img> renderer; primitives always work.
 * Four rects from public/favicon.svg (viewBox 0 0 512 512), positioned and
 * scaled by the caller via a wrapping <g transform>.
 */
export function glyphSvg(
  x: number,
  y: number,
  sizePx: number,
  opts: { includePanel?: boolean } = {}
): string {
  const scale = sizePx / 512;
  const panel = opts.includePanel
    ? `<rect width="512" height="512" rx="92" fill="${BADGE_PALETTE.panelBg}"/>`
    : '';
  return (
    `<g transform="translate(${x},${y}) scale(${scale})">` +
    panel +
    `<rect x="106" y="79" width="300" height="150" rx="75" fill="${BADGE_PALETTE.glyphPurple}"/>` +
    `<rect x="79" y="283" width="150" height="150" rx="75" fill="${BADGE_PALETTE.glyphPurple}"/>` +
    `<rect x="283" y="283" width="150" height="150" rx="75" fill="${BADGE_PALETTE.glyphPink}"/>` +
    `</g>`
  );
}

/**
 * A small shield-with-check silhouette in MORSE purple. Lucide ShieldCheck
 * is a React component, so we hand-draw a comparable path. Sized to ~14px;
 * caller positions via translate.
 */
function shieldCheckSvg(x: number, y: number, sizePx: number): string {
  const scale = sizePx / 24;
  return (
    `<g transform="translate(${x},${y}) scale(${scale})" fill="none" ` +
    `stroke="${BADGE_PALETTE.shield}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M12 2 L20 5 V11 C20 16 16.5 20.5 12 22 C7.5 20.5 4 16 4 11 V5 Z"/>` +
    `<path d="M9 12 L11 14 L15.5 9.5"/>` +
    `</g>`
  );
}

export interface BadgeData {
  callSign: string;
  tier: TierId;
  tierName: string;
  youCopyPct: number;
  botCopyPct: number;
  verified: boolean;
}

/**
 * Build the full SVG document for an operator's badge. Pure: no Deno or
 * network APIs, so vitest can exercise it directly.
 */
export function renderBadgeSvg(data: BadgeData): string {
  const call = escapeXml(data.callSign);
  const you = clampPct(data.youCopyPct);
  const bot = clampPct(data.botCopyPct);
  const accent = TIER_ACCENTS[data.tier];
  const title = escapeXml(
    `${data.callSign} — MORSE: ${data.tierName}, You ${you}% / Bot ${bot}%`
  );

  // Layout (viewBox 340×88). Three columns separated by vertical dividers,
  // with a thick purple left strip (square left corners) and a light purple
  // outline around the whole panel. The outer corner radius is r=10; the
  // left strip overlays the left side from x=0 to x=STRIP_W to flatten the
  // top-left + bottom-left corners.
  const W = 340;
  const H = 88;
  const STRIP_W = 6;
  const PANEL_RX = 10;

  // Outer panel: dark fill + thin light-purple stroke. Path (not <rect>) so
  // the LEFT corners are square (to match the flat strip) while the right
  // corners stay rounded.
  const panelPath =
    `M0.5 0.5 ` +
    `H${W - 0.5 - PANEL_RX} ` +
    `Q${W - 0.5} 0.5 ${W - 0.5} ${0.5 + PANEL_RX} ` +
    `V${H - 0.5 - PANEL_RX} ` +
    `Q${W - 0.5} ${H - 0.5} ${W - 0.5 - PANEL_RX} ${H - 0.5} ` +
    `H0.5 Z`;
  const panel =
    `<path d="${panelPath}" ` +
    `fill="${BADGE_PALETTE.panelBg}" stroke="${BADGE_PALETTE.glyphPurple}" stroke-width="1"/>`;

  // Left accent strip — flat (no rounded corners on the visible left edge).
  const strip = `<rect x="0" y="0" width="${STRIP_W}" height="${H}" fill="${BADGE_PALETTE.glyphPurple}"/>`;

  // Column 1: large glyph, vertically centered. ~52px square.
  const glyphSize = 52;
  const glyph = glyphSvg(STRIP_W + 14, (H - glyphSize) / 2, glyphSize);

  // Vertical divider 1 — between glyph and the text column.
  const div1X = STRIP_W + 14 + glyphSize + 14; // ~86
  const divider1 =
    `<line x1="${div1X}" y1="14" x2="${div1X}" y2="${H - 14}" ` +
    `stroke="${BADGE_PALETTE.glyphPurple}" stroke-opacity="0.25" stroke-width="1"/>`;

  // Column 2: MORSE wordmark, callsign (with optional shield), tier pill.
  const col2X = div1X + 14;
  const wordmark =
    `<text x="${col2X}" y="26" font-family="'JetBrains Mono', ui-monospace, monospace" ` +
    `font-size="11" font-weight="700" fill="${BADGE_PALETTE.muted}" letter-spacing="2">MORSE</text>`;
  const callsignText =
    `<text x="${col2X}" y="52" font-family="'JetBrains Mono', ui-monospace, monospace" ` +
    `font-size="22" font-weight="700" fill="${BADGE_PALETTE.callsign}">${call}</text>`;
  const shieldX = col2X + data.callSign.length * 14 + 4;
  const shield = data.verified ? shieldCheckSvg(shieldX, 36, 16) : '';

  const pillY = 62;
  const pillH = 16;
  const pillTextWidth = Math.max(40, data.tierName.length * 7 + 14);
  const pill =
    `<g>` +
    `<rect x="${col2X}" y="${pillY}" width="${pillTextWidth}" height="${pillH}" rx="8" ` +
    `fill="${accent}" fill-opacity="0.15" stroke="${accent}" stroke-width="1"/>` +
    `<text x="${col2X + pillTextWidth / 2}" y="${pillY + 12}" text-anchor="middle" ` +
    `font-family="'JetBrains Mono', ui-monospace, monospace" font-size="10" font-weight="600" ` +
    `fill="${accent}">${escapeXml(data.tierName)}</text>` +
    `</g>`;

  // Vertical divider 2 — between text column and the stats column.
  const div2X = W - 110;
  const divider2 =
    `<line x1="${div2X}" y1="14" x2="${div2X}" y2="${H - 14}" ` +
    `stroke="${BADGE_PALETTE.glyphPurple}" stroke-opacity="0.25" stroke-width="1"/>`;

  // Column 3: YOU / BOT — labels on the left, big numbers right-aligned.
  const labelX = div2X + 14;
  const numberX = W - 14;
  const youRowY = 38;
  const botRowY = 66;
  const youStat =
    `<g>` +
    `<text x="${labelX}" y="${youRowY}" font-family="'JetBrains Mono', ui-monospace, monospace" ` +
    `font-size="11" font-weight="600" fill="${BADGE_PALETTE.muted}">YOU</text>` +
    `<text x="${numberX}" y="${youRowY}" text-anchor="end" ` +
    `font-family="'JetBrains Mono', ui-monospace, monospace" font-size="20" font-weight="700" ` +
    `fill="${BADGE_PALETTE.you}">${you}%</text>` +
    `</g>`;
  const botStat =
    `<g>` +
    `<text x="${labelX}" y="${botRowY}" font-family="'JetBrains Mono', ui-monospace, monospace" ` +
    `font-size="11" font-weight="600" fill="${BADGE_PALETTE.muted}">BOT</text>` +
    `<text x="${numberX}" y="${botRowY}" text-anchor="end" ` +
    `font-family="'JetBrains Mono', ui-monospace, monospace" font-size="20" font-weight="700" ` +
    `fill="${BADGE_PALETTE.bot}">${bot}%</text>` +
    `</g>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">` +
    `<title>${title}</title>` +
    panel +
    strip +
    glyph +
    divider1 +
    wordmark +
    callsignText +
    shield +
    pill +
    divider2 +
    youStat +
    botStat +
    `</svg>`
  );
}

/**
 * Fallback badge for unknown callsigns / no standing yet. Same panel and
 * glyph so a broken `<img>` never appears on a QRZ page.
 */
export function renderEmptyBadgeSvg(message: string): string {
  const W = 340;
  const H = 88;
  const STRIP_W = 6;
  const safeMsg = escapeXml(message);
  const glyphSize = 52;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">` +
    `<title>MORSE — ${safeMsg}</title>` +
    `<path d="M0.5 0.5 H${W - 10.5} Q${W - 0.5} 0.5 ${W - 0.5} 10.5 V${H - 10.5} Q${W - 0.5} ${H - 0.5} ${W - 10.5} ${H - 0.5} H0.5 Z" ` +
    `fill="${BADGE_PALETTE.panelBg}" stroke="${BADGE_PALETTE.glyphPurple}" stroke-width="1"/>` +
    `<rect x="0" y="0" width="${STRIP_W}" height="${H}" fill="${BADGE_PALETTE.glyphPurple}"/>` +
    glyphSvg(STRIP_W + 14, (H - glyphSize) / 2, glyphSize) +
    `<text x="${STRIP_W + 14 + glyphSize + 28}" y="34" font-family="'JetBrains Mono', ui-monospace, monospace" ` +
    `font-size="11" font-weight="700" fill="${BADGE_PALETTE.muted}" letter-spacing="2">MORSE</text>` +
    `<text x="${STRIP_W + 14 + glyphSize + 28}" y="56" font-family="'JetBrains Mono', ui-monospace, monospace" ` +
    `font-size="12" fill="${BADGE_PALETTE.muted}">${safeMsg}</text>` +
    `</svg>`
  );
}
