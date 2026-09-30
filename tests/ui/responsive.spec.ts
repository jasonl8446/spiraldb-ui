import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

import { MOCK_COVERAGE } from './quests-mocks';

/**
 * Story p5-06's tier-1 responsive spec (plan task 5.6, **Phase-5 AC#12**; decisions D23 tier 1,
 * D40/D44, D67(d), D78(d), D81).
 *
 * The acceptance criterion, quoted (the Phase 5 plan, §"Acceptance Criteria"):
 *
 * > Responsive checklist complete at 375/768/1440px for all routes: sidebar hamburger +
 * > swipe-close at 375px; tables→cards; JSON panel→overlay; tablet sidebar 200px.
 *
 * checked against the breakpoint table in `docs/spec-ui-design.md` L516-522 (mobile <768:
 * hamburger overlay + swipe-to-close, tables→card lists, JSON panel→full overlay, stats cards
 * stack · tablet 768–1279: sidebar **200px**, tables scroll horizontally, JSON panel **300px** ·
 * desktop ≥1280: sidebar **260px**, JSON panel **400px**) and L97's "Swipe-to-close gesture".
 *
 * | the criterion's words | the arm that carries it | where the numbers came from |
 * |---|---|---|
 * | "responsive checklist complete … for **all routes**" | every one of the 21 `APP_ROUTES` at **8 widths**: the document must not scroll sideways and no element's right edge may pass the viewport | §1; the audit's 20×10 sweep (`docs/evidence/phase-5/p5-06-d1-checklist.md`) |
 * | "sidebar hamburger at 375px" | rail **not mounted**, `aria-label="Open navigation"` visible, and opening it mounts `role=dialog` named `Navigation` whose settled box is **260×viewport at x=0** | §2 |
 * | "**swipe-close** at 375px" | a real `touchstart`→`touchend` sequence (200,300 → 20,320) dispatched at that dialog closes it | §2 |
 * | "tablet sidebar **200px**" | the rail's measured `boundingBox().width` is exactly **200** at 768/1024/1279 and exactly **260** at 1280/1440 | §2 |
 * | "tables→cards" | the 9 list routes: `role=table` count **0** and the named card list present at mobile; `table` visible and the card list **absent** at 768 | §4 |
 * | "tables scroll horizontally" (tablet) | the table's own wrapper is the scroll container (`overflow-x: auto`) — the spec's remedy for a wide table, asserted structurally at 768/1279 | §5 |
 * | "JSON panel→overlay" | at 375/767 the panel is a `role=dialog` **covering the viewport at x=0** and the desktop `<aside>` is not mounted | §3 |
 * | "JSON panel 300px" (tablet) / 400px (desktop) | the `<aside>` measures exactly **300** at 768/1024/1279 and exactly **400** at 1280/1440 — asserted against `JSON_PANEL_TABLET_WIDTH_PX` / `JSON_PANEL_WIDTH_PX`, so the class and its constant cannot drift apart | §3 |
 * | "stats cards stack" (mobile) | the 4 `[data-stat]` cards share **1** distinct x at ≤767, **2** at 768–1279, **4** from 1280 | §6 |
 *
 * ## Every claim is a DOM/geometry assertion — no screenshot is evidence here
 *
 * Each row above is `scrollWidth`/`clientWidth`, a `boundingBox()`, or a role count, read from a
 * live headless Chromium. There are no screenshots in this file on purpose: the criterion is
 * stated in numbers (200/300/400, "covers the viewport", "no overflow"), so the assertions are
 * stated in the same numbers (D23's "no 'looks right'").
 *
 * ## The widths: the three the criterion names, plus every boundary the app flips at
 *
 * The criterion names 375/768/1440. A breakpoint rule **fails at its boundary**, not at its
 * middle, so this spec adds every flip the app's own rules use — `sm` 640, `md` 768, `lg` 1024,
 * `xl` 1280 — with the one-below width for the two the criterion's layout rules actually turn on:
 * **767** (widest mobile, where the rail must still be a hamburger) and **1279** (widest tablet,
 * where the sidebar must still be 200px). Sampling only the named three is exactly the mistake
 * that would have missed the defect this story fixed at 768 (D78(d)).
 *
 * ## Hermetic (D81/D40)
 *
 * One dispatcher answers every `/api/**` request from the fixtures below, so the run reaches
 * neither the dev stack's SQLite file nor the D17 clone — and an assertion about a layout must
 * not depend on the developer's corpus. The wire contracts are copied literally, as in
 * `object-mobile.spec.ts`, `dashboard.spec.ts` and `shell.spec.ts`; a fixture that imported
 * `client/src/lib/objects.ts` could only prove the client agrees with itself.
 */

/* ------------------------------------------------------------------- fixtures */

type Status = 'extracted' | 'reviewed' | 'verified';

/** One list-bearing family: its route, its API mount, and the noun its card list is named by. */
interface Family {
  readonly fileType: string;
  /** D4 singular status route, or `null` for the editor-only family (Q1). */
  readonly routeType: string | null;
  readonly urlPath: string;
  readonly listPath: string;
  readonly detailPath: string;
  /** `ObjectCardList`'s / `QuestCardList`'s `aria-label` — the plural noun. */
  readonly cardListName: string;
  readonly keys: readonly string[];
}

