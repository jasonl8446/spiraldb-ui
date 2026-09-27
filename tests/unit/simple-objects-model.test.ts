import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import json5 from 'json5';
import { describe, expect, it } from 'vitest';

import { DEFAULT_SPIRALDB_PATH } from '@server/db';
import { applyEdits, getAtPath, serializeDoc, setAtPath, type DocEdit } from '@shared/document';
import {
  CREATURE_SPELLBOOK_CORPUS,
  CREATURE_SPELLBOOK_FIELDS,
  CREATURE_SPELLBOOK_KEY_FIELD,
  CREATURE_SPELLBOOK_LIST_KEY,
  addSpellEntryEdit,
  addToList,
  containsId,
  moveInList,
  NONE_REQUIRED_SPELL,
  NONE_REQUIRED_SPELL_LABEL,
  newSpellEntry,
  NPC_INVENTORY_CORPUS,
  NPC_INVENTORY_FIELDS,
  NPC_INVENTORY_KEY_FIELD,
  NPC_INVENTORY_LIST_KEY,
  NPC_SPELL_ENTRY_FIELDS,
  NPC_SPELL_ENTRY_KEYS,
  NPC_SPELL_INVENTORY_CORPUS,
  NPC_SPELL_INVENTORY_FIELDS,
  NPC_SPELL_INVENTORY_KEY_FIELD,
  NPC_SPELL_INVENTORY_LIST_KEY,
  numberIdFromRaw,
  readNumberList,
  removeAtIndex,
  removeSpellEntryEdit,
  replaceListEdit,
  requiredSpellEdit,
  requiredSpellIsNone,
  spellEntryFieldPath,
  spellEntryLevelEdit,
} from '@shared/simpleObjects';

/**
 * Story p4-03's model + corpus test — plan tasks 4.3–4.5 and the three schemas of
 * docs/spec-domain-reference.md (L27-42 CreatureSpellbook, L121-136 NPCInventory, L138-164
 * NPCSpellInventory + the `NPCSpellEntry` table).
 *
 * Two arms, mirroring `tests/unit/drop-table-model.test.ts`'s shape:
 *
 * 1. **The real corpus sweep** over all **215 + 77 + 134** files, asserting the numbers the
 *    models encode (key sets *and* key order, value counts, the `RequiredSpellID === 0` count of
 *    **239**, `Level` spanning **0**, the empty-array counts **1** and **9**, the
 *    duplicate-carrying file counts **14** / **4**, and the miss counts measured against the
 *    synced tables: **42** item ids and the single spell id `213674121`). It is skipped with a
 *    printed reason when the checkout or the database is absent (CI's state — D40), and the
 *    skip is provable by pointing `SPIRALDB_SIMPLE_OBJECTS_ROOT` at nothing.
 * 2. **Fixtures** for every list primitive and every entry edit builder — the only way an
 *    out-of-range index, a duplicate, an emptied Level box or an unparsable raw id is exercised.
 *
 * The arm that makes the AC's own failure modes checkable is the **no-op edit** sweep: every one
 * of the 426 documents is edited back to itself (the list replaced whole, every entry field
 * re-set) and must serialize byte-identically with the same key set — which is how "a save must
 * not add or remove any other key" and "an empty array stays `[]`" are asserted over real files
 * rather than asserted about the code.
 *
 * **D68**: nothing eager runs at collection time. The guards below are `existsSync` booleans
 * only; the corpus and the database are read inside the tests that need them.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CORPUS_ROOT = process.env.SPIRALDB_SIMPLE_OBJECTS_ROOT ?? DEFAULT_SPIRALDB_PATH;
const DB_PATH = path.join(ROOT, 'data', 'spiraldb-ui.db');

/** The three directories, keyed by the family each sweep measures. */
const FAMILY_DIRS = {
  npcInventory: 'NpcInventory',
  npcSpellInventory: 'NpcSpellInventory',
  creatureSpellbook: 'CreatureSpellbook',
} as const;

// D68: booleans only — no readdir/readFile/DB handle at module scope.
const CORPUS_PRESENT = Object.values(FAMILY_DIRS).every((dir) =>
  existsSync(path.join(CORPUS_ROOT, dir)),
);
const DB_PRESENT = existsSync(DB_PATH);

