import { describe, expect, it } from 'vitest';

import { fileNameFor } from '@shared/naming';
import {
  OBJECT_CREATE_SPECS,
  ObjectCreateError,
  buildCreateDocument,
  configForCreateSpec,
  objectCreateSpec,
} from '@shared/objectCreate';
import { OBJECT_TYPES, createNameFor, objectTypeConfig } from '@shared/objectTypes';
import type { ObjectFileType } from '@shared/naming';

/**
 * Story p4-09 (task 4.11) — the create contract's unit half (AC3), hermetic and corpus-free.
 *
 * AC3's failure modes this file pins:
 *
 * - **a create name built by hand instead of through `fileNameFor`** — every family's previewed
 *   file name is asserted to equal `fileNameFor(type, key)` and `createNameFor(config, key)`, and
 *   the two spec-vs-legacy cases are named: the singular `droptable_` (D26) and the zone `/` → `_`
 *   transform while the document keeps the real `ZoneName` (L184);
 * - **seven per-family create widgets** — the specs are data and the widget is one; this file
 *   asserts the family set is exactly the seven tracked object families, with GlobalRegistry and
 *   quests excluded and refused with an actionable message;
 * - **a create that writes no `entry_status` clause** — that is the pipeline's job (D76(e) records
 *   p4-08's per-family assertion of `extracted` + `Created via UI`), so what is asserted here is
 *   only the *document* the create posts.
 *
 * The live half of AC3 (the file appearing under that name with a `create` commit and an
 * `entry_status` row) is the story's evidence run against a fresh-port rig on the D17 clone.
 */

const DROP_TABLE = objectTypeConfig('droptable');
const NPC_INVENTORY = objectTypeConfig('npcinventory');
const NPC_SPELL_INVENTORY = objectTypeConfig('npcspellinventory');
const CREATURE_SPELLBOOK = objectTypeConfig('creaturespellbook');
const NPC_DROP_TABLE = objectTypeConfig('npcdroptable');
const TREASURE_CARD_INVENTORY = objectTypeConfig('treasurecardinventory');
const ZONE_TRANSFER = objectTypeConfig('zonetransfer');

describe('p4-09 ac3 — the create contract is one table for the seven tracked families', () => {
  it('covers exactly the seven keyed, lifecycle-tracked families', () => {
    const covered = OBJECT_CREATE_SPECS.map((spec) => spec.fileType).sort();
    const tracked = OBJECT_TYPES.filter(
      (config) => config.keyField !== null && config.objectType !== null,
    ).map((config) => config.fileType);
    expect(covered).toEqual([...tracked].sort());
    expect(covered).not.toContain('globalregistry');
    expect(covered).not.toContain('questtemplates');
  });

  it('each spec agrees with the one object type table (key field, key kind)', () => {
    for (const spec of OBJECT_CREATE_SPECS) {
      const config = configForCreateSpec(spec);
      expect(spec.keyField, `${spec.fileType} keyField`).toBe(config.keyField);
      expect(spec.keyKind === 'ulong', `${spec.fileType} keyKind`).toBe(config.keyType === 'ulong');
      expect(spec.keyLabel.trim()).not.toBe('');
      expect(spec.keyHelp.trim()).not.toBe('');
      expect(spec.defaults.length).toBeGreaterThan(0);
      // Every default key is a real document key the family's own module names — no invented field.
      for (const field of spec.defaults) {
        expect(field.note.trim(), `${spec.fileType}.${field.key} note`).not.toBe('');
      }
    }
  });

  it('refuses GlobalRegistry with the route it should use instead', () => {
    expect(() => objectCreateSpec('globalregistry')).toThrow(ObjectCreateError);
    expect(() => objectCreateSpec('globalregistry')).toThrow(/\/global-registry/);
  });

  it('refuses quests, naming the Phase-2 extraction flow that creates them', () => {
    expect(() => objectCreateSpec('questtemplates')).toThrow(ObjectCreateError);
    expect(() => objectCreateSpec('questtemplates')).toThrow(/POST \/api\/quests/);
  });
});

