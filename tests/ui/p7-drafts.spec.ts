import path from 'node:path';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import Database from 'better-sqlite3';

import { serializeDoc } from '@shared/document';
import { buildQuestScaffold } from '@shared/quest/scaffold';
import { TYPE_STRINGS } from '@shared/quest/typeConstants';

import { CLONE, cloneAxes, cloneGit, resetClone, type CloneAxes } from '../helpers/clone-fixture';

/**
 * Story p7-08's tier-1 specs (plan task 7.7; D129, D130, D137, D141, D142, D144, D165):
 * the draft queue `/drafts` and the accept flow, **on the clone-backed harness server**.
 *
 * Unlike the hermetic Phase 3-6 specs, nothing here is route-mocked. The harness boots its own
 * server on `data/test-ui.db` with `NODE_ENV=test` (D44), whose `spiraldb_path` is the D17 clone, so
 * every Save below is a real pipeline write + commit in `data/test-spiraldb`. Each test therefore:
 *
 * 1. seeds the catalog/suggestion rows it needs straight into `data/test-ui.db` (the server has no
 *    sync to build them from under `SPIRALDB_UI_SKIP_IMPORT`), with names no other spec uses;
 * 2. points `settings.git_branch` at the clone's checked-out branch, so a save commits **on** it and
 *    never creates `content/<today>` from `main` (the D76(b)/D119 trap), and restores the settings;
 * 3. snapshots the clone's axes first and, in `afterEach`, `reset --hard`s to that snapshot, cleans
 *    the two quest families of untracked files, and asserts every axis — branch, HEAD, `main`, the
 *    commit count, porcelain, the 322 quest files and the local refs — is back (D75/D76).
 *
 * | criterion (p7-08) | test |
 * |---|---|
 * | 1 — ranked queue, filters, name pair, zero-evidence hidden behind a counted toggle | `the queue …` |
 * | 2 — accept one field on an existing file → a diff of exactly that field; status flips only after the commit | `accepting one field …` |
 * | 2 — a new file: the D118 skeleton plus that field | `a missing file …` |
 * | 2 — a rejection survives reload | `a rejection …` |
 * | 2 — accept-all then save validates | `accept-all …` |
 * | 2 — naming an unnamed draft: one catalog row, one file; duplicate and path-escaping names refused | `an unnamed draft …` |
 */

const DB_FILE = path.resolve('data/test-ui.db');

/** Every catalog name and id this file seeds — the cleanup's whole scope. */
const NAMES = [
  'FX-P708-RICH-001',
  'FX-P708-FILE-001',
  'FX-P708-ZERO-001',
  'FX-P708-NEW-001',
  'FX-P708-ALL-001',
  'FX-P708-NAMED-001',
  'WC-TUT-C08-001',
] as const;
const IDS = [990001, 990002] as const;

/** A title-less clone quest whose file round-trips byte for byte through the pipeline's writer. */
const EXISTING = 'WC-TUT-C08-001';

function openTestDb(): Database.Database {
  const db = new Database(DB_FILE);
  db.pragma('busy_timeout = 5000');
  return db;
}

function withDb<T>(work: (db: Database.Database) => T): T {
  const db = openTestDb();
  try {
    return work(db);
  } finally {
    db.close();
  }
}

interface SeedSuggestion {
  quest_name: string | null;
  catalog_id: number | null;
  path: string;
  value: unknown;
  source: string;
  confidence?: number | null;
}

/** Inserts suggestion rows and returns their ids in order. */
function seedSuggestions(rows: readonly SeedSuggestion[]): number[] {
  return withDb((db) => {
    const insert = db.prepare(
      `INSERT INTO quest_suggestions (quest_name, catalog_id, path, value_json, source, confidence, evidence_ref)
       VALUES (?, ?, ?, ?, ?, ?, 'p7-08 tier-1 seed')`,
    );
    return rows.map((row) =>
      Number(
        insert.run(
          row.quest_name,
          row.catalog_id,
          row.path,
          JSON.stringify(row.value),
          row.source,
          row.confidence ?? 1,
        ).lastInsertRowid,
      ),
    );
  });
}

