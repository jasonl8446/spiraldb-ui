import { expect, test, type Page } from '@playwright/test';

import { MOCK_QUEST, mockQuestsApi } from './quests-mocks';

/**
 * **AC#4's evidence** (plan task 5.5): "With `prefers-reduced-motion: reduce`
 * (Playwright `emulateMedia`, D23) no CSS transitions / React Flow animations play —
 * evidenced by before/after screenshots mid-transition".
 *
 * ## What the audit changed about this claim
 *
 * The rule this story found (`client/src/index.css`, before) covered `.animate-spin`,
 * `.animate-in` and `.animate-out` only. The p5-05 audit measured the consequence: all ~65
 * `transition-*` utilities still played, React Flow's `dashdraw` was untouched, and React
 * Flow's `fitView({duration: 200})` is a **d3 transition** — no CSS rule can reach it, so it
 * had to be gated in the component (`lib/reduced-motion.ts`). This spec pins all three, and
 * states which React Flow animation this app actually has: its edges are **not** `animated`
 * (`grep -n "animated" client/src/lib/quest-goal-logic.ts` → 0), so `dashdraw` is a rule
 * installed for a future `animated: true` edge rather than one this corpus plays. The
 * animation this app *does* play is `fitView`'s.
 *
 * ## How each number is taken
 *
 * Three instruments, all deterministic rather than "waited and hoped":
 *
 * 1. **Computed styles** — `transition-property` / `transition-duration` / `animation-name`
 *    on named elements, under both media settings (the counterfactual is asserted too, so the
 *    measurement is shown to be able to detect a *playing* transition).
 * 2. **A whole-DOM invariant sweep** — under `reduce`, every element in the rendered tree
 *    must have `transition-duration: 0s` and `animation-name: none`, the deliberate
 *    `.animate-spin` exception aside. This is the "coverage by construction" claim: it is a
 *    property of the DOM, not a list of rules someone remembered.
 * 3. **A per-frame sampler** for the two animations that could still be *observed*: Radix's
 *    `animate-in` on the palette panel, and React Flow's `fitView`. It clicks/dispatches
 *    **inside the page** and samples every `requestAnimationFrame` for ~320 ms, so the
 *    mid-transition moment is captured by the browser rather than by a Playwright round-trip.
 *    The two settings produce different numbers, which is what makes the reduced-motion
 *    number meaningful.
 *
 * Screenshots (before / mid / after) go to `docs/evidence/phase-5/`.
 */

const QUEST = 'DS-ACAD1-C01-001';
const EVIDENCE = 'docs/evidence/phase-5';

/** Radix's enter animation duration (`tailwindcss-animate`'s `animate-in`), for the sampler. */
const PANEL_TRANSITION_BUDGET_MS = 320;

/** Opens the search palette (the app's one dialog panel) with the keyboard shortcut. */
async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toBeVisible();
}

/**
 * Samples the **panel** (`animate-in`) every frame for `budgetMs` after opening it, and
 * reports the distinct `animation-name` values plus the opacity at each frame.
 */
