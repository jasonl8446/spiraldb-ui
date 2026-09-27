import type { DocEdit, DocPath } from '../document.js';
import { UNKEYED_FILE_NAME } from '../naming.js';

/**
 * `GlobalRegistry/` — plan task 4.9 (story p4-07, AC1 + AC2): the wrapper schema and the
 * merge rule of docs/spec-domain-reference.md **L102-119**, the editor's own description at
 * **L711-712**, the file name of docs/spec-data-model.md **L187**, and `docs/plan-overview.md`
 * **D22** (consolidate-and-replace, with the Imlight enumeration rationale), **D5**
 * (merge-not-replace), **D57** (validate, never normalise), **Q1** (editor-only, no tracking)
 * and **D74(c)** (a per-type query uses the type's real `object_type`).
 *
 * ```json
 * {
 *   "GlobalRegistryValues": {
 *     "Localization": 1,
 *     "Christmas": 0,
 *     "Halloween": 0
 *   }
 * }
 * ```
 *
 * ## The measured corpus, 2026-09-27 — every number below is re-measured by the live sweep
 *
 * | fact | measured |
 * |---|---|
 * | `GlobalRegistry/*.json` files | **1** (`GlobalRegistryModels_1-A.json`, 560 bytes) |
 * | unparseable files | **0** |
 * | top-level keys | exactly **1**: `GlobalRegistryValues` |
 * | values inside the wrapper | **23** |
 * | distinct keys | **23** (no duplicate/case-collision in this corpus) |
 * | values that are JSON **integers** | **23 / 23**; a non-number value: **0** |
 * | …value `1` | **1** (`Localization`); value `0`: **22** |
 * | keys starting upper-case | **23 / 23**; keys that are all-upper: **0** |
 * | keys with an underscore / a hyphen | **7** / **1** (`KM-Teaser`) |
 * | key orders | **1** — the wrapper's own insertion order is the file's order |
 * | files whose bytes equal `serializeDoc(doc)` | **1 / 1** — a no-op edit is byte-identical |
 * | `entry_status` rows for `global_registry` | **0** (Q1: no lifecycle) |
 * | `StatusObjectType` members | **8**, `global_registry` **not** among them (AC3) |
 *
 * ## The merge rule, and why the file order is *injected*
 *
 * L102-119: `GlobalRegistryValues` is a `Dictionary<string, float>`, **case-sensitive keys**,
 * **later files overwrite earlier**. D22's measured rationale is that Imlight enumerates
 * `Directory.EnumerateFiles` **unsorted** (`Imlight/src/CoreLib/WizardData/SpiralDB.cs`
 * L341-347), so with more than one file the effective value of a key is filesystem-order
 * dependent — which is *why* consolidating to one file exists.
 *
 * {@link mergeGlobalRegistry} therefore takes the files as an **array whose order is
 * authoritative** ("later wins", index by index). It never reads a directory and never calls
 * `readdir`, so the rule is testable with any order at all and a merge test cannot accidentally
 * pass on this machine's enumeration. {@link globalRegistryFileOrder} is the one explicit order
 * the server feeds it — ascending by file name, the same name order the family's list already
 * uses — chosen so the merged view is deterministic even though Imlight's own order is not.
 *
 * The merge is **vacuous on today's corpus** (one file), so "later wins" and case-sensitivity
 * are proven by fixtures; the live sweep pins the one-file numbers above.
 *
 * ## What the merge tolerates, and what it does not
 *
 * A parsed document that is not an object, or whose `GlobalRegistryValues` is absent or not an
 * object, contributes **nothing** and is reported in `skipped[]` rather than throwing (one
 * legacy file must not 500 the family's read). A file that cannot be *parsed* never reaches the
 * merge: the server's reader (`readSpiraldbJson`, JSON5-lenient) is where that is decided, and
 * its failure is a per-file read error, not a merge concern. Values are carried **verbatim**
 * (D5/D57): a key→`"x"` string survives a merge, and nothing here rewrites, sorts, lowercases or
 * number-formats a key or a value.
 *
 * ## The row model is a **map**, not a list
 *
 * The form renders a key→value table: one row per **key**, addressed by the key itself (there is
 * no index-addressed removal to consider — an object cannot repeat a key, which is exactly the
 * opposite of the array families' duplicate-row problem, D71(a)). The builders below are
 * therefore key-addressed and live here rather than being stretched over `./model.ts`'s list
 * primitives (append/remove-at-index/move, which are for arrays of ids).
 */

