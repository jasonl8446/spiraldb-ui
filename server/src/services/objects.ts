import fs from 'node:fs';
import path from 'node:path';

import type { ObjectFileType } from '../../../shared/naming.js';
import { ULong } from '../../../shared/ulong.js';
import type { ObjectTypeConfig } from '../../../shared/objectTypes.js';
import type { Db } from '../db.js';
import {
  collectionSpec,
  createTargetPath,
  objectKeyFromData,
  readSpiraldbJson,
  SpiraldbFileError,
} from './spiraldbFiles.js';
import {
  createSavePipeline,
  type SaveObjectResult,
  type SaveOutcome,
  type SavePipeline,
} from './savePipeline.js';
import { createSpiraldbIndex, type SpiraldbIndex } from './spiraldbIndex.js';
import { isStatusValue, listStatus, type StatusSummary, type StatusValue } from './status.js';
import { isPlainObject } from './sync/json.js';

/**
 * Generic object data layer — task 4.1 (docs/plan-phase-4-other-object-editors.md §4.1).
 *
 * One implementation for the eight non-quest types, driven by the
 * `shared/objectTypes.ts` table: list, detail and save. It builds on the two Phase-2
 * primitives and adds no file handling of its own:
 *
 * - **Resolution is the D19 content-keyed index** (`index.pathFor`). A legacy
 *   filename is never derived from a key: every one of the eight families uses a
 *   legacy prefix the naming convention does not produce (`droptables_…`,
 *   `NPCInventories_…`, `WizardZoneDatas_…`), so a filename-derived lookup would miss
 *   100% of existing entries — and it is what makes an update land on the file's
 *   **original path** rather than relocating it.
 * - **The write is the Phase-2 save pipeline**, so a create is `fileNameFor`'s
 *   convention name (singular `droptable_…` per D26), the commit is
 *   `spiraldb: {create|update} {object_type} {key}` and a create upserts
 *   `entry_status` exactly as an extraction save does.
 *
 * Four measured corpus realities shape this module:
 *
 * 1. `NpcDropTable/` **does not exist**. `listObjects` tolerates the missing
 *    directory (0 rows, `missing_directory: true`, no throw) and a create goes
 *    through the pipeline's `writeSpiraldbJson`, which `mkdirSync(…, {recursive:
 *    true})` — so the first save creates it.
 * 2. `NpcSpellInventory/` holds one **unprefixed** file (a UUID name). It is indexed
 *    like any other file and never renamed; the list reads it through the same key
 *    field as its siblings.
 * 3. `ZoneTransfer/` and `GlobalRegistry/` have **no `entry_status` rows at all**.
 *    The status join is a lookup that tolerates a missing row rather than an inner
 *    join, so every row defaults to `extracted` (the schema default) instead of
 *    vanishing from the list.
 * 4. The four `TemplateID` families store a **number** in JSON and a **string** in
 *    `entry_status.object_key`. `shared/ulong.ts` is the only place that converts;
 *    this module uses its text direction for keys coming off disk and its number
 *    direction for the field being written.
 *
 * Load: ~2,000 corpus files, no caching (D12) — the list scans and parses per
 * request. The per-root index is built once per process/root (`objectRuntimeFor`) and
 * `rebuildType`d after each save of that family.
 */

/** The list's per-row shape. Snake_case, matching the quests/status endpoints. */
export interface ObjectListRow {
  /** The key in its canonical text form (`ULong.toKey` for the `TemplateID` families). */
  key: string;
  /**
   * Display title. The key itself for all eight families today (the drop table's
   * `Name`, a zone path, an NPC template id): none of the eight has a separate
   * title field, unlike a quest's `m_questTitle`, so no string-table lookup happens.
   */
  title: string;
  /** The source file's mtime, ISO 8601; `null` when it vanished before the stat. */
  modified_at: string | null;
  /** `entry_status.status`, or `null` for a family with no lifecycle. */
  status: StatusValue | null;
}

/** A corpus file the scan could not read or parse — reported, never fatal. */
export interface ObjectListSkipped {
  /** Path relative to the SpiralDB root (`NpcInventory/…json`). */
  file: string;
  message: string;
}