const QUEST_KEYS = ['DS-ACAD-C01-001', 'DS-ACAD-C01-002', 'DS-ACAD-C01-003'] as const;

/**
 * **The corpus's longest `ZoneName`, on the long-KEY axis** (architect-verification DR-09).
 *
 * 93 characters, re-measured directly against the owner's fork
 * (`grep -h -o '"ZoneName": *"[^"]*"' *.json | awk '{print length($0)}'` over `ZoneTransfer/` —
 * `DragonSpire/DS_A1_Knowledge/Interiors/DS_Chasm_Gauntlet_4Room2_Sub/DS_Chasm_Gauntlet_4Room2_{2,3,4}`
 * are three keys tied at 93). §1 below asserts "no horizontal overflow" on every route × width, but
 * until this constant existed the zone detail route was reached through an **18-character** key
 * (`WizardCity/WC_Hub`), so the view-mode header span — the element the live 397-vs-360 measurement
 * in `final-verify-gate3` caught — was never exercised anywhere near the width real data reaches.
 * The mock is only as demanding as its fixture (D90(a)); this fixture is now the corpus's worst case.
 */
const ZONE_LONG_KEY =
  'DragonSpire/DS_A1_Knowledge/Interiors/DS_Chasm_Gauntlet_4Room2_Sub/DS_Chasm_Gauntlet_4Room2_4';

const FAMILIES: readonly Family[] = [
  {
    fileType: 'quest',
    routeType: 'quests',
    urlPath: '/api/quests',
    listPath: '/quests',
    detailPath: '/quests/DS-ACAD-C01-001',
    cardListName: 'Quests',
    keys: QUEST_KEYS,
  },
  {
    fileType: 'drop_table',
    routeType: 'drop_tables',
    urlPath: '/api/drop-tables',
    listPath: '/drop-tables',
    detailPath: '/drop-tables/DROP-A',
    cardListName: 'drop tables',
    keys: ['DROP-A', 'DROP-B', 'DROP-C'],
  },
  {
    fileType: 'npc_inventory',
    routeType: 'npc_inventories',
    urlPath: '/api/npc-inventories',
    listPath: '/npc-inventories',
    detailPath: '/npc-inventories/1025',
    cardListName: 'NPC inventories',
    keys: ['1025', '1026', '1027'],
  },
  {
    fileType: 'npc_spell_inventory',
    routeType: 'npc_spell_inventories',
    urlPath: '/api/npc-spell-inventories',
    listPath: '/npc-spell-inventories',
    detailPath: '/npc-spell-inventories/1057',
    cardListName: 'NPC spell inventories',
    keys: ['1057', '1058', '1059'],
  },
  {
    fileType: 'creature_spellbook',
    routeType: 'creature_spellbooks',
    urlPath: '/api/creature-spellbooks',
    listPath: '/creature-spellbooks',
    detailPath: '/creature-spellbooks/deck-a',
    cardListName: 'creature spellbooks',
    keys: ['deck-a', 'deck-b', 'deck-c'],
  },
  {
    fileType: 'npc_drop_table',
    routeType: 'npc_drop_tables',
    urlPath: '/api/npc-drop-tables',
    listPath: '/npc-drop-tables',
    detailPath: '/npc-drop-tables/12345',
    cardListName: 'NPC drop tables',
    keys: ['12345', '12346', '12347'],
  },
  {
    fileType: 'treasure_card_inventory',
    routeType: 'treasure_card_inventories',
    urlPath: '/api/treasure-card-inventories',
    listPath: '/treasure-card-inventories',
    detailPath: '/treasure-card-inventories/2019',
    cardListName: 'treasure card inventories',
    keys: ['2019', '2020', '2021'],
  },
  {
    fileType: 'zone_transfer',
    routeType: 'zone_transfers',
    urlPath: '/api/zone-transfers',
    listPath: '/zone-transfers',
    detailPath: `/zone-transfers/${encodeURIComponent(ZONE_LONG_KEY)}`,
    cardListName: 'zone transfers',
    keys: [ZONE_LONG_KEY, 'WizardCity/WC_Plaza', 'WizardCity/WC_Port'],
  },
];

/**
 * Every route in `client/src/lib/routes.ts` `APP_ROUTES` — the 21 the shell spec pins "and
 * nothing else" — each with a concrete value for its dynamic segment and the element that proves
 * the page finished loading (a route-specific wait, never a bare timeout).
 */
interface RouteCase {
  readonly path: string;
  readonly ready: (page: Page) => Locator;
}