if (!CORPUS_PRESENT) {
  console.log(
    `[p4-03 corpus] live sweeps skipped — no NpcInventory/NpcSpellInventory/CreatureSpellbook ` +
      `under ${CORPUS_ROOT} (CI has no sibling SpiralDB checkout, D40). The fixtures below carry ` +
      'every primitive.',
  );
}
if (!DB_PRESENT) {
  console.log(
    `[p4-03 corpus] resolution sweeps skipped — no ${DB_PATH}. The id conversion is still pinned ` +
      'by fixtures.',
  );
}

/** One family's files, parsed. Called only inside tests (D68). */
function loadFamily(dir: string): Array<{ file: string; doc: Record<string, unknown> }> {
  const full = path.join(CORPUS_ROOT, dir);
  return readdirSync(full)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => ({
      file,
      doc: json5.parse(readFileSync(path.join(full, file), 'utf8')) as Record<string, unknown>,
    }));
}

/** The document's keys, sorted — the key **set** as a comparable value. */
function sortedKeys(document: Record<string, unknown>): string[] {
  return Object.keys(document).sort();
}

/** One column of a synced table, as a `Set` of numbers. Called only inside tests (D68). */
function syncedIds(table: 'items' | 'spells' | 'npcs', column: 'gid' | 'template_id'): Set<number> {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const rows = db.prepare(`select ${column} as id from ${table}`).all() as Array<{ id: number }>;
    return new Set(rows.map((row) => Number(row.id)));
  } finally {
    db.close();
  }
}

/* ------------------------------------------------------------------- the live sweeps */

describe.runIf(CORPUS_PRESENT)('NpcInventory, the 215 real files (AC1)', () => {
  it('carries exactly TemplateID + Inventory, in that order, in all 215', () => {
    const docs = loadFamily(FAMILY_DIRS.npcInventory);
    expect(docs.length).toBe(NPC_INVENTORY_CORPUS.files);
    for (const { doc } of docs) {
      expect(Object.keys(doc)).toEqual([...NPC_INVENTORY_CORPUS.topLevelKeys]);
      expect(sortedKeys(doc)).toEqual(['Inventory', 'TemplateID']);
      expect(Array.isArray(doc.Inventory)).toBe(true);
      expect(typeof doc.TemplateID).toBe('number');
    }
  });

  it('holds 3,785 values, 3,205 of them distinct, one empty array and no non-numbers', () => {
    const docs = loadFamily(FAMILY_DIRS.npcInventory);
    const values = docs.flatMap(({ doc }) => readNumberList(doc, NPC_INVENTORY_LIST_KEY));
    expect(values.length).toBe(NPC_INVENTORY_CORPUS.inventoryValues);
    expect(new Set(values).size).toBe(NPC_INVENTORY_CORPUS.distinctInventoryIds);
    expect(docs.filter(({ doc }) => (doc.Inventory as unknown[]).length === 0).length).toBe(
      NPC_INVENTORY_CORPUS.emptyArrays,
    );
    // `readNumberList` filters non-numbers, so this is the claim it rests on (measured: 0).
    const raw = docs.flatMap(({ doc }) => doc.Inventory as unknown[]);
    expect(raw.filter((value) => typeof value !== 'number').length).toBe(0);
    expect(new Set(docs.map(({ doc }) => String(doc.TemplateID))).size).toBe(
      NPC_INVENTORY_CORPUS.distinctKeys,
    );
  });

  it('has 14 files carrying a duplicate value — so removal must be index-addressed', () => {
    const docs = loadFamily(FAMILY_DIRS.npcInventory);
    const withDuplicates = docs.filter(({ doc }) => {
      const values = doc.Inventory as number[];
      return new Set(values).size !== values.length;
    });
    expect(withDuplicates.length).toBe(NPC_INVENTORY_CORPUS.filesWithDuplicateIds);
  });
});

