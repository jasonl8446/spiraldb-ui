import fs from 'node:fs';
import path from 'node:path';

import JSON5 from 'json5';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { MEMORY_DB, openDb, type Db } from '@server/db';
import {
  getLastImportResult,
  IMPORT_SKIPPED_DIRECTORIES,
  IMPORT_TYPE_SPECS,
  importStatusBody,
  normalizeImportKey,
  recordImportResult,
  runFirstStartupImport,
  type ImportResult,
} from '@server/services/import';
import { STATUS_OBJECT_TYPES } from '@server/services/status';

/**
 * Task 1.6 acceptance for the first-startup import (docs/spec-data-model.md
 * L254-279): the skip list, per-type key extraction with `TemplateID` stored as
 * a string, tolerance of legacy trailing commas, unparsable files counted but
 * never fatal, missing directories tolerated, duplicate keys reported without
 * aborting, ONE transaction for every insert, and idempotency (the second run is
 * a no-op that reads nothing).
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

afterEach(() => {
  while (OPEN.length > 0) {
    OPEN.pop()?.close();
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
  // per-entry lifecycle (docs/spec-data-model.md L277, plan-overview Q1).
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
  return runFirstStartupImport({ db, spiraldbPath, now });
}

function countRows(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS count FROM entry_status').get() as { count: number })
    .count;
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

describe('runFirstStartupImport', () => {
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

  it('writes no status_history rows (an import is not a transition)', () => {
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
    // reader (the corpus rule, docs/spec-data-model.md L238-253) parses it.
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
  it('is a no-op that reads nothing on the second run', () => {
    const db = memoryDb();
    const first = run(db);
    expect(first.ran).toBe(true);
    expect(countRows(db)).toBe(9);

    // Any read on the second run would throw this — the skip path must not even
    // look at the filesystem.
    const second = runFirstStartupImport({
      db,
      spiraldbPath: root,
      now: () => '2027-01-01T00:00:00.000Z',
      deps: {
        readdir: () => {
          throw new Error('readdir must not be called on the skip path');
        },
        readFile: () => {
          throw new Error('readFile must not be called on the skip path');
        },
      },
    });

    expect(second).toEqual({
      ran: false,
      imported: 0,
      skipped: 0,
      failed: 0,
      byType: Object.fromEntries(
        STATUS_OBJECT_TYPES.map((type) => [
          type,
          { imported: 0, skipped: 0, failed: 0, duplicates: [], directoryMissing: false },
        ]),
      ),
      importedAt: null,
    });
    expect(countRows(db)).toBe(9);
    expect(db.prepare('SELECT DISTINCT extracted_at FROM entry_status').all()).toEqual([
      { extracted_at: IMPORTED_AT },
    ]);
  });

  it('skips as soon as entry_status holds a single unrelated row', () => {
    const db = memoryDb();
    db.prepare(
      "INSERT INTO entry_status (object_type, object_key) VALUES ('quest', 'PRE-EXISTING')",
    ).run();

    const result = run(db);

    expect(result.ran).toBe(false);
    expect(result.imported).toBe(0);
    expect(result.importedAt).toBeNull();
    expect(countRows(db)).toBe(1);
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

    const result = runFirstStartupImport({ db, spiraldbPath: root });

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
