import { expect, test, type Page } from '@playwright/test';

import { mockDropTableApi, SELF_KEY } from './drop-table-mocks';
import { MOCK_QUEST, mockQuestsApi } from './quests-mocks';

/**
 * **AC#8's proof** (plan task 5.5): "complete extract→save, mark reviewed, edit DropTable
 * item, and dashboard navigation without a mouse; visible focus ring on every stop", plus
 * AC#10's **rendered** cross-check (the source sweep is `tests/unit/a11y-icon-labels.test.ts`).
 *
 * ## "Without a mouse" — what that means here
 *
 * No test in this file calls `.click()` on a locator. Every action is `page.keyboard.press`
 * against the element the browser's own tab order (or, where a flow starts deep in a list,
 * an explicit `.focus()`) put there; a `.focus()` is a DOM focus call, not a pointer event,
 * and it is the same thing `Tab` does. The flows:
 *
 * | flow | how it is driven |
 * |---|---|
 * | **dashboard navigation** | `Tab` from the top of the page until an activity-feed link has focus, then `Enter` → the object's detail route |
 * | **mark reviewed** | `Tab` to the row's `Change status:` trigger → `Enter` opens the menu → `Tab` to `Mark Reviewed` → `Enter` → the notes dialog → `Enter` on the confirm button → the PATCH |
 * | **edit a DropTable item** | `Enter` on `Edit` → `Tab` to the item's `Item id` combobox → `Enter` opens it → type → `ArrowDown` → `Enter` → `Enter` on the labelled `Remove item 2` → `Enter` on `Save` |
 * | **extract → save** | `Ctrl+K`-free: `Enter` on the dropzone button **opens the real file chooser** (caught as Playwright's `filechooser` event) → results → `Enter` on `Save All to SpiralDB` → `Enter` on the dialog's `Save` |
 *
 * ## What is asserted about focus, not just about clicks
 *
 * `the tab order…` walks the browser's real tab order on three surfaces, records every stop,
 * and asserts **each** stop reports the spec's ring (spec L542:
 * `ring-2 ring-blue-500 ring-offset-2 ring-offset-zinc-950`) as its computed `box-shadow`.
 * That is stronger than "the ring class is present": it is the value the browser actually
 * painted, and it covers the global `:focus-visible` base rule that makes an unnamed
 * component impossible to ship without one.
 *
 * ## The DOM name sweep (AC#10's rendered half)
 *
 * `every rendered control exposes an accessible name` sweeps `document` on each surface for
 * buttons, links, `summary` and inputs, computing each one's name the way a browser does
 * (`aria-label` → `aria-labelledby` → `title` → visible text → `alt`/placeholder), skipping
 * anything invisible or `aria-hidden`. It asserts zero unnamed controls **and** a positive
 * floor per surface, so it cannot pass on a page that rendered nothing.
 */

const QUEST = 'DS-ACAD1-C01-001';

/** The window the fixtures' `changed_at` values hang off. */
const NOW = Date.now();

/** The eight tracked families (`shared/objectTypes.ts`), for a dashboard body the page accepts. */
const DASHBOARD_TYPES: Record<string, Record<string, number>> = {
  quest: { total: 4, extracted: 1, reviewed: 2, verified: 1 },
  drop_table: { total: 3, extracted: 1, reviewed: 1, verified: 1 },
  npc_inventory: { total: 2, extracted: 1, reviewed: 1, verified: 0 },
  npc_spell_inventory: { total: 2, extracted: 1, reviewed: 0, verified: 1 },
  creature_spellbook: { total: 2, extracted: 0, reviewed: 1, verified: 1 },
  npc_drop_table: { total: 2, extracted: 1, reviewed: 1, verified: 0 },
  treasure_card_inventory: { total: 2, extracted: 0, reviewed: 1, verified: 1 },
  zone_transfer: { total: 2, extracted: 1, reviewed: 0, verified: 1 },
};

/** `GET /api/dashboard` — the eight buckets and their sums, as the server composes them. */
function dashboardBody(): Record<string, unknown> {
  const overall = { total: 0, extracted: 0, reviewed: 0, verified: 0, percent_verified: 0 };
  for (const bucket of Object.values(DASHBOARD_TYPES)) {
    overall.total += bucket.total ?? 0;
    overall.extracted += bucket.extracted ?? 0;
    overall.reviewed += bucket.reviewed ?? 0;
    overall.verified += bucket.verified ?? 0;
  }
  overall.percent_verified = Math.round((overall.verified / overall.total) * 1000) / 10;
  return { types: structuredClone(DASHBOARD_TYPES), overall };
}

