import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  ITEM_CLASSES,
  MOUNT_CLASSES,
  NPC_CLASSES,
  PET_CLASSES,
  SPELL_CLASSES,
  SPELL_CLASS_SUFFIX,
  classifyTemplateClass,
  extractTemplateRow,
  manifestPathForSource,
  scanTemplateTree,
} from '@server/services/sync/templates';
import { parseTemplateManifest, type TemplateManifest } from '@server/services/sync/manifest';

/**
 * Task 1.4d acceptance (p1-05-ac3): families are discriminated by the JSON
 * `_className` — never by file name or path — the friendly name follows the
 * D33(b) ladder (`m_displayName` → resolved → raw key → `m_objectName`), pets and
 * mounts fold into the flat `npcs` table, and `m_templateID` is reported both as
 * a number (`items.gid`) and as a decimal string (the verification key form).
 *
 * Task 1.4h acceptance (p1-06b): the manifest `m_id` for a row's source path is
 * the id (D35), the embedded `m_templateID` is a reported cross-check, and any
 * `*SpellTemplate` class is a spell.
 *
 * The real fixtures are byte-exact copies from the retained `/tmp/wad-spike`; the
 * manifest is always synthetic (the real one is 17 MB and never committed).
 */

/** A synthetic manifest from `[filename, id]` pairs. */
function manifestOf(entries: Array<[string, number]>): TemplateManifest {
  return parseTemplateManifest({
    _object: { m_serializedTemplates: entries.map(([m_filename, m_id]) => ({ m_filename, m_id })) },
  });
}

const FIXTURES = fileURLToPath(new URL('../../server/test/fixtures/', import.meta.url));
const tempRoots: string[] = [];

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'));
}

function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'spiraldb-templates-'));
  tempRoots.push(root);
  for (const [relative, from] of Object.entries(files)) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(path.join(FIXTURES, from)));
  }
  return root;
}

