import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import json5 from 'json5';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';

import { DEFAULT_SPIRALDB_PATH, type Db } from '@server/db';
import { applyEdits, loadDoc, serializeDoc, type DocEdit } from '@shared/document';
import {
  addRegistryRowEdit,
  consolidationPlan,
  fileNamesForRegistryKeys,
  GLOBAL_REGISTRY_CORPUS,
  GLOBAL_REGISTRY_FILE_NAME,
  GLOBAL_REGISTRY_WRAPPER_KEY,
  globalRegistryFileOrder,
  mergeGlobalRegistry,
  NEW_REGISTRY_VALUE,
  readRegistryRows,
  registryHasWrapper,
  registryValueEdit,
  registryValueIsNumber,
  registryValuePath,
  registryWrapper,
  registryWrapperPath,
  removeRegistryRowEdit,
  renameRegistryRowEdits,
  type GlobalRegistryFile,
} from '@shared/simpleObjects';

/**
 * Story p4-07's model + merge test — plan task 4.9, `GlobalRegistry/`,
 * docs/spec-domain-reference.md **L102-119** (the schema and the merge rule), **L711-712**,
 * docs/spec-data-model.md **L187**, and `docs/plan-overview.md` **D22**, **D5**, **D57**,
 * **Q1**, **D74(c)**.
 *
 * Four things are pinned:
 *
 * 1. **The live one-file sweep.** Every number in {@link GLOBAL_REGISTRY_CORPUS} is
 *    **re-measured** against the real fork: one file, exactly the one wrapper key, 23 values,
 *    23 distinct mixed-case keys, all integers, byte-identical after a no-op load → serialize.
 *    The merge is vacuous here (one file), which is why (2) exists.
 * 2. **The merge rule by fixture** — the only way to prove "later files win" and
 *    case-sensitivity, because the live corpus holds one file. The merge takes an **injected
 *    order** (the array's), so these tests never depend on `readdir`; a disjoint-keys arm, an
 *    empty `{}` file, a document that is not an object and a non-object wrapper pin what is
 *    tolerated (and `skipped[]` says so).
 * 3. **The row builders** — add/edit/remove/rename through `shared/document.ts`'s primitives,
 *    with the two value rules: a stored integer stays an integer (`1`, never `1.0`), a typed
 *    float is accepted verbatim, and an untouched value is never rewritten.
 * 4. **The consolidation plan** is computed from a passed directory listing (never assumed), and
 *    a **no-op edit leaves the real document byte-identical with an identical key set** — the
 *    positive control for AC1's "merged view" being a faithful view.
 *
 * **D68**: nothing eager runs at collection time — the corpus guard is an `existsSync` boolean
 * and every read happens inside the test that needs it. The skip is provable (and is proven in
 * the story's evidence) by running this file with `SPIRALDB_SIMPLE_OBJECTS_ROOT` pointed at a
 * path with no `GlobalRegistry/`.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CORPUS_ROOT = process.env.SPIRALDB_SIMPLE_OBJECTS_ROOT ?? DEFAULT_SPIRALDB_PATH;
const DB_PATH = path.join(ROOT, 'data', 'spiraldb-ui.db');

const CORPUS_DIR = path.join(CORPUS_ROOT, 'GlobalRegistry');

// D68: a boolean only — no readdir/readFile/DB handle at module scope.
const FORK_PRESENT = fs.existsSync(CORPUS_DIR);
const DB_PRESENT = fs.existsSync(DB_PATH);

if (!FORK_PRESENT) {
  console.log(
    `[p4-07 corpus] the live sweep was skipped — no GlobalRegistry/ under ${CORPUS_ROOT} (CI has ` +
      'no sibling SpiralDB checkout, D40). The fixture batteries below carry every primitive.',
  );
}

const OPEN_DBS: Db[] = [];

afterAll(async () => {
  for (const db of OPEN_DBS) {
    db.close();
  }
});

/* -------------------------------------------------------------------- the corpus */

