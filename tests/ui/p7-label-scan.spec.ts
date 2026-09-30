import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { classes, enums, fields } from '@shared/glossary';
import { KNOWN_TYPE_STRINGS } from '@shared/quest/typeConstants';

import { MOCK_EVIDENCE } from './quests-mocks';

/**
 * Story p7-10's label scanner (plan task 7.9; D131, D135).
 *
 * Every quest tab renders its field keys, class names and enum literals through `<TermLabel />`,
 * whose `[data-term]` wrapper is the one place a technical string may be visible. This spec opens
 * **real quests from the D17 clone**, served from committed copies of their documents (CI has no
 * `data/`, D55 — gate-7 measured every test here failing there when they were read live; the copies
 * equal the clone-backed server's bodies byte for byte, so nothing the scan sees changed) and, on
 * every tab except JSON (exempt by design), in edit mode and in view mode, collects:
 *
 * - every visible text node **outside** `[data-term]`;
 * - every `<option>`'s text (a native option cannot hold a span, so its text is the pair string);
 * - every `aria-label`, `title` and `placeholder` (criterion 1: aria labels derive from the glossary).
 *
 * and asserts that none of them, trimmed, **exactly** equals a glossary field key, a class name
 * (short, and every assembly-qualified `KNOWN_TYPE_STRINGS` entry) or an enum literal. Exact
 * matching is the plan's rule: it cannot trip on words like "Results" or "Required". A term whose
 * friendly label *is* its technical name renders once under D135, so it is allowlisted — computed
 * from the glossary, never listed by hand.
 *
 * The quests (measured on the clone): `WC-CYCLOPS-MAIN-003` has four of the five goal classes, seven
 * goal-logic entries, two requirement classes, a drop-table result and dialog; `WC-TUT-C05-001` adds
 * the AchieveRank goal and goal-level results (ResPlaySound, ResAddDynaMod, ResDespawn, ResPostEvent,
 * ResWait); `WC-COMMONS-MAIN-001` the quest-level ResAddDynaMod and ResModifyEntry;
 * `WC-COMMONS-MAIN-003` ReqHasEntry; `Tutorial_Intro` ReqSchoolOfFocus and ResLearnSpell;
 * `WC-UNICORN-MAIN-004` a Bounty goal carrying an enum value (`m_bountyType: BT_MOB_KILL`, one of
 * the 5 clone goals that set it), which the card's summary line shows.
 */

const QUESTS = [
  'WC-CYCLOPS-MAIN-003',
  'WC-TUT-C05-001',
  'WC-COMMONS-MAIN-001',
  'WC-COMMONS-MAIN-003',
  'Tutorial_Intro',
  'WC-UNICORN-MAIN-004',
] as const;

/** The six quests' served documents: five from the 10-quest fixture, WC-CYCLOPS-MAIN-003 alone. */
const DOCS: Record<string, unknown> = {
  ...(
    JSON.parse(
      readFileSync(path.resolve('tests/unit/fixtures/card-titles-quests.json'), 'utf8'),
    ) as { quests: Record<string, unknown> }
  ).quests,
  'WC-CYCLOPS-MAIN-003': (
    JSON.parse(
      readFileSync(
        path.resolve('tests/unit/fixtures/clone-quest-WC-CYCLOPS-MAIN-003.json'),
        'utf8',
      ),
    ) as { quest: unknown }
  ).quest,
};

const TABS = ['Info', 'Goals', 'Goal Logic', 'Requirements', 'Results', 'Dialog'] as const;

/** A term is allowlisted when its pair collapses to one value (D135): label equals technical. */
function technicalTerms(): { terms: string[]; allowlisted: string[] } {
  const terms = new Set<string>();
  const allowlisted = new Set<string>();
  const add = (technical: string, label: string | undefined): void => {
    if (label === technical) {
      allowlisted.add(technical);
    } else {
      terms.add(technical);
    }
  };
  for (const [key, entry] of Object.entries(fields)) {
    add(key, entry.label);
  }
  for (const [name, entry] of Object.entries(classes)) {
    add(name, entry.label);
  }
  // The assembly-qualified strings never collapse: TermLabel shows a class by its short name.
  for (const typeString of KNOWN_TYPE_STRINGS) {
    terms.add(typeString);
  }
  for (const table of Object.values(enums)) {
    for (const [literal, entry] of Object.entries(table)) {
      add(literal, entry.label);
    }
  }
  return { terms: [...terms], allowlisted: [...allowlisted] };
}

