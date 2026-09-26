import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { isPlainObject, parseJsonLenient } from './json.js';
import {
  MANIFEST_SAMPLE_LIMIT,
  deserPathToManifestPath,
  type ManifestIdReport,
  type TemplateManifest,
} from './manifest.js';

/**
 * Template parsers — tasks 1.4d + 1.4h
 * ([plan-phase-1-foundation.md](../../../../docs/plan-phase-1-foundation.md) §1.4d
 * §1.4h, decisions **D33(a)/(b)** and **D35**, spike 1.4a §4).
 *
 * Three spec assumptions are wrong in the real data (D33):
 *
 * 1. **Families are discriminated by the JSON `_className`, never by file name or
 *    path** — globbing `*ItemTemplate*` matches zero files. The real class names
 *    are `WizItemTemplate` (76,679), `ItemBundleTemplate` (1,810),
 *    `ReagentItemTemplate` (867), `PetSnackItemTemplate` (478), `ItemTemplate` (2);
 *    `SpellTemplate` (14,856), `TieredSpellTemplate` (2,579) plus any other
 *    `*SpellTemplate` class (D35: `CastleMagicSpellTemplate` 290,
 *    `CantripsSpellTemplate` 162, `GardenSpellTemplate` 143,
 *    `WhirlyBurlySpellTemplate` 94, `FishingSpellTemplate` 49);
 *    `WizGameObjectTemplate` (15,190), `GameObjectTemplate` (7,698);
 *    `WizPetTemplate` (143), `WizMountTemplate` (2). **`ActorTemplate` does not exist.**
 * 2. The friendly-name field is **`m_displayName`**, not `m_name` (`m_name` exists
 *    only on `SpellTemplate`). Ladder: `m_displayName` → resolved string-table
 *    value → raw key → `m_objectName`.
 * 3. Pets and mounts are folded into `npcs` so ID lookups never miss (the plan's
 *    "flat list, no type classification").
 *
 * ## The id comes from the manifest (D35 / task 1.4h)
 *
 * Every row's id is looked up in `TemplateManifest_deser.json` by its source path
 * (`<filename>.xml` ↔ `<filename>_deser.json`) — see `manifest.ts`. The per-file
 * `m_templateID` is kept as a **cross-check**, not as the source:
 *
 * - the manifest id wins whenever the source path has an entry (`idSource: 'manifest'`);
 * - a row with no manifest entry falls back to the legacy id — `m_templateID` for
 *   the object-derived families, the `m_displayName` string-table index for spells
 *   — and is counted in `manifest.missing`;
 * - a row where both exist and disagree is counted in `manifest.mismatches` with a
 *   bounded sample. Measured on the real tree: 0 of 123,041 rows are missing from
 *   the manifest and 0 disagree.
 *
 * That replaces the old keying, which used the string-table index of
 * `m_displayName` for spells. The index space is shared by the `.lang` categories
 * `Spells_*` and `Spell_*` (index 151 = "Freeze" *and* "Snow Shield"), so 16,474
 * parsed rows collapsed onto 3,471 ids and the INTEGER primary key dropped 13,003.
 * The manifest gives 18,173 distinct spell ids — exactly the `Spells/` entry count.
 *
 * `m_templateID` is a JSON number but the verification schema keys entries by
 * *string* (`entry_status.object_key`, [spec-data-model.md] L262-274), so every
 * row carries both `id` (number) and `idText` (decimal string).
 *
 * Documents are parsed, distilled into a row, and dropped — the scanner never
 * retains a whole `_deser.json` (123,042 files under the two scanned roots).
 */

/** `_className` values that belong to the `items` table (D33(a)). */
export const ITEM_CLASSES = [
  'WizItemTemplate',
  'ItemBundleTemplate',
  'ReagentItemTemplate',
  'PetSnackItemTemplate',
  'ItemTemplate',
] as const;

/** `_className` values that belong to the `spells` table (D33(a) + D35). */
export const SPELL_CLASSES = ['SpellTemplate', 'TieredSpellTemplate'] as const;

/**
 * Any other class ending in this suffix is a spell too (D35): the measured
 * `CastleMagicSpellTemplate` (290), `CantripsSpellTemplate` (162),
 * `GardenSpellTemplate` (143), `WhirlyBurlySpellTemplate` (94) and
 * `FishingSpellTemplate` (49) bring the family to the manifest's 18,173.
 */
export const SPELL_CLASS_SUFFIX = 'SpellTemplate';

/** `_className` values that belong to the `npcs` table (D33(a)). */
export const NPC_CLASSES = ['WizGameObjectTemplate', 'GameObjectTemplate'] as const;

