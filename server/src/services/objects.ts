import fs from 'node:fs';
import path from 'node:path';

import type { ObjectFileType } from '../../../shared/naming.js';
import { ULong } from '../../../shared/ulong.js';
import type { ObjectTypeConfig } from '../../../shared/objectTypes.js';
import {
  GLOBAL_REGISTRY_FILE_NAME,
  globalRegistryFileOrder,
  mergeGlobalRegistry,
  type GlobalRegistryFile,
} from '../../../shared/simpleObjects/globalRegistry.js';
import type { Db } from '../db.js';
import {
  collectionSpec,
  createTargetPath,
  objectKeyFromData,
  readSpiraldbJson,
  relativeTo,
  SpiraldbFileError,
} from './spiraldbFiles.js';
import {
  createSavePipeline,
  type SaveObjectResult,
  type SaveOutcome,
  type SavePipeline,
} from './savePipeline.js';
import { createSpiraldbIndex, type SpiraldbIndex } from './spiraldbIndex.js';
import { FRIENDLY_SOURCE_SPECS } from './names.js';
import { ENGINE_OBJECT_TEMPLATE_MAX_ID } from './npcNames.js';
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
 * 3. `GlobalRegistry/` has **no `entry_status` rows at all** (it is editor-only, Q1),
 *    and this header originally claimed `ZoneTransfer/` had none either — **wrong**:
 *    `zone_transfer` carries 1205 rows from the first-startup import (D74(c)). The
 *    status join is a lookup that tolerates a missing row rather than an inner join,
 *    so a row without a status defaults to `extracted` (the schema default) instead
 *    of vanishing from the list.
 * 4. The four `TemplateID` families store a **number** in JSON and a **string** in
 *    `entry_status.object_key`. `shared/ulong.ts` is the only place that converts;
 *    this module uses its text direction for keys coming off disk and its number
 *    direction for the field being written.
 *
 * Story p4-07 (task 4.9, D22) completed the unkeyed family's two special paths, which p4-01
 * deliberately left open:
 *
 * - **read** — `readObject` serves the **merged view** of every `GlobalRegistry/*.json`
 *   (case-sensitive keys, later files win, in an explicit name order) instead of the one file a
 *   key names. The route key is therefore not a selector for this family, and a stale bookmark
 *   keeps working across a consolidation;
 * - **save** — a POST is a **consolidation**: one commit writes `globalregistry.json` and deletes
 *   the files the merge accounted for. A file the merge could not read, or that carries no
 *   wrapper object, is **left in place and reported** — this tool never deletes a file it did
 *   not read.
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
   * Display title. **Equal to `key` for all eight families** (the drop table's
   * `Name`, a zone path, an NPC template id): none of the eight has a separate
   * title field, unlike a quest's `m_questTitle`. The friendly half is
   * {@link ObjectListRow.friendly_name}, and the pairing happens in the client
   * through `display.ts`'s one rule — this server emits data and never formats.
   */
  title: string;
  /**
   * The family's friendly name for this key, resolved from the table
   * `config.friendlyNamesType` names (`npcs` for the four `TemplateID` families,
   * `zones` for ZoneTransfer), or `null` when there is none (D105/P6-16, spec
   * §Names L71-77).
   *
   * `null` has three distinct meanings, and the client renders the technical value
   * alone for all three (never a blank label, never a humaniser):
   *
   * 1. the family has no friendly source at all (DropTable, GlobalRegistry, and
   *    CreatureSpellbook until task 6.9 populates `decks`) — `config.friendlyNameNote`
   *    carries the reason and is what the UI says;
   * 2. the template is an **engine object** — the low-id client templates
   *    (`Player Object`, `GenericCinematicActor`, …), which are not characters;
   * 3. the key simply has no row in the friendly table (5 corpus rows today:
   *    `40448`, `164313`, `789125`, `1528509`, `1749527`).
   */
  friendly_name: string | null;
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

/**
 * `key → friendly name` for one family, or `null` when the family has no friendly
 * source (DropTable and GlobalRegistry permanently; CreatureSpellbook gained one in
 * task 6.9, when `decks` was populated).
 *
 * Built from `FRIENDLY_SOURCE_SPECS` (`names.ts`) — one row per name, and the same
 * object `GET /api/names/:type` serves wherever that endpoint serves one — so the
 * list row's `friendly_name` and the names API's own label cannot come from two
 * different columns. One query per list request (23,033 + 3,357 rows worst case) —
 * the list already scans and parses ~2,000 corpus files per request (D12), so this
 * is a rounding error, and caching it would go stale silently after a sync.
 *
 * NpcInv/Spell/DropTable/TreasureCard keys are `ULong.toKey` strings, so the map is
 * keyed by the decimal text of `template_id`; a zone key is the path verbatim; a
 * CreatureSpellbook key is the `DeckTemplate` `m_name` verbatim.
 */
