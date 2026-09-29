import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MEMORY_DB, openDb, resolveRepoRoot, type Db } from '@server/db';
import {
  BREADTH_DECK_SELECT,
  BREADTH_RECIPE_SELECT,
  BREADTH_ZONE_SELECT,
  collectBreadth,
  DECK_WAD_NAME,
  manifestKeyFor,
  matchManifestId,
  buildBreadthManifestIndex,
  readNdjson,
  reconcileZones,
  writeBreadth,
  type BreadthDeps,
  type CollectedBreadth,
} from '@server/services/sync/breadth';
import { parseTemplateManifest } from '@server/services/sync/manifest';
import { runSync, type SyncDeps } from '@server/services/sync/execute';
import { NOT_COLLECTED } from '@server/services/sync/questCatalog';
import { NOT_COLLECTED_BREADTH } from '@server/services/sync/breadth';
import { scanLangDir, type ScanLangDirResult } from '@server/services/sync/lang';

/**
 * Task 6.9 — zone, recipe and deck breadth.
 *
 * The numbers these arms assert are the measured ones, re-typed here rather than imported:
 * 12,402 recipes (all of `Recipes-WorldData.wad`), 599 decks (all of `Decks/**`), 3,356
 * WizZoneData names. Every process is injected, so no arm spawns a .NET binary, reads the 19 GB
 * tree or touches `data/spiraldb-ui.db`.
 */

const OPEN: Db[] = [];
const TEMP: string[] = [];

afterEach(() => {
  while (OPEN.length > 0) {
    OPEN.pop()?.close();
  }
  while (TEMP.length > 0) {
    fs.rmSync(TEMP.pop() as string, { recursive: true, force: true });
  }
});

function memoryDb(): Db {
  const db = openDb({ file: MEMORY_DB });
  OPEN.push(db);
  return db;
}

function tempDir(): string {
  const root = path.join(resolveRepoRoot(), 'data', '__test-scratch__');
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, 'breadth-'));
  TEMP.push(dir);
  return dir;
}

/** A fake `wad-scan` extract row. */
interface FakeRow {
  wad: string;
  entry: string;
  class: string;
  object: Record<string, unknown>;
}

/** One `--select` → the rows that run emits, keyed by the glob list the caller asked for. */
function fakeRowSource(select: readonly string[]): FakeRow[] {
  const key = select.join(',');
  if (key === BREADTH_ZONE_SELECT.join(',')) {
    return [
      {
        wad: 'Aquila-AQ_Z00_Hub.wad',
        entry: 'gamedata.bin',
        class: 'WizZoneData',
        object: { m_zoneName: 'WizardCity/WC_Hub', m_zoneDisplayName: 'WizardZone_00000485' },
      },
      {
        wad: 'DragonSpire-WorldData.wad',
        entry: 'gamedata.bin',
        class: 'WizZoneData',
        object: {
          m_zoneName: 'DragonSpire/DS_A1/Interiors/DS_Plaza_T1',
          // A blank display name is normal (measured 16 of 3,356): the humaniser ladder.
          m_zoneDisplayName: '',
        },
      },
      // A foreign row inside a selection must be *visible* in `class_split`, never silently used.
      { wad: 'X.wad', entry: 'gamedata.bin', class: 'WizZoneTriggers', object: {} },
    ];
  }
  if (key === BREADTH_DECK_SELECT.join(',')) {
    return [
      {
        wad: DECK_WAD_NAME,
        entry: 'Decks/Battlegrounds/MDeck-B-BG-Polymorph-Colossus-A-01.xml',
        class: 'DeckTemplate',
        object: {
          m_name: 'MDeck-B-BG-Polymorph-Colossus-A-01',
          m_spellNameList: [],
          m_behaviors: [],
        },
      },
      {
        wad: DECK_WAD_NAME,
        entry: 'Decks/Polymorph Decks/Polymorph Gobbler.xml',
        class: 'DeckTemplate',
        object: { m_name: 'Polymorph Gobbler', m_spellNameList: [], m_behaviors: [] },
      },
      // The measured over-selection hazard: `Decks/**` in the whole tree also matches 192 `.nif`
      // assets that are not objects at all. The class filter is what keeps them out.
      { wad: 'Mob-WorldData.wad', entry: 'Decks/AQ/AQ_Deck_Gold.nif', class: '', object: {} },
    ];
  }
  if (key === BREADTH_RECIPE_SELECT.join(',')) {
    return [
      {
        wad: 'Recipes-WorldData.wad',
        entry: 'ObjectData/BG_PVE_Recipes/Recipe-BG-Convert-Poly-01.xml',
        class: 'RecipeTemplate',
        object: { m_recipeName: 'Recipe-BG-Convert-Poly-01', m_displayKey: 'Recipes_00005807' },
      },
      {
        wad: 'Recipes-WorldData.wad',
        entry:
          'ObjectData/Spellement Recipes/Fusion_Recipes/Recipe-Shard-DarkAndStormy-Shadow-01.xml',
        class: 'RecipeTemplate',
        object: { m_recipeName: 'Recipe-Shard-DarkAndStormy-Shadow-01', m_displayKey: '' },
      },
      {
        wad: 'Recipes-WorldData.wad',
        entry: 'ObjectData/Unknown/Recipe-Nowhere-01.xml',
        class: 'RecipeTemplate',
        object: { m_recipeName: 'Recipe-Nowhere-01', m_displayKey: '' },
      },
      {
        wad: 'Recipes-WorldData.wad',
        entry: 'ObjectData/BG_PVE_Recipes/Recipe-BG-Convert-Poly-02.xml',
        class: 'RecipeTemplate',
        object: { m_recipeName: 'Recipe-BG-Convert-Poly-02', m_displayKey: '' },
      },
    ];
  }
  throw new Error(`unexpected select: ${key}`);
}

