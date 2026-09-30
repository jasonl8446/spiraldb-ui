import { formatDocPath, type DocPath } from '../../../shared/document.js';
import {
  REFERENCE_FIELDS,
  walkScalars,
  type ReferenceFieldSpec,
  type ReferenceNamespace,
} from '../../../shared/quest/validation.js';
import { formatNameRow, type NameRow, type NamesType } from '../../../client/src/lib/display.js';
import type { Db } from '../db.js';
import { readSpiraldbJson } from './spiraldbFiles.js';
import type { SpiraldbIndex } from './spiraldbIndex.js';
import { parseQuestTitleKey, parseWizQstKey } from './sync/questRefs.js';
import { isPlainObject } from './sync/json.js';

/**
 * Per-quest **evidence** — task 6.6 ([plan-phase-6-quest-catalog.md] L321-331;
 * docs/spec-api.md L420-492).
 *
 * `GET /api/quests/:name/evidence` and `GET /api/quest-ids/:id/evidence` answer one
 * shape, resolved as a **live join over the indexed tables** — there is no
 * materialised evidence table. Every section is computed per request from
 * `string_table`, `quests`, `quest_ids`, `quest_catalog_refs`, `persona_index`,
 * `npcs`, `zones`, `spells`, `drop_tables` and the quest file itself.
 *
 * ## The sections
 *
 * 1. **`text_rows`** — every row of the quest's own `WizQst<id>_*` table, each
 *    marked `used_by_this_file`. The predicate is exact, not heuristic: a row is
 *    `used` when its **key** occurs as a whole string value anywhere in the quest
 *    file. `field` is the path of the first value that referenced it, so a `used`
 *    row never appears without provenance and an available row carries `null`.
 * 2. **`goal_gates`** — `quest_catalog_refs` rows carrying a `goal_name`, grouped by
 *    `(goal_name, required_status)` with every referencing `{wad, entry, class}`.
 *    References **without** a gate are counted in `warnings`, never merged into a
 *    gate that would misrepresent them.
 * 3. **`dialogue`** — the quest file's `NPCDialogEntry` nodes in document order,
 *    with the speaker through the client's own precedence (below).
 * 4. **`references`** — every field `REFERENCE_FIELDS` (the single home of "which
 *    field references what") declares, resolved against the synced tables and
 *    rendered through `formatNameRow` — the one display rule.
 *
 * ## The speaker ladder
 *
 * `m_nameOverride` → else `m_nameSTKey` composed through the `NPCFormats_*` format
 * → else the persona's template name via the manifest → else the raw persona
 * string. `m_cameraName` is a **display hint and is never the name**: it is copied
 * into the row as `camera_name` so a reader can see what was deliberately not used,
 * and the unit test falsifies a camera-name shortcut on an entry whose camera name
 * is not a name at all (`'LOCATION'`, measured on `WC-CYCLOPS-MAIN-002`'s 5th entry,
 * whose speaker is Victor Darkwood).
 *
 * The ladder's inputs come from `persona_index` (task 6.6's synced index —
 * `server/src/services/sync/personaIndex.ts`): rung 2 needs the persona struct's
 * `m_firstName`/`m_lastName` components and rung 3 needs the manifest's
 * `object name → template id`, and neither exists in any other table. A rung that
 * cannot answer **falls through** and is counted in `warnings`; it never substitutes
 * a guess (no name splitting, no camera scraping).
 */

/* ------------------------------------------------------------------- shapes */

/** The catalog link's provenance — `quests.title_source` / `quest_ids.link_kind`. */
export type EvidenceTitleSource = 'direct' | 'inferred' | 'none';

/** Which rung of the speaker ladder answered for one dialogue line. */
export type SpeakerSource = 'override' | 'composed' | 'template' | 'raw';

export interface EvidenceSpeaker {
  /** The resolved name, or the raw persona string on the `raw` fallback. */
  name: string;
  source: SpeakerSource;
  /** The `m_personaName` this line carried, verbatim. */
  persona: string;
  /** The `m_nameOverride` value, when the entry set one (`null` otherwise). */
  override_key: string | null;
  /** The `m_nameSTKey` value, when the entry set one. */
  st_key: string | null;
}

export interface EvidenceTextRow {
  key: string;
  value: string;
  category: string;
  used_by_this_file: boolean;
  /** The path of the file value that references this key, or `null` when nothing does. */
  field: string | null;
}