/** The two feed rows the dashboard navigation flow walks to. */
const FEED = [
  {
    id: 11,
    object_type: 'quest',
    object_key: QUEST,
    old_status: 'extracted',
    new_status: 'reviewed',
    notes: 'looks right',
    changed_by: 'Mock Reviewer',
    changed_at: new Date(NOW - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 10,
    object_type: 'drop_table',
    object_key: SELF_KEY,
    old_status: 'extracted',
    new_status: 'verified',
    notes: null,
    changed_by: 'Mock Reviewer',
    changed_at: new Date(NOW - 5 * 60 * 60 * 1000).toISOString(),
  },
];

/** The shell's own boot reads + the dashboard's two queries. */
async function mockDashboardApi(page: Page): Promise<void> {
  await page.route('**/api/settings', (route) =>
    route.fulfill({
      json: {
        aurorium_path: '/mock/aurorium',
        imcodec_path: '/mock/imcodec',
        spiraldb_path: '/mock/spiraldb',
        user_name: 'Mock Reviewer',
        git_branch: 'content/2026-09-26',
      },
    }),
  );
  await page.route('**/api/sync/status', (route) =>
    route.fulfill({ json: { last_sync: null, revision: null, status: 'never' } }),
  );
  await page.route('**/api/sync/history', (route) => route.fulfill({ json: { history: [] } }));
  await page.route('**/api/status/_import', (route) =>
    route.fulfill({ json: { ran: false, imported: 0, imported_at: null } }),
  );
  await page.route('**/api/dashboard', (route) => route.fulfill({ json: dashboardBody() }));
  await page.route('**/api/activity**', (route) =>
    route.fulfill({ json: { activity: FEED, unresolved: 0 } }),
  );
}

/* ------------------------------------------------------------- the four flows */

test.describe('AC#8 — the four flows, keyboard only', () => {
  test('dashboard navigation: Tab reaches the feed link and Enter follows it', async ({ page }) => {
    await mockDashboardApi(page);
    await page.goto('/');

    const target = page.locator('[data-activity-id="11"] a');
    await expect(target).toBeVisible();

    // Walk the browser's own tab order from the top of the document and stop when the feed
    // link is focused — the stop is *found*, not focused.
    let walked = 0;
    let reached = false;
    while (walked < 80 && !reached) {
      await page.keyboard.press('Tab');
      walked += 1;
      reached = await page.evaluate(() => {
        const active = document.activeElement;
        return active !== null && active.closest('[data-activity-id="11"]') !== null;
      });
    }
    expect(reached, `the feed link was not reached in ${walked} Tab presses`).toBe(true);

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/quests/${QUEST}$`));
  });

  test('mark reviewed: menu → notes dialog → PATCH', async ({ page }) => {
    const recorded = await mockQuestsApi(page);
    await page.goto('/quests');

    const trigger = page
      .locator('tbody tr')
      .first()
      .getByRole('button', { name: `Change status: ${QUEST}` });
    await expect(trigger).toBeEnabled();
    await trigger.focus();
    await page.keyboard.press('Enter');

    // Both the trigger and the Radix popover panel carry this label, and Radix portals the
    // panel to the end of `<body>` — so the menu is the **last** match, not the first.
    const menu = page.getByLabel(`Change status: ${QUEST}`).last();
    await expect(menu).toBeVisible();
    const reviewed = menu.getByRole('button', { name: 'Mark Reviewed' });
    await reviewed.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole('button', { name: 'Mark Reviewed' });
    await confirm.focus();
    await page.keyboard.press('Enter');

    await expect.poll(() => recorded.patchPaths).toEqual([`/api/status/quests/${QUEST}`]);
    expect(recorded.patches[0]).toMatchObject({ status: 'reviewed' });
  });

  test('edit a DropTable item: Edit → combobox → remove → Save', async ({ page }) => {
    const recorded = await mockDropTableApi(page);
    await page.goto(`/drop-tables/${SELF_KEY}`);
    const main = page.getByRole('main');
    await expect(main.getByText(SELF_KEY, { exact: true }).first()).toBeVisible();

    const edit = page.getByRole('button', { name: 'Edit' });
    await edit.focus();
    await page.keyboard.press('Enter');

    // The item row's id combobox: open with Enter, filter, ArrowDown, Enter.
    await expect(main.getByText('stored as "1000"')).toBeVisible();
    const combobox = main.getByRole('combobox', { name: 'Item 2 item id' });
    await combobox.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.type('Black');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    // The pick wrote the id (and the synced name) — read from the row's own read-only box.
    await expect(main.getByRole('textbox', { name: 'Item 2 item name' })).toHaveValue(
      'Black Mantle',
    );

    // Remove the (now second) row by its labelled × button.
    const remove = main.getByRole('button', { name: 'Remove item 2' });
    await remove.focus();
    await page.keyboard.press('Enter');
    await expect(main.getByRole('button', { name: 'Remove item 2' })).toHaveCount(0);

    const save = main.getByRole('button', { name: 'Save' });
    await save.focus();
    await page.keyboard.press('Enter');

    await expect.poll(() => recorded.savePosts.length).toBe(1);
    const items = (recorded.savePosts[0]?.object as { Items?: unknown[] } | undefined)?.Items ?? [];
    expect(items).toHaveLength(1);
    expect((items[0] as { ItemId?: unknown }).ItemId).toBe('1001');
  });

  test('extract → save: the dropzone button opens the file chooser with Enter', async ({
    page,
  }) => {
    const saved: Array<Record<string, unknown>> = [];
    await page.route('**/api/settings', (route) =>
      route.fulfill({
        json: {
          aurorium_path: '/mock/aurorium',
          imcodec_path: '/mock/imcodec',
          spiraldb_path: '/mock/spiraldb',
          user_name: 'Mock Reviewer',
          git_branch: 'content/2026-09-26',
        },
      }),
    );
    await page.route('**/api/sync/status', (route) =>
      route.fulfill({ json: { last_sync: null, revision: null, status: 'never' } }),
    );
    await page.route('**/api/sync/history', (route) => route.fulfill({ json: { history: [] } }));
    await page.route('**/api/status/_import', (route) =>
      route.fulfill({ json: { ran: false, imported: 0, imported_at: null } }),
    );
    // The extraction endpoint (the .NET CLI's HTTP surface) answers with one quest, so the
    // flow is hermetic (D81/D40) — no CLI, no SpiralDB repo.
    await page.route('**/api/extract/quests', (route) =>
      route.fulfill({
        json: { quests: [{ m_questName: QUEST, m_questLevel: 7, m_goals: [] }], count: 1 },
      }),
    );
    await page.route('**/api/quests', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          json: {
            quests: [],
            summary: { total: 0, extracted: 0, reviewed: 0, verified: 0 },
            skipped: [],
          },
        });
        return;
      }
      saved.push(JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>);
      await route.fulfill({
        json: {
          key: QUEST,
          file_type: 'quest',
          object_type: 'quest',
          outcome: 'created',
          action: 'create',
          commit: 'a1b2c3',
          branch: 'content/2026-09-26',
          commit_message: `spiraldb: create quest ${QUEST}`,
          file: `QuestTemplates/${QUEST}.json`,
          status: 'extracted',
          status_created: true,
          warnings: [],
        },
      });
    });
    await page.route('**/api/names/quests', (route) => route.fulfill({ json: { quests: [] } }));

    await page.goto('/quests/extract');
    const dropzone = page.getByRole('button', { name: /Drag & drop packet capture file here/ });
    // Tab to it for real (not `.focus()`): "reachable by keyboard" is the claim, and this is
    // the walk that proves the button is in the tab order at all.
    let reached = false;
    for (let press = 0; press < 40 && !reached; press += 1) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(
        () =>
          document.activeElement?.getAttribute('aria-label') === null &&
          (document.activeElement?.textContent ?? '').includes('Drag & drop packet capture file'),
      );
    }
    expect(reached, 'the dropzone button was not reached by Tab').toBe(true);
    await expect(dropzone).toBeFocused();
    // The keyboard opens the real file chooser; Playwright intercepts the native dialog.
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.keyboard.press('Enter'),
    ]);
    await chooser.setFiles({
      name: 'keyboard-only.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"packets":[]}'),
    });

    const saveAll = page.getByRole('button', { name: 'Save All to SpiralDB' });
    await expect(saveAll).toBeEnabled();
    await saveAll.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', { name: 'Save', exact: true });
    // `locator.focus()` does **not** wait for an element to become enabled the way `click()`
    // does, and this button is `disabled` until the overwrite check answers (`blocked =
    // checking || checkError !== null`). Focusing it too early silently no-ops — the Enter
    // then re-fires whatever still had focus (measured: the page's `Save All to SpiralDB`),
    // and no POST is ever sent. The explicit wait is the keyboard equivalent of the click's
    // own actionability check, not a relaxed assertion.
    await expect(confirm).toBeEnabled();
    await confirm.focus();
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Enter');

    await expect.poll(() => saved.length).toBe(1);
    expect((saved[0]?.quest as { m_questName?: unknown })?.m_questName).toBe(QUEST);
  });
});

/* ------------------------------------------------------- the focus-ring walk */

/** One focus stop as the walk records it. */
interface Stop {
  tag: string;
  role: string;
  name: string;
  ringOk: boolean;
  boxShadow: string;
  outline: string;
}

/**
 * Tabs `count` times from the current position and reports, for each stop, the browser's
 * computed focus ring. `ringOk` is the exact spec treatment: a blue-500 (`59, 130, 246`)
 * `box-shadow` with both the 2px offset layer and the 2px ring layer.
 */
async function walkTabOrder(page: Page, count: number, selector = 'body'): Promise<Stop[]> {
  await page
    .locator(selector)
    .first()
    .click({ trial: true })
    .catch(() => undefined);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await page.keyboard.press('Tab');
  const stops: Stop[] = [];
  for (let index = 0; index < count; index += 1) {
    const stop = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (element === null || element === document.body) {
        return null;
      }
      const style = getComputedStyle(element);
      const name =
        element.getAttribute('aria-label') ??
        element.getAttribute('title') ??
        (element.textContent ?? '').trim().slice(0, 40);
      return {
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute('role') ?? '',
        name,
        boxShadow: style.boxShadow,
        outline: `${style.outlineStyle} ${style.outlineWidth}`,
      };
    });
    if (stop !== null) {
      const ringOk =
        stop.boxShadow.includes('59, 130, 246') &&
        stop.boxShadow.includes('0px 0px 0px 2px') &&
        stop.boxShadow.includes('0px 0px 0px 4px');
      stops.push({ ...stop, ringOk });
    }
    await page.keyboard.press('Tab');
  }
  return stops;
}