/**
 * A synthetic manifest carrying the four measured shapes at once:
 *
 * - a Root.wad deck, listed verbatim;
 * - a world-wad recipe, listed under the `|<stem>|` prefix;
 * - the **measured defect**: a NUL-prefixed entry whose `.xml` became `.x`;
 * - nothing for one recipe row — the drop case.
 */
const FAKE_MANIFEST = parseTemplateManifest({
  _object: {
    m_serializedTemplates: [
      { m_filename: 'Decks/Battlegrounds/MDeck-B-BG-Polymorph-Colossus-A-01.xml', m_id: 4737210 },
      { m_filename: 'Decks/Polymorph Decks/Polymorph Gobbler.xml', m_id: 4737211 },
      {
        m_filename: '|Recipes|WorldData|ObjectData/BG_PVE_Recipes/Recipe-BG-Convert-Poly-01.xml',
        m_id: 555001,
      },
      {
        m_filename:
          '\u0000\u0000|Recipes|WorldData|ObjectData/Spellement Recipes/Fusion_Recipes/Recipe-Shard-DarkAndStormy-Shadow-01.x',
        m_id: 555002,
      },
      // Deliberately a **repeated id** on a different path: the loader keeps the first and reports
      // `duplicateIds`, so no row can ever reach the join through it (asserted below).
      {
        m_filename: '|Recipes|WorldData|ObjectData/BG_PVE_Recipes/Recipe-BG-Convert-Poly-02.xml',
        m_id: 555001,
      },
    ],
  },
});

/** Every process and filesystem hook injected. */
function fakeDeps(overrides: Partial<BreadthDeps> = {}): BreadthDeps {
  return {
    runWadScan: async ({ request }) => {
      if (request.command !== 'extract') {
        throw new Error('the breadth stage only extracts');
      }
      return {
        status: 'ok',
        command: 'extract',
        binaryPath: '/repo/tools/bin/wad-scan',
        args: [],
        stdout: '',
        stderr: `wad-scan extract: ${fakeRowSource(request.select).length} row(s)`,
        durationMs: 1,
      };
    },
    readNdjson: async (file, onRow) => {
      // The fake keys on the NDJSON file name, exactly as the real reader keys on its path.
      const source =
        path.basename(file) === 'zones.ndjson'
          ? fakeRowSource(BREADTH_ZONE_SELECT)
          : path.basename(file) === 'decks.ndjson'
            ? fakeRowSource(BREADTH_DECK_SELECT)
            : fakeRowSource(BREADTH_RECIPE_SELECT);
      for (const row of source) {
        onRow(row as unknown as Parameters<typeof onRow>[0]);
      }
      return source.length;
    },
    findWad: (gamedataDir, wadName) => `${gamedataDir}/${wadName}`,
    makeScopeDir: (wadPath, wadName) => ({
      dir: `/scope-for/${wadName}(${wadPath})`,
      dispose: () => undefined,
    }),
    makeTmpDir: () => '/fake/breadth-tmp',
    ...overrides,
  };
}

