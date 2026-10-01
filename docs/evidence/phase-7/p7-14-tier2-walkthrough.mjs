// Story p7-14 tier-2 walkthrough (plan Verification step 6; D23 tier 2 via D148).
//
// Drives the REAL app (a throwaway clone-backed server + its Vite client, started by the story and
// stopped by it) with the repo's own pinned Playwright chromium, because the playwright-mcp browser
// cannot launch on this host (D148). Read-only: it never presses Save.
//
//   Overview -> Goals (readable cards, pair labels) -> Dialog (Basic vs Advanced: one collapsed,
//   one auto-opened) -> the "What does this mean?" popover -> /glossary searched by both halves.
//
// Env: BASE (the client URL), QUEST_NAME, OUT (the screenshot directory). Run with
// PLAYWRIGHT_BROWSERS_PATH=$PWD/tools/.playwright-browsers.

import path from 'node:path';

import { chromium } from '@playwright/test';

const BASE = process.env.BASE ?? 'http://localhost:5291';
// The default moved from WC-UNICORN-MAIN-001 at final-verify (FV5): since D195(d) every dialog entry of that quest opens
// Advanced by itself, so its "one collapsed" arm can no longer be shown there.
const QUEST = process.env.QUEST_NAME ?? 'WC-UNICORN-MAIN-002';
const OUT = process.env.OUT ?? 'docs/evidence/phase-7';

// The tab strip animates its colours (transition-colors); wait it out so the selected tab is the one shown.
const shot = async (page, name) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `p7-14-tier2-${name}.png`), fullPage: false });
};
const log = (line) => console.log(`[p7-14 tier-2] ${line}`);
const flat = (text) => text.replace(/\s+/g, ' ').trim();

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  await page.goto(`${BASE}/quests/${QUEST}`);
  const main = page.getByRole('main');
  await main.locator('[data-edit-mode]').waitFor();

  // 1. Overview: the landing tab.
  log(`tabs: ${flat(await main.getByRole('tablist').innerText())}`);
  const selected = await main.getByRole('tab', { selected: true }).innerText();
  log(`landing tab: ${selected}`);
  const overview = main.getByRole('region', { name: 'Quest overview' });
  await overview.waitFor();
  log(`overview: ${flat(await overview.innerText())}`);
  await shot(page, 'overview');

  // 2. Goals: readable card titles, the goal id as secondary text, label pairs.
  await main.getByRole('tab', { name: 'Goals', exact: true }).click();
  await main.getByRole('tabpanel').getByRole('listitem').first().waitFor();
  log(`goals panel: ${flat((await main.getByRole('tabpanel').innerText()).slice(0, 700))}`);
  await shot(page, 'goals');

  // 3. Dialog: each entry's Advanced accordion is collapsed unless a value or an error is in it.
  await main.getByRole('tab', { name: 'Dialog', exact: true }).click();
  const advanced = main.getByRole('tabpanel').getByRole('button', { name: /Advanced/ });
  await advanced.first().waitFor();
  const states = await advanced.evaluateAll((nodes) =>
    nodes.map((node) => ({
      entry: node.closest('[data-path]')?.getAttribute('data-path') ?? null,
      expanded: node.getAttribute('aria-expanded'),
    })),
  );
  log(`dialog Advanced accordions (${states.length}): ${JSON.stringify(states)}`);
  const opened = states.findIndex((state) => state.expanded === 'true');
  const closed = states.findIndex((state) => state.expanded === 'false');
  if (opened < 0 || closed < 0) {
    throw new Error('the Dialog tab shows no collapsed/auto-opened pair to photograph');
  }
  await advanced.nth(closed).scrollIntoViewIfNeeded();
  await shot(page, 'dialog-collapsed');
  await advanced.nth(opened).scrollIntoViewIfNeeded();
  await shot(page, 'dialog-auto-opened');

  // 4. The help popover, opened by keyboard on the Info tab.
  await main.getByRole('tab', { name: 'Info', exact: true }).click();
  const trigger = main.getByRole('button', { name: 'What does this mean? Quest level' }).first();
  await trigger.focus();
  await page.keyboard.press('Enter');
  const panel = page.getByTestId('term-help');
  await panel.waitFor();
  log(`popover: ${flat(await panel.innerText())}`);
  await shot(page, 'popover');
  await page.keyboard.press('Escape');

  // 5. /glossary: one row for either half.
  await page.goto(`${BASE}/glossary`);
  const rows = page.locator('main li[data-term]');
  await rows.first().waitFor();
  const search = page.getByLabel('Search by name or technical name');
  for (const [query, name] of [
    ['m_questLevel', 'glossary-technical'],
    ['Quest level', 'glossary-friendly'],
  ]) {
    await search.fill(query);
    for (let tries = 0; tries < 50 && (await rows.count()) !== 1; tries += 1) {
      await page.waitForTimeout(100);
    }
    log(`glossary "${query}": ${await rows.count()} row, data-term=${await rows.first().getAttribute('data-term')}`);
    await shot(page, name);
  }
} finally {
  await browser.close();
}
