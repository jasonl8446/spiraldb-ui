import { readFileSync } from 'node:fs';

import { expect, test as base, type Locator, type Page, type Route } from '@playwright/test';

import { questListBody, type MockQuestRow } from './quests-mocks';

/**
 * Tier-1 extraction spec (plan task 2.6 / story p2-07, decision D23 tier 1).
 *
 * Drives the real `/quests/extract` page in headless chromium against the dev
 * stack the config auto-starts, with the app's API route-**mocked**: CI has no
 * .NET SDK, no built CLI, no sibling SpiralDB repo and no user-supplied capture
 * (D23 tier 1), so a spec that needed a real extraction or a real save could not
 * run there. The **committed** D28 fixtures under
 * `server/test/fixtures/captures/` are part of the repo, and the AC#13 chain below
 * reads one from disk so the real artifact goes through the real dropzone input.
 * The real CLI and the real git writes are the lead's tier-2 browser pass.
 *
 * What this file proves, clause by clause of `p2-07-ac1`:
 *
 * - the drop-zone copy (including the verbatim `Supported format:` line) and the
 *   hidden `.json` input;
 * - the selected-file card + **indeterminate** spinner + "Extracting quests..." +
 *   destructive Cancel;
 * - the results split layout: 320px left list (name / level badge / goal count /
 *   `new` badge, `blue-600/10` selection), right read-only tabbed preview;
 * - Save All's confirm dialog with the exact N-quest sentence, and that nothing is
 *   POSTed until it is confirmed; the per-quest success toast;
 * - the **overwrite confirmation** (gap A, plan §2.4): the existing-name list in
 *   Save All's dialog (whatever already exists in `GET /api/quests`), Save
 *   Selected's small confirm for an existing name but not for a new one, the
 *   fail-safe refusal when the list cannot be read, and the capture `source` field
 *   on both save paths (gap B);
 * - **Cancel aborts the fetch** and a late response cannot resurrect the run;
 * - a 400/500 returns the user to the upload phase with the server's message;
 * - the empty results state;
 * - at **375px** the list is full width and tapping a quest opens the preview as an
 *   overlay (P2 AC#12);
 * - the identity gate (D38/D43): a blank `user_name` opens the dialog, the entered
 *   name is persisted with `PUT /api/settings` and the pending save resumes; a
 *   dismissed dialog performs no save and claims no success;
 * - **the P2 AC#13 chain end to end in one spec** (`save → browse` below): the
 *   committed D28 capture read from disk goes through the real dropzone input →
 *   spinner → N results → Save All + confirm → success toast → the browse list
 *   **growing by N** (M rows before the save, M+N after it), against a stateful
 *   `/api/quests` mock that answers what the real server's per-request corpus
 *   rescan would answer.
 *
 * The mocked bodies are the contracts the lead verified in p2-04/p2-05/p2-06
 * (`docs/spec-api.md`): `{quests, count}` for extraction, the `SaveQuestResult`
 * envelope with `warnings[]` for a save, and always `{error}` on a failure.
 */

/** `GET`/`PUT /api/settings` answer — the shell's and the gate's shared read. */
const MOCK_SETTINGS = {
  aurorium_path: '/mock/aurorium',
  imcodec_path: '/mock/imcodec',
  spiraldb_path: '/mock/spiraldb',
  user_name: 'Mock Reviewer',
  git_branch: 'content/2026-09-26',
} as const;

/** The capture the hidden input is fed — a tiny JSON body, so the card has a size. */
const CAPTURE_NAME = 'session_2026-09-24.json';
const CAPTURE_BUFFER = Buffer.from('{"packets":[]}');

/**
 * The committed D28 capture the AC#13 chain uploads (task 2.1a), read **from disk**
 * so the real artifact goes through the real dropzone input instead of a stub:
 * `server/test/fixtures/captures/WC-UNICORN-MAIN-004.json`.
 *
 * `scripts/verify-captures.mjs` asserts every committed fixture reconstructs to
 * exactly one quest ("expected exactly 1 reconstructed quest, got N"), and
 * `server/test/fixtures/captures/README.md` pins this file's shape (7 goals, level
 * 0) and its SHA-256 at corpus commit `c55ccab…`. CI has no .NET CLI, so the
 * extraction *answer* stays mocked (see {@link REAL_CAPTURE_QUEST}).
 */
const REAL_CAPTURE_NAME = 'WC-UNICORN-MAIN-004.json';
const REAL_CAPTURE = readFileSync(
  new URL(`../../server/test/fixtures/captures/${REAL_CAPTURE_NAME}`, import.meta.url),
);

const UPLOAD_FORMAT_HINT = 'Supported format: JSON packet capture files (.json)';
const EXTRACTING_TEXT = 'Extracting quests...';

/** Quest A: three goals, goal logic, requirements, a result and a dialog list. */
const QUEST_A = {
  m_questName: 'DS-ACAD1-C01-001',
  m_questTitle: 'QuestTitle_1ED8D',
  m_questLevel: 1,
  m_mainline: true,
  m_goals: [
    {
      $type: 'Imcodec.ObjectProperty.TypeCache.PersonaGoalTemplate, Imcodec.ObjectProperty',
      m_goalName: '1_WizardQuestGoals_TalkToProspector',
    },
    {
      $type: 'Imcodec.ObjectProperty.TypeCache.BountyGoalTemplate, Imcodec.ObjectProperty',
      m_goalName: '2_WizardQuestGoals_KillMobs',
      m_bountyTotal: 3,
    },
    {
      $type: 'Imcodec.ObjectProperty.TypeCache.WaypointGoalTemplate, Imcodec.ObjectProperty',
      m_goalName: '3_WizardQuestGoals_GotoZone',
    },
  ],
  m_goalLogic: [
    {
      m_goalsAND: ['1_WizardQuestGoals_TalkToProspector'],
      m_goalsToAdd: ['2_WizardQuestGoals_KillMobs'],
      m_completeQuest: false,
    },
  ],
  m_requirements: {
    m_requirements: [
      {
        $type: 'Imcodec.ObjectProperty.TypeCache.ReqHasQuest, Imcodec.ObjectProperty',
        m_questName: 'WC-UNICORN-MAIN-004',
      },
    ],
  },
  m_startResults: { m_results: [] },
  m_endResults: {
    m_results: [
      {
        $type: 'Imcodec.ObjectProperty.TypeCache.ResDropTable, Imcodec.ObjectProperty',
        m_tableName: 'WC-UNICORN-MAIN-007',
      },
    ],
  },
  m_dialogList: { m_dialogEntries: [] },
} as const;