describe('D35 source paths — the manifest spelling, and its two measured defects', () => {
  it('spells a Root.wad entry verbatim and every other archive with its |stem| prefix', () => {
    expect(manifestKeyFor('Root.wad', 'Spells/Stun Block.xml')).toBe('Spells/Stun Block.xml');
    expect(manifestKeyFor('Recipes-WorldData.wad', 'ObjectData/A/B.xml')).toBe(
      '|Recipes|WorldData|ObjectData/A/B.xml',
    );
    // `-` becomes `|`, measured on the manifest's own prefixes (`|Khrysalis|WorldData|…`).
    expect(manifestKeyFor('Khrysalis-WorldData.wad', 'ObjectData/X.xml')).toBe(
      '|Khrysalis|WorldData|ObjectData/X.xml',
    );
  });

  it('repairs only the NUL-prefixed .x truncation, and counts a collision instead of hiding it', () => {
    const index = buildBreadthManifestIndex(FAKE_MANIFEST);
    // Exactly the one measured-shape key is repaired…
    expect(index.repaired).toBe(1);
    expect(index.collisions).toBe(0);
    const repaired = matchManifestId(
      index,
      FAKE_MANIFEST,
      'Recipes-WorldData.wad',
      'ObjectData/Spellement Recipes/Fusion_Recipes/Recipe-Shard-DarkAndStormy-Shadow-01.xml',
    );
    expect(repaired).toEqual({ id: 555002, match: 'repaired' });
    // …an exact hit stays `exact`, and an absent one stays `missing` (never a guessed id).
    expect(
      matchManifestId(
        index,
        FAKE_MANIFEST,
        'Root.wad',
        'Decks/Polymorph Decks/Polymorph Gobbler.xml',
      ),
    ).toEqual({ id: 4737211, match: 'exact' });
    expect(
      matchManifestId(index, FAKE_MANIFEST, 'Recipes-WorldData.wad', 'ObjectData/Unknown.xml'),
    ).toEqual({ id: null, match: 'missing' });
  });

  it('does not touch a file whose name legitimately ends in .x without the NUL prefix', () => {
    const manifest = parseTemplateManifest({
      _object: { m_serializedTemplates: [{ m_filename: 'ObjectData/legit.x', m_id: 7 }] },
    });
    const index = buildBreadthManifestIndex(manifest);
    expect(index.repaired).toBe(0);
    expect([...index.byFile.keys()]).toEqual(['ObjectData/legit.x']);
  });
});

