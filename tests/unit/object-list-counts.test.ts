import { existsSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { DEFAULT_SPIRALDB_PATH, MEMORY_DB, openDb, writeSettings, type Db } from '@server/db';
import { listObjects } from '@server/services/objects';
import { DROP_TABLE_CORPUS } from '@shared/dropTable';
import { objectTypeConfig } from '@shared/objectTypes';
import type { ObjectFileType } from '@shared/naming';
import {
  CREATURE_SPELLBOOK_CORPUS,
  NPC_DROP_TABLE_CORPUS,
  NPC_INVENTORY_CORPUS,
  NPC_SPELL_INVENTORY_CORPUS,
  TREASURE_CARD_INVENTORY_CORPUS,
  ZONE_TRANSFER_CORPUS,
} from '@shared/simpleObjects';

/**
 * Story p4-09 (task 4.11) — AC1's count arm, in-process and rig-free.
 *
 * > *List pages load real corpus data with verified counts: DropTables **317**, NpcInventory
 * > **215**, NpcSpellInventory **77**, CreatureSpellbook **134**, TreasureCardInventory **1**,
 * > ZoneTransfer **1207**; NpcDropTable shows its empty state gracefully.*
 *
 * The counts come from `listObjects`, the exact function `GET /api/<type>` calls (D12: one fresh
 * scan per request), so this arm proves the **server** derives the AC's numbers from the real
 * corpus rather than a fixture agreeing with itself. It is deliberately not a rig: no server
 * process, no port, no git, no clone write — an in-memory database and one directory scan each.
 *
 * | arm | kind | what it proves |
 * |---|---|---|
 * | this file | **in-process corpus read** (no rig, no port) | `listObjects` answers the AC's six counts and NpcDropTable's absent-directory empty list from the repository's own checkout |
 * | `tests/ui/object-create-and-counts.spec.ts` | **hermetic tier-1** (route-mocked) | each family's list *page* renders the count in its tab badge and pagination, and NpcDropTable renders the empty state + the absent-directory notice |
 *
 * The two are joined by the shared corpus constants (`*_CORPUS.files`, the modules that measured
 * them), so the literal in a UI fixture cannot drift from the number the server counts without one
 * of the two failing.
 *
 * D68: module scope computes presence only; the scan happens inside `it()`. Pointing
 * `SPIRALDB_OBJECT_CORPUS` at an absent path skips the arm (the UI arm still runs in CI).
 */

const ROOT_ENV = (process.env.SPIRALDB_OBJECT_CORPUS ?? '').trim();
const CORPUS_ROOT = ROOT_ENV === '' ? DEFAULT_SPIRALDB_PATH : path.resolve(ROOT_ENV);
/** Presence only (D68). */
const HAS_CORPUS = existsSync(CORPUS_ROOT);

/**
 * The AC's six counts, each with the **two units** it can be quoted in — the files on disk and
 * the rows the list endpoint answers. They are the same number for five families and deliberately
 * not for ZoneTransfer:
 *
 * - AC1 says ZoneTransfer **1207**, which is the `ZoneTransfer/*.json` **file** count (the number
 *   `ls | wc -l` gives and `tests/unit/object-corpus-roundtrip.test.ts` asserts);
 * - the list endpoint answers **1205 rows**, because `ZoneName` is the content key and two pairs
 *   share one (`WizardCity/Tutorial_Exterior`, `…Interior`), so the D19 index collapses each pair
 *   first-file-wins and reports both in `duplicate_keys` (D69's "1205-vs-1207 key collapse").
 *
 * Quoting either number for the other is exactly the D73(h) error class, so both are named here
 * and both are asserted.
 */
const AC_COUNTS: readonly {
  readonly fileType: ObjectFileType;
  /** Files in the family's directory — AC1's own unit. */
  readonly files: number;
  /** Rows `GET /api/<type>` answers — what a list page's tab badge counts. */
  readonly listRows: number;
  /** The family module's measured file count, asserted to agree with {@link files}. */
  readonly measuredFiles: number;
}[] = [
  { fileType: 'droptable', files: 317, listRows: 317, measuredFiles: DROP_TABLE_CORPUS.files },
  {
    fileType: 'npcinventory',
    files: 215,
    listRows: 215,
    measuredFiles: NPC_INVENTORY_CORPUS.files,
  },
  {
    fileType: 'npcspellinventory',
    files: 77,
    listRows: 77,
    measuredFiles: NPC_SPELL_INVENTORY_CORPUS.files,
  },
  {
    fileType: 'creaturespellbook',
    files: 134,
    listRows: 134,
    measuredFiles: CREATURE_SPELLBOOK_CORPUS.files,
  },
  {
    fileType: 'treasurecardinventory',
    files: 1,
    listRows: 1,
    measuredFiles: TREASURE_CARD_INVENTORY_CORPUS.files,
  },
  {
    fileType: 'zonetransfer',
    files: 1207,
    listRows: 1205,
    measuredFiles: ZONE_TRANSFER_CORPUS.files,
  },
];

const OPEN_DBS: Db[] = [];

afterAll(() => {
  while (OPEN_DBS.length > 0) {
    OPEN_DBS.pop()?.close();
  }
});

describe.skipIf(!HAS_CORPUS)('p4-09 ac1 — the list service counts the real corpus', () => {
  it('answers the AC\u2019s count for every family, in both units where they differ', () => {
    const db = openDb({ file: MEMORY_DB });
    OPEN_DBS.push(db);
    writeSettings(db, { spiraldb_path: CORPUS_ROOT, user_name: 'p4-09', git_branch: '' });

    for (const row of AC_COUNTS) {
      expect(row.measuredFiles, `${row.fileType} measured file constant`).toBe(row.files);
      const result = listObjects({
        db,
        config: objectTypeConfig(row.fileType),
        spiraldbPath: CORPUS_ROOT,
      });
      const counted = result.objects.length;
      console.log(
        `[p4-09 ac1] ${row.fileType} path=${CORPUS_ROOT} listRows=${counted} acFiles=${row.files} ` +
          `acListRows=${row.listRows} summary.total=${result.summary?.total ?? 'null'} ` +
          `skipped=${result.skipped.length} duplicate_keys=${result.duplicate_keys.length} ` +
          `missing_directory=${result.missing_directory}`,
      );
      expect(counted, `${row.fileType} list rows`).toBe(row.listRows);
      // The tabs count what the table holds (D49): the summary is derived from the same scan.
      expect(result.summary?.total, `${row.fileType} summary.total`).toBe(counted);
      expect(result.missing_directory, `${row.fileType} directory present`).toBe(false);
      expect(result.skipped, `${row.fileType} unparsable files`).toEqual([]);
      // The file count and the row count differ by exactly the collapsed duplicate keys.
      expect(row.files - row.listRows, `${row.fileType} collapse`).toBe(
        result.duplicate_keys.length,
      );
    }
  });

  it('ZoneTransfer names the two collapsed key pairs rather than dropping a row silently', () => {
    const db = openDb({ file: MEMORY_DB });
    OPEN_DBS.push(db);
    writeSettings(db, { spiraldb_path: CORPUS_ROOT, user_name: 'p4-09', git_branch: '' });

    const result = listObjects({
      db,
      config: objectTypeConfig('zonetransfer'),
      spiraldbPath: CORPUS_ROOT,
    });
    console.log(`[p4-09 ac1] ZoneTransfer duplicate_keys=${JSON.stringify(result.duplicate_keys)}`);
    // 1207 files on disk (AC1's own number, asserted by the D1 sweep), 1205 rows here, 2 pairs.
    expect(ZONE_TRANSFER_CORPUS.files).toBe(1207);
    expect(ZONE_TRANSFER_CORPUS.distinctZoneNames).toBe(1205);
    expect(result.objects.length).toBe(1205);
    expect(result.duplicate_keys).toHaveLength(2);
    expect(result.duplicate_keys.join(' ')).toContain('Tutorial_Exterior');
    expect(result.duplicate_keys.join(' ')).toContain('Tutorial_Interior');
  });

  it('NpcDropTable answers the absent-directory empty list, not an error (D72a)', () => {
    const db = openDb({ file: MEMORY_DB });
    OPEN_DBS.push(db);
    writeSettings(db, { spiraldb_path: CORPUS_ROOT, user_name: 'p4-09', git_branch: '' });

    const result = listObjects({
      db,
      config: objectTypeConfig('npcdroptable'),
      spiraldbPath: CORPUS_ROOT,
    });
    console.log(
      `[p4-09 ac1] npcdroptable path=${CORPUS_ROOT} objects=${result.objects.length} ` +
        `missing_directory=${result.missing_directory} summary=${JSON.stringify(result.summary)}`,
    );
    expect(result.objects).toEqual([]);
    expect(result.missing_directory).toBe(true);
    expect(result.summary).toEqual({ total: 0, extracted: 0, reviewed: 0, verified: 0 });
    expect(result.skipped).toEqual([]);
    // The measured constant is the assertion, so a future round that creates the directory fails
    // here rather than silently invalidating p4-04's absence proof (D72a).
    expect(NPC_DROP_TABLE_CORPUS.files).toBe(0);
    expect(NPC_DROP_TABLE_CORPUS.statusRows).toBe(0);
  });

  it('reports the absent directory by its own flag when the root has no such family at all', () => {
    // A root that cannot exist: the same tolerant path, with nothing read.
    const db = openDb({ file: MEMORY_DB });
    OPEN_DBS.push(db);
    writeSettings(db, {
      spiraldb_path: path.join(CORPUS_ROOT, '__p4-09-absent__'),
      user_name: 'p4-09',
      git_branch: '',
    });
    const result = listObjects({
      db,
      config: objectTypeConfig('npcinventory'),
      spiraldbPath: path.join(CORPUS_ROOT, '__p4-09-absent__'),
    });
    expect(result.objects).toEqual([]);
    expect(result.missing_directory).toBe(true);
  });
});
