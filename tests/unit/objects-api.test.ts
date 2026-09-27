import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createNameFor, OBJECT_TYPES, objectTypeConfig } from '@shared/objectTypes';
import { fileNameFor } from '@shared/naming';
import { ULong } from '@shared/ulong';
import { openDb, MEMORY_DB, writeSettings, type Db } from '@server/db';
import {
  createPathFor,
  listObjects,
  ObjectRequestError,
  objectRuntimeFor,
  readObject,
  saveObjectEntry,
  type ObjectRuntime,
} from '@server/services/objects';
import { createObjectRouter } from '@server/routes/objects';
import { createSavePipeline, type SavePipeline } from '@server/services/savePipeline';
import { readSpiraldbJson } from '@server/services/spiraldbFiles';
import { createSpiraldbIndex, type SpiraldbIndex } from '@server/services/spiraldbIndex';
import { SPIRALDB_COLLECTIONS, collectionSpec } from '@server/services/spiraldbFiles';
import { STATUS_OBJECT_TYPES, STATUS_TYPE_BY_ROUTE } from '@server/services/status';
import { getStatusEntry, getStatusHistory } from '@server/services/status';
import {
  commitCount,
  createTempGitRepo,
  removeTempGitRepo,
  repoFileExists,
  writeRepoFile,
  type TempRepo,
} from '../helpers/temp-git-repo';

/**
 * Story p4-01 (task 4.1) acceptance for the generic object scaffolding: list counts
 * for all eight types, the absent-directory case, the status join with no
 * `entry_status` rows at all, an index-resolved update that writes back to the
 * legacy path, a create that uses the spec's convention name (singular
 * `droptable_`, D26) and — the failure modes the story names — nothing that derives a
 * filename from a key, renames a file, throws on a missing directory, or uses two
 * ulong conversions.
 *
 * Hermetic by construction: a throwaway `git init` repository under
 * `data/__test-scratch__/` carrying the **measured legacy filename shapes** of the
 * owner's fork, an in-memory database, and no reads of the real corpus or the clone
 * (D17). The conversion helper's own live corpus checks live in
 * `tests/unit/ulong.test.ts`.
 */

const USER = 'P4-01 Tester';
const OPEN_DBS: Db[] = [];
const REPOS: TempRepo[] = [];

afterEach(() => {
  while (REPOS.length > 0) {
    const repo = REPOS.pop();
    if (repo !== undefined) {
      removeTempGitRepo(repo);
    }
  }
});

afterAll(() => {
  for (const db of OPEN_DBS) {
    db.close();
  }
  while (REPOS.length > 0) {
    const repo = REPOS.pop();
    if (repo !== undefined) {
      removeTempGitRepo(repo);
    }
  }
});

/** The measured legacy shapes (filenames, key representations) of the owner's fork. */
const FIXTURE: Record<string, string> = {
  'DropTables/droptables_ds-acad1-c01-001.json': JSON.stringify({
    Name: 'DS-ACAD1-C01-001',
    Description: '',
    RollChance: 1.0,
    Items: [],
    CreatedAt: '2026-06-01T00:57:50.183246Z',
    ModifiedAt: '2026-06-01T00:57:50.183246Z',
    CreatedBy: 'quest_builder',
    ModifiedBy: 'quest_builder',
  }),
  'DropTables/droptables_ds-acad1-c01-002.json': JSON.stringify({ Name: 'DS-ACAD1-C01-002' }),
  // A duplicate key: the index's and the list's first-in-name-order rule.
  'DropTables/dup-a.json': JSON.stringify({ Name: 'DS-DUP-001' }),
  'DropTables/dup-b.json': JSON.stringify({ Name: 'DS-DUP-001' }),
  'NpcInventory/NPCInventories_1025-A.json': JSON.stringify({
    TemplateID: 1025,
    Inventory: [160936],
  }),
  // Legacy trailing comma (JSON5) and, below, the unprefixed file the fork really holds.
  'NpcInventory/NPCInventories_1026-A.json': '{\n  "TemplateID": 1026,\n  "Inventory": [],\n}\n',
  'NpcInventory/broken.json': '{ not json at all',
  'NpcSpellInventory/NPCSpellInventories_1057-A.json': JSON.stringify({
    TemplateID: 1057,
    Spells: [],
  }),
  'NpcSpellInventory/7cd0cf23-3bba-4eb1-b7fb-1b0e9bd1e11f.json': JSON.stringify({
    TemplateID: '1452231',
    Spells: [],
  }),
  'CreatureSpellbook/CreatureSpellbooks_129-A.json': JSON.stringify({ DeckName: 'Mdeck-D-R2' }),
  'TreasureCardInventory/NpcTreasureCards_2019-A.json': JSON.stringify({ TemplateID: 2019 }),
  'ZoneTransfer/WizardZoneDatas_10017-A.json': JSON.stringify({ ZoneName: 'WizardCity/WC_Hub' }),
  'GlobalRegistry/GlobalRegistryModels_1-A.json': JSON.stringify({
    GlobalRegistryValues: { Christmas: 0, Halloween: 0 },
  }),
  // NpcDropTable/ is deliberately NOT written: it does not exist in the fork.
};