/** Quest B: a one-goal quest, so the list and the selection have two rows. */
const QUEST_B = {
  m_questName: 'WC-UNICORN-MAIN-004',
  m_questTitle: 'QuestTitle_2A1F0',
  m_questLevel: 12,
  m_mainline: false,
  m_goals: [{ m_goalName: '1_WizardQuestGoals_UseItem' }],
  m_goalLogic: [],
  m_requirements: null,
  m_startResults: { m_results: [] },
  m_endResults: { m_results: [] },
  m_dialogList: null,
} as const;

const QUESTS = [QUEST_A, QUEST_B];

/**
 * The mocked `POST /api/extract/quests` answer for {@link REAL_CAPTURE_NAME} — the
 * wire shape `{quests, count}` with the **one** quest the committed fixture really
 * yields.
 *
 * The endpoint itself is mocked (tier 1 has no .NET CLI, D23), so this object stands
 * in for the CLI's output. Its values are the corpus source's own, read from
 * `data/test-spiraldb/QuestTemplates/questtemplates_WC-UNICORN-MAIN-004.json` at
 * the README's pinned corpus commit `c55ccab…`: title `QuestTitle_1625CA`, level 0,
 * mainline, and 7 goals whose names/types `verify-captures.mjs` compares in order.
 * The chain asserts the name, the level, the goal count and the `new` badge — the
 * fields its browse row and save body are built from.
 */
const REAL_CAPTURE_QUEST = {
  m_questName: 'WC-UNICORN-MAIN-004',
  m_questTitle: 'QuestTitle_1625CA',
  m_questLevel: 0,
  m_mainline: true,
  m_goals: [
    {
      $type: 'Imcodec.ObjectProperty.TypeCache.ScavengeGoalTemplate, Imcodec.ObjectProperty',
      m_goalName: '1_WizardQuestGoals_00000015',
    },
    {
      $type: 'Imcodec.ObjectProperty.TypeCache.ScavengeGoalTemplate, Imcodec.ObjectProperty',
      m_goalName: '2_WizardQuestGoals_00000015',
    },
    {
      $type: 'Imcodec.ObjectProperty.TypeCache.ScavengeGoalTemplate, Imcodec.ObjectProperty',
      m_goalName: '3_WizardQuestGoals_00000015',
    },
    {
      $type: 'Imcodec.ObjectProperty.TypeCache.ScavengeGoalTemplate, Imcodec.ObjectProperty',
      m_goalName: '4_WizardQuestGoals_00000015',
    },
    {
      $type: 'Imcodec.ObjectProperty.TypeCache.BountyGoalTemplate, Imcodec.ObjectProperty',
      m_goalName: '5_WizardQuestGoals_KillCollect',
    },
    {
      $type: 'Imcodec.ObjectProperty.TypeCache.WaypointGoalTemplate, Imcodec.ObjectProperty',
      m_goalName: '6_WizardQuestGoals_Explore',
    },
    {
      $type: 'Imcodec.ObjectProperty.TypeCache.PersonaGoalTemplate, Imcodec.ObjectProperty',
      m_goalName: '7_WizardQuestGoals_TalkNPC',
    },
  ],
  m_goalLogic: [],
  m_requirements: null,
  m_startResults: { m_results: [] },
  m_endResults: { m_results: [] },
  m_dialogList: null,
} as const;

/** A `SaveQuestResult` body (docs/spec-api.md L239-251) for one saved quest. */
function saveResultFor(quest: Record<string, unknown>): Record<string, unknown> {
  const name = String(quest.m_questName ?? '');
  return {
    quest_name: name,
    outcome: 'created',
    action: 'extract',
    commit: '3f1c0000000000000000000000000000000000ab',
    branch: 'content/2026-09-26',
    commit_message: `spiraldb: extract quest ${name}`,
    file: `QuestTemplates/questtemplates_${name}.json`,
    metadata: `QuestMetadatas/questmetadata_${name}.json`,
    metadata_outcome: 'created',
    status: {
      object_type: 'quest',
      object_key: name,
      status: 'extracted',
      extracted_at: '2026-09-26T12:00:00.000Z',
      reviewed_at: null,
      verified_at: null,
      latest_notes: null,
    },
    warnings: [],
  };
}

/** Everything the mocked API recorded, so tests can assert what was *not* sent. */
interface Recorded {
  extractRequests: number;
  /** `GET /api/quests` calls — the lazy overwrite check (gap A). */
  listRequests: number;
  savedQuests: Array<Record<string, unknown>>;
  /** The raw save request bodies, to pin the wire contract (`{ quest, source }`). */
  saveBodies: Array<Record<string, unknown>>;
  putSettings: unknown[];
}

type RouteHandler = (route: Route) => Promise<void> | void;

interface MockOptions {
  /** `settings.user_name`; `''` makes the identity gate prompt (D38). */
  userName?: string;
  /** Replaces the default `200 {quests, count}` extraction answer. */
  onExtract?: RouteHandler;
  /** Replaces the default `200` save answer (use for 409/500/warnings). */
  onSave?: RouteHandler;
  /** Replaces the default `200 {quests, summary, skipped}` list answer. */
  onList?: RouteHandler;
  /** The quest names `GET /api/quests` reports as already in SpiralDB (gap A). */
  existingQuests?: string[];
  /**
   * A **stateful** `GET /api/quests` list: the browse list starts at these rows and
   * every default-path save appends the saved quest's own row, because the real
   * endpoint rescans the corpus per request (D12) — so the next `GET` really does
   * answer one row more (P2 AC#13's "the browse list grows by N").
   *
   * The seed is this file's ({@link browseSeed}) and the row shape is
   * `quests-mocks.ts`'s `MockQuestRow` + `questListBody`, so the browse specs'
   * fixture type and summary builder are reused rather than duplicated. `onList`
   * still wins over it; `existingQuests` is the separate name-only gap-A list.
   */
  browseRows?: MockQuestRow[];
}

/** A `GET /api/quests` body (docs/spec-api.md L190-208) for the given names. */
function questListResult(names: string[]): Record<string, unknown> {
  return {
    quests: names.map((quest_name) => ({
      quest_name,
      title: quest_name,
      title_key: null,
      title_source: 'missing',
      level: 1,
      goal_count: 1,
      is_mainline: false,
      modified_at: '2026-09-26T09:04:09.008Z',
      status: 'extracted',
    })),
    summary: { total: names.length, extracted: names.length, reviewed: 0, verified: 0 },
    skipped: [],
  };
}