/** The one top-level key a registry file carries (L102-119). */
export const GLOBAL_REGISTRY_WRAPPER_KEY = 'GlobalRegistryValues';

/**
 * The file the convention writes for this family (`globalregistry.json`, L187) — the
 * consolidating save's target, and the one file D22 keeps. `shared/naming.ts` is its home.
 */
export const GLOBAL_REGISTRY_FILE_NAME = UNKEYED_FILE_NAME;

/** The extension `listObjects`' stem keys omit (`GlobalRegistryModels_1-A` → `….json`). */
export const GLOBAL_REGISTRY_EXTENSION = '.json';

/** The value a newly added row starts at — the corpus's own dominant value (22 of 23 are `0`). */
export const NEW_REGISTRY_VALUE = 0;

/**
 * The corpus's measured shape, as constants, so the live sweep can catch a moved corpus
 * instead of the editor quietly assuming (the p4-03…p4-06 convention).
 */
export const GLOBAL_REGISTRY_CORPUS = {
  /** `GlobalRegistry/*.json` files in the fork today. */
  files: 1,
  /** The one legacy name D19 cites as an example of a non-convention file. */
  fileName: 'GlobalRegistryModels_1-A.json',
  /** Top-level keys per file: exactly the one wrapper key. */
  topLevelKeys: 1,
  /** Values inside the wrapper. */
  values: 23,
  /** Distinct keys — equal to {@link GLOBAL_REGISTRY_CORPUS.values} today. */
  distinctKeys: 23,
  /** Values that are JSON integers (the spec calls the type `float`; the corpus writes ints). */
  integerValues: 23,
  /** Values that are not numbers at all. */
  nonNumberValues: 0,
  /** `entry_status` rows for the real `object_type` `global_registry` (D74(c)); Q1. */
  entryStatusRows: 0,
} as const;

/** `true` for a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `true` when a stored registry value is a finite JSON number (what the spec's `float` means). */
export function registryValueIsNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/* -------------------------------------------------------------------- the merge */

/** One file handed to the merge: its name, and its already-parsed document. */
export interface GlobalRegistryFile {
  readonly name: string;
  readonly document: unknown;
}

/** Why a file contributed nothing to the merge. */
export type GlobalRegistryMergeSkipReason = 'document-not-an-object' | 'wrapper-not-an-object';

export interface GlobalRegistryMergeSkip {
  readonly name: string;
  readonly reason: GlobalRegistryMergeSkipReason;
}

export interface GlobalRegistryMergeResult {
  /**
   * The merged document in the shape a save writes: `{GlobalRegistryValues: {...}}` — the
   * wrapper is **not** flattened (the registry values live under it, L102-119).
   */
  readonly document: Record<string, unknown>;
  /** The merged dictionary itself (the same object `document[GLOBAL_REGISTRY_WRAPPER_KEY]`). */
  readonly values: Record<string, unknown>;
  /** Distinct keys, in first-seen order. */
  readonly keys: string[];
  /** File names that contributed, in merge order (later wins). */
  readonly files: string[];
  /** Files that contributed nothing, reported rather than fatal. */
  readonly skipped: GlobalRegistryMergeSkip[];
}

/**
 * The merge of docs/spec-domain-reference.md L102-119: case-sensitive keys, **later files win**.
 *
 * The `files` array's **order is authoritative** — `files[0]` is first, the last element wins a
 * conflict. Nothing here consults the filesystem, so a caller (and a test) controls the order
 * explicitly; feed {@link globalRegistryFileOrder} for the server's deterministic order. A key
 * seen for the first time is inserted, so `keys` is first-seen order — the merged view equals a
 * manual merge applied in the same order.
 */
