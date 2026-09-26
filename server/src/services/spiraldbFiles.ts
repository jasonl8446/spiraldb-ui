import fs from 'node:fs';
import path from 'node:path';

import { fileNameFor, UNKEYED_FILE_NAME, type ObjectFileType } from '../../../shared/naming.js';
import type { StatusObjectType } from './status.js';
import { isPlainObject, parseJsonLenient } from './sync/json.js';

/**
 * SpiralDB file layer — the primitives every SpiralDB read and write goes
 * through (task 2.4 / story p2-05; docs/spec-data-model.md L171-253).
 *
 * Four things live here, and nothing else does:
 *
 * 1. **The collection table** — one row per file family: its directory, the JSON
 *    field holding the key, the `entry_status.object_type` it feeds (or `null`
 *    for the two families with no lifecycle), the token used in commit messages,
 *    and whether it is a save target. The naming *convention* itself is not
 *    duplicated: `fileNameFor` / `parseFileName` in `shared/naming.ts` are the
 *    single home of `{prefix}_{key}.json` (docs/spec-data-model.md L175-187).
 * 2. **The readers and the writer** — reads are JSON5-tolerant because most
 *    corpus files carry trailing commas (L234-245); writes are clean
 *    `JSON.stringify(data, null, 2)` (L247-253).
 * 3. **The null/absent-key-preserving merge** used by update saves, which is what
 *    keeps D45(1)'s diff minimal (see `mergePreservingAbsent`).
 * 4. **The quest metadata shape** (L191-204) — the only companion file family in
 *    the model, paired by content, not by filename (decision D20).
 */

/** Raised for any SpiralDB file/key problem: always actionable, always names the file. */
export class SpiraldbFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpiraldbFileError';
  }
}

/** One file family of the SpiralDB repository. */
export interface SpiraldbCollectionSpec {
  /** Type id shared with the naming table (`shared/naming.ts`). */
  fileType: ObjectFileType;
  /** Directory under the SpiralDB root (docs/spec-data-model.md L266-275). */
  directory: string;
  /**
   * Top-level JSON field the key is read from, or `null` for the unkeyed
   * `GlobalRegistry` family (one file, a merged dictionary — L187).
   */
  keyField: string | null;
  /** `entry_status.object_type` value, or `null` when the family has no lifecycle. */
  objectType: StatusObjectType | null;
  /** Token used in the commit message (`spiraldb: {action} {commitType} {key}`). */
  commitType: string;
  /** `true` when the save pipeline may write this family directly. */
  saveable: boolean;
}

/**
 * The collection table.
 *
 * Directories and key fields are the ones measured in the corpus
 * (`IMPORT_TYPE_SPECS` in `./import.ts` holds the same eight rows for the
 * first-startup scan; a unit test cross-checks the two tables so they cannot
 * drift). `questmetadata` is present because pairing is a *content* lookup
 * (D20) and the index treats it like any other keyed family; it is not a save
 * target on its own — it is written with its quest. `globalregistry` is the
 * single-file special case: unkeyed, no status lifecycle (Q1), and its
 * consolidate-and-replace save (D22) belongs to task 4.9.
 */