const ROUTES: readonly RouteCase[] = [
  { path: '/', ready: (p) => p.locator('[data-stat="total"]') },
  { path: '/quests/extract', ready: (p) => p.getByRole('main') },
  { path: '/quests', ready: (p) => p.getByText(/^Showing /) },
  // Story p6-11's view, added to the overflow sweep because it is the page whose header carries
  // the corpus's absolute path (the mock above uses the real, long one).
  { path: '/quests/catalog', ready: (p) => p.getByTestId('coverage-headline') },
  {
    path: '/quests/DS-ACAD-C01-001',
    ready: (p) => p.getByRole('main').getByText('DS-ACAD-C01-001').first(),
  },
  ...FAMILIES.filter((family) => family.fileType !== 'quest').flatMap((family): RouteCase[] => [
    { path: family.listPath, ready: (p) => p.getByText(/^Showing /) },
    { path: family.detailPath, ready: (p) => p.getByRole('link', { name: /^Back to / }) },
  ]),
  { path: '/global-registry', ready: (p) => p.getByRole('list', { name: 'Registry values' }) },
  { path: '/settings', ready: (p) => p.getByRole('main').getByText(/Sync/i).first() },
];

/** The 9 list routes: the 8 families (the quests browse page is `FAMILIES[0]`). */

/**
 * The widths whose **layout rules** are asserted: the three the criterion names, plus 767/1279
 * (one below the two boundaries the criterion's own clauses turn on) and 640/1024 (the app's
 * other two Tailwind flips, `sm` and `lg`, so a rule that drifted to the wrong variant fails
 * here rather than in production).
 */
const ALL_WIDTHS = [375, 640, 767, 768, 1024, 1279, 1280, 1440] as const;
const MOBILE_WIDTHS = [375, 640, 767] as const;
const TABLET_WIDTHS = [768, 1024, 1279] as const;
const DESKTOP_WIDTHS = [1280, 1440] as const;

/** The spec's own numbers, one home each (`docs/spec-ui-design.md` L516-522). */
const MOBILE_BREAKPOINT = 768;
const TABLET_END = 1280;
const SIDEBAR_TABLET_PX = 200;
const SIDEBAR_DESKTOP_PX = 260;
const JSON_PANEL_TABLET_PX = 300;
const JSON_PANEL_DESKTOP_PX = 400;
const NAV_OVERLAY_WIDTH_PX = 260;

const VIEWPORT_HEIGHT = 900;