export function mergeGlobalRegistry(
  files: readonly GlobalRegistryFile[],
): GlobalRegistryMergeResult {
  const values: Record<string, unknown> = {};
  const contributing: string[] = [];
  const skipped: GlobalRegistryMergeSkip[] = [];

  for (const file of files) {
    if (!isPlainObject(file.document)) {
      skipped.push({ name: file.name, reason: 'document-not-an-object' });
      continue;
    }
    const wrapper = file.document[GLOBAL_REGISTRY_WRAPPER_KEY];
    if (!isPlainObject(wrapper)) {
      skipped.push({ name: file.name, reason: 'wrapper-not-an-object' });
      continue;
    }
    // Case-sensitive by construction (object keys are exact), later wins by assignment order.
    for (const key of Object.keys(wrapper)) {
      values[key] = wrapper[key];
    }
    contributing.push(file.name);
  }

  return {
    document: { [GLOBAL_REGISTRY_WRAPPER_KEY]: values },
    values,
    keys: Object.keys(values),
    files: contributing,
    skipped,
  };
}

/**
 * The one explicit order the server merges in: ascending by file name, the same name order the
 * family's list (`listObjects`) and the content-keyed index already scan in.
 *
 * D22's rationale is that Imlight's own `Directory.EnumerateFiles` order is **unsorted**, so a
 * multi-file directory has no knowable winner. This function does not claim to reproduce that
 * order — it replaces it with a deterministic one, which is what makes the merged view stable
 * and the consolidation reviewable in a diff.
 */
export function globalRegistryFileOrder(names: readonly string[]): string[] {
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/* ------------------------------------------------------------ the consolidation plan */

export interface GlobalRegistryConsolidationPlan {
  /** The file the save writes and keeps (`globalregistry.json`). */
  readonly keep: string;
  /** The files the same commit deletes, in the order they were listed. */
  readonly remove: string[];
}

/**
 * Which files a consolidating save must delete (AC2 / D22), computed from the **directory
 * listing the caller passes** — never assumed, never a hardcoded name.
 *
 * Every `*.json` entry except the target is removed. A name equal to the target is kept even
 * when it is the only file (so the `remove` list is honestly empty on a second save), and a
 * non-`.json` entry is not this family's business.
 */
export function consolidationPlan(
  fileNames: readonly string[],
  target: string = GLOBAL_REGISTRY_FILE_NAME,
): GlobalRegistryConsolidationPlan {
  const remove = fileNames.filter(
    (name) => name.toLowerCase().endsWith('.json') && name !== target,
  );
  return { keep: target, remove };
}

/**
 * The file names behind the unkeyed family's list rows.
 *
 * `listObjects` gives the unkeyed family one row per **file**, keyed by the file's stem
 * (`GlobalRegistryModels_1-A`), so the names are the stems plus `{@link GLOBAL_REGISTRY_EXTENSION}`.
 * The client needs them to name the files a save will replace (AC2's pre-save disclosure), and
 * this is the one place that mapping is written down.
 */
export function fileNamesForRegistryKeys(keys: readonly string[]): string[] {
  return keys.map((key) => `${key}${GLOBAL_REGISTRY_EXTENSION}`);
}

/* -------------------------------------------------------------------- the reader */

/** One row of the key→value table. */
export interface GlobalRegistryRow {
  /** The key's position in the wrapper (document key order). */
  readonly index: number;
  /** The key, verbatim and case-sensitive. */
  readonly key: string;
  /** The stored value, verbatim (a number in every measured row; never rewritten). */
  readonly value: unknown;
}

/** The wrapper object of a document, or `undefined` when the shape is not there. */
export function registryWrapper(document: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(document)) {
    return undefined;
  }
  const wrapper = document[GLOBAL_REGISTRY_WRAPPER_KEY];
  return isPlainObject(wrapper) ? wrapper : undefined;
}

