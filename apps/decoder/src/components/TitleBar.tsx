// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { getCurrentWindow } from '@tauri-apps/api/window';
import logoUrl from '@morse/brand/web/logo.svg';
import { Monitor, Moon, Sun } from 'lucide-react';
import React from 'react';
import type { ThemeOverride } from '../app';

interface TitleBarProps {
  themeOverride: ThemeOverride;
  onThemeChange: (t: ThemeOverride) => void;
}

const CYCLE: ThemeOverride[] = ['system', 'light', 'dark'];

const THEME_META: Record<ThemeOverride, { icon: React.ReactNode; label: string; next: ThemeOverride }> = {
  system: { icon: <Monitor size={14} strokeWidth={1.75} />, label: 'System theme — click for Light', next: 'light' },
  light:  { icon: <Sun     size={14} strokeWidth={1.75} />, label: 'Light theme — click for Dark',   next: 'dark'   },
  dark:   { icon: <Moon    size={14} strokeWidth={1.75} />, label: 'Dark theme — click for System',  next: 'system' },
};
void CYCLE; // referenced by THEME_META; silence unused-var lint

function handleBarMouseDown(e: React.MouseEvent<HTMLDivElement>) {
  if (e.button !== 0) return;
  const target = e.target as HTMLElement;
  if (target.closest('button, a, input, select')) return;
  getCurrentWindow().startDragging().catch((err: unknown) => {
    console.error('[TitleBar] startDragging failed:', err);
  });
}

export function TitleBar({ themeOverride, onThemeChange }: TitleBarProps) {
  const { icon, label, next } = THEME_META[themeOverride];

  return (
    <div
      data-tauri-drag-region
      onMouseDown={handleBarMouseDown}
      style={{
        height: '38px',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        padding: '0 13px',
        // Leave room for macOS native traffic lights (~68px inset).
        paddingLeft: '80px',
        borderBottom: 'none',
        background: 'var(--card)',
        position: 'relative',
        userSelect: 'none',
      }}
    >
      {/* Logo + wordmark — centered: [icon] MORSE DECODER */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          pointerEvents: 'none',
        }}
      >
        <img
          src={logoUrl}
          alt=""
          height="15"
          style={{ height: '15px', width: 'auto', display: 'block' }}
        />
        <span
          style={{
            marginLeft: '10px',
            fontFamily: 'var(--font-sans)',
            fontSize: '13px',
            fontWeight: 600,
            letterSpacing: '0.06em',
            color: 'var(--foreground)',
          }}
        >
          MORSE
        </span>
        <span
          style={{
            marginLeft: '7px',
            fontFamily: 'var(--font-sans)',
            fontSize: '11px',
            fontWeight: 400,
            letterSpacing: '0.06em',
            color: 'var(--muted-foreground)',
          }}
        >
          DECODER
        </span>
      </div>

      {/* Theme toggle — pinned right; cycles System → Light → Dark → System */}
      <button
        type="button"
        onClick={() => onThemeChange(next)}
        aria-label={label}
        title={label}
        style={{
          marginLeft: 'auto',
          pointerEvents: 'auto',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '4px',
          borderRadius: '6px',
          lineHeight: 1,
          color: 'var(--muted-foreground)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background =
            'color-mix(in oklch, var(--foreground) 10%, transparent)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        }}
      >
        {icon}
      </button>
    </div>
  );
}