interface CorpusFile {
  readonly name: string;
  readonly raw: string;
  readonly document: Record<string, unknown>;
}

/** Reads every `GlobalRegistry/*.json` (json5, the tests' own lenient parser). */
function readCorpus(): CorpusFile[] {
  const names = fs
    .readdirSync(CORPUS_DIR)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .sort();
  return names.map((name) => {
    const raw = fs.readFileSync(path.join(CORPUS_DIR, name), 'utf8');
    return { name, raw, document: json5.parse(raw) as Record<string, unknown> };
  });
}

describe.skipIf(!FORK_PRESENT)(
  `AC1 — the live corpus (${GLOBAL_REGISTRY_CORPUS.files} file)`,
  () => {
    it('holds exactly one file, the one legacy name, the one wrapper key and 23 integer values', () => {
      const files = readCorpus();
      expect(files.length).toBe(GLOBAL_REGISTRY_CORPUS.files);
      expect(files.map((file) => file.name)).toEqual([GLOBAL_REGISTRY_CORPUS.fileName]);

      for (const file of files) {
        expect(Object.keys(file.document)).toEqual([GLOBAL_REGISTRY_WRAPPER_KEY]);
        expect(Object.keys(file.document)).toHaveLength(GLOBAL_REGISTRY_CORPUS.topLevelKeys);
        const wrapper = registryWrapper(file.document);
        expect(wrapper).toBeDefined();
        const keys = Object.keys(wrapper ?? {});
        expect(keys).toHaveLength(GLOBAL_REGISTRY_CORPUS.values);
        expect(new Set(keys).size).toBe(GLOBAL_REGISTRY_CORPUS.distinctKeys);
        // Case-SENSITIVE keys (L102-119): the mixed-case sample is in the file, and a lowercased
        // copy is a different key set — the trap the merge fixtures below pin.
        expect(keys).toContain('Localization');
        expect(keys).toContain('KM-Teaser');
        expect(keys).toContain('ME_Sinbad');
        expect(keys.map((key) => key.toLowerCase())).not.toEqual(keys);

        const values = keys.map((key) => (wrapper ?? {})[key]);
        expect(values.filter(registryValueIsNumber)).toHaveLength(
          GLOBAL_REGISTRY_CORPUS.integerValues,
        );
        expect(values.filter((value) => !registryValueIsNumber(value))).toHaveLength(
          GLOBAL_REGISTRY_CORPUS.nonNumberValues,
        );
        expect(values.every((value) => Number.isInteger(value))).toBe(true);

        // Byte-fidelity (D5/D57): the real file is exactly `serializeDoc`'s output, so a no-op
        // edit cannot produce a diff — and an integer is written as `1`, never `1.0`.
        expect(serializeDoc(loadDoc(file.document))).toBe(file.raw);
        expect(file.raw).toContain('"Localization": 1');
        expect(file.raw).not.toContain('1.0');
        // …and the merge of the single file is that same document, key for key.
        const merged = mergeGlobalRegistry(
          globalRegistryFileOrder(files.map((f) => f.name)).map((name) => ({
            name,
            document: files.find((f) => f.name === name)?.document,
          })),
        );
        expect(merged.values).toEqual(wrapper);
        expect(merged.keys).toEqual(keys);
      }
    });

    it('has no entry_status row for the type’s real object_type, global_registry (D74(c), Q1)', () => {
      if (!DB_PRESENT) {
        console.log('[p4-07 rows] skipped — no local database to count.');
        return;
      }
      // `global_registry` is the real `object_type` (the D4 mapping), never a guess.
      const db = new Database(DB_PATH, { readonly: true });
      OPEN_DBS.push(db as unknown as Db);
      const row = db
        .prepare<[string], { count: number }>(
          'SELECT COUNT(*) AS count FROM entry_status WHERE object_type = ?',
        )
        .get('global_registry');
      expect(row?.count).toBe(GLOBAL_REGISTRY_CORPUS.entryStatusRows);
    });
  },
);