/** Pets — folded into `npcs`. */
export const PET_CLASSES = ['WizPetTemplate'] as const;

/** Mounts — folded into `npcs`. */
export const MOUNT_CLASSES = ['WizMountTemplate'] as const;

export type TemplateFamily = 'item' | 'spell' | 'npc' | 'pet' | 'mount';

/** Tree roots the scanner walks — the two directories that hold templates (D33(a)). */
export const TEMPLATE_SCAN_ROOTS = ['ObjectData', 'Spells'] as const;

const CLASS_TO_FAMILY: ReadonlyMap<string, TemplateFamily> = new Map([
  ...ITEM_CLASSES.map((name) => [name, 'item'] as const),
  ...SPELL_CLASSES.map((name) => [name, 'spell'] as const),
  ...NPC_CLASSES.map((name) => [name, 'npc'] as const),
  ...PET_CLASSES.map((name) => [name, 'pet'] as const),
  ...MOUNT_CLASSES.map((name) => [name, 'mount'] as const),
]);

/**
 * Classifies a `_className`; `undefined` for every class that is not a friendly
 * name. Exact matches win first, so the item/NPC families are unaffected by the
 * `*SpellTemplate` suffix rule (D35).
 */
export function classifyTemplateClass(className: string): TemplateFamily | undefined {
  const exact = CLASS_TO_FAMILY.get(className);
  if (exact !== undefined) {
    return exact;
  }
  return className.endsWith(SPELL_CLASS_SUFFIX) ? 'spell' : undefined;
}

/** How the row's display name was derived. */
export type TemplateNameSource = 'resolved' | 'rawKey' | 'objectName' | 'spellName';

/** Where the row's numeric id came from. */
export type TemplateIdSource = 'manifest' | 'm_templateID' | 'displayNameIndex' | 'none';

export interface TemplateRow {
  family: TemplateFamily;
  /** Numeric id for the friendly-name tables (`items.gid`, `npcs.template_id`). */
  id: number | null;
  /** Same value as a decimal string — the verification-schema key form. */
  idText: string | null;
  idSource: TemplateIdSource;
  /** The manifest `m_id` for this source path, or `null` when it is absent. */
  manifestId: number | null;
  /** The file's own `m_templateID` (number form) — the cross-check value. */
  embeddedId: number | null;
  /** Friendly name after the D33(b) ladder. Never empty for an emitted row. */
  name: string;
  nameSource: TemplateNameSource;
  /** The raw `m_displayName` key (`Items_00022716`) — kept for the string_table. */
  rawDisplayName: string;
  /** `m_objectName` when present. */
  objectName: string;
  /** `SpellTemplate`'s `m_name` (empty for the object-derived families). */
  spellName: string;
  className: string;
  /** Original WAD path from `_fileName` — more reliable than the on-disk path. */
  fileName: string;
  /** On-disk path of the `_deser.json` that produced this row. */
  sourcePath: string;
}