afterAll(() => {
  for (const dir of tempRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('template family classification (D33(a))', () => {
  it('maps every measured friendly-name class to its family', () => {
    expect(ITEM_CLASSES).toEqual([
      'WizItemTemplate',
      'ItemBundleTemplate',
      'ReagentItemTemplate',
      'PetSnackItemTemplate',
      'ItemTemplate',
    ]);
    for (const name of ITEM_CLASSES) {
      expect(classifyTemplateClass(name)).toBe('item');
    }
    for (const name of SPELL_CLASSES) {
      expect(classifyTemplateClass(name)).toBe('spell');
    }
    for (const name of NPC_CLASSES) {
      expect(classifyTemplateClass(name)).toBe('npc');
    }
    for (const name of PET_CLASSES) {
      expect(classifyTemplateClass(name)).toBe('pet');
    }
    for (const name of MOUNT_CLASSES) {
      expect(classifyTemplateClass(name)).toBe('mount');
    }
  });

  it('returns undefined for families without friendly names — ActorTemplate does not exist', () => {
    expect(classifyTemplateClass('ActorTemplate')).toBeUndefined();
    expect(classifyTemplateClass('WizCinematicActorTemplate')).toBeUndefined();
    expect(classifyTemplateClass('BattlegroundTemplate')).toBeUndefined();
    expect(classifyTemplateClass('')).toBeUndefined();
  });

  it('classifies every *SpellTemplate class as a spell without touching items/NPCs (D35)', () => {
    expect(SPELL_CLASS_SUFFIX).toBe('SpellTemplate');
    for (const name of [
      'SpellTemplate',
      'TieredSpellTemplate',
      'CastleMagicSpellTemplate',
      'CantripsSpellTemplate',
      'GardenSpellTemplate',
      'WhirlyBurlySpellTemplate',
      'FishingSpellTemplate',
      'SomeFutureSpellTemplate',
    ]) {
      expect(classifyTemplateClass(name)).toBe('spell');
    }
    // Exact matches still win, so the object families are unaffected.
    for (const name of ITEM_CLASSES) {
      expect(classifyTemplateClass(name)).toBe('item');
    }
    for (const name of NPC_CLASSES) {
      expect(classifyTemplateClass(name)).toBe('npc');
    }
    for (const name of PET_CLASSES) {
      expect(classifyTemplateClass(name)).toBe('pet');
    }
    for (const name of MOUNT_CLASSES) {
      expect(classifyTemplateClass(name)).toBe('mount');
    }
    expect(classifyTemplateClass('SpellTemplat')).toBeUndefined();
  });
});

describe('extractTemplateRow — name ladder and ids (D33(b))', () => {
  it('resolves m_displayName through the string table (real NPC fixture)', () => {
    const row = extractTemplateRow(fixture('npc_judge_eddie_deser.json'), {
      resolveName: (key) => (key === 'NPCs_01749407' ? 'Judge Eddie' : undefined),
    });
    expect(row).toMatchObject({
      family: 'npc',
      id: 1_608_380,
      idText: '1608380',
      idSource: 'm_templateID',
      name: 'Judge Eddie',
      nameSource: 'resolved',
      rawDisplayName: 'NPCs_01749407',
      objectName: 'WL-StandIn-JudgeEddie',
      className: 'WizGameObjectTemplate',
      fileName: 'ObjectData/WL/WL-StandIn-JudgeEddie.xml',
    });
  });

  it('falls back to the raw key when the string table misses', () => {
    const row = extractTemplateRow(fixture('npc_judge_eddie_deser.json'));
    expect(row?.name).toBe('NPCs_01749407');
    expect(row?.nameSource).toBe('rawKey');
  });

  it('falls back to m_objectName when m_displayName is empty (real item fixture)', () => {
    const row = extractTemplateRow(fixture('item_skullriders_start_deser.json'));
    expect(row).toMatchObject({
      family: 'item',
      id: 107_071,
      name: 'mg_skullriders_start',
      nameSource: 'objectName',
      rawDisplayName: '',
      className: 'WizItemTemplate',
    });
  });

  it('falls back to m_objectName for a mount with an empty m_displayName', () => {
    const row = extractTemplateRow(fixture('mount_object_deser.json'));
    expect(row).toMatchObject({
      family: 'mount',
      id: 3,
      name: 'MountObject',
      nameSource: 'objectName',
    });
  });

  it('keeps a pet in its own family and resolves its WizardMobs key (real pet fixture)', () => {
    const row = extractTemplateRow(fixture('pet_raid_accompany_deser.json'), {
      resolveName: (key) => (key === 'WizardMobs_00004586' ? 'Skeletal Pirate' : undefined),
    });
    expect(row).toMatchObject({
      family: 'pet',
      id: 1_624_035,
      idText: '1624035',
      name: 'Skeletal Pirate',
      nameSource: 'resolved',
    });
  });

  it('derives spells.template_id from the m_displayName index — SpellTemplate has no m_templateID', () => {
    const row = extractTemplateRow(fixture('spell_pixie_deser.json'), {
      resolveName: (key) => (key === 'Spells_00000424' ? 'Pixie' : undefined),
    });
    expect(row).toMatchObject({
      family: 'spell',
      id: 424,
      idText: '424',
      idSource: 'displayNameIndex',
      name: 'Pixie',
      nameSource: 'resolved',
      spellName: 'Pixie',
      className: 'SpellTemplate',
    });
  });

  it('falls back to m_name when a spell has no display name and no m_objectName', () => {
    const row = extractTemplateRow({
      _className: 'TieredSpellTemplate',
      _object: { m_name: 'Plutos Peril - T04 - A', m_displayName: '', m_objectName: null },
    });
    expect(row).toMatchObject({
      family: 'spell',
      name: 'Plutos Peril - T04 - A',
      nameSource: 'spellName',
    });
    expect(row?.id).toBeNull();
    expect(row?.idText).toBeNull();
    expect(row?.idSource).toBe('none');
  });

  it('renders a string m_templateID as the same numeric id and decimal text', () => {
    const row = extractTemplateRow(fixture('template_mount_synthetic_deser.json'));
    expect(row).toMatchObject({
      family: 'mount',
      id: 9_000_001,
      idText: '9000001',
      name: 'SyntheticMount',
      nameSource: 'objectName',
    });
  });

  it('drops unrecognised classes, non-object documents and nameless rows', () => {
    expect(extractTemplateRow(fixture('template_actor_synthetic_deser.json'))).toBeUndefined();
    expect(extractTemplateRow({ _className: 'WizItemTemplate' })).toBeUndefined();
    expect(
      extractTemplateRow({ _className: 'WizItemTemplate', _object: { m_templateID: 1 } }),
    ).toBeUndefined();
    expect(extractTemplateRow(null)).toBeUndefined();
    expect(extractTemplateRow('nope')).toBeUndefined();
  });
});

describe('scanTemplateTree — synthetic tree walk (task 1.4d)', () => {
  it('classifies by _className even when the file name lies, and folds pets/mounts into npcs', async () => {
    const tree = makeTree({
      // A GameObject template deliberately filed under an "itemtemplates" name.
      'ObjectData/itemtemplates_lies_deser.json': 'npc_judge_eddie_deser.json',
      'ObjectData/mg_skullriders_start_deser.json': 'item_skullriders_start_deser.json',
      'ObjectData/Raids/PL_Fortress/Raid-PL-Fortress-Accompany-001_deser.json':
        'pet_raid_accompany_deser.json',
      'ObjectData/MountObject_deser.json': 'mount_object_deser.json',
      'ObjectData/SyntheticActor_deser.json': 'template_actor_synthetic_deser.json',
      'Spells/Pixie_deser.json': 'spell_pixie_deser.json',
      // Not under a scanned root → never read.
      'OtherData/Ignored_deser.json': 'spell_pixie_deser.json',
    });

    const result = await scanTemplateTree(tree, {
      resolveName: (key) =>
        ({ NPCs_01749407: 'Judge Eddie', Spells_00000424: 'Pixie' })[key] ?? undefined,
    });

    expect(result.counts).toMatchObject({
      item: 1,
      spell: 1,
      npc: 1,
      pet: 1,
      mount: 1,
      scannedFiles: 6,
      parseErrors: 0,
      skippedClasses: 1,
      noName: 0,
      noId: 0,
    });
    expect(result.counts.noNameByFamily).toEqual({ item: 0, spell: 0, npc: 0, pet: 0, mount: 0 });
    expect(result.items).toEqual([{ gid: 107_071, name: 'mg_skullriders_start' }]);
    expect(result.spells).toEqual([{ template_id: 424, name: 'Pixie' }]);
    // npcs = NPC + pet + mount, flat (D33(a)) — "so ID lookups never miss".
    // The pet's WizardMobs key is not in the injected string table, so it keeps
    // the raw key (nameSource 'rawKey').
    expect(result.npcs).toEqual([
      { template_id: 3, name: 'MountObject' },
      { template_id: 1_624_035, name: 'WizardMobs_00004586' },
      { template_id: 1_608_380, name: 'Judge Eddie' },
    ]);
    expect(result.parseErrors).toEqual([]);
  });

  it('tolerates a missing tree root and a corrupt file without aborting', async () => {
    const tree = makeTree({
      'ObjectData/good_deser.json': 'item_skullriders_start_deser.json',
    });
    writeFileSync(path.join(tree, 'ObjectData', 'broken_deser.json'), '{ not json');
    const errors: string[] = [];

    const result = await scanTemplateTree(tree, {
      onError: (file) => errors.push(file),
    });

    expect(result.counts.item).toBe(1);
    expect(result.counts.parseErrors).toBe(1);
    expect(result.parseErrors[0].file).toMatch(/broken_deser\.json$/);
    expect(errors).toHaveLength(1);
    // `Spells/` does not exist in this tree; the walk simply finds nothing there.
    expect(result.items).toHaveLength(1);
  });

  it('honours an injected readdir/readFile pair (no disk access)', async () => {
    const docs: Record<string, string> = {
      '/virtual/ObjectData/x_deser.json': JSON.stringify(
        fixture('item_skullriders_start_deser.json'),
      ),
    };
    const result = await scanTemplateTree('/virtual', {
      deps: {
        readdir: async (dir) => {
          if (dir === '/virtual') {
            return [
              { name: 'ObjectData', isDirectory: true },
              { name: 'Spells', isDirectory: false },
            ];
          }
          if (dir === '/virtual/ObjectData') {
            return [{ name: 'x_deser.json', isDirectory: false }];
          }
          throw new Error(`ENOENT: ${dir}`);
        },
        readFile: async (file) => {
          const doc = docs[file];
          if (doc === undefined) {
            throw new Error(`ENOENT: ${file}`);
          }
          return doc;
        },
      },
    });
    expect(result.items).toEqual([{ gid: 107_071, name: 'mg_skullriders_start' }]);
  });
});

describe('manifest-driven ids (task 1.4h / D35)', () => {
  it('maps a source path to the manifest spelling (both separators, leading ./)', () => {
    expect(manifestPathForSource('/tree', '/tree/ObjectData/A_deser.json')).toBe(
      'ObjectData/A.xml',
    );
    expect(manifestPathForSource('/tree', '/tree/Spells/Tiered Spells/Imp_deser.json')).toBe(
      'Spells/Tiered Spells/Imp.xml',
    );
    // A path outside the tree never matches a manifest entry.
    expect(manifestPathForSource('/tree', '/elsewhere/A_deser.json')).toBe('../elsewhere/A.xml');
  });

  it('takes the id from extractTemplateRow options when the manifest supplied one', () => {
    const row = extractTemplateRow(fixture('item_skullriders_start_deser.json'), {
      manifestId: 5_550_000,
    });
    expect(row).toMatchObject({
      id: 5_550_000,
      idText: '5550000',
      idSource: 'manifest',
      manifestId: 5_550_000,
      embeddedId: 107_071,
      name: 'mg_skullriders_start',
    });
  });

  it('keys a spell by the manifest id — the id the corpus references (D35)', () => {
    // `SpellTemplate` carries no m_templateID; the manifest id replaces the
    // string-table index that used to be the key.
    const row = extractTemplateRow(fixture('spell_pixie_deser.json'), {
      resolveName: (key) => (key === 'Spells_00000424' ? 'Pixie' : undefined),
      manifestId: 1143963608,
    });
    expect(row).toMatchObject({
      family: 'spell',
      id: 1143963608,
      idSource: 'manifest',
      manifestId: 1143963608,
      embeddedId: null,
      name: 'Pixie',
      nameSource: 'resolved',
    });
  });

  it('lets the manifest id win and reports the embedded m_templateID disagreement', async () => {
    const tree = makeTree({
      'ObjectData/mg_skullriders_start_deser.json': 'item_skullriders_start_deser.json',
    });
    const manifest = manifestOf([['ObjectData/mg_skullriders_start.xml', 5_550_000]]);

    const result = await scanTemplateTree(tree, { manifest });

    // The manifest wins for the row...
    expect(result.items).toEqual([{ gid: 5_550_000, name: 'mg_skullriders_start' }]);
    expect(result.rows[0]).toMatchObject({
      id: 5_550_000,
      idSource: 'manifest',
      manifestId: 5_550_000,
      embeddedId: 107_071,
    });
    // ...and the disagreement is counted, never silent.
    expect(result.manifest).toMatchObject({
      entries: 1,
      assigned: 1,
      fallback: 0,
      mismatches: 1,
      missing: 0,
    });
    expect(result.manifest.mismatchSamples).toHaveLength(1);
    expect(result.manifest.mismatchSamples[0]).toMatchObject({
      embeddedId: 107_071,
      manifestId: 5_550_000,
    });
    expect(result.manifest.mismatchSamples[0].sourcePath).toMatch(/mg_skullriders_start_deser/);
  });

  it('falls back to the embedded id for a row missing from the manifest and reports it', async () => {
    const tree = makeTree({
      'ObjectData/mg_skullriders_start_deser.json': 'item_skullriders_start_deser.json',
      'Spells/Pixie_deser.json': 'spell_pixie_deser.json',
    });
    // Only the spell is listed; the item row is absent.
    const manifest = manifestOf([['Spells/Pixie.xml', 424]]);

    const result = await scanTemplateTree(tree, { manifest });

    expect(result.items).toEqual([{ gid: 107_071, name: 'mg_skullriders_start' }]);
    expect(result.spells).toEqual([{ template_id: 424, name: 'Spells_00000424' }]);
    const item = result.rows.find((row) => row.family === 'item');
    expect(item).toMatchObject({
      id: 107_071,
      idSource: 'm_templateID',
      manifestId: null,
      embeddedId: 107_071,
    });
    expect(result.manifest).toMatchObject({
      entries: 1,
      assigned: 1,
      fallback: 1,
      mismatches: 0,
      missing: 1,
    });
    expect(result.manifest.missingSamples).toEqual([
      {
        sourcePath: path.join(tree, 'ObjectData', 'mg_skullriders_start_deser.json'),
        manifestPath: 'ObjectData/mg_skullriders_start.xml',
      },
    ]);
  });

  it('distinguishes "missing from the manifest" from "an embedded id was used"', async () => {
    const tree = makeTree({});
    mkdirSync(path.join(tree, 'ObjectData'), { recursive: true });
    // Named, but no m_templateID and no manifest entry → no id at all.
    writeFileSync(
      path.join(tree, 'ObjectData', 'NoId_deser.json'),
      JSON.stringify({
        _className: 'WizItemTemplate',
        _object: { m_displayName: 'Items_00000001', m_templateID: null },
      }),
    );
    // Named, embedded id present, still no manifest entry → the fallback is used.
    writeFileSync(
      path.join(tree, 'ObjectData', 'Falls_back_deser.json'),
      JSON.stringify({
        _className: 'WizItemTemplate',
        _object: { m_displayName: 'Items_00000002', m_templateID: 42 },
      }),
    );

    const result = await scanTemplateTree(tree);

    expect(result.counts.noId).toBe(1);
    expect(result.manifest).toMatchObject({ missing: 2, fallback: 1, assigned: 0 });
    expect(result.items).toEqual([{ gid: 42, name: 'Items_00000002' }]);
    expect(result.rows.find((row) => row.id === null)?.name).toBe('Items_00000001');
  });

  it('reports every row as missing when no manifest is supplied at all', async () => {
    const tree = makeTree({
      'ObjectData/mg_skullriders_start_deser.json': 'item_skullriders_start_deser.json',
      'Spells/Pixie_deser.json': 'spell_pixie_deser.json',
    });

    const result = await scanTemplateTree(tree);

    expect(result.manifest).toMatchObject({
      entries: 0,
      assigned: 0,
      fallback: 2,
      mismatches: 0,
      missing: 2,
    });
    // Legacy behaviour is preserved for the fallback: the spell's id is the
    // m_displayName string-table index.
    expect(result.spells).toEqual([{ template_id: 424, name: 'Spells_00000424' }]);
    expect(result.rows.find((row) => row.family === 'spell')?.idSource).toBe('displayNameIndex');
  });

  it('scans every *SpellTemplate class as a spell and keys it by the manifest id', async () => {
    const castle = {
      _className: 'CastleMagicSpellTemplate',
      _object: { m_name: 'Castle Bolt', m_displayName: 'Spells_00000999', m_objectName: null },
    };
    const tree = makeTree({
      'Spells/Castle Bolt_deser.json': 'spell_pixie_deser.json',
    });
    writeFileSync(path.join(tree, 'Spells', 'Castle Bolt_deser.json'), JSON.stringify(castle));
    const manifest = manifestOf([['Spells/Castle Bolt.xml', 7_777_777]]);

    const result = await scanTemplateTree(tree, {
      manifest,
      resolveName: (key) => (key === 'Spells_00000999' ? 'Castle Bolt' : undefined),
    });

    expect(result.counts.spell).toBe(1);
    expect(result.counts.item).toBe(0);
    expect(result.counts.npc).toBe(0);
    expect(result.spells).toEqual([{ template_id: 7_777_777, name: 'Castle Bolt' }]);
    expect(result.manifest.mismatches).toBe(0);
  });
});
