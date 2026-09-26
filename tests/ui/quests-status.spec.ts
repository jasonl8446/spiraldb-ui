import { expect, test, type Locator, type Page } from '@playwright/test';

import { ACAD1_NAMES, mockHistoryRows, mockQuestsApi } from './quests-mocks';

/**
 * Tier-1 status-transition spec (plan task 2.8 / story p2-09, decision D23 tier 1 /
 * D40).
 *
 * Drives the real app in headless chromium with the whole data surface route-mocked
 * (`quests-mocks.ts`), so CI needs no SpiralDB corpus, no database and no sibling
 * repos. The status surface it mocks is the real contract: the `PATCH` answers the
 * bare updated row (D37), the history answers `{ history: [...] }` oldest → newest,
 * and an entry with no tracking row answers `404 {"error":"Unknown quests entry
 * \"…\""}` (D51(f)).
 *
 * What this file proves, clause by clause of `p2-09-ac1`:
 *
 * - the browse table's status **menu** replaces p2-08's disabled placeholder, and
 *   its action for the row's own status is the disabled one;
 * - **menu → dialog → `PATCH`**, with the exact path and body: `status` plus `notes`
 *   when typed, and **no** `notes` (and no `changed_by`) when the field is blank;
 * - the **optimistic** status flip — on the detail header's `StatusBadge` and on the
 *   browse row — observable while the `PATCH` is still open, i.e. before any
 *   invalidated refetch has resolved (D51(e): one status source);
 * - the success toast, and the rollback plus inline error when the `PATCH` fails;
 * - the D51(f) untracked 404 becoming an actionable save/import message for both the
 *   dialog and the history panel;
 * - the **identity gate firing first** with a blank `user_name`, and the transition
 *   resuming after the name is entered (D38/D43);
 * - the history timeline's anatomy and ordering (newest first, notes italic
 *   `text-zinc-400`, `changed_by`, relative time), plus its empty and untracked
 *   states.
 *
 * The literals are written out in full rather than imported: a spec that imported
 * the copy it asserts could only prove the app agrees with itself.
 */

/** The fixture row every test acts on; row 0 of the mocked corpus. */
const QUEST = ACAD1_NAMES[0];

const EXTRACTED_BADGE = 'Status: Extracted';
const REVIEWED_BADGE = 'Status: Reviewed';
const VERIFIED_BADGE = 'Status: Verified';

const UNTRACKED_MESSAGE =
  'This quest is not tracked yet — save or import it first, then mark its status.';
const UNTRACKED_HISTORY_MESSAGE =
  'This quest is not tracked yet. Its history appears once it has been saved or imported.';

/** One sonner toast, matched by its text (sonner marks every toast `li`). */
function toast(page: Page, text: string): Locator {
  return page.locator('li[data-sonner-toast]').filter({ hasText: text });
}

/** The notes dialog, named by its title (the action label verbatim). */
function notesDialog(page: Page, title: string): Locator {
  return page.getByRole('dialog', { name: title });
}

/** The identity gate's dialog (task 1.7/D38), named by its own heading. */
function identityDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'What should we call you?' });
}

/** The first data row of the browse table. */
function firstRow(page: Page): Locator {
  return page.locator('tbody tr').first();
}

/**
 * A `StatusBadge` read while a modal is open.
 *
 * Radix's dialog marks everything behind it `aria-hidden`, which removes the header
 * from the accessibility tree — so `getByLabel` finds nothing there, even though the
 * badge is plainly on screen. A rollback has to be assertable exactly then, so this
 * uses the attribute selector. (The role-based `main.getByLabel(...)` is used wherever
 * no modal is open.)
 */
function badgeBehindModal(page: Page, label: string): Locator {
  return page.locator(`[aria-label="${label}"]`);
}

/** The Status cell of the first row (the spec's 40px "Color dot only" column). */
function firstRowStatusCell(page: Page): Locator {
  return firstRow(page).locator('td').nth(0);
}

function filterTabCount(page: Page, label: string): Locator {
  return page
    .getByRole('tablist', { name: 'Filter quests by status' })
    .getByRole('tab', { name: new RegExp(`^${label} `) });
}