export interface ExtractTemplateOptions {
  /** Resolves `m_displayName` through the string table; a miss falls back to the raw key. */
  resolveName?: (key: string) => string | undefined;
  /** On-disk path, recorded for provenance. */
  sourcePath?: string;
  /**
   * The manifest `m_id` for this document's source path — the authoritative id
   * (D35). `null`/absent means "no manifest entry", which falls back to the
   * embedded id.
   */
  manifestId?: number | null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumericId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

/**
 * Distils one deserialized template document into a row.
 *
 * Returns `undefined` for an unrecognised `_className` or when no name can be
 * derived at all (a row with an empty name is noise, not data).
 */
export function extractTemplateRow(
  doc: unknown,
  options: ExtractTemplateOptions = {},
): TemplateRow | undefined {
  if (!isPlainObject(doc)) {
    return undefined;
  }
  const className = asString(doc._className);
  const family = classifyTemplateClass(className);
  if (!family) {
    return undefined;
  }
  const object = doc._object;
  if (!isPlainObject(object)) {
    return undefined;
  }

  const fileName = asString(doc._fileName);
  const rawDisplayName = asString(object.m_displayName);
  const objectName = asString(object.m_objectName);
  const spellName = asString(object.m_name);
  const resolveName = options.resolveName;

  let name = '';
  let nameSource: TemplateNameSource = 'rawKey';
  if (rawDisplayName !== '') {
    const resolved = resolveName?.(rawDisplayName);
    if (resolved !== undefined && resolved !== '') {
      name = resolved;
      nameSource = 'resolved';
    } else {
      // A miss is normal — show the raw key ([spec-domain-reference.md] L694-695).
      name = rawDisplayName;
      nameSource = 'rawKey';
    }
  } else if (objectName !== '') {
    name = objectName;
    nameSource = 'objectName';
  } else if (spellName !== '') {
    name = spellName;
    nameSource = 'spellName';
  } else {
    return undefined;
  }

  const manifestId = options.manifestId ?? null;
  const embeddedId = asNumericId(object.m_templateID);

  // The manifest id wins (D35); the embedded `m_templateID` is only the fallback
  // for a row the manifest does not list, and its disagreement is reported by the
  // scanner rather than silently preferred.
  let id: number | null = manifestId;
  let idSource: TemplateIdSource = 'manifest';
  if (id === null) {
    id = embeddedId;
    idSource = id === null ? 'none' : 'm_templateID';
  }
  if (id === null && family === 'spell') {
    // Legacy fallback: a `SpellTemplate` has no `m_templateID`, so its old
    // identity was the string-table index inside `m_displayName`.
    const separator = rawDisplayName.lastIndexOf('_');
    if (separator > 0) {
      id = asNumericId(rawDisplayName.slice(separator + 1));
      idSource = id === null ? 'none' : 'displayNameIndex';
    }
  }

  return {
    family,
    id,
    idText: id === null ? null : String(id),
    idSource,
    manifestId,
    embeddedId,
    name,
    nameSource,
    rawDisplayName,
    objectName,
    spellName,
    className,
    fileName,
    sourcePath: options.sourcePath ?? fileName,
  };
}

export interface ItemRow {
  gid: number;
  name: string;
}

export interface SpellRow {
  template_id: number;
  name: string;
}

export interface NpcRow {
  template_id: number;
  name: string;
}

export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

export interface TemplateScanDeps {
  readdir: (dir: string) => Promise<DirEntry[]>;
  readFile: (file: string) => Promise<string>;
}

export const defaultTemplateScanDeps: TemplateScanDeps = {
  readdir: async (dir) =>
    (await readdir(dir, { withFileTypes: true })).map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
    })),
  readFile: (file) => readFile(file, 'utf8'),
};

export interface ScanTemplateTreeOptions extends ExtractTemplateOptions {
  deps?: Partial<TemplateScanDeps>;
  /** Parse function; strict JSON first with a JSON5 recovery (see `json.ts`). */
  parse?: (text: string) => unknown;
  /** Tree roots to walk, relative to the unpack dir. */
  roots?: readonly string[];
  /** Bounded read concurrency. */
  concurrency?: number;
  /**
   * The authoritative id source (D35). Absent/`null` degrades to the embedded
   * ids and reports every row as "missing from the manifest".
   */
  manifest?: TemplateManifest | null;
  /** Called for every unreadable/undeserializable file; the scan continues. */
  onError?: (file: string, error: unknown) => void;
}

/**
 * `<tree>/ObjectData/LM Equipment/Wands/ _deser.json` →
 * `ObjectData/LM Equipment/Wands/ .xml` (the manifest spelling, `/` separators).
 *
 * A path outside the tree yields a `../…` relative path, which never matches a
 * manifest entry — the row then reports as missing and falls back.
 */
export function manifestPathForSource(treeDir: string, sourcePath: string): string {
  return deserPathToManifestPath(path.relative(treeDir, sourcePath).split(path.sep).join('/'));
}

export interface TemplateScanResult {
  /** Every recognised template row (all families). */
  rows: TemplateRow[];
  /** `items`-shaped rows (`gid`, `name`) — rows whose id is present. */
  items: ItemRow[];
  /** `spells`-shaped rows. */
  spells: SpellRow[];
  /** `npcs`-shaped rows — NPC + pet + mount templates, flat (D33(a)). */
  npcs: NpcRow[];
  /** Rows per family + `scannedFiles`/`skippedClasses`. */
  counts: {
    item: number;
    spell: number;
    npc: number;
    pet: number;
    mount: number;
    scannedFiles: number;
    skippedClasses: number;
    parseErrors: number;
    /** Recognised template files that yielded no usable name (dropped). */
    noName: number;
    /** The same, attributed to the family the class belongs to. */
    noNameByFamily: Record<TemplateFamily, number>;
    /** Rows parsed but without a numeric id (`spells` only — see the module doc). */
    noId: number;
  };
  parseErrors: Array<{ file: string; message: string }>;
  /** Manifest id provenance — see `ManifestIdReport`. */
  manifest: ManifestIdReport;
}

/** Recursively lists `*_deser.json` files under `root`. */
async function listDeserFiles(
  root: string,
  deps: TemplateScanDeps,
  out: string[] = [],
): Promise<string[]> {
  let entries: DirEntry[];
  try {
    entries = await deps.readdir(root);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const child = path.join(root, entry.name);
    if (entry.name.endsWith('_deser.json')) {
      out.push(child);
      continue;
    }
    if (entry.isDirectory) {
      await listDeserFiles(child, deps, out);
    }
  }
  return out;
}