/** The one dispatcher (D81). Returns the list of paths it did **not** know, for the guard arm. */
async function mockResponsiveApi(page: Page): Promise<string[]> {
  const unmocked: string[] = [];
  const bucket = (total: number, extracted: number, reviewed: number, verified: number) => ({
    total,
    extracted,
    reviewed,
    verified,
  });

  await page.route(/\/api\//, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (payload: unknown): Promise<void> => route.fulfill({ json: payload });

    // The shell's own boot reads (Header, the identity gate, the import toast, the health probe).
    if (path === '/api/settings') {
      return json({
        aurorium_path: '/mock/aurorium',
        imcodec_path: '/mock/imcodec',
        spiraldb_path: '/mock/spiraldb',
        user_name: 'Responsive Tester',
        git_branch: 'content/2026-09-27',
      });
    }
    if (path === '/api/health') return json({ status: 'ok' });
    if (path === '/api/status/_import') return json({ ran: false, imported: 0, imported_at: null });
    if (path === '/api/sync/status') {
      return json({ last_sync: null, revision: null, status: 'never' });
    }
    if (path === '/api/sync/history') return json({ history: [] });

    // The dashboard (story p5-01) and the ⌘K palette's endpoint (p5-02).
    if (path === '/api/dashboard') {
      return json({
        types: {
          quest: bucket(3, 0, 1, 2),
          drop_table: bucket(3, 1, 0, 2),
          npc_inventory: bucket(3, 2, 1, 0),
          npc_spell_inventory: bucket(3, 3, 0, 0),
          creature_spellbook: bucket(3, 0, 3, 0),
          npc_drop_table: bucket(0, 0, 0, 0),
          treasure_card_inventory: bucket(3, 0, 0, 3),
          zone_transfer: bucket(3, 1, 1, 1),
        },
        overall: { total: 21, extracted: 7, reviewed: 6, verified: 8, percent_verified: 38.1 },
      });
    }
    if (path === '/api/activity') return json({ activity: [], unresolved: 0 });
    if (path === '/api/search') {
      return json({ query: url.searchParams.get('q') ?? '', results: [], truncated: false });
    }

    // The single lookup (`GET /api/names/:type/:id`) answers **the bare row or 404** —
    // never the list envelope (spec-api §"GET /api/names/:type/:id"). Story p6-06's detail headers read it for
    // the pair, so this fixture is load-bearing: an envelope here is not a row, and a
    // mock that cannot tell the two apart is exactly what D90(a) forbids. The zone key
    // carries slashes, which is why the id is read from the *decoded* tail of the path.
    if (path.startsWith('/api/names/') && path.split('/').length > 4) {
      const [, , type, ...rest] = path.split('/');
      const id = decodeURIComponent(rest.join('/'));
      const rows: Record<string, Record<string, unknown>> = {
        items: { gid: 160936, name: 'Black Mantle' },
        spells: { template_id: 84361, name: 'Firecat' },
        npcs: { template_id: 1025, name: 'Lucky the Merchant' },
        zones: { zone_path: id, display_name: null, world: null },
        drop_tables: { name: id, description: null },
        quests: { quest_name: id, title: 'Wizard Tours', level: 1, is_mainline: 1 },
        strings: { key: id, value: 'Format X', category: 'Format' },
      };
      const row = rows[type as string];
      return row === undefined
        ? route.fulfill({ status: 404, json: { error: `Unknown ${String(type)} id "${id}"` } })
        : json(row);
    }

    // Every friendly-name table the editors bulk-read, in one answer.
    if (path.startsWith('/api/names/')) {
      return json({
        items: [
          { gid: 160936, name: 'Black Mantle' },
          { gid: 160943, name: 'Spiral Wand' },
        ],
        spells: [{ template_id: 84361, name: 'Firecat' }],
        npcs: [{ template_id: 1025, name: 'Lucky the Merchant' }],
        zones: [{ zone_path: 'WizardCity/WC_Hub', display_name: null, world: null }],
        drop_tables: [{ name: 'WC-UNICORN-BONUS-001', description: null }],
        quests: [
          { quest_name: 'DS-ACAD-C01-001', title: 'Wizard Tours', level: 1, is_mainline: 1 },
        ],
      });
    }

    // The editor-only family: one list envelope and one bare document (Q1 / D75(a)).
    if (path === '/api/global-registry') {
      return json({
        objects: [
          {
            key: 'globalregistry.json',
            title: 'globalregistry.json',
            modified_at: '2026-06-01T00:00:00.000Z',
            status: null,
          },
        ],
        summary: null,
        skipped: [],
        missing_directory: false,
        duplicate_keys: [],
      });
    }
    if (path.startsWith('/api/global-registry/')) {
      return json({ GlobalRegistryValues: { Christmas: 0, Halloween: 0 } });
    }

    // The status API (D4 singular type in the path), one shape for every tracked family.
    if (path.startsWith('/api/status/')) {
      const segments = path.slice('/api/status/'.length).split('/');
      const family = FAMILIES.find((row) => row.routeType === segments[0]);
      if (family === undefined) {
        return route.fulfill({ status: 404, json: { error: 'unknown status type' } });
      }
      if (segments.length === 1) {
        const entries = family.keys.map((key, index) => ({
          object_type: family.fileType,
          object_key: key,
          status: (index === 0 ? 'reviewed' : 'extracted') as Status,
          extracted_at: '2026-06-01T00:00:00.000Z',
          reviewed_at: null,
          verified_at: null,
          latest_notes: null,
        }));
        return json({
          entries,
          summary: {
            total: entries.length,
            extracted: entries.filter((row) => row.status === 'extracted').length,
            reviewed: entries.filter((row) => row.status === 'reviewed').length,
            verified: 0,
          },
        });
      }
      if (segments[2] === 'history') return json({ history: [] });
      return route.fulfill({ status: 404, json: { error: `unmocked status ${path}` } });
    }

    // The quests list + one bare quest document (docs/spec-api.md §"Quests").
    //
    // Story p6-11's two static reads are matched **before** the `/:key` prefix below: the browse
    // page and the new Catalog route now mount a coverage header, and the prefix branch would
    // answer `/api/quests/coverage` with a bare quest document (D81).
    //
    // The corpus path in the fixture is deliberately the **longest** one this repo can produce
    // (`…/spiraldb-ui/data/test-spiraldb`) rather than a short stub: §1's "no horizontal
    // overflow" arm is the only instrument that watches the header's unbreakable string, and a
    // mock that is not as demanding as reality proves nothing about it (D90(a)).
    if (path === '/api/quests/coverage') {
      return json({
        ...MOCK_COVERAGE,
        // …with the one deliberate override: this spec is the only instrument that watches the
        // header's unbreakable corpus path, so it must be the longest one the repo can produce.
        corpus: {
          ...MOCK_COVERAGE.corpus,
          spiraldb_path: '/home/jason/Documents/git-projects/spiraldb-ui/data/test-spiraldb',
        },
      });
    }
    if (path === '/api/quests/catalog') {
      const missingOnly = url.searchParams.get('missing_only') === '1';
      const catalogRows = [
        {
          quest_name: 'DS-ACAD-C01-001',
          title: 'Wizard Tours',
          title_source: 'inferred',
          has_definition: 1,
          reference_count: 6,
        },
        {
          quest_name: 'DM-GRAVE-MAIN-008',
          title: 'Stakes and Stones',
          title_source: 'direct',
          has_definition: 0,
          reference_count: 19,
        },
      ];
      const quests = missingOnly
        ? catalogRows.filter((row) => row.has_definition === 0)
        : catalogRows;
      return json({
        quests,
        total: quests.length,
        missing_only: missingOnly,
        corpus: {
          spiraldb_path: '/home/jason/Documents/git-projects/spiraldb-ui/data/test-spiraldb',
          quest_files: 322,
        },
      });
    }
    if (path === '/api/quests') {
      return json({
        quests: QUEST_KEYS.map((key, index) => ({
          quest_name: key,
          title: `Quest ${String(index + 1)}`,
          level: index + 1,
          is_mainline: index === 0,
          goal_count: 0,
          status: index === 0 ? 'reviewed' : 'extracted',
        })),
        summary: { total: 3, extracted: 2, reviewed: 1, verified: 0 },
        skipped: [],
      });
    }
    if (path.startsWith('/api/quests/')) {
      const name = decodeURIComponent(path.slice('/api/quests/'.length));
      return json({
        m_questName: name,
        m_questLevel: 1,
        m_mainline: true,
        m_goals: [],
        m_goalLogic: [],
      });
    }

    // The 8 Phase-4 families: the list envelope and the bare document.
    const family = FAMILIES.find(
      (row) =>
        row.fileType !== 'quest' && (path === row.urlPath || path.startsWith(`${row.urlPath}/`)),
    );
    if (family !== undefined) {
      if (path === family.urlPath) {
        return json({
          objects: family.keys.map((key, index) => ({
            key,
            title: key,
            modified_at: '2026-06-01T00:00:00.000Z',
            status: index === 0 ? 'reviewed' : 'extracted',
          })),
          summary: { total: 3, extracted: 2, reviewed: 1, verified: 0 },
          skipped: [],
          missing_directory: false,
          duplicate_keys: [],
        });
      }
      const key = decodeURIComponent(path.slice(`${family.urlPath}/`.length));
      return json(documentFor(family.fileType, key));
    }

    unmocked.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 404, json: { error: `unmocked ${path}` } });
  });

  return unmocked;
}

