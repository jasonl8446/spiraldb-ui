/**
 * `prefers-reduced-motion` readers for the animations a stylesheet cannot reach
 * (plan task 5.5 AC#11; audit `docs/evidence/phase-5/p5-05-d1-audit.md` §5).
 *
 * Everything CSS-driven is gated by one block in `client/src/index.css` — transitions,
 * keyframe animations and React Flow's `dashdraw`. Two animations are **not** CSS:
 *
 *  - React Flow's `fitView({ duration })` is a d3 transition driven from an event handler;
 *  - dnd-kit's `useSortable` writes its transition as an inline style (the CSS block's
 *    `!important` beats it too, but gating at the source keeps the claim independent of a
 *    cascade trick).
 *
 * The media query is re-read on every call rather than cached at module load: the setting
 * can change while the page is open (an OS "reduce motion" toggle, or Playwright's
 * `emulateMedia({ reducedMotion: 'reduce' })`), and every call site is an event handler or
 * a render path that already runs per interaction.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The duration an animation should use: the caller's own value, or `0` (an instant jump)
 * when the user asked for reduced motion.
 */
export function motionDuration(reduced: boolean, durationMs: number): number {
  return reduced ? 0 : durationMs;
}