export interface EvidenceGoalRef {
  wad: string;
  entry: string;
  class: string;
}

export interface EvidenceGoalGate {
  goal_name: string;
  required_status: string | null;
  refs: EvidenceGoalRef[];
}

export interface EvidenceDialogue {
  /** Position among this quest's dialogue entries, in document order (0-based). */
  index: number;
  /** The entry's path, e.g. `m_goals[0].m_dialogList.m_dialogs[0].m_dialogEntries[0]`. */
  field: string;
  /** The `WizQst<id>_*` key the entry's `m_dialog` names, when it names one. */
  dialog_key: string | null;
  /**
   * `true` when {@link dialog_key} is a row of **this quest's own** table.
   *
   * Measured and load-bearing: `WC-CYCLOPS-MAIN-002` carries 27 `NPCDialogEntry`
   * nodes — 22 under `m_goals` pointing at its own `WizQst17318F_*` table, plus 5 in
   * the top-level `m_dialogList` ("Prep") pointing at `WizQst17318E_*`, a **sibling
   * quest's** table. Both are entries the file records; only the first 22 are this
   * quest's own material, so the distinction is a field rather than a hidden filter.
   */
  own_table: boolean;
  /** The resolved dialogue text, or `null` when the key resolves to nothing. */
  text: string | null;
  speaker: EvidenceSpeaker;
  portrait: string | null;
  sound: string | null;
  /** `m_cameraName`, verbatim — a display hint, never the speaker's name. */
  camera_name: string | null;
  /**
   * `m_actorTemplateID`, verbatim, or `null`. **Data, never a name.** 1,377 of the
   * corpus's dialog entries carry a positive one and 10 of the 29 empty-persona
   * entries do (measured on the owner fork), so the tempting shortcut — name the
   * speaker from the actor template — is a real one; the spec's ladder has no such
   * rung, and this story did not invent one, so the value is surfaced for the panel
   * and the miss is counted in `warnings` instead.
   */
  actor_template_id: number | null;
}

export interface EvidenceReference {
  /** The reference field's document path, e.g. `m_goals[0].m_goalTarget`. */
  field: string;
  /** The value verbatim. */
  value: unknown;
  /** The key from `REFERENCE_FIELDS` (`m_templateID`, `m_destinationZone`, …). */
  key: string;
  /** `REFERENCE_FIELDS`' `sources` for this (key, owner) pair — both for a dual-source field. */
  sources: readonly ReferenceNamespace[];
  /** The namespace that answered, or `null` when none did. */
  kind: ReferenceNamespace | null;
  /** The friendly half and the display rule's rendering, or `null` on a miss. */
  resolved: { display: string } | null;
}

export interface EvidenceQuestHeader {
  /** `null` on the id tier: an id with no linked catalog name has no name. */
  quest_name: string | null;
  quest_id: number | null;
  has_definition: boolean;
  link_kind: EvidenceTitleSource;
  title: string | null;
  /**
   * The **catalog link's** provenance (`quests.title_source`), **not** the quests
   * list endpoint's per-file `resolved | rawKey | missing` (spec-data-model L209-214).
   * On the id tier, where no `quests` row is linked, it is that id row's
   * `quest_ids.link_kind` — the same enum answering the same question.
   */
  title_source: EvidenceTitleSource;
  /** `quest_ids.inference_basis` when the link is inferred — an inferred link never travels alone. */
  inference_basis: string | null;
}

export interface QuestEvidence {
  quest: EvidenceQuestHeader;
  text_rows: EvidenceTextRow[];
  goal_gates: EvidenceGoalGate[];
  dialogue: EvidenceDialogue[];
  references: EvidenceReference[];
  warnings: string[];
}

/** `unknown` ⇒ the caller answers 404. */
export type EvidenceResult = { kind: 'found'; evidence: QuestEvidence } | { kind: 'unknown' };

/* ------------------------------------------------------------------ utilities */

/** A non-empty string member, else `null`. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asTitleSource(value: string | null | undefined): EvidenceTitleSource {
  return value === 'direct' || value === 'inferred' ? value : 'none';
}

/** A `quests` row as this module needs it. */
interface QuestRow {
  quest_name: string;
  title: string;
  has_definition: number;
  link_kind: string | null;
  title_source: string | null;
}

