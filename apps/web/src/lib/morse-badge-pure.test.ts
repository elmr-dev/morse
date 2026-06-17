// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Pure-function unit tests for the morse-badge Edge Function. The handler
// lives under apps/web/supabase/functions/ (Deno) and is excluded from the
// web app's tsc/biome/knip, but the SVG builder is dependency-free so we
// reach across into it from vitest.

import { describe, expect, it } from 'vitest';
import {
  escapeXml,
  glyphSvg,
  pickHighestTier,
  renderBadgeSvg,
  renderEmptyBadgeSvg,
} from '../../supabase/functions/morse-badge/pure';

describe('escapeXml', () => {
  it('escapes the five XML special characters', () => {
    expect(escapeXml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&apos;');
  });
});

describe('pickHighestTier', () => {
  it('picks extra over general/technician/no-code', () => {
    const rows = [
      { tier: 'no-code' as const, best_copy_pct: 99, bot_copy_pct_at_best: 50 },
      { tier: 'general' as const, best_copy_pct: 70, bot_copy_pct_at_best: 80 },
      { tier: 'extra' as const, best_copy_pct: 40, bot_copy_pct_at_best: 90 },
    ];
    expect(pickHighestTier(rows)?.tier).toBe('extra');
  });

  it('returns null on empty input', () => {
    expect(pickHighestTier([])).toBeNull();
  });

  it('picks technician over no-code when those are the only rows', () => {
    const rows = [
      { tier: 'no-code' as const, best_copy_pct: 95, bot_copy_pct_at_best: 50 },
      {
        tier: 'technician' as const,
        best_copy_pct: 60,
        bot_copy_pct_at_best: 70,
      },
    ];
    expect(pickHighestTier(rows)?.tier).toBe('technician');
  });
});

describe('glyphSvg', () => {
  it('returns the three lamp rects scaled and translated', () => {
    const out = glyphSvg(10, 20, 22);
    expect(out).toContain('transform="translate(10,20)');
    // Three rects, two purple + one pink.
    expect(out.match(/<rect /g)?.length).toBe(3);
    expect(out).toContain('#A48FFF');
    expect(out).toContain('#FF79C6');
  });

  it('omits the panel rect by default and includes it when asked', () => {
    expect(glyphSvg(0, 0, 22)).not.toContain('width="512"');
    const withPanel = glyphSvg(0, 0, 22, { includePanel: true });
    expect(withPanel).toContain('width="512"');
  });
});

describe('renderBadgeSvg', () => {
  const base = {
    callSign: 'W4GIT',
    tier: 'general' as const,
    tierName: 'General',
    youCopyPct: 60,
    botCopyPct: 80,
    verified: true,
  };

  it('includes the callsign, tier name, and percentages', () => {
    const svg = renderBadgeSvg(base);
    expect(svg).toContain('W4GIT');
    expect(svg).toContain('General');
    expect(svg).toContain('60%');
    expect(svg).toContain('80%');
    expect(svg).toContain('MORSE');
  });

  it('includes the shield path when verified, omits it when not', () => {
    const verified = renderBadgeSvg(base);
    const unverified = renderBadgeSvg({ ...base, verified: false });
    // The shield path starts with "M12 2" — a distinctive marker.
    expect(verified).toContain('M12 2');
    expect(unverified).not.toContain('M12 2');
  });

  it('escapes XML-special characters in the callsign', () => {
    const svg = renderBadgeSvg({ ...base, callSign: 'W&<G' });
    expect(svg).toContain('W&amp;&lt;G');
    expect(svg).not.toMatch(/W&<G/);
  });

  it('rounds and clamps percentages to 0–100', () => {
    const svg = renderBadgeSvg({
      ...base,
      youCopyPct: 59.6,
      botCopyPct: 150,
    });
    expect(svg).toContain('60%');
    expect(svg).toContain('100%');
    const low = renderBadgeSvg({ ...base, youCopyPct: -5, botCopyPct: 0.4 });
    expect(low).toContain('0%');
  });

  it('exposes an accessible <title> for screen readers', () => {
    const svg = renderBadgeSvg(base);
    expect(svg).toMatch(
      /<title>W4GIT — MORSE: General, You 60% \/ Bot 80%<\/title>/
    );
  });

  it('uses the tier accent color in the pill', () => {
    const extra = renderBadgeSvg({
      ...base,
      tier: 'extra',
      tierName: 'Extra',
    });
    // Pink accent for Extra.
    expect(extra).toContain('#F46FB0');
  });
});

describe('renderEmptyBadgeSvg', () => {
  it('renders a valid SVG with the message escaped', () => {
    const svg = renderEmptyBadgeSvg('K1XYZ — no standing yet');
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('K1XYZ — no standing yet');
    expect(svg).toContain('MORSE');
  });
});
