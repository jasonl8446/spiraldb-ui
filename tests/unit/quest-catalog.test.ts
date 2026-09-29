import fs from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { MEMORY_DB, openDb, type Db } from '@server/db';
import {
  CATALOG_EXTRACT_SELECT,
  NOT_COLLECTED,
  collectQuestCatalog,
  corpusQuestIdPairs,
  notRunQuestCatalogReport,
  resolveIdOwnership,
  writeQuestCatalog,
  type CollectedQuestCatalog,
} from '@server/services/sync/questCatalog';
import { QuestRefsCollector, type QuestRefSourceRow } from '@server/services/sync/questRefs';
import { runWadScan, type RunWadScanOptions } from '@server/services/sync/wadscan';

/**
 * Task 6.4 — the quest catalog stage
 * ([spec-data-model.md](../../../docs/spec-data-model.md) L137-220).
 *
 * Two halves are exercised separately, because that is how they meet the transaction:
 *
 * * `collectQuestCatalog` (phase A) spawns nothing here — every test injects an
 *   `exec`/`fileExists` fake, so no .NET binary is built or run and no 19 GB tree is read.
 *   The one NDJSON a fake writes goes to a temp dir the function owns and removes again.
 * * `writeQuestCatalog` (phase B) runs against `:memory:`, inside `db.transaction(...)`
 *   exactly like `replaceTables` calls it, with hand-written `string_table` rows standing in
 *   for the `.lang` scan.
 *
 * No test leaves a file behind: the collector's temp directory is removed by the function
 * under test, and the file-database test in db.test.ts removes its own `data/__test-scratch__`
 * directory in `afterEach`.
 */

const OPEN: Db[] = [];

afterEach(() => {
  while (OPEN.length > 0) {
    OPEN.pop()?.close();
  }
});

function memoryDb(): Db {
  const db = openDb({ file: MEMORY_DB });
  OPEN.push(db);
  return db;
}

function collectorOf(rows: readonly QuestRefSourceRow[]): QuestRefsCollector {
  const collector = new QuestRefsCollector();
  for (const row of rows) {
    collector.add(row);
  }
  return collector;
}

function collectedOk(collector: QuestRefsCollector, rows: number): CollectedQuestCatalog {
  return {
    status: 'ok',
    reason: null,
    message: null,
    binaryPath: '/fake/tools/bin/wad-scan',
    collector,
    rows,
    extractMs: 5,
    collectMs: 2,
    ndjsonPath: '/tmp/gone/quest-refs.ndjson',
  };
}

/* ================================================================== phase A */