/** A `quest_ids` row as this module needs it. */
interface QuestIdRow {
  quest_id: number;
  title_key: string | null;
  title: string | null;
  text_rows: number;
  matched_quest_name: string | null;
  link_kind: string | null;
  inference_basis: string | null;
}

/** One `persona_index` row. */
interface PersonaRow {
  object_name: string;
  template_id: number | null;
  first_key: string | null;
  last_key: string | null;
  title_key: string | null;
}

/**
 * Every lookup the builder needs, read once per request — or once per **run** when a caller
 * evaluates many quests (the draft builder, task 7.6, passes it through {@link EvidenceOptions.tables}
 * instead of re-reading the 217k-row string table per quest).
 */
export interface EvidenceTables {
  /** `string_table.key → value` — the one lookup every ladder rung shares. */
  strings: ReadonlyMap<string, string>;
  /** persona object name → its `persona_index` row. */
  personae: ReadonlyMap<string, PersonaRow>;
  /** `npcs.template_id → name` — rung 3's reader. */
  npcNames: ReadonlyMap<number, string>;
  /** quest id → its `WizQst<id>_*` category (the table name, spelling included). */
  textTables: ReadonlyMap<number, string>;
}

export function readEvidenceTables(db: Db): EvidenceTables {
  const strings = new Map<string, string>();
  for (const row of db
    .prepare<[], { key: string; value: string }>('SELECT key, value FROM string_table')
    .all()) {
    strings.set(row.key, row.value);
  }

  const personae = new Map<string, PersonaRow>();
  for (const row of db
    .prepare<[], PersonaRow>(
      'SELECT object_name, template_id, first_key, last_key, title_key FROM persona_index',
    )
    .all()) {
    personae.set(row.object_name, row);
  }

  const npcNames = new Map<number, string>();
  for (const row of db
    .prepare<[], { template_id: number; name: string }>('SELECT template_id, name FROM npcs')
    .all()) {
    npcNames.set(row.template_id, row.name);
  }

  return { strings, personae, npcNames, textTables: textTableByQuestId(db) };
}

/**
 * The id → `WizQst<id>_*` table name, read off the string table.
 *
 * A row's `category` **is** its table name (`WizQst17318F_00000006`'s category is
 * `WizQst17318F`), and the **spelling is not derivable from the id** — exactly as
 * `QuestTitle_1ED8D` and `QuestTitle_00002173` are both stored spellings, so are
 * the text tables. Reading the distinct categories and parsing each one's hex by
 * {@link parseWizQstKey}'s rule therefore answers for every spelling the game
 * shipped instead of guessing one and silently returning no rows.
 */
function textTableByQuestId(db: Db): Map<number, string> {
  const byId = new Map<number, string>();
  for (const row of db
    .prepare<[], { category: string }>(
      "SELECT DISTINCT category FROM string_table WHERE category LIKE 'WizQst%'",
    )
    .all()) {
    const questId = parseWizQstKey(`${row.category}_`);
    if (questId !== null && !byId.has(questId)) {
      byId.set(questId, row.category);
    }
  }
  return byId;
}

/* ------------------------------------------------------- the quest's own rows */

/** The quest's own rows, ascending by key. */
function questTextRows(db: Db, category: string): Array<{ key: string; value: string }> {
  return db
    .prepare<[string], { key: string; value: string }>(
      'SELECT key, value FROM string_table WHERE category = ? ORDER BY key',
    )
    .all(category);
}

/**
 * key → the document path of the **first** string value equal to it, in walk order.
 *
 * This is the whole of `used_by_this_file`: the quest file's own string values, read
 * by the same `walkScalars` the validator uses, compared as whole strings. Nothing is
 * matched by prefix, by naming convention, or by "looks like a text key".
 */
function stringValuesByKey(document: unknown): Map<string, string> {
  const byValue = new Map<string, string>();
  walkScalars(document, (node) => {
    if (typeof node.value !== 'string' || node.value === '') {
      return;
    }
    if (!byValue.has(node.value)) {
      byValue.set(node.value, formatDocPath(node.path));
    }
  });
  return byValue;
}

/* ---------------------------------------------------------------------- ladder */

