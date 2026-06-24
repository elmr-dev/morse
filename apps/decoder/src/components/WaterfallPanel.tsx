// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef } from 'react';

// Waterfall passband
const FMIN = 250;
const FSPAN = 800; // 250–1050 Hz

type Colormap = 'viridis' | 'inferno' | 'jet' | 'hot' | 'bone' | 'grayscale';

interface WaterfallPanelProps {
  spectrumBins: number[];
  detectedSignals: number[];
  toneHz: number;
  autoDetect: boolean;
  colormap: Colormap;
  running: boolean;
  onColormapChange: (cm: Colormap) => void;
  onTune: (hz: number) => void; // drag/click → sets toneHz + MANUAL
  envelopeBars: number[]; // 0–1 amplitude values for the scope strip
}

// ── Colormap math (ported verbatim from Decoder.dc.html) ──────────────────

const VIRIDIS: [number, number, number][] = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
];
const INFERNO: [number, number, number][] = [
  [0, 0, 4],
  [87, 16, 110],
  [187, 55, 84],
  [249, 142, 9],
  [252, 255, 164],
];

function interp(t: number, map: [number, number, number][]): [number, number, number] {
  if (t <= 0) return map[0];
  if (t >= 1) return map[map.length - 1];
  const step = 1 / (map.length - 1);
  const idx = Math.floor(t / step);
  const lt = (t - idx * step) / step;
  const c1 = map[idx];
  const c2 = map[idx + 1];
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * lt),
    Math.round(c1[1] + (c2[1] - c1[1]) * lt),
    Math.round(c1[2] + (c2[2] - c1[2]) * lt),
  ];
}

function cl(x: number) {
  return Math.floor(Math.max(0, Math.min(1, x)) * 255);
}