describe.runIf(CORPUS_PRESENT)('NpcSpellInventory, the 77 real files (AC2)', () => {
  it('carries exactly TemplateID + Spells, in that order, in all 77', () => {
    const docs = loadFamily(FAMILY_DIRS.npcSpellInventory);
    expect(docs.length).toBe(NPC_SPELL_INVENTORY_CORPUS.files);
    for (const { doc } of docs) {
      expect(Object.keys(doc)).toEqual([...NPC_SPELL_INVENTORY_CORPUS.topLevelKeys]);
      expect(sortedKeys(doc)).toEqual(['Spells', 'TemplateID']);
      expect(Array.isArray(doc.Spells)).toBe(true);
      expect(typeof doc.TemplateID).toBe('number');
    }
  });

  it('holds 560 entries, each exactly {TemplateID, RequiredSpellID, Level} as three numbers', () => {
    const docs = loadFamily(FAMILY_DIRS.npcSpellInventory);
    const entries = docs.flatMap(({ doc }) => doc.Spells as Array<Record<string, unknown>>);
    expect(entries.length).toBe(NPC_SPELL_INVENTORY_CORPUS.spellEntries);
    for (const entry of entries) {
      expect(Object.keys(entry)).toEqual([...NPC_SPELL_ENTRY_KEYS]);
      for (const key of NPC_SPELL_ENTRY_KEYS) {
        expect(typeof entry[key]).toBe('number');
      }
    }
  });

  it('stores RequiredSpellID 0 in 239 entries — the "none" sentinel, not a lookup', () => {
    const docs = loadFamily(FAMILY_DIRS.npcSpellInventory);
    const entries = docs.flatMap(({ doc }) => doc.Spells as Array<Record<string, unknown>>);
    expect(entries.filter((entry) => entry.RequiredSpellID === NONE_REQUIRED_SPELL).length).toBe(
      NPC_SPELL_INVENTORY_CORPUS.entriesWithRequiredSpellZero,
    );
    expect(NONE_REQUIRED_SPELL).toBe(0);
    expect(NONE_REQUIRED_SPELL_LABEL).toBe('none (0)');
    // 0 is "none", so the control must never present it as a selected spell.
    expect(requiredSpellIsNone(0)).toBe(true);
  });

  it('has Level 0 present, spans 0–420, and has one file with a duplicate offered spell', () => {
    const docs = loadFamily(FAMILY_DIRS.npcSpellInventory);
    const entries = docs.flatMap(({ doc }) => doc.Spells as Array<Record<string, unknown>>);
    const levels = entries.map((entry) => entry.Level as number);
    expect(Math.min(...levels)).toBe(NPC_SPELL_INVENTORY_CORPUS.levelMin);
    expect(Math.min(...levels)).toBe(0);
    expect(Math.max(...levels)).toBe(NPC_SPELL_INVENTORY_CORPUS.levelMax);
    expect(new Set(levels).size).toBe(NPC_SPELL_INVENTORY_CORPUS.distinctLevels);
    expect(levels.filter((level) => level === 0).length).toBeGreaterThan(0);
    expect(new Set(docs.map(({ doc }) => String(doc.TemplateID))).size).toBe(
      NPC_SPELL_INVENTORY_CORPUS.distinctKeys,
    );
    const withDuplicates = docs.filter(({ doc }) => {
      const offered = (doc.Spells as Array<Record<string, unknown>>).map(
        (entry) => entry.TemplateID,
      );
      return new Set(offered).size !== offered.length;
    });
    expect(withDuplicates.length).toBe(NPC_SPELL_INVENTORY_CORPUS.filesWithDuplicateEntries);
  });
});