/* ------------------------------------------------------------------ the merge */

function file(name: string, document: unknown): GlobalRegistryFile {
  return { name, document };
}

describe('AC1 — the merge rule (fixtures: the live corpus has one file)', () => {
  it('merges case-sensitively and the later file wins', () => {
    const merged = mergeGlobalRegistry([
      file('a.json', { GlobalRegistryValues: { Localization: 1, Christmas: 0 } }),
      file('b.json', { GlobalRegistryValues: { Localization: 9 } }),
    ]);

    // The key that appears in both takes the LAST file's value…
    expect(merged.values.Localization).toBe(9);
    // …and case-SENSITIVE keys are distinct keys, never folded into one.
    expect(merged.values.Christmas).toBe(0);
    expect(merged.keys).toEqual(['Localization', 'Christmas']);

    const lowerCased = mergeGlobalRegistry([
      file('a.json', { GlobalRegistryValues: { localization: 1 } }),
      file('b.json', { GlobalRegistryValues: { Localization: 2 } }),
    ]);
    expect(lowerCased.keys).toEqual(['localization', 'Localization']);
    expect(lowerCased.values.localization).toBe(1);
    expect(lowerCased.values.Localization).toBe(2);
  });

  it('keeps first-seen key order while later values win, and unionises disjoint keys', () => {
    const merged = mergeGlobalRegistry([
      file('a.json', { GlobalRegistryValues: { One: 1, Two: 2 } }),
      file('b.json', { GlobalRegistryValues: { Two: 22, Three: 3 } }),
      file('c.json', { GlobalRegistryValues: { Four: 4 } }),
    ]);
    expect(merged.keys).toEqual(['One', 'Two', 'Three', 'Four']);
    expect(merged.values).toEqual({ One: 1, Two: 22, Three: 3, Four: 4 });
    expect(merged.files).toEqual(['a.json', 'b.json', 'c.json']);
    expect(merged.document).toEqual({ GlobalRegistryValues: merged.values });
  });

  it('is order-authoritative: reversing the same files reverses the winner', () => {
    const a = file('a.json', { GlobalRegistryValues: { Flag: 1 } });
    const b = file('b.json', { GlobalRegistryValues: { Flag: 2 } });
    expect(mergeGlobalRegistry([a, b]).values.Flag).toBe(2);
    expect(mergeGlobalRegistry([b, a]).values.Flag).toBe(1);
  });

  it('tolerates an empty file, a non-object document and a non-object wrapper, reporting them', () => {
    const merged = mergeGlobalRegistry([
      file('empty.json', {}),
      file('array.json', [1, 2]),
      file('string.json', 'nope'),
      file('wrapper-null.json', { GlobalRegistryValues: null }),
      file('wrapper-array.json', { GlobalRegistryValues: [1] }),
      file('good.json', { GlobalRegistryValues: { Kept: 0 } }),
    ]);
    expect(merged.values).toEqual({ Kept: 0 });
    expect(merged.files).toEqual(['good.json']);
    expect(merged.skipped).toEqual([
      { name: 'empty.json', reason: 'wrapper-not-an-object' },
      { name: 'array.json', reason: 'document-not-an-object' },
      { name: 'string.json', reason: 'document-not-an-object' },
      { name: 'wrapper-null.json', reason: 'wrapper-not-an-object' },
      { name: 'wrapper-array.json', reason: 'wrapper-not-an-object' },
    ]);
  });

  it('carries a value verbatim — a merge never normalises what it did not touch (D5/D57)', () => {
    const merged = mergeGlobalRegistry([
      file('a.json', { GlobalRegistryValues: { Int: 1, Float: 0.25, Text: 'x', Null: null } }),
    ]);
    expect(merged.values).toEqual({ Int: 1, Float: 0.25, Text: 'x', Null: null });
    expect(serializeDoc(loadDoc(merged.document))).toContain('"Int": 1');
    expect(serializeDoc(loadDoc(merged.document))).not.toContain('1.0');
  });

  it('never depends on readdir order: the injected order is the one that is used', () => {
    // Two files whose sorted order and enumeration order differ, merged both ways.
    const z = file('z.json', { GlobalRegistryValues: { Flag: 1 } });
    const a = file('a.json', { GlobalRegistryValues: { Flag: 2 } });
    expect(globalRegistryFileOrder(['z.json', 'a.json'])).toEqual(['a.json', 'z.json']);
    expect(globalRegistryFileOrder(['a.json', 'z.json'])).toEqual(['a.json', 'z.json']);
    expect(mergeGlobalRegistry([z, a]).values.Flag).toBe(2);
    expect(mergeGlobalRegistry([a, z]).values.Flag).toBe(1);
  });
});

