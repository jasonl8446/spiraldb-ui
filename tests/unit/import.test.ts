import fs from 'node:fs';
import path from 'node:path';

import JSON5 from 'json5';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { MEMORY_DB, openDb, type Db } from '@server/db';
import {
  CORPUS_IMPORT_ACTOR,
  corpusImportNote,
  getLastImportResult,
  IMPORT_SKIPPED_DIRECTORIES,
  IMPORT_TYPE_SPECS,
  importStatusBody,
  normalizeImportKey,
  recordImportResult,
  runCorpusImport,
  type ImportResult,
} from '@server/services/import';
import { applyStatusChange, STATUS_OBJECT_TYPES } from '@server/services/status';

/**
 * Task 1.6 acceptance for the corpus import (docs/spec-data-model.md §"Existing Data Import"):
 * the skip list, per-type key extraction with `TemplateID` stored as a string,
 * tolerance of legacy trailing commas, unparsable files counted but never fatal,
 * missing directories tolerated, duplicate keys reported without aborting, ONE
 * transaction for every insert, and idempotency (a second run adopts nothing).
 *
 * Plus D82(a)'s idempotent backfill: a corpus that grows after the first adoption
 * must be reconciled — an `extracted` row and a `status_history` provenance row
 * are added for every key that lacks one, and **nothing that already exists is
 * re-written, re-stamped or re-statused**. That last claim is asserted against
 * whole-row snapshots (not counts) across two runs, with a reviewed row that
 * carries a note as the canary.
 *
 * The corpus is a fixture tree under `data/__test-scratch__/` — the owner's fork
 * is never read or written and `data/test-spiraldb` is never touched (D17). Every
 * database is `:memory:`.
 */

/** `data/__test-scratch__/` — gitignored; every run gets a fresh mkdtemp child. */
const SCRATCH_PARENT = path.join(process.cwd(), 'data', '__test-scratch__');
const IMPORTED_AT = '2026-09-26T05:00:00.000Z';

let root = '';

const OPEN: Db[] = [];

/** Per-test corpus trees, removed with the databases they were read by. */
const TREES: string[] = [];

afterEach(() => {
  while (OPEN.length > 0) {
    OPEN.pop()?.close();
  }
  while (TREES.length > 0) {
    const tree = TREES.pop();
    if (tree !== undefined) {
      fs.rmSync(tree, { recursive: true, force: true });
    }
  }
});