interface Harness {
  repo: TempRepo;
  root: string;
  db: Db;
  index: SpiraldbIndex;
  pipeline: SavePipeline;
}

function harness(): Harness {
  const repo = createTempGitRepo('objects-');
  REPOS.push(repo);
  for (const [relative, content] of Object.entries(FIXTURE)) {
    writeRepoFile(repo, relative, content);
  }
  repo.git(['add', '--all']);
  repo.git(['commit', '-m', 'measured legacy corpus shapes']);

  const db = openDb({ file: MEMORY_DB });
  OPEN_DBS.push(db);
  writeSettings(db, { spiraldb_path: repo.dir, user_name: USER, git_branch: '' });

  const index = createSpiraldbIndex(repo.dir);
  index.rebuild();
  const pipeline = createSavePipeline({ db, spiraldbPath: repo.dir, index });
  return { repo, root: repo.dir, db, index, pipeline };
}

const counts = (h: Harness): Record<string, number> =>
  Object.fromEntries(
    OBJECT_TYPES.map((config) => [
      config.fileType,
      listObjects({ db: h.db, config, spiraldbPath: h.root }).objects.length,
    ]),
  );

describe('the per-type table agrees with the tables that already exist', () => {
  it('every row matches SPIRALDB_COLLECTIONS (directory, key field, status type)', () => {
    for (const config of OBJECT_TYPES) {
      const spec = collectionSpec(config.fileType);
      expect(config.directory, `${config.fileType} directory`).toBe(spec.directory);
      expect(config.keyField, `${config.fileType} key field`).toBe(spec.keyField);
      expect(config.objectType, `${config.fileType} object type`).toBe(spec.objectType);
    }
    // …and the eight rows are exactly the eight non-quest families of that table.
    const questless = SPIRALDB_COLLECTIONS.filter((spec) => spec.fileType !== 'questtemplates');
    expect(OBJECT_TYPES.map((row) => row.fileType)).toEqual(
      questless.filter((spec) => spec.fileType !== 'questmetadata').map((spec) => spec.fileType),
    );
  });

  it('routeType ↔ objectType is D4, in both directions', () => {
    for (const config of OBJECT_TYPES) {
      if (config.objectType === null) {
        expect(config.routeType, 'GlobalRegistry has no D4 route').toBeNull();
        continue;
      }
      expect(config.routeType).not.toBeNull();
      expect(STATUS_TYPE_BY_ROUTE[config.routeType as keyof typeof STATUS_TYPE_BY_ROUTE]).toBe(
        config.objectType,
      );
    }
    // GlobalRegistry is the only family missing from D4's own list, on purpose (Q1).
    expect(STATUS_OBJECT_TYPES.filter((type) => type !== 'quest').sort()).toEqual(
      OBJECT_TYPES.map((row) => row.objectType)
        .filter((type): type is NonNullable<typeof type> => type !== null)
        .sort(),
    );
  });

  it('a create name is fileNameFor, including the singular droptable prefix (D26)', () => {
    expect(createNameFor(objectTypeConfig('droptable'), 'DS-NEW-001')).toBe(
      'droptable_DS-NEW-001.json',
    );
    for (const config of OBJECT_TYPES) {
      if (config.keyField === null) {
        continue;
      }
      const key = config.keyType === 'ulong' ? '4242' : 'Key_With_Underscore';
      expect(createNameFor(config, key)).toBe(fileNameFor(config.fileType, key));
    }
    // The zone transform comes from the same single home.
    expect(createNameFor(objectTypeConfig('zonetransfer'), 'WizardCity/WC_Hub')).toBe(
      'zonetransfer_WizardCity_WC_Hub.json',
    );
  });
});

