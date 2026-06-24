// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Headphones, Play, Square } from 'lucide-react';
import React, { useEffect } from 'react';
import { StatusDot } from './StatusDot';

interface DeviceInfo {
  id: string;
  name: string;
  default: boolean;
}

type MonitorStatus = 'off' | 'starting' | 'on' | 'stopping' | 'error';

interface ToolbarProps {
  devices: DeviceInfo[];
  selectedId: string;
  onDeviceChange: (id: string) => void;
  running: boolean;
  monitorStatus: MonitorStatus;
  monitorVolume: number;
  onMonitorToggle: () => void;
  onVolumeChange: (v: number) => void;
  toneHz: number;
  autoDetect: boolean;
  onSetAuto: () => void;
  onSetManual: () => void;
  onStart: () => void;
  onStop: () => void;
}

/** Shared base for every toolbar button — neutral dark, no purple. */
const btn: React.CSSProperties = {
  height: '28px',
  padding: '0 12px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  background: 'var(--btn-surface, var(--card))',
  fontFamily: 'var(--font-sans)',
  fontSize: '13px',
  letterSpacing: 'normal',
  fontWeight: 400,
  color: 'var(--foreground)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

/** START/STOP — same size as other buttons, night-friendly tint+glow. */
function StartStopBtn({
  running,
  onStart,
  onStop,
}: {
  running: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const accent = running ? 'var(--destructive)' : 'var(--success)';
  return (
    <button
      type="button"
      className="tb-btn-active"
      onClick={running ? onStop : onStart}
      style={{
        ...btn,
        padding: '0 20px',
        minWidth: '80px',
        border: `1px solid color-mix(in oklch, ${accent} 38%, var(--border))`,
        background: `color-mix(in oklch, ${accent} 10%, var(--card))`,
        color: `color-mix(in oklch, ${accent} 88%, white)`,
        boxShadow: `0 0 10px -2px color-mix(in oklch, ${accent} 28%, transparent)`,
      }}
    >
      {running
        ? <Square size={11} fill="currentColor" strokeWidth={0} />
        : <Play size={11} fill="currentColor" strokeWidth={0} />}
      {running ? 'Stop' : 'Start'}
    </button>
  );
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

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      // Space → start / stop (skip when focus is in a form element)
      if (e.key === ' ' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        running ? onStop() : onStart();
        return;
      }
      // Escape → stop
      if (e.key === 'Escape' && running) {
        e.preventDefault();
        onStop();
        return;
      }
      // ⌘M → monitor toggle
      if ((e.metaKey || e.ctrlKey) && e.key === 'm') {
        e.preventDefault();
        onMonitorToggle();
        return;
      }
      // ⌘A → auto
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        onSetAuto();
        return;
      }
      // ⌘L → manual (lock)
      if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
        e.preventDefault();
        onSetManual();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, onStart, onStop, onMonitorToggle, onSetAuto, onSetManual]);

  const segBase: React.CSSProperties = {
    height: '24px',
    padding: '0 10px',
    margin: '2px',
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    borderRadius: '4px',
    fontFamily: 'var(--font-sans)',
    fontSize: '13px',
    letterSpacing: 'normal',
    lineHeight: 1,
    color: 'var(--muted-foreground)',
    fontWeight: 400,
    display: 'inline-flex',
    alignItems: 'center',
    transition: 'background 0.1s, color 0.1s',
  };

  const segActive: React.CSSProperties = {
    background: 'color-mix(in srgb, var(--foreground) 14%, transparent)',
    color: 'var(--foreground)',
    fontWeight: 500,
  };

  return (
    <div
      style={{
        height: '54px',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '0 14px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--card)',
      }}
    >
      {/* Input device */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '10px',
            letterSpacing: '0.02em',
            color: 'var(--muted-foreground)',
          }}
        >
          Input
        </span>
        <select
          value={selectedId}
          onChange={(e) => onDeviceChange(e.target.value)}
          disabled={running}
          style={{
            height: '28px',
            minWidth: '180px',
            padding: '0 26px 0 10px',
            border: '1px solid var(--input)',
            borderRadius: '6px',
            background: 'var(--btn-surface, var(--card))',
            color: 'var(--foreground)',
            fontSize: '13px',
            fontFamily: 'var(--font-sans)',
            cursor: running ? 'not-allowed' : 'pointer',
            opacity: running ? 0.6 : 1,
            appearance: 'none',
            backgroundImage:
              'linear-gradient(45deg,transparent 50%,var(--muted-foreground) 50%),linear-gradient(135deg,var(--muted-foreground) 50%,transparent 50%)',
            backgroundPosition: 'calc(100% - 14px) 11px, calc(100% - 9px) 11px',
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
        className={monitorOn ? 'tb-btn-active' : 'tb-btn'}
        onClick={onMonitorToggle}
        disabled={monitorBusy}
        style={{
          ...btn,
          ...(monitorOn
            ? {
                border: `1px solid color-mix(in oklch, var(--foreground) 30%, var(--border))`,
                background: `color-mix(in oklch, var(--foreground) 12%, var(--card))`,
              }
            : {}),
          opacity: monitorBusy ? 0.5 : 1,
          cursor: monitorBusy ? 'wait' : 'pointer',
        }}
      >
        <Headphones size={13} strokeWidth={1.75} />
        {monitorOn ? 'Monitor On' : 'Monitor'}
      </button>

      {/* Volume (only when monitor on) */}
      {monitorOn && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', width: '120px' }}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={monitorVolume}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
            style={{ flex: 1, accentColor: 'var(--foreground)', cursor: 'pointer' }}
            aria-label="Monitor volume"
          />
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '10px',
              color: 'var(--muted-foreground)',
              minWidth: '28px',
              textAlign: 'right',
            }}
          >
            {Math.round(monitorVolume * 100)}%
          </span>
        </div>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Tone readout */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        <StatusDot tone="dial" size={7} pulse={running} />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '14px',
            fontWeight: 600,
            letterSpacing: '0.01em',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
            minWidth: '4.6em',
            color: 'var(--foreground)',
          }}
        >
          {Math.round(toneHz)} Hz
        </span>

        {/* AUTO / MANUAL segmented pill */}
        <div
          title={
            autoDetect
              ? 'Auto: tracking the strongest signal — click Lock to park'
              : `Manual: parked on ${Math.round(toneHz)} Hz — click Auto to track`
          }
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            background: 'var(--border)',
            borderRadius: '6px',
            padding: '0',
          }}
        >
          <button
            type="button"
            className="tb-seg"
            onClick={onSetAuto}
            style={
              autoDetect
                ? { ...segBase, ...segActive, color: 'var(--primary)' }
                : segBase
            }
          >
            Auto
          </button>
          <button
            type="button"
            className="tb-seg"
            onClick={onSetManual}
            style={
              !autoDetect
                ? { ...segBase, ...segActive, color: 'var(--dial)' }
                : segBase
            }
          >
            Lock
          </button>
        </div>
      </div>

      {/* START / STOP */}
      <StartStopBtn running={running} onStart={onStart} onStop={onStop} />
    </div>
  );
}