function writeFile(relative: string, content: string): void {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

beforeAll(() => {
  fs.mkdirSync(SCRATCH_PARENT, { recursive: true });
  root = fs.mkdtempSync(path.join(SCRATCH_PARENT, 'import-'));

  // QuestTemplates/ — two imports, one trailing-comma file, one duplicate key,
  // one unparsable file, one non-JSON file, one file with no key, and the
  // skipped `droptables/` subdirectory.
  writeFile('QuestTemplates/quest-a.json', '{"m_questName":"DS-ACAD-C01-001","m_questLevel":1}');
  writeFile(
    'QuestTemplates/quest-b.json',
    '{\n  "m_questName": "DS-ACAD-C01-002",\n  "m_startGoals": [\n    "g1",\n  ],\n}\n',
  );
  writeFile('QuestTemplates/quest-dup.json', '{"m_questName":"DS-ACAD-C01-001"}');
  writeFile('QuestTemplates/quest-broken.json', '{ this is not json');
  writeFile('QuestTemplates/notes.txt', 'not an entry');
  writeFile('QuestTemplates/no-key.json', '{"m_questLevel":3}');
  writeFile(
    'QuestTemplates/droptables/droptables_ds-acad1-c01-001.json',
    '{"Name":"SHOULD-NOT-BE-IMPORTED"}',
  );

  // Never scanned: metadata rides along with a quest, GlobalRegistry has no
  // per-entry lifecycle (docs/spec-data-model.md §"Existing Data Import", plan-overview §"Spec gaps & open questions" Q1).
  writeFile('QuestMetadatas/questmetadata.json', '{"Name":"IGNORED-METADATA"}');
  writeFile('GlobalRegistry/global.json', '{"Name":"IGNORED-GLOBAL"}');

  writeFile('DropTables/ds-acad1-c01-001.json', '{"Name":"DS-ACAD1-C01-001","Description":""}');

  // TemplateID is numeric in every existing file and must land as a string; an
  // already-string value stays verbatim.
  writeFile('NpcInventory/npc-numeric.json', '{"TemplateID":164320}');
  writeFile('NpcInventory/npc-string.json', '{"TemplateID":"1025"}');
  writeFile('NpcSpellInventory/spell.json', '{"TemplateID":38226}');
  writeFile('CreatureSpellbook/book.json', '{"DeckName":"Mdeck-D-R2"}');
  writeFile('TreasureCardInventory/tc.json', '{"TemplateID":38214}');

  // NpcDropTable/ is deliberately absent (it does not exist in the fork either).
  writeFile('ZoneTransfer/zone-hub.json', '{"ZoneName":"WizardCity/WC_Hub"}');
  writeFile('ZoneTransfer/zone-hub-dup.json', '{"ZoneName":"WizardCity/WC_Hub"}');
});

afterAll(() => {
  if (root !== '') {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function memoryDb(): Db {
  const db = openDb({ file: MEMORY_DB });
  OPEN.push(db);
  return db;
}

function run(db: Db, spiraldbPath = root, now = () => IMPORTED_AT): ImportResult {
  return runCorpusImport({ db, spiraldbPath, now });
}

function countRows(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS count FROM entry_status').get() as { count: number })
    .count;
}

/**
 * Every row of both tables, canonically ordered — the instrument the idempotency
 * claim needs, because "counts did not move" is not "the rows did not move"
 * (D90(c): an instrument's insensitivity gets a negative control before its clean
 * result is trusted, and `backfillSnapshotCanary` below is that control).
 */
function snapshot(db: Db): string {
  const entries = db
    .prepare(
      `SELECT id, object_type, object_key, status, extracted_at,
              reviewed_at, verified_at, reviewed_by, verified_by
       FROM entry_status ORDER BY object_type, object_key`,
    )
    .all();
  const history = db
    .prepare(
      `SELECT id, entry_status_id, old_status, new_status, notes, changed_by, changed_at
       FROM status_history ORDER BY id`,
    )
    .all();
  return JSON.stringify({ entries, history });
}

/** One `entry_status` row by key, every column — the canary's whole record. */
function entryRow(db: Db, objectType: string, objectKey: string): unknown {
  return db
    .prepare(
      `SELECT object_type, object_key, status, extracted_at, reviewed_at, verified_at,
              reviewed_by, verified_by
       FROM entry_status WHERE object_type = ? AND object_key = ?`,
    )
    .get(objectType, objectKey);
}

/** One entry's history rows, every column, oldest first. */
function historyRows(db: Db, objectType: string, objectKey: string): unknown {
  return db
    .prepare(
      `SELECT sh.old_status, sh.new_status, sh.notes, sh.changed_by, sh.changed_at
       FROM status_history sh
       JOIN entry_status es ON es.id = sh.entry_status_id
       WHERE es.object_type = ? AND es.object_key = ?
       ORDER BY sh.id`,
    )
    .all(objectType, objectKey);
}

/** The expected per-type accounting for the fixture tree above. */
const EXPECTED_BY_TYPE = {
  quest: {
    imported: 2,
    skipped: 4, // notes.txt, no-key.json, droptables/, quest-dup.json
    failed: 1, // quest-broken.json
    duplicates: ['DS-ACAD-C01-001'],
    directoryMissing: false,
  },
  drop_table: { imported: 1, skipped: 0, failed: 0, duplicates: [], directoryMissing: false },
  npc_inventory: { imported: 2, skipped: 0, failed: 0, duplicates: [], directoryMissing: false },
  npc_spell_inventory: {
    imported: 1,
    skipped: 0,
    failed: 0,
    duplicates: [],
    directoryMissing: false,
  },
  creature_spellbook: {
    imported: 1,
    skipped: 0,
    failed: 0,
    duplicates: [],
    directoryMissing: false,
  },
  // The directory does not exist in this tree — normal, not an error.
  npc_drop_table: {
    imported: 0,
    skipped: 0,
    failed: 0,
    duplicates: [],
    directoryMissing: true,
  },
  treasure_card_inventory: {
    imported: 1,
    skipped: 0,
    failed: 0,
    duplicates: [],
    directoryMissing: false,
  },
  zone_transfer: {
    imported: 1,
    skipped: 1, // zone-hub-dup.json
    failed: 0,
    duplicates: ['WizardCity/WC_Hub'],
    directoryMissing: false,
  },
} as const;

describe('runCorpusImport', () => {
  it('imports every mapped entry with per-type counts, reported duplicates included', () => {
    const db = memoryDb();

    const result = run(db);

    expect(result.ran).toBe(true);
    expect(result.imported).toBe(9);
    expect(result.skipped).toBe(5);
    expect(result.failed).toBe(1);
    expect(result.importedAt).toBe(IMPORTED_AT);
    expect(Object.keys(result.byType)).toEqual([...STATUS_OBJECT_TYPES]);
    expect(result.byType).toEqual(EXPECTED_BY_TYPE);
  });

  it('writes status=extracted and the injected timestamp for every row', () => {
    const db = memoryDb();

    run(db);

    expect(countRows(db)).toBe(9);
    expect(db.prepare('SELECT DISTINCT status FROM entry_status').all()).toEqual([
      { status: 'extracted' },
    ]);
    expect(db.prepare('SELECT DISTINCT extracted_at FROM entry_status').all()).toEqual([
      { extracted_at: IMPORTED_AT },
    ]);
  });

  it('stores the object_key set the fixture tree defines', () => {
    const db = memoryDb();

    run(db);

    const rows = db
      .prepare('SELECT object_type, object_key FROM entry_status ORDER BY object_type, object_key')
      .all();
    expect(rows).toEqual([
      { object_type: 'creature_spellbook', object_key: 'Mdeck-D-R2' },
      { object_type: 'drop_table', object_key: 'DS-ACAD1-C01-001' },
      { object_type: 'npc_inventory', object_key: '1025' },
      { object_type: 'npc_inventory', object_key: '164320' },
      { object_type: 'npc_spell_inventory', object_key: '38226' },
      { object_type: 'quest', object_key: 'DS-ACAD-C01-001' },
      { object_type: 'quest', object_key: 'DS-ACAD-C01-002' },
      { object_type: 'treasure_card_inventory', object_key: '38214' },
      { object_type: 'zone_transfer', object_key: 'WizardCity/WC_Hub' },
    ]);
  });

  it('writes no status_history rows on a first adoption (an import is not a transition)', () => {
    const db = memoryDb();

    run(db);

    expect(db.prepare('SELECT COUNT(*) AS count FROM status_history').get()).toEqual({ count: 0 });
  });
});

describe('the skip list', () => {
  it('scans exactly the eight mapped directories', () => {
    expect(IMPORT_TYPE_SPECS.map((spec) => spec.directory)).toEqual([
      'QuestTemplates',
      'DropTables',
      'NpcInventory',
      'NpcSpellInventory',
      'CreatureSpellbook',
      'NpcDropTable',
      'TreasureCardInventory',
      'ZoneTransfer',
    ]);
    expect(IMPORT_TYPE_SPECS.map((spec) => spec.objectType)).toEqual([...STATUS_OBJECT_TYPES]);
    expect(IMPORT_SKIPPED_DIRECTORIES).toEqual(['QuestMetadatas', 'GlobalRegistry']);
  });

  it('never imports from QuestMetadatas/ or GlobalRegistry/', () => {
    const db = memoryDb();

    run(db);

    const keys = db
      .prepare('SELECT object_key FROM entry_status')
      .all()
      .map((row) => (row as { object_key: string }).object_key);
    expect(keys).not.toContain('IGNORED-METADATA');
    expect(keys).not.toContain('IGNORED-GLOBAL');
  });

  it('never descends into QuestTemplates/droptables/', () => {
    const db = memoryDb();

    run(db);

    const keys = db
      .prepare('SELECT object_key FROM entry_status')
      .all()
      .map((row) => (row as { object_key: string }).object_key);
    expect(keys).not.toContain('SHOULD-NOT-BE-IMPORTED');
    // The subdirectory itself counts as one skipped directory entry.
    expect(fs.existsSync(path.join(root, 'QuestTemplates', 'droptables'))).toBe(true);
  });

  it('skips non-JSON files and files without the key field', () => {
    const db = memoryDb();

    const result = run(db);

    expect(fs.readFileSync(path.join(root, 'QuestTemplates', 'notes.txt'), 'utf8')).toBe(
      'not an entry',
    );
    // Both are in the quest directory: the two skipped files are counted there.
    expect(result.byType.quest.skipped).toBe(4);
  });
});

describe('key extraction', () => {
  it('stores TemplateID as a string, numeric or already-string alike', () => {
    const db = memoryDb();

    run(db);

    const rows = db
      .prepare(
        "SELECT object_key, typeof(object_key) AS kind FROM entry_status WHERE object_type = 'npc_inventory' ORDER BY object_key",
      )
      .all();
    expect(rows).toEqual([
      { object_key: '1025', kind: 'text' },
      { object_key: '164320', kind: 'text' },
    ]);
  });

  it('keeps a zone key containing a slash verbatim', () => {
    const db = memoryDb();

    run(db);

    expect(
      db.prepare("SELECT object_key FROM entry_status WHERE object_type = 'zone_transfer'").get(),
    ).toEqual({ object_key: 'WizardCity/WC_Hub' });
  });

  it.each([
    [164320, '164320'],
    ['1025', '1025'],
    ['', undefined],
    [null, undefined],
    [undefined, undefined],
    [{}, undefined],
    [[1], undefined],
    [Number.NaN, undefined],
    [Number.POSITIVE_INFINITY, undefined],
    [0, '0'],
  ])('normalizeImportKey(%j) → %j', (value, expected) => {
    expect(normalizeImportKey(value)).toBe(expected);
  });
});

describe('legacy trailing commas', () => {
  it('imports a file that strict JSON.parse rejects', () => {
    const file = path.join(root, 'QuestTemplates', 'quest-b.json');
    const content = fs.readFileSync(file, 'utf8');

    // Non-vacuous: the fixture really is invalid strict JSON, and the lenient
    // reader (the corpus rule, docs/spec-data-model.md §"Reading SpiralDB Files") parses it.
    expect(content).toContain(',\n}');
    expect(() => JSON.parse(content)).toThrow();
    expect(JSON5.parse(content)).toEqual({
      m_questName: 'DS-ACAD-C01-002',
      m_startGoals: ['g1'],
    });

    const db = memoryDb();
    run(db);
    expect(
      db
        .prepare("SELECT COUNT(*) AS count FROM entry_status WHERE object_key = 'DS-ACAD-C01-002'")
        .get(),
    ).toEqual({ count: 1 });
  });
});

describe('unparsable files and missing directories', () => {
  it('counts an unparsable file and keeps importing the rest', () => {
    const db = memoryDb();

    const result = run(db);

    expect(result.failed).toBe(1);
    expect(result.byType.quest.failed).toBe(1);
    expect(result.imported).toBe(9);
  });

  it('treats a missing directory as normal and flags it', () => {
    expect(fs.existsSync(path.join(root, 'NpcDropTable'))).toBe(false);

    const db = memoryDb();
    const result = run(db);

    expect(result.byType.npc_drop_table).toEqual({
      imported: 0,
      skipped: 0,
      failed: 0,
      duplicates: [],
      directoryMissing: true,
    });
    expect(result.ran).toBe(true);
  });

  it('handles an existing but empty directory without flagging it missing', () => {
    const emptyRoot = fs.mkdtempSync(path.join(SCRATCH_PARENT, 'empty-'));
    fs.mkdirSync(path.join(emptyRoot, 'NpcDropTable'));
    const db = memoryDb();

    try {
      const result = run(db, emptyRoot);

      expect(result.ran).toBe(true);
      expect(result.imported).toBe(0);
      expect(result.byType.npc_drop_table.directoryMissing).toBe(false);
      expect(result.byType.quest.directoryMissing).toBe(true);
    } finally {
      fs.rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it('is a no-op result (not an error) when the repository root does not exist', () => {
    const db = memoryDb();

    const result = run(db, path.join(root, 'no-such-repository'));

    expect(result.ran).toBe(true);
    expect(result.imported).toBe(0);
    expect(result.failed).toBe(0);
    expect(STATUS_OBJECT_TYPES.every((type) => result.byType[type].directoryMissing)).toBe(true);
    expect(countRows(db)).toBe(0);
  });
});

describe('duplicate keys', () => {
  it('reports a duplicate key without aborting the import (the first file wins)', () => {
    const db = memoryDb();

    const result = run(db);

    expect(result.byType.zone_transfer.duplicates).toEqual(['WizardCity/WC_Hub']);
    expect(result.byType.zone_transfer.skipped).toBe(1);
    expect(
      db
        .prepare("SELECT COUNT(*) AS count FROM entry_status WHERE object_type = 'zone_transfer'")
        .get(),
    ).toEqual({ count: 1 });
  });

  it('allows the same key under two different types (UNIQUE is per type)', () => {
    const db = memoryDb();

    run(db);

    // DS-ACAD-C01-001 is a quest and DS-ACAD1-C01-001 a drop table here; the
    // fixture uses distinct spellings, so pin the cross-type rule explicitly.
    db.prepare(
      "INSERT INTO entry_status (object_type, object_key) VALUES ('quest', 'SHARED')",
    ).run();
    db.prepare(
      "INSERT INTO entry_status (object_type, object_key) VALUES ('drop_table', 'SHARED')",
    ).run();

    expect(countRows(db)).toBe(11);
  });
});

describe('idempotency', () => {
  it('adopts nothing and re-writes nothing on the second run (row-by-row, not by count)', () => {
    const db = memoryDb();
    const first = run(db);
    expect(first.ran).toBe(true);
    expect(countRows(db)).toBe(9);

    const before = snapshot(db);
    let reads = 0;
    // The reconcile must LOOK at the corpus — that is how it knows nothing is
    // missing — so the positive partner below counts the reads it really made,
    // and `readdir`'s real default stays in place (only `readFile` is wrapped).
    const second = runCorpusImport({
      db,
      spiraldbPath: root,
      now: () => '2027-01-01T00:00:00.000Z',
      deps: {
        readFile: (file) => {
          reads += 1;
          return fs.readFileSync(file, 'utf8');
        },
      },
    });

    expect(reads).toBeGreaterThan(0);
    expect(second.ran).toBe(false);
    expect(second.imported).toBe(0);
    expect(second.importedAt).toBeNull();
    expect(countRows(db)).toBe(9);

    // The instrument's negative control: the same snapshot of the same database
    // differs as soon as one row changes, so equality below is a real finding
    // rather than a snapshot that cannot see anything (D90(c)).
    db.prepare(
      "UPDATE entry_status SET status = 'reviewed' WHERE object_key = 'DS-ACAD-C01-001'",
    ).run();
    expect(snapshot(db)).not.toBe(before);
    db.prepare(
      "UPDATE entry_status SET status = 'extracted' WHERE object_key = 'DS-ACAD-C01-001'",
    ).run();
    expect(snapshot(db)).toBe(before);

    // Row-by-row: no new history row either, and no re-stamped timestamp.
    expect(db.prepare('SELECT COUNT(*) AS count FROM status_history').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT DISTINCT extracted_at FROM entry_status').all()).toEqual([
      { extracted_at: IMPORTED_AT },
    ]);
    expect(second.skipped).toBe(5);
    expect(second.failed).toBe(1);
  });

  it('adopts the corpus keys alongside rows the scan does not know about', () => {
    const db = memoryDb();
    db.prepare(
      "INSERT INTO entry_status (object_type, object_key) VALUES ('quest', 'PRE-EXISTING')",
    ).run();
    const preExisting = entryRow(db, 'quest', 'PRE-EXISTING');

    const result = run(db);

    // The unrelated row makes this a reconcile, not a first adoption, so all nine
    // fixture keys are backfilled next to it — and it is untouched, timestamp and
    // all (its `extracted_at` came from the column default, not from this run).
    expect(result.ran).toBe(true);
    expect(result.imported).toBe(9);
    expect(result.importedAt).toBe(IMPORTED_AT);
    expect(countRows(db)).toBe(10);
    expect(entryRow(db, 'quest', 'PRE-EXISTING')).toEqual(preExisting);
    expect(historyRows(db, 'quest', 'PRE-EXISTING')).toEqual([]);
  });
});

describe('the idempotent backfill (D82(a))', () => {
  /** A corpus with one quest; its mtime only ever grows by adding files. */
  function backfillCorpus(): string {
    const tree = fs.mkdtempSync(path.join(SCRATCH_PARENT, 'backfill-'));
    TREES.push(tree);
    fs.mkdirSync(path.join(tree, 'QuestTemplates'), { recursive: true });
    fs.mkdirSync(path.join(tree, 'DropTables'), { recursive: true });
    fs.writeFileSync(
      path.join(tree, 'QuestTemplates', 'quest-a.json'),
      '{"m_questName":"DS-BF-001"}',
    );
    fs.writeFileSync(path.join(tree, 'DropTables', 'table-a.json'), '{"Name":"DROP-BF-1"}');
    return tree;
  }

  function addQuest(tree: string, key: string): void {
    fs.writeFileSync(
      path.join(tree, 'QuestTemplates', `${key}.json`),
      JSON.stringify({ m_questName: key }),
    );
  }

  it('adopts a file that arrives later, with the provenance history row the tool writes', () => {
    const tree = backfillCorpus();
    const db = memoryDb();
    const FIRST = runCorpusImport({ db, spiraldbPath: tree, now: () => IMPORTED_AT });
    expect(FIRST.ran).toBe(true);
    expect(FIRST.imported).toBe(2);
    expect(countRows(db)).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS count FROM status_history').get()).toEqual({ count: 0 });

    // The corpus grows the way the owner's does: a new quest file.
    addQuest(tree, 'DS-BF-002');
    const LATER = '2026-09-27T09:30:00.000Z';

    const second = runCorpusImport({ db, spiraldbPath: tree, now: () => LATER });

    // Counts move by exactly one, and only for the new key.
    expect(second.ran).toBe(true);
    expect(second.imported).toBe(1);
    expect(second.importedAt).toBe(LATER);
    expect(countRows(db)).toBe(3);

    // The new key's row: `extracted`, stamped at the adopt time.
    expect(entryRow(db, 'quest', 'DS-BF-002')).toEqual({
      object_type: 'quest',
      object_key: 'DS-BF-002',
      status: 'extracted',
      extracted_at: LATER,
      reviewed_at: null,
      verified_at: null,
      reviewed_by: null,
      verified_by: null,
    });

    // Its history row, in the repo's creation-row shape: old_status NULL, the
    // adopted status as the new one, the corpus file as the provenance note, the
    // tool named as the writer (never the human).
    expect(historyRows(db, 'quest', 'DS-BF-002')).toEqual([
      {
        old_status: null,
        new_status: 'extracted',
        notes: corpusImportNote('QuestTemplates/DS-BF-002.json'),
        changed_by: CORPUS_IMPORT_ACTOR,
        changed_at: LATER,
      },
    ]);
    expect(corpusImportNote('QuestTemplates/DS-BF-002.json')).toBe(
      'Imported from SpiralDB corpus QuestTemplates/DS-BF-002.json',
    );

    // Exactly one new history row in total: the two first-adoption rows still
    // have none.
    expect(db.prepare('SELECT COUNT(*) AS count FROM status_history').get()).toEqual({ count: 1 });
    expect(historyRows(db, 'quest', 'DS-BF-001')).toEqual([]);
    expect(historyRows(db, 'drop_table', 'DROP-BF-1')).toEqual([]);
  });

  it('leaves a reviewed row — status, note, timestamps, attribution and history — untouched', () => {
    const tree = backfillCorpus();
    const db = memoryDb();
    runCorpusImport({ db, spiraldbPath: tree, now: () => IMPORTED_AT });

    // A human reviews one quest, with a note, through the real transition writer.
    const REVIEWED_AT = '2026-09-26T06:15:00.000Z';
    applyStatusChange(db, {
      objectType: 'quest',
      objectKey: 'DS-BF-001',
      status: 'reviewed',
      notes: 'human review: goals look right',
      changedBy: 'jason',
      now: REVIEWED_AT,
    });

    const reviewedRow = entryRow(db, 'quest', 'DS-BF-001');
    const reviewedHistory = historyRows(db, 'quest', 'DS-BF-001');
    expect(reviewedRow).toEqual({
      object_type: 'quest',
      object_key: 'DS-BF-001',
      status: 'reviewed',
      extracted_at: IMPORTED_AT,
      reviewed_at: REVIEWED_AT,
      verified_at: null,
      reviewed_by: 'jason',
      verified_by: null,
    });

    addQuest(tree, 'DS-BF-003');
    const second = runCorpusImport({
      db,
      spiraldbPath: tree,
      now: () => '2026-09-27T09:30:00.000Z',
    });
    expect(second.imported).toBe(1);

    // Byte-for-byte: the human's transition is not re-stamped, re-statused or
    // re-attributed by the backfill (the D69(b) failure this test exists for).
    expect(entryRow(db, 'quest', 'DS-BF-001')).toEqual(reviewedRow);
    expect(historyRows(db, 'quest', 'DS-BF-001')).toEqual(reviewedHistory);
    expect(reviewedHistory).toEqual([
      {
        old_status: 'extracted',
        new_status: 'reviewed',
        notes: 'human review: goals look right',
        changed_by: 'jason',
        changed_at: REVIEWED_AT,
      },
    ]);
    // …and the backfill's own row is the only addition.
    expect(db.prepare('SELECT COUNT(*) AS count FROM status_history').get()).toEqual({ count: 2 });
  });

  it('changes nothing at all on a second backfill (whole-row comparison, twice)', () => {
    const tree = backfillCorpus();
    const db = memoryDb();
    runCorpusImport({ db, spiraldbPath: tree, now: () => IMPORTED_AT });
    applyStatusChange(db, {
      objectType: 'quest',
      objectKey: 'DS-BF-001',
      status: 'reviewed',
      notes: 'keep me',
      changedBy: 'jason',
      now: '2026-09-26T06:15:00.000Z',
    });
    addQuest(tree, 'DS-BF-002');

    const firstBackfill = runCorpusImport({
      db,
      spiraldbPath: tree,
      now: () => '2026-09-27T09:30:00.000Z',
    });
    expect(firstBackfill.imported).toBe(1);
    const afterFirst = snapshot(db);
    const rows = countRows(db);
    const history = db.prepare('SELECT COUNT(*) AS count FROM status_history').get();

    const secondBackfill = runCorpusImport({
      db,
      spiraldbPath: tree,
      now: () => '2028-01-01T00:00:00.000Z',
    });

    expect(secondBackfill.ran).toBe(false);
    expect(secondBackfill.imported).toBe(0);
    expect(secondBackfill.importedAt).toBeNull();
    expect(snapshot(db)).toBe(afterFirst);
    expect(countRows(db)).toBe(rows);
    expect(db.prepare('SELECT COUNT(*) AS count FROM status_history').get()).toEqual(history);
  });

  it('adopts a whole family that appears later, and keeps a missing one as zero work', () => {
    const tree = backfillCorpus();
    const db = memoryDb();
    runCorpusImport({ db, spiraldbPath: tree, now: () => IMPORTED_AT });

    // NpcDropTable/ does not exist in this tree (it does not exist in the owner's
    // fork either): the reconcile must treat that as nothing to do, never an error.
    expect(fs.existsSync(path.join(tree, 'NpcDropTable'))).toBe(false);
    const firstBackfill = runCorpusImport({ db, spiraldbPath: tree, now: () => IMPORTED_AT });
    expect(firstBackfill.ran).toBe(false);
    expect(firstBackfill.byType.npc_drop_table).toEqual({
      imported: 0,
      skipped: 0,
      failed: 0,
      duplicates: [],
      directoryMissing: true,
    });

    // A whole family arrives at once — its directory and one file.
    fs.mkdirSync(path.join(tree, 'NpcDropTable'));
    fs.writeFileSync(path.join(tree, 'NpcDropTable', 'npc-1.json'), '{"TemplateID":900100}');

    const second = runCorpusImport({
      db,
      spiraldbPath: tree,
      now: () => '2026-09-27T09:30:00.000Z',
    });

    expect(second.imported).toBe(1);
    expect(second.byType.npc_drop_table.directoryMissing).toBe(false);
    expect(entryRow(db, 'npc_drop_table', '900100')).toEqual({
      object_type: 'npc_drop_table',
      object_key: '900100',
      status: 'extracted',
      extracted_at: '2026-09-27T09:30:00.000Z',
      reviewed_at: null,
      verified_at: null,
      reviewed_by: null,
      verified_by: null,
    });
    expect(historyRows(db, 'npc_drop_table', '900100')).toHaveLength(1);
  });

  it('is not an error when the corpus root does not exist and the table has rows', () => {
    const db = memoryDb();
    const tree = backfillCorpus();
    runCorpusImport({ db, spiraldbPath: tree, now: () => IMPORTED_AT });
    const before = snapshot(db);

    const result = runCorpusImport({
      db,
      spiraldbPath: path.join(tree, 'no-such-repository'),
      now: () => IMPORTED_AT,
    });

    expect(result.ran).toBe(false);
    expect(result.imported).toBe(0);
    expect(result.failed).toBe(0);
    expect(STATUS_OBJECT_TYPES.every((type) => result.byType[type].directoryMissing)).toBe(true);
    expect(snapshot(db)).toBe(before);
  });

  it('rolls the adoption AND its history row back together when a later insert fails', () => {
    const db = memoryDb();
    const tree = backfillCorpus();
    runCorpusImport({ db, spiraldbPath: tree, now: () => IMPORTED_AT });
    const before = snapshot(db);

    // Two candidates: a quest (scanned first) and a drop table (scanned after it),
    // so the failing insert lands AFTER the quest's row and history row were
    // written inside the transaction.
    addQuest(tree, 'DS-BF-004');
    fs.writeFileSync(path.join(tree, 'DropTables', 'table-b.json'), '{"Name":"DROP-BF-2"}');
    db.exec(
      `CREATE TRIGGER block_one_entry BEFORE INSERT ON entry_status
       WHEN NEW.object_key = 'DROP-BF-2'
       BEGIN SELECT RAISE(ABORT, 'blocked'); END`,
    );

    expect(() =>
      runCorpusImport({ db, spiraldbPath: tree, now: () => '2026-09-27T09:30:00.000Z' }),
    ).toThrow(/blocked/);

    // A partial backfill must leave neither the status row nor its provenance row.
    expect(snapshot(db)).toBe(before);
    expect(entryRow(db, 'quest', 'DS-BF-004')).toBeUndefined();
    expect(historyRows(db, 'quest', 'DS-BF-004')).toEqual([]);
  });

  it('counts a key that races in between the read and the insert as skipped, not twice', () => {
    const db = memoryDb();
    const tree = backfillCorpus();
    runCorpusImport({ db, spiraldbPath: tree, now: () => IMPORTED_AT });

    addQuest(tree, 'DS-BF-005');
    let raced = false;
    const result = runCorpusImport({
      db,
      spiraldbPath: tree,
      now: () => '2026-09-27T09:30:00.000Z',
      deps: {
        readFile: (file) => {
          // A second writer adopts the same key after the tracked-keys read.
          if (!raced && file.endsWith('DS-BF-005.json')) {
            raced = true;
            db.prepare(
              "INSERT INTO entry_status (object_type, object_key, status) VALUES ('quest', 'DS-BF-005', 'extracted')",
            ).run();
          }
          return fs.readFileSync(file, 'utf8');
        },
      },
    });

    expect(raced).toBe(true);
    expect(result.imported).toBe(0);
    expect(result.ran).toBe(false);
    expect(result.byType.quest.skipped).toBe(1);
    expect(result.byType.quest.duplicates).toEqual(['DS-BF-005']);
    expect(db.prepare('SELECT COUNT(*) AS count FROM status_history').get()).toEqual({ count: 0 });
    expect(entryRow(db, 'quest', 'DS-BF-005')).toMatchObject({ status: 'extracted' });
  });

  it('records the adoption for the status endpoint the palette reads', () => {
    const db = memoryDb();
    const tree = backfillCorpus();
    runCorpusImport({ db, spiraldbPath: tree, now: () => IMPORTED_AT });
    addQuest(tree, 'DS-BF-006');

    const result = runCorpusImport({
      db,
      spiraldbPath: tree,
      now: () => '2026-09-27T09:30:00.000Z',
    });

    // `ran` is what the client's once-only announcement keys off (D37), so an
    // adoption the palette could not previously see is announced.
    expect(importStatusBody(result)).toEqual({
      ran: true,
      imported: 1,
      imported_at: '2026-09-27T09:30:00.000Z',
    });
  });
});

describe('single transaction', () => {
  it('rolls every insert back when one of them fails', () => {
    const db = memoryDb();
    db.exec(
      `CREATE TRIGGER block_entry_status BEFORE INSERT ON entry_status
       BEGIN SELECT RAISE(ABORT, 'blocked'); END`,
    );

    expect(() => run(db)).toThrow(/blocked/);

    // Without the surrounding transaction the earlier inserts would have been
    // committed one by one; a single transaction leaves the table untouched.
    expect(countRows(db)).toBe(0);
  });
});

describe('default clock', () => {
  it('uses ISO-8601 UTC and the same value for importedAt and every row', () => {
    const db = memoryDb();

    const result = runCorpusImport({ db, spiraldbPath: root });

    expect(result.importedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(db.prepare('SELECT DISTINCT extracted_at FROM entry_status').all()).toEqual([
      { extracted_at: result.importedAt },
    ]);
  });
});

describe('the in-memory import record (GET /api/status/_import)', () => {
  it('reflects the last run of this process and resets to zeros when cleared', () => {
    const db = memoryDb();

    const result = run(db);
    expect(getLastImportResult()).toBe(result);
    expect(importStatusBody()).toEqual({ ran: true, imported: 9, imported_at: IMPORTED_AT });

    recordImportResult(null);
    expect(getLastImportResult()).toBeNull();
    expect(importStatusBody()).toEqual({ ran: false, imported: 0, imported_at: null });
  });

  it('records the skip too, so a second startup reports ran=false', () => {
    const db = memoryDb();
    run(db);

    const second = run(db);

    expect(importStatusBody(second)).toEqual({ ran: false, imported: 0, imported_at: null });
    expect(getLastImportResult()).toBe(second);
  });
});