/** `true` when the document carries a `GlobalRegistryValues` object (the edit builders' branch). */
export function registryHasWrapper(document: unknown): boolean {
  return registryWrapper(document) !== undefined;
}

/**
 * The wrapper as renderable rows, in document key order — one row per key, `[]` when the
 * document has no wrapper object. Rows key off the key itself: an object cannot repeat a key,
 * so no index-addressed addressing is needed and the row's key is its identity.
 */
export function readRegistryRows(document: unknown): GlobalRegistryRow[] {
  const wrapper = registryWrapper(document);
  if (wrapper === undefined) {
    return [];
  }
  return Object.keys(wrapper).map((key, index) => ({ index, key, value: wrapper[key] }));
}

/* ------------------------------------------------------------- the edit builders */

/** The wrapper's path: `['GlobalRegistryValues']`. */
export function registryWrapperPath(): DocPath {
  return [GLOBAL_REGISTRY_WRAPPER_KEY];
}

/** One value's path: `['GlobalRegistryValues', 'Localization']`. */
export function registryValuePath(key: string): DocPath {
  return [GLOBAL_REGISTRY_WRAPPER_KEY, key];
}

/**
 * The edit that adds a row: a `set` of the one key under the wrapper (an unkeyed file's first
 * row creates the wrapper itself, because `shared/document.ts` never invents structure).
 *
 * The caller refuses a blank or already-present key (the form's Add control), so this builder
 * only has to be structurally correct.
 */
export function addRegistryRowEdit(hasWrapper: boolean, key: string, value: unknown): DocEdit {
  if (!hasWrapper) {
    return { op: 'set', path: registryWrapperPath(), value: { [key]: value } };
  }
  return { op: 'set', path: registryValuePath(key), value };
}

/** The edit that removes the row at `key` — the key itself is the address (no array indices). */
export function removeRegistryRowEdit(key: string): DocEdit {
  return { op: 'delete', path: registryValuePath(key) };
}

/**
 * The two edits a key rename produces: delete the old key, then set the new one carrying the
 * row's **current value** (the caller passes it, so nothing is read from a stale render).
 *
 * `shared/document.ts` has no key-reorder operation (its ops are set/delete/insert), so the new
 * key lands **at the end** of the wrapper — a renamed row moves to the bottom of the table. That
 * is a visible, documented consequence rather than a hidden one, and it cannot disturb an
 * existing file's order: the consolidation writes a **new** `globalregistry.json` and deletes
 * the legacy file (D22), so no pre-existing corpus file is re-ordered by a rename.
 *
 * Returns `[]` for a blank new key or an unchanged one (a rename to nothing is not a rename; the
 * form keeps the old key).
 */
export function renameRegistryRowEdits(oldKey: string, newKey: string, value: unknown): DocEdit[] {
  if (newKey === '' || newKey === oldKey) {
    return [];
  }
  return [removeRegistryRowEdit(oldKey), { op: 'set', path: registryValuePath(newKey), value }];
}

/**
 * The edit a row's value box produces: the parsed finite number, written **verbatim**.
 *
 * A stored integer round-trips as an integer, because `1` and `1.0` are the same JSON number and
 * serialization writes the shortest form (`1`, never `1.0`) — the sweep pins this on the real
 * file and a fixture pins a float (`0.25`) that nothing touched.
 *
 * An **emptied** box produces **no** edit: the wrapper's values are numbers (L102-119), writing
 * `''` into a `float` dictionary would be type corruption and `undefined` is not a value JSON
 * can carry (D57). To remove a flag the user removes the **row**, which deletes the key — the
 * dictionary's own "absent" representation. A non-finite entry (`1e`, `-`, `abc`) is likewise no
 * edit rather than a `NaN`.
 */
export function registryValueEdit(key: string, raw: string): DocEdit | null {
  if (raw.trim() === '') {
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return null;
  }
  return { op: 'set', path: registryValuePath(key), value };
}