const { terms: TERMS, allowlisted: ALLOWLISTED } = technicalTerms();

interface Hit {
  where: 'text' | 'option' | 'aria-label' | 'title' | 'placeholder';
  text: string;
  context: string;
}

/**
 * Collects every exact hit under `scope` (the page body minus the JSON rail). Runs in the page:
 * a TreeWalker over text nodes, skipping `[data-term]` subtrees and anything not rendered.
 */
async function scan(page: Page): Promise<Hit[]> {
  return page.evaluate((terms: string[]) => {
    const set = new Set(terms);
    const hits: Array<{ where: string; text: string; context: string }> = [];
    const exempt = (el: Element): boolean =>
      el.closest('[data-term]') !== null || el.closest('[data-json-exempt]') !== null;
    const visible = (el: Element): boolean => {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const context = (el: Element): string => {
      const html = el.outerHTML;
      return html.length > 160 ? `${html.slice(0, 160)}…` : html;
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const parent = node.parentElement;
      const text = (node.textContent ?? '').trim();
      if (parent === null || text === '' || !set.has(text)) {
        continue;
      }
      if (parent.closest('option') !== null || exempt(parent) || !visible(parent)) {
        continue;
      }
      hits.push({ where: 'text', text, context: context(parent) });
    }
    for (const option of document.querySelectorAll('select option')) {
      const select = option.closest('select');
      const text = (option.textContent ?? '').trim();
      if (select !== null && set.has(text) && !exempt(select) && visible(select)) {
        hits.push({ where: 'option', text, context: context(select) });
      }
    }
    for (const attr of ['aria-label', 'title', 'placeholder'] as const) {
      for (const el of document.querySelectorAll(`[${attr}]`)) {
        const text = (el.getAttribute(attr) ?? '').trim();
        if (set.has(text) && !exempt(el)) {
          hits.push({ where: attr, text, context: context(el) });
        }
      }
    }
    return hits;
  }, TERMS) as Promise<Hit[]>;
}

function main_(page: Page): Locator {
  return page.getByRole('main');
}

function tabPanel(page: Page): Locator {
  return main_(page).getByRole('tabpanel').first();
}

/**
 * Opens every collapsed disclosure in the tab (goal field groups, dialog sections, requirement
 * nodes), so the scan reads the labels a user reaches in one click, not only the first screen.
 * Comboboxes and menu/listbox/dialog triggers are left shut: they open popups over the form.
 */
async function expandAll(page: Page): Promise<void> {
  for (let round = 0; round < 6; round += 1) {
    const opened = await tabPanel(page).evaluate((panel) => {
      let count = 0;
      for (const details of panel.querySelectorAll('details:not([open])')) {
        (details as HTMLDetailsElement).open = true;
        count += 1;
      }
      for (const button of panel.querySelectorAll('button[aria-expanded="false"]')) {
        if (button.getAttribute('role') === 'combobox' || button.hasAttribute('aria-haspopup')) {
          continue;
        }
        (button as HTMLButtonElement).click();
        count += 1;
      }
      return count;
    });
    if (opened === 0) {
      return;
    }
    await page.waitForTimeout(50);
  }
}

/** Goal Logic keeps its fields in an inspector: select the first listed entry to open it. */
async function openGoalLogicInspector(page: Page): Promise<void> {
  const entry = tabPanel(page).getByRole('button', { name: /^Entry 1:/ });
  if ((await entry.count()) > 0) {
    await entry.first().click();
  }
}

async function selectTab(page: Page, name: (typeof TABS)[number]): Promise<void> {
  await main_(page).getByRole('tab', { name, exact: true }).click();
  await expect(main_(page).getByRole('tab', { name, exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  if (name === 'Goal Logic') {
    // The edit-mode flowchart is a lazy chunk behind a Suspense fallback: wait for it to mount
    // (a cold first load in the full suite takes longer than any fixed pause).
    await expect(main_(page).getByText('Loading flowchart…')).toHaveCount(0);
    const editMode = await main_(page).locator('[data-edit-mode="true"]').count();
    if (editMode > 0) {
      await expect(main_(page).getByRole('group', { name: 'Goal logic flowchart' })).toBeVisible();
      await expect(main_(page).locator('.react-flow__node').first()).toBeVisible();
    }
  }
}

async function openQuest(page: Page, quest: string): Promise<void> {
  // The harness DB has no string table (`SPIRALDB_UI_SKIP_IMPORT`), so the evidence body is the
  // wire-contract fixture, and the document is the committed copy of the clone file; every other
  // request reaches the real server.
  await page.route(`**/api/quests/${quest}`, (route) => route.fulfill({ json: DOCS[quest] }));
  await page.route(`**/api/quests/${quest}/evidence`, (route) =>
    route.fulfill({ json: { ...MOCK_EVIDENCE, quest_name: quest } }),
  );
  await page.goto(`/quests/${quest}`);
  await expect(main_(page).locator('[data-edit-mode]')).toBeVisible();
}

/** Scans every tab in the current mode; returns hits labelled with the tab. */
async function scanTabs(page: Page, mode: string, coverage: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const name of TABS) {
    await selectTab(page, name);
    if (name === 'Goal Logic' && mode === 'edit') {
      await openGoalLogicInspector(page);
    }
    const record = async (where: string): Promise<void> => {
      await expandAll(page);
      // Not vacuous: the tab rendered its labels through TermLabel (a tab that failed to load, or
      // a scan of the wrong panel, would show none), unless it is the read-only body's own empty
      // state (`WC-TUT-C05-001` and `Tutorial_Intro` carry no goal-logic entries). The count goes
      // into the log.
      const terms = await tabPanel(page).locator('[data-term]').count();
      const empty = /has no goal logic entries|defines no goals/.test(
        (await tabPanel(page).textContent()) ?? '',
      );
      coverage.push(`${mode}/${where}: ${terms} [data-term]${empty ? ' (empty state)' : ''}`);
      expect(terms > 0 || empty, `${mode}/${where} renders labels through TermLabel`).toBe(true);
      for (const hit of await scan(page)) {
        found.push(`[${mode}/${where}] ${hit.where} "${hit.text}" in ${hit.context}`);
      }
    };
    await record(name);
    if (name === 'Goals' && mode === 'edit') {
      // A goal card's editor opens one card at a time (its "Edit" button is not a disclosure),
      // so every card is opened and scanned in turn.
      const cards = tabPanel(page).getByRole('article');
      const count = await cards.count();
      for (let index = 0; index < count; index += 1) {
        await cards.nth(index).getByRole('button', { name: 'Edit', exact: true }).click();
        await record(`${name}#${index + 1}`);
      }
    }
  }
  return found;
}

test.describe('p7-10 label scan — no bare technical term outside [data-term]', () => {
  test('the term lists come from the glossary, with the D135 allowlist computed', () => {
    // Every allowlisted term is one whose pair collapsed; none is a document key (all keys pair).
    expect(TERMS.length).toBeGreaterThan(200);
    expect(ALLOWLISTED.every((term) => !term.startsWith('m_'))).toBe(true);
    console.log(`scanned terms: ${TERMS.length}; D135 allowlist: ${ALLOWLISTED.join(', ')}`);
  });

  for (const quest of QUESTS) {
    test(`${quest}: every tab, edit and view mode, and the Evidence "Insert into" line`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await openQuest(page, quest);
      const coverage: string[] = [];
      const found = await scanTabs(page, 'edit', coverage);

      // The Evidence rail's target line: focus a goal field so "Insert into" names a field.
      await selectTab(page, 'Goals');
      await page.getByRole('button', { name: 'Toggle evidence panel' }).click();
      const target = page.getByTestId('evidence-target');
      await expect(target).toBeVisible();
      // Focus inside the first goal card: the card reports its goal as the insert target.
      await tabPanel(page).getByRole('article').first().getByRole('button').first().focus();
      // The line names the field by its pair and its place in words; the path is only data-path.
      await expect(target).toContainText('Insert into: Goal text (m_goalText) in Goals 1');
      await expect(target.locator('[data-path]')).toHaveAttribute(
        'data-path',
        'm_goals[0].m_goalText',
      );
      await expect(target).not.toContainText('m_goals[0]');
      for (const hit of await scan(page)) {
        found.push(`[edit/Evidence] ${hit.where} "${hit.text}" in ${hit.context}`);
      }
      await page.getByRole('button', { name: 'Toggle evidence panel' }).click();

      // The mode toggle: on Info no goal card's own "Edit" button is in the tree.
      await selectTab(page, 'Info');
      await main_(page).getByRole('button', { name: 'Edit', exact: true }).click();
      await expect(main_(page).locator('[data-edit-mode="false"]')).toBeVisible();
      found.push(...(await scanTabs(page, 'view', coverage)));

      console.log(`${quest}: ${coverage.join('; ')}`);
      console.log(`${quest}: ${found.length} hit(s)\n${found.join('\n')}`);
      expect(found).toEqual([]);
    });
  }
});

/**
 * The Overview tab (task 7.13), added after this scanner was written, so the Phase 7 acceptance box
 * "no bare technical label in any quest tab except JSON" has a raw scan of it too (PR #14 review 9m).
 * It is read-only prose — goal ids are secondary mono text, not terms — so its non-vacuity check is
 * its own content (the steps list), not a `[data-term]` count.
 */
test.describe('p7-10 label scan — the Overview tab', () => {
  for (const quest of QUESTS) {
    test(`${quest}: Overview, edit and view mode`, async ({ page }) => {
      await openQuest(page, quest);
      const found: string[] = [];
      for (const mode of ['edit', 'view'] as const) {
        if (mode === 'view') {
          await main_(page).getByRole('button', { name: 'Edit', exact: true }).click();
          await expect(main_(page).locator('[data-edit-mode="false"]')).toBeVisible();
        }
        await main_(page).getByRole('tab', { name: 'Overview', exact: true }).click();
        const overview = main_(page).getByRole('region', { name: 'Quest overview' });
        await expect(overview).toBeVisible();
        await expect(overview.getByTestId('overview-completes')).toBeVisible();
        for (const hit of await scan(page)) {
          found.push(`[${mode}/Overview] ${hit.where} "${hit.text}" in ${hit.context}`);
        }
      }
      console.log(`${quest}: Overview ${found.length} hit(s)\n${found.join('\n')}`);
      expect(found).toEqual([]);
    });
  }
});

/**
 * Criterion 3's mobile arm: at 375px the pairs are longer than the bare keys they replaced, so they
 * must wrap rather than widen the page. On every tab of the two widest quests, in both modes and
 * with every disclosure open, the document does not scroll sideways and no `[data-term]` label
 * reaches past the viewport outside a horizontal scroll container of its own (a JSON `<pre>`, the
 * flowchart canvas).
 */
test.describe('p7-10 label pairs at 375px', () => {
  for (const quest of ['WC-CYCLOPS-MAIN-003', 'WC-COMMONS-MAIN-001'] as const) {
    test(`${quest}: no tab overflows horizontally`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 375, height: 800 });
      await openQuest(page, quest);
      const report: string[] = [];
      for (const mode of ['edit', 'view'] as const) {
        if (mode === 'view') {
          await selectTab(page, 'Info');
          await main_(page).getByRole('button', { name: 'Edit', exact: true }).click();
          await expect(main_(page).locator('[data-edit-mode="false"]')).toBeVisible();
        }
        for (const name of TABS) {
          await selectTab(page, name);
          if (name === 'Goals' && mode === 'edit') {
            await tabPanel(page)
              .getByRole('article')
              .first()
              .getByRole('button', {
                name: 'Edit',
                exact: true,
              })
              .click();
          }
          await expandAll(page);
          const measured = await page.evaluate(() => {
            const viewport = document.documentElement.clientWidth;
            const scrolls = (element: Element): boolean => {
              for (let node = element.parentElement; node !== null; node = node.parentElement) {
                const overflowX = getComputedStyle(node).overflowX;
                if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden') {
                  return true;
                }
              }
              return false;
            };
            const offenders = [...document.querySelectorAll('[data-term]')]
              .filter((element) => {
                const rect = element.getBoundingClientRect();
                return rect.width > 0 && Math.round(rect.right) > viewport && !scrolls(element);
              })
              .map((element) => element.textContent ?? '');
            return {
              scrollWidth: document.documentElement.scrollWidth,
              clientWidth: viewport,
              terms: document.querySelectorAll('[data-term]').length,
              offenders,
            };
          });
          report.push(
            `${mode}/${name}: scrollWidth ${measured.scrollWidth} / clientWidth ${measured.clientWidth}, ` +
              `${measured.terms} [data-term], ${measured.offenders.length} past the edge`,
          );
          expect(measured.offenders, `${mode}/${name} labels past the viewport`).toEqual([]);
          expect(measured.scrollWidth, `${mode}/${name} scrolls sideways`).toBeLessThanOrEqual(
            measured.clientWidth,
          );
        }
      }
      console.log(`${quest} @375px\n${report.join('\n')}`);
    });
  }
});