export interface ObjectListResult {
  objects: ObjectListRow[];
  /**
   * Counts of the rows this call returned, so a client's filter tabs count exactly
   * what its table holds. `null` for a family with no lifecycle (GlobalRegistry,
   * Q1) — there are no tabs to count.
   */
  summary: StatusSummary | null;
  /** Files that could not be read/parsed, and files with no usable key. */
  skipped: ObjectListSkipped[];
  /**
   * `true` when the family's directory does not exist in this repository — normal
   * for `NpcDropTable/` (measured: absent). The client renders its empty state from
   * this rather than from a zero count.
   */
  missing_directory: boolean;
  /** `directory/key` for every key that appeared twice (first file wins, the index's rule). */
  duplicate_keys: string[];
}

export interface ListObjectsOptions {
  db: Db;
  config: ObjectTypeConfig;
  /** SpiralDB repository root (`settings.spiraldb_path`). */
  spiraldbPath: string;
}

/** `file` relative to `root`, or `file` itself when it is outside/equal to root. */
function relativeTo(root: string, file: string): string {
  const relative = path.relative(root, file);
  return relative === '' ? file : relative;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `mtime.toISOString()` for an existing file, `null` when the stat fails. */
function modifiedAt(filePath: string): string | null {
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch {
    return null;
  }
}

/** `entry_status.status` for an existing row, `extracted` for a missing one. */
function statusFor(lookup: Map<string, string>, key: string): StatusValue {
  const stored = lookup.get(key);
  return isStatusValue(stored) ? stored : 'extracted';
}

/** `*.json` entries of a directory in name order; `undefined` when it does not exist. */
function jsonEntries(directory: string): fs.Dirent[] | undefined {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return undefined;
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * The browse list: one directory scan + lenient parse per request (D12), joined with
 * `entry_status` by key.
 *
 * **The scan mirrors the index's rules deliberately** — name order, first file wins
 * for a duplicate key, JSON5 recovery, a missing key counts as skipped — because the
 * two must agree: a key the list shows but the index cannot resolve would be a row
 * whose detail 404s. `tests/unit/objects-api.test.ts` asserts the two key sets agree
 * on a fixture carrying every measured legacy shape, so the mirroring is checked
 * rather than assumed.
 *
 * A family whose directory is absent contributes an empty list and
 * `missing_directory: true` (`NpcDropTable/` today); an unreadable file is reported
 * in `skipped[]` and the request still succeeds — failing the whole table because
 * one legacy file is broken is what the acceptance criterion forbids.
 */
export function listObjects(options: ListObjectsOptions): ObjectListResult {
  const { db, config, spiraldbPath } = options;
  const directory = path.join(spiraldbPath, config.directory);
  const entries = jsonEntries(directory);

  const skipped: ObjectListSkipped[] = [];
  const duplicateKeys: string[] = [];

  if (entries === undefined) {
    return {
      objects: [],
      summary:
        config.objectType === null ? null : { total: 0, extracted: 0, reviewed: 0, verified: 0 },
      skipped,
      missing_directory: true,
      duplicate_keys: duplicateKeys,
    };
  }

  // The status join, tolerant by construction: an absent row is a lookup miss, not
  // an inner join — ZoneTransfer/ and GlobalRegistry/ have no rows at all.
  const statusByKey = new Map<string, string>();
  if (config.objectType !== null) {
    for (const entry of listStatus(db, [config.objectType]).entries) {
      statusByKey.set(entry.object_key, entry.status);
    }
  }

  const summary: StatusSummary = { total: 0, extracted: 0, reviewed: 0, verified: 0 };
  const seen = new Set<string>();
  const objects: ObjectListRow[] = [];

  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);

    // The unkeyed family (GlobalRegistry) has no key field: its display key is the
    // file's stem, and every file in the directory is a row.
    let key: string;
    if (config.keyField === null) {
      key = entry.name.slice(0, -'.json'.length);
    } else {
      let parsed: unknown;
      try {
        parsed = readSpiraldbJson(filePath);
      } catch (error) {
        skipped.push({ file: relativeTo(spiraldbPath, filePath), message: describeError(error) });
        continue;
      }
      const found = objectKeyFromData(parsed, config.keyField);
      if (found === undefined) {
        skipped.push({
          file: relativeTo(spiraldbPath, filePath),
          message: `File carries no usable "${config.keyField}" value, so it cannot be listed by key.`,
        });
        continue;
      }
      key = found;
    }

    if (seen.has(key)) {
      duplicateKeys.push(`${config.directory}/${key}`);
      continue;
    }
    seen.add(key);

    const status = config.objectType === null ? null : statusFor(statusByKey, key);
    if (config.objectType !== null && status !== null) {
      summary.total += 1;
      summary[status] += 1;
    }

    objects.push({ key, title: key, modified_at: modifiedAt(filePath), status });
  }

  return {
    objects,
    summary: config.objectType === null ? null : summary,
    skipped,
    missing_directory: false,
    duplicate_keys: duplicateKeys,
  };
}

