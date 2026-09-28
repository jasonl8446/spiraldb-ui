import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

/**
 * Story p4-10's **mobile (≤768px) pass** (plan task 4.12 / Phase-4 AC#13; decisions D23 tier 1,
 * D40/D44, D71(i), D75(a), D77).
 *
 * The phase's seven *keyed* families each have a list page built on `ObjectListPage` (task 4.1)
 * and a detail page built on `ObjectDetailLayout`; the eighth, **GlobalRegistry**, has no list
 * page at all — its single route *is* its editor (docs/spec-api.md L474, D75(a)) — so the
 * card-list half of the criterion has no referent there and this file says so instead of
 * inventing one.
 *
 * ## The breakpoint, stated once
 *
 * The criterion says **≤768px**. The app's own switch is `useIsMobile`'s
 * `(max-width: 767px)` — Tailwind's `md` boundary, i.e. the spec's "below md"
 * (docs/spec-ui-design.md L234/L270/L340). So this spec asserts the mobile surface at **375**
 * (a real phone) and at **767** (the widest viewport the app calls mobile, and therefore the
 * strongest reading of "≤768"), and asserts the **converse** at **768** (where the desktop table
 * and the tablet 300px side panel mount — 300, not 400: story p5-06 added the spec's tablet tier,
 * `docs/spec-ui-design.md` L518). At exactly 768px desktop wins; that one-pixel gap between the
 * criterion's wording and the implementation is pinned here rather than papered over.
 *
 * ## Every visual claim is a DOM/geometry assertion (the lead cannot read a PNG)
 *
 * | claim | the assertion that carries it | screenshot |
 * |---|---|---|
 * | "every list page renders as a card list" | `role=table` count **0** at 375 and 767 **and** the `role=list` named by the family's plural with 3 `listitem`s; the converse (card list 0, table visible) at 768 | `p4-10-<family>-list-375.png` |
 * | "the card list is the live list, not a static render" | typing one row's key into the search box narrows the cards to exactly 1 | — |
 * | "detail forms usable" | Edit mounts a real control that is visible, **unclipped** (its box lies inside the 375px viewport), is actually driven (fill / add / pick), and the drive makes Save **enabled**; the page has no horizontal overflow | `p4-10-<family>-detail-375.png` |
 * | "the JSON panel is a full overlay" | the `role=dialog` named `<label> JSON` **covers the viewport** (`boundingBox` == 375×800 at x 0, polled — the vendored dialog animates), the desktop `<aside>` is **not mounted**, and Escape closes it | `p4-10-<family>-json-overlay-375.png` |
 * | GlobalRegistry (no list page) | its editor's controls are unclipped at 375 and one row's Value box is driven → Save enabled, plus the same overlay assertion | `p4-10-globalregistry-editor-375.png` |
 *
 * A screenshot therefore accompanies an assertion; none of them is the evidence itself.
 *
 * ## Hermetic (D40)
 *
 * One dispatcher fulfils every `/api/**` request from the fixtures below, so the run reaches
 * neither the dev stack's SQLite file nor the D17 clone. The wire contracts are copied literally
 * (the reason `object-list.spec.ts` and `status-integration.spec.ts` do the same): a fixture that
 * imported `client/src/lib/objects.ts` could only prove the client agrees with itself.
 */

/* ------------------------------------------------------------------ fixtures */

type Status = 'extracted' | 'reviewed' | 'verified';

/**
 * How this family's form is *driven* in edit mode — the "usable" half of the criterion.
 *
 * - `fill` — a plain text box that writes on change;
 * - `add` — a box plus the button that commits it (a repeater's or a multi-select's add);
 * - `pick` — the shared `FriendlyNameDropdown` (`role=combobox`) and the option picked from it.
 *
 * Each drive reaches the D58 document model, which is why "Save is enabled" is the proof that
 * the control worked and not merely that it rendered.
 */
type Drive =
  | { readonly kind: 'fill'; readonly label: string; readonly value: string }
  | {
      readonly kind: 'add';
      readonly label: string;
      readonly value: string;
      readonly button: string;
    }
  | {
      readonly kind: 'pick';
      readonly combo: string;
      readonly search: string;
      readonly option: string;
    };

