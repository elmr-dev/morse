// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A small Web Audio sidetone keyer for the Redline trainer. Unlike the decoder
// (which bakes a noisy WAV through the training pipeline), Redline wants a
// clean, instantly-keyed sidetone plus a live signal tap for the oscilloscope —
// so this keys a single oscillator through a gain envelope and exposes the
// AnalyserNode the scope reads from.
//
// Timing comes from morse-audio's `translate`, which returns a flat array of
// millisecond segments: positive = key-down (tone), negative = key-up (silence)
// — exactly the standard WPM spacing the spec calls for (dit = 1.2 / WPM s,
// dah = 3 dits, intra-character gap = 1 dit, inter-character gap = 3 dits).

import { translate } from 'morse-audio';

// Short cosine-ish ramps so keying doesn't click. ~4 ms each.
const RAMP_SECONDS = 0.004;

export interface PlayOptions {
  wpm: number;
  frequency: number;
  /** Peak gain, 0–1. */
  volume: number;
}

export interface PlayHandle {
  /** Resolves when the call finishes (or is stopped). */
  done: Promise<void>;
  /** Total scheduled duration in milliseconds. */
  durationMs: number;
  /** Stop immediately. */
  stop(): void;
}

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor })
      .webkitAudioContext ??
    null
  );
}

/**
 * Owns a single AudioContext and a persistent AnalyserNode. Create one per
 * page, resume it on a user gesture (`ensure`), then `play` calls as needed.
 */
export class CwPlayer {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private current: { osc: OscillatorNode; gain: GainNode } | null = null;

  /** Create/resume the AudioContext. Must be called from a user gesture. */
  ensure(): void {
    if (!this.ctx) {
      const Ctor = audioContextCtor();
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** The signal tap for the oscilloscope. Null until `ensure` has run. */
  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  /** Whether a call is currently sounding. */
  get isPlaying(): boolean {
    return this.current !== null;
  }

  play(text: string, opts: PlayOptions): PlayHandle {
    this.stop();
    this.ensure();

    const ctx = this.ctx;
    const analyser = this.analyser;
    if (!ctx || !analyser) {
      return { done: Promise.resolve(), durationMs: 0, stop: () => {} };
    }

    const { timings } = translate(text, opts.wpm, opts.wpm);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = opts.frequency;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(analyser);

    const start = ctx.currentTime + 0.03;
    const peak = Math.max(0, Math.min(1, opts.volume));
    let t = start;
    for (const segment of timings) {
      const seconds = Math.abs(segment) / 1000;
      if (segment > 0) {
        // Key down: ramp up, hold, ramp down — clamped so very short dits still
        // get a clean envelope.
        const ramp = Math.min(RAMP_SECONDS, seconds / 2);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(peak, t + ramp);
        gain.gain.setValueAtTime(peak, t + seconds - ramp);
        gain.gain.linearRampToValueAtTime(0, t + seconds);
      }
      t += seconds;
    }
    const end = t + 0.03;
    const durationMs = (end - start) * 1000;

    osc.start(start);
    osc.stop(end);
    this.current = { osc, gain };

    const done = new Promise<void>((resolve) => {
      osc.onended = () => {
        if (this.current?.osc === osc) this.current = null;
        resolve();
      };
    });

    return {
      done,
      durationMs,
      stop: () => this.stopNode(osc, gain),
    };
  }

  stop(): void {
    if (this.current) this.stopNode(this.current.osc, this.current.gain);
  }

  private stopNode(osc: OscillatorNode, gain: GainNode): void {
    try {
      const now = this.ctx?.currentTime ?? 0;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(0, now);
      osc.stop(now);
    } catch {
      // Already stopped — ignore.
    }
    if (this.current?.osc === osc) this.current = null;
  }

  /** Release the AudioContext. Call on unmount. */
  dispose(): void {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
  }
}
