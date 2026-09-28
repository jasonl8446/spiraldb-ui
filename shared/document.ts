/**
 * The D5 document model: **load** a document and keep the parsed original, **mutate** it through
 * targeted primitives, and **serialize** the result to the canonical bytes.
 *
 * [plan-overview.md] D5 — "Merge-not-replace serialization (fidelity rule). Editors never rebuild
 * a document from a partial schema. Load: `JSON5.parse` the original; keep it. Edits mutate/merge
 * into the parsed original; unknown fields survive untouched. Save: `JSON.stringify(doc, null, 2)`."
 * [plan-phase-3-quest-editing.md] §3.2 owns it (story p3-02); it is deliberately **not**
 * quest-specific — the same rule gates the Phase-4 editors — so it lives at the top of `shared/`
 * rather than inside `shared/quest/`, and `server/src/services/spiraldbFiles.ts` delegates its
 * `stringifySpiraldbJson` to {@link serializeDoc} so there is exactly one definition of the bytes
 * this tool writes.
 *
 * This module is the only thing an editor needs, and it enforces four properties the acceptance
 * criteria of task 3.2 rest on:
 *
 * | property | how |
 * |---|---|
 * | **absent ≠ explicit `null`** | {@link loadDoc} returns the parsed original untouched, and a mutation writes exactly the value it is given; nothing here normalises `null` away or invents a default (D57a/b) |
 * | **untouched keys keep their order** | every primitive rebuilds only the nodes along the path, copying the others in place, so key order is preserved |
 * | **no in-place mutation** | every primitive returns a new document; the input is never written to, so a caller can hold the original ("keep the parsed original") |
 * | **unknown keys survive** | nothing is schema-aware: a key the model has never heard of is copied verbatim |
 *
 * **Dependency-free on purpose.** Turning *text* into a document stays where text is actually read
 * — `server/src/services/sync/json.ts`'s `parseJsonLenient` (strict `JSON.parse` first, `json5` as
 * the recovery path), which `readSpiraldbJson` wraps — and the tests import `json5` directly. The
 * client never parses JSON5 (it consumes parsed JSON from the API: `GET /api/quests/{name}`), and
 * this module is what the Phase-3 editors import, so a `json5` import here would put 96 KB of
 * unreachable parser into the client bundle. {@link loadDoc} therefore takes an already-parsed
 * document.
 *
 * It is imported by the tests through the `@shared/*` alias and by the server through the compiled
 * relative path (`shared/document.js`), matching the existing house style.
 */

/** A parsed SpiralDB document. Deliberately `unknown`: this layer is not schema-aware (D5). */
export type JsonDocument = unknown;

/** A path into a document: object keys as strings, array indices as numbers. */
export type DocPath = readonly (string | number)[];

/** A single targeted mutation, applied by {@link applyEdits}. */
export type DocEdit =
  | { op: 'set'; path: DocPath; value: unknown }
  | { op: 'delete'; path: DocPath }
  | { op: 'insert'; path: DocPath; index: number; value: unknown };

/** Raised when a mutation addresses a path the document does not have. */
export class DocumentPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentPathError';
  }
}

/** `true` for a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A short description of a value, for error messages. */
function describeValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `an array of length ${value.length}`;
  }
  if (isPlainObject(value)) {
    return 'an object';
  }
  return `${typeof value} (${JSON.stringify(value)})`;
}

/** `m_goals[2].m_bountyTotal`; the root path renders as `<root>`. */
export function formatDocPath(path: DocPath): string {
  let rendered = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      rendered += `[${segment}]`;
    } else {
      rendered += rendered === '' ? segment : `.${segment}`;
    }
  }
  return rendered === '' ? '<root>' : rendered;
}

/**
 * The inverse of {@link formatDocPath}: `m_goals[2].m_goalText` → `['m_goals', 2, 'm_goalText']`.
 *
 * It exists because one caller receives a path as **text**: the evidence API (task 6.6,
 * `server/src/services/questEvidence.ts`) hands each text row the path of the file value that
 * references it as a formatted string, and story p6-08's insert reducer must turn that string back
 * into the path an edit addresses. The grammar is exactly the one {@link formatDocPath} writes and
 * nothing else: a leading key, then `.key` or `[index]` steps, indices as decimal with no leading
 * zero (which is how `formatDocPath` renders them).
 *
 * A string it cannot parse **returns `null`** rather than a best-effort path. A path is an address,
 * and a wrong address writes to the wrong place — the one caller treats `null` as "this row has no
 * target", which is the safe half of the same fact. Round-tripping `formatDocPath` ↔ `parseDocPath`
 * is pinned by `tests/unit/document-path.test.ts`.
 */