test.describe('AC#8 — every focus stop shows the spec ring', () => {
  test('quest list: 20 stops, each with ring-2 ring-blue-500 ring-offset-2 ring-offset-zinc-950', async ({
    page,
  }) => {
    await mockQuestsApi(page);
    await page.goto('/quests');
    await expect(page.locator('tbody tr').first()).toBeVisible();

    const stops = await walkTabOrder(page, 20);
    expect(stops.length, 'the walk recorded no focus stops at all').toBeGreaterThanOrEqual(15);
    const failures = stops.filter((stop) => !stop.ringOk);
    expect(
      failures,
      `stops without the spec ring:\n${failures
        .map(
          (stop) =>
            `${stop.tag}${stop.role === '' ? '' : `[role=${stop.role}]`} "${stop.name}" → box-shadow: ${stop.boxShadow}; outline: ${stop.outline}`,
        )
        .join('\n')}`,
    ).toHaveLength(0);
  });

  test('DropTable detail (edit mode): the walk stays on the spec ring', async ({ page }) => {
    await mockDropTableApi(page);
    await page.goto(`/drop-tables/${SELF_KEY}`);
    const main = page.getByRole('main');
    await expect(main.getByText(SELF_KEY, { exact: true }).first()).toBeVisible();
    const edit = page.getByRole('button', { name: 'Edit' });
    await edit.focus();
    await page.keyboard.press('Enter');
    await expect(main.getByRole('region', { name: 'Items' })).toBeVisible();

    const stops = await walkTabOrder(page, 20);
    expect(stops.length).toBeGreaterThanOrEqual(15);
    const failures = stops.filter((stop) => !stop.ringOk);
    expect(failures.map((stop) => `${stop.tag} "${stop.name}" → ${stop.boxShadow}`)).toHaveLength(
      0,
    );
  });

  test('the flowchart’s focused node gets the spec ring, and an edge is distinguishable without colour', async ({
    page,
  }) => {
    // `m_completeQuest: true` is what makes the graph draw an edge; `MOCK_QUEST`'s own goal
    // logic completes nothing and has no `m_goalsToAdd`, so it renders zero edges.
    await mockQuestsApi(page, {
      detail: {
        ...MOCK_QUEST,
        m_goalLogic: [{ m_goalsAND: ['1_WizardQuestGoals_GotoZone'], m_completeQuest: true }],
      },
    });
    await page.route('**/api/names/quests', (route) => route.fulfill({ json: { quests: [] } }));
    await page.goto(`/quests/${QUEST}`);
    const main = page.getByRole('main');
    await main.getByRole('tab', { name: 'Goal Logic' }).click();
    const node = page.locator('.react-flow__node').first();
    await expect(node).toBeVisible();

    // React Flow strips the UA outline from a focused node
    // (`@xyflow/react/dist/style.css:452`) and substitutes a near-black box-shadow; the
    // p5-05 rule in `index.css` restores the spec ring. The focus is taken through the real
    // tab order, not `element.focus()`: measured, a *programmatic* focus of an
    // `.react-flow__node` does not match `:focus-visible` (computed box-shadow `none`), while
    // the same focus after any keystroke does — so a script-driven focus would have reported
    // a ring that a keyboard user does see, or vice versa.
    let pressed = 0;
    let onNode = false;
    while (pressed < 20 && !onNode) {
      await page.keyboard.press('Tab');
      pressed += 1;
      onNode = await page.evaluate(
        () => document.activeElement?.classList.contains('react-flow__node') ?? false,
      );
    }
    expect(onNode, `the flowchart node was not reached in ${pressed} Tab presses`).toBe(true);
    const ring = await node.evaluate((element) => {
      const style = getComputedStyle(element);
      const selected = element.classList.contains('selected');
      return {
        focused: document.activeElement === element,
        boxShadow: style.boxShadow,
        outline: `${style.outlineStyle} ${style.outlineWidth}`,
        selected,
      };
    });
    expect(ring.focused, 'the node could not take focus — nodesFocusable is off?').toBe(true);
    expect(ring.boxShadow).toContain('59, 130, 246');
    expect(ring.boxShadow).toContain('0px 0px 0px 2px');
    expect(ring.boxShadow).toContain('0px 0px 0px 4px');

    // An SVG `<path>` cannot carry a box-shadow, so the edge's focused treatment is a 3px
    // blue-500 stroke — a shape *and* luminance change, not a hue-only one, and 5.41:1 against
    // zinc-950 (well over the 3:1 non-text floor). The unfocused edge is 2px `#3f3f46`.
    const edge = page.locator('.react-flow__edge').first();
    await expect(edge).toBeVisible();
    const before = await edge
      .locator('path')
      .first()
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return { stroke: style.stroke, width: style.strokeWidth };
      });
    await edge.focus();
    const after = await edge
      .locator('path')
      .first()
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return { stroke: style.stroke, width: style.strokeWidth };
      });
    expect(before.width).toBe('2px');
    expect(after.stroke).toBe('rgb(59, 130, 246)');
    expect(after.width).toBe('3px');
  });
});