export const SPIRALDB_COLLECTIONS: readonly SpiraldbCollectionSpec[] = [
  {
    fileType: 'questtemplates',
    directory: 'QuestTemplates',
    keyField: 'm_questName',
    objectType: 'quest',
    commitType: 'quest',
    saveable: true,
  },
  {
    fileType: 'droptable',
    directory: 'DropTables',
    keyField: 'Name',
    objectType: 'drop_table',
    commitType: 'drop_table',
    saveable: true,
  },
  {
    fileType: 'npcinventory',
    directory: 'NpcInventory',
    keyField: 'TemplateID',
    objectType: 'npc_inventory',
    commitType: 'npc_inventory',
    saveable: true,
  },
  {
    fileType: 'npcspellinventory',
    directory: 'NpcSpellInventory',
    keyField: 'TemplateID',
    objectType: 'npc_spell_inventory',
    commitType: 'npc_spell_inventory',
    saveable: true,
  },
  {
    fileType: 'creaturespellbook',
    directory: 'CreatureSpellbook',
    keyField: 'DeckName',
    objectType: 'creature_spellbook',
    commitType: 'creature_spellbook',
    saveable: true,
  },
  {
    fileType: 'npcdroptable',
    directory: 'NpcDropTable',
    keyField: 'TemplateID',
    objectType: 'npc_drop_table',
    commitType: 'npc_drop_table',
    saveable: true,
  },
  {
    fileType: 'treasurecardinventory',
    directory: 'TreasureCardInventory',
    keyField: 'TemplateID',
    objectType: 'treasure_card_inventory',
    commitType: 'treasure_card_inventory',
    saveable: true,
  },
  {
    fileType: 'zonetransfer',
    directory: 'ZoneTransfer',
    keyField: 'ZoneName',
    objectType: 'zone_transfer',
    commitType: 'zone_transfer',
    saveable: true,
  },
  {
    fileType: 'questmetadata',
    directory: 'QuestMetadatas',
    keyField: 'Name',
    objectType: null,
    commitType: 'quest_metadata',
    saveable: false,
  },
  {
    fileType: 'globalregistry',
    directory: 'GlobalRegistry',
    keyField: null,
    objectType: null,
    commitType: 'global_registry',
    saveable: true,
  },
];

const COLLECTION_BY_TYPE = new Map<ObjectFileType, SpiraldbCollectionSpec>(
  SPIRALDB_COLLECTIONS.map((spec) => [spec.fileType, spec]),
);

/** Spec families the save pipeline may write. */
export const SAVEABLE_COLLECTIONS: readonly SpiraldbCollectionSpec[] = SPIRALDB_COLLECTIONS.filter(
  (spec) => spec.saveable,
);

/** A spec row whose `keyField` is known — everything the content-keyed index can scan. */
export interface IndexedCollectionSpec extends SpiraldbCollectionSpec {
  keyField: string;
}

/** Spec families the content-keyed index can scan (every keyed family). */
export const INDEXED_COLLECTIONS: readonly IndexedCollectionSpec[] = SPIRALDB_COLLECTIONS.filter(
  (spec): spec is IndexedCollectionSpec => spec.keyField !== null,
);

/** The spec row for a file type; never returns `undefined` for the ten known types. */
export function collectionSpec(fileType: ObjectFileType): SpiraldbCollectionSpec {
  const spec = COLLECTION_BY_TYPE.get(fileType);
  if (spec === undefined) {
    throw new SpiraldbFileError(
      `Unknown SpiralDB collection "${String(fileType)}". Known types: ${SPIRALDB_COLLECTIONS.map(
        (row) => row.fileType,
      ).join(', ')}`,
    );
  }
  return spec;
}

/**
 * Normalises a parsed key field to the string used in `entry_status.object_key`
 * and in the index: strings pass through (an empty string is "no key"), finite
 * numbers are stringified (`TemplateID` is numeric in every existing file but the
 * column is text — docs/spec-data-model.md L270-274). Anything else — missing,
 * `null`, objects, arrays, `NaN` — has no key.
 *
 * Identical in behaviour to `normalizeImportKey` in `./import.ts`; the two are
 * kept apart so this module never depends on the first-startup import, and a unit
 * test asserts they agree on a table of inputs.
 */
export function normalizeKeyValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value === '' ? undefined : value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

/** The key a parsed document carries in `keyField`, or `undefined`. */
export function objectKeyFromData(data: unknown, keyField: string): string | undefined {
  if (!isPlainObject(data)) {
    return undefined;
  }
  return normalizeKeyValue(data[keyField]);
}

/**
 * The key of the object being saved: an explicit `key` wins (callers that know it
 * — the extraction flow does — never rely on the body), otherwise it is read from
 * the family's key field.
 *
 * @throws {SpiraldbFileError} when neither yields a usable key — writing a file
 * without one would create an unaddressable entry.
 */