interface FamilyFixture {
  readonly fileType: string;
  readonly label: string;
  /** Backend base path (docs/spec-api.md L310-319). */
  readonly urlPath: string;
  /** D4 plural status route, or `null` for the editor-only family (Q1). */
  readonly routeType: string | null;
  readonly listPath: string;
  readonly detailPath: string;
  /** The entry's canonical key; `rows[0]` is it and sorts first (the list's default sort). */
  readonly key: string;
  readonly rows: readonly string[];
  readonly document: Record<string, unknown>;
  /** The plural noun every sentence on the list/detail pages is built from (`App.tsx`). */
  readonly nounPlural: string;
  readonly backLabel: string;
  readonly drive: Drive;
}

const DROP_A = 'DS-ACAD1-C01-001';
const DROP_B = 'DS-ACAD1-C01-002';
const DROP_C = 'DS-ACAD1-C01-003';

/** The seven keyed families, spelled exactly as `shared/objectTypes.ts` spells them. */
const KEYED: readonly FamilyFixture[] = [
  {
    fileType: 'droptable',
    label: 'Drop Tables',
    urlPath: '/api/drop-tables',
    routeType: 'drop_tables',
    listPath: '/drop-tables',
    detailPath: `/drop-tables/${DROP_A}`,
    key: DROP_A,
    rows: [DROP_A, DROP_B, DROP_C],
    document: {
      Name: DROP_A,
      Description: 'Mobile pass fixture',
      RollChance: 1,
      Weight: 100,
      NoneChance: 0,
      MinGold: 0,
      MaxGold: 0,
      Items: [],
    },
    nounPlural: 'drop tables',
    backLabel: 'Back to Drop Tables',
    drive: { kind: 'fill', label: 'Name', value: 'DS-ACAD1-C01-001-mobile' },
  },
  {
    fileType: 'npcinventory',
    label: 'NPC Inventories',
    urlPath: '/api/npc-inventories',
    routeType: 'npc_inventories',
    listPath: '/npc-inventories',
    detailPath: '/npc-inventories/1025',
    key: '1025',
    rows: ['1025', '1026', '1027'],
    document: { TemplateID: 1025, Inventory: [] },
    nounPlural: 'NPC inventories',
    backLabel: 'Back to NPC Inventories',
    drive: { kind: 'add', label: 'Add an item id', value: '160943', button: 'Add id' },
  },
  {
    fileType: 'npcspellinventory',
    label: 'NPC Spell Inventories',
    urlPath: '/api/npc-spell-inventories',
    routeType: 'npc_spell_inventories',
    listPath: '/npc-spell-inventories',
    detailPath: '/npc-spell-inventories/1057',
    key: '1057',
    rows: ['1057', '1058', '1059'],
    document: { TemplateID: 1057, Spells: [] },
    nounPlural: 'NPC spell inventories',
    backLabel: 'Back to NPC Spell Inventories',
    drive: { kind: 'pick', combo: 'Add spell', search: 'Search spells', option: 'Firecat' },
  },
  {
    fileType: 'creaturespellbook',
    label: 'Creature Spellbooks',
    urlPath: '/api/creature-spellbooks',
    routeType: 'creature_spellbooks',
    listPath: '/creature-spellbooks',
    detailPath: '/creature-spellbooks/deck-a',
    key: 'deck-a',
    rows: ['deck-a', 'deck-b', 'deck-c'],
    document: { DeckName: 'deck-a', SpellTemplateIds: [] },
    nounPlural: 'creature spellbooks',
    backLabel: 'Back to Creature Spellbooks',
    drive: { kind: 'fill', label: 'Deck name', value: 'deck-a-mobile' },
  },
  {
    fileType: 'npcdroptable',
    label: 'NPC Drop Tables',
    urlPath: '/api/npc-drop-tables',
    routeType: 'npc_drop_tables',
    listPath: '/npc-drop-tables',
    detailPath: '/npc-drop-tables/12345',
    key: '12345',
    rows: ['12345', '12346', '12347'],
    document: { TemplateID: 12345, DropTableNames: [] },
    nounPlural: 'NPC drop tables',
    backLabel: 'Back to NPC Drop Tables',
    drive: {
      kind: 'add',
      label: 'Add a drop table name',
      value: 'WC-UNICORN-BONUS-001',
      button: 'Add name',
    },
  },
  {
    fileType: 'treasurecardinventory',
    label: 'Treasure Card Inventories',
    urlPath: '/api/treasure-card-inventories',
    routeType: 'treasure_card_inventories',
    listPath: '/treasure-card-inventories',
    detailPath: '/treasure-card-inventories/2019',
    key: '2019',
    rows: ['2019', '2020', '2021'],
    document: { TemplateID: 2019, TreasureCards: [] },
    nounPlural: 'treasure card inventories',
    backLabel: 'Back to Treasure Card Inventories',
    drive: {
      kind: 'add',
      label: 'New treasure card name',
      value: 'Firecat',
      button: 'Add treasure card',
    },
  },
  {
    fileType: 'zonetransfer',
    label: 'Zone Transfers',
    urlPath: '/api/zone-transfers',
    routeType: 'zone_transfers',
    // The route key is slash-bearing, so the path encodes it (`WizardCity%2FWC_Hub`) — the
    // dispatcher decodes the segment exactly as the server does.
    listPath: '/zone-transfers',
    detailPath: '/zone-transfers/WizardCity%2FWC_Hub',
    key: 'WizardCity/WC_Hub',
    rows: ['WizardCity/WC_Hub', 'WizardCity/WC_Plaza', 'WizardCity/WC_Port'],
    document: { ZoneName: 'WizardCity/WC_Hub', Teleports: [] },
    nounPlural: 'zone transfers',
    backLabel: 'Back to Zone Transfers',
    drive: {
      kind: 'add',
      label: 'New teleport trigger name',
      value: 'p4-10-trigger',
      button: 'Add teleport',
    },
  },
];