/** The composition placeholders the `NPCFormats_*` strings carry. */
const COMPOSITION_PLACEHOLDER = /#\d+:\$([A-Za-z_]+)\$/g;

/** A persona struct's components, resolved to text. */
export interface PersonaComponents {
  first: string | null;
  last: string | null;
  title: string | null;
}

/** `$NPC_FIRSTNAME$` → `first`, and its two siblings. */
const COMPONENT_BY_PLACEHOLDER: Readonly<Record<string, keyof PersonaComponents>> = {
  NPC_FIRSTNAME: 'first',
  NPC_LASTNAME: 'last',
  NPC_TITLE: 'title',
};

/**
 * Composes a speaker name from an entry's `m_nameSTKey` **format** and the persona's
 * components. Returns `null` when the format has a placeholder whose component the
 * persona does not carry (or that this module does not know) — the rung then falls
 * through rather than emitting a half-filled string or the raw format key.
 *
 * The format is data, never a hard-coded pair: `NPCFormats_First_Last` is
 * `#1:$NPC_FIRSTNAME$ #2:$NPC_LASTNAME$` and `NPCFormats_First_Only` is
 * `#1:$NPC_FIRSTNAME$`; replacing the placeholders leaves the literal text between
 * them (`"Cyrus"` + `" "` + `"Drake"`).
 */
export function composeSpeakerName(format: string, components: PersonaComponents): string | null {
  let composed = '';
  let cursor = 0;
  for (const match of format.matchAll(COMPOSITION_PLACEHOLDER)) {
    const slot = COMPONENT_BY_PLACEHOLDER[match[1] ?? ''];
    const part = slot === undefined ? null : components[slot];
    if (part === null) {
      return null;
    }
    composed += format.slice(cursor, match.index) + part;
    cursor = (match.index ?? 0) + match[0].length;
  }
  if (cursor === 0) {
    return null; // no placeholder at all: not a composition format
  }
  composed += format.slice(cursor);
  return composed.trim() === '' ? null : composed;
}

/** The `persona_index` row for a persona name (`_Persona` stripped), if any. */
function personaFor(
  personae: ReadonlyMap<string, PersonaRow>,
  personaName: string,
): PersonaRow | undefined {
  const stripped = personaName.endsWith('_Persona')
    ? personaName.slice(0, -'_Persona'.length)
    : personaName;
  return personae.get(stripped);
}

/** A persona row's components, resolved through the string table. */
function personaComponents(
  row: PersonaRow | undefined,
  strings: ReadonlyMap<string, string>,
): PersonaComponents {
  const resolve = (key: string | null): string | null => {
    if (key === null) {
      return null;
    }
    // The component is a string-table key; a value the table does not hold passes
    // through as written, so a literal survives and a broken key stays visible
    // instead of being invented.
    return strings.get(key) ?? key;
  };
  return {
    first: resolve(row?.first_key ?? null),
    last: resolve(row?.last_key ?? null),
    title: resolve(row?.title_key ?? null),
  };
}

/** One resolved speaker plus the warning the ladder wants recorded, if any. */
interface SpeakerResolution {
  speaker: EvidenceSpeaker;
  /** `null` when a rung answered; the fall-through's sentence otherwise. */
  warning: string | null;
  /**
   * `true` when the entry carries a **non-empty** persona the index cannot place —
   * the count ac2 asks for. An empty `m_personaName` is a different fact (the entry
   * names no persona at all) and is counted separately rather than folded in here.
   */
  missingPersona: boolean;
}

/**
 * Resolves one dialogue row's speaker.
 *
 * **Visibility is uneven, and this comment used to claim otherwise (D124).** Of the three
 * fall-through classes, only the third is surfaced: a persona name that is not in the manifest
 * index sets `missingPersona`, which the caller turns into an aggregate `warnings` entry. A
 * missing override key, or a composition the persona's components cannot fill, leaves
 * `source: 'template'` with no counter and no warning line — the raw value is used silently.
 * A per-class counter is a response change and is recorded as a follow-up rather than smuggled
 * into a cleanup pass; `warning` below is the seed of that fix and is currently unread.
 */