export function parseDocPath(path: string): DocPath | null {
  if (path === '') {
    return null;
  }
  const segments: (string | number)[] = [];
  // `true` when the next thing that may start is a key, `false` when it must be a step.
  let expectKey = true;
  let cursor = 0;
  while (cursor < path.length) {
    const char = path[cursor];
    if (char === '.') {
      if (expectKey) {
        return null;
      }
      expectKey = true;
      cursor += 1;
      continue;
    }
    if (char === '[') {
      if (expectKey) {
        return null;
      }
      const close = path.indexOf(']', cursor);
      if (close === -1) {
        return null;
      }
      const digits = path.slice(cursor + 1, close);
      if (!/^(?:0|[1-9][0-9]*)$/.test(digits)) {
        return null;
      }
      segments.push(Number(digits));
      cursor = close + 1;
      continue;
    }
    if (!expectKey) {
      return null;
    }
    const key = /^[^.[\]]+/.exec(path.slice(cursor));
    if (key === null) {
      return null;
    }
    segments.push(key[0]);
    cursor += key[0].length;
    expectKey = false;
  }
  return expectKey ? null : segments;
}

/**
 * Takes an already-parsed document and **keeps it**: the same reference comes back, so nothing is
 * normalised, no schema is consulted and no default is injected.
 *
 * The whole point of D5 is that the parsed original is what edits are applied to and what is
 * written back: a Zod parse output is a *reordering* of the keys (shape order first) and is exactly
 * how nulls and unmodelled fields would be lost (D57b — "never write a parse output"). Keeping the
 * original is therefore the whole contract, and this function exists to name it: the text is
 * parsed elsewhere (`parseJsonLenient` on the server, `json5` in tests) and the parsed result is
 * handed to the model here.
 *
 * @throws {TypeError} when handed something that is not a document (an object or an array) — an
 * absent document is a caller bug, not an empty one.
 */
export function loadDoc(document: unknown): JsonDocument {
  if (!isPlainObject(document) && !Array.isArray(document)) {
    throw new TypeError(
      `loadDoc expects an already-parsed document (an object or an array), received ${describeValue(document)}`,
    );
  }
  return document;
}

/**
 * The canonical bytes for a document: `JSON.stringify(doc, null, 2)` plus a trailing newline.
 *
 * **This is the single home of the write rule** ([spec-data-model.md] L247-253; the trailing
 * newline is the deliberate addition the corpus needs — every corpus file ends with one and
 * omitting it makes every diff report "\ No newline at end of file").
 *
 * Two properties the fidelity harness fixes in place: `JSON.stringify` writes an explicit `null`
 * **as** `null` (never dropping it — dropping it changes the 320 corpus quests that carry all 36
 * top-level keys, measured 2026-09-26) and emits object keys in insertion order (never sorted,
 * never reordered).
 */
export function serializeDoc(doc: JsonDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** `true` when {@link path} exists in {@link doc}. Lenient: it never throws. */
export function hasAtPath(doc: JsonDocument, path: DocPath): boolean {
  let node: unknown = doc;
  for (const segment of path) {
    if (Array.isArray(node)) {
      if (typeof segment !== 'number' || !Number.isInteger(segment) || segment < 0) {
        return false;
      }
      if (segment >= node.length) {
        return false;
      }
    } else if (isPlainObject(node)) {
      if (typeof segment !== 'string' || !Object.prototype.hasOwnProperty.call(node, segment)) {
        return false;
      }
    } else {
      return false;
    }
    node = (node as Record<string | number, unknown>)[segment];
  }
  return true;
}

/**
 * Reads the value at {@link path}, or throws {@link DocumentPathError} when the path does not
 * exist.
 *
 * Strict on purpose: "the absent key stayed absent" is a claim a test can only make if reading a
 * missing path is distinguishable from reading an explicit `null`. {@link hasAtPath} is the
 * lenient probe.
 */
export function getAtPath(doc: JsonDocument, path: DocPath): unknown {
  let node: unknown = doc;
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    const where = formatDocPath(path.slice(0, index + 1));
    if (Array.isArray(node)) {
      if (
        typeof segment !== 'number' ||
        !Number.isInteger(segment) ||
        segment < 0 ||
        segment >= node.length
      ) {
        throw new DocumentPathError(`${where} does not exist`);
      }
    } else if (isPlainObject(node)) {
      if (typeof segment !== 'string' || !Object.prototype.hasOwnProperty.call(node, segment)) {
        throw new DocumentPathError(`${where} does not exist`);
      }
    } else {
      throw new DocumentPathError(`cannot read ${where}: its parent is ${describeValue(node)}`);
    }
    node = (node as Record<string | number, unknown>)[segment];
  }
  return node;
}

/**
 * Sets the value at {@link path}, returning a **new** document.
 *
 * Every node along the path is rebuilt and every other node is shared with the input, so untouched
 * keys, their order and their identity survive. An object key that is absent is appended (adding a
 * field is a legitimate edit, and appending is what a merge does); an array index may be an
 * existing index or `length` (append). A path whose *intermediate* node is missing, or is not a
 * container, throws — this layer never invents structure, so a typo cannot silently create
 * defaults anywhere in the document (D5/D57).
 */