export interface ObjectDetail {
  /** Absolute path of the file the index resolved the key to. */
  path: string;
  key: string;
  object: Record<string, unknown>;
}

export interface ReadObjectOptions {
  config: ObjectTypeConfig;
  /** Built from the same root the file should be resolved in. */
  index: SpiraldbIndex;
  /** Route key, already canonicalised by the router for a `'ulong'` family. */
  key: string;
}

/**
 * One entry's full JSON (`undefined` ⇒ 404).
 *
 * The path comes from `index.pathFor` (D19), never from `fileNameFor` — that is what
 * makes an off-convention legacy name reachable. The reader is `readSpiraldbJson`,
 * whose JSON5 recovery is what makes a legacy file with trailing commas parse.
 *
 * @throws {SpiraldbFileError} when the file exists but is not a JSON object, or
 * cannot be read — the route answers 500 with the message, which names the file.
 */
export function readObject(options: ReadObjectOptions): ObjectDetail | undefined {
  const { config, index, key } = options;
  const filePath = resolveObjectPath({ config, index, key });
  if (filePath === undefined) {
    return undefined;
  }

  const parsed = readSpiraldbJson(filePath);
  if (!isPlainObject(parsed)) {
    throw new SpiraldbFileError(
      `SpiralDB file ${filePath} is not a JSON object — it cannot be served as ` +
        `${config.fileType} "${key}".`,
    );
  }

  return { path: filePath, key, object: parsed };
}

/** The path `key` resolves to, without reading it: the index, or a file stem for the unkeyed family. */
function resolveObjectPath(options: ReadObjectOptions): string | undefined {
  const { config, index, key } = options;

  if (config.keyField !== null) {
    return index.pathFor(config.fileType, key);
  }

  // The unkeyed family: the convention file wins, and any other file in the
  // directory is reachable by its stem (the legacy `GlobalRegistryModels_1-A`
  // shape). Task 4.9 owns merging these into the single file.
  const directory = path.join(index.root, config.directory);
  const convention = path.join(directory, `${key}.json`);
  if (fs.existsSync(convention)) {
    return convention;
  }
  for (const entry of jsonEntries(directory) ?? []) {
    if (entry.name.slice(0, -'.json'.length) === key) {
      return path.join(directory, entry.name);
    }
  }
  return undefined;
}

/* --------------------------------------------------------------------- the runtime */

export interface ObjectRuntime {
  root: string;
  index: SpiraldbIndex;
  pipeline: SavePipeline;
}

/**
 * The per-(connection, root) index + pipeline pair, shared by all eight routers so
 * the ~2,000-file scan happens once per process instead of once per type.
 *
 * Built on the first request that needs it, never at import time (`getDb()` must not
 * run then — routes/index.ts's header), and replaced when `settings.spiraldb_path`
 * changes. A `WeakMap` keyed by the connection keeps two databases with different
 * roots (a unit test's in-memory one, the server's real one) from sharing a pipeline.
 */
const RUNTIMES = new WeakMap<Db, Map<string, ObjectRuntime>>();

export function objectRuntimeFor(db: Db, root: string): ObjectRuntime {
  let byRoot = RUNTIMES.get(db);
  if (byRoot === undefined) {
    byRoot = new Map<string, ObjectRuntime>();
    RUNTIMES.set(db, byRoot);
  }
  const existing = byRoot.get(root);
  if (existing !== undefined) {
    return existing;
  }
  const index = createSpiraldbIndex(root);
  index.rebuild();
  const runtime: ObjectRuntime = {
    root,
    index,
    pipeline: createSavePipeline({ db, spiraldbPath: root, index }),
  };
  byRoot.set(root, runtime);
  return runtime;
}

