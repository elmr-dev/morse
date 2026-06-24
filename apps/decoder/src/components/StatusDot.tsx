// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Semantic tone → CSS color variable. */
type DotTone = 'good' | 'dial' | 'destructive' | 'primary';

interface StatusDotProps {
  tone: DotTone;
  size?: number;
  pulse?: boolean;
}

const TONE_VAR: Record<DotTone, string> = {
  good: 'var(--success)',
  dial: 'var(--dial)',
  destructive: 'var(--destructive)',
  primary: 'var(--primary)',
};

export function StatusDot({ tone, size = 7, pulse = false }: StatusDotProps) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        flexShrink: 0,
        background: TONE_VAR[tone],
        boxShadow: `0 0 5px 1px color-mix(in oklch, ${TONE_VAR[tone]} 55%, transparent)`,
        animation: pulse ? 'status-pulse 2s ease-in-out infinite' : undefined,
      }}
    />
  );
}
