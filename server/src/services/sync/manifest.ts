import { readFile } from 'node:fs/promises';

import { isPlainObject, parseJsonLenient } from './json.js';

/**
 * `TemplateManifest_deser.json` — the game's authoritative template id space
 * (task 1.4h, decision **D35**).
 *
 * The unpacked tree carries `TemplateManifest_deser.json` (17 MB) whose
 * `_object.m_serializedTemplates` is an array of `{ m_filename, m_id }` — the
 * id → source-file mapping for every template in the WAD (measured: 137,423
 * entries, all ids and all filenames distinct, 18,173 of them under `Spells/`).
 * That mapping is what the corpus actually references: `NpcSpellInventory`
 * `Spells[].TemplateID` / `RequiredSpellID`, `CreatureSpellbook
 * .SpellTemplateIds` and quest `m_spellID` are all `m_id` values.
 *
 * Why this module exists at all: the previous id space for `spells` was the
 * string-table index inside `m_displayName`, which is shared by two `.lang`
 * categories (`Spells_*` and `Spell_*`) — index 151 is "Freeze" under one and
 * "Snow Shield" under the other. 16,474 parsed spell rows collapsed onto 3,471
 * ids and the INTEGER primary key silently dropped 13,003 rows. `m_id` is
 * unique, is a positive INTEGER, and needs no schema change.
 *
 * File-format notes measured on the real manifest:
 *
 * - separators are already `/`, but `\` and a leading `./` are tolerated anyway
 *   (the WAD stores some families with either form), and paths are never
 *   absolute;
 * - a `m_filename` names the **`.xml`** source, which on disk is the sibling
 *   `<name>_deser.json` (see `deserPathToManifestPath` / `manifestPathToDeserPath`);
 * - entries are reported rather than fatal: a repeated id/filename or a
 *   malformed entry is counted and sampled, never thrown, because shedding one
 *   row must not abort a 137k-entry load.
 *
 * The 17 MB parsed document is **never retained**: `loadTemplateManifest` builds
 * the two maps and lets the array go out of scope on return.
 */

/** The manifest file name inside an unpack tree. */
export const TEMPLATE_MANIFEST_FILE = 'TemplateManifest_deser.json';

/** The `_object` key holding the template array. */
export const MANIFEST_TEMPLATES_KEY = 'm_serializedTemplates';

/** `…_deser.json` ↔ `….xml`. */
export const DESER_SUFFIX = '_deser.json';
export const XML_SUFFIX = '.xml';

/** How many malformed/duplicate entries are kept for the report. */
export const MANIFEST_SAMPLE_LIMIT = 5;

/** `\` → `/`, strip a leading `./`, trim. Empty when nothing usable is left. */
export function normalizeManifestFilename(raw: unknown): string {
  if (typeof raw !== 'string') {
    return '';
  }
  let value = raw.trim().replace(/\\/g, '/');
  while (value.startsWith('./')) {
    value = value.slice(2);
  }
  return value;
}

/** `<name>.xml` → `<name>_deser.json` (the on-disk sibling). */
export function manifestPathToDeserPath(fileName: string): string {
  return fileName.endsWith(XML_SUFFIX)
    ? `${fileName.slice(0, -XML_SUFFIX.length)}${DESER_SUFFIX}`
    : `${fileName}${DESER_SUFFIX}`;
}

/** `<name>_deser.json` → `<name>.xml` (the manifest spelling). */
export function deserPathToManifestPath(fileName: string): string {
  return fileName.endsWith(DESER_SUFFIX)
    ? `${fileName.slice(0, -DESER_SUFFIX.length)}${XML_SUFFIX}`
    : fileName;
}

/** One `{ m_filename, m_id }` pair after normalisation. */
export interface TemplateManifestEntry {
  /** Normalised `.xml` path, e.g. `Spells/Stun Block.xml`. */
  m_filename: string;
  /** Positive integer id — the value the corpus references. */
  m_id: number;
}

export interface TemplateManifestCounts {
  /** Raw array length of `_object.m_serializedTemplates`. */
  entries: number;
  /** Entries that produced a usable pair. */
  accepted: number;
  /** Entries rejected (blank/non-string filename, non-positive/non-integer id). */
  rejected: number;
  /** Distinct filenames retained in `byFile`. */
  files: number;
  /** Distinct ids retained in `byId`. */
  ids: number;
  /** Entries whose filename had already been seen (first wins). */
  duplicateFiles: number;
  /** Entries whose id had already been seen (first wins). */
  duplicateIds: number;
}

export interface TemplateManifest {
  /** Normalised `.xml` path → `m_id` (first entry wins). */
  byFile: ReadonlyMap<string, number>;
  /** `m_id` → normalised `.xml` path (first entry wins). */
  byId: ReadonlyMap<number, string>;
  counts: TemplateManifestCounts;
  /** Bounded samples of rejected entries (`raw` is a shortened JSON excerpt). */
  rejectedSamples: Array<{ index: number; reason: string; raw: string }>;
  /** Bounded samples of duplicate ids/filenames. */
  duplicateSamples: Array<{
    index: number;
    reason: 'duplicateId' | 'duplicateFile';
    m_id?: number;
    m_filename?: string;
    /** The entry that won (first wins). */
    kept?: { m_filename: string; m_id: number };
  }>;
}

/** Thrown when the document does not look like a template manifest at all. */
export class TemplateManifestError extends Error {}

function excerpt(value: unknown): string {
  try {
    const text = JSON.stringify(value) ?? String(value);
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  } catch {
    return String(value);
  }
}