/** The eighth family: one unkeyed dictionary, one route, no list page (Q1 / D75(a)). */
const REGISTRY: FamilyFixture = {
  fileType: 'globalregistry',
  label: 'Global Registry',
  urlPath: '/api/global-registry',
  routeType: null,
  listPath: '/global-registry',
  detailPath: '/global-registry',
  key: 'globalregistry.json',
  rows: ['globalregistry'],
  document: { GlobalRegistryValues: { Christmas: 0, Halloween: 0 } },
  nounPlural: 'global registry',
  backLabel: 'Back to Global Registry',
  // The row's own Value box writes on change (the add-row box would need the duplicate rule's
  // key to be new, so the direct row edit is the simpler real drive).
  drive: { kind: 'fill', label: 'Registry value Christmas', value: '7' },
};

/** The names tables the forms read; every dropdown this spec picks from has one row. */
const NAME_ROWS: Record<string, unknown> = {
  items: [
    { gid: 160936, name: 'Black Mantle' },
    { gid: 160943, name: 'Spiral Wand' },
  ],
  spells: [{ template_id: 84361, name: 'Firecat' }],
  npcs: [{ template_id: 1025, name: 'Lucky the Merchant' }],
  zones: [{ zone_path: 'WizardCity/WC_Hub', display_name: null, world: null }],
  drop_tables: [{ name: 'WC-UNICORN-BONUS-001', description: null }],
  quests: [{ quest_name: 'WC-UNICORN-MAIN-004', title: 'Second Quest', level: 7, is_mainline: 0 }],
};

interface Recorded {
  /** How many times each family's list endpoint was hit. */
  readonly listRequests: Record<string, number>;
}

/** The status the detail arm asserts; the entry is `reviewed`, its neighbours `extracted`. */
const ENTRY_STATUS: Status = 'reviewed';

/**
 * One dispatcher for the whole `/api/**` surface of this spec: the shell's boot reads, the names
 * tables, each family's list + detail + save, and the status list / history. A single handler
 * (rather than a dozen `page.route` calls) is what keeps the mocked status surface and the mocked
 * list rows from drifting apart.
 */