function friendlyNameLookup(db: Db, config: ObjectTypeConfig): Map<string, string> | null {
  const type = config.friendlyNamesType;
  if (type === null) {
    return null;
  }
  // `FRIENDLY_SOURCE_SPECS`, not `NAMES_TYPE_SPECS`: `decks` (task 6.9) is a friendly source the
  // names API deliberately does not serve (D112's frozen seven), and both maps share one row per
  // name they do serve.
  const spec = FRIENDLY_SOURCE_SPECS[type];
  const rows = db
    .prepare<[], { id: unknown; name: unknown }>(
      `SELECT ${spec.idColumn} AS id, ${spec.labelColumn} AS name FROM ${spec.table}`,
    )
    .all();

  const lookup = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.name !== 'string' || row.name.trim() === '') {
      continue;
    }
    if (type === 'npcs' && Number(row.id) <= ENGINE_OBJECT_TEMPLATE_MAX_ID) {
      continue;
    }
    lookup.set(String(row.id), row.name);
  }
  return lookup;
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
  // an inner join — the unkeyed GlobalRegistry family has no rows at all, and a
  // future family may not either.
  const statusByKey = new Map<string, string>();
  if (config.objectType !== null) {
    for (const entry of listStatus(db, [config.objectType]).entries) {
      statusByKey.set(entry.object_key, entry.status);
    }
  }

  const summary: StatusSummary = { total: 0, extracted: 0, reviewed: 0, verified: 0 };
  const seen = new Set<string>();
  const objects: ObjectListRow[] = [];
  // Resolved once per request, from the same table the names API serves; `null`
  // for the three families that have no friendly source (never a humaniser).
  const friendlyNames = friendlyNameLookup(db, config);

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

    objects.push({
      key,
      title: key,
      friendly_name: friendlyNames?.get(key) ?? null,
      modified_at: modifiedAt(filePath),
      status,
    });
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
 * The **merged** registry view — the unkeyed family's read (AC1, D22).
 *
 * docs/spec-domain-reference.md L102-119: `GlobalRegistry/` is *one merged dictionary* spread
 * over all its files. So the unkeyed family's detail read merges **every** `*.json` in the
 * directory, in {@link globalRegistryFileOrder}'s explicit name order (later files win), rather
 * than serving the one file the route key happens to name.
 *
 * Three consequences are deliberate:
 *
 * - **The route key is not an identity.** The family has exactly one logical entry, so any key
 *   resolves to the merged view while at least one file exists. That is what keeps a bookmark
 *   working. That is what keeps a bookmark working across a consolidation (the route key before
 *   a save is the legacy file stem; after it the only file is `globalregistry.json`) and it is
 *   why a stale detail URL does not 404 — the file whose stem matches is still picked for
 *   `path`, and `path` is the only thing the key decides.
 * - **No file means no entry** (`undefined` ⇒ 404): a directory with nothing to read is the
 *   create path, not an empty registry.
 * - **An unreadable file does not 500 the view.** It is reported by the list's `skipped[]`
 *   instead. That omission is *consistent* with the save path, which never deletes a file the
 *   merge did not account for — so a file this read could not include is also a file the next
 *   save leaves alone.
 */