describe('collectBreadth — the three scoped runs', () => {
  it('reads each family under its own one-archive scope and reports what it refused to keep', async () => {
    const collected = await collectBreadth({
      gamedataDir: '/aurorium/GameData',
      manifest: FAKE_MANIFEST,
      tmpDir: '/fake/breadth-tmp',
      deps: fakeDeps(),
    });

    expect(collected.status).toBe('ok');

    // The zone family carries the **raw** `m_zoneDisplayName`, which is a string-table KEY
    // (measured: `WizardZone_00000485` -> "Garden Of Hesperides"); the label is built in
    // `writeBreadth`, after `string_table` is written. A blank key stays `''`, not a guessed name.
    expect(collected.wizZones).toEqual([
      {
        zone_path: 'DragonSpire/DS_A1/Interiors/DS_Plaza_T1',
        display_key: '',
        world: 'DragonSpire',
      },
      {
        zone_path: 'WizardCity/WC_Hub',
        display_key: 'WizardZone_00000485',
        world: 'WizardCity',
      },
    ]);

    // 599/12,402 are the real numbers; here the raw counts are what the fake emitted, and the
    // class split names the foreign rows so a selection can never silently widen.
    expect(collected.report.raw).toEqual({ zones: 3, decks: 3, recipes: 4 });
    expect(collected.report.class_split.zones).toEqual({ WizZoneData: 2, WizZoneTriggers: 1 });
    expect(collected.report.class_split.decks).toEqual({ DeckTemplate: 2, '<error>': 1 });
    expect(collected.report.class_split.recipes).toEqual({ RecipeTemplate: 4 });

    // D35 join accounting: 1 exact, 1 repaired, 2 missing for recipes; 2 exact for decks. The
    // `Recipe-BG-Convert-Poly-02` row is *missing*, not a duplicate id: the manifest loader keeps
    // the first entry for a repeated `m_id` (`counts.duplicateIds`), so the duplicate-id counter
    // below is a guard against a future id source, exactly as `SyncDedupe` is.
    expect(collected.report.manifest.recipes).toMatchObject({ exact: 1, repaired: 1, missing: 2 });
    expect(collected.report.manifest.decks).toMatchObject({ exact: 2, repaired: 0, missing: 0 });

    // The refined rows: one recipe has no manifest entry (dropped), one deck row is a `.nif`.
    expect(collected.recipes.map((row) => row.template_id).sort()).toEqual([555001, 555002]);
    expect(collected.decks.map((row) => row.template_id)).toEqual([4737210, 4737211]);

    // "0 dropped" is a claim about the insert, so the reasons are separated by unit: two rows have
    // no manifest entry at all, and none collides on an id — the guard stays at 0 and says so.
    expect(collected.report.dropped.recipes).toBe(2);
    expect(collected.report.dropped.recipes_missing_id).toBe(2);
    expect(collected.report.dropped.recipes_duplicate_id).toBe(0);
    expect(collected.report.dropped.decks).toBe(0);
    expect(collected.report.dropped_samples).toEqual([
      'recipes |Recipes|WorldData|ObjectData/Unknown/Recipe-Nowhere-01.xml (no manifest entry)',
      'recipes |Recipes|WorldData|ObjectData/BG_PVE_Recipes/Recipe-BG-Convert-Poly-02.xml (no manifest entry)',
    ]);
    // The property that makes the duplicate-id guard dormant, asserted rather than assumed.
    expect(FAKE_MANIFEST.counts.duplicateIds).toBe(1);
    expect(
      FAKE_MANIFEST.byFile.has(
        '|Recipes|WorldData|ObjectData/BG_PVE_Recipes/Recipe-BG-Convert-Poly-02.xml',
      ),
    ).toBe(false);
    expect(readNdjson).toBeTypeOf('function');
  });

  it('scopes the deck and recipe runs to one archive and the zone run to the whole tree', async () => {
    const seen: Array<{ select: string; gamedata: string }> = [];
    await collectBreadth({
      gamedataDir: '/aurorium/GameData',
      manifest: FAKE_MANIFEST,
      tmpDir: '/fake/breadth-tmp',
      deps: fakeDeps({
        runWadScan: async ({ request }) => {
          if (request.command !== 'extract') {
            throw new Error('extract only');
          }
          seen.push({ select: request.select.join(','), gamedata: request.gamedataDir });
          return {
            status: 'ok',
            command: 'extract',
            binaryPath: 'b',
            args: [],
            stdout: '',
            stderr: 's',
            durationMs: 1,
          };
        },
      }),
    });

    expect(seen).toEqual([
      { select: 'gamedata.bin', gamedata: '/aurorium/GameData' },
      { select: 'Decks/**', gamedata: `/scope-for/${DECK_WAD_NAME}(/aurorium/GameData/Root.wad)` },
      {
        select: 'ObjectData/**',
        gamedata: '/scope-for/Recipes-WorldData.wad(/aurorium/GameData/Recipes-WorldData.wad)',
      },
    ]);
  });

  it('turns a missing binary into a typed skipped result with nothing collected (D55)', async () => {
    const collected = await collectBreadth({
      gamedataDir: '/aurorium/GameData',
      manifest: FAKE_MANIFEST,
      tmpDir: '/fake/breadth-tmp',
      deps: fakeDeps({
        runWadScan: async () => ({
          status: 'skipped',
          reason: 'binary-missing',
          command: 'extract',
          binaryPath: '/repo/tools/bin/wad-scan',
          args: [],
          message:
            'WAD batch tool not found at /repo/tools/bin/wad-scan. Build it with: npm run build:wadscan',
        }),
      }),
    });

    expect(collected.status).toBe('skipped');
    expect(collected.reason).toBe('binary-missing');
    expect(collected.wizZones).toEqual([]);
    expect(collected.recipes).toEqual([]);
    expect(collected.decks).toEqual([]);
    // One run was attempted, not three: the stage stops at the first skip.
    expect(collected.report.runs).toEqual([]);
  });
});

