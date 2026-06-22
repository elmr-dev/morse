// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

// A receiver-style scope: a faint graph-paper grid, the live keyed waveform
// tapped from the player's AnalyserNode, and an amber tuner needle that sweeps
// across while a call is sounding. When idle it rests as a flat baseline trace.

function cssColor(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

export default function Oscilloscope({
  analyser,
  active,
  className,
}: {
  analyser: AnalyserNode | null;
  active: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let sweep = 0;
    const data = new Uint8Array(analyser ? analyser.fftSize : 2048);

    const draw = () => {
      raf = requestAnimationFrame(draw);

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const grid = cssColor('--border', '#ccc');
      const dial = cssColor('--dial', '#e0a030');
      const isActive = activeRef.current;

      // Grid.
      ctx.strokeStyle = grid;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const step = 24;
      for (let x = step; x < w; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let y = step; y < h; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Waveform (or flat baseline when idle / no analyser).
      ctx.strokeStyle = dial;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (analyser && isActive) {
        analyser.getByteTimeDomainData(data);
        const slice = w / data.length;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128; // -1..1
          const y = h / 2 + v * (h / 2) * 0.9;
          if (i === 0) ctx.moveTo(0, y);
          else ctx.lineTo(i * slice, y);
        }
      } else {
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
      }
      ctx.stroke();

      // Amber tuner needle, sweeping while receiving.
      if (isActive) {
        sweep = (sweep + 2.2) % w;
        ctx.fillStyle = dial;
        ctx.globalAlpha = 0.18;
        ctx.fillRect(sweep - 6, 0, 6, h);
        ctx.globalAlpha = 0.9;
        ctx.fillRect(sweep, 0, 1.5, h);
        ctx.globalAlpha = 1;
      }
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [analyser]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Live oscilloscope of the keyed CW signal"
      className={cn(
        'h-20 w-full rounded-md border border-border bg-background',
        className
      )}
    />
  );
}
