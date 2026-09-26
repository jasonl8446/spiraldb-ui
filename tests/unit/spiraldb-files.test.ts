import fs from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fileNameFor, OBJECT_FILE_SPECS, UNKEYED_FILE_NAME } from '@shared/naming';
import { IMPORT_TYPE_SPECS } from '@server/services/import';
import {
  buildQuestMetadata,
  collectionSpec,
  createTargetPath,
  EXTRACTED_QUEST_METADATA_DESCRIPTION,
  mergePreservingAbsent,
  normalizeKeyValue,
  objectKeyFromData,
  QUEST_METADATA_KEYS,
  questTemplateIdFor,
  readSpiraldbJson,
  refreshQuestMetadata,
  resolveObjectKey,
  SPIRALDB_COLLECTIONS,
  SpiraldbFileError,
  stringifySpiraldbJson,
  writeSpiraldbJson,
} from '@server/services/spiraldbFiles';
import { normalizeImportKey } from '@server/services/import';
import { SCRATCH_PARENT } from '../helpers/temp-git-repo';

/**
 * Story p2-05 acceptance for the SpiralDB file layer: the collection table against
 * the naming table and the import scan, key normalisation, JSON5-tolerant reads,
 * clean-JSON writes, convention paths (including the zone slash case), the
 * null/absent-preserving merge behind D45(1), and the exact quest-metadata shape
 * of docs/spec-data-model.md L191-204.
 *
 * Everything runs in a throwaway directory under `data/__test-scratch__/`; no
 * corpus file, no clone, no owner repository (decision D17).
 */

let root = '';

beforeAll(() => {
  fs.mkdirSync(SCRATCH_PARENT, { recursive: true });
  root = fs.mkdtempSync(path.join(SCRATCH_PARENT, 'files-'));
});

