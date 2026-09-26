import { useSyncExternalStore } from 'react';

/**
 * The mobile breakpoint (docs/spec-ui-design.md L234, plan task 2.6).
 *
 * The extraction page's mobile behaviour is *not* pure CSS: at < 768px the quest
 * list takes the full width and the preview must open as a real overlay/modal
 * (Radix dialog — focus trap, scroll lock, Escape), while at ≥ 768px the same
 * selection updates the side-by-side right panel. Rendering both and hiding one
 * with `md:hidden` would leave a modal trapping focus on desktop, so the decision
 * is made in JS with the same breakpoint Tailwind's `md:` uses.
 *
 * `useSyncExternalStore` keeps it correct across resizes without a layout effect.
 */
export const MOBILE_MEDIA_QUERY = '(max-width: 767px)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const query = window.matchMedia(MOBILE_MEDIA_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function isMobileNow(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

/** `true` while the viewport is narrower than Tailwind's `md` (768px). */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, isMobileNow, () => false);
}