/**
 * One `quests[]` row of the stateful browse mock, derived from a just-saved quest
 * the way the server derives it (`server/src/services/sync/corpus.ts` →
 * `buildQuestRows`): the title is `m_questTitle`'s own raw key — an unsynced tier-1
 * database holds no string-table entry, so `title_source` is `rawKey` (D49(g)) — and
 * the quest name with `missing` when the file has no title; level, goal count and
 * mainline come from the saved object; a save through this endpoint inserts
 * `extracted` (D49(d)).
 */
function browseRowFor(quest: Record<string, unknown>): MockQuestRow {
  const quest_name = String(quest.m_questName ?? '');
  const rawKey = typeof quest.m_questTitle === 'string' ? quest.m_questTitle.trim() : '';
  return {
    quest_name,
    title: rawKey === '' ? quest_name : rawKey,
    title_key: rawKey === '' ? null : rawKey,
    title_source: rawKey === '' ? 'missing' : 'rawKey',
    level: typeof quest.m_questLevel === 'number' ? quest.m_questLevel : null,
    goal_count: Array.isArray(quest.m_goals) ? quest.m_goals.length : 0,
    is_mainline: quest.m_mainline === true,
    modified_at: '2026-09-26T09:04:09.008Z',
    status: 'extracted',
  };
}

/**
 * The M rows the browse list already holds when an AC#13 chain starts: two real
 * corpus names, deliberately **disjoint from the capture's own quest** (so the save
 * is a create, not the gap-A overwrite) and `reviewed`/`verified` (so the Extracted
 * count really starts at 0). Beyond the name and the status their columns are
 * placeholders: the chain asserts the row count, the statuses and the grown row, not
 * these rows' own fields.
 */
function browseSeed(): MockQuestRow[] {
  const row = (quest_name: string, status: MockQuestRow['status']): MockQuestRow => ({
    quest_name,
    title: quest_name,
    title_key: null,
    title_source: 'missing',
    level: 1,
    goal_count: 1,
    is_mainline: false,
    modified_at: '2026-09-26T09:04:09.008Z',
    status,
  });
  return [row('MB-YARD1-C01-001', 'verified'), row('WC-CYCLOPS-MAIN-002', 'reviewed')];
}

/**
 * Route-mocks `/api/settings`, `/api/extract/quests` and `/api/quests` — the
 * complete data surface of this page. Nothing here reaches the .NET CLI, the
 * SpiralDB repo or the developer's database.
 *
 * `/api/quests` answers **both** methods: the `GET` list (p2-06) that p2-07's
 * overwrite check reads, and the `POST` save. Keeping them apart is what lets the
 * specs assert "no POST before the confirmation" without the check's own request
 * being mistaken for a write.
 */
async function mockApi(page: Page, options: MockOptions = {}): Promise<Recorded> {
  const recorded: Recorded = {
    extractRequests: 0,
    listRequests: 0,
    savedQuests: [],
    saveBodies: [],
    putSettings: [],
  };
  const settings: Record<string, string> = {
    ...MOCK_SETTINGS,
    user_name: options.userName ?? MOCK_SETTINGS.user_name,
  };

  await page.route('**/api/settings', async (route) => {
    if (route.request().method() === 'PUT') {
      const patch = JSON.parse(route.request().postData() ?? '{}') as Record<string, string>;
      recorded.putSettings.push(patch);
      Object.assign(settings, patch);
      await route.fulfill({ json: { ...settings } });
      return;
    }
    await route.fulfill({ json: { ...settings } });
  });

  await page.route('**/api/extract/quests', async (route) => {
    recorded.extractRequests += 1;
    if (options.onExtract !== undefined) {
      await options.onExtract(route);
      return;
    }
    await route.fulfill({ json: { quests: QUESTS, count: QUESTS.length } });
  });

  await page.route('**/api/quests', async (route) => {
    if (route.request().method() === 'GET') {
      recorded.listRequests += 1;
      if (options.onList !== undefined) {
        await options.onList(route);
        return;
      }
      if (options.browseRows !== undefined) {
        await route.fulfill({ json: questListBody(options.browseRows) });
        return;
      }
      await route.fulfill({ json: questListResult(options.existingQuests ?? []) });
      return;
    }

    const body = JSON.parse(route.request().postData() ?? '{}') as {
      quest: Record<string, unknown>;
      source?: string;
    };
    recorded.saveBodies.push(body);
    recorded.savedQuests.push(body.quest);
    if (options.onSave !== undefined) {
      await options.onSave(route);
      return;
    }
    // Grown **before** the 200 is answered: the client invalidates the list on
    // success (`ExtractionPage.onSuccess`), so the browse page's refetch must
    // already find the new row. Only this default 200 path grows the list — an
    // `onSave` override owns its own answer (a 409 must not add a row).
    options.browseRows?.push(browseRowFor(body.quest));
    await route.fulfill({ json: saveResultFor(body.quest) });
  });

  return recorded;
}

/* ------------------------------------------------------------------- helpers */

/**
 * Collects every `console.error` and uncaught page error so the shared
 * `afterEach` below can fail the test — the same guard `shell.spec.ts` uses, and
 * it matters more here: this page mounts two Radix dialogs and a controlled
 * identity dialog.
 */