describe.runIf(CORPUS_PRESENT)('CreatureSpellbook, the 134 real files (AC3)', () => {
  it('carries exactly DeckName + SpellTemplateIds, in that order, in all 134', () => {
    const docs = loadFamily(FAMILY_DIRS.creatureSpellbook);
    expect(docs.length).toBe(CREATURE_SPELLBOOK_CORPUS.files);
    for (const { doc } of docs) {
      expect(Object.keys(doc)).toEqual([...CREATURE_SPELLBOOK_CORPUS.topLevelKeys]);
      expect(sortedKeys(doc)).toEqual(['DeckName', 'SpellTemplateIds']);
      expect(Array.isArray(doc.SpellTemplateIds)).toBe(true);
      expect(typeof doc.DeckName).toBe('string');
    }
  });

  it('holds 1,267 values, 369 distinct, nine empty arrays, no non-numbers, 134 unique decks', () => {
    const docs = loadFamily(FAMILY_DIRS.creatureSpellbook);
    const values = docs.flatMap(({ doc }) => readNumberList(doc, CREATURE_SPELLBOOK_LIST_KEY));
    expect(values.length).toBe(CREATURE_SPELLBOOK_CORPUS.spellTemplateIds);
    expect(new Set(values).size).toBe(CREATURE_SPELLBOOK_CORPUS.distinctSpellIds);
    expect(docs.filter(({ doc }) => (doc.SpellTemplateIds as unknown[]).length === 0).length).toBe(
      CREATURE_SPELLBOOK_CORPUS.emptyArrays,
    );
    const raw = docs.flatMap(({ doc }) => doc.SpellTemplateIds as unknown[]);
    expect(raw.filter((value) => typeof value !== 'number').length).toBe(0);
    const names = docs.map(({ doc }) => doc.DeckName as string);
    expect(new Set(names).size).toBe(CREATURE_SPELLBOOK_CORPUS.distinctKeys);
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(
      CREATURE_SPELLBOOK_CORPUS.distinctKeys,
    );
  });

  it('has 4 files carrying a duplicate value — so removal must be index-addressed', () => {
    const docs = loadFamily(FAMILY_DIRS.creatureSpellbook);
    const withDuplicates = docs.filter(({ doc }) => {
      const values = doc.SpellTemplateIds as number[];
      return new Set(values).size !== values.length;
    });
    expect(withDuplicates.length).toBe(CREATURE_SPELLBOOK_CORPUS.filesWithDuplicateIds);
  });
});

describe.runIf(CORPUS_PRESENT)(
  'a no-op edit adds no key and changes no byte (all 426 files)',
  () => {
    it('replaces each list whole with itself, byte for byte, keeping the key set', () => {
      for (const [dir, key] of [
        [FAMILY_DIRS.npcInventory, NPC_INVENTORY_LIST_KEY],
        [FAMILY_DIRS.creatureSpellbook, CREATURE_SPELLBOOK_LIST_KEY],
      ] as const) {
        const docs = loadFamily(dir);
        for (const { file, doc } of docs) {
          const next = applyEdits(doc, [replaceListEdit([key], readNumberList(doc, key))]);
          expect(sortedKeys(next as Record<string, unknown>), file).toEqual(sortedKeys(doc));
          expect(serializeDoc(next), file).toBe(serializeDoc(doc));
        }
      }
    });

    it('re-sets every NpcSpellInventory entry field to its own value, byte for byte', () => {
      const docs = loadFamily(FAMILY_DIRS.npcSpellInventory);
      for (const { file, doc } of docs) {
        const entries = doc[NPC_SPELL_INVENTORY_LIST_KEY] as unknown[];
        for (let index = 0; index < entries.length; index += 1) {
          for (const key of NPC_SPELL_ENTRY_KEYS) {
            const path = spellEntryFieldPath(index, key);
            const next = setAtPath(doc, path, getAtPath(doc, path));
            expect(sortedKeys(next as Record<string, unknown>), `${file}#${index}.${key}`).toEqual(
              sortedKeys(doc),
            );
            expect(serializeDoc(next), `${file}#${index}.${key}`).toBe(serializeDoc(doc));
          }
        }
        expect(serializeDoc(applyEdits(doc, [])), file).toBe(serializeDoc(doc));
      }
    });

    it('keeps an empty array as [] rather than null or a dropped key', () => {
      const emptyInventory = loadFamily(FAMILY_DIRS.npcInventory).filter(
        ({ doc }) => (doc.Inventory as unknown[]).length === 0,
      );
      const emptyBooks = loadFamily(FAMILY_DIRS.creatureSpellbook).filter(
        ({ doc }) => (doc.SpellTemplateIds as unknown[]).length === 0,
      );
      expect(emptyInventory.length).toBe(NPC_INVENTORY_CORPUS.emptyArrays);
      expect(emptyBooks.length).toBe(CREATURE_SPELLBOOK_CORPUS.emptyArrays);

      for (const { doc } of [...emptyInventory, ...emptyBooks]) {
        const key =
          doc.Inventory === undefined ? CREATURE_SPELLBOOK_LIST_KEY : NPC_INVENTORY_LIST_KEY;
        const next = applyEdits(doc, [replaceListEdit([key], readNumberList(doc, key))]) as Record<
          string,
          unknown
        >;
        expect(Object.prototype.hasOwnProperty.call(next, key)).toBe(true);
        expect(next[key]).toEqual([]);
        expect(serializeDoc(next)).toContain(`"${key}": []`);
        expect(serializeDoc(next)).not.toContain('null');
      }
    });
  },
);