/* ------------------------------------------------------------------------- saving */

/**
 * A malformed `POST` body — the route maps it to **400**. Covers the things a caller
 * can fix by resending: a missing `object`, a non-string `notes`/`key`, and a key the
 * family's key type cannot express. Pipeline problems are *not* this error and still
 * map to 500.
 */
export class ObjectRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObjectRequestError';
  }
}

/** The `status_history.notes` a create through the generic router records. */
export const CREATED_VIA_UI_NOTE = 'Created via UI';

export interface SaveObjectEntryResult {
  key: string;
  file_type: ObjectFileType;
  /** D4 singular `entry_status.object_type`; `null` for GlobalRegistry. */
  object_type: string | null;
  outcome: SaveOutcome;
  action: SaveObjectResult['action'];
  /** This save's single commit sha (D13). */
  commit: string;
  branch: string;
  commit_message: string;
  /** Committed path relative to the SpiralDB root — the file's *original* path on an update. */
  file: string;
  status: SaveObjectResult['status'];
  status_created: boolean;
  warnings: string[];
}

export interface SaveObjectEntryOptions {
  db: Db;
  config: ObjectTypeConfig;
  index: SpiraldbIndex;
  pipeline: SavePipeline;
  /** The raw request body: `{ object, notes?, key? }`. */
  body: unknown;
}

/**
 * The canonical route/status key for a `ULong.toKey` value, or a 400.
 *
 * Only the `'ulong'` families go through this; a `Name`/`DeckName`/`ZoneName` key is
 * taken verbatim (a zone key legitimately carries `/`).
 */
export function canonicalKeyFor(
  config: ObjectTypeConfig,
  value: unknown,
  source: string,
): string | undefined {
  if (config.keyType !== 'ulong') {
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
  }
  const key = ULong.toKey(value);
  if (key === undefined) {
    throw new ObjectRequestError(
      `Invalid ${config.keyField} in ${source}: expected an unsigned integer (as a JSON number ` +
        `or a digits-only string) but received ${JSON.stringify(value)}.`,
    );
  }
  return key;
}

/**
 * The document handed to the pipeline, with a `'ulong'` family's key field written as
 * a **number** (AC3: strings in `entry_status.object_key`, numbers in JSON).
 *
 * The substitution only fires when the incoming value is not already that number, so
 * the document's key order is untouched and an ordinary edit writes the same bytes.
 *
 * @throws {ObjectRequestError} when the key field cannot be expressed as a JSON number.
 */
function withJsonKey(
  config: ObjectTypeConfig,
  data: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  if (config.keyType !== 'ulong' || config.keyField === null) {
    return data;
  }
  const asNumber = ULong.toJson(data[config.keyField]);
  if (asNumber === undefined) {
    throw new ObjectRequestError(
      `Cannot save ${config.fileType} "${key}": the object's "${config.keyField}" must be an ` +
        `unsigned integer (received ${JSON.stringify(data[config.keyField])}).`,
    );
  }
  return data[config.keyField] === asNumber ? data : { ...data, [config.keyField]: asNumber };
}

/**
 * Saves one entry through the Phase-2 pipeline.
 *
 * Request contract (spec-silent, so fixed and documented here): the body is
 * `{ object: {...}, notes?: string, key?: string }`. `object` must be a JSON object
 * carrying a usable key field unless `key` supplies it. The pipeline decides
 * create-vs-update from the index, so an edit of an existing entry resolves the
 * **original** path and is committed as `spiraldb: update …`; a new key is written as
 * `fileNameFor`'s convention name and committed as `spiraldb: create …`, and it
 * inserts the `entry_status` row with the `Created via UI` history note (plan §4.10).
 *
 * The family is re-scanned through the injected index first, so a file added to the
 * repository outside this tool is never duplicated by a create.
 *
 * @throws {ObjectRequestError} malformed body / unusable key → 400.
 * @throws {DirtyRepoError} uncommitted work in the SpiralDB tree (D14) → 409.
 */
