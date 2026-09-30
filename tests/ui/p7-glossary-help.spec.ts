import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { classes, enums, fields, groups } from '@shared/glossary';

import { mockQuestsApi } from './quests-mocks';

/**
 * Story p7-13's tier-1 specs (plan task 7.12; D131, D144, D180).
 *
 * | criterion | test |
 * |---|---|
 * | 2 — the "What does this mean?" popover opens by keyboard: help, technical name, source | `the popover …` |
 * | 3 — /glossary lists every term; `m_questLevel` and "Quest level" find the same row | `the glossary page …` |
 * | mobile — neither overflows at 375px | `at 375px …` |
 */

const fixture = JSON.parse(
  readFileSync(path.resolve('tests/unit/fixtures/card-titles-quests.json'), 'utf8'),
) as { quests: Record<string, Record<string, unknown>> };
const NAME = Object.keys(fixture.quests)[0] as string;

const TERM_COUNT =
  Object.keys(fields).length +
  Object.keys(classes).length +
  Object.keys(groups).length +
  Object.values(enums).reduce((n, table) => n + Object.keys(table).length, 0);

test('the popover opens by keyboard and shows help, technical name and source', async ({
  page,
}) => {
  await mockQuestsApi(page, {
    onDetail: (route) => route.fulfill({ json: fixture.quests[NAME] }),
  });
  await page.goto(`/quests/${NAME}`);
  const main = page.getByRole('main');
  const trigger = main.getByRole('button', { name: 'What does this mean? Quest level' }).first();
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await page.keyboard.press('Enter');
  const panel = page.getByTestId('term-help');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(fields.m_questLevel.help);
  await expect(panel.locator('[data-term="m_questLevel"]')).toHaveText('m_questLevel');
  await expect(panel).toContainText(fields.m_questLevel.source);
  await expect(panel.getByRole('link', { name: 'See in glossary' })).toHaveAttribute(
    'href',
    '/glossary?term=m_questLevel',
  );
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
  // Space opens it too.
  await page.keyboard.press('Space');
  await expect(panel).toBeVisible();
});

test('the glossary page lists every term and matches either half to the same row', async ({
  page,
}) => {
  await page.goto('/glossary');
  const rows = page.locator('main li[data-term]');
  await expect(rows).toHaveCount(TERM_COUNT);
  const search = page.getByLabel('Search by name or technical name');
  await search.fill('m_questLevel');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute('data-term', 'm_questLevel');
  await search.fill('Quest level');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute('data-term', 'm_questLevel');
  await search.fill('QUEST LEVEL');
  await expect(rows.first()).toHaveAttribute('data-term', 'm_questLevel');
  await search.fill('');
  await page.getByLabel('Kind').selectOption('class');
  await expect(rows).toHaveCount(Object.keys(classes).length);
  await page.goto('/glossary?term=m_questLevel');
  await expect(page.locator('li[data-selected="true"]')).toHaveAttribute(
    'data-term',
    'm_questLevel',
  );
});

test('at 375px the popover and the glossary page do not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/glossary');
  await page.getByLabel('Search by name or technical name').fill('m_questLevel');
  const overflow = (): Promise<boolean> =>
    page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
  expect(await overflow()).toBe(false);
  await mockQuestsApi(page, {
    onDetail: (route) => route.fulfill({ json: fixture.quests[NAME] }),
  });
  await page.goto(`/quests/${NAME}`);
  await page
    .getByRole('main')
    .getByRole('button', { name: 'What does this mean? Quest level' })
    .first()
    .click();
  const box = await page.getByTestId('term-help').boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= 375).toBe(true);
  expect(await overflow()).toBe(false);
});