function seedQuest(name: string, hasDefinition: 0 | 1, title = name): void {
  withDb((db) =>
    db
      .prepare(
        `INSERT INTO quests (quest_name, title, has_definition, link_kind, title_source, reference_count)
         VALUES (?, ?, ?, 'none', 'none', 0)`,
      )
      .run(name, title, hasDefinition),
  );
}

function seedId(id: number, titleKey: string, title: string): void {
  withDb((db) =>
    db
      .prepare(
        `INSERT INTO quest_ids (quest_id, title_key, title, text_rows, matched_quest_name, link_kind)
         VALUES (?, ?, ?, 1, NULL, 'none')`,
      )
      .run(id, titleKey, title),
  );
}

function statusesOf(ids: readonly number[]): string[] {
  return withDb((db) =>
    ids.map(
      (id) =>
        (
          db.prepare('SELECT status FROM quest_suggestions WHERE id = ?').get(id) as {
            status: string;
          }
        ).status,
    ),
  );
}

function questRowCount(): number {
  return withDb((db) => (db.prepare('SELECT count(*) AS c FROM quests').get() as { c: number }).c);
}

/** Removes every row this file could have written, whatever a test got to. */
function cleanupRows(): void {
  withDb((db) => {
    const names = NAMES.map(() => '?').join(', ');
    const ids = IDS.map(() => '?').join(', ');
    db.prepare(
      `DELETE FROM quest_suggestions WHERE quest_name IN (${names}) OR catalog_id IN (${ids})
          OR evidence_ref = 'p7-08 tier-1 seed'`,
    ).run(...NAMES, ...IDS);
    db.prepare(`DELETE FROM quest_ids WHERE quest_id IN (${ids})`).run(...IDS);
    db.prepare(
      `DELETE FROM status_history WHERE entry_status_id IN
         (SELECT id FROM entry_status WHERE object_type = 'quest' AND object_key IN (${names}))`,
    ).run(...NAMES);
    db.prepare(
      `DELETE FROM entry_status WHERE object_type = 'quest' AND object_key IN (${names})`,
    ).run(...NAMES);
    db.prepare(`DELETE FROM quests WHERE quest_name IN (${names})`).run(...NAMES);
  });
}

function questFile(name: string): string {
  return `QuestTemplates/questtemplates_${name}.json`;
}

/** The last commit's `+`/`-` body lines for one file (headers excluded). */
function lastCommitChangedLines(file: string): string[] {
  return cloneGit(['show', '--format=', '--unified=0', 'HEAD', '--', file])
    .split('\n')
    .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line));
}

let snapshot: CloneAxes | null = null;
let savedSettings: Record<string, unknown> | null = null;

async function pointBranchAtClone(request: APIRequestContext): Promise<void> {
  const current = await request.get('/api/settings');
  savedSettings = (await current.json()) as Record<string, unknown>;
  const branch = cloneGit(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const put = await request.put('/api/settings', {
    data: { user_name: 'P7-08 Tier-1', git_branch: branch, spiraldb_path: CLONE },
  });
  expect(put.ok()).toBe(true);
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ request }) => {
  cleanupRows();
  snapshot = cloneAxes();
  expect(snapshot.porcelain, 'the D17 clone must be clean before a write spec').toBe('');
  await pointBranchAtClone(request);
});

test.afterEach(async ({ request }) => {
  if (snapshot !== null) {
    resetClone(snapshot.head);
    cloneGit(['clean', '-fdq', '--', 'QuestTemplates', 'QuestMetadatas']);
    expect(cloneAxes(), 'the clone is back on every axis').toEqual(snapshot);
    snapshot = null;
  }
  if (savedSettings !== null) {
    const { user_name, git_branch, spiraldb_path } = savedSettings;
    await request.put('/api/settings', { data: { user_name, git_branch, spiraldb_path } });
    savedSettings = null;
  }
  cleanupRows();
});