/**
 * Walks `ObjectData/**` and `Spells/**` once and distils every recognised
 * template into a row. Fully injectable: tests point it at a tiny synthetic tree.
 */
export async function scanTemplateTree(
  treeDir: string,
  options: ScanTemplateTreeOptions = {},
): Promise<TemplateScanResult> {
  const deps: TemplateScanDeps = { ...defaultTemplateScanDeps, ...options.deps };
  const parse = options.parse ?? parseJsonLenient;
  const roots = options.roots ?? TEMPLATE_SCAN_ROOTS;
  const concurrency = Math.max(1, options.concurrency ?? 24);
  const manifest = options.manifest ?? null;

  const files: string[] = [];
  for (const root of roots) {
    await listDeserFiles(path.join(treeDir, root), deps, files);
  }
  files.sort();

  const rows: TemplateRow[] = [];
  const parseErrors: TemplateScanResult['parseErrors'] = [];
  const manifestReport: ManifestIdReport = {
    entries: manifest?.byFile.size ?? 0,
    assigned: 0,
    fallback: 0,
    mismatches: 0,
    missing: 0,
    mismatchSamples: [],
    missingSamples: [],
  };
  let scannedFiles = 0;
  let skippedClasses = 0;
  let noName = 0;
  const noNameByFamily: Record<TemplateFamily, number> = {
    item: 0,
    spell: 0,
    npc: 0,
    pet: 0,
    mount: 0,
  };

  for (let offset = 0; offset < files.length; offset += concurrency) {
    const batch = files.slice(offset, offset + concurrency);
    const extracted = await Promise.all(
      batch.map(async (file) => {
        try {
          const text = await deps.readFile(file);
          const doc = parse(text);
          return { file, doc };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          parseErrors.push({ file, message });
          options.onError?.(file, error);
          return undefined;
        }
      }),
    );
    for (const entry of extracted) {
      if (!entry) {
        continue;
      }
      scannedFiles += 1;
      const manifestPath = manifestPathForSource(treeDir, entry.file);
      const manifestId = manifest?.byFile.get(manifestPath) ?? null;
      const row = extractTemplateRow(entry.doc, {
        resolveName: options.resolveName,
        sourcePath: entry.file,
        manifestId,
      });
      if (!row) {
        const family = isPlainObject(entry.doc)
          ? classifyTemplateClass(String(entry.doc._className))
          : undefined;
        if (family) {
          noName += 1;
          noNameByFamily[family] += 1;
        } else {
          skippedClasses += 1;
        }
        continue;
      }
      if (row.manifestId === null) {
        manifestReport.missing += 1;
        // The embedded id is only "used" when the ladder actually found one.
        if (row.idSource !== 'none') {
          manifestReport.fallback += 1;
        }
        if (manifestReport.missingSamples.length < MANIFEST_SAMPLE_LIMIT) {
          manifestReport.missingSamples.push({ sourcePath: entry.file, manifestPath });
        }
      } else {
        manifestReport.assigned += 1;
        if (row.embeddedId !== null && row.embeddedId !== row.manifestId) {
          manifestReport.mismatches += 1;
          if (manifestReport.mismatchSamples.length < MANIFEST_SAMPLE_LIMIT) {
            manifestReport.mismatchSamples.push({
              sourcePath: entry.file,
              embeddedId: row.embeddedId,
              manifestId: row.manifestId,
            });
          }
        }
      }
      rows.push(row);
    }
  }

  const items: ItemRow[] = [];
  const spells: SpellRow[] = [];
  const npcs: NpcRow[] = [];
  const counts = {
    item: 0,
    spell: 0,
    npc: 0,
    pet: 0,
    mount: 0,
    scannedFiles,
    skippedClasses,
    parseErrors: parseErrors.length,
    noName,
    noNameByFamily,
    noId: 0,
  };

  for (const row of rows) {
    counts[row.family] += 1;
    if (row.id === null) {
      counts.noId += 1;
      continue;
    }
    if (row.family === 'item') {
      items.push({ gid: row.id, name: row.name });
      continue;
    }
    if (row.family === 'spell') {
      spells.push({ template_id: row.id, name: row.name });
      continue;
    }
    // npc + pet + mount share the flat npcs table (D33(a)).
    npcs.push({ template_id: row.id, name: row.name });
  }

  return { rows, items, spells, npcs, counts, parseErrors, manifest: manifestReport };
}