export function resolveObjectKey(
  spec: SpiraldbCollectionSpec,
  data: unknown,
  explicitKey?: string,
): string {
  if (explicitKey !== undefined) {
    const normalised = normalizeKeyValue(explicitKey);
    if (normalised === undefined) {
      throw new SpiraldbFileError(`Cannot save a ${spec.fileType}: the supplied key is empty.`);
    }
    return normalised;
  }

  if (spec.keyField === null) {
    // The unkeyed family (GlobalRegistry) is a single *merged dictionary*, so its
    // object key is the family's own name — `spiraldb: update global_registry
    // globalregistry` (decision D22), not the file name it lands in.
    return spec.fileType;
  }

  const key = objectKeyFromData(data, spec.keyField);
  if (key === undefined) {
    throw new SpiraldbFileError(
      `Cannot save a ${spec.fileType}: the object has no usable "${spec.keyField}" value ` +
        `(expected a non-empty string or a finite number).`,
    );
  }
  return key;
}

/**
 * Reads one SpiralDB file. JSON5-tolerant on purpose: 306 of the 322 corpus quest
 * files carry trailing commas, which strict `JSON.parse` rejects
 * (docs/spec-data-model.md L234-245). The corpus reader in `./sync/json.ts` is
 * reused (strict `JSON.parse` first, JSON5 as the recovery path) — same result as
 * `JSON5.parse` for every input JSON5 accepts, without the JSON5 grammar cost on
 * the clean files.
 *
 * @throws {SpiraldbFileError} unreadable or unparsable — the message names the file.
 */
export function readSpiraldbJson(filePath: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new SpiraldbFileError(
      `Could not read SpiralDB file ${filePath}: ${describeError(error)}`,
    );
  }
  try {
    return parseJsonLenient(text);
  } catch (error) {
    throw new SpiraldbFileError(
      `Could not parse SpiralDB file ${filePath} as JSON: ${describeError(error)}`,
    );
  }
}

/**
 * The exact bytes written for a document: `JSON.stringify(data, null, 2)` plus a
 * trailing newline.
 *
 * The spec's snippet (L247-253) shows only the `stringify` call; the newline is a
 * deliberate addition. The corpus (and every editor locally) uses newline-terminated
 * files, and omitting it makes every update diff report "\ No newline at end of
 * file" — exactly the noise D45(1) asks this story to minimise. The result is
 * still clean JSON: `JSON.parse` accepts it unchanged.
 */
export function stringifySpiraldbJson(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

/**
 * Writes a document as clean JSON, creating the directory when missing (the
 * first save of an absent family, e.g. `NpcDropTable/`, must work).
 *
 * @throws {SpiraldbFileError} when the write fails — the message names the file.
 */
export function writeSpiraldbJson(filePath: string, data: unknown): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, stringifySpiraldbJson(data));
  } catch (error) {
    throw new SpiraldbFileError(
      `Could not write SpiralDB file ${filePath}: ${describeError(error)}`,
    );
  }
}

/**
 * The path a **new** entry is written to: the convention name inside the family's
 * directory (`fileNameFor`), or the single `globalregistry.json` for the unkeyed
 * family.
 *
 * Only creates use this. An update writes back to the path the index found, so an
 * off-convention legacy filename is never renamed (decision D19).
 */
export function createTargetPath(root: string, spec: SpiraldbCollectionSpec, key: string): string {
  const name = spec.keyField === null ? UNKEYED_FILE_NAME : fileNameFor(spec.fileType, key);
  return path.join(root, spec.directory, name);
}

/**
 * Merges a saved object into the document already on disk so that a key the
 * incoming object *omits* keeps its existing value (decision D45(1)).
 *
 * Why this exists: the CLI serializes with Newtonsoft
 * `TypeNameHandling.Auto + NullValueHandling.Ignore` (D45(1)), so it drops the
 * keys the corpus carries as explicit `null` (`"m_questInfo": null`). Overwriting
 * the corpus file with that output rewrites every such line and buries the real
 * edit in diff noise. The merge keeps them.
 *
 * Rules, in full:
 *
 * - **Objects** — the result starts from the existing keys *in their existing
 *   order* (so serialization reproduces the file's layout), each replaced by the
 *   merged value when the incoming object also carries it; keys only the incoming
 *   object has are appended in the incoming order. A key only the *existing*
 *   object has is kept verbatim — including a `null` the incoming object omitted.
 * - **Arrays** — element `i` is merged into the existing element `i`, and the
 *   result takes the *incoming* length. Array order and membership are the
 *   editor's, so an edit that removes or reorders elements must survive; merging
 *   element objects index-wise is what preserves omitted keys inside them.
 * - **Anything else** — the incoming value wins, including an explicit `null`
 *   (clearing a field is an edit, not an omission).
 *
 * The consequence to know about: a key cannot be *deleted* by omitting it — D5's
 * merge-not-replace is one-directional by design, and the corpus keeps fields
 * this editor has no form for (e.g. ZoneTransfer's `Events`).
 */
