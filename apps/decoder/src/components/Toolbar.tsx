// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Headphones, Play, Square } from 'lucide-react';
import { StatusDot } from './StatusDot';

interface DeviceInfo {
  id: string;
  name: string;
  default: boolean;
}

type MonitorStatus = 'off' | 'starting' | 'on' | 'stopping' | 'error';

interface ToolbarProps {
  // Input device
  devices: DeviceInfo[];
  selectedId: string;
  onDeviceChange: (id: string) => void;
  running: boolean;

  // Monitor
  monitorStatus: MonitorStatus;
  monitorVolume: number;
  onMonitorToggle: () => void;
  onVolumeChange: (v: number) => void;

  // Tuning
  toneHz: number;
  autoDetect: boolean;
  onSetAuto: () => void;
  onSetManual: () => void;

  // Start/Stop
  onStart: () => void;
  onStop: () => void;
}

export function Toolbar({
  devices,
  selectedId,
  onDeviceChange,
  running,
  monitorStatus,
  monitorVolume,
  onMonitorToggle,
  onVolumeChange,
  toneHz,
  autoDetect,
  onSetAuto,
  onSetManual,
  onStart,
  onStop,
}: ToolbarProps) {
  const monitorOn = monitorStatus === 'on';
  const monitorBusy = monitorStatus === 'starting' || monitorStatus === 'stopping';

  const segBase: React.CSSProperties = {
    padding: '3px 9px',
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    fontFamily: 'var(--font-mono)',
    fontSize: '8.5px',
    letterSpacing: '0.1em',
    lineHeight: 1,
    color: 'var(--muted-foreground)',
    fontWeight: 600,
  };

  return (
    <div
      style={{
        height: '54px',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '0 14px',
        borderBottom: '1px solid var(--border)',
        background: 'color-mix(in oklch, var(--card) 94%, var(--foreground) 3%)',
      }}
    >
      {/* Input device */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '9px',
            letterSpacing: '0.16em',
            color: 'var(--muted-foreground)',
          }}
        >
          IN
        </span>
        <select
          value={selectedId}
          onChange={(e) => onDeviceChange(e.target.value)}
          disabled={running}
          style={{
            height: '34px',
            minWidth: '188px',
            padding: '0 28px 0 11px',
            border: '1px solid var(--input)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--card)',
            color: 'var(--foreground)',
            fontSize: '13px',
            fontFamily: 'var(--font-sans)',
            cursor: running ? 'not-allowed' : 'pointer',
            opacity: running ? 0.6 : 1,
            appearance: 'none',
            backgroundImage:
              'linear-gradient(45deg,transparent 50%,var(--muted-foreground) 50%),linear-gradient(135deg,var(--muted-foreground) 50%,transparent 50%)',
            backgroundPosition: 'calc(100% - 15px) 14px, calc(100% - 10px) 14px',
            backgroundSize: '5px 5px, 5px 5px',
            backgroundRepeat: 'no-repeat',
          }}
        >
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.default ? ' (default)' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Monitor toggle */}
      <button
        type="button"
        onClick={onMonitorToggle}
        disabled={monitorBusy}
        style={{
          height: '34px',
          padding: '0 12px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          background: monitorOn ? 'var(--primary)' : 'transparent',
          color: monitorOn ? 'var(--primary-foreground)' : 'var(--foreground)',
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          letterSpacing: '0.08em',
          fontWeight: 600,
          cursor: monitorBusy ? 'wait' : 'pointer',
          opacity: monitorBusy ? 0.6 : 1,
          whiteSpace: 'nowrap',
        }}
      >
        <Headphones size={15} strokeWidth={2} />
        {monitorOn ? 'MONITOR ON' : 'MONITOR'}
      </button>

      {/* Volume (only when monitor on) */}
      {monitorOn && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '128px' }}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={monitorVolume}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
            style={{ flex: 1, accentColor: 'var(--primary)', cursor: 'pointer' }}
            aria-label="Monitor volume"
          />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--muted-foreground)',
              minWidth: '30px',
              textAlign: 'right',
            }}
          >
            {Math.round(monitorVolume * 100)}%
          </span>
        </div>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Tone readout + AUTO / MANUAL segmented toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 4px' }}>
        <StatusDot tone="dial" size={7} pulse={running} />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '15px',
            fontWeight: 600,
            letterSpacing: '0.01em',
            color: 'var(--foreground)',
          }}
        >
          {Math.round(toneHz)} Hz
        </span>
        <div
          title={
            autoDetect
              ? 'Auto: tracking the strongest signal — click MANUAL to lock'
              : `Manual: parked on ${Math.round(toneHz)} Hz — click AUTO to track`
          }
          style={{
            display: 'inline-flex',
            border: '1px solid var(--border)',
            borderRadius: '999px',
            overflow: 'hidden',
          }}
        >
          <button
            type="button"
            onClick={onSetAuto}
            style={
              autoDetect
                ? {
                    ...segBase,
                    background: 'color-mix(in oklch, var(--success) 20%, transparent)',
                    color: 'var(--success)',
                  }
                : segBase
            }
          >
            AUTO
          </button>
          <button
            type="button"
            onClick={onSetManual}
            style={
              !autoDetect
                ? {
                    ...segBase,
                    background: 'var(--dial)',
                    color: '#1a1322',
                    fontWeight: 700,
                  }
                : segBase
            }
          >
            MANUAL
          </button>
        </div>
      </div>

      {/* START / STOP */}
      <button
        type="button"
        onClick={running ? onStop : onStart}
        style={{
          minWidth: '108px',
          height: '38px',
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          background: running ? 'var(--destructive)' : 'var(--primary)',
          color: running ? 'var(--destructive-foreground)' : 'var(--primary-foreground)',
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          letterSpacing: '0.1em',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: '11px', lineHeight: 1, display: 'flex' }}>
          {running ? <Square size={11} fill="currentColor" strokeWidth={0} /> : <Play size={11} fill="currentColor" strokeWidth={0} />}
        </span>
        {running ? 'STOP' : 'START'}
      </button>
    </div>
  );
}