export async function saveObjectEntry(
  options: SaveObjectEntryOptions,
): Promise<SaveObjectEntryResult> {
  const { config, index, pipeline } = options;
  const body = options.body;

  if (!isPlainObject(body)) {
    throw new ObjectRequestError(
      `Request body must be a JSON object with an "object" field carrying the ${
        config.label
      } document and optional "notes" and "key" strings.`,
    );
  }
  if (!isPlainObject(body.object)) {
    throw new ObjectRequestError(
      `Missing object: the request body must carry the ${config.label} document in the ` +
        `"object" field.`,
    );
  }
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') {
    throw new ObjectRequestError(
      `Invalid notes: expected a string but received ${body.notes === null ? 'null' : typeof body.notes}.`,
    );
  }

  let key: string | undefined;
  if (config.keyField === null) {
    // The unkeyed family: the pipeline names the object after the family
    // (`globalregistry`) — a supplied `key` is ignored on purpose.
    if (body.key !== undefined) {
      throw new ObjectRequestError(
        `${config.label} is a single unkeyed file (globalregistry.json) — a "key" cannot be supplied.`,
      );
    }
  } else {
    const explicit =
      body.key === undefined ? undefined : canonicalKeyFor(config, body.key, 'the "key" field');
    if (body.key !== undefined && explicit === undefined) {
      throw new ObjectRequestError('Invalid key: expected a non-empty string.');
    }
    const fromDocument = objectKeyFromData(body.object, config.keyField);
    const candidate = explicit ?? fromDocument;
    if (candidate === undefined) {
      throw new ObjectRequestError(
        `Cannot save ${config.fileType}: the object has no usable "${config.keyField}" value ` +
          `(expected a non-empty string${config.keyType === 'ulong' ? ' or a finite number' : ''}).`,
      );
    }
    key =
      config.keyType === 'ulong' ? canonicalKeyFor(config, candidate, 'the document') : candidate;
    if (key === undefined) {
      throw new ObjectRequestError(
        `Cannot save ${config.fileType}: the "${config.keyField}" value is not a usable key.`,
      );
    }
  }

  const data = withJsonKey(config, body.object, key ?? config.fileType);

  // D12/D19: refresh this family so create-vs-update and the resolved path reflect
  // disk right now.
  index.rebuildType(config.fileType);

  const result = await pipeline.saveObject({
    fileType: config.fileType,
    data,
    ...(key === undefined ? {} : { key }),
    action: 'create',
    ...(typeof body.notes === 'string' ? { notes: body.notes } : {}),
    historyNotesOnCreate: CREATED_VIA_UI_NOTE,
  });

  const warnings = unkeyedWarnings(config, index);

  return {
    key: result.key,
    file_type: result.fileType,
    object_type: config.objectType,
    outcome: result.outcome,
    action: result.action,
    commit: result.commit,
    branch: result.branch,
    commit_message: result.commitMessage,
    file: result.relativePath,
    status: result.status,
    status_created: result.statusCreated,
    warnings,
  };
}

/** The GlobalRegistry leftovers a save leaves behind, reported rather than hidden. */
function unkeyedWarnings(config: ObjectTypeConfig, index: SpiraldbIndex): string[] {
  if (config.fileType !== 'globalregistry') {
    return [];
  }
  const directory = path.join(index.root, config.directory);
  const others = (jsonEntries(directory) ?? []).filter(
    (entry) => entry.name !== `${config.fileType}.json`,
  );
  if (others.length === 0) {
    return [];
  }
  return [
    `${config.directory}/ still holds ${others.length} file(s) besides ` +
      `${config.fileType}.json (${others.map((entry) => entry.name).join(', ')}). They are ` +
      `loaded by the game in filesystem order, so task 4.9's consolidate-and-replace save ` +
      `removes them in one commit; this save wrote the convention file and left them alone.`,
  ];
}

/** The path a **new** entry of `config`/`key` would be created at (D26 convention). */
export function createPathFor(root: string, config: ObjectTypeConfig, key: string): string {
  return createTargetPath(root, collectionSpec(config.fileType), key);
}
