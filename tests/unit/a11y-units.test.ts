import { describe, expect, it } from 'vitest';

import { motionDuration, prefersReducedMotion } from '../../client/src/lib/reduced-motion';
import { nextTabIndex } from '../../client/src/lib/tablist';

/**
 * The two pure units story p5-05 added (plan task 5.5, AC#8 and AC#11).
 *
 * They are unit-tested in node because the **browser** halves are asserted in
 * `tests/ui/a11y-keyboard.spec.ts` (the tablist keys move focus on a real page) and
 * `tests/ui/a11y-reduced-motion.spec.ts` (emulated media actually collapses the computed
 * durations) — what these pin is the decision logic those two specs rely on, and the edges
 * that a 4-tab page cannot reach (a 0-count list, a wrapped ArrowLeft from index 0, a browser
 * with no `matchMedia`).
 */

describe('nextTabIndex — the APG tabs keyboard model', () => {
  it('wraps in both directions', () => {
    expect(nextTabIndex('ArrowRight', 0, 4)).toBe(1);
    expect(nextTabIndex('ArrowRight', 3, 4)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 0, 4)).toBe(3);
    expect(nextTabIndex('ArrowLeft', 3, 4)).toBe(2);
  });

  it('jumps to the ends for Home/End', () => {
    expect(nextTabIndex('Home', 3, 4)).toBe(0);
    expect(nextTabIndex('End', 0, 4)).toBe(3);
  });

  it('ignores every key it does not own, so the caller only prevents the default it handled', () => {
    for (const key of ['Tab', 'Enter', ' ', 'a', 'ArrowUp', 'ArrowDown', 'Escape', 'PageDown']) {
      expect(nextTabIndex(key, 1, 4), key).toBeNull();
    }
  });

  it('is safe on an empty tablist (the loading/empty states)', () => {
    expect(nextTabIndex('ArrowRight', 0, 0)).toBeNull();
    expect(nextTabIndex('End', 0, 0)).toBeNull();
  });

  it('with one tab, every key stays on it rather than running off the end', () => {
    expect(nextTabIndex('ArrowRight', 0, 1)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 0, 1)).toBe(0);
  });
});

describe('prefersReducedMotion / motionDuration', () => {
  it('returns 0 for an animation when motion is reduced, and the caller’s value otherwise', () => {
    expect(motionDuration(true, 200)).toBe(0);
    expect(motionDuration(false, 200)).toBe(200);
    expect(motionDuration(true, 0)).toBe(0);
  });

  it('reads the media query when the browser can answer it', () => {
    const original = globalThis.window;
    const queries: string[] = [];
    // The narrowest possible stand-in: the helper only ever calls `matchMedia(...).matches`.
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        matchMedia: (query: string) => {
          queries.push(query);
          return { matches: true };
        },
      },
    });
    try {
      expect(prefersReducedMotion()).toBe(true);
      expect(queries).toEqual(['(prefers-reduced-motion: reduce)']);
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: original });
    }
  });

  it('degrades to "no preference" with no window (node, SSR)', () => {
    const original = globalThis.window;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: undefined });
    try {
      expect(prefersReducedMotion()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: original });
    }
  });

  it('degrades to "no preference" when matchMedia is absent', () => {
    const original = globalThis.window;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
    try {
      expect(prefersReducedMotion()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: original });
    }
  });
});