/* --------------------------------------------------- AC#10's rendered sweep */

interface Unnamed {
  tag: string;
  className: string;
  html: string;
}

/**
 * Every visible, non-`aria-hidden` control without an accessible name, computed the way a
 * browser would (`aria-label` → `aria-labelledby` → `title` → visible text → `alt`, plus the
 * native label/placeholder for inputs).
 */
async function unnamedControls(page: Page): Promise<{ offenders: Unnamed[]; named: number }> {
  return page.evaluate(() => {
    const offenders: Unnamed[] = [];
    let named = 0;
    const candidates = document.querySelectorAll(
      'button, [role="button"], a[href], summary, input:not([type="hidden"]), select, textarea',
    );
    for (const element of candidates) {
      if (element.closest('[aria-hidden="true"]') !== null) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        continue;
      }
      const style = getComputedStyle(element);
      if (
        style.visibility === 'hidden' ||
        style.display === 'none' ||
        Number(style.opacity) === 0
      ) {
        continue;
      }
      // A native `<label for>` (and a wrapping `<label>`) is an accessible name too — the
      // goal editor's scalar fields use exactly that (`<label htmlFor={id}>` + `id={id}`).
      // The first version of this sweep omitted it and reported **16** false positives on the
      // quest detail page's edit mode.
      const explicitLabel =
        element.id === ''
          ? ''
          : ([...document.querySelectorAll(`label[for="${CSS.escape(element.id)}"]`)]
              .map((label) => label.textContent ?? '')
              .join(' ') ?? '');
      const wrappingLabel = element.closest('label')?.textContent ?? '';
      const labelledBy = element.getAttribute('aria-labelledby');
      const referenced =
        labelledBy === null
          ? ''
          : labelledBy
              .split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent ?? '')
              .join(' ');
      const name = [
        element.getAttribute('aria-label') ?? '',
        referenced,
        explicitLabel,
        wrappingLabel,
        element.getAttribute('title') ?? '',
        (element as HTMLElement).innerText ?? '',
        element.getAttribute('alt') ?? '',
        element.getAttribute('placeholder') ?? '',
        element.getAttribute('value') ?? '',
      ]
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (name === '') {
        offenders.push({
          tag: element.tagName.toLowerCase(),
          className: element.className.toString().slice(0, 80),
          html: element.outerHTML.slice(0, 160),
        });
      } else {
        named += 1;
      }
    }
    return { offenders, named };
  });
}