/** One bare document per family — exactly the shape that family's editor reads. */
function documentFor(fileType: string, key: string): Record<string, unknown> {
  switch (fileType) {
    case 'drop_table':
      return {
        Name: key,
        Description: 'responsive fixture',
        RollChance: 1,
        Weight: 100,
        Items: [],
      };
    case 'npc_inventory':
      return { TemplateID: Number(key), Inventory: [] };
    case 'npc_spell_inventory':
      return { TemplateID: Number(key), Spells: [] };
    case 'creature_spellbook':
      return { DeckName: key, SpellTemplateIds: [] };
    case 'npc_drop_table':
      return { TemplateID: Number(key), DropTableNames: [] };
    case 'treasure_card_inventory':
      return { TemplateID: Number(key), TreasureCards: [] };
    case 'zone_transfer':
      // **A real-shaped teleport, carrying the corpus's longest `m_destinationZone`** (93
      // characters: `DragonSpire/…_4Room2_Sub/DS_Chasm_Gauntlet_4Room2_2`). §1 below used to
      // assert "no horizontal overflow" against `{ ZoneName: key, Teleports: [] }` with an
      // 18-character key, so the arm passed while the live page scrolled sideways at 375px:
      // the zone-path spans render an unbreakable `font-mono` string (final-verify gate 3
      // measured `documentElement.scrollWidth` 469 vs 360 on `/zone-transfers/WizardCity%2FWC_Hub`,
      // and 838 vs 360 on the 93-character path). A mock narrower than reality is a **false
      // pass** — the D78(d) class — so the mock now carries the shape that makes §1 bite.
      //
      // **The key is now the corpus's longest too** (`ZONE_LONG_KEY`, 93 characters — DR-09), so the
      // route's `ZoneName: key` below is a 93-character unbreakable span as well: this one route
      // carries BOTH the long header (the element the 397-vs-360 measurement caught) and the long
      // destination, which is strictly more demanding than the zero-teleport real case it replaces.
      // A teleport is still present so the destination axis keeps its assertion on the same route.
      return {
        ZoneName: key,
        Teleports: [
          {
            TriggerName: 'Teleport location (the zone-path-width probe)',
            Teleport: {
              m_destinationLoc: '-2.263153,-464.7307,0.0002441406,-3.125134',
              m_destinationZone:
                'DragonSpire/DS_A1_Knowledge/Interiors/DS_Chasm_Gauntlet_4Room2_Sub/DS_Chasm_Gauntlet_4Room2_2',
              m_exitTeleporter: 0,
              m_teleporterTag: 0,
              m_teleportType: 'TELEPORT_STATIC',
              m_transitionID: 0,
            },
          },
        ],
      };
    default:
      return { key };
  }
}

/* ------------------------------------------------------------------- helpers */

const main = (page: Page): Locator => page.getByRole('main');

/**
 * The sidebar rail. It is **mounted at every width** (`hidden md:flex`) — below `md` it is
 * `display: none`, not absent — so the mobile arms assert `toBeHidden()`, never `toHaveCount(0)`.
 * (The measurement that caught this: `document.querySelector('aside[aria-label="Sidebar"]')`
 * resolves at 375px with `width: 0`, and a `toHaveCount(0)` arm failed here on the first run.)
 */
const rail = (page: Page): Locator => page.locator('aside[aria-label="Sidebar"]');
const hamburger = (page: Page): Locator => page.getByRole('button', { name: 'Open navigation' });

/**
 * A dialog's **settled** box. The vendored `DialogContent` animates in (`zoom-in-95`,
 * `duration-200`), so a single sample measures the scaled rect rather than the layout one — the
 * p5-06 audit measured the ⌘K palette at `x=697 w=642` on a 1440px viewport during the animation
 * and `x=384 w=672` once settled. Poll until two consecutive reads agree.
 */