/** Opens a tab of the editor by its name. */
async function openTab(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name, exact: true }).click();
}

/** Clicks the header Save and waits for the save request's answer. */
async function save(page: Page, route: RegExp): Promise<number> {
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => route.test(new URL(res.url()).pathname) && res.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Save', exact: true }).click(),
  ]);
  return response.status();
}

test('the queue ranks by evidence, filters on the server, shows the name pair, and hides zero-evidence drafts behind a counted toggle', async ({
  page,
}) => {
  seedQuest('FX-P708-RICH-001', 0, 'Rich Draft');
  seedQuest('FX-P708-FILE-001', 1, 'Filed Draft');
  seedQuest('FX-P708-ZERO-001', 0, 'Empty Draft');
  seedId(990001, 'QuestTitle_P708L', 'The P7 Lantern');
  seedSuggestions([
    {
      quest_name: 'FX-P708-RICH-001',
      catalog_id: null,
      path: 'm_questTitle',
      value: 'QuestTitle_P708R',
      source: 'evidence-title',
    },
    {
      quest_name: 'FX-P708-RICH-001',
      catalog_id: null,
      path: 'm_goals',
      value: [],
      source: 'evidence-goals',
    },
    {
      quest_name: 'FX-P708-RICH-001',
      catalog_id: null,
      path: 'm_requirements',
      value: null,
      source: 'evidence-requirements',
    },
    {
      quest_name: null,
      catalog_id: 990001,
      path: 'm_questTitle',
      value: 'QuestTitle_P708L',
      source: 'evidence-title',
    },
    {
      quest_name: null,
      catalog_id: 990001,
      path: 'm_dialogList',
      value: { m_dialogs: [] },
      source: 'evidence-dialogue',
    },
    {
      quest_name: 'FX-P708-FILE-001',
      catalog_id: null,
      path: 'm_questTitle',
      value: 'QuestTitle_P708F',
      source: 'evidence-title',
    },
  ]);

  await page.goto('/drafts');
  // The nav item is QUESTS → Drafts, and it is the active one.
  await expect(page.getByRole('link', { name: 'Drafts', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );

  const rows = page.locator('[data-testid^="draft-row-"]');
  // Ranked by evidence richness (3, 2, 1) — the server's order; zero-evidence hidden.
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute('data-testid', 'draft-row-FX-P708-RICH-001');
  await expect(rows.nth(1)).toHaveAttribute('data-testid', 'draft-row-id-990001');
  await expect(rows.nth(2)).toHaveAttribute('data-testid', 'draft-row-FX-P708-FILE-001');
  // The name pair, and the unnamed tier marked as text.
  await expect(rows.nth(0)).toContainText('Rich Draft (FX-P708-RICH-001)');
  await expect(rows.nth(1)).toContainText('The P7 Lantern (#990001)');
  await expect(rows.nth(1)).toContainText('unnamed');
  await expect(rows.nth(0).getByRole('cell').nth(1)).toHaveText('3');
  // The counted toggle (D130): the hidden number is text beside it.
  await expect(page.getByTestId('drafts-summary')).toHaveText(
    '3 drafts with evidence · 1 with none hidden',
  );
  const toggle = page.getByLabel(/Show zero-evidence drafts/);
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText('Show zero-evidence drafts (1 hidden)')).toBeVisible();
  await expect(page.getByTestId('draft-row-FX-P708-ZERO-001')).toHaveCount(0);

  await toggle.check();
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(3)).toHaveAttribute('data-testid', 'draft-row-FX-P708-ZERO-001');
  await toggle.uncheck();
  await expect(rows).toHaveCount(3);

  // Each filter is a server query parameter; the rows follow the response.
  const filtered = async (label: string, option: string, expected: string[]): Promise<void> => {
    const [response] = await Promise.all([
      page.waitForResponse((res) => new URL(res.url()).pathname === '/api/drafts'),
      page.getByLabel(label, { exact: true }).selectOption({ label: option }),
    ]);
    expect(response.ok()).toBe(true);
    await expect(rows).toHaveCount(expected.length);
    for (const [index, key] of expected.entries()) {
      await expect(rows.nth(index)).toHaveAttribute('data-testid', `draft-row-${key}`);
    }
  };
  await filtered('Named', 'Unnamed', ['id-990001']);
  await filtered('Named', 'Named', ['FX-P708-RICH-001', 'FX-P708-FILE-001']);
  await filtered('Named', 'Any', ['FX-P708-RICH-001', 'id-990001', 'FX-P708-FILE-001']);
  await filtered('Has file', 'Has a file', ['FX-P708-FILE-001']);
  await filtered('Has file', 'Any', ['FX-P708-RICH-001', 'id-990001', 'FX-P708-FILE-001']);
  await filtered('Source', 'evidence-goals', ['FX-P708-RICH-001']);
  await filtered('Source', 'evidence-dialogue', ['id-990001']);

  // A row opens the editor on the draft: the missing file on its skeleton, in memory.
  await page.getByLabel('Source', { exact: true }).selectOption({ label: 'Any' });
  await rows.nth(0).getByRole('link').click();
  await expect(page).toHaveURL(/\/drafts\/quest\/FX-P708-RICH-001$/);
  await expect(page.locator('[data-draft="missing"]')).toBeVisible();
  expect(cloneGit(['status', '--porcelain'])).toBe('');
});