afterAll(() => {
  if (root !== '') {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function write(relative: string, content: string): string {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

describe('the collection table', () => {
  it('covers every naming-table row with a matching key source', () => {
    const namingTypes = OBJECT_FILE_SPECS.map((spec) => spec.type).sort();
    const collectionTypes = SPIRALDB_COLLECTIONS.map((spec) => spec.fileType).sort();

    expect(collectionTypes).toEqual(namingTypes);

    for (const collection of SPIRALDB_COLLECTIONS) {
      const naming = OBJECT_FILE_SPECS.find((spec) => spec.type === collection.fileType);
      expect(naming).toBeDefined();

      if (collection.keyField === null) {
        // The single unkeyed file: the naming table documents "dictionary key",
        // which is not a field name (docs/plan-overview.md Q1).
        expect(collection.fileType).toBe('globalregistry');
        expect(naming?.keyed).toBe(false);
        continue;
      }

      // The naming table's Key Source column is a field name for eight rows and the
      // descriptive wording "quest name" for quest metadata, whose file stores it in
      // `Name` (docs/spec-data-model.md L198).
      const expectedSource =
        collection.fileType === 'questmetadata' ? 'quest name' : collection.keyField;
      expect(naming?.keySource).toBe(expectedSource);
      expect(naming?.keyed).toBe(true);
    }
  });

  it('agrees with the first-startup import scan on every scanned family', () => {
    const scanned = SPIRALDB_COLLECTIONS.filter((spec) => spec.objectType !== null);
    expect(scanned).toHaveLength(8);

    for (const spec of scanned) {
      const imported = IMPORT_TYPE_SPECS.find((row) => row.objectType === spec.objectType);
      expect(imported).toBeDefined();
      expect(imported?.directory).toBe(spec.directory);
      expect(imported?.keyField).toBe(spec.keyField);
      expect(spec.saveable).toBe(true);
    }
  });

  it('marks the quest-metadata family as a companion and GlobalRegistry as unkeyed', () => {
    const metadata = collectionSpec('questmetadata');
    expect(metadata).toMatchObject({
      directory: 'QuestMetadatas',
      keyField: 'Name',
      objectType: null,
      saveable: false,
    });

    const globalRegistry = collectionSpec('globalregistry');
    expect(globalRegistry).toMatchObject({
      directory: 'GlobalRegistry',
      keyField: null,
      objectType: null,
      commitType: 'global_registry',
      saveable: true,
    });
  });

  it('throws an actionable error for an unknown family', () => {
    expect(() => collectionSpec('nope' as never)).toThrow(/Unknown SpiralDB collection "nope"/);
  });
});

describe('key normalisation', () => {
  const CASES: unknown[] = [
    'DS-ACAD1-C01-001',
    '',
    '   ',
    87112,
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    null,
    undefined,
    true,
    {},
    [],
    ['a'],
  ];

  it('agrees with the first-startup import normaliser on every input', () => {
    for (const value of CASES) {
      expect(normalizeKeyValue(value)).toBe(normalizeImportKey(value));
    }
  });

  it('stringifies numeric TemplateIDs and keeps an empty string keyless', () => {
    expect(normalizeKeyValue(87112)).toBe('87112');
    expect(normalizeKeyValue('1025')).toBe('1025');
    expect(normalizeKeyValue('')).toBeUndefined();
    expect(normalizeKeyValue(null)).toBeUndefined();
    expect(normalizeKeyValue(Number.NaN)).toBeUndefined();
  });

  it('reads the key from the family field and refuses an object without one', () => {
    expect(objectKeyFromData({ Name: 'WC-UNICORN-MAIN-007' }, 'Name')).toBe('WC-UNICORN-MAIN-007');
    expect(objectKeyFromData({ TemplateID: 38214 }, 'TemplateID')).toBe('38214');
    expect(objectKeyFromData({ Other: 1 }, 'Name')).toBeUndefined();
    expect(objectKeyFromData('not an object', 'Name')).toBeUndefined();

    const quests = collectionSpec('questtemplates');
    expect(resolveObjectKey(quests, { m_questName: 'DS-ACAD1-C01-001' })).toBe('DS-ACAD1-C01-001');
    // An explicit key wins over the body.
    expect(resolveObjectKey(quests, { m_questName: 'ignored' }, 'DS-EXPLICIT-001')).toBe(
      'DS-EXPLICIT-001',
    );
    expect(() => resolveObjectKey(quests, { m_questLevel: 3 })).toThrow(SpiraldbFileError);
    expect(() => resolveObjectKey(quests, { m_questLevel: 3 })).toThrow(
      /no usable "m_questName" value/,
    );
    expect(() => resolveObjectKey(quests, { m_questName: 'x' }, '')).toThrow(
      /supplied key is empty/,
    );
  });

  it('uses the family name as the object key for the unkeyed GlobalRegistry', () => {
    expect(resolveObjectKey(collectionSpec('globalregistry'), {})).toBe('globalregistry');
  });
});

describe('reading and writing SpiralDB files', () => {
  it('parses a legacy file with trailing commas', () => {
    const file = write(
      'QuestTemplates/trailing.json',
      '{\n  "m_questName": "DS-TRAILING-001",\n  "m_goals": [\n    "a",\n  ],\n}\n',
    );

    expect(readSpiraldbJson(file)).toEqual({ m_questName: 'DS-TRAILING-001', m_goals: ['a'] });
  });

  it('names the file in the error for an unparsable document', () => {
    const file = write('QuestTemplates/broken.json', '{ this is not json');

    expect(() => readSpiraldbJson(file)).toThrow(SpiraldbFileError);
    expect(() => readSpiraldbJson(file)).toThrow(
      new RegExp(`Could not parse SpiralDB file ${file}`),
    );
    expect(() => readSpiraldbJson(path.join(root, 'missing.json'))).toThrow(/Could not read/);
  });

  it('writes clean JSON with a trailing newline and creates missing directories', () => {
    const file = path.join(root, 'NpcDropTable', 'npcdroptable_12345.json');

    writeSpiraldbJson(file, { TemplateID: 12345, DropTableNames: ['a'] });

    const text = fs.readFileSync(file, 'utf8');
    expect(text).toBe('{\n  "TemplateID": 12345,\n  "DropTableNames": [\n    "a"\n  ]\n}\n');
    expect(JSON.parse(text)).toEqual({ TemplateID: 12345, DropTableNames: ['a'] });
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).not.toMatch(/,\s*[}\]]/);
  });

  it('round-trips through the stringifier and overwrites in place', () => {
    const data = { Name: 'WC-UNICORN-MAIN-007', Nested: { 'a/b': null, list: [1, 2] } };
    expect(stringifySpiraldbJson(data)).toBe(`${JSON.stringify(data, null, 2)}\n`);

    const file = write('DropTables/droptable.json', '{"Name":"OLD"}');
    writeSpiraldbJson(file, data);
    expect(readSpiraldbJson(file)).toEqual(data);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(data);
  });

  it('writes a file that fails the JSON5-tolerant parse if handed a cyclic object', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => writeSpiraldbJson(path.join(root, 'cyclic.json'), cyclic)).toThrow(
      /Could not write SpiralDB file/,
    );
  });
});