function resolveSpeaker(options: {
  entry: Record<string, unknown>;
  line: number;
  tables: EvidenceTables;
}): SpeakerResolution {
  const { entry, line, tables } = options;
  const personaName = text(entry.m_personaName) ?? '';
  const overrideKey = text(entry.m_nameOverride);
  const stKey = text(entry.m_nameSTKey);
  const row = personaFor(tables.personae, personaName);
  const base: Pick<EvidenceSpeaker, 'persona' | 'override_key' | 'st_key'> = {
    persona: personaName,
    override_key: overrideKey,
    st_key: stKey,
  };

  // Rung 1 — `m_nameOverride` is a string-table key in any category.
  if (overrideKey !== null) {
    const resolved = tables.strings.get(overrideKey);
    if (resolved !== undefined) {
      return {
        speaker: { ...base, name: resolved, source: 'override' },
        warning: null,
        missingPersona: false,
      };
    }
  }

  // Rung 2 — the `NPCFormats_*` composition against the persona's components.
  if (stKey !== null) {
    const format = tables.strings.get(stKey);
    if (format !== undefined) {
      const composed = composeSpeakerName(format, personaComponents(row, tables.strings));
      if (composed !== null) {
        return {
          speaker: { ...base, name: composed, source: 'composed' },
          warning: null,
          missingPersona: false,
        };
      }
    }
  }

  // Rung 3 — the persona's template name via the manifest (the `persona_index` id).
  const templateId = row?.template_id ?? null;
  if (templateId !== null) {
    const named = tables.npcNames.get(templateId);
    if (named !== undefined) {
      return {
        speaker: { ...base, name: named, source: 'template' },
        warning: null,
        missingPersona: false,
      };
    }
  }

  // The raw persona string: never dropped, never replaced by a guess, counted below.
  return {
    speaker: { ...base, name: personaName, source: 'raw' },
    warning:
      personaName === ''
        ? null
        : `dialogue line ${line}: persona "${personaName}" is not in the manifest index, so the raw persona string is used as the speaker name`,
    missingPersona: personaName !== '',
  };
}

/* ------------------------------------------------------------------- dialogue */

/**
 * Every `NPCDialogEntry` node of the quest, in document order, with its exact path.
 *
 * The entry is identified by its **own `$type`** (`Imcodec.ObjectProperty.TypeCache.NPCDialogEntry,
 * Imcodec.ObjectProperty`), the same literal the Phase-3 dialog editor reads — never by position
 * (`m_goals[i].m_dialogList…`) and never by key presence, both of which would also match a shape
 * this repo does not call a dialog entry. A depth-first pass preserves document order, so
 * `dialogue[].index` is reproducible.
 */
function dialogEntries(
  document: unknown,
): Array<{ path: DocPath; entry: Record<string, unknown> }> {
  const found: Array<{ path: DocPath; entry: Record<string, unknown> }> = [];

  function visit(value: unknown, path: DocPath): void {
    if (Array.isArray(value)) {
      value.forEach((element, index) => visit(element, [...path, index]));
      return;
    }
    if (!isPlainObject(value)) {
      return;
    }
    const declared = value.$type;
    if (typeof declared === 'string' && declared.includes('NPCDialogEntry')) {
      found.push({ path, entry: value });
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === '$type') {
        continue;
      }
      visit(child, [...path, key]);
    }
  }

  visit(document, []);
  return found;
}

/* ----------------------------------------------------------------- references */

/**
 * One namespace's row query, in the shape `formatNameRow` consumes.
 *
 * There is deliberately no `items` arm: no quest field references an `items.gid`
 * (measured — the corpus's 79,835 values never occur in `items`, D63's note), and
 * `REFERENCE_FIELDS` therefore declares no such source.
 */
const NAMESPACE_ROW: Readonly<
  Record<
    ReferenceNamespace,
    { type: NamesType; sql: string; id: (value: string) => string | number }
  >
> = {
  spells: {
    type: 'spells',
    sql: 'SELECT template_id, name FROM spells WHERE template_id = ?',
    id: Number,
  },
  npcs: {
    type: 'npcs',
    sql: 'SELECT template_id, name FROM npcs WHERE template_id = ?',
    id: Number,
  },
  zones: {
    type: 'zones',
    sql: 'SELECT zone_path, display_name, world FROM zones WHERE zone_path = ?',
    id: String,
  },
  drop_tables: {
    type: 'drop_tables',
    sql: 'SELECT name, description FROM drop_tables WHERE name = ?',
    id: String,
  },
  quests: {
    type: 'quests',
    sql: 'SELECT quest_name, title, level, is_mainline FROM quests WHERE quest_name = ?',
    id: String,
  },
};