async function stableBox(locator: Locator): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  let previous = '';
  let settled: { x: number; y: number; width: number; height: number } | null = null;
  await expect
    .poll(
      async () => {
        const box = await locator.boundingBox();
        const current =
          box === null
            ? null
            : {
                x: Math.round(box.x),
                y: Math.round(box.y),
                width: Math.round(box.width),
                height: Math.round(box.height),
              };
        const key = JSON.stringify(current);
        const isSettled = key === previous && current !== null;
        previous = key;
        settled = current;
        return isSettled;
      },
      { timeout: 10_000, intervals: [120, 120, 120, 120, 120] },
    )
    .toBe(true);
  if (settled === null) throw new Error('the dialog never settled');
  return settled;
}

/** The measured width of a visible element. */
async function widthOf(locator: Locator): Promise<number> {
  return (await stableBox(locator)).width;
}

/**
 * Nothing is wider than the viewport: the document must not scroll sideways and no element's
 * right edge may pass the viewport. The assertion names the offending elements, so a regression
 * says *which* control overflowed rather than only that the document did (the technique p4-10
 * used to find three real 375px overflows, D78(d)).
 */
async function expectNoHorizontalOverflow(page: Page, width: number): Promise<void> {
  const measured = await page.evaluate((viewport) => {
    const offenders: string[] = [];
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && Math.round(rect.right) > viewport) {
        offenders.push(
          `<${element.tagName.toLowerCase()}> right=${String(Math.round(rect.right))} ` +
            `w=${String(Math.round(rect.width))} class="${element.className.toString().slice(0, 70)}"`,
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

/**
 * A leftward swipe, as real DOM touch events on the nav dialog: `touchstart` then `touchend`.
 *
 * The threshold rule is unit-tested (`tests/unit/ui-shell.test.ts`, `lib/swipe.ts`); what cannot
 * be unit-tested is the **wiring** — `Sidebar`'s `onTouchStart`/`onTouchEnd` handlers calling it —
 * which this drives end to end through React's synthetic event system.
 */
async function swipeLeftOn(page: Page, selector: string): Promise<void> {
  await page.evaluate((target) => {
    const element = document.querySelector(target);
    if (element === null) throw new Error(`no element for ${target}`);
    const fire = (type: string, x: number, y: number): void => {
      const touch = new Touch({ identifier: 1, target: element, clientX: x, clientY: y });
      element.dispatchEvent(
        new TouchEvent(type, {
          touches: type === 'touchend' ? [] : [touch],
          changedTouches: [touch],
          bubbles: true,
          cancelable: true,
        }),
      );
    };
    fire('touchstart', 200, 300);
    fire('touchend', 20, 320);
  }, selector);
}

/* --------------------------------------------------------------- §1 all routes */

test.describe('§1 AC#12: every route at every breakpoint has no horizontal overflow', () => {
  test('21 routes × 8 widths (375/640/767/768/1024/1279/1280/1440)', async ({ page }) => {
    // 160 page loads against a mocked API; the per-test budget is the 60 s default otherwise.
    test.setTimeout(600_000);
    const unmocked = await mockResponsiveApi(page);

    for (const width of ALL_WIDTHS) {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
      for (const route of ROUTES) {
        await page.goto(route.path);
        // The failing route is named: a bare wait leaves "which of the 160 loads" to the
        // reader, which is the expensive half of a red §1 run.
        try {
          await route.ready(page).first().waitFor({ state: 'visible', timeout: 20_000 });
        } catch (error) {
          throw new Error(
            `route ${route.path} at ${width}px did not become ready: ${String(error)}`,
          );
        }
        await expectNoHorizontalOverflow(page, width);
      }
    }

    // The guard: a route whose read this spec does not know about would have rendered an error
    // state, and every assertion above would have passed against the wrong page (D81).
    expect(unmocked).toEqual([]);
  });
});

/* ------------------------------------------------------- §2 the shell, per tier */

test.describe('§2 AC#12: the shell rules, stated in numbers', () => {
  for (const width of MOBILE_WIDTHS) {
    test(`mobile ${String(width)}: rail hidden, hamburger visible, overlay covers the height, swipe closes it`, async ({
      page,
    }) => {
      await mockResponsiveApi(page);
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
      await page.goto('/');
      await page.locator('[data-stat="total"]').first().waitFor({ state: 'visible' });

      // The rail is mounted but `display: none` below `md` (`hidden md:flex`) — hidden, not
      // absent. The drawer beside it is a Radix dialog, so there is no desktop rail to trap focus.
      await expect(rail(page)).toBeHidden();
      await expect(hamburger(page)).toBeVisible();
      await expectNoHorizontalOverflow(page, width);

      await hamburger(page).click();
      const dialog = page.getByRole('dialog', { name: 'Navigation' });
      await expect(dialog).toBeVisible();
      // The drawer's own box: left-anchored at x=0 and full viewport height.
      expect(await stableBox(dialog)).toEqual({
        x: 0,
        y: 0,
        width: NAV_OVERLAY_WIDTH_PX,
        height: VIEWPORT_HEIGHT,
      });

      await swipeLeftOn(page, '[role="dialog"]');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
  }

  for (const width of TABLET_WIDTHS) {
    test(`tablet ${String(width)}: the rail is visible and exactly 200px, and there is no hamburger`, async ({
      page,
    }) => {
      await mockResponsiveApi(page);
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
      await page.goto('/');
      await page.locator('[data-stat="total"]').first().waitFor({ state: 'visible' });

      await expect(rail(page)).toBeVisible();
      // The spec's number, measured on the element itself (docs/spec-ui-design.md §"Responsive Breakpoints").
      expect(await widthOf(rail(page))).toBe(SIDEBAR_TABLET_PX);
      await expect(hamburger(page)).toBeHidden();
      await expectNoHorizontalOverflow(page, width);
    });
  }

  for (const width of DESKTOP_WIDTHS) {
    test(`desktop ${String(width)}: the rail is visible and exactly 260px, and there is no hamburger`, async ({
      page,
    }) => {
      await mockResponsiveApi(page);
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
      await page.goto('/');
      await page.locator('[data-stat="total"]').first().waitFor({ state: 'visible' });

      await expect(rail(page)).toBeVisible();
      expect(await widthOf(rail(page))).toBe(SIDEBAR_DESKTOP_PX);
      await expect(hamburger(page)).toBeHidden();
      await expectNoHorizontalOverflow(page, width);
    });
  }

  test('the 767/768 boundary: the rail mounts at exactly 768, not at 767', async ({ page }) => {
    await mockResponsiveApi(page);
    await page.setViewportSize({ width: MOBILE_BREAKPOINT - 1, height: VIEWPORT_HEIGHT });
    await page.goto('/');
    await page.locator('[data-stat="total"]').first().waitFor({ state: 'visible' });
    await expect(rail(page)).toBeHidden();
    await expect(hamburger(page)).toBeVisible();

    await page.setViewportSize({ width: MOBILE_BREAKPOINT, height: VIEWPORT_HEIGHT });
    await expect(rail(page)).toBeVisible();
    await expect(hamburger(page)).toBeHidden();
  });

  test('the 1279/1280 boundary: the rail widens to 260px at exactly 1280, not at 1279', async ({
    page,
  }) => {
    await mockResponsiveApi(page);
    await page.setViewportSize({ width: TABLET_END - 1, height: VIEWPORT_HEIGHT });
    await page.goto('/');
    await page.locator('[data-stat="total"]').first().waitFor({ state: 'visible' });
    expect(await widthOf(rail(page))).toBe(SIDEBAR_TABLET_PX);

    await page.setViewportSize({ width: TABLET_END, height: VIEWPORT_HEIGHT });
    expect(await widthOf(rail(page))).toBe(SIDEBAR_DESKTOP_PX);
  });
});

/* -------------------------------------------------------- §3 the JSON panel */

test.describe('§3 AC#12: the JSON panel is a full overlay below md, 300px at tablet, 400px at desktop', () => {
  for (const width of MOBILE_WIDTHS) {
    test(`mobile ${String(width)}: the panel is a full-viewport overlay and no <aside> is mounted`, async ({
      page,
    }) => {
      await mockResponsiveApi(page);
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
      await page.goto('/npc-inventories/1025');
      await page.getByRole('link', { name: /^Back to / }).waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'Toggle JSON panel' }).click();

      const overlay = page.getByRole('dialog', { name: 'NPC Inventories JSON' });
      await expect(overlay).toBeVisible();
      // The dialog's box **is** the viewport.
      expect(await stableBox(overlay)).toEqual({
        x: 0,
        y: 0,
        width,
        height: VIEWPORT_HEIGHT,
      });
      // The desktop pane is not merely hidden: it is not mounted at this width.
      await expect(page.locator('aside[aria-label="NPC Inventories JSON"]')).toHaveCount(0);
      await expectNoHorizontalOverflow(page, width);
    });
  }

  for (const width of TABLET_WIDTHS) {
    test(`tablet ${String(width)}: the panel is the spec’s ${String(JSON_PANEL_TABLET_PX)}px <aside>, not an overlay`, async ({
      page,
    }) => {
      await mockResponsiveApi(page);
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
      await page.goto('/npc-inventories/1025');
      await page.getByRole('link', { name: /^Back to / }).waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'Toggle JSON panel' }).click();

      const aside = page.locator('aside[aria-label="NPC Inventories JSON"]');
      await expect(aside).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(await widthOf(aside)).toBe(JSON_PANEL_TABLET_PX);
      await expectNoHorizontalOverflow(page, width);
    });
  }

  for (const width of DESKTOP_WIDTHS) {
    test(`desktop ${String(width)}: the panel is the spec’s ${String(JSON_PANEL_DESKTOP_PX)}px <aside>`, async ({
      page,
    }) => {
      await mockResponsiveApi(page);
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
      await page.goto('/npc-inventories/1025');
      await page.getByRole('link', { name: /^Back to / }).waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'Toggle JSON panel' }).click();

      const aside = page.locator('aside[aria-label="NPC Inventories JSON"]');
      await expect(aside).toBeVisible();
      expect(await widthOf(aside)).toBe(JSON_PANEL_DESKTOP_PX);
      await expectNoHorizontalOverflow(page, width);
    });
  }
});

