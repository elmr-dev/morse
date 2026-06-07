import { Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Slider } from '@/components/ui/slider';

/**
 * Self-contained volume button + popover. Designed to sit in a CardAction
 * slot. Owns the popover open/close; volume value is lifted to the parent
 * via `value` / `onChange` so the audio element (in AudioPlayer) can read it.
 */
export default function VolumeControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const muted = value === 0;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node))
        setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Volume"
        aria-expanded={open}
        className={`flex items-center justify-center size-9 rounded-md transition-colors active:scale-[0.97] ${
          open
            ? 'bg-muted text-foreground ring-2 ring-ring/50'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        }`}
      >
        {muted ? (
          <VolumeX className="size-4" />
        ) : (
          <Volume2 className="size-4" />
        )}
      </button>
      {open && (
        <div className="absolute z-20 bg-popover border rounded-lg shadow-md py-2 px-3 w-40 sm:w-48 top-full right-0 mt-2 sm:top-1/2 sm:right-full sm:left-auto sm:bottom-auto sm:mt-0 sm:mr-2 sm:-translate-y-1/2">
          {/* caret: top edge (points up) on mobile, right edge (points right) on sm+ */}
          <div className="absolute -top-[6px] right-3 size-3 rotate-45 bg-popover border-l border-t border-border sm:hidden" />
          <div className="hidden sm:block absolute top-1/2 -right-[6px] -translate-y-1/2 size-3 rotate-45 bg-popover border-r border-t border-border" />
          <div className="flex items-center gap-2 sm:gap-3">
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={[value]}
              onValueChange={([v]) => onChange(v)}
              aria-label="Volume level"
              className="flex-1"
            />
            <span className="text-xs text-muted-foreground font-mono tabular-nums shrink-0 w-9 text-right">
              {Math.round(value * 100)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