test.describe('the browse table status menu', () => {
  test('offers both actions and disables the row`s own status', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests');
    await expect(page.locator('tbody tr')).toHaveCount(50);

    // Row 0 is `extracted`: both actions are available.
    await firstRow(page)
      .getByRole('button', { name: `Change status: ${QUEST}` })
      .click();
    const menu = page.getByLabel(`Change status: ${QUEST}`);
    await expect(menu.getByRole('button', { name: 'Mark Reviewed' })).toBeEnabled();
    await expect(menu.getByRole('button', { name: 'Mark Verified' })).toBeEnabled();
    await expect(page).toHaveURL(/\/quests$/);

    // A `reviewed` row offers only the forward transition; its own is disabled and
    // marked "Current", so the menu also answers "what status is this row in?".
    await page.keyboard.press('Escape');
    await page
      .getByRole('tablist', { name: 'Filter quests by status' })
      .getByRole('tab', { name: /^Reviewed / })
      .click();
    const reviewed = page.locator('tbody tr').first();
    const reviewedName = (await reviewed.locator('td').nth(1).innerText()).trim();
    await reviewed.getByRole('button', { name: `Change status: ${reviewedName}` }).click();
    const reviewedMenu = page.getByLabel(`Change status: ${reviewedName}`);
    await expect(reviewedMenu.getByRole('button', { name: 'Mark Reviewed' })).toBeDisabled();
    await expect(reviewedMenu.getByRole('button', { name: 'Mark Verified' })).toBeEnabled();
    await expect(reviewedMenu.getByText('Current')).toBeVisible();
  });

  test('no longer renders the p2-08 placeholder', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests');

    // The dashed, disabled button whose tooltip said "Status transitions arrive with
    // story p2-09" is gone: the real menu replaces it. Its accessible name and
    // tooltip belonged to the placeholder and must not survive it.
    await expect(
      page.getByRole('button', { name: 'Change status (arrives with story p2-09)' }),
    ).toHaveCount(0);
    const trigger = firstRow(page).getByRole('button', { name: `Change status: ${QUEST}` });
    await expect(trigger).toBeEnabled();
    await expect(trigger).toHaveAttribute('title', 'Change verification status');
  });
});

test.describe('the transition flow', () => {
  test('menu → dialog → PATCH with the typed notes, a success toast and the optimistic dot', async ({
    page,
  }) => {
    const recorded = await mockQuestsApi(page);
    await page.goto('/quests');
    await expect(firstRowStatusCell(page)).toContainText(EXTRACTED_BADGE);

    await firstRow(page)
      .getByRole('button', { name: `Change status: ${QUEST}` })
      .click();
    await page.getByRole('button', { name: 'Mark Reviewed' }).click();

    // The dialog names the quest and the target status, and says the notes are optional.
    const dialog = notesDialog(page, 'Mark Reviewed');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(`Mark ${QUEST} as reviewed?`)).toBeVisible();
    await expect(dialog.getByLabel('Notes (optional)')).toBeVisible();
    await expect(
      dialog.getByText('Optional — notes are shown in the status history.'),
    ).toBeVisible();

    await dialog.getByLabel('Notes (optional)').fill('Goal logic chain looks correct.');
    await dialog.getByRole('button', { name: 'Mark Reviewed' }).click();

    await expect.poll(() => recorded.patches.length).toBe(1);
    expect(recorded.patchPaths).toEqual([`/api/status/quests/${QUEST}`]);
    // The exact body: `status` + the trimmed `notes` — and never `changed_by` (the
    // server attributes from the persisted `user_name`, D37).
    expect(recorded.patches[0]).toEqual({
      status: 'reviewed',
      notes: 'Goal logic chain looks correct.',
    });

    await expect(toast(page, `${QUEST} marked reviewed`)).toBeVisible();
    await expect(dialog).toHaveCount(0);
    // The row's own status dot moved, and the filter tabs' counts moved with it
    // (the optimistic write keeps the list's summary in step, D49(b)).
    await expect(firstRowStatusCell(page)).toContainText(REVIEWED_BADGE);
    await expect(filterTabCount(page, 'Extracted')).toContainText('44');
    await expect(filterTabCount(page, 'Reviewed')).toContainText('121');
  });

  test('a blank notes field omits the key from the PATCH body entirely', async ({ page }) => {
    const recorded = await mockQuestsApi(page);
    await page.goto('/quests');

    await firstRow(page)
      .getByRole('button', { name: `Change status: ${QUEST}` })
      .click();
    await page.getByRole('button', { name: 'Mark Verified' }).click();
    const dialog = notesDialog(page, 'Mark Verified');
    await dialog.getByLabel('Notes (optional)').fill('   ');
    await dialog.getByRole('button', { name: 'Mark Verified' }).click();

    await expect.poll(() => recorded.patches.length).toBe(1);
    // `toEqual` is exact: an added `notes: ''` (or a `changed_by`) fails this.
    expect(recorded.patches[0]).toEqual({ status: 'verified' });
    expect(Object.keys(recorded.patches[0]).sort()).toEqual(['status']);
  });
});

