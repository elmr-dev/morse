// Win celebration using canvas-confetti. Wrapped behind fireConfetti() so the
// call site stays trivial and the tuning lives in one place.

import confetti from 'canvas-confetti';

const COLORS = [
  '#a78bfa',
  '#ec4899',
  '#34d399',
  '#f4c0d1',
  '#cecbf6',
  '#facc15',
];

/**
 * Celebratory burst for a round win. Fires two angled cannons from the
 * bottom corners plus a center pop, so it reads across the whole viewport.
 * No-ops for users who prefer reduced motion.
 */
export function fireConfetti(): void {
  if (typeof window === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const defaults = {
    colors: COLORS,
    disableForReducedMotion: true,
    zIndex: 9999,
  };

  // Center pop.
  confetti({
    ...defaults,
    particleCount: 90,
    spread: 80,
    startVelocity: 45,
    origin: { x: 0.5, y: 0.6 },
  });

  // Left cannon, angled up-right.
  confetti({
    ...defaults,
    particleCount: 60,
    angle: 60,
    spread: 55,
    startVelocity: 55,
    origin: { x: 0, y: 0.7 },
  });

  // Right cannon, angled up-left.
  confetti({
    ...defaults,
    particleCount: 60,
    angle: 120,
    spread: 55,
    startVelocity: 55,
    origin: { x: 1, y: 0.7 },
  });
}