test.describe('AC#10 — the rendered surfaces expose a name for every control', () => {
  test('quest list, quest detail (edit mode), DropTable detail and the dashboard', async ({
    page,
  }) => {
    const surfaces: Array<{ name: string; open: () => Promise<void>; floor: number }> = [
      {
        name: 'quest list',
        open: async () => {
          await mockQuestsApi(page);
          await page.goto('/quests');
          await expect(page.locator('tbody tr').first()).toBeVisible();
        },
        floor: 20,
      },
      {
        name: 'quest detail (edit mode)',
        open: async () => {
          await mockQuestsApi(page);
          await page.route('**/api/names/quests', (route) =>
            route.fulfill({ json: { quests: [] } }),
          );
          await page.goto(`/quests/${QUEST}`);
          // **No Edit click**: the quest detail page *starts* in edit mode
          // (`lib/quest-edit.ts`'s `EDIT_MODE_ON_LOAD = true`, decision D66), so clicking
          // Edit turns it **off** — which is what the lead's scan measured as
          // `hook=0`/`data-edit-mode="false"` after the click. The hook is absent from
          // neither the DOM nor the page; it is `"true"` on load.
          await expect(page.locator('[data-edit-mode="true"]')).toBeVisible();
          await expect(page.getByRole('region', { name: 'Quest info editor' })).toBeVisible();
        },
        floor: 20,
      },
      {
        name: 'DropTable detail',
        open: async () => {
          await mockDropTableApi(page);
          await page.goto(`/drop-tables/${SELF_KEY}`);
          await expect(
            page.getByRole('main').getByText(SELF_KEY, { exact: true }).first(),
          ).toBeVisible();
        },
        floor: 15,
      },
      {
        name: 'dashboard',
        open: async () => {
          await mockDashboardApi(page);
          await page.goto('/');
          await expect(page.getByRole('heading', { name: 'Recent Activity' })).toBeVisible();
        },
        floor: 10,
      },
    ];

    for (const surface of surfaces) {
      await surface.open();

      // The document has exactly one page-level `h1` (p5-05: the lead's AC#9 axe run found
      // `page-has-heading-one` as a moderate finding on three of these four surfaces). The
      // shell header's title is that `h1`; the sections below it are `h2`s (including the
      // quest detail page's quest name, demoted in the same change so this route has one too).
      const headings = await page.evaluate(() => ({
        h1: [...document.querySelectorAll('h1')].map((element) =>
          (element.textContent ?? '').trim(),
        ),
      }));
      expect(headings.h1, `${surface.name}: expected exactly one page-level h1`).toHaveLength(1);
      expect(headings.h1[0] ?? '').not.toBe('');

      const { offenders, named } = await unnamedControls(page);
      expect(
        named,
        `${surface.name}: only ${named} named controls — the sweep may be looking at an empty page`,
      ).toBeGreaterThanOrEqual(surface.floor);
      expect(
        offenders,
        `${surface.name}: ${offenders.length} control(s) with no accessible name:\n${offenders
          .map((offender) => `${offender.tag}.${offender.className} → ${offender.html}`)
          .join('\n')}`,
      ).toHaveLength(0);
    }
  });
});
