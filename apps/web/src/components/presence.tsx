import { type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduce(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduce;
}

// Keeps `children` mounted through their exit animation. React would otherwise
// unmount the moment `show` flips false, leaving no frame to animate. While
// leaving, we render the last-shown children (frozen) so the card stays intact
// even though the state that produced it has already been cleared, and unmount
// only once the slide-down finishes. `delay`/`exitDelay` stagger enter vs exit.
export function Presence({
  show,
  delay = 0,
  exitDelay = 0,
  className,
  children,
}: {
  show: boolean;
  delay?: number;
  exitDelay?: number;
  className?: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(show);
  const reduce = usePrefersReducedMotion();
  const frozen = useRef(children);
  if (show) frozen.current = children;

  useEffect(() => {
    if (show) setMounted(true);
    // With motion disabled the slide-down never runs, so onAnimationEnd would
    // never fire — unmount immediately instead of stranding the frozen card.
    else if (reduce) setMounted(false);
  }, [show, reduce]);

  if (!mounted) return null;
  const exiting = !show;
  return (
    <div
      className={cn(
        exiting ? 'animate-slide-down' : 'animate-slide-up',
        className
      )}
      style={{ animationDelay: `${exiting ? exitDelay : delay}ms` }}
      onAnimationEnd={(e) => {
        // Ignore animations bubbling up from descendants (e.g. the spinner).
        if (exiting && e.target === e.currentTarget) setMounted(false);
      }}
    >
      {show ? children : frozen.current}
    </div>
  );
}