describe('reconcileZones — the corpus keys are never lost', () => {
  const corpus = [
    { zone_path: 'WizardCity/WC_Hub', display_name: 'Wizard City / WC Hub', world: 'WizardCity' },
    {
      zone_path: 'Karamelle/KM_Z06_Mines',
      display_name: 'Karamelle / KM Z06 Mines',
      world: 'Karamelle',
    },
  ];
  const wiz = [
    { zone_path: 'WizardCity/WC_Hub', display_key: 'WizardZone_00000485', world: 'WizardCity' },
    {
      zone_path: 'DragonSpire/DS_A1/Interiors/DS_Plaza_T1',
      display_key: 'WizardZone_00009999',
      world: 'DragonSpire',
    },
  ];

  it('takes the game label for a covered key and keeps an uncovered one, reporting both counts', () => {
    const result = reconcileZones(corpus, wiz);
    expect(result.corpus).toBe(2);
    expect(result.wiz).toBe(2);
    expect(result.new).toBe(3);
    expect(result.relabelled).toBe(1);
    expect(result.corpus_only).toBe(1);
    expect(result.corpus_only_samples).toEqual(['Karamelle/KM_Z06_Mines']);
    expect(
      result.rows.map((row) => [row.zone_path, row.corpus_display_name, row.display_key]),
    ).toEqual([
      ['DragonSpire/DS_A1/Interiors/DS_Plaza_T1', null, 'WizardZone_00009999'],
      ['Karamelle/KM_Z06_Mines', 'Karamelle / KM Z06 Mines', null],
      ['WizardCity/WC_Hub', null, 'WizardZone_00000485'],
    ]);
  });

  it('degenerates to the corpus rows alone when the stage collected nothing', () => {
    const result = reconcileZones(corpus, []);
    expect(result.new).toBe(2);
    expect(result.corpus_only).toBe(2);
    expect(result.relabelled).toBe(0);
  });
});

