import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { mockQuestsApi } from './quests-mocks';

/**
 * Tier-1 Basic/Advanced spec (task 7.11, p7-12, D132/D179).
 *
 * - a dialog entry of the D118 skeleton's shape (every value the skeleton's own `0`/`false`/`''`)
 *   shows at most 12 fields by default, with the four advanced accordions collapsed;
 * - a real quest of the D17 clone (the committed 10-quest fixture) opens the accordion that holds
 *   one of its advanced values;
 * - a validation message on an advanced field is visible without the user opening anything, and
 *   the accordion refuses to close while it shows;
 * - the Info tab's Advanced disclosure follows the same rule.
 */

const ENTRY_TYPE = 'Imcodec.ObjectProperty.TypeCache.NPCDialogEntry, Imcodec.ObjectProperty';
const LIST_TYPE = 'Imcodec.ObjectProperty.TypeCache.ActorDialogList, Imcodec.ObjectProperty';
const NAME = 'DS-ADV-C01-001';

/** The committed 10-quest fixture of real D17 clone documents (task 7.10's pins). */
const fixture = JSON.parse(
  readFileSync(path.resolve('tests/unit/fixtures/card-titles-quests.json'), 'utf8'),
) as { quests: Record<string, Record<string, unknown>> };

/**
 * An entry whose every value is its field's own default — what `newDialogEntry` writes (D195): so
 * nothing here is advanced-and-set. D195 changed four values here deliberately: the old fixture
 * held the generic empty set (`m_nameSTKey: ''`, `m_cameraHidePlayers: 0`, `m_musicFadeTime: 0`,
 * `m_spamTime: 0`, `m_meetsRequirements: false`), which the per-field rule now reads as authored.
 */
function skeletonEntry(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $type: ENTRY_TYPE,
    m_personaName: '',
    m_nameOverride: '',
    m_nameSTKey: 'NPCFormats_First_Last',
    m_guiDisplay: '',
    m_maxTimeSeconds: 0,
    m_invisible: false,
    m_requirements: null,
    m_dialog: '',
    m_picture: '',
    m_soundFile: '',
    m_action: '',
    m_dialogEvent: '',
    m_actorTemplateID: 0,
    m_cameraName: '',
    m_cameraHidePlayers: 2,
    m_cameraOffsetX: 0,
    m_musicFadeTime: 3,
    m_spamTime: 1,
    m_walkAwayNpcTemplateID: 0,
    m_meetsRequirements: true,
    ...extra,
  };
}

function questWith(entry: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    m_questName: NAME,
    m_questTitle: 'QuestTitle_1ED8D',
    m_dialogList: {
      $type: LIST_TYPE,
      m_dialogs: [
        {
          m_dialogTag: 'Prep',
          m_dialogEntries: [entry],
          m_madlibs: null,
          m_dialogEvents: null,
          m_noAggroWhileDialogIsUp: false,
          m_noAggroNoDelay: false,
        },
      ],
    },
    ...extra,
  };
}

async function mockNames(page: Page): Promise<void> {
  await page.route('**/api/names/npcs', (route) =>
    route.fulfill({ json: { npcs: [{ template_id: 126322, name: 'Zarek Pickmaster' }] } }),
  );
  await page.route('**/api/names/zones', (route) => route.fulfill({ json: { zones: [] } }));
  await page.route('**/api/names/*/*', (route) =>
    route.fulfill({ status: 404, json: { error: 'unknown' } }),
  );
}

async function open(page: Page, name: string, doc: unknown, tab: string): Promise<void> {
  await mockQuestsApi(page, { onDetail: (route) => route.fulfill({ json: doc }) });
  await mockNames(page);
  await page.goto(`/quests/${name}`);
  await page.getByRole('main').getByRole('tab', { name: tab, exact: true }).click();
}

function accordion(scope: Locator, label: string): Locator {
  return scope.getByRole('button', { name: label, exact: true });
}