describe('convention paths for new files', () => {
  it.each([
    ['questtemplates', 'DS-ACAD1-C01-001', 'QuestTemplates/questtemplates_DS-ACAD1-C01-001.json'],
    ['droptable', 'WC-UNICORN-MAIN-007', 'DropTables/droptable_WC-UNICORN-MAIN-007.json'],
    ['npcinventory', '87112', 'NpcInventory/npcinventory_87112.json'],
    ['npcspellinventory', '1452231', 'NpcSpellInventory/npcspellinventory_1452231.json'],
    [
      'creaturespellbook',
      'Mdeck-L-BR-DS-SylviaDrake-A-50',
      'CreatureSpellbook/creaturespellbook_Mdeck-L-BR-DS-SylviaDrake-A-50.json',
    ],
    ['npcdroptable', '12345', 'NpcDropTable/npcdroptable_12345.json'],
    ['treasurecardinventory', '38214', 'TreasureCardInventory/treasurecardinventory_38214.json'],
    // The zone transform: `/` in a ZoneName is written as `_`.
    ['zonetransfer', 'WizardCity/WC_Hub', 'ZoneTransfer/zonetransfer_WizardCity_WC_Hub.json'],
    ['questmetadata', 'DS-ACAD1-C01-001', 'QuestMetadatas/questmetadata_DS-ACAD1-C01-001.json'],
  ] as const)('%s → %s', (fileType, key, expected) => {
    expect(createTargetPath(root, collectionSpec(fileType), key)).toBe(path.join(root, expected));
    expect(fileNameFor(fileType, key)).toBe(path.basename(expected));
  });

  it('uses the single unkeyed file for GlobalRegistry', () => {
    const spec = collectionSpec('globalregistry');
    expect(createTargetPath(root, spec, 'globalregistry')).toBe(
      path.join(root, 'GlobalRegistry', UNKEYED_FILE_NAME),
    );
    expect(UNKEYED_FILE_NAME).toBe('globalregistry.json');
  });
});