describe('writeBreadth — the label ladder and the reconciled insert', () => {
  it('resolves a recipe label from string_table, else the raw key, else m_recipeName', () => {
    const db = memoryDb();
    db.prepare('INSERT INTO string_table (key, value, category) VALUES (?, ?, ?)').run(
      'Recipes_00005807',
      'Convert Ice Colossus',
      'Recipes',
    );
    db.prepare('INSERT INTO string_table (key, value, category) VALUES (?, ?, ?)').run(
      'WizardZone_00000485',
      'Garden Of Hesperides',
      'WizardZone',
    );
    // An **empty** value is a real state (measured: 5 `WizardZone_*` keys are empty) and must not
    // win the ladder.
    db.prepare('INSERT INTO string_table (key, value, category) VALUES (?, ?, ?)').run(
      'WizardZone_00000005',
      '',
      'WizardZone',
    );
    const collected: CollectedBreadth = {
      status: 'ok',
      reason: null,
      message: null,
      binaryPath: 'b',
      wizZones: [
        { zone_path: 'WizardCity/WC_Hub', display_key: 'WizardZone_00000485', world: 'WizardCity' },
        // A key whose value is empty falls back to the humanised path, never to a blank label.
        {
          zone_path: 'DragonSpire/DS_A1/Interiors/DS_Plaza_T1',
          display_key: 'WizardZone_00000005',
          world: 'DragonSpire',
        },
        // A key the table does not hold falls back to the humanised path too — never to a bare
        // `WizardZone_…`, which is a key and not a name.
        {
          zone_path: 'Aquila/AQ_Z00_Hub',
          display_key: 'WizardZone_99999999',
          world: 'Aquila',
        },
      ],
      recipes: [
        {
          template_id: 1,
          recipe_name: 'Recipe-BG-Convert-Poly-01',
          display_key: 'Recipes_00005807',
          source_path: 'a',
        },
        {
          template_id: 2,
          recipe_name: 'Raw-Key-Row',
          display_key: 'Recipes_00099999',
          source_path: 'b',
        },
        { template_id: 3, recipe_name: 'Recipe-Nowhere-01', display_key: '', source_path: 'c' },
      ],
      decks: [
        {
          template_id: 10,
          deck_name: 'Polymorph Gobbler',
          name: 'Polymorph Gobbler',
          source_path: 'Decks/Polymorph Decks/Polymorph Gobbler.xml',
        },
      ],
      report: { ...NOT_COLLECTED_BREADTH.report, status: 'ok' },
    };

    const report = writeBreadth({
      db,
      collected,
      corpusZones: [
        {
          zone_path: 'WizardCity/WC_Hub',
          display_name: 'Wizard City / WC Hub',
          world: 'WizardCity',
        },
        {
          zone_path: 'Karamelle/KM_Z06_Mines',
          display_name: 'Karamelle / KM Z06 Mines',
          world: 'Karamelle',
        },
      ],
    });

    expect(db.prepare('SELECT template_id, name FROM recipes ORDER BY template_id').all()).toEqual([
      { template_id: 1, name: 'Convert Ice Colossus' },
      // A key the string table does not carry falls back to the key itself (the documented
      // "show the raw key" ladder), never to an invented label.
      { template_id: 2, name: 'Recipes_00099999' },
      { template_id: 3, name: 'Recipe-Nowhere-01' },
    ]);
    expect(db.prepare('SELECT deck_name, name FROM decks').all()).toEqual([
      { deck_name: 'Polymorph Gobbler', name: 'Polymorph Gobbler' },
    ]);
    expect(
      db.prepare('SELECT zone_path, display_name FROM zones ORDER BY zone_path').all(),
    ).toEqual([
      // A key the table does not hold does not resolve — and never becomes a bare `WizardZone_…`.
      { zone_path: 'Aquila/AQ_Z00_Hub', display_name: 'Aquila / AQ Z00 Hub' },
      // An **empty** value does not win either (measured: 5 `WizardZone_*` keys are empty).
      {
        zone_path: 'DragonSpire/DS_A1/Interiors/DS_Plaza_T1',
        display_name: 'Dragon Spire / DS A1 / Interiors / DS Plaza T1',
      },
      // The corpus-only row keeps its own label, which is ac2's "no dropdown regresses".
      { zone_path: 'Karamelle/KM_Z06_Mines', display_name: 'Karamelle / KM Z06 Mines' },
      // The resolved key wins.
      { zone_path: 'WizardCity/WC_Hub', display_name: 'Garden Of Hesperides' },
    ]);
    expect(report.zones).toMatchObject({
      corpus: 2,
      wiz: 3,
      corpus_only: 1,
      relabelled: 1,
      new: 4,
    });
  });

  it('refuses a duplicate manifest id — the primary key is the guard the collector already applied', () => {
    const db = memoryDb();
    const collected: CollectedBreadth = {
      status: 'ok',
      reason: null,
      message: null,
      binaryPath: 'b',
      wizZones: [],
      recipes: [
        { template_id: 7, recipe_name: 'a', display_key: '', source_path: 'a' },
        { template_id: 7, recipe_name: 'b', display_key: '', source_path: 'b' },
      ],
      decks: [],
      report: { ...NOT_COLLECTED_BREADTH.report, status: 'ok' },
    };
    // The collector de-duplicates; `writeBreadth` inherits the transaction's own guard.
    expect(() => writeBreadth({ db, collected, corpusZones: [] })).toThrow(/UNIQUE|PRIMARY/i);
  });
});

