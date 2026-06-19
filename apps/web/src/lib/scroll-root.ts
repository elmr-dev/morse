// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/** ID assigned to the single scrollable container in main.tsx. The page
 *  scrolls inside this element instead of on the document so the
 *  scrollbar physically ends at the top edge of the bottom tab bar
 *  rather than running behind it. */
export const SCROLL_ROOT_ID = 'app-scroll';

/** The current scroll root, or the document scrolling element on the
 *  rare path where the inner container hasn't mounted yet (e.g. early
 *  prerender). Callers pass this to scrollTo / scrollIntoView. */
export function getScrollRoot(): HTMLElement | Element {
  return (
    document.getElementById(SCROLL_ROOT_ID) ??
    document.scrollingElement ??
    document.documentElement
  );
}

/** Smooth scroll the page back to the top, honoring reduced motion. */
export function scrollRootToTop(): void {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  getScrollRoot().scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
}