describe.runIf(CORPUS_PRESENT && DB_PRESENT)(
  'the misses the corpus really has (D60(c)/D63(c))',
  () => {
    it('leaves 42 of 3,205 NpcInventory item ids unresolved in items.gid', () => {
      const items = syncedIds('items', 'gid');
      const values = new Set(
        loadFamily(FAMILY_DIRS.npcInventory).flatMap(({ doc }) =>
          readNumberList(doc, NPC_INVENTORY_LIST_KEY),
        ),
      );
      const misses = [...values].filter((id) => !items.has(id));
      expect(misses.length).toBe(NPC_INVENTORY_CORPUS.unresolvedIds);
      expect(values.size - misses.length).toBe(NPC_INVENTORY_CORPUS.resolvableIds);
      // None of the misses is a `readNumberList` artefact: each is a real corpus value.
      expect(misses.length).toBeGreaterThan(0);
    });

    it('leaves exactly one CreatureSpellbook spell id unresolved in spells', () => {
      const spells = syncedIds('spells', 'template_id');
      const values = new Set(
        loadFamily(FAMILY_DIRS.creatureSpellbook).flatMap(({ doc }) =>
          readNumberList(doc, CREATURE_SPELLBOOK_LIST_KEY),
        ),
      );
      const misses = [...values].filter((id) => !spells.has(id));
      expect(misses).toEqual([CREATURE_SPELLBOOK_CORPUS.unresolvedIdValue]);
      expect(values.size - misses.length).toBe(CREATURE_SPELLBOOK_CORPUS.resolvableIds);
    });

    it('resolves every spell id a NpcSpellInventory entry references (0 misses of 506)', () => {
      const spells = syncedIds('spells', 'template_id');
      const referenced = new Set<number>();
      for (const { doc } of loadFamily(FAMILY_DIRS.npcSpellInventory)) {
        for (const entry of doc.Spells as Array<Record<string, unknown>>) {
          referenced.add(entry.TemplateID as number);
          if (entry.RequiredSpellID !== NONE_REQUIRED_SPELL) {
            referenced.add(entry.RequiredSpellID as number);
          }
        }
      }
      const misses = [...referenced].filter((id) => !spells.has(id));
      expect(referenced.size).toBe(NPC_SPELL_INVENTORY_CORPUS.distinctSpellIds);
      expect(misses).toEqual([]);
      // The sentinel is deliberately never in the set that gets looked up.
      expect(referenced.has(NONE_REQUIRED_SPELL)).toBe(false);
    });

    it('leaves 4 NpcInventory and 1 NpcSpellInventory key id unresolved in npcs', () => {
      const npcs = syncedIds('npcs', 'template_id');
      const keysOf = (dir: string, field: string) =>
        new Set(loadFamily(dir).map(({ doc }) => doc[field] as number));
      const inventoryKeys = keysOf(FAMILY_DIRS.npcInventory, NPC_INVENTORY_KEY_FIELD);
      const spellInventoryKeys = keysOf(
        FAMILY_DIRS.npcSpellInventory,
        NPC_SPELL_INVENTORY_KEY_FIELD,
      );
      expect([...inventoryKeys].filter((id) => !npcs.has(id)).length).toBe(
        NPC_INVENTORY_CORPUS.unresolvedKeys,
      );
      expect([...spellInventoryKeys].filter((id) => !npcs.has(id)).length).toBe(
        NPC_SPELL_INVENTORY_CORPUS.unresolvedKeys,
      );
    });
  },
);

/* ------------------------------------------------------------------- fixtures */

/** Applies a single edit builder's result, failing loudly when it produced no edit. */
function applyOne(doc: unknown, edit: DocEdit | null): unknown {
  if (edit === null) {
    throw new Error('the builder produced no edit');
  }
  return applyEdits(doc, [edit]);
}

