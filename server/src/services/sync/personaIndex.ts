import path from 'node:path';

import { isPlainObject, parseJsonLenient } from './json.js';
import type { TemplateManifest } from './manifest.js';
import { defaultTemplateScanDeps, listDeserFiles, type TemplateScanDeps } from './templates.js';

/**
 * The **persona index** — task 6.6 ([plan-phase-6-quest-catalog.md] task 6.6;
 * docs/spec-api.md L477-482).
 *
 * A dialog entry's speaker is resolved through the client's own precedence:
 * `m_nameOverride` → else `m_nameSTKey` composed through `NPCFormats_First_Last` /
 * `NPCFormats_First_Only` against the persona's first/last components → else the
 * persona's template name via the manifest. Rungs 2 and 3 both need a fact the
 * database did not hold, and this module is the one place that derives them from
 * what the sync already reads — the manifest and the unpack tree — so the evidence
 * API can be a live join ([migration 0003](../../../migrations/0003_persona_index.sql)
 * states the full why).
 *
 * Pure: every function takes its inputs as arguments and touches no database, so
 * the unit test drives it with a handful of rows.
 *
 * ## Measured on this host (2026-09-28, owner fork `QuestTemplates/`, 328 files)
 *
 * | Reading | Result |
 * |---|---|
 * | Distinct `m_personaName` / dialog entries in the corpus quest files | **288 / 1,881** |
 * | … resolving to a template id via the manifest → `npcs.name` | **280** |
 * | … absent from the manifest (the raw-string fallback) | **8** |
 * | Persona structs (`m_persona` with `m_firstName`) in the Root.wad unpack | **1** (`WC-RAV-NPC02_Persona`) |
 * | `_deser.json` files scanned for structs | **133,937**, of which **2** carry `m_firstName` |
 */

/* ------------------------------------------------------------- the object name */

/** The suffix a persona name carries when it names the persona rather than the object. */
export const PERSONA_SUFFIX = '_Persona';

/**
 * The persona name's **object name**: a trailing `_Persona` removed, everything
 * else untouched. `WC-RAV-NPC02_Persona` → `WC-RAV-NPC02`; a name that already
 * lacks the suffix (`DS-LIB2-NPC05_Warrior5`) is its own object name — the corpus
 * references four of the eight manifest-missing personas in both spellings, and
 * this one rule answers for both.
 */
export function personaObjectName(personaName: string): string {
  const trimmed = personaName.trim();
  return trimmed.endsWith(PERSONA_SUFFIX) ? trimmed.slice(0, -PERSONA_SUFFIX.length) : trimmed;
}

/* ------------------------------------------------------------- one index row */

/** One `persona_index` row. `null` means "this rung has nothing to say", never "empty string". */
export interface PersonaIndexRow {
  /** {@link personaObjectName} of the persona. */
  object_name: string;
  /** The manifest's id for the `ObjectData/…/<object_name>.xml` file, or `null` when absent. */
  template_id: number | null;
  /** The persona struct's `m_firstName`, as written. */
  first_key: string | null;
  /** … `m_lastName`. */
  last_key: string | null;
  /** … `m_title`. */
  title_key: string | null;
}

/** An empty row for one object name. */
function emptyRow(objectName: string): PersonaIndexRow {
  return {
    object_name: objectName,
    template_id: null,
    first_key: null,
    last_key: null,
    title_key: null,
  };
}

/**
 * The object name a manifest filename ends with: `ObjectData/WC/WC-RAV-NPC02.xml` →
 * `WC-RAV-NPC02`. The basename is the identity the persona name carries; the
 * directory is not (the manifest's ids are unique, and two directories holding the
 * same basename would be one object name the index cannot split — first wins, the
 * manifest's own duplicate rule).
 */
export function objectNameFromManifestFile(fileName: string): string {
  const base = fileName.slice(fileName.lastIndexOf('/') + 1);
  return base.endsWith('.xml') ? base.slice(0, -'.xml'.length) : base;
}

/**
 * The manifest rows whose id the `npcs` table holds — i.e. the object names rung 3
 * can actually name, since rung 3 reads `npcs.name`.
 *
 * `npcIds` is the set of `npcs.template_id` values the same sync just built, so the
 * filter is "this id can answer", never a guess about which templates are NPCs
 * (`npcs` is a flat list with no classification column — D33(a)).
 *
 * Ascending filename order, so the first row for an object name is deterministic;
 * a later duplicate basename never overwrites it.
 */
export function buildManifestPersonaRows(
  manifest: TemplateManifest,
  npcIds: ReadonlySet<number>,
): PersonaIndexRow[] {
  const files = [...manifest.byFile.keys()].sort();
  const rows: PersonaIndexRow[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const id = manifest.byFile.get(file);
    if (id === undefined || !npcIds.has(id)) {
      continue;
    }
    const objectName = objectNameFromManifestFile(file);
    if (objectName === '' || seen.has(objectName)) {
      continue;
    }
    seen.add(objectName);
    rows.push({ ...emptyRow(objectName), template_id: id });
  }
  return rows;
}

/* ---------------------------------------------------------- the persona struct */

/** A persona struct's components, as written (`m_persona.m_firstName` …). */
export interface PersonaStruct {
  /** The raw `m_personaName` (`WC-RAV-NPC02_Persona`). */
  persona_name: string;
  first_key: string | null;
  last_key: string | null;
  title_key: string | null;
}

