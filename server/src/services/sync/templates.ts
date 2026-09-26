import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { isPlainObject, parseJsonLenient } from './json.js';

/**
 * Template parsers — task 1.4d
 * ([plan-phase-1-foundation.md](../../../../docs/plan-phase-1-foundation.md) §1.4d,
 * decision **D33(a)/(b)**, spike 1.4a §4).
 *
 * Three spec assumptions are wrong in the real data (D33):
 *
 * 1. **Families are discriminated by the JSON `_className`, never by file name or
 *    path** — globbing `*ItemTemplate*` matches zero files. The real class names
 *    are `WizItemTemplate` (76,679), `ItemBundleTemplate` (1,810),
 *    `ReagentItemTemplate` (867), `PetSnackItemTemplate` (478), `ItemTemplate` (2);
 *    `SpellTemplate` (14,856), `TieredSpellTemplate` (2,579);
 *    `WizGameObjectTemplate` (15,190), `GameObjectTemplate` (7,698);
 *    `WizPetTemplate` (143), `WizMountTemplate` (2). **`ActorTemplate` does not exist.**
 * 2. The friendly-name field is **`m_displayName`**, not `m_name` (`m_name` exists
 *    only on `SpellTemplate`). Ladder: `m_displayName` → resolved string-table
 *    value → raw key → `m_objectName`.
 * 3. Pets and mounts are folded into `npcs` so ID lookups never miss (the plan's
 *    "flat list, no type classification").
 *
 * ## Two measured gaps, reported rather than papered over
 *
 * - `SpellTemplate`/`TieredSpellTemplate` carry **no numeric template ID at all**
 *   (only `m_name`, `m_displayName`, `m_spellBase`). The `spells.template_id`
 *   column therefore takes the **string-table index of `m_displayName`**
 *   (`Spells_00000424` → 424) and the row records `idSource`, because the corpus's
 *   `m_spellID` references cannot be derived from Root.wad.
 * - `m_templateID` is a JSON number but the verification schema keys entries by
 *   *string* (`entry_status.object_key`, [spec-data-model.md] L262-274), so every
 *   row carries both `id` (number) and `idText` (decimal string).
 *
 * Documents are parsed, distilled into a row, and dropped — the scanner never
 * retains a whole `_deser.json` (133,937 files, 1.15 GB unpacked).
 */

/** `_className` values that belong to the `items` table (D33(a)). */
export const ITEM_CLASSES = [
  'WizItemTemplate',
  'ItemBundleTemplate',
  'ReagentItemTemplate',
  'PetSnackItemTemplate',
  'ItemTemplate',
] as const;

/** `_className` values that belong to the `spells` table (D33(a)). */
export const SPELL_CLASSES = ['SpellTemplate', 'TieredSpellTemplate'] as const;

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

/** Classifies a `_className`; `undefined` for every class that is not a friendly name. */
export function classifyTemplateClass(className: string): TemplateFamily | undefined {
  return CLASS_TO_FAMILY.get(className);
}

/** How the row's display name was derived. */
export type TemplateNameSource = 'resolved' | 'rawKey' | 'objectName' | 'spellName';

/** Where the row's numeric id came from. */
export type TemplateIdSource = 'm_templateID' | 'displayNameIndex' | 'none';

export interface TemplateRow {
  family: TemplateFamily;
  /** Numeric id for the friendly-name tables (`items.gid`, `npcs.template_id`). */
  id: number | null;
  /** Same value as a decimal string — the verification-schema key form. */
  idText: string | null;
  idSource: TemplateIdSource;
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

  let id = asNumericId(object.m_templateID);
  let idSource: TemplateIdSource = id === null ? 'none' : 'm_templateID';
  if (id === null && family === 'spell') {
    // SpellTemplate has no m_templateID (measured); its per-spell numeric
    // identity is the string-table index inside m_displayName.
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
  /** Called for every unreadable/undeserializable file; the scan continues. */
  onError?: (file: string, error: unknown) => void;
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

  const files: string[] = [];
  for (const root of roots) {
    await listDeserFiles(path.join(treeDir, root), deps, files);
  }
  files.sort();

  const rows: TemplateRow[] = [];
  const parseErrors: TemplateScanResult['parseErrors'] = [];
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
      const row = extractTemplateRow(entry.doc, {
        resolveName: options.resolveName,
        sourcePath: entry.file,
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

  return { rows, items, spells, npcs, counts, parseErrors };
}