/* ------------------------------------------------------- the consolidation plan */

describe('AC2 — the consolidation plan', () => {
  it('removes every json file but the target, computed from the listing it is given', () => {
    expect(consolidationPlan(['GlobalRegistryModels_1-A.json'])).toEqual({
      keep: GLOBAL_REGISTRY_FILE_NAME,
      remove: ['GlobalRegistryModels_1-A.json'],
    });
    expect(consolidationPlan(['a.json', 'b.json', 'notes.txt'])).toEqual({
      keep: GLOBAL_REGISTRY_FILE_NAME,
      remove: ['a.json', 'b.json'],
    });
  });

  it('is empty when the directory already holds only the target (a second save)', () => {
    expect(consolidationPlan([GLOBAL_REGISTRY_FILE_NAME])).toEqual({
      keep: GLOBAL_REGISTRY_FILE_NAME,
      remove: [],
    });
    expect(consolidationPlan([])).toEqual({ keep: GLOBAL_REGISTRY_FILE_NAME, remove: [] });
  });

  it('turns the unkeyed list’s stem keys back into file names', () => {
    // `listObjects` keys the unkeyed family by file stem, so the disclosure can name the files.
    expect(fileNamesForRegistryKeys(['GlobalRegistryModels_1-A'])).toEqual([
      'GlobalRegistryModels_1-A.json',
    ]);
    expect(fileNamesForRegistryKeys(['globalregistry'])).toEqual(['globalregistry.json']);
    expect(fileNamesForRegistryKeys([])).toEqual([]);
  });
});

/* --------------------------------------------------------------- the row model */