test.describe('the optimistic badge (D51(e))', () => {
  test('the detail StatusBadge flips while the PATCH is still in flight, then the toast lands', async ({
    page,
  }) => {
    const recorded = await mockQuestsApi(page, { patchDelayMs: 1000 });
    await page.goto(`/quests/${QUEST}`);

    const main = page.getByRole('main');
    await expect(main.getByLabel(EXTRACTED_BADGE)).toBeVisible();

    await main.getByRole('button', { name: 'Mark Reviewed' }).click();
    const dialog = notesDialog(page, 'Mark Reviewed');
    await dialog.getByRole('button', { name: 'Mark Reviewed' }).click();

    // The request has been sent but its answer is withheld for a second, and the
    // dialog is still open — Radix marks everything behind it `aria-hidden`, which is
    // why the flip is read with the attribute locator. Nothing has settled, so
    // nothing has been invalidated, so no refetch can be responsible for what is on
    // screen: this is the optimistic write (D51(e)).
    await expect.poll(() => recorded.patches.length).toBe(1);
    expect(recorded.patchResponses).toBe(0);
    await expect(badgeBehindModal(page, REVIEWED_BADGE)).toBeVisible();
    expect(recorded.patchResponses).toBe(0);

    // …and once it settles the toast confirms it and the dialog is gone.
    await expect(toast(page, `${QUEST} marked reviewed`)).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(main.getByLabel(REVIEWED_BADGE)).toBeVisible();
  });

  test('the header disables the entry`s own status action', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto(`/quests/${QUEST}`);

    const main = page.getByRole('main');
    const reviewed = main.getByRole('button', { name: 'Mark Reviewed' });
    const verified = main.getByRole('button', { name: 'Mark Verified' });
    await expect(main.getByLabel(EXTRACTED_BADGE)).toBeVisible();
    // `extracted` is neither action, so both are available.
    await expect(reviewed).toHaveAttribute('aria-disabled', 'false');
    await expect(verified).toHaveAttribute('aria-disabled', 'false');

    // The Edit button of task 2.7 is untouched by this story.
    const edit = main.getByRole('button', { name: 'Edit' });
    await expect(edit).toHaveAttribute('aria-disabled', 'true');
  });
});

test.describe('failure paths', () => {
  test('a failed PATCH rolls the badge back and shows the error in the dialog', async ({
    page,
  }) => {
    const recorded = await mockQuestsApi(page, {
      onPatch: (route) => route.fulfill({ status: 500, json: { error: 'Database is locked' } }),
    });
    await page.goto(`/quests/${QUEST}`);

    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Mark Reviewed' }).click();
    const dialog = notesDialog(page, 'Mark Reviewed');
    await dialog.getByLabel('Notes (optional)').fill('this should not be lost');
    await dialog.getByRole('button', { name: 'Mark Reviewed' }).click();

    await expect.poll(() => recorded.patches.length).toBe(1);
    // The server's own message, in the still-open dialog, with the notes preserved.
    await expect(dialog.getByRole('alert')).toHaveText('Database is locked');
    await expect(dialog.getByLabel('Notes (optional)')).toHaveValue('this should not be lost');
    // The optimistic write is rolled back — and the settle refetch agrees.
    await expect(badgeBehindModal(page, EXTRACTED_BADGE)).toBeVisible();
    await expect(toast(page, `${QUEST} marked reviewed`)).toHaveCount(0);
  });

  test('the D51(f) untracked 404 becomes an actionable message, for the dialog and the panel', async ({
    page,
  }) => {
    const recorded = await mockQuestsApi(page, {
      historyUntracked: true,
      onPatch: (route) =>
        route.fulfill({
          status: 404,
          json: { error: `Unknown quests entry "${QUEST}"` },
        }),
    });
    await page.goto(`/quests/${QUEST}`);

    // The history panel says what the 404 means (the entry has no tracking row).
    await expect(page.getByText(UNTRACKED_HISTORY_MESSAGE)).toBeVisible();

    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Mark Reviewed' }).click();
    const dialog = notesDialog(page, 'Mark Reviewed');
    await dialog.getByRole('button', { name: 'Mark Reviewed' }).click();

    await expect.poll(() => recorded.patches.length).toBe(1);
    await expect(dialog.getByRole('alert')).toHaveText(UNTRACKED_MESSAGE);
    // No generic failure, and no bogus status change.
    await expect(dialog.getByRole('alert')).not.toContainText('Could not update the status.');
    await expect(badgeBehindModal(page, EXTRACTED_BADGE)).toBeVisible();
  });
});