export function mergePreservingAbsent(existing: unknown, incoming: unknown): unknown {
  if (isPlainObject(existing) && isPlainObject(incoming)) {
    const merged: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(existing)) {
      merged[key] = Object.prototype.hasOwnProperty.call(incoming, key)
        ? mergePreservingAbsent(value, incoming[key])
        : value;
    }
    for (const [key, value] of Object.entries(incoming)) {
      if (!Object.prototype.hasOwnProperty.call(merged, key)) {
        merged[key] = value;
      }
    }
    return merged;
  }

  if (Array.isArray(existing) && Array.isArray(incoming)) {
    return incoming.map((item, index) =>
      index < existing.length ? mergePreservingAbsent(existing[index], item) : item,
    );
  }

  return incoming;
}

/** `QuestTemplateId` written into a quest's metadata (docs/spec-data-model.md L195). */
export function questTemplateIdFor(name: string): string {
  return `questtemplates/${name}`;
}

/** The `Description` an extraction save writes (docs/spec-data-model.md L197). */
export const EXTRACTED_QUEST_METADATA_DESCRIPTION = 'Quest extracted from packet capture.';

/** The metadata keys, in the spec's order (docs/spec-data-model.md L193-204). */
export const QUEST_METADATA_KEYS = [
  'QuestTemplateId',
  'Name',
  'Description',
  'CreatedAt',
  'ModifiedAt',
  'CreatedBy',
  'ModifiedBy',
] as const;

export interface QuestMetadataInput {
  /** ISO timestamp for `CreatedAt`/`ModifiedAt` on a create, `ModifiedAt` on an update. */
  now: string;
  /** `settings.user_name` — `CreatedBy`/`ModifiedBy`. */
  user: string;
  /** Overrides the extraction wording (create only); later create flows pass their own. */
  description?: string;
}

/**
 * A brand-new quest metadata document: exactly the seven keys of
 * docs/spec-data-model.md L193-204, in the spec's order.
 */
export function buildQuestMetadata(
  name: string,
  input: QuestMetadataInput,
): Record<string, string> {
  return {
    QuestTemplateId: questTemplateIdFor(name),
    Name: name,
    Description: input.description ?? EXTRACTED_QUEST_METADATA_DESCRIPTION,
    CreatedAt: input.now,
    ModifiedAt: input.now,
    CreatedBy: input.user,
    ModifiedBy: input.user,
  };
}

/**
 * The updated view of an existing metadata document (decision D20: update the
 * paired file *in place*): `ModifiedAt`/`ModifiedBy` are refreshed and every other
 * field — `CreatedAt`, `CreatedBy`, `Description`, and anything a legacy file
 * carries beyond the seven keys — is preserved, keeping the file's key order.
 *
 * @throws {SpiraldbFileError} when the file exists but is not a JSON object.
 */
export function refreshQuestMetadata(
  existing: unknown,
  input: QuestMetadataInput,
): Record<string, unknown> {
  if (!isPlainObject(existing)) {
    throw new SpiraldbFileError(
      'Cannot update quest metadata: the paired metadata file is not a JSON object.',
    );
  }
  const refreshed: Record<string, unknown> = { ...existing };
  refreshed.ModifiedAt = input.now;
  refreshed.ModifiedBy = input.user;
  return refreshed;
}

/** `error.message` for a caught value, so a wrapped message always has a cause. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