describe('the key→value row model', () => {
  const document = { GlobalRegistryValues: { Localization: 1, Christmas: 0 } };

  it('reads rows in document key order, addressed by key', () => {
    expect(readRegistryRows(document)).toEqual([
      { index: 0, key: 'Localization', value: 1 },
      { index: 1, key: 'Christmas', value: 0 },
    ]);
    expect(readRegistryRows({})).toEqual([]);
    expect(readRegistryRows('nope')).toEqual([]);
    expect(registryWrapper({})).toBeUndefined();
    expect(registryHasWrapper({})).toBe(false);
    expect(registryHasWrapper(document)).toBe(true);
  });

  it('adds the first row by creating the wrapper, and later rows by one set (D58)', () => {
    expect(addRegistryRowEdit(false, 'Localization', NEW_REGISTRY_VALUE)).toEqual({
      op: 'set',
      path: [GLOBAL_REGISTRY_WRAPPER_KEY],
      value: { Localization: NEW_REGISTRY_VALUE },
    });
    expect(addRegistryRowEdit(true, 'Christmas', 0)).toEqual({
      op: 'set',
      path: registryValuePath('Christmas'),
      value: 0,
    });
    expect(registryWrapperPath()).toEqual(['GlobalRegistryValues']);
  });

  it('adds, edits and removes rows through the shared document primitives', () => {
    // Add into an empty document: the wrapper is created.
    const added = applyEdits(loadDoc({}), [addRegistryRowEdit(false, 'Localization', 1)]);
    expect(added).toEqual({ GlobalRegistryValues: { Localization: 1 } });

    // Add a second row, then edit its value.
    const two = applyEdits(added, [
      addRegistryRowEdit(true, 'Christmas', NEW_REGISTRY_VALUE),
      registryValueEdit('Christmas', '7') as DocEdit,
    ]);
    expect(two).toEqual({ GlobalRegistryValues: { Localization: 1, Christmas: 7 } });

    // Remove one row: the key is gone, the other survives.
    const removed = applyEdits(two, [removeRegistryRowEdit('Christmas')]);
    expect(removed).toEqual({ GlobalRegistryValues: { Localization: 1 } });
  });

  it('renames a row preserving its value, and appends it at the end (no reorder op exists)', () => {
    const renamed = applyEdits(loadDoc({ GlobalRegistryValues: { A: 1, B: 2 } }), [
      ...renameRegistryRowEdits('A', 'Z', 1),
    ]);
    expect(renamed).toEqual({ GlobalRegistryValues: { B: 2, Z: 1 } });
    expect(Object.keys((renamed as { GlobalRegistryValues: object }).GlobalRegistryValues)).toEqual(
      ['B', 'Z'],
    );
    // A blank or unchanged new key is not a rename.
    expect(renameRegistryRowEdits('A', '', 1)).toEqual([]);
    expect(renameRegistryRowEdits('A', 'A', 1)).toEqual([]);
  });

  it('parses a typed value verbatim and refuses an empty or non-finite box', () => {
    expect(registryValueEdit('Flag', '1')).toEqual({
      op: 'set',
      path: ['GlobalRegistryValues', 'Flag'],
      value: 1,
    });
    expect(registryValueEdit('Flag', '0.25')).toEqual({
      op: 'set',
      path: ['GlobalRegistryValues', 'Flag'],
      value: 0.25,
    });
    expect(registryValueEdit('Flag', '-3')).toEqual({
      op: 'set',
      path: ['GlobalRegistryValues', 'Flag'],
      value: -3,
    });
    // An emptied box is NO edit: the dictionary's "absent" is a removed row, not a string value.
    expect(registryValueEdit('Flag', '')).toBeNull();
    expect(registryValueEdit('Flag', '   ')).toBeNull();
    expect(registryValueEdit('Flag', '1e')).toBeNull();
    expect(registryValueEdit('Flag', 'abc')).toBeNull();
  });
});

/* -------------------------------------------------- the no-op fidelity control */

describe('AC1 — a no-op edit leaves the real document byte-identical with an identical key set', () => {
  it.skipIf(!FORK_PRESENT)('round-trips the corpus file with no edit applied', () => {
    const [real] = readCorpus();
    expect(real).toBeDefined();
    const before = loadDoc(real.document);
    const after = applyEdits(before, []);
    const serialized = serializeDoc(after);

    expect(serialized).toBe(real.raw);
    expect(Object.keys(after as object)).toEqual(Object.keys(before as object));
    const beforeKeys = Object.keys(registryWrapper(before) ?? {});
    const afterKeys = Object.keys(registryWrapper(after) ?? {});
    expect(afterKeys).toEqual(beforeKeys);
    expect(afterKeys).toHaveLength(GLOBAL_REGISTRY_CORPUS.distinctKeys);
  });

  it('keeps an integer an integer and a float a float through a real edit elsewhere (D57)', () => {
    const source = { GlobalRegistryValues: { Untouched: 1, Half: 0.25, Edited: 0 } };
    const edited = applyEdits(loadDoc(source), [registryValueEdit('Edited', '2') as DocEdit]);
    expect(edited).toEqual({ GlobalRegistryValues: { Untouched: 1, Half: 0.25, Edited: 2 } });
    expect(serializeDoc(loadDoc(edited))).toBe(
      '{\n  "GlobalRegistryValues": {\n    "Untouched": 1,\n    "Half": 0.25,\n    "Edited": 2\n  }\n}\n',
    );
  });
});