async function samplePaletteOpen(
  page: Page,
  budgetMs: number,
): Promise<{ names: string[]; opacities: number[] }> {
  return page.evaluate(async (budget) => {
    const started = performance.now();
    const names: string[] = [];
    const opacities: number[] = [];
    return await new Promise<{ names: string[]; opacities: number[] }>((resolve) => {
      const tick = (): void => {
        const content = document.querySelector('[role="dialog"]');
        if (content !== null) {
          const style = getComputedStyle(content);
          names.push(style.animationName);
          opacities.push(Math.round(Number(style.opacity) * 1000) / 1000);
        }
        if (performance.now() - started > budget) {
          resolve({ names, opacities });
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, budgetMs);
}

/**
 * Clicks **Fit to view** from inside the page and samples the React Flow viewport transform
 * every frame — the only way to catch a 200 ms d3 transition reliably.
 *
 * The viewport is moved first (two instant `Zoom in` presses): the canvas *starts* fitted, so
 * pressing Fit to view with nothing to correct produces an identical transform in both media
 * settings and proves nothing (measured: the first version of this arm saw exactly 1 distinct
 * transform without the preference). The zoom gives the transition a distance to cover.
 */
async function sampleFitView(page: Page, budgetMs: number): Promise<string[]> {
  return page.evaluate(async (budget) => {
    const byLabel = (label: string): HTMLButtonElement => {
      const button = [...document.querySelectorAll('button')].find(
        (candidate) => candidate.getAttribute('aria-label') === label,
      );
      if (button === undefined) {
        throw new Error(`${label} button not found — the flowchart did not render`);
      }
      return button as HTMLButtonElement;
    };
    const zoomIn = byLabel('Zoom in');
    zoomIn.click();
    zoomIn.click();
    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null;
    if (viewport === null) {
      throw new Error('React Flow viewport not found');
    }
    const fit = byLabel('Fit to view');
    const transforms: string[] = [];
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    fit.click();
    const started = performance.now();
    return await new Promise<string[]>((resolve) => {
      const tick = (): void => {
        transforms.push(viewport.style.transform);
        if (performance.now() - started > budget) {
          resolve(transforms);
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, budgetMs);
}

/** The distinct values of a sample series, in first-seen order. */
function distinct<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/** Opens `/quests/<QUEST>` and switches to the Goal Logic tab, where the flowchart renders. */
async function openFlowchart(page: Page): Promise<void> {
  await mockQuestsApi(page, {
    // `m_completeQuest: true` is what makes the graph draw an edge into the Complete node;
    // `MOCK_QUEST` alone draws none (asserted in the React Flow arm below).
    detail: {
      ...MOCK_QUEST,
      m_goalLogic: [{ m_goalsAND: ['1_WizardQuestGoals_GotoZone'], m_completeQuest: true }],
    },
  });
  // The flowchart's entry inspector reads the quest name list; mocked so the run stays
  // hermetic (D81) even though no assertion here depends on its rows.
  await page.route('**/api/names/quests', (route) => route.fulfill({ json: { quests: [] } }));
  await page.goto(`/quests/${QUEST}`);
  const main = page.getByRole('main');
  await main.getByRole('tab', { name: 'Goal Logic' }).click();
  await expect(main.getByRole('group', { name: 'Goal logic flowchart' })).toBeVisible();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
}

/* ------------------------------------------------------------ 1. computed styles */

test.describe('reduced motion — computed styles, with the counterfactual', () => {
  test('the sidebar transition is off under reduce and on without it', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests');

    const navLink = page.getByRole('link', { name: 'Browse Quests' }).first();
    await expect(navLink).toBeVisible();

    // Without the preference: the transition exists (this is what makes the reduced number
    // evidence rather than a constant).
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const normal = await navLink.evaluate((element) => {
      const style = getComputedStyle(element);
      return { property: style.transitionProperty, duration: style.transitionDuration };
    });
    expect(normal.duration).not.toBe('0s');
    expect(normal.property).toContain('color');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await navLink.evaluate((element) => {
      const style = getComputedStyle(element);
      return { property: style.transitionProperty, duration: style.transitionDuration };
    });
    expect(reduced.property).toBe('none');
    expect(reduced.duration).toBe('0s');

    await page.screenshot({ path: `${EVIDENCE}/p5-05-reduced-motion-sidebar.png` });
  });

  test('the whole rendered DOM obeys the invariant, except the deliberate spinner', async ({
    page,
  }) => {
    await openFlowchart(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const report = await page.evaluate(() => {
      const transitions: string[] = [];
      const animations: string[] = [];
      let spinners = 0;
      let scanned = 0;
      for (const element of document.querySelectorAll('*')) {
        scanned += 1;
        const style = getComputedStyle(element);
        const durations = style.transitionDuration.split(',').map((value) => parseFloat(value));
        if (durations.some((value) => Number.isFinite(value) && value > 0)) {
          transitions.push(`${element.tagName}.${element.className} → ${style.transitionDuration}`);
        }
        if (element.classList.contains('animate-spin')) {
          spinners += 1;
          continue;
        }
        const animationDurations = style.animationDuration
          .split(',')
          .map((value) => parseFloat(value));
        if (
          style.animationName !== 'none' &&
          animationDurations.some((value) => Number.isFinite(value) && value > 0)
        ) {
          animations.push(`${element.tagName}.${element.className} → ${style.animationName}`);
        }
      }
      return { transitions, animations, spinners, scanned };
    });

    // Positive partner: the sweep really walked a rendered tree.
    expect(report.scanned).toBeGreaterThan(50);
    expect(
      report.transitions,
      `elements still transitioning:\n${report.transitions.join('\n')}`,
    ).toHaveLength(0);
    expect(
      report.animations,
      `elements still animating:\n${report.animations.join('\n')}`,
    ).toHaveLength(0);
  });

  test('a spinner is the one animation left, and it is slowed rather than stopped', async ({
    page,
  }) => {
    await mockQuestsApi(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/quests');
    // The header's sync button mounts a `Loader2` only while a sync runs; the reliable
    // spinner on this page is the list skeleton's `animate-pulse`… which the rule stops.
    // So this arm asserts the *rule*, read from the stylesheet the browser applied, on a
    // synthetic element with the utility — the honest way to test a utility that only
    // exists while a request is in flight.
    const spinner = await page.evaluate(() => {
      const element = document.createElement('div');
      element.className = 'animate-spin';
      document.body.append(element);
      const style = getComputedStyle(element);
      const result = { name: style.animationName, duration: style.animationDuration };
      element.remove();
      return result;
    });
    expect(spinner.name).toBe('p5-05-spinner');
    expect(parseFloat(spinner.duration)).toBeCloseTo(2.4, 2);
  });
});

/* --------------------------------------------------- 2. the panel, per frame */

test.describe('reduced motion — the panel animation, sampled per frame', () => {
  test('the palette panel is already settled while the un-reduced panel is still animating', async ({
    page,
  }) => {
    await mockQuestsApi(page);
    await page.goto('/quests');

    // Counterfactual first: without the preference, Radix's `animate-in` plays, so the
    // sampled frames show the animation name and an opacity that is still ramping.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openPalette(page);
    const animated = await samplePaletteOpen(page, PANEL_TRANSITION_BUDGET_MS);
    expect(animated.names.length).toBeGreaterThan(3);
    expect(distinct(animated.opacities).length).toBeGreaterThan(1);
    await page.screenshot({ path: `${EVIDENCE}/p5-05-reduced-motion-panel-mid-noreduce.png` });
    await page.keyboard.press('Escape');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openPalette(page);
    // The mid-transition capture: taken immediately after the panel appears.
    await page.screenshot({ path: `${EVIDENCE}/p5-05-reduced-motion-panel-mid-reduce.png` });
    const settled = await samplePaletteOpen(page, PANEL_TRANSITION_BUDGET_MS);
    await page.screenshot({ path: `${EVIDENCE}/p5-05-reduced-motion-panel-after-reduce.png` });

    expect(settled.names.length).toBeGreaterThan(3);
    expect(distinct(settled.names)).toEqual(['none']);
    // Settled at the first sampled frame and never moves again: one distinct opacity, 1.
    expect(distinct(settled.opacities)).toEqual([1]);
  });
});

/* ------------------------------------------- 3. React Flow's fitView, per frame */

test.describe('reduced motion — React Flow, sampled per frame', () => {
  test('fitView jumps under reduce and animates without it', async ({ page }) => {
    await openFlowchart(page);

    // Positive partner: the canvas really renders an edge. `MOCK_QUEST`'s goal logic has
    // `m_completeQuest: false` and no `m_goalsToAdd`, so it draws **zero** edges — the
    // detail passed here flips the entry to complete, which is what makes `fitView` have a
    // bounding box to fit.
    await expect(page.locator('.react-flow__edge').first()).toBeVisible();
    // …and this app animates none of them: the edge mapping (`QuestGoalLogicEditor`'s
    // `toFlowEdges`) never sets `animated`, it dashes OR edges with `strokeDasharray`
    // instead. So React Flow's one CSS animation (`dashdraw`) is not played here at all.
    await expect(page.locator('.react-flow__edge.animated')).toHaveCount(0);

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const animated = await sampleFitView(page, PANEL_TRANSITION_BUDGET_MS);
    expect(animated.length).toBeGreaterThan(3);
    // A d3 transition over 200 ms: the viewport passes through intermediate transforms.
    expect(distinct(animated).length).toBeGreaterThan(2);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.screenshot({ path: `${EVIDENCE}/p5-05-reduced-motion-flowchart-before.png` });
    const settled = await sampleFitView(page, PANEL_TRANSITION_BUDGET_MS);
    await page.screenshot({ path: `${EVIDENCE}/p5-05-reduced-motion-flowchart-after.png` });

    // The mid-transition moment: with `duration: 0` (`lib/reduced-motion.ts`) the viewport
    // moves in exactly **one step** — the frame the click lands on, then the fitted value —
    // and is static for every remaining sampled frame. The un-reduced run interpolates
    // through strictly more distinct transforms than that (asserted above), which is what
    // makes these two numbers a measurement of the transition rather than of the layout.
    expect(settled.length).toBeGreaterThan(3);
    const unique = distinct(settled);
    expect(
      unique.length,
      `distinct transforms under reduce: ${unique.length} (${unique.join(' | ')}) vs ${distinct(animated).length} without the preference`,
    ).toBeLessThanOrEqual(2);
    expect(
      distinct(settled.slice(1)),
      'the viewport kept moving after the click landed — a transition played',
    ).toHaveLength(1);
  });

  test("React Flow's `dashdraw` is off by rule, proven against React Flow's own markup", async ({
    page,
  }) => {
    // The graph this app builds has no `animated` edge (asserted above), so this proves the
    // **rule** rather than a played animation: the exact element React Flow's selector targets
    // (`@xyflow/react/dist/style.css`: `.react-flow__edge.animated path`) is injected, and the
    // media preference is flipped around it. Without the rule the app would be one
    // `animated: true` away from an infinite dash animation under `reduce`.
    await openFlowchart(page);

    const probe = async (): Promise<{ name: string; duration: string; dash: string }> =>
      page.evaluate(() => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.innerHTML =
          '<g class="react-flow__edge animated"><path class="react-flow__edge-path" d="M0 0 L10 10" /></g>';
        document.body.append(svg);
        const path = svg.querySelector('path') as SVGPathElement;
        const style = getComputedStyle(path);
        const result = {
          name: style.animationName,
          duration: style.animationDuration,
          dash: style.strokeDasharray,
        };
        svg.remove();
        return result;
      });

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const playing = await probe();
    expect(playing.name).toBe('dashdraw');
    expect(playing.duration).toBe('0.5s');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const stopped = await probe();
    expect(stopped.name).toBe('none');
    // The dashes stay (the static `stroke-dasharray: 5` from React Flow's own rule), so the
    // edge is still drawn dashed — it just never marches.
    expect(stopped.dash).toBe('5px');
  });
});