const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(`console.error: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    await use(errors);
  },
});

test.afterEach(async ({ page, consoleErrors }) => {
  await page.evaluate(() => undefined).catch(() => undefined);
  expect(consoleErrors, 'the extraction page must log no console errors').toEqual([]);
});

/** Opens the page and waits for the upload phase to be up. */
async function openExtractionPage(page: Page): Promise<void> {
  await page.goto('/quests/extract');
  await expect(page.getByText(UPLOAD_FORMAT_HINT)).toBeVisible();
}

/** Feeds the hidden file input with a named buffer — what drag & drop ultimately does. */
async function uploadFile(page: Page, name: string, buffer: Buffer): Promise<void> {
  await page.locator('input[type=file]').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer,
  });
}

/** Feeds the hidden file input, which is what drag & drop ultimately does too. */
async function uploadCapture(page: Page): Promise<void> {
  await uploadFile(page, CAPTURE_NAME, CAPTURE_BUFFER);
}

/** Opens the page, uploads the capture and waits for the results phase. */
async function openResults(page: Page): Promise<void> {
  await openExtractionPage(page);
  await uploadCapture(page);
  await expect(page.getByRole('listbox', { name: 'Extracted quests' })).toBeVisible();
}

/** One sonner toast, matched by its text (sonner marks every toast `li`). */
function toast(page: Page, text: string) {
  return page.locator('li[data-sonner-toast]').filter({ hasText: text });
}

/** The browse page's data rows (its header row is a `<tr>` too — p2-08's surface). */
function rows(page: Page): Locator {
  return page.locator('tbody tr');
}

/** One browse filter tab, by label; its count badge is part of the tab's text. */
function filterTab(page: Page, label: string): Locator {
  return page
    .getByRole('tablist', { name: 'Filter quests by status' })
    .getByRole('tab', { name: new RegExp(`^${label} `) });
}

/** A one-shot gate: `open()` releases whoever is awaiting `wait`. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = () => resolve();
  });
  return { wait, open };
}

/* --------------------------------------------------------------------- specs */

test.describe('upload phase', () => {
  test('states the supported format verbatim and browses through a hidden .json input', async ({
    page,
  }) => {
    await mockApi(page);
    await openExtractionPage(page);

    await expect(page.getByText('Drag & drop packet capture file here')).toBeVisible();
    await expect(page.getByText('or click to browse')).toBeVisible();
    // The domain reference's wording (L625) — never the mockup's shortened line.
    await expect(page.getByText(UPLOAD_FORMAT_HINT)).toBeVisible();

    const input = page.locator('input[type=file]');
    await expect(input).toHaveAttribute('accept', '.json');

    // Centered, max-width 640px content column (spec L189).
    const column = page.locator('main > div');
    await expect(column).toHaveClass(/mx-auto/);
    await expect(column).toHaveClass(/max-w-\[640px\]/);

    // The 48px zinc-500 icon (spec L204). Scoped to `main`: the sidebar's DATA
    // group and Drop Tables item use the same lucide `package` glyph.
    const icon = page.getByRole('main').locator('svg.lucide-package');
    await expect(icon).toHaveClass(/h-12/);
    await expect(icon).toHaveClass(/w-12/);
    await expect(icon).toHaveClass(/text-zinc-500/);

    // Click-to-browse really opens the picker for the hidden input.
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Drag & drop packet capture file here/ }).click();
    expect((await chooser).isMultiple()).toBe(false);

    // Drag-over swaps the spec's own colours (L204), then swaps back.
    const dropzone = page.locator('[data-drag-over]');
    await expect(dropzone).toHaveClass(/rounded-xl/);
    await expect(dropzone).toHaveClass(/border-dashed/);
    await expect(dropzone).toHaveClass(/border-zinc-700/);
    await expect(dropzone).toHaveClass(/bg-zinc-900\/50/);

    await dropzone.dispatchEvent('dragover');
    await expect(dropzone).toHaveClass(/border-blue-500/);
    await expect(dropzone).toHaveClass(/bg-blue-600\/20/);
    await expect(dropzone).toHaveAttribute('data-drag-over', 'true');

    await dropzone.dispatchEvent('dragleave');
    await expect(dropzone).toHaveClass(/border-zinc-700/);
  });

  test('shows the file card, an indeterminate spinner with "Extracting quests..." and Cancel', async ({
    page,
  }) => {
    // Hold the extraction open so the in-flight state is asserted rather than raced.
    const held = gate();
    await mockApi(page, {
      onExtract: async (route) => {
        await held.wait;
        await route.fulfill({ json: { quests: QUESTS, count: QUESTS.length } });
      },
    });
    await openExtractionPage(page);
    await uploadCapture(page);

    // File card: name + human-readable size.
    await expect(page.getByText(CAPTURE_NAME)).toBeVisible();
    await expect(page.getByText(`${CAPTURE_BUFFER.byteLength} B`)).toBeVisible();

    // Indeterminate: the spinner animates, the text is the spec's, and there is
    // deliberately no progress value anywhere.
    const status = page.getByRole('status').filter({ hasText: /^Extracting quests\.\.\.$/ });
    await expect(status).toBeVisible();
    await expect(status.locator('svg.lucide-loader-circle.animate-spin')).toBeVisible();
    await expect(page.getByText(EXTRACTING_TEXT, { exact: true })).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expect(page.locator('[aria-valuenow]')).toHaveCount(0);

    // The destructive Cancel that aborts (D9).
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();

    // The info toast of spec L123 accompanies the run.
    await expect(toast(page, 'Extracting quests... this may take a moment')).toBeVisible();
    await expect(page.locator('li[data-sonner-toast][data-type="info"]')).toHaveCount(1);

    held.open();
  });

  test('an error surfaces the server message and returns to the upload phase', async ({ page }) => {
    await mockApi(page, {
      onExtract: (route) =>
        route.fulfill({
          status: 400,
          json: { error: 'Failed to parse packet capture: invalid file format' },
        }),
    });
    await openExtractionPage(page);
    await uploadCapture(page);

    const errorToast = toast(page, 'Failed to parse packet capture: invalid file format');
    await expect(errorToast).toBeVisible();
    await expect(errorToast).toHaveAttribute('data-type', 'error');

    // Not stranded in the spinner: back to the drop zone, with the message inline.
    await expect(page.getByText(UPLOAD_FORMAT_HINT)).toBeVisible();
    await expect(page.getByText(EXTRACTING_TEXT, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveText(
      'Failed to parse packet capture: invalid file format',
    );
  });

  test('a 500 from an unbuilt CLI is surfaced verbatim', async ({ page }) => {
    await mockApi(page, {
      onExtract: (route) =>
        route.fulfill({
          status: 500,
          json: {
            error:
              'Extraction CLI not found at tools/bin/imview-packet-reader — run npm run build:cli',
          },
        }),
    });
    await openExtractionPage(page);
    await uploadCapture(page);

    await expect(toast(page, 'run npm run build:cli')).toBeVisible();
    await expect(page.getByText(UPLOAD_FORMAT_HINT)).toBeVisible();
  });

  test('Cancel aborts the fetch, returns to upload, and a late response cannot resurrect it', async ({
    page,
  }) => {
    const held = gate();
    // Two independent observations of the same abort:
    //  (a) Playwright's own network view — the intercepted request fails with
    //      ERR_ABORTED ("the mocked route sees the request aborted");
    //  (b) the AbortSignal the page passed to fetch, recorded from inside the page,
    //      which is the client half of D9 that makes the server kill the CLI child.
    const failedRequests: string[] = [];
    page.on('requestfailed', (request) => {
      if (new URL(request.url()).pathname === '/api/extract/quests') {
        failedRequests.push(request.failure()?.errorText ?? 'unknown');
      }
    });
    await page.addInitScript(() => {
      const original = window.fetch;
      const record = window as unknown as { __abortedFetches: string[] };
      record.__abortedFetches = [];
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            record.__abortedFetches.push(typeof input === 'string' ? input : String(input));
          });
        }
        return original.call(window, input, init);
      };
    });

    let fulfilledLate = false;
    await mockApi(page, {
      onExtract: async (route) => {
        await held.wait;
        await route
          .fulfill({ json: { quests: QUESTS, count: QUESTS.length } })
          .then(() => {
            fulfilledLate = true;
          })
          .catch(() => undefined);
      },
    });

    await openExtractionPage(page);
    await uploadCapture(page);
    await expect(page.getByText(EXTRACTING_TEXT, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    // Back to the upload phase immediately — and with no error toast (a cancel is
    // not a failure).
    await expect(page.getByText(UPLOAD_FORMAT_HINT)).toBeVisible();
    await expect(page.getByText(EXTRACTING_TEXT, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('li[data-sonner-toast][data-type="error"]')).toHaveCount(0);

    // The signal really was aborted, on the extraction request (D9/D47).
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __abortedFetches: string[] }).__abortedFetches),
      )
      .toContain('/api/extract/quests');
    // …and the network layer agrees.
    await expect.poll(() => failedRequests.join(' | ')).toMatch(/ERR_ABORTED/);

    // …and the late resolution the mock now releases is dropped by the epoch guard.
    held.open();
    await expect.poll(() => fulfilledLate).toBe(true);
    await expect(page.getByRole('listbox', { name: 'Extracted quests' })).toHaveCount(0);
    await expect(page.getByText(UPLOAD_FORMAT_HINT)).toBeVisible();
  });
});

test.describe('results phase', () => {
  test('renders the split layout: a 320px list and a read-only tabbed preview', async ({
    page,
  }) => {
    await mockApi(page);
    await openResults(page);

    // Left: the list, with the spec's three badges per row.
    const list = page.getByRole('listbox', { name: 'Extracted quests' });
    const rows = page.getByRole('option');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('DS-ACAD1-C01-001');
    await expect(rows.nth(0)).toContainText('Level 1');
    await expect(rows.nth(0)).toContainText('3 goals');
    await expect(rows.nth(0)).toContainText('new');
    await expect(rows.nth(1)).toContainText('WC-UNICORN-MAIN-004');
    await expect(rows.nth(1)).toContainText('Level 12');
    await expect(rows.nth(1)).toContainText('1 goal');

    // 320px, and the first row is selected with the spec's blue-600/10.
    const width = await list.evaluate((element) => element.getBoundingClientRect().width);
    expect(width).toBeCloseTo(320, 0);
    await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(rows.nth(0)).toHaveClass(/bg-blue-600\/10/);

    // Right: the read-only tabbed preview, six tabs, Info by default.
    await expect(page.getByRole('tablist', { name: 'Quest preview sections' })).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(6);
    await expect(page.getByRole('tab', { name: 'Info' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toContainText('m_questName');
    // Read-only: no form control can be reached in the preview.
    await expect(page.getByRole('main').locator('input, textarea, select')).toHaveCount(0);

    // Every tab renders its own section.
    await page.getByRole('tab', { name: 'Goals' }).click();
    await expect(page.getByRole('tabpanel')).toContainText('1_WizardQuestGoals_TalkToProspector');
    await expect(page.getByRole('tabpanel')).toContainText('BountyGoalTemplate');
    await page.getByRole('tab', { name: 'Goal Logic' }).click();
    await expect(page.getByRole('tabpanel')).toContainText('m_goalsAND');
    await page.getByRole('tab', { name: 'Requirements' }).click();
    await expect(page.getByRole('tabpanel')).toContainText('ReqHasQuest');
    await page.getByRole('tab', { name: 'Results' }).click();
    await expect(page.getByRole('tabpanel')).toContainText('ResDropTable');
    await page.getByRole('tab', { name: 'Dialog' }).click();
    await expect(page.getByRole('tabpanel')).toContainText('m_dialogList');

    // Selecting another row moves the preview to that quest and back to Info.
    await rows.nth(1).click();
    await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'false');
    await expect(rows.nth(0)).not.toHaveClass(/bg-blue-600\/10/);
    await expect(rows.nth(1)).toHaveClass(/bg-blue-600\/10/);
    await expect(page.getByRole('tab', { name: 'Info' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toContainText('WC-UNICORN-MAIN-004');

    // The action bar is exactly the spec's three buttons.
    await expect(page.getByRole('button', { name: 'Save All to SpiralDB' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Selected', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Discard', exact: true })).toBeVisible();
  });

  test('an empty extraction shows the empty state and Discard returns to upload', async ({
    page,
  }) => {
    await mockApi(page, {
      onExtract: (route) => route.fulfill({ json: { quests: [], count: 0 } }),
    });
    await openExtractionPage(page);
    await uploadCapture(page);

    await expect(page.getByText('No quests found in this packet capture.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save All to SpiralDB' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save Selected', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Discard', exact: true })).toBeEnabled();

    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(page.getByText(UPLOAD_FORMAT_HINT)).toBeVisible();
  });

  test('Save All asks for confirmation with the exact copy, and only then POSTs — one toast per quest', async ({
    page,
  }) => {
    const recorded = await mockApi(page);
    await openResults(page);

    await page.getByRole('button', { name: 'Save All to SpiralDB' }).click();

    const confirm = page.getByRole('dialog');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(
      'Save 2 quests to SpiralDB? This will create files and auto-commit.',
    );
    // Nothing was written just by opening the dialog.
    expect(recorded.savedQuests).toEqual([]);

    // Cancelling the dialog writes nothing either.
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(confirm).toHaveCount(0);
    expect(recorded.savedQuests).toEqual([]);

    // Confirming saves every extracted quest, in list order.
    await page.getByRole('button', { name: 'Save All to SpiralDB' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();

    await expect
      .poll(() => recorded.savedQuests.map((quest) => quest.m_questName))
      .toEqual(['DS-ACAD1-C01-001', 'WC-UNICORN-MAIN-004']);
    await expect(toast(page, 'Quest DS-ACAD1-C01-001 saved and committed')).toBeVisible();
    await expect(toast(page, 'Quest WC-UNICORN-MAIN-004 saved and committed')).toBeVisible();
    await expect(page.locator('li[data-sonner-toast][data-type="success"]')).toHaveCount(2);
  });

  test('Save Selected saves only the selected quest', async ({ page }) => {
    const recorded = await mockApi(page);
    await openResults(page);

    await page.getByRole('option').nth(1).click();
    await page.getByRole('button', { name: 'Save Selected', exact: true }).click();

    await expect
      .poll(() => recorded.savedQuests.map((quest) => quest.m_questName))
      .toEqual(['WC-UNICORN-MAIN-004']);
    // The wire body is `{ quest, source }`: the client invents no status (the
    // endpoint inserts `extracted` itself) and sends the selected capture's file
    // name as `source` (gap B — the endpoint has no other way to know it).
    expect(Object.keys(recorded.saveBodies[0] ?? {})).toEqual(['quest', 'source']);
    expect(recorded.saveBodies[0]?.source).toBe(CAPTURE_NAME);
    await expect(toast(page, 'Quest WC-UNICORN-MAIN-004 saved and committed')).toBeVisible();
  });

  test('a failed save surfaces the server message (the D14 dirty tree, 409)', async ({ page }) => {
    await mockApi(page, {
      onSave: (route) =>
        route.fulfill({
          status: 409,
          json: {
            error:
              'The SpiralDB working tree has uncommitted changes. Commit or stash them before saving.',
          },
        }),
    });
    await openResults(page);

    await page.getByRole('button', { name: 'Save Selected', exact: true }).click();

    await expect(toast(page, 'The SpiralDB working tree has uncommitted changes')).toBeVisible();
    await expect(page.locator('li[data-sonner-toast][data-type="error"]')).toHaveCount(1);
  });

  test('a D48(d) duplicate-metadata warning is surfaced as a warning toast', async ({ page }) => {
    const warning =
      'QuestMetadatas/ holds 2 files whose "Name" is "DS-ACAD1-C01-001". The save updated ' +
      'QuestMetadatas/069f430e.json (first in file-name order) and left the other untouched.';
    await mockApi(page, {
      onSave: async (route) => {
        const body = JSON.parse(route.request().postData() ?? '{}') as {
          quest: Record<string, unknown>;
        };
        await route.fulfill({ json: { ...saveResultFor(body.quest), warnings: [warning] } });
      },
    });
    await openResults(page);

    await page.getByRole('button', { name: 'Save Selected', exact: true }).click();

    await expect(page.locator('li[data-sonner-toast][data-type="warning"]')).toContainText(
      'QuestMetadatas/ holds 2 files',
    );
  });
});

/**
 * Gap A (plan §2.4's last bullet) — the overwrite confirmation, and gap B's
 * `source` field on the wire.
 *
 * Everything here is hermetic: `GET /api/quests` is mocked with the names the
 * spec wants to be "already in SpiralDB", so no sibling repo, no CLI and no real
 * save are involved. The two properties the AC cares about are pinned explicitly —
 * the existing names are on screen before anything is written, and a `POST
 * /api/quests` cannot happen before the user confirms.
 */
test.describe('overwrite confirmation (gap A)', () => {
  const EXISTING = 'WC-UNICORN-MAIN-004';
  const NEW_QUEST = 'DS-ACAD1-C01-001';

  test('Save All lists the names it would overwrite, and POSTs only after the confirmation', async ({
    page,
  }) => {
    const recorded = await mockApi(page, { existingQuests: [EXISTING] });
    await openResults(page);

    // Lazily fetched: nothing is asked of SpiralDB just by looking at the results.
    expect(recorded.listRequests).toBe(0);

    await page.getByRole('button', { name: 'Save All to SpiralDB' }).click();

    const confirm = page.getByRole('dialog');
    await expect(confirm).toBeVisible();
    // The AC's sentence is unchanged — the warning is added next to it.
    await expect(confirm).toContainText(
      'Save 2 quests to SpiralDB? This will create files and auto-commit.',
    );
    const overwrite = confirm.getByRole('list', { name: 'Quests that will be overwritten' });
    await expect(overwrite).toBeVisible();
    await expect(overwrite).toContainText(EXISTING);
    // A quest that is not in SpiralDB is never listed as an overwrite.
    await expect(overwrite).not.toContainText(NEW_QUEST);

    // Zero POSTs until the user confirms — only the one lazy list read happened.
    expect(recorded.savedQuests).toEqual([]);
    expect(recorded.listRequests).toBe(1);

    // Cancelling writes nothing either.
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(confirm).toHaveCount(0);
    expect(recorded.savedQuests).toEqual([]);

    // Confirming proceeds with the save, and the name list is not re-fetched.
    await page.getByRole('button', { name: 'Save All to SpiralDB' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();

    await expect
      .poll(() => recorded.savedQuests.map((quest) => quest.m_questName))
      .toEqual([NEW_QUEST, EXISTING]);
    expect(recorded.listRequests).toBe(1);
    // Gap B: both save paths send the selected capture's file name.
    expect(recorded.saveBodies.map((body) => body.source)).toEqual([CAPTURE_NAME, CAPTURE_NAME]);
  });

  test('Save All shows no overwrite wording when every extracted quest is new', async ({
    page,
  }) => {
    const recorded = await mockApi(page);
    await openResults(page);

    await page.getByRole('button', { name: 'Save All to SpiralDB' }).click();

    const confirm = page.getByRole('dialog');
    await expect(confirm).toContainText(
      'Save 2 quests to SpiralDB? This will create files and auto-commit.',
    );
    // The check still ran — that is what proves the names are new.
    expect(recorded.listRequests).toBe(1);
    await expect(
      confirm.getByRole('list', { name: 'Quests that will be overwritten' }),
    ).toHaveCount(0);
    await expect(confirm).not.toContainText('already exist in SpiralDB');
    expect(recorded.savedQuests).toEqual([]);
  });

  test('Save Selected on an existing quest asks first, listing that name', async ({ page }) => {
    const recorded = await mockApi(page, { existingQuests: [NEW_QUEST, EXISTING] });
    await openResults(page);

    await page.getByRole('option').nth(1).click();
    await page.getByRole('button', { name: 'Save Selected', exact: true }).click();

    const confirm = page.getByRole('dialog');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('Overwrite quest');
    await expect(confirm).toContainText(EXISTING);
    await expect(confirm).toContainText('already exists in SpiralDB');
    // Nothing is written just by asking.
    expect(recorded.savedQuests).toEqual([]);

    // Cancelling keeps the quest in SpiralDB untouched.
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(confirm).toHaveCount(0);
    expect(recorded.savedQuests).toEqual([]);

    // Confirming performs exactly that one overwrite.
    await page.getByRole('button', { name: 'Save Selected', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Overwrite' }).click();

    await expect
      .poll(() => recorded.savedQuests.map((quest) => quest.m_questName))
      .toEqual([EXISTING]);
    expect(recorded.saveBodies[0]?.source).toBe(CAPTURE_NAME);
    await expect(toast(page, `Quest ${EXISTING} saved and committed`)).toBeVisible();
  });

  test('Save Selected on a new quest keeps its one-click behaviour', async ({ page }) => {
    const recorded = await mockApi(page, { existingQuests: [EXISTING] });
    await openResults(page);

    await page.getByRole('option').nth(0).click();
    await page.getByRole('button', { name: 'Save Selected', exact: true }).click();

    // No prompt — the quest is new — and the save goes straight through.
    await expect
      .poll(() => recorded.savedQuests.map((quest) => quest.m_questName))
      .toEqual([NEW_QUEST]);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(recorded.listRequests).toBe(1);
    expect(recorded.saveBodies[0]?.source).toBe(CAPTURE_NAME);
  });

  test('a failed list read blocks Save Selected and says nothing was saved', async ({ page }) => {
    const recorded = await mockApi(page, {
      onList: (route) =>
        route.fulfill({
          status: 400,
          json: { error: 'SpiralDB path is not configured. Set spiraldb_path in Settings.' },
        }),
    });
    await openResults(page);

    await page.getByRole('button', { name: 'Save Selected', exact: true }).click();

    // Fail-closed: no prompt, no write, and the reason is on screen verbatim.
    await expect(toast(page, 'SpiralDB path is not configured.')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(recorded.savedQuests).toEqual([]);
    await expect(page.locator('li[data-sonner-toast][data-type="error"]')).toHaveCount(1);
  });

  test('a failed list read disables the Save All confirm', async ({ page }) => {
    const recorded = await mockApi(page, {
      onList: (route) =>
        route.fulfill({
          status: 500,
          json: { error: 'The quest operation failed' },
        }),
    });
    await openResults(page);

    await page.getByRole('button', { name: 'Save All to SpiralDB' }).click();

    const confirm = page.getByRole('dialog');
    await expect(confirm).toContainText('The quest operation failed');
    await expect(confirm).toContainText('Nothing was saved');
    await expect(confirm.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    // The only way out is Cancel — and it really writes nothing.
    await expect(confirm.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
    expect(recorded.savedQuests).toEqual([]);

    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(confirm).toHaveCount(0);
    expect(recorded.savedQuests).toEqual([]);
  });
});

test.describe('mobile (375px)', () => {
  test('the list is full width and tapping a quest opens the preview as an overlay', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await mockApi(page);
    await openResults(page);

    // The list takes the width the 375px viewport leaves it, and the desktop pane
    // is not merely hidden — it is not mounted.
    const list = page.getByRole('listbox', { name: 'Extracted quests' });
    await expect(list).toBeVisible();
    const box = await list.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(300);
    await expect(page.getByRole('tablist', { name: 'Quest preview sections' })).toHaveCount(0);

    // Tap → the preview opens as a modal overlay with the same read-only tabs.
    await page.getByRole('option').nth(0).click();
    const overlay = page.getByRole('dialog');
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText('DS-ACAD1-C01-001');
    await expect(overlay.getByRole('tablist', { name: 'Quest preview sections' })).toBeVisible();
    await expect(overlay.getByRole('tab')).toHaveCount(6);

    // Radix gives the overlay real modal behaviour: Escape closes it.
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0);
    await expect(list).toBeVisible();
  });
});

test.describe('identity gate (D38/D43)', () => {
  test('a blank user_name opens the dialog, the name is saved, and the pending save resumes', async ({
    page,
  }) => {
    const recorded = await mockApi(page, { userName: '' });
    await openResults(page);

    await page.getByRole('button', { name: 'Save Selected', exact: true }).click();

    // The gate prompts *before* the first write…
    const identity = page.getByRole('dialog', { name: 'What should we call you?' });
    await expect(identity).toBeVisible();
    expect(recorded.savedQuests).toEqual([]);

    // …the entered name is persisted as `settings.user_name`…
    await identity.getByLabel('Your name').fill('Ada Lovelace');
    await identity.getByRole('button', { name: 'Save name' }).click();
    await expect.poll(() => recorded.putSettings).toEqual([{ user_name: 'Ada Lovelace' }]);

    // …and the save continues by itself, with no second click.
    await expect
      .poll(() => recorded.savedQuests.map((quest) => quest.m_questName))
      .toEqual(['DS-ACAD1-C01-001']);
    await expect(toast(page, 'Quest DS-ACAD1-C01-001 saved and committed')).toBeVisible();
    await expect(identity).toHaveCount(0);
  });

  test('dismissing the dialog performs no save and claims no success', async ({ page }) => {
    const recorded = await mockApi(page, { userName: '' });
    await openResults(page);

    await page.getByRole('button', { name: 'Save All to SpiralDB' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();

    const identity = page.getByRole('dialog', { name: 'What should we call you?' });
    await expect(identity).toBeVisible();
    await identity.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(identity).toHaveCount(0);

    // Give any (wrong) in-flight save a chance to appear, then prove it did not.
    await expect(page.getByRole('tabpanel')).toBeVisible();
    expect(recorded.savedQuests).toEqual([]);
    expect(recorded.putSettings).toEqual([]);
    await expect(
      page.locator('li[data-sonner-toast]').filter({ hasText: 'saved and committed' }),
    ).toHaveCount(0);
  });
});

/**
 * P2 AC#13's chain, in **one** spec (D23 tier 1).
 *
 * The AC asks for the whole path — a D28-generated capture uploaded through the real
 * dropzone → spinner → N results → Save All + confirm → success toast → **the browse
 * list grows by N** — and a chain split across specs proves each clause while leaving
 * the join unproven. The join is the part that was missing: before this story no spec
 * visited `/quests` after a save.
 *
 * What is real here: the **committed** capture (read from disk, uploaded through the
 * real hidden input), the app, the dropzone, the confirm dialogs and the browse page.
 * What is mocked: the API — including the extraction answer, because CI has no .NET
 * CLI (D23 tier 1). The answer's count is the one `verify-captures.mjs` measures for
 * the uploaded fixture, so "N quests" is the real artifact's own number.
 *
 * The `GET /api/quests` mock is **stateful** for both specs (`browseRows`): it answers
 * M rows before the save and M+N after it, exactly as the real endpoint's per-request
 * corpus rescan does, so "grows by N" is asserted against rendered rows and the
 * pagination line rather than against a constant.
 */
test.describe('save → browse, the P2 AC#13 chain', () => {
  test('a D28 capture → 1 result → Save All + confirm → toast → the browse list grows by 1', async ({
    page,
  }) => {
    // The extraction is held open so the spinner (and the file card describing the
    // *real* file) is asserted rather than raced.
    const held = gate();
    const recorded = await mockApi(page, {
      browseRows: browseSeed(),
      onExtract: async (route) => {
        await held.wait;
        await route.fulfill({ json: { quests: [REAL_CAPTURE_QUEST], count: 1 } });
      },
    });

    // The committed artifact's on-disk length, asserted first so the file card's
    // text below cannot be satisfied by a substituted fixture (README pins this file
    // by SHA-256 at corpus commit `c55ccab…`).
    expect(REAL_CAPTURE.byteLength).toBe(14_235);

    // The "before": the browse list this save is about to grow, and the numbers the
    // "after" is measured against. The capture's quest is absent from it, so the save
    // is a create and not gap A's overwrite.
    await page.goto('/quests');
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByText('Showing 1-2 of 2')).toBeVisible();
    await expect(filterTab(page, 'All')).toContainText('2');
    await expect(filterTab(page, 'Extracted')).toContainText('0');
    await expect(page.getByText(REAL_CAPTURE_QUEST.m_questName)).toHaveCount(0);

    // Into the extraction page the way a user gets there.
    await page.getByRole('link', { name: 'Extract Quests' }).click();
    await expect(page.getByText(UPLOAD_FORMAT_HINT)).toBeVisible();

    // Upload the committed capture through the real dropzone input.
    await uploadFile(page, REAL_CAPTURE_NAME, REAL_CAPTURE);

    // The file card names the uploaded file and shows its real size in KB.
    await expect(page.getByText(REAL_CAPTURE_NAME)).toBeVisible();
    await expect(page.getByText('13.9 KB')).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: /^Extracting quests\.\.\.$/ }),
    ).toBeVisible();
    held.open();

    // N results: 1, the count this fixture reconstructs to.
    await expect(page.getByRole('listbox', { name: 'Extracted quests' })).toBeVisible();
    const resultRows = page.getByRole('option');
    await expect(resultRows).toHaveCount(1);
    await expect(resultRows.first()).toContainText('WC-UNICORN-MAIN-004');
    await expect(resultRows.first()).toContainText('Level 0');
    await expect(resultRows.first()).toContainText('7 goals');
    await expect(resultRows.first()).toContainText('new');

    // Save All + confirm: the app's own sentence with the count interpolated, nothing
    // written before the confirmation, and no overwrite list (the name is new).
    await page.getByRole('button', { name: 'Save All to SpiralDB' }).click();
    const confirm = page.getByRole('dialog');
    await expect(confirm).toContainText(
      'Save 1 quests to SpiralDB? This will create files and auto-commit.',
    );
    await expect(
      confirm.getByRole('list', { name: 'Quests that will be overwritten' }),
    ).toHaveCount(0);
    expect(recorded.savedQuests).toEqual([]);
    await confirm.getByRole('button', { name: 'Save', exact: true }).click();

    // The success toast, and the wire contract the capture note is built from
    // (D50(i)): the body's `source` is the uploaded capture's base name — the server
    // turns it into `Imported from packet capture {source}` on the inserted row.
    await expect(toast(page, 'Quest WC-UNICORN-MAIN-004 saved and committed')).toBeVisible();
    await expect
      .poll(() => recorded.saveBodies.map((body) => body.source))
      .toEqual([REAL_CAPTURE_NAME]);

    // "…the browse list grows by N": back to the same list, now M+N. The extraction
    // page invalidated `QUESTS_QUERY_KEY` on success, so the list must have been
    // refetched rather than served from the pre-save cache.
    const listRequestsBefore = recorded.listRequests;
    await page.getByRole('link', { name: 'Browse Quests' }).click();
    await expect(page).toHaveURL(/\/quests$/);
    await expect(rows(page)).toHaveCount(3);
    await expect(page.getByText('Showing 1-3 of 3')).toBeVisible();
    await expect(filterTab(page, 'All')).toContainText('3');
    await expect(filterTab(page, 'Extracted')).toContainText('1');
    expect(recorded.listRequests).toBeGreaterThan(listRequestsBefore);

    // The grown row is the saved quest's own — name, level and goal count come from
    // the saved object (see `browseRowFor`) — and exactly one row was added.
    const grown = rows(page).filter({ hasText: REAL_CAPTURE_QUEST.m_questName });
    await expect(grown).toHaveCount(1);
    await expect(grown.locator('td').nth(1)).toHaveText('WC-UNICORN-MAIN-004');
    await expect(grown.locator('td').nth(2)).toHaveText('0');
    await expect(grown.locator('td').nth(3)).toHaveText('7');
    await expect(grown.getByTitle('Extracted')).toHaveCount(1);
  });

  test('a multi-quest extraction grows the browse list by its own N (mocked N = 2)', async ({
    page,
  }) => {
    const recorded = await mockApi(page, {
      browseRows: browseSeed(),
      // N > 1 comes from the mock, and only from the mock: `verify-captures.mjs`
      // asserts **exactly one** reconstructed quest for each of the five committed
      // fixtures, so no capture in this repo can honestly produce two. The upload is
      // therefore the inline stub — a capture whose real answer would contradict the
      // answer this endpoint gives.
      onExtract: (route) => route.fulfill({ json: { quests: QUESTS, count: QUESTS.length } }),
    });

    await page.goto('/quests');
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByText('Showing 1-2 of 2')).toBeVisible();

    await page.getByRole('link', { name: 'Extract Quests' }).click();
    await expect(page.getByText(UPLOAD_FORMAT_HINT)).toBeVisible();
    await uploadCapture(page);
    await expect(page.getByRole('listbox', { name: 'Extracted quests' })).toBeVisible();
    await expect(page.getByRole('option')).toHaveCount(2);

    await page.getByRole('button', { name: 'Save All to SpiralDB' }).click();
    const confirm = page.getByRole('dialog');
    await expect(confirm).toContainText(
      'Save 2 quests to SpiralDB? This will create files and auto-commit.',
    );
    await confirm.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(toast(page, 'Quest DS-ACAD1-C01-001 saved and committed')).toBeVisible();
    await expect(toast(page, 'Quest WC-UNICORN-MAIN-004 saved and committed')).toBeVisible();

    // M + 2: four rows on one page, both counts and the pagination line agreeing.
    await page.getByRole('link', { name: 'Browse Quests' }).click();
    await expect(page).toHaveURL(/\/quests$/);
    await expect(rows(page)).toHaveCount(4);
    await expect(page.getByText('Showing 1-4 of 4')).toBeVisible();
    await expect(filterTab(page, 'All')).toContainText('4');
    await expect(filterTab(page, 'Extracted')).toContainText('2');

    // One row per saved quest, no more: the two stub names are new to this corpus.
    await expect(rows(page).filter({ hasText: 'DS-ACAD1-C01-001' })).toHaveCount(1);
    await expect(rows(page).filter({ hasText: 'WC-UNICORN-MAIN-004' })).toHaveCount(1);

    // The capture's name rides on every save body of the run, one POST per quest.
    await expect
      .poll(() => recorded.saveBodies.map((body) => body.source))
      .toEqual([CAPTURE_NAME, CAPTURE_NAME]);
  });
});
