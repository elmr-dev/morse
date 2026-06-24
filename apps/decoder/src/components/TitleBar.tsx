// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import logoUrl from '@morse/brand/web/logo.svg';

interface TitleBarProps {
  dark: boolean;
  onThemeToggle: () => void;
}

export function TitleBar({ dark, onThemeToggle }: TitleBarProps) {
  return (
    <div
      data-tauri-drag-region
      style={{
        height: '38px',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        padding: '0 13px',
        // Leave room for macOS native traffic lights (~68px inset).
        paddingLeft: '80px',
        borderBottom: '1px solid var(--border)',
        background: 'color-mix(in oklch, var(--card) 88%, var(--foreground) 6%)',
        position: 'relative',
        userSelect: 'none',
      }}
    >
      {/* Logo + DECODER wordmark — centered */}
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
          alt="MORSE"
          height="15"
          style={{ height: '15px', width: 'auto', display: 'block' }}
        />
        <span
          style={{
            marginLeft: '9px',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            letterSpacing: '0.14em',
            color: 'var(--muted-foreground)',
          }}
        >
          DECODER
        </span>
      </div>

      {/* Theme toggle — pinned right */}
      <button
        type="button"
        onClick={onThemeToggle}
        aria-label="Toggle theme"
        style={{
          marginLeft: 'auto',
          pointerEvents: 'auto',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '4px',
          borderRadius: '6px',
          fontSize: '15px',
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
        {dark ? '☾' : '☀'}
      </button>
    </div>
  );
}
