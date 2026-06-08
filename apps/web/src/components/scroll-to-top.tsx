import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** Smoothly scroll the window to the top, jumping instantly under
 *  prefers-reduced-motion. Shared by route changes and nav-link clicks. */
export function scrollToTop() {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
}

/**
 * Scroll to top on every route change — React Router preserves scroll position
 * across navigations, which feels broken between pages. (Same-route nav clicks
 * are handled by an onClick on the links themselves.) Renders nothing.
 */
export default function ScrollToTop() {
  const { pathname } = useLocation();

  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger (scroll on each navigation), not read in the body.
  useEffect(() => {
    // Anchored navigations (e.g. /faq#is-it-rigged) own their own scroll.
    if (window.location.hash) return;
    scrollToTop();
  }, [pathname]);

  return null;
}