test.describe('Basic vs Advanced', () => {
  test('a skeleton-shaped dialog entry shows at most 12 fields, advanced collapsed', async ({
    page,
  }) => {
    await open(page, NAME, questWith(skeletonEntry()), 'Dialog');
    const card = page.locator('article[aria-label^="Entry 1 "]');
    await expect(card).toBeVisible();
    for (const label of ['Camera', 'Sound', 'Animation', 'Advanced']) {
      await expect(accordion(card, label)).toHaveAttribute('aria-expanded', 'false');
    }
    await expect(accordion(card, 'Basic')).toHaveAttribute('aria-expanded', 'true');
    const controls = card.locator(
      'input:visible, select:visible, textarea:visible, [role="combobox"]:visible',
    );
    const count = await controls.count();
    expect(count).toBeGreaterThanOrEqual(9);
    expect(count).toBeLessThanOrEqual(12);
  });

  test('a real clone quest with an advanced value opens the accordion that holds it', async ({
    page,
  }) => {
    const quests = fixture.quests;
    const name = 'DS-ACAD-C01-001';
    const doc = quests[name]!;
    const entries = (
      doc.m_dialogList as { m_dialogs: Array<{ m_dialogEntries: Array<Record<string, unknown>> }> }
    ).m_dialogs.flatMap((group) => group.m_dialogEntries);
    const withCamera = entries.flatMap((entry, i) => (entry.m_cameraHidePlayers ? [i] : []));
    expect(withCamera.length).toBeGreaterThan(0);

    await open(page, name, doc, 'Dialog');
    const cards = page.locator('article[aria-label^="Entry "]');
    await expect(cards.first()).toBeVisible();
    const cameraFirst = cards.nth(withCamera[0]!);
    await expect(accordion(cameraFirst, 'Camera')).toHaveAttribute('aria-expanded', 'true');
  });

  test('an authored false where the field defaults to true opens its accordion (D195)', async ({
    page,
  }) => {
    // m_bypassCameraOnReview: new entries write true; 35 of the clone's 1,706 entries author false.
    await open(page, NAME, questWith(skeletonEntry({ m_bypassCameraOnReview: false })), 'Dialog');
    const card = page.locator('article[aria-label^="Entry 1 "]');
    await expect(card).toBeVisible();
    await expect(accordion(card, 'Camera')).toHaveAttribute('aria-expanded', 'true');
    for (const label of ['Sound', 'Animation', 'Advanced']) {
      await expect(accordion(card, label)).toHaveAttribute('aria-expanded', 'false');
    }
  });

  test('a freshly added dialog entry stays collapsed: its values are its own defaults (D195)', async ({
    page,
  }) => {
    await open(page, NAME, questWith(skeletonEntry()), 'Dialog');
    await page
      .getByRole('main')
      .getByRole('button', { name: 'Add Dialog Entry', exact: true })
      .first()
      .click();
    const added = page.locator('article[aria-label^="Entry 2 "]');
    await expect(added).toBeVisible();
    for (const label of ['Camera', 'Sound', 'Animation', 'Advanced']) {
      await expect(accordion(added, label)).toHaveAttribute('aria-expanded', 'false');
    }
  });

  test('a real clone ReqHasEntry with m_isQuestRegistry false opens its Advanced (D195)', async ({
    page,
  }) => {
    // WC-UNICORN-MAIN-002 (D17 clone), committed as the served document so CI needs no data/.
    const doc = (
      JSON.parse(
        readFileSync(
          path.resolve('tests/unit/fixtures/clone-quest-WC-UNICORN-MAIN-002.json'),
          'utf8',
        ),
      ) as { quest: Record<string, unknown> }
    ).quest;
    await open(page, 'WC-UNICORN-MAIN-002', doc, 'Requirements');
    const leaf = (index: number) =>
      page
        .getByRole('main')
        .locator(`article[data-path="m_requirements[${index}]"]`)
        .locator('details');
    // [1] authors false (default true): open. [0] holds the default true: collapsed — under the
    // old generic-empty rule the two were the other way round.
    await expect(leaf(1)).toHaveAttribute('open', '');
    await expect(leaf(0)).toBeAttached();
    await expect(leaf(0)).not.toHaveAttribute('open', '');
  });

  test('a validation message on an advanced field is visible unopened and cannot be hidden', async ({
    page,
  }) => {
    await open(page, NAME, questWith(skeletonEntry({ m_walkAwayNpcTemplateID: 999999 })), 'Dialog');
    const card = page.locator('article[aria-label^="Entry 1 "]');
    const advanced = accordion(card, 'Advanced');
    await expect(advanced).toHaveAttribute('aria-expanded', 'true');
    const message = card
      .getByRole('group', { name: 'Advanced fields' })
      .getByRole('list', { name: 'Validation messages' });
    await expect(message).toBeVisible();
    // Closing it would hide the message: the click is refused.
    await advanced.click();
    await expect(advanced).toHaveAttribute('aria-expanded', 'true');
    await expect(message).toBeVisible();
  });

  test('the Info tab opens Advanced only for a value that differs from the default', async ({
    page,
  }) => {
    await open(
      page,
      NAME,
      questWith(skeletonEntry(), { m_questNameID: 0, m_outdated: false }),
      'Info',
    );
    const details = page.getByRole('region', { name: 'Quest info editor' }).locator('details');
    await expect(details.locator('summary')).toHaveText('Advanced (12)');
    await expect(details).not.toHaveAttribute('open', '');

    await open(page, NAME, questWith(skeletonEntry(), { m_outdated: true }), 'Info');
    await expect(
      page.getByRole('region', { name: 'Quest info editor' }).locator('details'),
    ).toHaveAttribute('open', '');
  });
});