/** The candidate string of a reference value, or `null` when the value cannot name anything. */
function candidateFor(spec: ReferenceFieldSpec, value: unknown): string | null {
  if (spec.valueType === 'number') {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      return null;
    }
    if (value === 0 && spec.min === 0) {
      return null; // the measured "none" sentinel
    }
    return String(value);
  }
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Every `REFERENCE_FIELDS` occurrence in the document, resolved against the synced
 * tables and rendered through `formatNameRow`.
 *
 * The walk is `shared/quest/validation.ts`'s `walkScalars`, so the owner set
 * (`ReferenceFieldSpec.types`) is applied exactly as the Save gate applies it — a
 * node the validator would not check is not reported here, and vice versa.
 */
function collectReferences(
  db: Db,
  document: unknown,
): { references: EvidenceReference[]; unresolved: string[] } {
  const references: EvidenceReference[] = [];
  const unresolved = new Set<string>();
  const cache = new Map<string, { type: NamesType; row: NameRow } | null>();

  walkScalars(document, (node) => {
    const spec = REFERENCE_FIELDS.find(
      (candidate) =>
        candidate.key === node.key &&
        node.typeName !== null &&
        candidate.types.includes(node.typeName),
    );
    if (spec === undefined) {
      return;
    }
    const candidate = candidateFor(spec, node.value);
    if (candidate === null) {
      return;
    }

    let kind: ReferenceNamespace | null = null;
    let resolved: { type: NamesType; row: NameRow } | null = null;
    for (const namespace of spec.sources) {
      const meta = NAMESPACE_ROW[namespace];
      const cacheKey = `${namespace}:${candidate}`;
      let hit = cache.get(cacheKey);
      if (hit === undefined) {
        const found = db.prepare<Array<string | number>, NameRow>(meta.sql).get(meta.id(candidate));
        hit = found === undefined ? null : { type: meta.type, row: found };
        cache.set(cacheKey, hit);
      }
      if (hit !== null) {
        kind = namespace;
        resolved = hit;
        break;
      }
    }

    references.push({
      field: formatDocPath(node.path),
      value: node.value,
      key: spec.key,
      sources: spec.sources,
      kind,
      resolved:
        resolved === null
          ? null
          : {
              // The display half comes from the one display rule (`client/src/lib/display.ts`),
              // imported rather than re-implemented, so no second construction of
              // `friendly (technical)` can exist in the server either.
              display: formatNameRow(resolved.type, resolved.row),
            },
    });

    if (resolved === null) {
      unresolved.add(
        `${spec.key} value ${JSON.stringify(node.value)} is not in the ${spec.sources.join(' or ')} table`,
      );
    }
  });

  return { references, unresolved: [...unresolved].sort() };
}

/* ------------------------------------------------------------------ the whole */

export interface EvidenceOptions {
  db: Db;
  /** The D19 content-keyed index over the SpiralDB root (the quest file's reader). */
  index: SpiraldbIndex;
  /** Lookups read once by the caller; read per call when absent. */
  tables?: EvidenceTables;
}

/** The quest file's document, or `undefined` when the name has no file (a catalog-only row). */
function readDocument(
  options: EvidenceOptions,
  name: string | null,
): Record<string, unknown> | undefined {
  if (name === null) {
    return undefined;
  }
  const file = options.index.pathFor('questtemplates', name);
  if (file === undefined) {
    return undefined;
  }
  const parsed = readSpiraldbJson(file);
  return isPlainObject(parsed) ? parsed : undefined;
}

/** The goal gates of one catalog name, grouped, plus the ungated-reference count. */
function goalGates(db: Db, name: string | null): { gates: EvidenceGoalGate[]; ungated: number } {
  if (name === null) {
    return { gates: [], ungated: 0 };
  }
  const rows = db
    .prepare<
      [string],
      {
        wad: string;
        entry: string;
        class: string;
        goal_name: string | null;
        required_status: string | null;
      }
    >(
      `SELECT wad, entry, class, goal_name, required_status
         FROM quest_catalog_refs WHERE quest_name = ?
        ORDER BY goal_name, wad, entry, class`,
    )
    .all(name);

  const byGate = new Map<string, EvidenceGoalGate>();
  let ungated = 0;
  for (const row of rows) {
    if (row.goal_name === null) {
      ungated += 1;
      continue;
    }
    const key = `${row.goal_name}\u0000${row.required_status ?? ''}`;
    let gate = byGate.get(key);
    if (gate === undefined) {
      gate = { goal_name: row.goal_name, required_status: row.required_status, refs: [] };
      byGate.set(key, gate);
    }
    gate.refs.push({ wad: row.wad, entry: row.entry, class: row.class });
  }
  return { gates: [...byGate.values()], ungated };
}