async function mockApi(page: Page): Promise<Recorded> {
  const recorded: Recorded = { listRequests: {} };
  const settings: Record<string, string> = {
    aurorium_path: '/mock/aurorium',
    imcodec_path: '/mock/imcodec',
    spiraldb_path: '/mock/spiraldb',
    user_name: 'Mock Reviewer',
    git_branch: 'content/2026-09-27',
  };

  const families = [...KEYED, REGISTRY];
  const statusOf = (family: FamilyFixture, key: string): Status =>
    key === family.key ? ENTRY_STATUS : 'extracted';

  const listBody = (family: FamilyFixture): Record<string, unknown> => {
    const rows = family.rows.map((key) => ({
      key,
      title: key,
      modified_at: '2026-06-01T00:00:00.000Z',
      status: family.routeType === null ? null : statusOf(family, key),
    }));
    const counted = rows.filter((row) => row.status !== null);
    return {
      objects: rows,
      summary:
        family.routeType === null
          ? null
          : {
              total: counted.length,
              extracted: counted.filter((row) => row.status === 'extracted').length,
              reviewed: counted.filter((row) => row.status === 'reviewed').length,
              verified: counted.filter((row) => row.status === 'verified').length,
            },
      skipped: [],
      missing_directory: false,
      duplicate_keys: [],
    };
  };

  await page.route(/\/api\//, async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const json = (body: unknown): Promise<void> => route.fulfill({ json: body });

    // The shell's own boot reads (Header, the identity gate, the import toast).
    if (path === '/api/settings') {
      await json(settings);
      return;
    }
    if (path === '/api/sync/status') {
      await json({ last_sync: null, revision: null, status: 'never' });
      return;
    }
    if (path === '/api/sync/history') {
      await json({ history: [] });
      return;
    }
    if (path === '/api/status/_import') {
      await json({ ran: false, imported: 0, imported_at: null });
      return;
    }
    // The synced names tables (`GET /api/names/:type`, and the single-id fallback that 404s).
    if (path.startsWith('/api/names/')) {
      const segments = path.slice('/api/names/'.length).split('/');
      const type = segments[0] ?? '';
      if (segments.length === 1) {
        await json({ [type]: NAME_ROWS[type] ?? [] });
      } else {
        await route.fulfill({ status: 404, json: { error: `Unknown ${type} id` } });
      }
      return;
    }

    /* ------------------------------------------------------------ the status API */
    if (path.startsWith('/api/status/')) {
      const segments = path.slice('/api/status/'.length).split('/');
      const family = families.find((row) => row.routeType === segments[0]);
      if (family === undefined || family.routeType === null) {
        await route.fulfill({ status: 404, json: { error: `Unknown status type` } });
        return;
      }
      if (segments.length === 1) {
        const entries = family.rows.map((key) => ({
          object_type: family.fileType,
          object_key: key,
          status: statusOf(family, key),
          extracted_at: '2026-06-01T00:00:00.000Z',
          reviewed_at: null,
          verified_at: null,
          latest_notes: null,
        }));
        await json({
          entries,
          summary: {
            total: entries.length,
            extracted: entries.filter((row) => row.status === 'extracted').length,
            reviewed: entries.filter((row) => row.status === 'reviewed').length,
            verified: entries.filter((row) => row.status === 'verified').length,
          },
        });
        return;
      }
      if (segments.length === 3 && segments[2] === 'history') {
        await json({ history: [] });
        return;
      }
      await route.fulfill({ status: 404, json: { error: `unmocked status ${path}` } });
      return;
    }

    /* ----------------------------------------------------------- the family routes */
    const family = families.find(
      (row) => path === row.urlPath || path.startsWith(`${row.urlPath}/`),
    );
    if (family === undefined) {
      await route.fulfill({ status: 404, json: { error: `unmocked ${method} ${path}` } });
      return;
    }
    if (path === family.urlPath) {
      recorded.listRequests[family.fileType] = (recorded.listRequests[family.fileType] ?? 0) + 1;
      if (method === 'POST') {
        await json({
          key: family.key,
          file_type: family.fileType,
          object_type: family.routeType === null ? null : family.fileType,
          outcome: 'updated',
          action: 'update',
          commit: 'a'.repeat(40),
          branch: settings.git_branch,
          commit_message: `spiraldb: update ${family.fileType} ${family.key}`,
          file: `${family.label}/${family.key}.json`,
          status: null,
          status_created: false,
          warnings: [],
        });
        return;
      }
      await json(listBody(family));
      return;
    }
    const key = decodeURIComponent(path.slice(`${family.urlPath}/`.length));
    if (key !== family.key) {
      await route.fulfill({ status: 404, json: { error: `Unknown entry "${key}"` } });
      return;
    }
    await json(family.document);
  });

  return recorded;
}