function ramp(v: number, colormap: Colormap): [number, number, number] {
  const t = Math.max(0, Math.min(1, v));
  switch (colormap) {
    case 'inferno':
      return interp(t, INFERNO);
    case 'grayscale': {
      const g = Math.floor(t * 255);
      return [g, g, g];
    }
    case 'jet': {
      const r = Math.min(4 * t - 1.5, -4 * t + 4.5);
      const g = Math.min(4 * t - 0.5, -4 * t + 3.5);
      const b = Math.min(4 * t + 0.5, -4 * t + 2.5);
      return [cl(r), cl(g), cl(b)];
    }
    case 'hot': {
      let r = 0,
        g = 0,
        b = 0;
      if (t < 0.33) r = t / 0.33;
      else if (t < 0.66) {
        r = 1;
        g = (t - 0.33) / 0.33;
      } else {
        r = 1;
        g = 1;
        b = (t - 0.66) / 0.34;
      }
      return [Math.floor(r * 255), Math.floor(g * 255), Math.floor(b * 255)];
    }
    case 'bone': {
      const sin = 0.1 * Math.sin(t * Math.PI * 2);
      const gv = t < 0.5 ? t + sin : t;
      const bv = t < 0.75 ? t + sin : t;
      return [cl(t), cl(gv), cl(bv)];
    }
    case 'viridis':
    default:
      return interp(t, VIRIDIS);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export function WaterfallPanel({
  spectrumBins,
  detectedSignals,
  toneHz,
  autoDetect,
  colormap,
  running,
  onColormapChange,
  onTune,
  envelopeBars,
}: WaterfallPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colormapRef = useRef(colormap);
  const binsRef = useRef(spectrumBins);
  const runningRef = useRef(running);
  const rafRef = useRef<number>(0);
  const lastRowRef = useRef(0);
  const draggingRef = useRef(false);

  colormapRef.current = colormap;
  binsRef.current = spectrumBins;
  runningRef.current = running;

  // Size canvas on mount and resize.
  const sizeCanvas = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const w = Math.max(1, Math.floor(c.clientWidth));
    const h = Math.max(1, Math.floor(c.clientHeight));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#100c1c';
        ctx.fillRect(0, 0, w, h);
      }
    }
  }, []);

  // Animate: scroll canvas down one row and paint a new row from spectrumBins.
  const tick = useCallback(
    (now: number) => {
      rafRef.current = requestAnimationFrame(tick);
      const c = canvasRef.current;
      if (!c || !c.width) return;
      if (now - lastRowRef.current < 33) return; // ~30 fps
      lastRowRef.current = now;

      const ctx = c.getContext('2d');
      if (!ctx) return;
      const W = c.width;
      const H = c.height;
      if (H < 2) return; // can't scroll a degenerate canvas

      // Scroll existing content down by 1 px.
      ctx.drawImage(c, 0, 0, W, H - 1, 0, 1, W, H - 1);

      const bins = binsRef.current;
      const row = ctx.createImageData(W, 1);

      for (let x = 0; x < W; x++) {
        let v: number;
        if (!runningRef.current || bins.length === 0) {
          // Stopped or no data: noise floor.
          v = 0.04 + Math.random() * 0.03;
        } else {
          // Map pixel x → bin index.
          const binIdx = Math.min(bins.length - 1, Math.floor((x / W) * bins.length));
          v = Math.max(0.04, bins[binIdx]);
        }
        const [r, g, b] = ramp(v, colormapRef.current);
        const i = x * 4;
        row.data[i] = r;
        row.data[i + 1] = g;
        row.data[i + 2] = b;
        row.data[i + 3] = 255;
      }
      ctx.putImageData(row, 0, 0);
    },
    [], // colormapRef/binsRef/runningRef updated via refs — no deps needed
  );

  useEffect(() => {
    sizeCanvas();
    const onResize = () => sizeCanvas();
    window.addEventListener('resize', onResize);
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', onResize);
    };
  }, [sizeCanvas, tick]);

  // Needle position: map toneHz → % across the canvas.
  const needlePct = ((Math.max(FMIN, Math.min(FMIN + FSPAN, toneHz)) - FMIN) / FSPAN) * 100;
  const needleLeft = `${needlePct.toFixed(2)}%`;
  const needleOpacity = autoDetect ? 0.78 : 1;

  function tuneFromPointer(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    let x = (e.clientX - r.left) / r.width;
    x = Math.max(0, Math.min(1, x));
    onTune(Math.round((FMIN + x * FSPAN) / 5) * 5);
  }

  return (
    <div
      style={{
        width: '332px',
        flexShrink: 0,
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        padding: '13px 14px',
        gap: '9px',
        background: 'color-mix(in oklch, var(--card) 96%, var(--foreground) 2%)',
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
        }}
      >
        <span className="morse-eyebrow">WATERFALL</span>
        <select
          value={colormap}
          onChange={(e) => onColormapChange(e.target.value as Colormap)}
          style={{
            height: '22px',
            padding: '0 20px 0 7px',
            border: '1px solid var(--border)',
            borderRadius: '5px',
            background: 'var(--card)',
            color: 'var(--muted-foreground)',
            fontFamily: 'var(--font-mono)',
            fontSize: '9.5px',
            letterSpacing: '0.06em',
            cursor: 'pointer',
            appearance: 'none',
            backgroundImage:
              'linear-gradient(45deg,transparent 50%,var(--muted-foreground) 50%),linear-gradient(135deg,var(--muted-foreground) 50%,transparent 50%)',
            backgroundPosition: 'calc(100% - 11px) 9px, calc(100% - 7px) 9px',
            backgroundSize: '4px 4px, 4px 4px',
            backgroundRepeat: 'no-repeat',
          }}
        >
          {(['viridis', 'inferno', 'jet', 'hot', 'bone', 'grayscale'] as Colormap[]).map((cm) => (
            <option key={cm} value={cm}>
              {cm.toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      {/* Spectrogram canvas + overlays */}
      <div
        style={{ position: 'relative', flex: 1, minHeight: 0 }}
        onPointerDown={(e) => {
          draggingRef.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          tuneFromPointer(e);
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) tuneFromPointer(e);
        }}
        onPointerUp={() => {
          draggingRef.current = false;
        }}
        onPointerLeave={() => {
          draggingRef.current = false;
        }}
        title="Drag to lock the decoder onto a signal"
      >
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            display: 'block',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            background: '#100c1c',
            cursor: 'ew-resize',
            touchAction: 'none',
          }}
        />

        {/* Signal markers — small upward triangles along bottom edge */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 0,
            pointerEvents: 'none',
          }}
        >
          {detectedSignals.map((hz) => {
            const pct = (((hz - FMIN) / FSPAN) * 100).toFixed(1);
            const isSelected = Math.abs(hz - toneHz) < 30;
            const color =
              isSelected
                ? 'var(--dial)'
                : 'color-mix(in oklch, var(--primary) 65%, transparent)';
            return (
              <div
                key={hz}
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: `${pct}%`,
                  transform: 'translateX(-50%)',
                  width: 0,
                  height: 0,
                  borderLeft: '4px solid transparent',
                  borderRight: '4px solid transparent',
                  borderBottom: `6px solid ${color}`,
                }}
              />
            );
          })}
        </div>

        {/* Amber tuner needle */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: needleLeft,
            width: '2px',
            background: 'var(--dial)',
            boxShadow: '0 0 8px 1px color-mix(in oklch, var(--dial) 65%, transparent)',
            pointerEvents: 'none',
            transform: 'translateX(-1px)',
            opacity: needleOpacity,
          }}
        />
        {/* Needle top triangle */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: needleLeft,
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: '7px solid var(--dial)',
            pointerEvents: 'none',
          }}
        />
        {/* Needle Hz pill */}
        <div
          style={{
            position: 'absolute',
            top: '5px',
            left: needleLeft,
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
            fontFamily: 'var(--font-mono)',
            fontSize: '9.5px',
            fontWeight: 600,
            color: '#1a1322',
            background: 'var(--dial)',
            padding: '1px 5px',
            borderRadius: '3px',
            whiteSpace: 'nowrap',
          }}
        >
          {Math.round(toneHz)} Hz
        </div>
      </div>

      {/* Frequency scale */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontFamily: 'var(--font-mono)',
          fontSize: '9px',
          color: 'var(--muted-foreground)',
          padding: '0 1px',
        }}
      >
        <span>250</span>
        <span>450</span>
        <span>650</span>
        <span>850</span>
        <span>1050 Hz</span>
      </div>

      {/* Envelope scope */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '5px',
          paddingTop: '3px',
          borderTop: '1px solid var(--border)',
        }}
      >
        <span className="morse-eyebrow">ENVELOPE</span>
        <div
          style={{
            height: '34px',
            display: 'flex',
            alignItems: 'flex-end',
            gap: '1px',
            overflow: 'hidden',
          }}
        >
          {envelopeBars.map((amp, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: `${Math.max(2, Math.round(amp * 34))}px`,
                background: 'var(--primary)',
                opacity: 0.55 + amp * 0.45,
                borderRadius: '1px 1px 0 0',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
