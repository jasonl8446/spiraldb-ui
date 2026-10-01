// Story p7-08 tier-2 walkthrough (plan task 7.7, verification step 5; D23 tier 2 via D148).
//
// Drives the REAL app (a throwaway clone-backed server + its Vite client, started by the story and
// stopped by it) with the repo's own pinned Playwright chromium, because the playwright-mcp browser
// cannot launch on this host (D148). It is also the write the live Imlight boot proves (criterion
// 3): `npm run imlight:boot -- prove-count --save-cmd "node docs/evidence/phase-7/p7-08-tier2-walkthrough.mjs"`.
//
//   /drafts → the named missing quest → accept its three suggestions (Info, Goals, Requirements)
//   → Save (POST /api/quests/scaffold) → the new file's editor; then the unnamed draft's name dialog
//   (screenshot only, cancelled: nothing is written for it).
//
// Env: BASE (the client URL), QUEST_NAME (the named missing draft), UNNAMED_ID (an unnamed-tier id),
// OUT (the screenshot directory). Run with PLAYWRIGHT_BROWSERS_PATH=$PWD/tools/.playwright-browsers.

import path from 'node:path';

import { chromium } from '@playwright/test';

const BASE = process.env.BASE ?? 'http://localhost:5291';
const QUEST = process.env.QUEST_NAME ?? 'NV-PUERT-MAIN-012';
const UNNAMED_ID = process.env.UNNAMED_ID ?? '';
const OUT = process.env.OUT ?? 'docs/evidence/phase-7';

const shot = (page, name) =>
  page.screenshot({ path: path.join(OUT, `p7-08-tier2-${name}.png`), fullPage: false });

const log = (line) => console.log(`[p7-08 tier-2] ${line}`);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });

  // 1. The queue, filtered to named drafts with no file and ranked by evidence (the server's order).
  await page.goto(`${BASE}/drafts`);
  await page.getByTestId('drafts-summary').waitFor();
  await page.getByLabel('Named', { exact: true }).selectOption({ label: 'Named' });
  await page.getByLabel('Has file', { exact: true }).selectOption({ label: 'No file' });
  const row = page.getByTestId(`draft-row-${QUEST}`);
  await row.waitFor();
  log(`queue: ${await page.getByTestId('drafts-summary').innerText()}`);
  log(`row: ${(await row.innerText()).replace(/\s+/g, ' ')}`);
  await shot(page, 'queue');

  // 2. The draft opens on the D118 skeleton in memory; its suggestions render inline.
  await row.getByRole('link').click();
  await page.waitForURL(`**/drafts/quest/${QUEST}`);
  await page.getByTestId('suggestions-accept-all').waitFor();
  log(`accept-all bar: ${(await page.getByTestId('suggestions-accept-all').innerText()).replace(/\s+/g, ' ')}`);
  await shot(page, 'draft-editor');

  // 3. Accept three suggestions, one per tab, beside the field each fills.
  const accept = async (tab, pathLabel) => {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    const button = page.getByRole('button', { name: new RegExp(`^Accept ${pathLabel} from`) });
    await button.first().click();
    log(`accepted ${pathLabel} on the ${tab} tab`);
  };
  await accept('Info', 'm_questTitle');
  await accept('Goals', 'm_goals');
  await accept('Requirements', 'm_requirements');
  await shot(page, 'accepted');

  // 4. Save: the scaffold route writes the skeleton plus the accepted fields in one commit.
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => new URL(res.url()).pathname === '/api/quests/scaffold' && res.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Save', exact: true }).click(),
  ]);
  const body = await response.json();
  log(`save: HTTP ${response.status()} ${JSON.stringify({
    quest_name: body.quest_name,
    file: body.file,
    commit: body.commit,
    branch: body.branch,
    accepted_suggestions: body.accepted_suggestions,
  })}`);
  if (response.status() !== 200) {
    throw new Error(`the save failed: ${JSON.stringify(body)}`);
  }
  await page.waitForURL(`**/quests/${QUEST}`);
  // The file's own editor (not the draft's), loaded, with the save's toast still up.
  await page.locator('[data-draft="file"]').waitFor();
  await page.getByRole('heading', { name: new RegExp(QUEST) }).waitFor();
  await page.getByText(`Quest ${QUEST} saved`).first().waitFor();
  log(`after save: ${page.url()} — ${await page.getByRole('heading', { name: new RegExp(QUEST) }).innerText()}`);
  await shot(page, 'saved');

  // 5. The unnamed tier's name dialog (D137), pre-filled from its title key — cancelled, no write.
  if (UNNAMED_ID !== '') {
    await page.goto(`${BASE}/drafts/id/${UNNAMED_ID}`);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Name this quest' });
    await dialog.waitFor();
    log(`name dialog pre-fill: ${await dialog.getByLabel('Quest name').inputValue()}`);
    await shot(page, 'name-dialog');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  }
} finally {
  await browser.close();
}
