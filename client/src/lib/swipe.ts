/**
 * Swipe-to-close for the mobile navigation overlay
 * (docs/spec-ui-design.md L97: "Overlay on open. Swipe-to-close gesture.").
 *
 * The gesture decision is one pure comparison, extracted here so it can be tested
 * in node and so the overlay component holds no thresholds of its own.
 */

/** Horizontal distance (px) a leftward swipe must cover before the overlay closes. */
export const SWIPE_CLOSE_THRESHOLD_PX = 60;

/** Pointer moves shorter than this are taps/scrolls, not swipes. */
export const SWIPE_MAX_VERTICAL_DRIFT_PX = 48;

/**
 * `true` when a gesture that started at `startX`/`startY` and ended at
 * `endX`/`endY` should close the (left-anchored) navigation overlay.
 *
 * Only a leftward swipe counts, and only when the gesture stayed roughly
 * horizontal — otherwise a vertical scroll of the nav list would close it.
 */
export function swipeShouldClose(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  threshold: number = SWIPE_CLOSE_THRESHOLD_PX,
): boolean {
  const dx = startX - endX;
  const dy = Math.abs(endY - startY);
  return dx >= threshold && dy <= SWIPE_MAX_VERTICAL_DRIFT_PX;
}