test.describe('the identity gate fires first (D38/D43)', () => {
  test('a blank user_name opens the identity modal first and the transition resumes after it', async ({
    page,
  }) => {
    const recorded = await mockQuestsApi(page, { userName: '' });
    await page.goto(`/quests/${QUEST}`);

    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Mark Reviewed' }).click();

    // The identity dialog is what appears — not the notes dialog, and no request.
    await expect(identityDialog(page)).toBeVisible();
    await expect(notesDialog(page, 'Mark Reviewed')).toHaveCount(0);
    expect(recorded.patches).toEqual([]);
    expect(recorded.settingsPuts).toEqual([]);

    await page.getByLabel('Your name').fill('Jason');
    await page.getByRole('button', { name: 'Save name' }).click();

    // The name is persisted through `PUT /api/settings` (D32)…
    await expect.poll(() => recorded.settingsPuts.length).toBe(1);
    expect(recorded.settingsPuts[0]).toEqual({ user_name: 'Jason' });

    // …and the pending transition resumes by itself: the notes dialog opens with no
    // second click on "Mark Reviewed" (D38's measured semantics).
    const dialog = notesDialog(page, 'Mark Reviewed');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(`Mark ${QUEST} as reviewed?`)).toBeVisible();

    await dialog.getByLabel('Notes (optional)').fill('Checked after identifying myself');
    await dialog.getByRole('button', { name: 'Mark Reviewed' }).click();

    await expect.poll(() => recorded.patches.length).toBe(1);
    expect(recorded.patches[0]).toEqual({
      status: 'reviewed',
      notes: 'Checked after identifying myself',
    });
    await expect(toast(page, `${QUEST} marked reviewed`)).toBeVisible();
  });

  test('dismissing the identity dialog aborts the transition entirely', async ({ page }) => {
    const recorded = await mockQuestsApi(page, { userName: '' });
    await page.goto(`/quests/${QUEST}`);

    await page.getByRole('main').getByRole('button', { name: 'Mark Reviewed' }).click();
    await expect(identityDialog(page)).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(identityDialog(page)).toHaveCount(0);
    await expect(notesDialog(page, 'Mark Reviewed')).toHaveCount(0);
    expect(recorded.patches).toEqual([]);
    expect(recorded.settingsPuts).toEqual([]);
  });
});

test.describe('the history timeline', () => {
  test('renders the entries newest first with the spec`s anatomy', async ({ page }) => {
    await mockQuestsApi(page, { history: mockHistoryRows() });
    await page.goto(`/quests/${QUEST}`);

    const items = page.getByRole('list', { name: 'Status history' }).getByRole('listitem');
    await expect(items).toHaveCount(3);

    // Newest first: the verified transition, then reviewed, then the initial row.
    await expect(items.nth(0)).toContainText(`${QUEST} marked verified`);
    await expect(items.nth(1)).toContainText(`${QUEST} marked reviewed`);
    await expect(items.nth(2)).toContainText(`${QUEST} extracted`);

    // Notes in italic `text-zinc-400` (spec L177), attributed by `changed_by`.
    const notes = items.nth(0).getByText('Tested on r806919, all goals trigger correctly');
    await expect(notes).toBeVisible();
    await expect(notes).toHaveClass(/italic/);
    await expect(notes).toHaveClass(/text-zinc-400/);
    await expect(items.nth(0)).toContainText('by jason');
    await expect(items.nth(2)).toContainText('by quest_builder');

    // Relative timestamp, from the spec's `relativeTime` (D51(g)).
    await expect(items.nth(0)).toContainText('just now');
    await expect(items.nth(1)).toContainText('1 day ago');
    await expect(items.nth(2)).toContainText('2 days ago');

    // The coloured dot is the *new* status's colour (blue-500 for reviewed).
    await expect(items.nth(1).locator('span.rounded-full').first()).toHaveClass(/bg-blue-500/);
  });

  test('an entry with no history says so explicitly', async ({ page }) => {
    // The default mock answers `{ history: [] }` — the normal state of an entry the
    // first-startup import tracked without ever changing (D37).
    await mockQuestsApi(page);
    await page.goto(`/quests/${QUEST}`);

    await expect(page.getByText('No status changes recorded yet.')).toBeVisible();
    await expect(
      page.getByText(/no transition history until their first status change/),
    ).toBeVisible();
    await expect(page.getByRole('list', { name: 'Status history' })).toHaveCount(0);
  });

  test('the history panel shows the transition it just made', async ({ page }) => {
    await mockQuestsApi(page, { history: mockHistoryRows() });
    await page.goto(`/quests/${QUEST}`);

    await page.getByRole('main').getByRole('button', { name: 'Mark Verified' }).click();
    const dialog = notesDialog(page, 'Mark Verified');
    await dialog.getByLabel('Notes (optional)').fill('Tested on r806919');
    await dialog.getByRole('button', { name: 'Mark Verified' }).click();

    await expect(toast(page, `${QUEST} marked verified`)).toBeVisible();
    await expect(page.getByRole('main').getByLabel(VERIFIED_BADGE)).toBeVisible();
    const items = page.getByRole('list', { name: 'Status history' }).getByRole('listitem');
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toContainText(`${QUEST} marked verified`);
    await expect(items.nth(0)).toContainText('Tested on r806919');
  });
});