describe('readNumberList and the list primitives', () => {
  it('reads a list in document order, and [] for every "no list here" shape', () => {
    expect(readNumberList({ Inventory: [3, 1, 2] }, 'Inventory')).toEqual([3, 1, 2]);
    expect(readNumberList({ Inventory: [1, 1, 2] }, 'Inventory')).toEqual([1, 1, 2]);
    expect(readNumberList({}, 'Inventory')).toEqual([]);
    expect(readNumberList({ Inventory: null }, 'Inventory')).toEqual([]);
    expect(readNumberList({ Inventory: 7 }, 'Inventory')).toEqual([]);
    expect(readNumberList({ Inventory: { 0: 1 } }, 'Inventory')).toEqual([]);
  });

  it('drops a non-number value (the measured-impossible case) and keeps the rest in order', () => {
    expect(readNumberList({ Inventory: [1, '2', null, 3] }, 'Inventory')).toEqual([1, 3]);
  });

  it('adds an id, and does nothing when it is already there', () => {
    const values = [10, 20];
    expect(addToList(values, 30)).toEqual([10, 20, 30]);
    expect(addToList(values, 10)).toEqual([10, 20]);
    // A no-op still returns a new array, so an "always write the result" caller is safe.
    expect(addToList(values, 10)).not.toBe(values);
    expect(values).toEqual([10, 20]);
    expect(containsId(values, 20)).toBe(true);
    expect(containsId(values, 21)).toBe(false);
  });

  it('removes exactly the clicked index, so a duplicate survives', () => {
    expect(removeAtIndex([1, 1, 2], 0)).toEqual([1, 2]);
    expect(removeAtIndex([1, 1, 2], 1)).toEqual([1, 2]);
    expect(removeAtIndex([1, 1, 2], 2)).toEqual([1, 1]);
    expect(removeAtIndex([1, 2], 9)).toEqual([1, 2]);
    expect(removeAtIndex([1, 2], -1)).toEqual([1, 2]);
    const values = [1, 2];
    expect(removeAtIndex(values, 0)).not.toBe(values);
    expect(values).toEqual([1, 2]);
  });

  it('moves an element to a destination index and no-ops on an impossible move', () => {
    expect(moveInList([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveInList([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
    expect(moveInList([213674121, 5], 0, 1)).toEqual([5, 213674121]);
    expect(moveInList([1, 2, 3], 1, 1)).toEqual([1, 2, 3]);
    expect(moveInList([1, 2, 3], 0, 3)).toEqual([1, 2, 3]);
    expect(moveInList([1, 2, 3], -1, 0)).toEqual([1, 2, 3]);
    const values = [1, 2, 3];
    expect(moveInList(values, 0, 1)).not.toBe(values);
    expect(values).toEqual([1, 2, 3]);
  });

  it('replaces the array whole, never aliasing the rendered list', () => {
    const rendered = [4, 5];
    const edit = replaceListEdit(['SpellTemplateIds'], rendered);
    rendered.push(6);
    expect(edit).toEqual({ op: 'set', path: ['SpellTemplateIds'], value: [4, 5] });

    const doc = { DeckName: 'Mdeck-D-R2', SpellTemplateIds: [1, 2, 3] };
    const next = applyEdits(doc, [replaceListEdit(['SpellTemplateIds'], [3, 1, 2])]) as Record<
      string,
      unknown
    >;
    expect(next.SpellTemplateIds).toEqual([3, 1, 2]);
    expect(Object.keys(next)).toEqual(['DeckName', 'SpellTemplateIds']);
    expect(doc.SpellTemplateIds).toEqual([1, 2, 3]);
  });

  it('converts a dropdown raw id to the JSON number, and refuses what is not one', () => {
    expect(numberIdFromRaw('1001')).toBe(1001);
    expect(numberIdFromRaw(1001)).toBe(1001);
    expect(numberIdFromRaw('01001')).toBe(1001);
    expect(numberIdFromRaw('0')).toBe(0);
    expect(numberIdFromRaw('')).toBeUndefined();
    expect(numberIdFromRaw(null)).toBeUndefined();
    expect(numberIdFromRaw(undefined)).toBeUndefined();
    expect(numberIdFromRaw('abc')).toBeUndefined();
    expect(numberIdFromRaw('-1')).toBeUndefined();
    expect(numberIdFromRaw(1.5)).toBeUndefined();
    expect(numberIdFromRaw('18446744073709551615')).toBeUndefined();
  });
});

describe('the NpcSpellInventory entry builders', () => {
  it('builds a new entry in the corpus key order, from a real picked spell', () => {
    const entry = newSpellEntry(84361);
    expect(Object.keys(entry)).toEqual([...NPC_SPELL_ENTRY_KEYS]);
    expect(entry).toEqual({ TemplateID: 84361, RequiredSpellID: 0, Level: 1 });
  });

  it('appends with one insert when Spells exists, and one set when it does not', () => {
    expect(addSpellEntryEdit(false, 0, 84361)).toEqual({
      op: 'set',
      path: ['Spells'],
      value: [{ TemplateID: 84361, RequiredSpellID: 0, Level: 1 }],
    });
    expect(addSpellEntryEdit(true, 2, 84361)).toEqual({
      op: 'insert',
      path: ['Spells'],
      index: 2,
      value: { TemplateID: 84361, RequiredSpellID: 0, Level: 1 },
    });

    const added = applyEdits(
      { TemplateID: 1452231, Spells: [{ TemplateID: 1, RequiredSpellID: 0, Level: 1 }] },
      [addSpellEntryEdit(true, 1, 2)],
    ) as Record<string, unknown>;
    expect(added.Spells).toEqual([
      { TemplateID: 1, RequiredSpellID: 0, Level: 1 },
      { TemplateID: 2, RequiredSpellID: 0, Level: 1 },
    ]);
    expect(Object.keys(added)).toEqual(['TemplateID', 'Spells']);
  });

  it('removes the row at its index and shifts the later ones up', () => {
    const doc = {
      TemplateID: 1452231,
      Spells: [
        { TemplateID: 1, RequiredSpellID: 0, Level: 1 },
        { TemplateID: 2, RequiredSpellID: 1, Level: 5 },
        { TemplateID: 3, RequiredSpellID: 0, Level: 0 },
      ],
    };
    const next = applyEdits(doc, [removeSpellEntryEdit(1)]) as Record<string, unknown>;
    expect(next.Spells).toEqual([
      { TemplateID: 1, RequiredSpellID: 0, Level: 1 },
      { TemplateID: 3, RequiredSpellID: 0, Level: 0 },
    ]);
    expect(doc.Spells.length).toBe(3);
  });

  it('writes a finite Level verbatim, accepts 0, and writes 0 rather than deleting the key', () => {
    expect(spellEntryLevelEdit(0, '0')).toEqual({
      op: 'set',
      path: ['Spells', 0, 'Level'],
      value: 0,
    });
    expect(spellEntryLevelEdit(0, '')).toEqual({
      op: 'set',
      path: ['Spells', 0, 'Level'],
      value: 0,
    });
    expect(spellEntryLevelEdit(1, '420')).toEqual({
      op: 'set',
      path: ['Spells', 1, 'Level'],
      value: 420,
    });
    // No clamp: an out-of-range value is written and reported, never rewritten (D57).
    expect(spellEntryLevelEdit(0, '-3')).toEqual({
      op: 'set',
      path: ['Spells', 0, 'Level'],
      value: -3,
    });
    expect(spellEntryLevelEdit(0, '1e')).toBeNull();

    const doc = { TemplateID: 1, Spells: [{ TemplateID: 2, RequiredSpellID: 0, Level: 5 }] };
    const cleared = applyOne(doc, spellEntryLevelEdit(0, '')) as Record<string, unknown>;
    expect(Object.keys((cleared.Spells as Array<Record<string, unknown>>)[0])).toEqual([
      ...NPC_SPELL_ENTRY_KEYS,
    ]);
    expect((cleared.Spells as Array<Record<string, unknown>>)[0].Level).toBe(0);
  });

  it('stores 0 for the none (0) option and never builds a lookup for it', () => {
    expect(requiredSpellEdit(0, '')).toEqual({
      op: 'set',
      path: ['Spells', 0, 'RequiredSpellID'],
      value: NONE_REQUIRED_SPELL,
    });
    expect(requiredSpellEdit(0, '84361')).toEqual({
      op: 'set',
      path: ['Spells', 0, 'RequiredSpellID'],
      value: 84361,
    });
    expect(requiredSpellEdit(0, 'abc')).toBeNull();
    expect(requiredSpellIsNone(0)).toBe(true);
    expect(requiredSpellIsNone(undefined)).toBe(true);
    expect(requiredSpellIsNone(null)).toBe(true);
    expect(requiredSpellIsNone(84361)).toBe(false);
    // The value the control hands the dropdown: `null` (nothing) for the sentinel, so
    // `FriendlyNameDropdown` issues no `GET /api/names/spells/0`.
    expect(requiredSpellIsNone(NONE_REQUIRED_SPELL)).toBe(true);
  });
});

describe('the field inventories agree with the schemas', () => {
  it('names exactly the corpus keys of each family', () => {
    expect(NPC_INVENTORY_FIELDS.map((field) => field.key)).toEqual([
      ...NPC_INVENTORY_CORPUS.topLevelKeys,
    ]);
    expect(NPC_SPELL_INVENTORY_FIELDS.map((field) => field.key)).toEqual([
      ...NPC_SPELL_INVENTORY_CORPUS.topLevelKeys,
    ]);
    expect(CREATURE_SPELLBOOK_FIELDS.map((field) => field.key)).toEqual([
      ...CREATURE_SPELLBOOK_CORPUS.topLevelKeys,
    ]);
    expect(NPC_SPELL_ENTRY_FIELDS.map((field) => field.key)).toEqual([...NPC_SPELL_ENTRY_KEYS]);
  });

  it('marks every field required and measured-present in every file', () => {
    for (const field of [
      ...NPC_INVENTORY_FIELDS,
      ...NPC_SPELL_INVENTORY_FIELDS,
      ...CREATURE_SPELLBOOK_FIELDS,
    ]) {
      expect(field.required).toBe(true);
    }
    for (const field of NPC_INVENTORY_FIELDS) {
      expect(field.corpusPresence).toBe(NPC_INVENTORY_CORPUS.files);
    }
    for (const field of NPC_SPELL_INVENTORY_FIELDS) {
      expect(field.corpusPresence).toBe(NPC_SPELL_INVENTORY_CORPUS.files);
    }
    for (const field of NPC_SPELL_ENTRY_FIELDS) {
      expect(field.corpusPresence).toBe(NPC_SPELL_INVENTORY_CORPUS.spellEntries);
    }
    for (const field of CREATURE_SPELLBOOK_FIELDS) {
      expect(field.corpusPresence).toBe(CREATURE_SPELLBOOK_CORPUS.files);
    }
  });

  it('declares the none (0) option only on RequiredSpellID, and the names tables the AC needs', () => {
    const noneFields = NPC_SPELL_ENTRY_FIELDS.filter((field) => field.noneOption !== undefined);
    expect(noneFields.map((field) => field.key)).toEqual(['RequiredSpellID']);
    expect(noneFields[0]?.noneOption).toBe(NONE_REQUIRED_SPELL_LABEL);
    expect(noneFields[0]?.noneValue).toBe(NONE_REQUIRED_SPELL);

    const kindOf = (fields: typeof NPC_INVENTORY_FIELDS, key: string) =>
      fields.find((field) => field.key === key)?.kind;
    expect(kindOf(NPC_INVENTORY_FIELDS, NPC_INVENTORY_KEY_FIELD)).toBe('npc-select');
    expect(kindOf(NPC_INVENTORY_FIELDS, NPC_INVENTORY_LIST_KEY)).toBe('item-multi-select');
    expect(kindOf(NPC_SPELL_INVENTORY_FIELDS, NPC_SPELL_INVENTORY_KEY_FIELD)).toBe('npc-select');
    expect(kindOf(NPC_SPELL_INVENTORY_FIELDS, NPC_SPELL_INVENTORY_LIST_KEY)).toBe(
      'spell-entry-list',
    );
    expect(kindOf(CREATURE_SPELLBOOK_FIELDS, CREATURE_SPELLBOOK_KEY_FIELD)).toBe('text');
    expect(kindOf(CREATURE_SPELLBOOK_FIELDS, CREATURE_SPELLBOOK_LIST_KEY)).toBe('spell-order-list');

    expect(
      NPC_INVENTORY_FIELDS.find((field) => field.key === NPC_INVENTORY_LIST_KEY)?.namesType,
    ).toBe('items');
    expect(
      CREATURE_SPELLBOOK_FIELDS.find((field) => field.key === CREATURE_SPELLBOOK_LIST_KEY)
        ?.namesType,
    ).toBe('spells');
  });
});