/** A non-empty string member of `container`, else `null`. */
function textMember(container: unknown, key: string): string | null {
  if (!isPlainObject(container)) {
    return null;
  }
  const value = container[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Every `m_persona`-shaped struct in one parsed tree document, in document order.
 *
 * A persona struct is an object carrying `m_personaName` **and** at least one of
 * the three component members — the same key set the Cinematics templates use
 * (`{m_personaName, m_firstName, m_lastName, m_title}`). A bare
 * `m_personaName` (an `NPCDialogEntry`'s reference to a persona, which is what the
 * NDJSON holds) is deliberately **not** a struct: it names a persona without
 * defining one, and treating it as a definition would invent components.
 */
export function personaStructsInDocument(document: unknown): PersonaStruct[] {
  const found: PersonaStruct[] = [];

  function walk(value: unknown): void {
    if (Array.isArray(value)) {
      for (const element of value) {
        walk(element);
      }
      return;
    }
    if (!isPlainObject(value)) {
      return;
    }
    const personaName = textMember(value, 'm_personaName');
    const first = textMember(value, 'm_firstName');
    const last = textMember(value, 'm_lastName');
    const title = textMember(value, 'm_title');
    if (personaName !== null && (first !== null || last !== null || title !== null)) {
      found.push({ persona_name: personaName, first_key: first, last_key: last, title_key: title });
    }
    for (const child of Object.values(value)) {
      walk(child);
    }
  }

  walk(document);
  return found;
}

/**
 * Merges the struct rows into the manifest rows, keyed by {@link personaObjectName}.
 * A struct for an object name the manifest answered keeps that `template_id`; a
 * struct for a name the manifest could not place *creates* the row with a `null`
 * id — which is what makes the persona visible as "known, but unnameable" instead
 * of silently absent.
 *
 * `first_key`/`last_key`/`title_key` are written only when the struct supplies a
 * non-null value, so a later file with a partial struct cannot erase an earlier
 * complete one. Struct order decides which file wins first — deterministic because
 * the caller sorts the files.
 */
export function mergePersonaStructs(
  rows: readonly PersonaIndexRow[],
  structs: readonly PersonaStruct[],
): PersonaIndexRow[] {
  const byObject = new Map<string, PersonaIndexRow>();
  for (const row of rows) {
    byObject.set(row.object_name, { ...row });
  }
  for (const struct of structs) {
    const objectName = personaObjectName(struct.persona_name);
    if (objectName === '') {
      continue;
    }
    const existing = byObject.get(objectName) ?? emptyRow(objectName);
    byObject.set(objectName, {
      ...existing,
      first_key: struct.first_key ?? existing.first_key,
      last_key: struct.last_key ?? existing.last_key,
      title_key: struct.title_key ?? existing.title_key,
    });
  }
  return [...byObject.values()].sort((a, b) =>
    a.object_name < b.object_name ? -1 : a.object_name > b.object_name ? 1 : 0,
  );
}

/* ------------------------------------------------------------------ the scan */

/**
 * The tree roots the struct scan reads. **Measured**, not assumed: of the 133,937
 * `_deser.json` files in the Root.wad unpack, exactly **2** carry `m_firstName` and
 * both are under `Cinematics/`; `ObjectData/` (86 files), `Tutorials/` (11) and the
 * 6,733 NDJSON rows carry `m_personaName` references but no component. The roots
 * stay a parameter so a test — and a future tree — can point the scan elsewhere.
 */
export const PERSONA_SCAN_ROOTS = ['Cinematics'] as const;

export interface PersonaScanDeps extends Partial<TemplateScanDeps> {
  /** Injected parser; strict JSON first with a JSON5 recovery, as the tree scan uses. */
  parse?: (text: string) => unknown;
  /** Roots to walk; defaults to {@link PERSONA_SCAN_ROOTS}. */
  roots?: readonly string[];
}

/**
 * Every persona struct in the tree's `Cinematics` root (see {@link PERSONA_SCAN_ROOTS}),
 * sorted by path so the merge is deterministic. A file that fails to parse is
 * skipped — the scan is an index builder, and one unreadable Cinematics file must
 * not fail a sync (the same rule the template scan follows for its own errors).
 *
 * The directory walk is `templates.ts`'s `listDeserFiles` — the one home of "which
 * `_deser.json` files a tree root holds" — so a fix to that walk fixes both scans.
 */
export async function scanPersonaStructs(
  treeDir: string,
  deps: PersonaScanDeps = {},
): Promise<PersonaStruct[]> {
  const scanDeps: TemplateScanDeps = { ...defaultTemplateScanDeps, ...deps };
  const parse = deps.parse ?? parseJsonLenient;

  const files: string[] = [];
  for (const root of deps.roots ?? PERSONA_SCAN_ROOTS) {
    await listDeserFiles(path.join(treeDir, root), scanDeps, files);
  }
  files.sort();

  const structs: PersonaStruct[] = [];
  for (const file of files) {
    let document: unknown;
    try {
      document = parse(await scanDeps.readFile(file));
    } catch {
      continue;
    }
    structs.push(...personaStructsInDocument(document));
  }
  return structs;
}
