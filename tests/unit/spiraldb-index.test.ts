import fs from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSpiraldbIndex, type SpiraldbIndex } from '@server/services/spiraldbIndex';
import { SCRATCH_PARENT } from '../helpers/temp-git-repo';

/**
 * Story p2-05 acceptance for the content-keyed index (decision D19).
 *
 * The fixture tree is deliberately built from the *measured* legacy filename
 * shapes of the owner's fork (`droptables_…`, `NPCInventories_1025-A.json`,
 * `WizardZoneDatas_10017-A.json`, UUID-named quest metadata) so the property under
 * test is the one that matters: a key resolves to the path the file actually lives
 * at, never to a name derived from the key. The tree lives under
 * `data/__test-scratch__/` — nothing here reads the corpus or the clone (D17).
 */

let root = '';
let index: SpiraldbIndex;

function write(relative: string, content: string): void {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

beforeAll(() => {
  fs.mkdirSync(SCRATCH_PARENT, { recursive: true });
  root = fs.mkdtempSync(path.join(SCRATCH_PARENT, 'index-'));

  // QuestTemplates/ — convention name, an off-convention legacy name, a duplicate
  // key, an unparsable file, a file with no key, a non-JSON file and the skipped
  // `droptables/` subdirectory.
  write(
    'QuestTemplates/questtemplates_DS-ACAD1-C01-001.json',
    '{"m_questName":"DS-ACAD1-C01-001"}',
  );
  write('QuestTemplates/legacy_quest_file.json', '{\n  "m_questName": "DS-LEGACY-001",\n}\n');
  write('QuestTemplates/dup-a.json', '{"m_questName":"DS-DUP-001"}');
  write('QuestTemplates/dup-b.json', '{"m_questName":"DS-DUP-001"}');
  write('QuestTemplates/broken.json', '{ not json at all');
  write('QuestTemplates/no-key.json', '{"m_questLevel":3}');
  write('QuestTemplates/notes.txt', 'not an entry');
  write('QuestTemplates/droptables/droptables_x.json', '{"Name":"SHOULD-NOT-BE-INDEXED"}');

  // The measured legacy filename shapes of the other families.
  write('DropTables/droptables_ds-acad1-c01-001.json', '{"Name":"DS-ACAD1-C01-001"}');
  write('NpcInventory/NPCInventories_1025-A.json', '{"TemplateID":1025}');
  write('NpcSpellInventory/7cd0cf23-3bba-4eb1-b7fb-1b0e9bd1e11f.json', '{"TemplateID":"1452231"}');
  write('CreatureSpellbook/CreatureSpellbooks_129-A.json', '{"DeckName":"Mdeck-D-R2"}');
  write('TreasureCardInventory/NpcTreasureCards_2019-A.json', '{"TemplateID":2019}');
  write('ZoneTransfer/WizardZoneDatas_10017-A.json', '{"ZoneName":"WizardCity/WC_Hub"}');

  // UUID-named metadata paired to a quest by the `Name` field, not the filename (D20).
  write(
    'QuestMetadatas/069f430e-b191-448c-94db-ab03da221c1e.json',
    '{"QuestTemplateId":"questtemplates/DS-ACAD1-C01-001","Name":"DS-ACAD1-C01-001"}',
  );

  // The unkeyed single-file family: present, but nothing to index by key.
  write('GlobalRegistry/GlobalRegistryModels_1-A.json', '{"SomeFlag":1.5}');

  // NpcDropTable/ is deliberately absent — it does not exist in the fork either.

  index = createSpiraldbIndex(root);
});

afterAll(() => {
  if (root !== '') {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('building the index', () => {
  it('reports what the scan saw without ever failing on bad files', () => {
    const stats = index.rebuild();

    expect(stats.scanned).toBe(13);
    expect(stats.indexed).toBe(10);
    expect(stats.skipped).toBe(1); // no-key.json
    expect(stats.failed).toBe(1); // broken.json
    expect(stats.missingDirectories).toEqual(['NpcDropTable']);
    expect(stats.duplicateKeys).toEqual(['QuestTemplates/DS-DUP-001']);
  });

  it('is deterministic: the first file in name order wins a duplicate key', () => {
    index.rebuild();
    expect(index.pathFor('questtemplates', 'DS-DUP-001')).toBe(
      path.join(root, 'QuestTemplates', 'dup-a.json'),
    );
  });

  it('never descends into subdirectories', () => {
    expect(index.pathFor('droptable', 'SHOULD-NOT-BE-INDEXED')).toBeUndefined();
  });
});

describe('resolving keys to the file they actually live in', () => {
  beforeAll(() => {
    index.rebuild();
  });

  it.each([
    ['questtemplates', 'DS-ACAD1-C01-001', 'QuestTemplates/questtemplates_DS-ACAD1-C01-001.json'],
    ['questtemplates', 'DS-LEGACY-001', 'QuestTemplates/legacy_quest_file.json'],
    ['droptable', 'DS-ACAD1-C01-001', 'DropTables/droptables_ds-acad1-c01-001.json'],
    ['npcinventory', '1025', 'NpcInventory/NPCInventories_1025-A.json'],
    ['npcspellinventory', '1452231', 'NpcSpellInventory/7cd0cf23-3bba-4eb1-b7fb-1b0e9bd1e11f.json'],
    ['creaturespellbook', 'Mdeck-D-R2', 'CreatureSpellbook/CreatureSpellbooks_129-A.json'],
    ['treasurecardinventory', '2019', 'TreasureCardInventory/NpcTreasureCards_2019-A.json'],
    ['zonetransfer', 'WizardCity/WC_Hub', 'ZoneTransfer/WizardZoneDatas_10017-A.json'],
    [
      'questmetadata',
      'DS-ACAD1-C01-001',
      'QuestMetadatas/069f430e-b191-448c-94db-ab03da221c1e.json',
    ],
  ] as const)('%s %s → %s', (fileType, key, relative) => {
    expect(index.pathFor(fileType, key)).toBe(path.join(root, relative));
  });

  it('resolves nothing for an unknown key, an unindexed file, or the unkeyed family', () => {
    expect(index.pathFor('questtemplates', 'DS-NOPE')).toBeUndefined();
    expect(index.pathFor('npcdroptable', '12345')).toBeUndefined();
    expect(index.pathFor('globalregistry', 'globalregistry')).toBeUndefined();
  });

  it('lists the keys it knows per family, ascending', () => {
    expect(index.keys('questtemplates')).toEqual([
      'DS-ACAD1-C01-001',
      'DS-DUP-001',
      'DS-LEGACY-001',
    ]);
    expect(index.keys('npcdroptable')).toEqual([]);
  });
});

describe('rebuilding after a save', () => {
  it('picks up a newly written file in one family without a full rebuild', () => {
    const before = index.rebuild();
    expect(index.pathFor('questtemplates', 'DS-NEW-001')).toBeUndefined();

    write('QuestTemplates/questtemplates_DS-NEW-001.json', '{"m_questName":"DS-NEW-001"}');
    const stats = index.rebuildType('questtemplates');

    expect(stats.indexed).toBe(4);
    expect(index.pathFor('questtemplates', 'DS-NEW-001')).toBe(
      path.join(root, 'QuestTemplates', 'questtemplates_DS-NEW-001.json'),
    );
    // A different family is untouched by a per-family rebuild.
    expect(index.pathFor('droptable', 'DS-ACAD1-C01-001')).toBe(
      path.join(root, 'DropTables', 'droptables_ds-acad1-c01-001.json'),
    );
    expect(before.indexed).toBeGreaterThan(0);
  });

  it('treats the unkeyed family as having nothing to index', () => {
    const stats = index.rebuildType('globalregistry');
    expect(stats).toEqual({
      scanned: 0,
      indexed: 0,
      skipped: 0,
      failed: 0,
      missingDirectories: [],
      duplicateKeys: [],
    });
    expect(index.pathFor('globalregistry', 'globalregistry')).toBeUndefined();
  });

  it('records a family whose directory appears later', () => {
    expect(index.rebuildType('npcinventory').missingDirectories).toEqual([]);

    write('NpcDropTable/npcdroptable_12345.json', '{"TemplateID":12345}');
    const stats = index.rebuildType('npcdroptable');

    expect(stats.missingDirectories).toEqual([]);
    expect(index.pathFor('npcdroptable', '12345')).toBe(
      path.join(root, 'NpcDropTable', 'npcdroptable_12345.json'),
    );
  });

  it('normalises the root it was built on', () => {
    expect(index.root).toBe(path.resolve(root));
  });
});
