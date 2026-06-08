import { Pause, Play } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

export function fmt(s: number) {
  if (!Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/** Re-bucket a fixed bar array down to `target` bars by peak-per-bucket. */
function rebucket(src: number[], target: number): number[] {
  if (target >= src.length) return src;
  const out = new Array<number>(target).fill(0);
  const n = src.length;
  for (let b = 0; b < target; b++) {
    const lo = Math.floor((b * n) / target);
    const hi = Math.max(lo + 1, Math.floor(((b + 1) * n) / target));
    let peak = 0;
    for (let i = lo; i < hi && i < n; i++) if (src[i] > peak) peak = src[i];
    out[b] = peak;
  }
  return out;
}

const PX_PER_BAR = 9; // target bar+gap width; bar count derived from measured width

export default function AudioPlayer({
  src,
  bars,
  volume = 1,
  onTime,
}: {
  src: string;
  /** ch0 keying-envelope peaks (0..1), from PipelineResult.envelopeBars. */
  bars?: number[];
  /** 0..1, owned by the parent so the control can live in the card header. */
  volume?: number;
  /** Reports playback position upward so the timecode can live in the card header. */
  onTime?: (current: number, duration: number) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [trackWidth, setTrackWidth] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: state setters are stable; audioRef is a ref
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    // New clip: reset transport state so a different-length clip never
    // briefly shows the previous clip's position before metadata loads.
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    const onTimeEv = () => {
      setCurrent(el.currentTime);
      onTime?.(el.currentTime, el.duration);
    };
    const onMeta = () => {
      setDuration(el.duration);
      onTime?.(el.currentTime, el.duration);
    };
    const onEnd = () => setPlaying(false);
    el.addEventListener('timeupdate', onTimeEv);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('ended', onEnd);
    return () => {
      el.removeEventListener('timeupdate', onTimeEv);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('ended', onEnd);
    };
  }, [src, onTime]);

  // Apply parent-owned volume to the element.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // Measure the scrubber so bar count tracks available width.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setTrackWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    setTrackWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      el.play();
      setPlaying(true);
    }
  }

  function seekToClientX(clientX: number) {
    const el = audioRef.current;
    const track = trackRef.current;
    if (!el || !track || !duration) return;
    const rect = track.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const t = frac * duration;
    el.currentTime = t;
    setCurrent(t);
  }

  function onTrackPointerDown(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    seekToClientX(e.clientX);
  }
  function onTrackPointerMove(e: React.PointerEvent) {
    if (e.buttons !== 1) return;
    seekToClientX(e.clientX);
  }

  const progress = duration ? current / duration : 0;
  const hasBars = !!bars && bars.length > 0;

  // Responsive bar count: ~1 bar per PX_PER_BAR of width, capped by source length.
  const displayBars = useMemo(() => {
    if (!hasBars || !bars) return [];
    const target = Math.max(
      16,
      Math.min(bars.length, Math.floor(trackWidth / PX_PER_BAR))
    );
    return rebucket(bars, target);
  }, [bars, hasBars, trackWidth]);

  return (
    <div>
      {/* biome-ignore lint/a11y/useMediaCaption: programmatically generated audio has no caption track */}
      <audio ref={audioRef} src={src} preload="metadata" />
      <div className="flex items-center gap-3">
        {/* Play / pause — 44px touch target on mobile */}
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          className="shrink-0 flex items-center justify-center size-11 sm:size-10 rounded-md bg-background border border-input text-foreground hover:border-ring transition-colors active:scale-[0.97]"
        >
          {playing ? (
            <Pause className="size-5 sm:size-4" />
          ) : (
            <Play className="size-5 sm:size-4" />
          )}
        </button>

        {/* Envelope scrubber (or plain track fallback) */}
        <div
          ref={trackRef}
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(current)}
          tabIndex={0}
          onKeyDown={(e) => {
            const el = audioRef.current;
            if (!el || !duration) return;
            if (e.key === 'ArrowRight') {
              el.currentTime = Math.min(duration, current + 1);
              setCurrent(el.currentTime);
            }
            if (e.key === 'ArrowLeft') {
              el.currentTime = Math.max(0, current - 1);
              setCurrent(el.currentTime);
            }
          }}
          className="flex-1 relative h-11 flex items-center cursor-pointer touch-none select-none rounded-md focus-visible:ring-2 focus-visible:ring-ring/50 outline-none"
        >
          {hasBars ? (
            <div className="flex items-end justify-between w-full h-9">
              {displayBars.map((v, i) => {
                // Flip at the bar's center (not its left edge) so the
                // played/unplayed boundary straddles the playhead instead of
                // running a full bar-width ahead of it.
                const played = (i + 0.5) / displayBars.length <= progress;
                const px = 3 + v * 33; // 3px floor (gaps) .. 36px (key-down)
                return (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: positional waveform bar; bars are recomputed each render
                    key={i}
                    className={`rounded-[1px] ${played ? 'bg-chart-5' : 'bg-primary/40'}`}
                    style={{ width: 3, height: `${px}px` }}
                  />
                );
              })}
            </div>
          ) : (
            <div className="w-full h-1.5 rounded-full bg-muted relative">
              <div
                className="absolute left-0 top-0 bottom-0 rounded-full bg-primary"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          )}
          {/* Playhead — amber radio-dial needle with a soft backlit glow.
              Overhangs the bars top and bottom like a tuner pointer. */}
          <div
            className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-dial rounded-full pointer-events-none shadow-[0_0_6px_1px] shadow-dial/60"
            style={{ left: `${progress * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