/* ------------------------------------------------------------------ helpers */

const main = (page: Page): Locator => page.getByRole('main');

/** The family's list as cards (`ObjectCardList`'s `aria-label` is the plural noun). */
const cards = (page: Page, family: FamilyFixture): Locator =>
  main(page).getByRole('list', { name: family.nounPlural });

/**
 * The control this family's form is driven through — resolved **before** the drive so the same
 * locator carries both the geometry assertion and the interaction.
 */
function driveControl(page: Page, drive: Drive): Locator {
  switch (drive.kind) {
    case 'fill':
    case 'add':
      // By label rather than by role: the registry's row boxes are `type="number"`
      // (`role=spinbutton`), and the family's control is whatever the form chose.
      return main(page).getByLabel(drive.label, { exact: true });
    case 'pick':
      return main(page).getByRole('combobox', { name: drive.combo, exact: true });
  }
}

/**
 * Drives one control and returns it. Playwright's own actionability checks (visible, stable,
 * enabled, receives events) are what make this "usable" rather than "present"; the fill/add/pick
 * then has to reach the document model, which the caller proves by Save becoming enabled.
 */
async function drive(page: Page, spec: Drive): Promise<Locator> {
  const control = driveControl(page, spec);
  switch (spec.kind) {
    case 'fill':
      await control.fill(spec.value);
      break;
    case 'add':
      await control.fill(spec.value);
      await main(page).getByRole('button', { name: spec.button, exact: true }).click();
      break;
    case 'pick':
      await control.click();
      await page.getByRole('combobox', { name: spec.search, exact: true }).fill(spec.option);
      await page.getByRole('option', { name: spec.option, exact: true }).click();
      break;
  }
  return control;
}

/** A control is unclipped when its box lies inside the viewport horizontally. */
async function expectUnclipped(locator: Locator, width: number): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const left = Math.round(box?.x ?? 0);
  const right = Math.round((box?.x ?? 0) + (box?.width ?? 0));
  expect({ left, right, inside: left >= 0 && right <= width }).toEqual({
    left,
    right,
    inside: true,
  });
}

/**
 * Nothing on the page is wider than the viewport — i.e. no control is clipped off-screen.
 *
 * The assertion names the offending elements in its own failure message, so a regression says
 * *which* control overflowed rather than only that the document did.
 */
async function expectNoHorizontalOverflow(page: Page, width: number): Promise<void> {
  const measured = await page.evaluate((viewport) => {
    const offenders: string[] = [];
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && Math.round(rect.right) > viewport) {
        offenders.push(
          `<${element.tagName.toLowerCase()}> right=${Math.round(rect.right)} ` +
            `class="${element.className.toString().slice(0, 60)}"`,
        );
      }
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      offenders: offenders.slice(0, 8),
    };
  }, width);
  expect(measured.offenders, 'elements whose right edge is past the viewport').toEqual([]);
  expect(measured.scrollWidth).toBeLessThanOrEqual(measured.clientWidth);
}

/** The JSON toggle (`JSON_PANEL_LABEL`) and the desktop `<aside>` it mounts at ≥768px. */
const jsonToggle = (page: Page): Locator => page.getByRole('button', { name: 'Toggle JSON panel' });

/**
 * The overlay assertion the criterion's third clause rests on: the dialog's box **is** the
 * viewport. Polled, because the vendored dialog animates in (`zoom-in-95` in the shared
 * primitive), so a single sample measures the scaled rect and not the layout one — measured at
 * 356.25 of 375 at the animation's start in `quests-detail.spec.ts`.
 */
