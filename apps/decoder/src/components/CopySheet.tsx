// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';

interface CharResult {
  ch: string;
  confidence: number;
}

export interface CopyLine {
  id: number | string;
  /** Divider row (tuned-to-new-signal marker). */
  divider?: true;
  label?: string;
  /** Regular copy row. */
  timestamp?: string;
  chars?: CharResult[];
  confidence?: number;
  status?: 'active' | 'settled' | 'empty';
}

interface CopySheetProps {
  lines: CopyLine[];
  onClear: () => void;
}

const CONFIDENCE_FLOOR = 0.35;

function charOpacity(confidence: number): number {
  return Math.max(CONFIDENCE_FLOOR, Math.min(1.0, confidence));
}

async function handleExport(lines: CopyLine[]) {
  const path = await save({
    defaultPath: (() => {
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      return `morse-copy-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z.txt`;
    })(),
    filters: [{ name: 'Text', extensions: ['txt'] }],
  });
  if (!path) return;

  const head = `MORSE DECODER — COPY LOG\n${new Date().toUTCString()}\n\n`;
  const body = lines
    .slice()
    .reverse()
    .filter((l) => l.divider || (l.chars && l.chars.length > 0))
    .map((l) => {
      if (l.divider) return `\n--- tuned ${l.label} ---`;
      const txt = (l.chars ?? []).map((c) => (c.ch === ' ' ? ' ' : c.ch)).join('');
      const pct = l.confidence != null ? `  (${Math.round(l.confidence * 100)}%)` : '';
      return `${l.timestamp}  ${txt}${l.status === 'active' ? '' : pct}`;
    })
    .join('\n');

  await invoke('export_copy_log', { path, content: head + body + '\n' });
}

export function CopySheet({ lines, onClear }: CopySheetProps) {
  const hasLines = lines.length > 0;

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--background)',
      }}
    >
      {/* Header */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '13px 16px 9px',
        }}
      >
        <span className="morse-eyebrow">COPY SHEET</span>
        {hasLines && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <ExportButton lines={lines} />
            <ClearButton onClear={onClear} />
          </div>
        )}
      </div>

      {/* Scroll area — newest on top */}
      <CopyScroll lines={lines} />
    </div>
  );
}

function ExportButton({ lines }: { lines: CopyLine[] }) {
  return (
    <button
      type="button"
      onClick={() => void handleExport(lines)}
      style={toolBtnStyle}
      title="Export copy log"
    >
      <span style={{ fontSize: '12px', lineHeight: 1 }}>↧</span> Export
    </button>
  );
}

function ClearButton({ onClear }: { onClear: () => void }) {
  return <ClearConfirm onClear={onClear} />;
}

import { useState } from 'react';

function ClearConfirm({ onClear }: { onClear: () => void }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'var(--destructive)',
            letterSpacing: '0.03em',
          }}
        >
          Clear all?
        </span>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            onClear();
          }}
          style={{ ...toolBtnStyle, color: 'var(--destructive)', fontWeight: 600 }}
        >
          Yes
        </button>
        <button type="button" onClick={() => setConfirming(false)} style={toolBtnStyle}>
          No
        </button>
      </>
    );
  }

  return (
    <button type="button" onClick={() => setConfirming(true)} style={toolBtnStyle}>
      Clear
    </button>
  );
}

const toolBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '4px 8px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontSize: '11px',
  color: 'var(--muted-foreground)',
  borderRadius: '4px',
  fontFamily: 'var(--font-sans)',
};

import { useEffect, useRef } from 'react';