/* ---------------------------------------------------------- §4 tables → cards */

test.describe('§4 AC#12: every list route is a card list at mobile and a table at 768', () => {
  for (const family of FAMILIES) {
    test(`${family.listPath}: cards below md, table from md`, async ({ page }) => {
      await mockResponsiveApi(page);
      await page.setViewportSize({ width: 375, height: VIEWPORT_HEIGHT });
      await page.goto(family.listPath);

      // Order matters. The card count **retries** until the list has rendered, so the table's
      // absence is read against a loaded page rather than against "nothing yet" — `toHaveCount(0)`
      // is satisfied by a loading skeleton. p4-10's falsification pass found exactly that
      // vacuity, and this spec keeps its fixed order (D78(d)).
      const cards = main(page).getByRole('list', { name: family.cardListName });
      await expect(cards.getByRole('listitem')).toHaveCount(3);
      await expect(page.getByRole('table')).toHaveCount(0);
      await expectNoHorizontalOverflow(page, 375);

      // At 768 the converse: the table is mounted and the card list is gone. The retrying
      // assertion comes first for the same reason.
      await page.setViewportSize({ width: 768, height: VIEWPORT_HEIGHT });
      await page.goto(family.listPath);
      await expect(page.getByRole('table')).toBeVisible();
      await expect(cards).toHaveCount(0);
      await expectNoHorizontalOverflow(page, 768);
    });
  }
});