async function expectFullViewportOverlay(page: Page, title: string, size: Size): Promise<Locator> {
  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible();
  await expect
    .poll(async () => {
      const box = await dialog.boundingBox();
      return box === null
        ? null
        : { width: Math.round(box.width), height: Math.round(box.height), x: Math.round(box.x) };
    })
    .toEqual({ width: size.width, height: size.height, x: 0 });
  // The desktop pane is not merely hidden: it is not mounted at this width.
  await expect(page.locator(`aside[aria-label="${title}"]`)).toHaveCount(0);
  return dialog;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

const PHONE: Size = { width: 375, height: 800 };
const BOUNDARY_MOBILE: Size = { width: 767, height: 800 };
const BOUNDARY_DESKTOP: Size = { width: 768, height: 800 };

/**
 * Where this spec's own screenshots are written.
 *
 * **Not** `docs/evidence/phase-4/` any more (story p5-08 fixed this). The screenshots above are
 * regenerated on every run, so writing them over the committed phase-4 PNGs meant one full
 * `npm run test:ui` dirtied 15–22 of another phase's committed binaries and every story had to
 * restore them by hand (measured repeatedly, and recorded as D83(d)). Phase evidence is
 * committed **once, by the story that produced it**; a suite re-run must not rewrite it.
 * `test-results/` is gitignored (`playwright.config.ts` already points Playwright's own
 * artifacts there), so a run's screenshots are inspectable and cannot reach a commit.
 */
const screenshotPath = (name: string): string => `test-results/object-mobile/${name}`;

/* --------------------------------------------------------------- AC#13: the list */

test.describe('AC#13: every keyed family’s list page is a card list at 375 and 767, a table at 768', () => {
  for (const family of KEYED) {
    test(`${family.label} (${family.listPath})`, async ({ page }) => {
      await mockApi(page);
      await page.setViewportSize(PHONE);
      await page.goto(family.listPath);

      // 375px — the card list, and the table is **absent** (not hidden).
      //
      // Order matters: the card count **retries** until the mocked list has rendered, so the
      // table's absence is asserted against a loaded page rather than against "nothing yet"
      // (`toHaveCount(0)` is satisfied while the page still shows its skeleton). Story p4-10's
      // falsification pass found that: with the table line first, forcing the table at 375px was
      // caught only by the card line. The pass therefore also runs the converse break — mounting
      // **both** surfaces at this width — which only this line catches.
      await expect(cards(page, family).getByRole('listitem')).toHaveCount(3);
      await expect(page.getByRole('table')).toHaveCount(0);
      const first = cards(page, family).getByRole('listitem').first();
      await expect(first).toContainText(family.key);
      await expect(
        first.getByLabel(`Status: ${ENTRY_STATUS === 'reviewed' ? 'Reviewed' : 'Extracted'}`),
      ).toBeVisible();
      await expect(main(page).getByText('Showing 1-3 of 3')).toBeVisible();
      await expectNoHorizontalOverflow(page, PHONE.width);

      // The card list is the live list: the client-side search narrows it to the one row typed.
      await main(page)
        .getByLabel(`Search ${family.nounPlural}`)
        .fill(family.rows[0] as string);
      await expect(cards(page, family).getByRole('listitem')).toHaveCount(1);

      await page.screenshot({ path: screenshotPath(`p4-10-${family.fileType}-list-375.png`) });

      // 767px — the widest viewport the app calls mobile, hence the strongest form of "≤768".
      await page.setViewportSize(BOUNDARY_MOBILE);
      await main(page).getByLabel(`Search ${family.nounPlural}`).fill('');
      await expect(cards(page, family).getByRole('listitem')).toHaveCount(3);
      await expect(page.getByRole('table')).toHaveCount(0);

      // A card is not merely visible — tapping it opens the entry.
      const href = await cards(page, family)
        .getByRole('listitem')
        .first()
        .getByRole('link')
        .getAttribute('href');
      expect(href).toBe(family.detailPath);
      await cards(page, family).getByRole('listitem').first().click();
      await expect(page).toHaveURL(new RegExp(`${family.listPath}/`));

      // 768px — the converse: Tailwind's `md` mounts the table and unmounts the cards. The
      // retrying assertion comes first, so "the cards are gone" is read after the page loaded.
      await page.setViewportSize(BOUNDARY_DESKTOP);
      await page.goto(family.listPath);
      await expect(page.getByRole('table')).toBeVisible();
      await expect(cards(page, family)).toHaveCount(0);
    });
  }
});

/* ------------------------------------------------------------- AC#13: the detail */

test.describe('AC#13: every keyed family’s detail form is usable and its JSON panel is a full overlay at 375', () => {
  for (const family of KEYED) {
    test(`${family.label} (${family.detailPath})`, async ({ page }) => {
      await mockApi(page);
      await page.setViewportSize(PHONE);
      await page.goto(family.detailPath);

      // The header the criterion's "usable" starts from, and the joined lifecycle badge.
      await expect(main(page).getByRole('link', { name: family.backLabel })).toBeVisible();
      await expect(main(page).getByLabel('Status: Reviewed')).toBeVisible();

      // Edit really swaps the read-only fields for controls, and one of them is driven.
      await page.getByRole('button', { name: 'Edit' }).click();
      const control = await drive(page, family.drive);
      await expectUnclipped(control, PHONE.width);
      await expectNoHorizontalOverflow(page, PHONE.width);

      // The drive reached the document model: the document is dirty, so Save is enabled.
      await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
      await page.screenshot({ path: screenshotPath(`p4-10-${family.fileType}-detail-375.png`) });

      // The JSON panel is a full-viewport overlay, and the desktop pane is not mounted.
      await jsonToggle(page).click();
      const dialog = await expectFullViewportOverlay(page, `${family.label} JSON`, PHONE);
      await expect(dialog.getByRole('tree')).toContainText(family.key);
      await page.screenshot({
        path: screenshotPath(`p4-10-${family.fileType}-json-overlay-375.png`),
      });
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    });
  }

  test('at 768 the panel is the spec’s 300px tablet side pane, not an overlay (the boundary, pinned)', async ({
    page,
  }) => {
    const family = KEYED[1] as FamilyFixture; // NpcInventory
    await mockApi(page);
    await page.setViewportSize(BOUNDARY_DESKTOP);
    await page.goto(family.detailPath);

    await jsonToggle(page).click();
    const aside = page.locator(`aside[aria-label="${family.label} JSON"]`);
    await expect(aside).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The spec's **tablet** 300px pane (`docs/spec-ui-design.md` L518), polled for the slide-in.
    // Story p5-06 corrected this arm: it previously pinned **400** here, which was the
    // implementation's single desktop number at every width above `md` — a tier-1 spec pinning a
    // defect as expected (D40). The desktop 400px pane is asserted at ≥1280px in
    // `tests/ui/responsive.spec.ts`, which owns the three-tier rule.
    await expect.poll(async () => Math.round((await aside.boundingBox())?.width ?? 0)).toBe(300);
  });
});

/* ------------------------------------------------- AC#13: the eighth, editor-only family */

test.describe('AC#13: GlobalRegistry — no list page (D75a), its editor is usable and its panel an overlay', () => {
  test('the merged dictionary editor at 375: unclipped controls, a real drive, a full overlay', async ({
    page,
  }) => {
    await mockApi(page);
    await page.setViewportSize(PHONE);
    await page.goto(REGISTRY.listPath);

    // There is no list page for this family — its one route is the editor (docs/spec-api.md
    // L474), so the card-list clause has no referent here and this arm says that by asserting
    // exactly what the route does render: the editor's chrome.
    await expect(main(page).getByRole('link', { name: REGISTRY.backLabel })).toBeVisible();
    await expect(main(page).getByRole('list', { name: 'Registry values' })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);

    await page.getByRole('button', { name: 'Edit' }).click();
    const control = await drive(page, REGISTRY.drive);
    await expectUnclipped(control, PHONE.width);
    await expectNoHorizontalOverflow(page, PHONE.width);
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
    await page.screenshot({ path: screenshotPath('p4-10-globalregistry-editor-375.png') });

    await jsonToggle(page).click();
    const dialog = await expectFullViewportOverlay(page, `${REGISTRY.label} JSON`, PHONE);
    await expect(dialog.getByRole('tree')).toContainText('GlobalRegistryValues');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
});