describe('migration 0004 — idempotent under repeated `openDb` of the same file', () => {
  it('creates recipes/decks (+ their lookup index) and survives two more opens of the same file', () => {
    const file = path.join(tempDir(), 'breadth.db');

    const first = openDb({ file });
    expect(
      first
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('recipes','decks') ORDER BY name",
        )
        .all(),
    ).toEqual([{ name: 'decks' }, { name: 'recipes' }]);
    expect(
      first
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_decks_deck_name'",
        )
        .all(),
    ).toEqual([{ name: 'idx_decks_deck_name' }]);
    // `deck_name` is a second key: the UNIQUE constraint must exist, not just the index.
    first
      .prepare('INSERT INTO recipes (template_id, name, source_path) VALUES (1, ?, ?)')
      .run('Convert Ice Colossus', 'a');
    first
      .prepare('INSERT INTO decks (template_id, deck_name, name, source_path) VALUES (2, ?, ?, ?)')
      .run('Polymorph Gobbler', 'Polymorph Gobbler', 'b');
    first.close();

    // The runner `db.exec`s every migration file on every open, so a bare `CREATE TABLE` (or an
    // unguarded `ALTER`) would throw here — this is the case SQLite's missing
    // `ADD COLUMN IF NOT EXISTS` makes dangerous, and 0004 needs no guard because it adds none.
    const second = openDb({ file });
    const third = openDb({ file });
    expect(second.prepare('SELECT COUNT(*) AS c FROM recipes').get()).toEqual({ c: 1 });
    expect(third.prepare('SELECT COUNT(*) AS c FROM decks').get()).toEqual({ c: 1 });
    expect(() =>
      third
        .prepare(
          'INSERT INTO decks (template_id, deck_name, name, source_path) VALUES (3, ?, ?, ?)',
        )
        .run('Polymorph Gobbler', 'dup', 'c'),
    ).toThrow(/UNIQUE/i);
    second.close();
    third.close();
  });
});

/* ------------------------------------------------------------------ the orchestrator's wiring */

const QUEST_TITLE_LANG = Buffer.from(
  '\uFEFF' + '1:QuestTitle\r\n126346\r\n\r\nLetters of Light\r\n',
  'utf16le',
);

function langScan(): Promise<ScanLangDirResult> {
  return scanLangDir('/fake/Locale/en-US', {
    deps: { readdir: async () => ['QuestTitle.lang'], readFile: async () => QUEST_TITLE_LANG },
  });
}

const FAKE_MANIFEST_FOR_SYNC = parseTemplateManifest({
  _object: { m_serializedTemplates: [{ m_filename: 'Spells/Firecat.xml', m_id: 424 }] },
});

/** A `collectBreadth` that reports the measured shape without any process or tree. */
function fakeCollectBreadth(): SyncDeps['collectBreadth'] {
  return async () => {
    const collected = await collectBreadth({
      gamedataDir: '/aurorium/GameData',
      manifest: FAKE_MANIFEST,
      tmpDir: '/fake/breadth-tmp',
      deps: fakeDeps(),
    });
    return collected;
  };
}

function syncDeps(overrides: Partial<SyncDeps> = {}): SyncDeps {
  return {
    resolveRevision: () => ({
      revision: 'V_rTEST.Wizard_1_610',
      dataPath: '/aurorium/data/V_rTEST.Wizard_1_610',
      rootWadPath: '/aurorium/data/V_rTEST.Wizard_1_610/Data/GameData/Root.wad',
      source: 'auto',
    }),
    runUnpack: async () => ({
      tempDir: '/fake/tree',
      reused: false,
      durationMs: 1,
      removed: false,
      kept: true,
      stdout: '',
    }),
    loadTemplateManifest: async () => FAKE_MANIFEST_FOR_SYNC,
    scanLangDir: () => langScan(),
    scanTemplateTree: async () => ({
      rows: [],
      items: [],
      spells: [{ template_id: 424, name: 'Firecat' }],
      npcs: [],
      counts: {
        item: 0,
        spell: 1,
        npc: 0,
        pet: 0,
        mount: 0,
        scannedFiles: 1,
        skippedClasses: 0,
        parseErrors: 0,
        noName: 0,
        noNameByFamily: { item: 0, spell: 0, npc: 0, pet: 0, mount: 0 },
        noId: 0,
      },
      parseErrors: [],
      manifest: {
        entries: 1,
        assigned: 1,
        fallback: 0,
        mismatches: 0,
        missing: 0,
        mismatchSamples: [],
        missingSamples: [],
      },
    }),
    buildQuestRows: async () => ({
      rows: [],
      files: 0,
      parseErrors: [],
      resolvedTitles: 0,
      rawKeyFallbacks: 0,
      missingTitles: 0,
    }),
    buildZoneRows: async () => ({
      rows: [
        {
          zone_path: 'WizardCity/WC_Hub',
          display_name: 'Wizard City / WC Hub',
          world: 'WizardCity',
        },
        {
          zone_path: 'Karamelle/KM_Z06_Mines',
          display_name: 'Karamelle / KM Z06 Mines',
          world: 'Karamelle',
        },
      ],
      files: 2,
      parseErrors: [],
    }),
    buildDropTableRows: async () => ({ rows: [], files: 0, parseErrors: [] }),
    collectQuestCatalog: async () => ({ ...NOT_COLLECTED, message: 'skipped in this arm' }),
    collectBreadth: fakeCollectBreadth(),
    ...overrides,
  };
}

