// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { StatusDot } from './StatusDot';

interface StatusBarProps {
  running: boolean;
  deviceName: string;
  toneHz: number;
  autoDetect: boolean;
  confidence: number;
}

export function StatusBar({ running, deviceName, toneHz, autoDetect, confidence }: StatusBarProps) {
  const confPct = Math.round(confidence * 100);

  return (
    <div
      style={{
        height: '28px',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: '15px',
        padding: '0 14px',
        borderTop: '1px solid var(--border)',
        background: 'color-mix(in oklch, var(--card) 88%, var(--foreground) 6%)',
        fontFamily: 'var(--font-sans)',
        fontSize: '11px',
        letterSpacing: '0.01em',
        color: 'var(--muted-foreground)',
      }}
    >
      {/* Status */}
      <span
        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--foreground)' }}
      >
        <StatusDot tone={running ? 'good' : 'dial'} size={7} pulse={running} />
        {running ? 'Receiver online' : 'Standby'}
      </span>

      {/* Device name */}
      {deviceName && (
        <span style={{ textTransform: 'uppercase' }}>{deviceName}</span>
      )}

      {/* Tone + mode */}
      <span>
        {Math.round(toneHz)} Hz · {autoDetect ? 'Auto' : 'Manual'}
      </span>

      {/* Confidence */}
      {running && (
        <span>CONF {confPct}%</span>
      )}

      {/* CWNet badge — pinned right */}
      <span
        style={{
          marginLeft: 'auto',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
        }}
      >
        <span
          style={{
            width: '5px',
            height: '5px',
            borderRadius: '50%',
            background: 'var(--primary)',
            flexShrink: 0,
          }}
        />
        CWNet · On-device
      </span>
    </div>
  );
}