/** The tails every path builds after `quest` — shared by both entry points. */
function assemble(options: {
  db: Db;
  tables: EvidenceTables;
  quest: EvidenceQuestHeader;
  document: Record<string, unknown> | undefined;
  textCategory: string | null;
  catalogName: string | null;
}): QuestEvidence {
  const { db, tables, quest, document, textCategory, catalogName } = options;
  const warnings: string[] = [];

  // --- text rows: the split is a per-row predicate over the file's own string values ---
  const referencedBy =
    document === undefined ? new Map<string, string>() : stringValuesByKey(document);
  const rows = textCategory === null ? [] : questTextRows(db, textCategory);
  const text_rows: EvidenceTextRow[] = rows.map((row) => {
    const field = referencedBy.get(row.key) ?? null;
    return {
      key: row.key,
      value: row.value,
      category: textCategory ?? '',
      used_by_this_file: field !== null,
      field,
    };
  });
  if (textCategory === null && quest.quest_id !== null) {
    warnings.push(
      `quest id ${quest.quest_id} has no WizQst table in the string table, so text_rows is empty`,
    );
  }

  // --- dialogue: the file's entries, in document order, with the ladder per line ---
  const ownRowKeys = new Set(rows.map((row) => row.key));
  const dialogue: EvidenceDialogue[] = [];
  const fallbacks = new Map<string, { count: number; line: number }>();
  let noPersonaLines = 0;
  if (document !== undefined) {
    for (const { path, entry } of dialogEntries(document)) {
      const line = dialogue.length;
      const resolution = resolveSpeaker({ entry, line, tables });
      if (resolution.missingPersona) {
        const seen = fallbacks.get(resolution.speaker.persona);
        if (seen === undefined) {
          fallbacks.set(resolution.speaker.persona, { count: 1, line });
        } else {
          seen.count += 1;
        }
      }
      if (resolution.speaker.source === 'raw' && resolution.speaker.persona === '') {
        noPersonaLines += 1;
      }
      const dialogKey = text(entry.m_dialog);
      dialogue.push({
        index: line,
        field: formatDocPath(path),
        dialog_key: dialogKey,
        own_table: dialogKey !== null && ownRowKeys.has(dialogKey),
        text: dialogKey === null ? null : (tables.strings.get(dialogKey) ?? null),
        speaker: resolution.speaker,
        portrait: text(entry.m_picture),
        sound: text(entry.m_soundFile),
        camera_name: text(entry.m_cameraName),
        actor_template_id:
          typeof entry.m_actorTemplateID === 'number' && Number.isInteger(entry.m_actorTemplateID)
            ? entry.m_actorTemplateID
            : null,
      });
    }
  }
  // One line per unresolved persona, carrying how many lines it affected — the count ac2 asks
  // for, visible in the response rather than only in a log.
  for (const [persona, seen] of [...fallbacks.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    warnings.push(
      `${seen.count} dialogue line${seen.count === 1 ? '' : 's'} resolve to the raw persona string: "${persona}" is absent from the manifest index (first at line ${seen.line})`,
    );
  }
  if (noPersonaLines > 0) {
    warnings.push(
      `${noPersonaLines} dialogue line${noPersonaLines === 1 ? ' names' : 's name'} no persona (m_personaName is empty) and no override or composed name resolved, so no speaker name could be resolved`,
    );
  }

  // --- goal gates ---
  const { gates, ungated } = goalGates(db, catalogName);
  if (ungated > 0) {
    warnings.push(
      `${ungated} referencing object${ungated === 1 ? ' carries' : 's carry'} no goal gate; ${
        ungated === 1 ? 'it is' : 'they are'
      } counted here rather than shown as a gate`,
    );
  }

  // --- references ---
  const collected =
    document === undefined ? { references: [], unresolved: [] } : collectReferences(db, document);
  for (const sentence of collected.unresolved) {
    warnings.push(`unresolved reference: ${sentence}`);
  }

  return {
    quest,
    text_rows,
    goal_gates: gates,
    dialogue,
    references: collected.references,
    warnings,
  };
}

/* ----------------------------------------------------------------- entry points */

/**
 * `GET /api/quests/:name/evidence`.
 *
 * The **catalog** decides whether the name is known: a `quests` row is required
 * (absent → `unknown` → 404), exactly as the spec's "unknown quest 404s" reads. The
 * quest's id comes from the world's link (`quest_ids.matched_quest_name`) when one
 * exists, else from the file's own `m_questTitle` key — which is how a quest the
 * world never references (`link_kind: 'none'`) still reaches its own text table.
 */
export function questEvidenceByName(options: EvidenceOptions, name: string): EvidenceResult {
  const { db } = options;
  const row = db
    .prepare<[string], QuestRow>(
      'SELECT quest_name, title, has_definition, link_kind, title_source FROM quests WHERE quest_name = ?',
    )
    .get(name);
  if (row === undefined) {
    return { kind: 'unknown' };
  }

  const tables = options.tables ?? readEvidenceTables(db);
  const document = readDocument(options, name);
  const linked = db
    .prepare<[string], QuestIdRow>(
      `SELECT quest_id, title_key, title, text_rows, matched_quest_name, link_kind, inference_basis
         FROM quest_ids WHERE matched_quest_name = ? ORDER BY quest_id`,
    )
    .get(name);
  const titleKey = text(document?.m_questTitle);
  const fileId = titleKey === null ? null : parseQuestTitleKey(titleKey);
  const questId = linked?.quest_id ?? fileId;
  const textCategory = questId === null ? null : (tables.textTables.get(questId) ?? null);

  return {
    kind: 'found',
    evidence: assemble({
      db,
      tables,
      catalogName: name,
      document,
      textCategory,
      quest: {
        quest_name: name,
        quest_id: questId,
        has_definition: row.has_definition === 1,
        link_kind: asTitleSource(row.link_kind),
        title: row.title === '' ? null : row.title,
        title_source: asTitleSource(row.title_source),
        inference_basis: linked?.inference_basis ?? null,
      },
    }),
  };
}

/**
 * `GET /api/quest-ids/:id/evidence` — the id tier.
 *
 * A `quest_ids` row is required (absent → 404). An id with no linked catalog name
 * answers `quest_name: null` and `has_definition: false`; `title_source` is then the
 * **id row's** `link_kind` — the same enum, answering the same question for a row
 * that has no `quests` row to carry a title_source (documented on
 * {@link EvidenceQuestHeader}).
 */
export function questEvidenceById(options: EvidenceOptions, questId: number): EvidenceResult {
  const { db } = options;
  const idRow = db
    .prepare<[number], QuestIdRow>(
      `SELECT quest_id, title_key, title, text_rows, matched_quest_name, link_kind, inference_basis
         FROM quest_ids WHERE quest_id = ?`,
    )
    .get(questId);
  if (idRow === undefined) {
    return { kind: 'unknown' };
  }

  const tables = options.tables ?? readEvidenceTables(db);
  const catalogName = idRow.matched_quest_name;
  const catalog =
    catalogName === null
      ? undefined
      : db
          .prepare<[string], QuestRow>(
            'SELECT quest_name, title, has_definition, link_kind, title_source FROM quests WHERE quest_name = ?',
          )
          .get(catalogName);
  const document = readDocument(options, catalogName);
  const textCategory = tables.textTables.get(questId) ?? null;

  return {
    kind: 'found',
    evidence: assemble({
      db,
      tables,
      catalogName,
      document,
      textCategory,
      quest: {
        quest_name: catalogName,
        quest_id: questId,
        has_definition: catalog?.has_definition === 1,
        link_kind: asTitleSource(idRow.link_kind),
        title: catalog?.title ?? idRow.title,
        title_source:
          catalog === undefined
            ? asTitleSource(idRow.link_kind)
            : asTitleSource(catalog.title_source),
        inference_basis: idRow.inference_basis,
      },
    }),
  };
}