function CopyScroll({ lines }: { lines: CopyLine[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Stick to the top (newest) when already near the top.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && el.scrollTop < 56) {
      el.scrollTop = 0;
    }
  }, [lines]);

  if (lines.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          color: 'var(--muted-foreground)',
          textAlign: 'center',
          padding: '24px',
        }}
      >
        <span style={{ fontSize: '30px', opacity: 0.4 }}>· − ·</span>
        <span style={{ fontSize: '13.5px' }}>
          Press{' '}
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--foreground)' }}>START</span>{' '}
          to begin copy.
        </span>
        <span style={{ fontSize: '12px', opacity: 0.8 }}>Each transmission lands as a new line.</span>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="copy-scroll"
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: '0 16px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '7px',
      }}
    >
      {lines.map((line) => {
        if (line.divider) {
          return <TunedDivider key={line.id} label={line.label ?? ''} />;
        }
        if (line.status === 'active') {
          return <ActiveRow key={line.id} line={line} />;
        }
        return <SettledRow key={line.id} line={line} />;
      })}
    </div>
  );
}

function TunedDivider({ label }: { label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '4px 0 2px',
      }}
    >
      <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          fontFamily: 'var(--font-mono)',
          fontSize: '9.5px',
          letterSpacing: '0.14em',
          color: 'var(--dial-strong)',
        }}
      >
        <span
          style={{
            width: '5px',
            height: '5px',
            borderRadius: '50%',
            background: 'var(--dial)',
            flexShrink: 0,
          }}
        />
        TUNED {label}
      </span>
      <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
    </div>
  );
}

function CharSpan({ ch, confidence }: { ch: string; confidence: number }) {
  if (ch === ' ') return <span>&nbsp;</span>;
  return <span style={{ opacity: charOpacity(confidence) }}>{ch}</span>;
}

function SettledRow({ line }: { line: CopyLine }) {
  const chars = line.chars ?? [];
  const pct = line.confidence != null ? Math.round(line.confidence * 100) : null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: '13px',
        fontFamily: 'var(--font-mono)',
        fontSize: '14.5px',
        lineHeight: 1.6,
      }}
    >
      <span
        style={{
          flexShrink: 0,
          color: 'var(--dial-strong)',
          fontSize: '11px',
          letterSpacing: '0.04em',
        }}
      >
        {line.timestamp}
      </span>
      {line.status === 'empty' ? (
        <span style={{ color: 'var(--muted-foreground)', fontSize: '13px', fontStyle: 'italic', opacity: 0.5 }}>
          no copy
        </span>
      ) : (
        <>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              color: 'var(--foreground)',
              letterSpacing: '0.06em',
              wordBreak: 'break-word',
              userSelect: 'text',
            }}
          >
            {chars.map((c, i) => (
              <CharSpan key={i} ch={c.ch} confidence={c.confidence} />
            ))}
          </span>
          {pct != null && (
            <span
              style={{
                flexShrink: 0,
                fontSize: '11px',
                color: 'var(--muted-foreground)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {pct}%
            </span>
          )}
        </>
      )}
    </div>
  );
}

function ActiveRow({ line }: { line: CopyLine }) {
  const chars = line.chars ?? [];
  const pct = line.confidence != null ? Math.round(line.confidence * 100) : null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: '13px',
        fontFamily: 'var(--font-mono)',
        fontSize: '14.5px',
        lineHeight: 1.6,
      }}
    >
      <span
        style={{
          flexShrink: 0,
          color: 'var(--dial-strong)',
          fontSize: '11px',
          letterSpacing: '0.04em',
        }}
      >
        {line.timestamp}
      </span>
      {chars.length > 0 ? (
        <>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              color: 'var(--foreground)',
              letterSpacing: '0.06em',
              wordBreak: 'break-word',
              userSelect: 'text',
            }}
          >
            {chars.map((c, i) => (
              <CharSpan key={i} ch={c.ch} confidence={c.confidence} />
            ))}
            <span
              className="wf-cursor"
              style={{ color: 'var(--primary)', fontWeight: 600 }}
            >
              ▌
            </span>
          </span>
          {pct != null && (
            <span
              style={{
                flexShrink: 0,
                fontSize: '11px',
                color: 'var(--muted-foreground)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {pct}%
            </span>
          )}
        </>
      ) : (
        <span className="wf-cursor" style={{ color: 'var(--primary)', fontWeight: 600 }}>
          ▌
        </span>
      )}
    </div>
  );
}