/* ------------------------------------------------- §5 the tablet scroll remedy */

test.describe('§5 AC#12: at tablet a wide table scrolls in its own container', () => {
  for (const width of TABLET_WIDTHS) {
    test(`tablet ${String(width)}: the object table’s wrapper is the horizontal scroll container`, async ({
      page,
    }) => {
      await mockResponsiveApi(page);
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
      await page.goto('/drop-tables');
      await expect(page.getByRole('table')).toBeVisible();

      // The spec's remedy for a too-wide table is a scroll container, **not** a narrower child
      // (docs/spec-ui-design.md §"Responsive Breakpoints" "Tables scroll horizontally"). Asserted structurally, on
      // `window.getComputedStyle`: the table's own wrapper is `overflow-x: auto`, so a table wider
      // than the column scrolls inside it instead of pushing the page sideways. That the current
      // fixtures fit (clientWidth == scrollWidth) is not the claim and is not asserted.
      const wrapper = await page.evaluate(() => {
        const table = document.querySelector('table');
        const parent = table?.parentElement ?? null;
        return {
          found: table !== null,
          overflowX: parent === null ? null : getComputedStyle(parent).overflowX,
        };
      });
      expect(wrapper.found).toBe(true);
      expect(wrapper.overflowX).toBe('auto');
      await expectNoHorizontalOverflow(page, width);
    });
  }
});

/* ------------------------------------------------------------- §6 stats cards */

test.describe('§6 AC#12: the stats cards stack at mobile and only fill their columns from desktop', () => {
  const COLUMNS: readonly (readonly [number, number])[] = [
    [375, 1],
    [640, 1],
    [767, 1],
    [768, 2],
    [1024, 2],
    [1279, 2],
    [1280, 4],
    [1440, 4],
  ];

  for (const [width, columns] of COLUMNS) {
    test(`${String(width)}px: the four stat cards occupy ${String(columns)} column(s)`, async ({
      page,
    }) => {
      await mockResponsiveApi(page);
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
      await page.goto('/');
      const cards = page.locator('[data-stat]');
      await expect(cards).toHaveCount(4);
      const xs = new Set<number>();
      for (let index = 0; index < 4; index += 1) {
        const box = await cards.nth(index).boundingBox();
        if (box !== null) xs.add(Math.round(box.x));
      }
      // Distinct left offsets **is** the column count: cards in one column share an x.
      expect(xs.size).toBe(columns);
      await expectNoHorizontalOverflow(page, width);
    });
  }
});

/* ------------------------------------------------------------ §7 the ⌘K palette */

test.describe('§7 P5 additions: the ⌘K palette fits every breakpoint', () => {
  for (const width of [375, 768, 1440] as const) {
    test(`${String(width)}px: the palette is centred and inside the viewport`, async ({ page }) => {
      await mockResponsiveApi(page);
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
      await page.goto('/');
      await page.locator('[data-stat="total"]').first().waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'Search all objects' }).click();

      const dialog = page.getByRole('dialog').first();
      await expect(dialog).toBeVisible();
      const box = await stableBox(dialog);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      // Centred, not left-anchored: `(viewport - width) / 2`.
      expect(box.x).toBe(Math.round((width - box.width) / 2));
      await expectNoHorizontalOverflow(page, width);
    });
  }
});