describe('mergePreservingAbsent (D45(1))', () => {
  /** The shape the CLI's `NullValueHandling.Ignore` produces: the same object, nulls dropped. */
  function withoutNulls(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map(withoutNulls);
    }
    if (typeof value === 'object' && value !== null) {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value)) {
        if (entry !== null) {
          out[key] = withoutNulls(entry);
        }
      }
      return out;
    }
    return value;
  }

  const CORPUS_SHAPED = {
    m_questName: 'DS-NULLY-001',
    m_questLevel: 5,
    m_questInfo: null,
    m_goals: [
      {
        $type: 'Imcodec.ObjectProperty.TypeCache.GoalCompilation, Imcodec.ObjectProperty',
        m_goalName: '1_Start',
        m_goalType: 'GOAL_TYPE_WAYPOINT',
        m_goalUnderway: null,
        m_hyperlink: null,
        m_clientTags: [],
        m_targets: [{ m_targetName: 'WC_Hub', m_zoneName: null }],
      },
    ],
    m_dialogList: { $type: 'Imcodec.ObjectProperty.TypeCache.ActorDialogList', m_dialogs: [] },
  };

  it('reproduces the existing document byte-for-byte when nothing changed', () => {
    const existing = JSON.parse(JSON.stringify(CORPUS_SHAPED)) as unknown;
    const incoming = withoutNulls(CORPUS_SHAPED);

    // The nulls really are gone from the incoming object.
    expect(JSON.stringify(incoming)).not.toContain('m_questInfo');
    expect(JSON.stringify(incoming)).not.toContain('m_goalUnderway');
    expect(JSON.stringify(incoming)).not.toContain('m_zoneName');

    const merged = mergePreservingAbsent(existing, incoming);
    expect(stringifySpiraldbJson(merged)).toBe(stringifySpiraldbJson(existing));
  });

  it('keeps existing key order and appends incoming-only keys last', () => {
    const merged = mergePreservingAbsent({ b: 1, a: 2 }, { a: 3, c: 4 }) as Record<string, unknown>;
    expect(Object.keys(merged)).toEqual(['b', 'a', 'c']);
    expect(merged).toEqual({ b: 1, a: 3, c: 4 });
  });

  it('lets an explicit null in the incoming object clear a value', () => {
    expect(mergePreservingAbsent({ a: 'x', b: 1 }, { a: null })).toEqual({ a: null, b: 1 });
  });

  it('takes the incoming array length while merging elements index-wise', () => {
    const existing = { list: [{ a: 1, keep: null }, { b: 2 }, { c: 3 }] };
    const incoming = { list: [{ a: 9 }, { b: 8 }] };

    expect(mergePreservingAbsent(existing, incoming)).toEqual({
      list: [{ a: 9, keep: null }, { b: 8 }],
    });
  });

  it('takes the incoming value when the shapes differ', () => {
    expect(mergePreservingAbsent({ a: { x: 1 } }, { a: [1, 2] })).toEqual({ a: [1, 2] });
    expect(mergePreservingAbsent([1], { a: 1 })).toEqual({ a: 1 });
    expect(mergePreservingAbsent(null, { a: 1 })).toEqual({ a: 1 });
    expect(mergePreservingAbsent({ a: 1 }, 'scalar')).toBe('scalar');
  });
});

describe('quest metadata (docs/spec-data-model.md L191-204)', () => {
  const INPUT = { now: '2026-09-26T10:30:00.000Z', user: 'p2-05 tester' };

  it('builds exactly the seven spec keys, in spec order', () => {
    const metadata = buildQuestMetadata('DS-ACAD1-C01-001', INPUT);

    expect(Object.keys(metadata)).toEqual([...QUEST_METADATA_KEYS]);
    expect(metadata).toEqual({
      QuestTemplateId: 'questtemplates/DS-ACAD1-C01-001',
      Name: 'DS-ACAD1-C01-001',
      Description: EXTRACTED_QUEST_METADATA_DESCRIPTION,
      CreatedAt: INPUT.now,
      ModifiedAt: INPUT.now,
      CreatedBy: INPUT.user,
      ModifiedBy: INPUT.user,
    });
    expect(metadata.Description).toBe('Quest extracted from packet capture.');
    expect(questTemplateIdFor('DS-ACAD1-C01-001')).toBe('questtemplates/DS-ACAD1-C01-001');
  });

  it('accepts a caller-supplied description for non-extraction creates', () => {
    expect(
      buildQuestMetadata('X', { ...INPUT, description: 'Quest created in SpiralDB UI.' }),
    ).toMatchObject({ Description: 'Quest created in SpiralDB UI.' });
  });

  it('refreshes ModifiedAt/ModifiedBy in place and preserves everything else', () => {
    const existing = {
      QuestTemplateId: 'questtemplates/WC-UNICORN-MAIN-004',
      Name: 'WC-UNICORN-MAIN-004',
      Description: 'Quest imported from packet capture on 2025-10-17 20:37:23',
      CreatedAt: '2025-10-18T00:37:23.8805776Z',
      ModifiedAt: '2026-04-03T07:00:36.2653256Z',
      CreatedBy: 'jay',
      ModifiedBy: 'makima',
      ExtraLegacyField: 'kept',
    };

    const refreshed = refreshQuestMetadata(existing, INPUT);

    expect(refreshed).toEqual({
      ...existing,
      ModifiedAt: INPUT.now,
      ModifiedBy: INPUT.user,
    });
    expect(Object.keys(refreshed)).toEqual([...Object.keys(existing)]);
  });

  it('refuses to refresh a file that is not a JSON object', () => {
    expect(() => refreshQuestMetadata([1, 2, 3], INPUT)).toThrow(SpiraldbFileError);
    expect(() => refreshQuestMetadata(null, INPUT)).toThrow(/not a JSON object/);
  });
});