test('accepting one field on an existing file then saving commits a diff of exactly that field, and the status flips only after the commit', async ({
  page,
}) => {
  seedQuest(EXISTING, 1);
  const [titleId, otherId] = seedSuggestions([
    {
      quest_name: EXISTING,
      catalog_id: null,
      path: 'm_questTitle',
      value: 'QuestTitle_P708E',
      source: 'evidence-title',
    },
    {
      quest_name: EXISTING,
      catalog_id: null,
      path: 'm_questTitle',
      value: 'QuestTitle_P708X',
      source: 'capture-order',
      confidence: 0.5,
    },
  ]) as [number, number];
  const headBefore = cloneGit(['rev-parse', 'HEAD']).trim();

  await page.goto('/drafts');
  await page.getByTestId(`draft-row-${EXISTING}`).getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/quests/${EXISTING}$`));
  await openTab(page, 'Info');
  const line = page.getByTestId(`suggestion-${titleId}`);
  await expect(line).toContainText('Suggested: QuestTitle_P708E');
  await expect(line).toContainText('evidence-title');
  await expect(line).toContainText('confidence 1');

  await line.getByRole('button', { name: /^Accept m_questTitle/ }).click();
  await expect(line).toHaveAttribute('data-applied', 'true');
  // Accepting is an in-memory edit: nothing is persisted, nothing is written.
  expect(statusesOf([titleId, otherId])).toEqual(['pending', 'pending']);
  expect(cloneGit(['rev-parse', 'HEAD']).trim()).toBe(headBefore);
  expect(cloneGit(['status', '--porcelain'])).toBe('');

  expect(await save(page, /^\/api\/quests$/)).toBe(200);
  const headAfter = cloneGit(['rev-parse', 'HEAD']).trim();
  expect(headAfter).not.toBe(headBefore);
  expect(cloneGit(['rev-list', '--count', `${headBefore}..${headAfter}`]).trim()).toBe('1');
  // The template's diff is exactly the accepted field.
  expect(lastCommitChangedLines(questFile(EXISTING))).toEqual([
    '-  "m_questTitle": "",',
    '+  "m_questTitle": "QuestTitle_P708E",',
  ]);
  // Only the template and its metadata are in the commit.
  expect(cloneGit(['show', '--format=', '--name-only', 'HEAD']).trim().split('\n').sort()).toEqual([
    `QuestMetadatas/questmetadata_${EXISTING}.json`,
    questFile(EXISTING),
  ]);
  // Flipped now that the commit exists; the value not carried stays pending.
  await expect.poll(() => statusesOf([titleId, otherId])).toEqual(['accepted', 'pending']);
});

test('a missing file saves as the D118 skeleton plus the accepted field, in one scaffold commit', async ({
  page,
}) => {
  const NAME = 'FX-P708-NEW-001';
  seedQuest(NAME, 0);
  const [titleId] = seedSuggestions([
    {
      quest_name: NAME,
      catalog_id: null,
      path: 'm_questTitle',
      value: 'QuestTitle_P708N',
      source: 'evidence-title',
    },
  ]) as [number];
  const countBefore = Number(cloneGit(['rev-list', '--count', 'HEAD']).trim());

  await page.goto(`/drafts/quest/${NAME}`);
  await expect(page.getByText('Draft · no file yet')).toBeVisible();
  // Opening the draft wrote nothing.
  expect(cloneGit(['status', '--porcelain'])).toBe('');
  // The draft lands on Overview (p7-14, D133); the title suggestion renders on the Info tab.
  await openTab(page, 'Info');
  await page
    .getByTestId(`suggestion-${titleId}`)
    .getByRole('button', { name: /^Accept/ })
    .click();
  expect(await save(page, /^\/api\/quests\/scaffold$/)).toBe(200);
  // The file exists now: the editor continues on it.
  await expect(page).toHaveURL(new RegExp(`/quests/${NAME}$`));

  expect(Number(cloneGit(['rev-list', '--count', 'HEAD']).trim())).toBe(countBefore + 1);
  expect(cloneGit(['show', '--format=%s', '-s', 'HEAD']).trim()).toBe(
    `spiraldb: create quest ${NAME}`,
  );
  const expected = serializeDoc({
    ...buildQuestScaffold({ name: NAME, link: { kind: 'none' } }),
    m_questTitle: 'QuestTitle_P708N',
  });
  expect(cloneGit(['show', `HEAD:${questFile(NAME)}`])).toBe(expected);
  await expect.poll(() => statusesOf([titleId])).toEqual(['accepted']);
});

test('a rejection is immediate and survives a reload', async ({ page }) => {
  const NAME = 'FX-P708-RICH-001';
  seedQuest(NAME, 0, 'Rich Draft');
  const [rejectId, keepId] = seedSuggestions([
    {
      quest_name: NAME,
      catalog_id: null,
      path: 'm_questTitle',
      value: 'QuestTitle_P708R',
      source: 'evidence-title',
    },
    {
      quest_name: NAME,
      catalog_id: null,
      path: 'm_questLevel',
      value: 12,
      source: 'capture-order',
      confidence: 0.6,
    },
  ]) as [number, number];

  await page.goto(`/drafts/quest/${NAME}`);
  // Both suggestions are on the Info tab; the draft lands on Overview (p7-14, D133).
  await openTab(page, 'Info');
  const line = page.getByTestId(`suggestion-${rejectId}`);
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => new URL(res.url()).pathname === `/api/suggestions/${rejectId}/reject`,
    ),
    line.getByRole('button', { name: /^Reject/ }).click(),
  ]);
  expect(response.status()).toBe(200);
  await expect(line).toHaveCount(0);
  expect(statusesOf([rejectId, keepId])).toEqual(['rejected', 'pending']);

  await page.reload();
  await openTab(page, 'Info');
  await expect(page.getByTestId(`suggestion-${keepId}`)).toBeVisible();
  await expect(page.getByTestId(`suggestion-${rejectId}`)).toHaveCount(0);
  expect(statusesOf([rejectId])).toEqual(['rejected']);
  // Nothing was written by a reject.
  expect(cloneGit(['status', '--porcelain'])).toBe('');
});

test('accept-all from each source, then Save, validates and commits', async ({ page }) => {
  const NAME = 'FX-P708-ALL-001';
  seedQuest(NAME, 0);
  const goal = (name: string, zone: string): Record<string, unknown> => ({
    $type: TYPE_STRINGS.PersonaGoalTemplate,
    m_goalName: name,
    m_goalNameID: 0,
    m_goalTitle: '',
    m_goalUnderway: null,
    m_hyperlink: null,
    m_completeText: null,
    m_completeResults: { m_results: [] },
    m_goalRequirements: null,
    m_tallyCounter: null,
    m_locationName: '',
    m_displayImage1: '',
    m_displayImage2: null,
    m_clientTags: [],
    m_genericEvents: [],
    m_autoQualify: false,
    m_autoComplete: false,
    m_destinationZone: zone,
    m_dialogList: null,
    m_goalType: 'GOAL_TYPE_PERSONA',
    m_noQuestHelper: false,
    m_petOnlyQuest: false,
    m_activateResults: { m_results: [] },
    m_hideGoalFloatyText: false,
    m_behaviors: null,
    m_personaName: '',
    m_usePatron: false,
  });
  const ids = seedSuggestions([
    {
      quest_name: NAME,
      catalog_id: null,
      path: 'm_goals',
      value: [goal('Goal 1', 'WizardCity/WC_Hub'), goal('Goal 2', 'WizardCity/WC_Hub')],
      source: 'evidence-goals',
      confidence: 0.109,
    },
    {
      quest_name: NAME,
      catalog_id: null,
      path: 'm_goals[0].m_locationName',
      value: 'ZoneLocName_P708A',
      source: 'evidence-location',
      confidence: 0.5,
    },
    {
      quest_name: NAME,
      catalog_id: null,
      path: 'm_goals[1].m_locationName',
      value: 'ZoneLocName_P708B',
      source: 'evidence-location',
      confidence: 0.5,
    },
    {
      quest_name: NAME,
      catalog_id: null,
      path: 'm_questTitle',
      value: 'QuestTitle_P708A',
      source: 'evidence-title',
    },
  ]);

  await page.goto(`/drafts/quest/${NAME}`);
  const bar = page.getByTestId('suggestions-accept-all');
  await expect(bar).toContainText('4 pending suggestions');
  await bar.getByRole('button', { name: /Accept all from evidence-goals/ }).click();
  await bar.getByRole('button', { name: /Accept all from evidence-location/ }).click();
  await bar.getByRole('button', { name: /Accept all from evidence-title/ }).click();
  for (const source of ['evidence-goals', 'evidence-location', 'evidence-title']) {
    await expect(bar.getByRole('button', { name: `Accept all from ${source} (0)` })).toBeDisabled();
  }
  // The document validates: Save is not blocked.
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveAttribute(
    'data-blocked',
    'false',
  );
  expect(statusesOf(ids)).toEqual(['pending', 'pending', 'pending', 'pending']);

  expect(await save(page, /^\/api\/quests\/scaffold$/)).toBe(200);
  await expect(page).toHaveURL(new RegExp(`/quests/${NAME}$`));
  const written = JSON.parse(cloneGit(['show', `HEAD:${questFile(NAME)}`])) as {
    m_questTitle: string;
    m_goals: Array<{ m_goalName: string; m_locationName: string }>;
  };
  expect(written.m_questTitle).toBe('QuestTitle_P708A');
  expect(written.m_goals.map((g) => [g.m_goalName, g.m_locationName])).toEqual([
    ['Goal 1', 'ZoneLocName_P708A'],
    ['Goal 2', 'ZoneLocName_P708B'],
  ]);
  await expect
    .poll(() => statusesOf(ids))
    .toEqual(['accepted', 'accepted', 'accepted', 'accepted']);
});

test('an unnamed draft asks for a name pre-filled from its title key, refuses a duplicate and a path-escaping name writing nothing, then creates exactly one catalog row and one file', async ({
  page,
}) => {
  const ID = 990002;
  seedId(ID, 'QuestTitle_P708U', 'The Unnamed Lantern');
  seedQuest(EXISTING, 1);
  const [titleId] = seedSuggestions([
    {
      quest_name: null,
      catalog_id: ID,
      path: 'm_questTitle',
      value: 'QuestTitle_P708U',
      source: 'evidence-title',
    },
  ]) as [number];
  const headBefore = cloneGit(['rev-parse', 'HEAD']).trim();
  const rowsBefore = questRowCount();

  await page.goto('/drafts?named=0');
  await page.goto(`/drafts/id/${ID}`);
  await expect(page.locator('[data-draft="unnamed"]')).toBeVisible();
  // The title suggestion is on the Info tab; the draft lands on Overview (p7-14, D133).
  await openTab(page, 'Info');
  await page
    .getByTestId(`suggestion-${titleId}`)
    .getByRole('button', { name: /^Accept/ })
    .click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Name this quest' });
  await expect(dialog).toBeVisible();
  const input = dialog.getByLabel('Quest name');
  // Pre-filled from the evidence's title key, never submitted for the user.
  await expect(input).toHaveValue('QuestTitle_P708U');
  expect(cloneGit(['rev-parse', 'HEAD']).trim()).toBe(headBefore);

  const attempt = async (name: string): Promise<number> => {
    await input.fill(name);
    const [response] = await Promise.all([
      page.waitForResponse((res) => new URL(res.url()).pathname === '/api/quests/scaffold'),
      dialog.getByRole('button', { name: 'Name and save' }).click(),
    ]);
    return response.status();
  };

  // A duplicate: the name of a quest that already exists.
  expect(await attempt(EXISTING)).toBe(409);
  await expect(dialog.getByRole('alert')).toContainText('is already a quest name');
  // A path-escaping name.
  expect(await attempt('x/../../evil')).toBe(400);
  await expect(dialog.getByRole('alert')).toContainText('Refusing to scaffold');
  // Neither refusal wrote anything: no commit, no file, no catalog row, the id still unnamed.
  expect(cloneGit(['rev-parse', 'HEAD']).trim()).toBe(headBefore);
  expect(cloneGit(['status', '--porcelain'])).toBe('');
  expect(questRowCount()).toBe(rowsBefore);
  expect(statusesOf([titleId])).toEqual(['pending']);

  const NAME = 'FX-P708-NAMED-001';
  expect(await attempt(NAME)).toBe(200);
  await expect(page).toHaveURL(new RegExp(`/quests/${NAME}$`));

  // Exactly one catalog row and one file, in one commit.
  expect(questRowCount()).toBe(rowsBefore + 1);
  expect(cloneGit(['rev-list', '--count', `${headBefore}..HEAD`]).trim()).toBe('1');
  expect(cloneGit(['show', '--format=', '--name-only', 'HEAD']).trim().split('\n').sort()).toEqual([
    `QuestMetadatas/questmetadata_${NAME}.json`,
    questFile(NAME),
  ]);
  const written = JSON.parse(cloneGit(['show', `HEAD:${questFile(NAME)}`])) as Record<
    string,
    unknown
  >;
  expect(written.m_questName).toBe(NAME);
  expect(written.m_questTitle).toBe('QuestTitle_P708U');
  const catalog = withDb((db) => ({
    quest: db.prepare('SELECT quest_name, title FROM quests WHERE quest_name = ?').get(NAME),
    link: db.prepare('SELECT matched_quest_name FROM quest_ids WHERE quest_id = ?').get(ID),
    suggestion: db
      .prepare('SELECT quest_name, status FROM quest_suggestions WHERE id = ?')
      .get(titleId),
  }));
  expect(catalog).toEqual({
    quest: { quest_name: NAME, title: 'The Unnamed Lantern' },
    link: { matched_quest_name: NAME },
    suggestion: { quest_name: NAME, status: 'accepted' },
  });
});