describe('GET / list: counts, the absent directory and the status join', () => {
  it('counts the eight families from their measured legacy files', () => {
    const h = harness();
    expect(counts(h)).toEqual({
      droptable: 3, // two entries + the duplicate key's surviving first file
      npcinventory: 2,
      npcspellinventory: 2, // incl. the unprefixed UUID-named file
      creaturespellbook: 1,
      npcdroptable: 0,
      treasurecardinventory: 1,
      zonetransfer: 1,
      globalregistry: 1, // the unkeyed family's file stem
    });
  });

  it('tolerates the missing NpcDropTable directory instead of throwing', () => {
    const h = harness();
    expect(fs.existsSync(path.join(h.root, 'NpcDropTable'))).toBe(false);

    const result = listObjects({
      db: h.db,
      config: objectTypeConfig('npcdroptable'),
      spiraldbPath: h.root,
    });
    expect(result.objects).toEqual([]);
    expect(result.missing_directory).toBe(true);
    expect(result.summary).toEqual({ total: 0, extracted: 0, reviewed: 0, verified: 0 });
    expect(result.skipped).toEqual([]);
  });

  it('reports an unparsable file and a duplicate key rather than failing the table', () => {
    const h = harness();

    const dropTables = listObjects({
      db: h.db,
      config: objectTypeConfig('droptable'),
      spiraldbPath: h.root,
    });
    expect(dropTables.objects.map((row) => row.key)).toEqual([
      'DS-ACAD1-C01-001',
      'DS-ACAD1-C01-002',
      'DS-DUP-001',
    ]);
    expect(dropTables.duplicate_keys).toEqual(['DropTables/DS-DUP-001']);

    const npc = listObjects({
      db: h.db,
      config: objectTypeConfig('npcinventory'),
      spiraldbPath: h.root,
    });
    expect(npc.skipped.map((row) => row.file)).toEqual(['NpcInventory/broken.json']);
  });

  it('lists every row as extracted when the family has no entry_status rows at all', () => {
    const h = harness();

    // ZoneTransfer/ and GlobalRegistry/ really carry zero rows; nothing may be dropped
    // by an inner join.
    const zones = listObjects({
      db: h.db,
      config: objectTypeConfig('zonetransfer'),
      spiraldbPath: h.root,
    });
    expect(zones.objects).toEqual([
      {
        key: 'WizardCity/WC_Hub',
        title: 'WizardCity/WC_Hub',
        modified_at: expect.any(String),
        status: 'extracted',
      },
    ]);
    expect(zones.summary).toEqual({ total: 1, extracted: 1, reviewed: 0, verified: 0 });

    const registry = listObjects({
      db: h.db,
      config: objectTypeConfig('globalregistry'),
      spiraldbPath: h.root,
    });
    expect(registry.objects.map((row) => row.key)).toEqual(['GlobalRegistryModels_1-A']);
    expect(registry.objects[0]?.status).toBeNull();
    expect(registry.summary).toBeNull();
  });

  it('joins a stored status to its row by the ulong text key', () => {
    const h = harness();
    h.db
      .prepare(
        `INSERT INTO entry_status (object_type, object_key, status, extracted_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run('npc_inventory', '1025', 'verified', '2026-06-01T00:00:00.000Z');

    const result = listObjects({
      db: h.db,
      config: objectTypeConfig('npcinventory'),
      spiraldbPath: h.root,
    });
    const byKey = new Map(result.objects.map((row) => [row.key, row.status]));
    expect(byKey.get('1025')).toBe('verified');
    expect(byKey.get('1026')).toBe('extracted');
    expect(result.summary).toEqual({ total: 2, extracted: 1, reviewed: 0, verified: 1 });
  });

  it("the list's keys are exactly the index's keys (one scan rule, two callers)", () => {
    const h = harness();
    for (const config of OBJECT_TYPES) {
      if (config.keyField === null) {
        continue;
      }
      const listed = listObjects({ db: h.db, config, spiraldbPath: h.root })
        .objects.map((row) => row.key)
        .sort();
      h.index.rebuildType(config.fileType);
      expect(listed, `${config.fileType} list vs index`).toEqual(h.index.keys(config.fileType));
    }
    // The string-form TemplateID in the unprefixed file is keyed the same way by both.
    expect(h.index.keys('npcspellinventory')).toEqual(['1057', '1452231']);
  });
});

describe('GET /:key: detail resolves through the index (D19)', () => {
  it('serves a legacy-named file by its key, never by a derived name', () => {
    const h = harness();
    const { index } = objectRuntimeFor(h.db, h.root);

    const detail = readObject({ config: objectTypeConfig('npcinventory'), index, key: '1025' });
    expect(detail?.path).toBe(path.join(h.root, 'NpcInventory/NPCInventories_1025-A.json'));
    expect(detail?.object).toEqual({ TemplateID: 1025, Inventory: [160936] });

    // The unprefixed NpcSpellInventory file is reachable and untouched.
    const spell = readObject({
      config: objectTypeConfig('npcspellinventory'),
      index,
      key: '1452231',
    });
    expect(spell?.path).toBe(
      path.join(h.root, 'NpcSpellInventory/7cd0cf23-3bba-4eb1-b7fb-1b0e9bd1e11f.json'),
    );

    expect(
      readObject({ config: objectTypeConfig('npcinventory'), index, key: '999999' }),
    ).toBeUndefined();
  });

  it('resolves the unkeyed registry by its convention name or by its file stem', () => {
    const h = harness();
    const { index } = objectRuntimeFor(h.db, h.root);
    const detail = readObject({
      config: objectTypeConfig('globalregistry'),
      index,
      key: 'GlobalRegistryModels_1-A',
    });
    expect(detail?.path).toBe(path.join(h.root, 'GlobalRegistry/GlobalRegistryModels_1-A.json'));
  });

  /**
   * AC1 at the service level: the unkeyed read is the **merge** of every file in the directory,
   * not the one file the route key names. The fixture holds one file, so the two-file arms below
   * are written into a throwaway repository — the live corpus cannot prove "later wins" because
   * it has exactly one file (the merge rule's own test says so).
   */
  it('serves the merged registry view, case-sensitively and later file wins', () => {
    const h = harness();
    writeRepoFile(
      h.repo,
      'GlobalRegistry/a-extra.json',
      JSON.stringify({
        GlobalRegistryValues: { Localization: 9, localization: 7, Christmas: 5 },
      }),
    );
    h.repo.git(['add', '--all']);
    h.repo.git(['commit', '-m', 'a second registry file']);
    const { index } = objectRuntimeFor(h.db, h.root);

    const detail = readObject({
      config: objectTypeConfig('globalregistry'),
      index,
      // Any key names the family's one logical entry — including the legacy stem.
      key: 'GlobalRegistryModels_1-A',
    });

    // Name order is the injected merge order — plain code-unit order, so `a-extra.json` sorts
    // AFTER the uppercase `GlobalRegistryModels_1-A.json` and its `Christmas: 5` wins. That the
    // winner follows *name* order, not enumeration, is the point (D22: Imlight's order is
    // unsorted; this tool replaces it with one deterministic order). `localization` is a
    // different key from `Localization` (case-sensitive), so both survive with their own values.
    expect(detail?.object).toEqual({
      GlobalRegistryValues: {
        Localization: 9,
        localization: 7,
        Christmas: 5,
        Halloween: 0,
      },
    });
  });

  it('answers an unknown unkeyed key instead of 404ing, while no file means 404', () => {
    const h = harness();
    const { index } = objectRuntimeFor(h.db, h.root);
    const config = objectTypeConfig('globalregistry');

    // The family has one logical entry, so the route key is a name, not a selector.
    const byAnyKey = readObject({ config, index, key: 'not-a-file-stem' });
    expect(byAnyKey?.object).toEqual({
      GlobalRegistryValues: { Christmas: 0, Halloween: 0 },
    });
    expect(byAnyKey?.path).toBe(path.join(h.root, 'GlobalRegistry/GlobalRegistryModels_1-A.json'));

    // Nothing to read is a 404: the create path, not an empty registry.
    fs.rmSync(path.join(h.root, 'GlobalRegistry'), { recursive: true });
    expect(readObject({ config, index, key: 'anything' })).toBeUndefined();
  });
});

describe('POST /: the save path', () => {
  it('creates with the spec convention name and bootstraps the missing directory', async () => {
    const h = harness();
    const runtime: ObjectRuntime = objectRuntimeFor(h.db, h.root);
    expect(fs.existsSync(path.join(h.root, 'NpcDropTable'))).toBe(false);
    // The name the create is expected to land on, from the convention's single home.
    expect(createPathFor(h.root, objectTypeConfig('npcdroptable'), '4242')).toBe(
      path.join(h.root, 'NpcDropTable/npcdroptable_4242.json'),
    );

    const result = await saveObjectEntry({
      db: h.db,
      config: objectTypeConfig('npcdroptable'),
      index: runtime.index,
      pipeline: runtime.pipeline,
      body: { object: { TemplateID: 4242, DropTableNames: [] } },
    });

    expect(result).toMatchObject({
      key: '4242',
      file_type: 'npcdroptable',
      object_type: 'npc_drop_table',
      outcome: 'created',
      action: 'create',
      file: 'NpcDropTable/npcdroptable_4242.json',
      commit_message: 'spiraldb: create npc_drop_table 4242',
      status_created: true,
    });
    expect(repoFileExists(h.repo, 'NpcDropTable/npcdroptable_4242.json')).toBe(true);
    // AC3: a number in JSON, a string in entry_status.object_key.
    expect(readSpiraldbJson(path.join(h.root, 'NpcDropTable/npcdroptable_4242.json'))).toEqual({
      TemplateID: 4242,
      DropTableNames: [],
    });
    expect(result.status?.object_key).toBe('4242');

    const entry = getStatusEntry(h.db, 'npc_drop_table', '4242');
    expect(entry?.status).toBe('extracted');
    const history = getStatusHistory(h.db, 'npc_drop_table', '4242');
    expect(history.found ? history.history : []).toEqual([
      expect.objectContaining({
        old_status: null,
        new_status: 'extracted',
        notes: 'Created via UI',
      }),
    ]);
  });

  it('creates a drop table as singular droptable_, never the legacy plural prefix', async () => {
    const h = harness();
    const runtime = objectRuntimeFor(h.db, h.root);

    const result = await saveObjectEntry({
      db: h.db,
      config: objectTypeConfig('droptable'),
      index: runtime.index,
      pipeline: runtime.pipeline,
      body: { object: { Name: 'DS-NEW-001', RollChance: 1.0 } },
    });

    expect(result.file).toBe('DropTables/droptable_DS-NEW-001.json');
    expect(repoFileExists(h.repo, 'DropTables/droptable_DS-NEW-001.json')).toBe(true);
    expect(repoFileExists(h.repo, 'DropTables/droptables_DS-NEW-001.json')).toBe(false);
  });

  it('updates the file where it lives, keeping its legacy name and untouched keys', async () => {
    const h = harness();
    const runtime = objectRuntimeFor(h.db, h.root);
    const LEGACY = 'DropTables/droptables_ds-acad1-c01-001.json';

    const result = await saveObjectEntry({
      db: h.db,
      config: objectTypeConfig('droptable'),
      index: runtime.index,
      pipeline: runtime.pipeline,
      // What an editor holds: the loaded document with the one edited field. `Items`
      // and the audit keys are absent here on purpose — D5's merge keeps them.
      body: { object: { Name: 'DS-ACAD1-C01-001', Description: 'edited by p4-01' } },
    });

    expect(result).toMatchObject({
      outcome: 'updated',
      action: 'update',
      file: LEGACY,
      commit_message: 'spiraldb: update drop_table DS-ACAD1-C01-001',
    });
    expect(repoFileExists(h.repo, LEGACY)).toBe(true);
    expect(repoFileExists(h.repo, 'DropTables/droptable_DS-ACAD1-C01-001.json')).toBe(false);

    const written = readSpiraldbJson(path.join(h.root, LEGACY)) as Record<string, unknown>;
    expect(written.Description).toBe('edited by p4-01');
    expect(written.Items).toEqual([]);
    expect(written.CreatedBy).toBe('quest_builder');
    expect(written.RollChance).toBe(1);
  });

  it('writes a ulong key given as text back into the JSON as a number', async () => {
    const h = harness();
    const runtime = objectRuntimeFor(h.db, h.root);
    const LEGACY = 'NpcInventory/NPCInventories_1025-A.json';

    const result = await saveObjectEntry({
      db: h.db,
      config: objectTypeConfig('npcinventory'),
      index: runtime.index,
      pipeline: runtime.pipeline,
      body: { object: { TemplateID: '1025', Inventory: [160936, 160943] } },
    });

    expect(result.key).toBe('1025');
    expect(result.file).toBe(LEGACY);
    expect(readSpiraldbJson(path.join(h.root, LEGACY))).toEqual({
      TemplateID: 1025,
      Inventory: [160936, 160943],
    });
  });

  /**
   * **Phase transition (story p4-07, task 4.9 / D22).** p4-01 pinned the opposite: a save wrote
   * `globalregistry.json` and *left every other file in place*, reporting them as a warning —
   * a deliberate deferral whose test was literally named "task 4.9 owns them". Task 4.9 is this
   * story, so the assertion changes into the behaviour it deferred: **one commit adds the new file
   * and deletes the legacy one**, the directory afterwards holds exactly one file, and the commit
   * message is `spiraldb: update global_registry globalregistry` even though the written file did
   * not exist before (the entry existed in the file being replaced).
   */
  it('consolidates the registry into one file in a single commit (task 4.9 / D22)', async () => {
    const h = harness();
    const runtime = objectRuntimeFor(h.db, h.root);
    const legacy = 'GlobalRegistry/GlobalRegistryModels_1-A.json';
    expect(repoFileExists(h.repo, legacy)).toBe(true);
    const commitsBefore = commitCount(h.repo);

    const result = await saveObjectEntry({
      db: h.db,
      config: objectTypeConfig('globalregistry'),
      index: runtime.index,
      pipeline: runtime.pipeline,
      body: { object: { GlobalRegistryValues: { Christmas: 1, Halloween: 0 } } },
    });

    expect(result.file).toBe('GlobalRegistry/globalregistry.json');
    expect(result.object_type).toBeNull();
    expect(result.status).toBeNull();
    expect(result.action).toBe('update');
    expect(result.commit_message).toBe('spiraldb: update global_registry globalregistry');
    // ONE commit, and it carries both the addition and the deletion (AC2a/b).
    expect(commitCount(h.repo)).toBe(commitsBefore + 1);
    expect(h.repo.git(['show', '--name-status', '--format=', 'HEAD']).trim().split('\n')).toEqual([
      `D\t${legacy}`,
      'A\tGlobalRegistry/globalregistry.json',
    ]);
    // …and afterwards the directory holds exactly one file (AC2c).
    expect(fs.readdirSync(path.join(h.root, 'GlobalRegistry'))).toEqual(['globalregistry.json']);
    expect(result.warnings.join(' ')).toContain('Consolidated 1 file(s)');
    // No tracking row is created (AC2d / Q1), queried by the type's REAL `object_type`
    // name (D74(c)).
    expect(
      h.db
        .prepare<[string], { count: number }>(
          'SELECT COUNT(*) AS count FROM entry_status WHERE object_type = ?',
        )
        .get('global_registry'),
    ).toEqual({ count: 0 });
  });

  it('leaves a file the merge could not account for in place, and says so', async () => {
    const h = harness();
    const runtime = objectRuntimeFor(h.db, h.root);
    // A document with no `GlobalRegistryValues` wrapper: nothing the merge can account for. The
    // save must not destroy it (the named failure mode "deleting a file the merge did not
    // account for") — and a file whose text cannot be parsed at all is the same case.
    writeRepoFile(h.repo, 'GlobalRegistry/not-a-registry.json', '{"SomethingElse": 1}\n');
    writeRepoFile(h.repo, 'GlobalRegistry/broken.json', '{ not json at all\n');
    h.repo.git(['add', '--all']);
    h.repo.git(['commit', '-m', 'two files the merge cannot account for']);

    const result = await saveObjectEntry({
      db: h.db,
      config: objectTypeConfig('globalregistry'),
      index: runtime.index,
      pipeline: runtime.pipeline,
      body: { object: { GlobalRegistryValues: { Christmas: 1 } } },
    });

    expect(repoFileExists(h.repo, 'GlobalRegistry/not-a-registry.json')).toBe(true);
    expect(repoFileExists(h.repo, 'GlobalRegistry/broken.json')).toBe(true);
    // The legacy file the merge DID account for is gone; the two it could not are reported.
    expect(repoFileExists(h.repo, 'GlobalRegistry/GlobalRegistryModels_1-A.json')).toBe(false);
    expect(result.warnings.join(' ')).toContain('not-a-registry.json');
    expect(result.warnings.join(' ')).toContain('broken.json');
  });

  it('rejects a body it cannot key, with an actionable message', async () => {
    const h = harness();
    const runtime = objectRuntimeFor(h.db, h.root);
    const save = (
      config: Parameters<typeof objectTypeConfig>[0],
      body: unknown,
    ): Promise<unknown> =>
      saveObjectEntry({
        db: h.db,
        config: objectTypeConfig(config),
        index: runtime.index,
        pipeline: runtime.pipeline,
        body,
      });

    await expect(save('droptable', 'not an object')).rejects.toThrow(ObjectRequestError);
    await expect(save('droptable', {})).rejects.toThrow(/Missing object/);
    await expect(save('droptable', { object: { RollChance: 1 } })).rejects.toThrow(
      /no usable "Name"/,
    );
    await expect(save('npcinventory', { object: { TemplateID: 'not-a-number' } })).rejects.toThrow(
      /unsigned integer/,
    );
    await expect(save('globalregistry', { object: {}, key: 'nope' })).rejects.toThrow(
      /single unkeyed file/,
    );
    // Nothing was written by the rejections.
    expect(repoFileExists(h.repo, 'DropTables/droptable_DS-NEW-001.json')).toBe(false);
  });
});

/* ------------------------------------------------------------- the HTTP surface */

/**
 * The router itself, over the same fixture: the eight mount paths of
 * docs/spec-api.md L310-319, `GET /` / `GET /:key` / `POST /`, the 400/404/409/500
 * mapping, and the ulong route-key canonicalisation. The app is built exactly the
 * way `routes/index.ts` builds it for the real server — one `createObjectRouter` per
 * table row, mounted at `config.urlPath` — but with an injected in-memory connection,
 * so no request here can open `data/spiraldb-ui.db` (D32).
 */
const SPEC_BASE_PATHS = [
  '/api/drop-tables',
  '/api/npc-inventories',
  '/api/npc-spell-inventories',
  '/api/creature-spellbooks',
  '/api/npc-drop-tables',
  '/api/treasure-card-inventories',
  '/api/zone-transfers',
  '/api/global-registry',
];

function appFor(h: Harness, fileTypes: readonly Parameters<typeof objectTypeConfig>[0][]): Express {
  const app = express();
  app.use(express.json());
  for (const fileType of fileTypes) {
    const config = objectTypeConfig(fileType);
    app.use(config.urlPath, createObjectRouter({ db: h.db, config }));
  }
  return app;
}

describe('the router: the spec mount paths and their HTTP contract', () => {
  it('mounts exactly the eight base paths of docs/spec-api.md L310-319', () => {
    expect(OBJECT_TYPES.map((config) => config.urlPath)).toEqual(SPEC_BASE_PATHS);
  });

  it('lists an absent directory as an empty list, not an error', async () => {
    const h = harness();
    const app = appFor(h, ['npcdroptable', 'npcinventory']);

    const empty = await request(app).get('/api/npc-drop-tables').expect(200);
    expect(empty.body).toEqual({
      objects: [],
      summary: { total: 0, extracted: 0, reviewed: 0, verified: 0 },
      skipped: [],
      missing_directory: true,
      duplicate_keys: [],
    });

    const npc = await request(app).get('/api/npc-inventories').expect(200);
    expect(npc.body.objects.map((row: { key: string }) => row.key)).toEqual(['1025', '1026']);
    expect(npc.body.missing_directory).toBe(false);
  });

  it('serves GET /:key by key, canonicalising a ulong key, and 404s an unknown one', async () => {
    const h = harness();
    const app = appFor(h, ['npcinventory']);

    const exact = await request(app).get('/api/npc-inventories/1025').expect(200);
    expect(exact.body).toEqual({ TemplateID: 1025, Inventory: [160936] });

    // The same entry, asked for in a non-canonical text form.
    const padded = await request(app).get('/api/npc-inventories/01025').expect(200);
    expect(padded.body).toEqual(exact.body);

    await request(app).get('/api/npc-inventories/999999').expect(404);
  });

  it('saves through POST, creating the convention file and the directory', async () => {
    const h = harness();
    const app = appFor(h, ['npcdroptable']);

    const created = await request(app)
      .post('/api/npc-drop-tables')
      .send({ object: { TemplateID: 7777, DropTableNames: [] } })
      .expect(200);
    expect(created.body).toMatchObject({
      key: '7777',
      outcome: 'created',
      action: 'create',
      file: 'NpcDropTable/npcdroptable_7777.json',
      commit_message: 'spiraldb: create npc_drop_table 7777',
    });
    expect(repoFileExists(h.repo, 'NpcDropTable/npcdroptable_7777.json')).toBe(true);

    // A second save of the same key is an update on the same path.
    const updated = await request(app)
      .post('/api/npc-drop-tables')
      .send({ object: { TemplateID: 7777, DropTableNames: ['DS-ACAD1-C01-001'] } })
      .expect(200);
    expect(updated.body).toMatchObject({
      outcome: 'updated',
      action: 'update',
      file: 'NpcDropTable/npcdroptable_7777.json',
    });
  });

  it('maps a malformed body to 400 and an unset spiraldb_path to 400', async () => {
    const h = harness();
    const app = appFor(h, ['droptable']);

    const bad = await request(app)
      .post('/api/drop-tables')
      .send({ object: { RollChance: 1 } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/no usable "Name"/);
    expect(repoFileExists(h.repo, 'DropTables/droptable_DS-NEW-001.json')).toBe(false);

    const unconfigured = openDb({ file: MEMORY_DB });
    OPEN_DBS.push(unconfigured);
    writeSettings(unconfigured, { spiraldb_path: '', user_name: USER });
    const unconfiguredApp = express();
    unconfiguredApp.use(
      objectTypeConfig('droptable').urlPath,
      createObjectRouter({ db: unconfigured, config: objectTypeConfig('droptable') }),
    );
    const missingPath = await request(unconfiguredApp).get('/api/drop-tables').expect(400);
    expect(missingPath.body.error).toMatch(/SpiralDB path is not configured/);
  });
});

/* ------------------------------------------------- the live AC3 checks (D17 clone) */

/**
 * The AC3 live check, one per ulong-keyed family: against the **real corpus** in
 * `data/test-spiraldb` (read-only — nothing here writes it, so the D66 shared-clone
 * hazard cannot apply), every `TemplateID` the fork holds must
 *
 * 1. be indexed under its **text** key (the form `entry_status.object_key` stores),
 * 2. resolve to a real file through `index.pathFor` — the D19 lookup the router and
 *    `GET /:key` use,
 * 3. carry that same key as a **number** in JSON, round-tripping through
 *    `shared/ulong.ts`'s one helper in both directions.
 *
 * The clone is checked inside `beforeAll` (never at module/collection scope, D68) and
 * a missing clone is reported loudly and skipped rather than silently passed.
 */
const CLONE_ROOT = path.resolve(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data/test-spiraldb'),
);

const ULONG_FAMILIES = [
  'npcinventory',
  'npcspellinventory',
  'npcdroptable',
  'treasurecardinventory',
] as const;

let cloneReady = false;
let cloneSkipReason = '';

beforeAll(() => {
  if (!fs.existsSync(path.join(CLONE_ROOT, '.git'))) {
    cloneSkipReason = `the D17 clone ${CLONE_ROOT} is absent`;
    console.warn(`[p4-01 AC3] skipping the live corpus checks: ${cloneSkipReason}`);
    return;
  }
  cloneReady = true;
});

describe("the D17 clone's ulong entries (live, one family at a time)", () => {
  it.each(ULONG_FAMILIES)('%s: every real TemplateID resolves by its text key', (fileType) => {
    if (!cloneReady) {
      console.warn(`[p4-01 AC3] skipped: ${cloneSkipReason}`);
      return;
    }
    const config = objectTypeConfig(fileType);
    const index = createSpiraldbIndex(CLONE_ROOT);
    index.rebuild();

    const keys = index.keys(fileType);
    if (config.keyField === null) {
      throw new Error(`${fileType} has no key field`);
    }

    for (const key of keys) {
      const resolved = index.pathFor(fileType, key);
      expect(resolved, `${fileType}/${key} must resolve to a file`).toBeDefined();

      const document = readSpiraldbJson(resolved as string) as Record<string, unknown>;
      const value = document[config.keyField];
      expect(ULong.toKey(value), `${fileType}/${key}: text direction`).toBe(key);
      expect(ULong.toJson(value), `${fileType}/${key}: number direction`).toBe(Number(key));
      expect(typeof value, `${fileType}/${key} must be a number in JSON`).toBe('number');
    }

    // NpcDropTable/ is absent in the fork: an empty set is the measured reality, not
    // a vacuous pass, and the other three families do hold entries.
    if (fileType === 'npcdroptable') {
      expect(fs.existsSync(path.join(CLONE_ROOT, config.directory))).toBe(false);
      expect(keys).toEqual([]);
    } else {
      expect(keys.length, `${config.directory}/ should hold entries`).toBeGreaterThan(0);
    }
  });
});

/* -------------------------------------------- a create for every one of the eight */

/**
 * AC1's POST half, for **all eight** families: each one creates its first file with
 * `fileNameFor`'s convention name — including the singular `droptable_…` prefix D26
 * chooses although every legacy file is `droptables_…` — and the unkeyed registry as
 * the single `globalregistry.json`.
 *
 * The harness is hermetic (a throwaway git repository per family), so this is the
 * breadth proof for the eight POST routes: the four families the HTTP block above
 * does not drive (creature books, spell inventories, treasure cards, zone transfers)
 * cannot silently lack a save path.
 */
describe('POST creates with the convention name, one case per family', () => {
  it.each(OBJECT_TYPES.map((config) => config.fileType))('%s', async (fileType) => {
    const h = harness();
    const runtime = objectRuntimeFor(h.db, h.root);
    const config = objectTypeConfig(fileType);

    const key = config.keyType === 'ulong' ? '424242' : 'P4-01-NEW';
    const document: Record<string, unknown> =
      config.keyField === null
        ? { GlobalRegistryValues: { Christmas: 1 } }
        : { [config.keyField]: config.keyType === 'ulong' ? Number(key) : key };

    const result = await saveObjectEntry({
      db: h.db,
      config,
      index: runtime.index,
      pipeline: runtime.pipeline,
      body: { object: document },
    });

    expect(result.outcome).toBe('created');
    // **Phase transition (story p4-07 / D22)**: the fixture already holds
    // `GlobalRegistry/GlobalRegistryModels_1-A.json`, so the unkeyed family's save is a
    // *consolidation*. The **outcome** stays `created` (the convention file `globalregistry.json`
    // did not exist) while the **action** is `update` — the commit replaced the file that already
    // held this family's entry. Every other family does both as `created`/`create`; the
    // empty-directory create arm for this one is the test right after this.
    expect(result.action).toBe(fileType === 'globalregistry' ? 'update' : 'create');
    const relative =
      config.keyField === null
        ? path.join(config.directory, 'globalregistry.json')
        : path.join(config.directory, createNameFor(config, key));
    expect(result.file).toBe(relative);
    expect(repoFileExists(h.repo, relative)).toBe(true);
    expect(readSpiraldbJson(path.join(h.root, relative))).toEqual(document);
    // The name is the spec convention, never the legacy prefix of the existing files.
    expect(relative).not.toContain('droptables_');
  });

  it('creates globalregistry.json when the directory is empty (nothing to consolidate)', async () => {
    const h = harness();
    const runtime = objectRuntimeFor(h.db, h.root);
    const config = objectTypeConfig('globalregistry');
    // The empty-directory arm: remove every file, so the save is a genuine create.
    fs.rmSync(path.join(h.root, 'GlobalRegistry'), { recursive: true });
    h.repo.git(['add', '--all']);
    h.repo.git(['commit', '-m', 'empty the registry directory']);

    const result = await saveObjectEntry({
      db: h.db,
      config,
      index: runtime.index,
      pipeline: runtime.pipeline,
      body: { object: { GlobalRegistryValues: { Christmas: 1 } } },
    });

    expect(result.outcome).toBe('created');
    expect(result.action).toBe('create');
    expect(result.commit_message).toBe('spiraldb: create global_registry globalregistry');
    expect(result.warnings).toEqual([]);
    expect(fs.readdirSync(path.join(h.root, 'GlobalRegistry'))).toEqual(['globalregistry.json']);
  });
});