describe('collectQuestCatalog — the wad-scan half (no process is spawned)', () => {
  it('passes the measured extract command and reads the NDJSON the tool wrote', async () => {
    const seen: RunWadScanOptions[] = [];
    const lines = [
      JSON.stringify({
        wad: 'Aquila-AQ_Z00_Hub.wad',
        entry: 'gamedata.bin',
        class: 'WizZoneData',
        hash: 'abc',
        object: { m_requirement: { m_questName: 'AQ-Z00-MAIN-001' } },
      }),
      JSON.stringify({
        wad: 'Aquila-AQ_Z00_Hub.wad',
        entry: 'triggers.xml',
        class: 'WizZoneTriggers',
        hash: 'def',
        object: { m_requirement: { m_questName: 'AQ-Z00-MAIN-002' } },
      }),
    ];

    const collected = await collectQuestCatalog({
      gamedataDir: '/aurorium/data/V_rTEST/Data/GameData',
      deps: {
        runWadScan: async (options) => {
          seen.push(options);
          if (options.request.command !== 'extract') {
            throw new Error('expected the extract command');
          }
          fs.writeFileSync(options.request.outPath, `${lines.join('\n')}\n`);
          return {
            status: 'ok',
            command: 'extract',
            binaryPath: '/fake/tools/bin/wad-scan',
            args: [],
            stdout: '',
            stderr: '2 rows',
            durationMs: 1,
          };
        },
      },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].request).toEqual({
      command: 'extract',
      gamedataDir: '/aurorium/data/V_rTEST/Data/GameData',
      select: CATALOG_EXTRACT_SELECT,
      outPath: expect.stringContaining('quest-refs.ndjson'),
    });
    expect(CATALOG_EXTRACT_SELECT).toEqual(['gamedata.bin', 'triggers.xml']);

    expect(collected.status).toBe('ok');
    expect(collected.rows).toBe(2);
    expect(collected.collector).not.toBeNull();
    // The stage owns its temp directory and removes it before returning.
    expect(collected.ndjsonPath).not.toBeNull();
    expect(fs.existsSync(collected.ndjsonPath as string)).toBe(false);

    const result = (collected.collector as QuestRefsCollector).finish(
      { hasTitleKey: () => false, titleKeyFor: () => null, countQuestTextRows: () => 0 },
      {},
    );
    expect(result.records.map((record) => record.quest_name)).toEqual([
      'AQ-Z00-MAIN-001',
      'AQ-Z00-MAIN-002',
    ]);
  });

  it('reports the typed skipped result for an absent binary, without spawning (D55)', async () => {
    const collected = await collectQuestCatalog({
      gamedataDir: '/aurorium/data/V_rTEST/Data/GameData',
      // The real invoker with a fake existence probe: the typed `skipped` path, end to end.
      deps: {
        runWadScan: (options) => runWadScan({ ...options, fileExists: () => false }),
      },
    });

    expect(collected.status).toBe('skipped');
    expect(collected.reason).toBe('binary-missing');
    expect(collected.collector).toBeNull();
    expect(collected.rows).toBe(0);
    expect(collected.message).toContain('WAD batch tool not found at');
    expect(collected.message).toContain('npm run build:wadscan');
  });

  it('writes no NDJSON at all on the skipped path', async () => {
    const dir = fs.mkdtempSync('/tmp/p605-catalog-test-');
    const collected = await collectQuestCatalog({
      gamedataDir: '/nowhere',
      tmpDir: dir,
      deps: {
        runWadScan: async () => ({
          status: 'skipped',
          reason: 'binary-missing',
          command: 'extract',
          binaryPath: '/fake/wad-scan',
          args: [],
          message: 'machine',
        }),
      },
    });

    expect(collected.ndjsonPath).toBeNull();
    expect(fs.readdirSync(dir)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

/* ================================================================== phase B */

/**
 * The measured shape of one catalog pass, built by hand:
 *
 * ```
 * string_table:  QuestTitle_00000001/2/3/4
 *                WizQst2_Dialog, WizQst3_Dialog, WizQst3_Text2, WizQst7_Dialog  (+ non-numeric WizQstFire_*)
 * corpus rows:   Q-A-001 (anchor id 1) · Q-A-009 (anchor id 4)
 * catalog rows:  Q-A-001 (a gate + a merge into the corpus row)
 *                Q-A-005 (inferred: the midpoint of 1 and 4 is 2, and it sorts between them)
 *                Q-B-001 (direct: <name>_Complete + an existing QuestTitle_00000003 key → id 3)
 * ```
 */
const DIRECT_ROW: QuestRefSourceRow = {
  wad: 'Aquila-AQ_Z00_Hub.wad',
  entry: 'gamedata.bin',
  class: 'WizZoneData',
  object: {
    $values: [{ m_entryName: 'Q-B-001_Complete', m_displayName: 'QuestTitle_00000003' }],
  },
};

const REFERENCE_ROWS: QuestRefSourceRow[] = [
  {
    wad: 'Aquila-AQ_Z00_Hub.wad',
    entry: 'triggers.xml',
    class: 'WizZoneTriggers',
    object: {
      $values: [
        { m_questName: 'Q-A-005', m_goalName: 'g1', m_requiredStatus: 'Complete' },
        // The same tuple twice: the UNIQUE absorbs one of them (the measured 207-row collapse).
        { m_questName: 'Q-A-005', m_goalName: 'g1', m_requiredStatus: 'Complete' },
        { m_questName: 'Q-A-005', m_goalName: 'g2', m_requiredStatus: 'Active' },
      ],
    },
  },
  {
    wad: 'Aquila-AQ_Z00_Hub.wad',
    entry: 'triggers.xml',
    class: 'WizZoneTriggers',
    object: {
      // A name that is already a corpus row: this is the merge case.
      $values: [{ m_questName: 'Q-A-001', m_goalName: 'g0', m_requiredStatus: 'Complete' }],
    },
  },
];

function seedStringTable(db: Db): void {
  const insert = db.prepare('INSERT INTO string_table (key, value, category) VALUES (?, ?, ?)');
  insert.run('QuestTitle_00000001', 'Corpus One Title', 'QuestTitle');
  insert.run('QuestTitle_00000002', 'Inferred Title', 'QuestTitle');
  insert.run('QuestTitle_00000003', 'Direct Title', 'QuestTitle');
  insert.run('QuestTitle_00000004', 'Corpus Two Title', 'QuestTitle');
  insert.run('QuestTitle_00000005', 'Fifth Title', 'QuestTitle');
  insert.run('WizQst2_Dialog', 'two', 'WizQst2');
  insert.run('WizQst3_Dialog', 'three', 'WizQst3');
  insert.run('WizQst3_Text2', 'three again', 'WizQst3');
  insert.run('WizQst7_Dialog', 'seven', 'WizQst7');
  // Non-numeric tables: never reachable by id (measured: 7 such tables in the real table).
  insert.run('WizQstFire_Dialog', 'fire', 'WizQstFire');
}

/** The corpus rows `replaceTables` has already inserted before the stage runs. */
function seedCorpusRows(db: Db): void {
  const insert = db.prepare(
    `INSERT INTO quests
       (quest_name, title, level, is_mainline, has_definition, link_kind, title_source, reference_count)
     VALUES (?, ?, ?, ?, 1, 'none', 'none', 0)`,
  );
  insert.run('Q-A-001', 'Corpus One', 5, 1);
  insert.run('Q-A-009', 'Corpus Two', 6, 0);
}

const CORPUS_ROWS = [
  { quest_name: 'Q-A-001', titleKey: 'QuestTitle_00000001' },
  { quest_name: 'Q-A-009', titleKey: 'QuestTitle_00000004' },
];

const CORPUS = '/fake/data/test-spiraldb';

/**
 * The transaction `replaceTables` builds, reduced to the parts this stage depends on:
 * the two catalog tables and `quests` are replaced (refs → ids → quests, the FK-safe order),
 * the corpus rows are re-inserted with `has_definition = 1`, then the stage runs.
 *
 * The stage itself never deletes `quests` — that is the pipeline's job (REPLACED_TABLES), which
 * is why this wrapper mirrors it: it is also what exercises the foreign key in delete order.
 */
function runStage(db: Db, collected: CollectedQuestCatalog, corpusRows = CORPUS_ROWS) {
  return db.transaction(() => {
    for (const table of ['quest_catalog_refs', 'quest_ids', 'quests']) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
    seedCorpusRows(db);
    return writeQuestCatalog({ db, collected, corpusRows, corpus: CORPUS });
  })();
}

function scalars(db: Db): Record<string, number> {
  return db.prepare('SELECT * FROM coverage').get() as Record<string, number>;
}

describe('writeQuestCatalog — the merge, the refs, the ids and the coverage view', () => {
  it('merges catalog rows, replaces the refs and ids, and recomputes every derived column', () => {
    const db = memoryDb();
    seedStringTable(db);

    const report = runStage(db, collectedOk(collectorOf([DIRECT_ROW, ...REFERENCE_ROWS]), 4));

    expect(report.status).toBe('ok');
    expect(report.counts).toMatchObject({
      corpus_rows: 2,
      catalog_rows: 3,
      merged_rows: 1,
      catalog_only_rows: 2,
      quests_rows: 4,
      has_definition_rows: 2,
      reference_rows_raw: 4,
      references: 3,
      duplicate_references: 1,
      distinct_reference_keys: 3,
      distinct_wad_entry_pairs: 2,
      ids: 3,
      ids_linked: 2,
      linked_ids_without_text: 0,
      id_collision_names: 0,
      id_collision_ids: 0,
      links_lost_direct: 0,
      links_lost_inferred: 0,
      id_collision_samples: [],
    });
    expect(report.rows_read).toBe(4);
    expect(report.quests?.reference_keys).toBe(3);
    expect(report.holdout?.corpus).toBe(CORPUS);
    expect(report.holdout?.pairs).toBe(2);

    const quests = db
      .prepare(
        `SELECT quest_name, title, level, is_mainline, has_definition, link_kind, title_source, reference_count
           FROM quests ORDER BY quest_name`,
      )
      .all();
    expect(quests).toEqual([
      {
        // A merged row: the corpus title/level/mainline/has_definition survive the merge,
        // while the recomputed reference_count picks up the catalog's reference.
        quest_name: 'Q-A-001',
        title: 'Corpus One',
        level: 5,
        is_mainline: 1,
        has_definition: 1,
        link_kind: 'none',
        title_source: 'none',
        reference_count: 1,
      },
      {
        quest_name: 'Q-A-005',
        title: 'Inferred Title',
        level: null,
        is_mainline: null,
        has_definition: 0,
        link_kind: 'inferred',
        title_source: 'inferred',
        // Two distinct referencing objects — NOT the three raw rows the extractor produced.
        reference_count: 2,
      },
      {
        quest_name: 'Q-A-009',
        title: 'Corpus Two',
        level: 6,
        is_mainline: 0,
        has_definition: 1,
        link_kind: 'none',
        title_source: 'none',
        reference_count: 0,
      },
      {
        quest_name: 'Q-B-001',
        title: 'Direct Title',
        level: null,
        is_mainline: null,
        has_definition: 0,
        link_kind: 'direct',
        title_source: 'direct',
        reference_count: 0,
      },
    ]);

    const refs = db
      .prepare(
        'SELECT quest_name, wad, entry, class, goal_name, required_status FROM quest_catalog_refs ORDER BY quest_name, goal_name',
      )
      .all();
    expect(refs).toEqual([
      {
        quest_name: 'Q-A-001',
        wad: 'Aquila-AQ_Z00_Hub.wad',
        entry: 'triggers.xml',
        class: 'WizZoneTriggers',
        goal_name: 'g0',
        required_status: 'Complete',
      },
      {
        quest_name: 'Q-A-005',
        wad: 'Aquila-AQ_Z00_Hub.wad',
        entry: 'triggers.xml',
        class: 'WizZoneTriggers',
        goal_name: 'g1',
        required_status: 'Complete',
      },
      {
        quest_name: 'Q-A-005',
        wad: 'Aquila-AQ_Z00_Hub.wad',
        entry: 'triggers.xml',
        class: 'WizZoneTriggers',
        goal_name: 'g2',
        required_status: 'Active',
      },
    ]);

    const ids = db
      .prepare(
        'SELECT quest_id, title_key, title, text_rows, matched_quest_name, link_kind, inference_basis FROM quest_ids ORDER BY quest_id',
      )
      .all() as Array<Record<string, unknown>>;
    expect(ids).toHaveLength(3);
    expect(ids[0]).toMatchObject({
      quest_id: 2,
      title_key: 'QuestTitle_00000002',
      title: 'Inferred Title',
      text_rows: 1,
      matched_quest_name: 'Q-A-005',
      link_kind: 'inferred',
    });
    // An inferred link never travels alone: the basis names both anchors and both conditions.
    const basis = JSON.parse(String(ids[0].inference_basis)) as Record<string, unknown>;
    expect(basis).toMatchObject({
      method: 'neighbour-midpoint',
      group: 'Q-A',
      before: { quest_name: 'Q-A-001', quest_id: 1 },
      after: { quest_name: 'Q-A-009', quest_id: 4 },
      candidate_id: 2,
      conditions: { title_key: 'QuestTitle_00000002', text_rows: 1 },
    });
    expect(ids[1]).toMatchObject({
      quest_id: 3,
      text_rows: 2,
      matched_quest_name: 'Q-B-001',
      link_kind: 'direct',
      inference_basis: null,
    });
    // An id nobody linked is still part of the id tier — that is what `id_space` counts.
    expect(ids[2]).toMatchObject({
      quest_id: 7,
      title_key: null,
      matched_quest_name: null,
      link_kind: 'none',
      inference_basis: null,
    });

    // The view's denominators are count(*) on their own tables, by construction.
    const coverage = scalars(db);
    expect(coverage).toEqual({
      nameable: 4,
      id_space: 3,
      defined: 2,
      missing: 2,
      references: 3,
    });
    expect(coverage.nameable).toBe(
      (db.prepare('SELECT count(*) AS c FROM quests').get() as { c: number }).c,
    );
    expect(coverage.id_space).toBe(
      (db.prepare('SELECT count(*) AS c FROM quest_ids').get() as { c: number }).c,
    );
    expect(coverage.references).toBe(
      (db.prepare('SELECT count(*) AS c FROM quest_catalog_refs').get() as { c: number }).c,
    );
  });

  /**
   * The defect the lead found in the first build (`quests.link_kind = 'inferred'` 6 vs
   * `quest_ids` 5): two names interpolate the same candidate id, and `quest_ids.quest_id` is the
   * primary key, so one of them cannot be recorded. Ownership is now decided before the merge —
   * a direct claim beats an inferred one, then name order — and a loser keeps **no** link.
   */
  it('resolves an id claimed twice: the direct claim wins, the loser keeps no link, both counted', () => {
    const db = memoryDb();
    seedStringTable(db);

    // The two corpus rows are also the interpolation anchors: ids 1 and 5 make `Q-A-003`'s
    // candidate `floor((1 + 5) / 2) = 3`, and `Q-B-001` claims id 3 **directly**. One id, two
    // names — `quest_ids.quest_id` is the primary key, so exactly one can be recorded.
    const rows: QuestRefSourceRow[] = [
      DIRECT_ROW,
      {
        wad: 'Aquila-AQ_Z00_Hub.wad',
        entry: 'triggers.xml',
        class: 'WizZoneTriggers',
        object: {
          $values: [{ m_questName: 'Q-A-003', m_goalName: 'g1', m_requiredStatus: 'Complete' }],
        },
      },
    ];
    const corpusRows = [
      { quest_name: 'Q-A-001', titleKey: 'QuestTitle_00000001' },
      { quest_name: 'Q-A-005', titleKey: 'QuestTitle_00000005' },
    ];

    const report = db.transaction(() => {
      for (const table of ['quest_catalog_refs', 'quest_ids', 'quests']) {
        db.prepare(`DELETE FROM ${table}`).run();
      }
      const insert = db.prepare(
        `INSERT INTO quests
           (quest_name, title, level, is_mainline, has_definition, link_kind, title_source, reference_count)
         VALUES (?, ?, NULL, NULL, 1, 'none', 'none', 0)`,
      );
      insert.run('Q-A-001', 'Corpus One');
      insert.run('Q-A-005', 'Corpus Two');
      return writeQuestCatalog({
        db,
        collected: collectedOk(collectorOf(rows), rows.length),
        corpusRows,
        corpus: CORPUS,
      });
    })();

    expect(report.counts.id_collision_names).toBe(1);
    expect(report.counts.id_collision_ids).toBe(1);
    expect(report.counts.links_lost_direct).toBe(0);
    expect(report.counts.links_lost_inferred).toBe(1);
    // The kind is attached to the loser, where a reader needs it: `Q-A-003` had an inferred link.
    expect(report.counts.id_collision_samples).toEqual(['Q-A-003 (inferred) lost id 3 to Q-B-001']);

    expect(
      db
        .prepare(
          'SELECT quest_name, title, link_kind, title_source FROM quests ORDER BY quest_name',
        )
        .all(),
    ).toEqual([
      { quest_name: 'Q-A-001', title: 'Corpus One', link_kind: 'none', title_source: 'none' },
      // The loser keeps no link, and an inferred loser falls back to its name as the title: an
      // inferred title beside `link_kind = 'none'` would be unlabelled inferred material.
      { quest_name: 'Q-A-003', title: 'Q-A-003', link_kind: 'none', title_source: 'none' },
      { quest_name: 'Q-A-005', title: 'Corpus Two', link_kind: 'none', title_source: 'none' },
      { quest_name: 'Q-B-001', title: 'Direct Title', link_kind: 'direct', title_source: 'direct' },
    ]);

    expect(
      db
        .prepare('SELECT quest_id, matched_quest_name, link_kind FROM quest_ids WHERE quest_id = 3')
        .get(),
    ).toEqual({ quest_id: 3, matched_quest_name: 'Q-B-001', link_kind: 'direct' });

    // The invariant the fix exists for: the two tables agree, row for row.
    expect(
      db
        .prepare(
          `SELECT count(*) AS c FROM quests AS q
             WHERE q.link_kind <> 'none'
               AND NOT EXISTS (SELECT 1 FROM quest_ids AS i
                                 WHERE i.matched_quest_name = q.quest_name
                                   AND i.link_kind = q.link_kind)`,
        )
        .get(),
    ).toEqual({ c: 0 });
    expect(
      db
        .prepare(
          `SELECT count(*) AS c FROM quest_ids AS i
             JOIN quests AS q ON q.quest_name = i.matched_quest_name
            WHERE q.link_kind <> i.link_kind`,
        )
        .get(),
    ).toEqual({ c: 0 });
  });

  it('resolveIdOwnership is deterministic and prefers direct evidence', () => {
    const record = (
      quest_name: string,
      kind: 'direct' | 'inferred' | 'none',
      quest_id: number | null,
    ) => ({
      quest_name,
      references: [],
      goal_names: [],
      link: { kind, quest_id, title_key: null, basis: kind === 'inferred' ? '{}' : null },
    });

    const ownership = resolveIdOwnership([
      record('B-001', 'inferred', 7),
      record('A-001', 'inferred', 7),
      record('C-001', 'direct', 7),
      record('D-001', 'none', null),
    ] as never);

    expect(ownership.linked.get(7)).toEqual({ name: 'C-001', kind: 'direct', basis: null });
    expect([...ownership.losers.keys()].sort()).toEqual(['A-001', 'B-001']);
    expect(ownership.recordsWithId).toBe(3);
    // Both units, stated: two losing NAMES on one ID — they differ, so neither may be implied.
    expect(ownership.collisionNames).toBe(2);
    expect(ownership.collisionIds).toBe(1);
    expect(ownership.lostDirect).toBe(0);
    expect(ownership.lostInferred).toBe(2);
    expect(ownership.samples).toEqual([
      'A-001 (inferred) lost id 7 to C-001',
      'B-001 (inferred) lost id 7 to C-001',
    ]);

    // Determinism: the input order cannot change the winner or the losers (the order is total on
    // (kind rank, quest_name), compared byte-wise, and `sort` is stable).
    const shuffled = resolveIdOwnership([
      record('D-001', 'none', null),
      record('A-001', 'inferred', 7),
      record('C-001', 'direct', 7),
      record('B-001', 'inferred', 7),
    ] as never);
    expect(shuffled.linked.get(7)).toEqual(ownership.linked.get(7));
    expect([...shuffled.losers.keys()].sort()).toEqual(['A-001', 'B-001']);
    expect(shuffled.samples).toEqual(ownership.samples);
  });

  /**
   * The measured disagreement this story found: `reference_count` is the *table's* row count, and
   * SQLite's UNIQUE keeps a NULL `goal_name` **distinct** — so two references to the same
   * `(quest, wad, entry, class)` without a goal gate both survive, while p6-04's key space (NULL
   * read as `''`) would collapse them. Both numbers are reported, never substituted.
   */
  it('keeps NULL-goal_name references distinct, exactly as SQLite’s UNIQUE does', () => {
    const db = memoryDb();
    seedStringTable(db);

    const doubled: QuestRefSourceRow = {
      wad: 'Aquila-AQ_Z00_Hub.wad',
      entry: 'triggers.xml',
      class: 'WizZoneTriggers',
      object: { $values: [{ m_questName: 'Q-Z-001' }, { m_questName: 'Q-Z-001' }] },
    };

    const report = runStage(db, collectedOk(collectorOf([doubled]), 1));

    expect(report.counts).toMatchObject({
      reference_rows_raw: 2,
      references: 2,
      duplicate_references: 0,
      distinct_reference_keys: 1,
      distinct_wad_entry_pairs: 1,
      // The id tier is text-driven and independent of the merge: the same three ids as above.
      ids: 3,
      linked_ids_without_text: 0,
    });
    expect(db.prepare('SELECT count(*) AS c FROM quest_catalog_refs').get()).toEqual({ c: 2 });
    expect(
      db.prepare('SELECT reference_count FROM quests WHERE quest_name = ?').get('Q-Z-001'),
    ).toEqual({ reference_count: 2 });
  });

  it('is idempotent: a second pass leaves every count identical', () => {
    const db = memoryDb();
    seedStringTable(db);
    const collected = () => collectedOk(collectorOf([DIRECT_ROW, ...REFERENCE_ROWS]), 4);

    const first = runStage(db, collected());
    const firstCoverage = scalars(db);
    const second = runStage(db, collected());

    expect(second.counts).toEqual(first.counts);
    expect(scalars(db)).toEqual(firstCoverage);
    expect(
      (db.prepare('SELECT count(*) AS c FROM quest_catalog_refs').get() as { c: number }).c,
    ).toBe(3);
  });

  it('empties both catalog tables on the skipped path and keeps every corpus row defined', () => {
    const db = memoryDb();
    seedStringTable(db);

    // A first, complete run leaves refs/ids behind...
    runStage(db, collectedOk(collectorOf([DIRECT_ROW, ...REFERENCE_ROWS]), 4));
    expect(
      (db.prepare('SELECT count(*) AS c FROM quest_catalog_refs').get() as { c: number }).c,
    ).toBe(3);

    // ...then a run whose tool is absent: still a success, both tables replaced (empty).
    const report = runStage(db, NOT_COLLECTED);

    expect(report.status).toBe('skipped');
    expect(report.reason).toBe('not-run');
    expect(report.counts.corpus_rows).toBe(2);
    expect(report.counts.references).toBe(0);
    expect(report.counts.ids).toBe(0);
    expect(report.quests).toBeNull();
    expect(report.holdout).toBeNull();

    const quests = db
      .prepare(
        'SELECT quest_name, has_definition, link_kind, reference_count FROM quests ORDER BY quest_name',
      )
      .all();
    expect(quests).toEqual([
      { quest_name: 'Q-A-001', has_definition: 1, link_kind: 'none', reference_count: 0 },
      { quest_name: 'Q-A-009', has_definition: 1, link_kind: 'none', reference_count: 0 },
    ]);
    expect(scalars(db)).toEqual({
      nameable: 2,
      id_space: 0,
      defined: 2,
      missing: 0,
      references: 0,
    });
  });

  /**
   * Why the deletes are ordered refs → ids → quests: the FK really is enforced, so a refs row
   * outliving its quest would fail the whole replace transaction.
   */
  it('enforces the refs foreign key, which is why the replace deletes refs first', () => {
    const db = memoryDb();

    expect(() =>
      db
        .prepare(
          "INSERT INTO quest_catalog_refs (quest_name, wad, entry, class) VALUES ('NOPE', 'a.wad', 'e', 'c')",
        )
        .run(),
    ).toThrowError(/FOREIGN KEY/i);
  });

  it('reports the skipped tool with its own message, and counts nothing it did not do', () => {
    const report = notRunQuestCatalogReport('binary-missing', 'WAD batch tool not found at /x');

    expect(report).toMatchObject({
      status: 'not-run',
      reason: 'binary-missing',
      message: 'WAD batch tool not found at /x',
      quests: null,
      holdout: null,
    });
    expect(report.counts.references).toBe(0);
    expect(report.counts.ids).toBe(0);
  });
});

describe('corpusQuestIdPairs — the anchors and the hold-out pair set', () => {
  it('parses the same numeric id form the extractor uses, skipping unusable keys', () => {
    expect(
      corpusQuestIdPairs([
        { quest_name: 'Q-A-001', titleKey: 'QuestTitle_00000001' },
        { quest_name: 'Q-A-002', titleKey: 'QuestTitle_0001ED8D' },
        { quest_name: 'Q-A-003', titleKey: null },
        { quest_name: 'Q-A-004', titleKey: 'NotAQuestTitleKey' },
      ]),
    ).toEqual([
      { quest_name: 'Q-A-001', quest_id: 1 },
      { quest_name: 'Q-A-002', quest_id: 0x1ed8d },
    ]);
  });
});