/**
 * A positive, finite, integral id. `m_id` is a JSON number in the real file; a
 * decimal string is accepted too (imcodec has been inconsistent before) but
 * anything else — `0`, negative, fractional, `null`, a boolean — is rejected.
 */
function asManifestId(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

/** Locates the template array inside a parsed manifest document. */
function templatesArray(doc: unknown): unknown[] {
  if (!isPlainObject(doc)) {
    throw new TemplateManifestError(
      `TemplateManifest is not a JSON object (got ${doc === null ? 'null' : typeof doc}).`,
    );
  }
  const object = doc._object;
  if (!isPlainObject(object)) {
    throw new TemplateManifestError('TemplateManifest has no `_object` object.');
  }
  const templates = object[MANIFEST_TEMPLATES_KEY];
  if (!Array.isArray(templates)) {
    throw new TemplateManifestError(
      `TemplateManifest has no \`_object.${MANIFEST_TEMPLATES_KEY}\` array.`,
    );
  }
  return templates;
}

/**
 * Distils a parsed `TemplateManifest_deser.json` into id↔path maps.
 *
 * Throws only when the document is not a manifest at all; per-entry problems are
 * counted and sampled.
 */
export function parseTemplateManifest(doc: unknown): TemplateManifest {
  const templates = templatesArray(doc);
  const byFile = new Map<string, number>();
  const byId = new Map<number, string>();
  const rejectedSamples: TemplateManifest['rejectedSamples'] = [];
  const duplicateSamples: TemplateManifest['duplicateSamples'] = [];
  let rejected = 0;
  let duplicateFiles = 0;
  let duplicateIds = 0;

  for (let index = 0; index < templates.length; index += 1) {
    const raw = templates[index];
    const fileName = normalizeManifestFilename(isPlainObject(raw) ? raw.m_filename : undefined);
    const id = isPlainObject(raw) ? asManifestId(raw.m_id) : null;

    let reason = '';
    if (fileName === '') {
      reason = 'm_filename is missing/blank/not a string';
    } else if (id === null) {
      reason = 'm_id is not a positive integer';
    }
    if (reason !== '') {
      rejected += 1;
      if (rejectedSamples.length < MANIFEST_SAMPLE_LIMIT) {
        rejectedSamples.push({ index, reason, raw: excerpt(raw) });
      }
      continue;
    }

    const keptFile = byFile.get(fileName);
    const keptId = byId.get(id as number);
    if (keptFile !== undefined) {
      duplicateFiles += 1;
      if (duplicateSamples.length < MANIFEST_SAMPLE_LIMIT) {
        duplicateSamples.push({
          index,
          reason: 'duplicateFile',
          m_filename: fileName,
          m_id: id as number,
          kept: { m_filename: fileName, m_id: keptFile },
        });
      }
      continue;
    }
    if (keptId !== undefined) {
      duplicateIds += 1;
      if (duplicateSamples.length < MANIFEST_SAMPLE_LIMIT) {
        duplicateSamples.push({
          index,
          reason: 'duplicateId',
          m_filename: fileName,
          m_id: id as number,
          kept: { m_filename: keptId, m_id: id as number },
        });
      }
      continue;
    }

    byFile.set(fileName, id as number);
    byId.set(id as number, fileName);
  }

  return {
    byFile,
    byId,
    counts: {
      entries: templates.length,
      accepted: byFile.size,
      rejected,
      files: byFile.size,
      ids: byId.size,
      duplicateFiles,
      duplicateIds,
    },
    rejectedSamples,
    duplicateSamples,
  };
}

export interface LoadTemplateManifestDeps {
  /** Injected reader — tests never touch the real 17 MB file. */
  readFile?: (file: string) => Promise<string>;
  /** Parse function; strict JSON first with a JSON5 recovery (see `json.ts`). */
  parse?: (text: string) => unknown;
}

/**
 * Reads and parses a manifest from disk. The parsed document is a local, so the
 * 137k-entry array is collectable as soon as the maps are built.
 */
export async function loadTemplateManifest(
  file: string,
  deps: LoadTemplateManifestDeps = {},
): Promise<TemplateManifest> {
  const read = deps.readFile ?? ((target: string) => readFile(target, 'utf8'));
  const parse = deps.parse ?? parseJsonLenient;
  const doc = parse(await read(file));
  return parseTemplateManifest(doc);
}

/** Bounded provenance samples reported by the tree scan. */
export interface ManifestIdReport {
  /** `byFile.size` of the manifest the scan was given (`0` when none). */
  entries: number;
  /** Rows whose id came from the manifest. */
  assigned: number;
  /**
   * Rows whose id came from the legacy embedded source (`m_templateID`, or the
   * `m_displayName` index for a spell) — a subset of `missing`.
   */
  fallback: number;
  /** Rows where the manifest id and the embedded `m_templateID` disagree. */
  mismatches: number;
  /** Recognised rows with no manifest entry at all (may carry no id either). */
  missing: number;
  /** Bounded sample of the disagreeing rows. */
  mismatchSamples: Array<{ sourcePath: string; embeddedId: number; manifestId: number }>;
  /** Bounded sample of the rows missing from the manifest. */
  missingSamples: Array<{ sourcePath: string; manifestPath: string }>;
}

export const EMPTY_MANIFEST_ID_REPORT: ManifestIdReport = {
  entries: 0,
  assigned: 0,
  fallback: 0,
  mismatches: 0,
  missing: 0,
  mismatchSamples: [],
  missingSamples: [],
};