export function setAtPath(doc: JsonDocument, path: DocPath, value: unknown): JsonDocument {
  return setAt(doc, path, 0, value);
}

function setAt(node: unknown, path: DocPath, index: number, value: unknown): unknown {
  if (index === path.length) {
    return value;
  }
  const segment = path[index];
  const where = formatDocPath(path.slice(0, index + 1));
  if (Array.isArray(node)) {
    if (
      typeof segment !== 'number' ||
      !Number.isInteger(segment) ||
      segment < 0 ||
      segment > node.length
    ) {
      throw new DocumentPathError(
        `cannot set ${where}: index out of range for an array of length ${node.length}`,
      );
    }
    if (segment === node.length && index < path.length - 1) {
      throw new DocumentPathError(
        `cannot set ${formatDocPath(path.slice(0, index + 2))}: the appended element ${where} has no children`,
      );
    }
    const copy = node.slice();
    copy[segment] = setAt(node[segment], path, index + 1, value);
    return copy;
  }
  if (isPlainObject(node)) {
    if (typeof segment !== 'string') {
      throw new DocumentPathError(`cannot set ${where}: an object key must be a string`);
    }
    const copy: Record<string, unknown> = { ...node };
    copy[segment] = setAt(node[segment], path, index + 1, value);
    return copy;
  }
  throw new DocumentPathError(`cannot set ${where}: its parent is ${describeValue(node)}`);
}

/**
 * Removes the key or array element at {@link path}, returning a **new** document. The remaining
 * keys keep their order.
 *
 * Strict: the path must exist (a delete of something that was never there is a caller bug, not a
 * silent no-op). Deleting a *key* is the only way a merge-not-replace model can express "this
 * field is gone" — omitting it from an incoming object deliberately does not (D45(1)).
 */
export function deleteAtPath(doc: JsonDocument, path: DocPath): JsonDocument {
  if (path.length === 0) {
    throw new DocumentPathError('cannot delete <root>: a document always exists');
  }
  return deleteAt(doc, path, 0);
}

function deleteAt(node: unknown, path: DocPath, index: number): unknown {
  const segment = path[index];
  const where = formatDocPath(path.slice(0, index + 1));
  const isLeaf = index === path.length - 1;
  if (Array.isArray(node)) {
    if (
      typeof segment !== 'number' ||
      !Number.isInteger(segment) ||
      segment < 0 ||
      segment >= node.length
    ) {
      throw new DocumentPathError(
        `cannot delete ${where}: index out of range for an array of length ${node.length}`,
      );
    }
    const copy = node.slice();
    if (isLeaf) {
      copy.splice(segment, 1);
    } else {
      copy[segment] = deleteAt(node[segment], path, index + 1);
    }
    return copy;
  }
  if (isPlainObject(node)) {
    if (typeof segment !== 'string' || !Object.prototype.hasOwnProperty.call(node, segment)) {
      throw new DocumentPathError(`cannot delete ${where}: the key is absent`);
    }
    const copy: Record<string, unknown> = { ...node };
    if (isLeaf) {
      delete copy[segment];
    } else {
      copy[segment] = deleteAt(node[segment], path, index + 1);
    }
    return copy;
  }
  throw new DocumentPathError(`cannot delete ${where}: its parent is ${describeValue(node)}`);
}

/**
 * Inserts {@link value} into the array at {@link arrayPath} at {@link index}, returning a **new**
 * document. Later elements shift right (that is what "insert" means); nothing else changes.
 */
export function insertIntoArray(
  doc: JsonDocument,
  arrayPath: DocPath,
  index: number,
  value: unknown,
): JsonDocument {
  const target = getAtPath(doc, arrayPath);
  if (!Array.isArray(target)) {
    throw new DocumentPathError(
      `cannot insert into ${formatDocPath(arrayPath)}: it is ${describeValue(target)}, not an array`,
    );
  }
  if (!Number.isInteger(index) || index < 0 || index > target.length) {
    throw new DocumentPathError(
      `cannot insert at ${formatDocPath([...arrayPath, index])}: index out of range for an array of length ${target.length}`,
    );
  }
  const copy = target.slice();
  copy.splice(index, 0, value);
  return setAtPath(doc, arrayPath, copy);
}

/**
 * Applies a list of edits in order, returning the final document. The single entry point an editor
 * uses to turn its form state into a document — every edit goes through the primitives above, so
 * the four properties in the module header hold for the batch too.
 */
export function applyEdits(doc: JsonDocument, edits: readonly DocEdit[]): JsonDocument {
  let current = doc;
  for (const edit of edits) {
    if (edit.op === 'set') {
      current = setAtPath(current, edit.path, edit.value);
    } else if (edit.op === 'delete') {
      current = deleteAtPath(current, edit.path);
    } else {
      current = insertIntoArray(current, edit.path, edit.index, edit.value);
    }
  }
  return current;
}