function count(db: Db, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

describe('runSync — the breadth stage inside the existing transaction', () => {
  it('writes recipes and decks, reconciles zones, and records the reconciled zone count', async () => {
    const db = memoryDb();
    const result = await runSync({
      db,
      deps: syncDeps(),
      overrides: { auroriumPath: '/aurorium', imcodecPath: '/imcodec', spiraldbPath: '/spiraldb' },
      now: () => new Date('2026-09-25T15:30:00.000Z'),
    });

    expect(result.status).toBe('success');
    expect(result.counts.recipes).toBe(2);
    expect(result.counts.decks).toBe(2);
    // The old count (the corpus scan) and the new count are both reported, which is ac2's shape.
    expect(result.counts.zones).toBe(3);
    expect(result.breadth).toMatchObject({
      status: 'ok',
      recipes: 2,
      decks: 2,
      dropped: { recipes: 2, recipes_missing_id: 2, recipes_duplicate_id: 0, decks: 0 },
    });
    expect(result.breadth.zones).toMatchObject({
      corpus: 2,
      wiz: 2,
      corpus_only: 1,
      corpus_only_samples: ['Karamelle/KM_Z06_Mines'],
      relabelled: 1,
      new: 3,
    });

    expect(count(db, 'recipes')).toBe(2);
    expect(count(db, 'decks')).toBe(2);
    expect(count(db, 'zones')).toBe(3);
    expect(db.prepare('SELECT zones_count FROM sync_history').get()).toEqual({ zones_count: 3 });
    expect(db.prepare('SELECT source_path FROM recipes ORDER BY template_id').all()).toEqual([
      { source_path: '|Recipes|WorldData|ObjectData/BG_PVE_Recipes/Recipe-BG-Convert-Poly-01.xml' },
      {
        source_path:
          '|Recipes|WorldData|ObjectData/Spellement Recipes/Fusion_Recipes/Recipe-Shard-DarkAndStormy-Shadow-01.xml',
      },
    ]);
  });

  it('is idempotent: a second sync writes the same counts', async () => {
    const db = memoryDb();
    const options = {
      db,
      deps: syncDeps(),
      overrides: { auroriumPath: '/aurorium', imcodecPath: '/imcodec', spiraldbPath: '/spiraldb' },
      now: () => new Date('2026-09-25T15:30:00.000Z'),
    };
    const first = await runSync(options);
    const second = await runSync(options);
    expect(second.counts).toEqual(first.counts);
    expect(count(db, 'recipes')).toBe(2);
    expect(count(db, 'zones')).toBe(3);
  });

  it('leaves zones at the corpus rows when the tool is absent, and writes no recipes/decks', async () => {
    const db = memoryDb();
    const result = await runSync({
      db,
      deps: syncDeps({
        collectBreadth: async () => ({ ...NOT_COLLECTED_BREADTH, message: 'no tool' }),
      }),
      overrides: { auroriumPath: '/aurorium', imcodecPath: '/imcodec', spiraldbPath: '/spiraldb' },
      now: () => new Date('2026-09-25T15:30:00.000Z'),
    });

    expect(result.breadth.status).toBe('skipped');
    expect(result.counts.recipes).toBe(0);
    expect(result.counts.decks).toBe(0);
    expect(result.counts.zones).toBe(2);
    expect(db.prepare('SELECT zone_path FROM zones ORDER BY zone_path').all()).toEqual([
      { zone_path: 'Karamelle/KM_Z06_Mines' },
      { zone_path: 'WizardCity/WC_Hub' },
    ]);
    expect(
      db.prepare('SELECT display_name FROM zones WHERE zone_path = ?').get('WizardCity/WC_Hub'),
    ).toEqual({ display_name: 'Wizard City / WC Hub' });
  });
});