function readUnkeyedObject(options: ReadObjectOptions): ObjectDetail | undefined {
  const { config, index, key } = options;
  const directory = path.join(index.root, config.directory);
  const entries = jsonEntries(directory) ?? [];
  if (entries.length === 0) {
    return undefined;
  }

  const { merge } = mergeRegistryDirectory(directory, entries);

  // The file the route key names, when one does; otherwise the convention file; otherwise the
  // first in name order. `path` is informational for this family (the view merges them all).
  const resolved =
    entries.find((entry) => entry.name === `${key}.json`) ??
    entries.find((entry) => entry.name === GLOBAL_REGISTRY_FILE_NAME) ??
    entries[0];

  return { path: path.join(directory, resolved.name), key, object: merge.document };
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
  if (config.keyField === null) {
    return readUnkeyedObject(options);
  }

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

/**
 * The merged view of one `GlobalRegistry/` directory, plus the files that did **not** take part.
 *
 * The read path uses `merge` (its `skipped[]` names the documents that carry no wrapper object);
 * the save path uses both lists, because only a file the merge **accounted for** may be deleted.
 * A file whose text `readSpiraldbJson` cannot parse is listed in `unreadable` rather than
 * throwing: the list endpoint reports it in `skipped[]`, and the consolidating save refuses to
 * delete it. That is the whole point of the split — a file the tool did not understand is never
 * destroyed by the tool.
 */
function mergeRegistryDirectory(
  directory: string,
  entries: readonly fs.Dirent[],
): {
  merge: ReturnType<typeof mergeGlobalRegistry>;
  unreadable: string[];
} {
  const readable: GlobalRegistryFile[] = [];
  const unreadable: string[] = [];
  for (const entry of entries) {
    try {
      readable.push({
        name: entry.name,
        document: readSpiraldbJson(path.join(directory, entry.name)),
      });
    } catch {
      unreadable.push(entry.name);
    }
  }

  // The merge order is injected and explicit, never `readdir`'s (D22).
  const order = globalRegistryFileOrder(readable.map((file) => file.name));
  const byName = new Map(readable.map((file) => [file.name, file]));
  const merge = mergeGlobalRegistry(
    order.map((name) => byName.get(name) ?? { name, document: undefined }),
  );
  return { merge, unreadable };
}

/**
 * The path a **keyed** family's `key` resolves to, without reading it: the D19 content-keyed
 * index, never a derived filename.
 *
 * The keyed families are all this has to answer for — the unkeyed `GlobalRegistry/` family is
 * resolved by {@link readUnkeyedObject}, which merges the whole directory and picks the file its
 * route key names (or the convention file) for `path`. There is deliberately **one** resolution
 * rule per family shape rather than a second one left behind here.
 */
function resolveObjectPath(options: ReadObjectOptions): string | undefined {
  const { config, index, key } = options;
  return index.pathFor(config.fileType, key);
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
 * A malformed or invalid `POST` body — the route maps it to **400**. Covers the things a
 * caller can fix by resending: a missing `object`, a non-string `notes`/`key`, a key the
 * family's key type cannot express, and — since task 4.2 — the failure of a family's own
 * blocking validation. Pipeline problems are *not* this error and still map to 500.
 *
 * {@link fields} is the per-field error map the 400 body carries, exactly the shape
 * `QuestRequestError` uses (D65): path → messages, keyed by the shared `formatDocPath`, so a
 * client can render each message under the control that owns it. Hand-written body checks
 * leave it `undefined`, which is the pre-4.2 `{error}`-only body.
 */
export class ObjectRequestError extends Error {
  readonly fields?: Record<string, string[]>;

  constructor(message: string, fields?: Record<string, string[]>) {
    super(message);
    this.name = 'ObjectRequestError';
    this.fields = fields;
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
  /**
   * The family's own blocking validation, or `undefined` for the families that have none.
   * Called once per save, after the body's shape is checked and the family's index is
   * refreshed, so it sees the corpus as it is on disk right now (task 4.2's DropTable rules).
   */
  validate?: ObjectSaveValidator;
}

/** What a family's save validator receives. Everything it needs is already built. */
export interface ObjectSaveValidationContext {
  db: Db;
  /** The family's row of `shared/objectTypes.ts`. */
  config: ObjectTypeConfig;
  /** The SpiralDB root the save will write into. */
  root: string;
  /** The family's content-keyed index, refreshed for this save (`index.keys(config.fileType)`). */
  index: SpiraldbIndex;
  /** The raw request body, exactly as received. */
  body: unknown;
}

/**
 * A family's blocking validation of a save body. It either returns (the save proceeds) or
 * throws {@link ObjectRequestError} with a field map (the route answers 400). Deliberately a
 * plain function of an already-built context: the rule itself lives in `shared/`, so this is
 * only the wiring that injects the corpus and the reference tables.
 */
export type ObjectSaveValidator = (context: ObjectSaveValidationContext) => void;

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

  // D12/D19: refresh this family so create-vs-update and the resolved path reflect
  // disk right now, and so the family's own validation sees the corpus as it is.
  index.rebuildType(config.fileType);

  // Task 4.2: the family's own blocking rules, run before the generic key resolution.
  //
  // The order is deliberate. `Name` is a drop table's key, so an empty `Name` fails the
  // generic "no usable key" check *and* the engine's `drop-table-name-missing` rule; running
  // the engine first means the caller gets the **field-mapped** diagnosis (`fields.Name`)
  // rather than the pre-4.2 key sentence, which is the shape D65 fixes for every blocking
  // rule. A family with a validator therefore never reaches the key check with a document its
  // own rules reject.
  //
  // The engine is the shared one (`shared/dropTable/validation.ts`) with this save's corpus
  // injected — `body.key` is the entry being edited (the route key the user opened), so its
  // own name is forgiven and an unmodified save never 400s against itself.
  options.validate?.({
    db: options.db,
    config,
    root: index.root,
    index,
    body: options.body,
  });

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

  // Task 4.9 / D22: the unkeyed family's save is a **consolidation**. The delete list is computed
  // from the live directory (never assumed) and restricted to the files this save actually
  // accounts for: a file the merge could not read, or that carries no wrapper object, is
  // reported and **left in place** rather than destroyed (the named failure mode "deleting a file
  // the merge did not account for").
  const consolidation =
    config.fileType === 'globalregistry' ? registryConsolidation(config, index) : null;

  const result = await pipeline.saveObject({
    fileType: config.fileType,
    data,
    ...(key === undefined ? {} : { key }),
    action: 'create',
    ...(typeof body.notes === 'string' ? { notes: body.notes } : {}),
    ...(consolidation === null || consolidation.remove.length === 0
      ? {}
      : { removePaths: consolidation.remove }),
    historyNotesOnCreate: CREATED_VIA_UI_NOTE,
  });

  const warnings = consolidation === null ? [] : consolidationWarnings(consolidation, index.root);

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

/** What one unkeyed save consolidates: the files it replaces, and the ones it must leave. */
interface RegistryConsolidation {
  /** Absolute paths of the files this save deletes in **the same commit**. */
  remove: string[];
  /** Absolute paths of the files the save could not account for, so it leaves them alone. */
  leftovers: string[];
}

/**
 * The consolidation plan for one `GlobalRegistry/` save, computed from the directory as it is at
 * save time (D22).
 *
 * A file is deletable only when the merge **accounted for** it — i.e. it parsed *and* carried a
 * `GlobalRegistryValues` object. Everything else (unreadable text, a JSON array, a document with
 * no wrapper) stays on disk and is reported in the save's `warnings`, which is deliberately
 * narrower than "delete every other `*.json`": this tool never destroys a file it did not read.
 * The convention file itself is never in the delete list.
 */
function registryConsolidation(
  config: ObjectTypeConfig,
  index: SpiraldbIndex,
): RegistryConsolidation {
  const directory = path.join(index.root, config.directory);
  const entries = jsonEntries(directory) ?? [];
  const { merge, unreadable } = mergeRegistryDirectory(directory, entries);
  const accountedFor = new Set(merge.files);
  const remove: string[] = [];
  const leftovers: string[] = [];

  for (const entry of entries) {
    if (entry.name === GLOBAL_REGISTRY_FILE_NAME) {
      continue;
    }
    if (accountedFor.has(entry.name)) {
      remove.push(path.join(directory, entry.name));
    } else {
      leftovers.push(path.join(directory, entry.name));
    }
  }
  for (const name of unreadable) {
    const candidate = path.join(directory, name);
    if (!leftovers.includes(candidate)) {
      leftovers.push(candidate);
    }
  }
  return { remove, leftovers };
}

/**
 * The two sentences a consolidation reports.
 *
 * A success note names exactly what the one commit replaced (the PR diff is the review surface,
 * D22); a leftover note names what was **not** deleted and why — the honest half of a
 * consolidate-and-replace that refuses to guess.
 */
function consolidationWarnings(consolidation: RegistryConsolidation, root: string): string[] {
  const warnings: string[] = [];
  const relative = (candidate: string): string => path.relative(root, candidate);
  if (consolidation.remove.length > 0) {
    warnings.push(
      `Consolidated ${consolidation.remove.length} file(s) into GlobalRegistry/${GLOBAL_REGISTRY_FILE_NAME} ` +
        `in one commit: ${consolidation.remove.map(relative).join(', ')}.`,
    );
  }
  if (consolidation.leftovers.length > 0) {
    warnings.push(
      `Left ${consolidation.leftovers.length} file(s) in GlobalRegistry/ that this save could not ` +
        `account for (${consolidation.leftovers
          .map((candidate) => path.basename(candidate))
          .join(', ')}); they are not part of the merged view and were not deleted.`,
    );
  }
  return warnings;
}

/** The path a **new** entry of `config`/`key` would be created at (D26 convention). */
export function createPathFor(root: string, config: ObjectTypeConfig, key: string): string {
  return createTargetPath(root, collectionSpec(config.fileType), key);
}