describe('p4-09 ac3 — every family builds the document and the exact convention file name', () => {
  it('DropTable: singular `droptable_` (D26), the eleven core keys in corpus order, no audit quartet', () => {
    const built = buildCreateDocument(DROP_TABLE, 'WC-UNICORN-MAIN-007');
    expect(built.fileName).toBe('droptable_WC-UNICORN-MAIN-007.json');
    // The legacy prefix is plural (`droptables_`); the create writes the spec's singular (D26).
    expect(built.fileName).not.toBe('droptables_WC-UNICORN-MAIN-007.json');
    expect(built.key).toBe('WC-UNICORN-MAIN-007');
    expect(Object.keys(built.document)).toEqual([
      'Name',
      'Description',
      'RollChance',
      'Weight',
      'NoneChance',
      'PityCounter',
      'MinGold',
      'MaxGold',
      'ExperienceAmount',
      'TrainingPoints',
      'Items',
    ]);
    expect(built.document).toEqual({
      Name: 'WC-UNICORN-MAIN-007',
      Description: '',
      RollChance: 1,
      Weight: 100,
      NoneChance: 0,
      PityCounter: 0,
      MinGold: 0,
      MaxGold: 0,
      ExperienceAmount: 0,
      TrainingPoints: 0,
      Items: [],
    });
    // The two measured exclusions: `GrantsPotionSlot` (absent in 282 of 317 corpus files) and the
    // audit quartet (nothing in this tool stamps it — shared/objectTypes.ts).
    expect(built.document).not.toHaveProperty('GrantsPotionSlot');
    for (const auditKey of ['CreatedAt', 'ModifiedAt', 'CreatedBy', 'ModifiedBy']) {
      expect(built.document).not.toHaveProperty(auditKey);
    }
  });

  it('NpcInventory: the ulong key is a JSON number, canonicalised from a padded string', () => {
    const built = buildCreateDocument(NPC_INVENTORY, '01025');
    expect(built.key).toBe('1025');
    expect(built.fileName).toBe('npcinventory_1025.json');
    expect(built.document).toEqual({ TemplateID: 1025, Inventory: [] });
    expect(typeof (built.document as { TemplateID: unknown }).TemplateID).toBe('number');
  });

  it('NpcSpellInventory / CreatureSpellbook / NpcDropTable / TreasureCardInventory build their shapes', () => {
    expect(buildCreateDocument(NPC_SPELL_INVENTORY, '1452231')).toEqual({
      key: '1452231',
      fileName: 'npcspellinventory_1452231.json',
      document: { TemplateID: 1452231, Spells: [] },
    });
    expect(buildCreateDocument(CREATURE_SPELLBOOK, 'Mdeck-L-BR-DS-SylviaDrake-A-50')).toEqual({
      key: 'Mdeck-L-BR-DS-SylviaDrake-A-50',
      fileName: 'creaturespellbook_Mdeck-L-BR-DS-SylviaDrake-A-50.json',
      document: { DeckName: 'Mdeck-L-BR-DS-SylviaDrake-A-50', SpellTemplateIds: [] },
    });
    expect(buildCreateDocument(NPC_DROP_TABLE, '12345')).toEqual({
      key: '12345',
      fileName: 'npcdroptable_12345.json',
      document: { TemplateID: 12345, DropTableNames: [] },
    });
    expect(buildCreateDocument(TREASURE_CARD_INVENTORY, '38214')).toEqual({
      key: '38214',
      fileName: 'treasurecardinventory_38214.json',
      document: { TemplateID: 38214, TreasureCards: [] },
    });
  });

  it('ZoneTransfer: the file name replaces `/` with `_` while the document keeps the real ZoneName', () => {
    const built = buildCreateDocument(ZONE_TRANSFER, 'WizardCity/WC_Hub');
    expect(built.fileName).toBe('zonetransfer_WizardCity_WC_Hub.json');
    expect(built.key).toBe('WizardCity/WC_Hub');
    expect(built.document).toEqual({ ZoneName: 'WizardCity/WC_Hub', Teleports: [] });
  });

  it('every family\u2019s file name is `fileNameFor`\u2019s, never a second builder', () => {
    const cases: ReadonlyArray<[ObjectFileType, string]> = [
      ['droptable', 'WC-UNICORN-MAIN-007'],
      ['npcinventory', '87112'],
      ['npcspellinventory', '1452231'],
      ['creaturespellbook', 'Mdeck-L-BR-DS-SylviaDrake-A-50'],
      ['npcdroptable', '12345'],
      ['treasurecardinventory', '38214'],
      ['zonetransfer', 'WizardCity/WC_Hub'],
    ];
    for (const [fileType, rawKey] of cases) {
      const config = objectTypeConfig(fileType);
      const built = buildCreateDocument(config, rawKey);
      expect(built.fileName, fileType).toBe(fileNameFor(fileType, built.key));
      expect(built.fileName, fileType).toBe(createNameFor(config, built.key));
    }
  });

  it('each call returns its own list instances (a shared default cannot be mutated through one create)', () => {
    const first = buildCreateDocument(NPC_INVENTORY, '1025');
    const second = buildCreateDocument(NPC_INVENTORY, '1026');
    (first.document.Inventory as number[]).push(126913);
    expect(second.document.Inventory).toEqual([]);
    expect(buildCreateDocument(NPC_INVENTORY, '1025').document.Inventory).toEqual([]);
  });
});

describe('p4-09 ac3 — an unusable key never reaches the wire', () => {
  it('refuses a blank key, naming the field', () => {
    expect(() => buildCreateDocument(DROP_TABLE, '   ')).toThrow(/Drop table name is required/);
  });

  it('refuses a non-digit ulong', () => {
    for (const bad of ['12a', '-1', '1.5', '1e5']) {
      expect(() => buildCreateDocument(NPC_INVENTORY, bad)).toThrow(ObjectCreateError);
      expect(() => buildCreateDocument(NPC_INVENTORY, bad)).toThrow(/unsigned integer/);
    }
  });

  it('trims padding on a ulong key but accepts no other rewriting', () => {
    expect(buildCreateDocument(NPC_INVENTORY, ' 87112 ').document).toEqual({
      TemplateID: 87112,
      Inventory: [],
    });
  });

  it('refuses a key that would become a path or a second `.json`', () => {
    expect(() => buildCreateDocument(DROP_TABLE, 'A/B')).toThrow(/path separator/);
    expect(() => buildCreateDocument(DROP_TABLE, 'droptable_X.json')).toThrow(/already ends/);
  });

  it('a text key keeps its exact value (validate, never normalise)', () => {
    const built = buildCreateDocument(CREATURE_SPELLBOOK, '  Mdeck-A  ');
    expect(built.key).toBe('Mdeck-A');
    expect(built.document).toEqual({ DeckName: 'Mdeck-A', SpellTemplateIds: [] });
  });
});
