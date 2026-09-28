import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { Db } from '../db.js';
import { escapeLike } from './names.js';
import { parseJsonLenient } from './sync/json.js';
import type { SpiraldbIndex } from './spiraldbIndex.js';

/**
 * The **NPC name namespace** — P6-17 / D112, the read behind `GET /api/search`'s
 * `npc` group (and, when it lands, `GET /api/npcs/:id`).
 *
 * ## Why NPC names are not the `npcs` table
 *
 * The corpus's dominant name reference is not `npcs` at all. `WC-NPCs_*` is
 * referenced **1,733** times and `m_nameOverride` stores a *key*
 * (`WC-NPCs_00000027` ×28, `WC-NPCs_00000030` ×17), never literal text
 * (docs/evidence/quest-catalog-findings.md Measurement 5). Three string-table
 * categories therefore carry names — `WC-NPCs` (2,641 rows), `NPCs` (2,450) and
 * `WizardNPC` (1,237) — and the composition format the client consumes reads
 * `Persona,First` (78) / `Persona,Last` (57) components.
 *
 * ## Keyed on the NPC, not on the name string
 *
 * One NPC legitimately carries several strings at different granularities:
 * `WC-NPCs_00000003 = "Gretta Darkkettle"` and `WC-NPCs_00000009 = "Gretta"` are the
 * same person. Keying on the string would turn one NPC into four entities and make a
 * search for `Gretta` return duplicates — the risk this module exists to close.
 *
 * So an alias string is **resolved to a template** and grouped by it:
 *
 * 1. an exact `npcs.name` match wins (`Gretta Darkkettle` → template 38098);
 * 2. otherwise the string is read as the **first-name component** of a template's
 *    name — the `NPCFormats_First_Only` granularity (`Gretta` → the first token of
 *    `Gretta Darkkettle` → template 38098). This is a whole-token comparison, never a
 *    substring: `Grett` resolves to nothing;
 * 3. otherwise the string stands alone as an alias-only entry with no template
 *    (`npc_key` = the string itself), which is the honest answer for a name the
 *    client can display but the manifest cannot place.
 *
 * The tie-break when several templates carry the same name is the **lowest
 * template id** — deterministic, and the same rule `objects.ts`'s
 * `ENGINE_OBJECT_TEMPLATE_MAX_ID` documents: the id space's low block is engine
 * infrastructure (`Player Object`, `GenericCinematicActor`, …), not characters, so
 * entity templates start above it.
 *
 * `Gretta` and `Gretta Darkkettle` therefore resolve to **one** entity carrying both
 * strings as aliases — the measured pair the acceptance criterion names, and the
 * negative control for this module.
 */

/**
 * The largest client template id that is an **engine object** rather than a
 * character (D105/P6-16's "a row whose template is an engine object renders the
 * technical value alone").
 *
 * `npcs` is one flat list with **no classification column** — the sync writes
 * `npc_type = NULL` for all 23,033 rows by decision D33(a) — so the partition is
 * *measured* rather than declared, and it is measured to be exact on the live
 * database: the nine rows at or below this id are `Player Object` (1), `PetObject`
 * (2), `MountObject` (3, 5), `Summoned Creature` (10), `GenericCinematicActor`
 * (600), `AcousticsTemplate` (2944), `Basic Positional` (2960) and `Basic Ambient`
 * (2961), and the next id in the table is `4,118` (`Lydia Greyrose`) — which is
 * also the **smallest `TemplateID` any of the four families' corpus rows carries**
 * (lead-verified 2026-09-28). So no corpus row of those families can be an engine
 * object, and this floor cannot hide a real NPC.
 *
 * The honest limit: the database cannot tell a character from a prop above the
 * floor (`Brazier`, `Obelisk`, `WC_MiniGameKiosk` are templates too, and they pair
 * with their template name — the spec's rule is `npcs.name`). Only the engine block
 * is excluded, and this constant is the whole of that exception.
 */
export const ENGINE_OBJECT_TEMPLATE_MAX_ID = 4117;

/** The string-table categories whose `value` is an NPC name string (D112). */
export const NPC_ALIAS_CATEGORIES = [
  'WC-NPCs',
  'NPCs',
  'WizardNPC',
  'Persona,First',
  'Persona, Last',
  'Persona,Last',
] as const;

/**
 * Category priority for the entity's representative `npc_key`, most-corpus-referenced
 * first (findings Measurement 5: `WC-NPCs` 1,733 references, `NPCs` 7, `WizardNPC` 2).
 */
const NPC_KEY_CATEGORY_ORDER: readonly string[] = [
  'WC-NPCs',
  'NPCs',
  'WizardNPC',
  'Persona,First',
  'Persona, Last',
  'Persona,Last',
];

/** One row of the alias vocabulary. */
export interface NpcAliasRow {
  /** The string-table key (`WC-NPCs_00000003`) — an NPC key form the view accepts. */
  key: string;
  /** The name string itself (`Gretta Darkkettle`). */
  value: string;
  category: string;
}

/** The template a name resolved to, or `null` for an alias-only entry. */
interface NpcTemplate {
  templateId: number;
  name: string;
}

/**
 * The `npcs` rows as two resolution maps: by whole name, and by **first token** (the
 * `NPCFormats_First_Only` granularity). Built lowest-id-first so the first writer of a
 * key is the deterministic winner.
 */
interface NpcTemplateIndex {
  byName: Map<string, NpcTemplate>;
  byFirstToken: Map<string, NpcTemplate>;
}

/** One NPC entity: the identity plus every name string that resolves to it. */
export interface NpcEntity {
  /**
   * The entity's representative key: the alias-vocabulary key whose value is the
   * display name (category priority above), else the template id as text.
   */
  npc_key: string;
  /** The resolved `npcs.template_id`, or `null` for an alias-only entry. */
  template_id: number | null;
  /** The full name (`Gretta Darkkettle`), never a composed guess. */
  display_name: string;
  /** Every name string for this NPC, sorted, the display name included. */
  aliases: string[];
  /** The alias rows behind {@link aliases}, in key order — the persona components too. */
  alias_rows: NpcAliasRow[];
}

function buildTemplateIndex(db: Db): NpcTemplateIndex {
  const rows = db
    .prepare<[number], { template_id: number; name: string }>(
      'SELECT template_id, name FROM npcs WHERE template_id > ? ORDER BY template_id',
    )
    .all(ENGINE_OBJECT_TEMPLATE_MAX_ID);

  const byName = new Map<string, NpcTemplate>();
  const byFirstToken = new Map<string, NpcTemplate>();
  for (const row of rows) {
    if (typeof row.name !== 'string' || row.name.trim() === '') {
      continue;
    }
    const template: NpcTemplate = { templateId: row.template_id, name: row.name };
    const lower = row.name.toLowerCase();
    if (!byName.has(lower)) {
      byName.set(lower, template);
    }
    const first = lower.split(' ')[0] ?? lower;
    if (!byFirstToken.has(first)) {
      byFirstToken.set(first, template);
    }
  }
  return { byName, byFirstToken };
}

/** Every alias row in the vocabulary (6,463 rows on the live database). */
function aliasRows(db: Db): NpcAliasRow[] {
  const placeholders = NPC_ALIAS_CATEGORIES.map(() => '?').join(', ');
  return db
    .prepare<string[], NpcAliasRow>(
      `SELECT key, value, category FROM string_table WHERE category IN (${placeholders}) ORDER BY key`,
    )
    .all(...NPC_ALIAS_CATEGORIES);
}

/** The template a name string resolves to, or `null` when it stands alone. */
function resolveTemplate(index: NpcTemplateIndex, value: string): NpcTemplate | null {
  const lower = value.trim().toLowerCase();
  if (lower === '') {
    return null;
  }
  return index.byName.get(lower) ?? index.byFirstToken.get(lower) ?? null;
}

/** The grouping key of an alias string: the resolved name, else the string itself. */
function canonicalFor(index: NpcTemplateIndex, value: string): string {
  return resolveTemplate(index, value)?.name ?? value;
}

/** The representative alias key for a name, by the documented category priority. */
function npcKeyFor(rows: readonly NpcAliasRow[], displayName: string): string | null {
  let best: { key: string; rank: number } | null = null;
  for (const row of rows) {
    if (row.value !== displayName) {
      continue;
    }
    const rank = NPC_KEY_CATEGORY_ORDER.indexOf(row.category);
    if (rank === -1) {
      continue;
    }
    if (best === null || rank < best.rank || (rank === best.rank && row.key < best.key)) {
      best = { key: row.key, rank };
    }
  }
  return best?.key ?? null;
}

/** Builds one entity from its display name, template and alias rows. */
function buildEntity(
  index: NpcTemplateIndex,
  displayName: string,
  aliasSet: Map<string, NpcAliasRow>,
  template: NpcTemplate | null,
): NpcEntity {
  const rows = [...aliasSet.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const names = new Set<string>([displayName]);
  for (const row of rows) {
    names.add(row.value);
  }
  const resolved = template ?? resolveTemplate(index, displayName);
  const npcKey = npcKeyFor(rows, displayName) ?? String(resolved?.templateId ?? displayName);
  return {
    npc_key: npcKey,
    template_id: resolved?.templateId ?? null,
    display_name: displayName,
    aliases: [...names].sort(),
    alias_rows: rows,
  };
}

/** The rank the palette orders by: exact match, then prefix, then substring. */
function matchRank(names: readonly string[], q: string): 0 | 1 | 2 {
  const lower = names.map((name) => name.toLowerCase());
  if (lower.some((name) => name === q)) {
    return 0;
  }
  if (lower.some((name) => name.startsWith(q))) {
    return 1;
  }
  return 2;
}

/**
 * The entities matched by `q`, ranked exactly as the palette's other groups are
 * (exact → prefix → substring over the matched column, then `name, id`).
 *
 * The match is over the entity's **aliases** (`WC-NPCs_00000009 = "Gretta"` matches
 * `gretta`, so the entity carrying `Gretta Darkkettle` matches too) and over its
 * template name — never over the template id, which is the `names` API's search and
 * the four families' join, not this group's (spec-api L537-539).
 *
 * @param limit per-group cap + 1: the caller observes the overflow rather than
 *              assuming it, exactly as {@link searchAll} does for every group.
 */
export function searchNpcEntities(db: Db, q: string, limit: number): NpcEntity[] {
  const needle = q.trim().toLowerCase();
  if (needle === '') {
    return [];
  }
  const index = buildTemplateIndex(db);
  const pattern = `%${escapeLike(needle)}%`;

  // The alias rows that match, and the templates whose name does. Both are needed:
  // `Gretta` is only an alias of the entity, while `Zarek` may only be a template
  // name with no alias row at all.
  const allAliasRows = aliasRows(db);
  const matchedAliasRows = allAliasRows.filter((row) => row.value.toLowerCase().includes(needle));
  const matchedTemplateNames = db
    .prepare<[number, string], { name: string }>(
      `SELECT DISTINCT name FROM npcs WHERE template_id > ? AND lower(name) LIKE ? ESCAPE '\\'`,
    )
    .all(ENGINE_OBJECT_TEMPLATE_MAX_ID, pattern);

  const wanted = new Set<string>(matchedAliasRows.map((row) => canonicalFor(index, row.value)));
  for (const row of matchedTemplateNames) {
    wanted.add(canonicalFor(index, row.name));
  }

  const entities: NpcEntity[] = [];
  for (const canonical of wanted) {
    // Every alias row that resolves to this entity — including the ones that did not
    // match `q` themselves (`Gretta Darkkettle` must come back for `Gretta`).
    const aliasSet = new Map<string, NpcAliasRow>();
    for (const row of allAliasRows) {
      if (canonicalFor(index, row.value) === canonical) {
        aliasSet.set(row.key, row);
      }
    }
    entities.push(buildEntity(index, canonical, aliasSet, null));
  }

  return entities
    .map((entity) => ({
      entity,
      rank: matchRank([entity.display_name, ...entity.aliases], needle),
    }))
    .sort((a, b) => {
      if (a.rank !== b.rank) {
        return a.rank - b.rank;
      }
      if (a.entity.display_name !== b.entity.display_name) {
        return a.entity.display_name < b.entity.display_name ? -1 : 1;
      }
      return a.entity.npc_key < b.entity.npc_key ? -1 : a.entity.npc_key > b.entity.npc_key ? 1 : 0;
    })
    .slice(0, limit)
    .map((entry) => entry.entity);
}

/**
 * One entity by **either** key form the view accepts: a numeric template id, or an
 * alias-vocabulary string-table key (`WC-NPCs_00000003`). `undefined` ⇒ 404.
 */
export function npcEntityById(db: Db, rawId: string): NpcEntity | undefined {
  const index = buildTemplateIndex(db);
  const all = aliasRows(db);

  let displayName: string | undefined;
  let template: NpcTemplate | null = null;

  if (/^\d+$/.test(rawId)) {
    const templateId = Number(rawId);
    if (!Number.isSafeInteger(templateId) || templateId <= ENGINE_OBJECT_TEMPLATE_MAX_ID) {
      return undefined;
    }
    const row = db
      .prepare<[number], { template_id: number; name: string }>(
        'SELECT template_id, name FROM npcs WHERE template_id = ?',
      )
      .get(templateId);
    if (row === undefined) {
      return undefined;
    }
    displayName = row.name;
    template = { templateId: row.template_id, name: row.name };
  } else {
    const row = all.find((candidate) => candidate.key === rawId);
    if (row === undefined) {
      return undefined;
    }
    template = resolveTemplate(index, row.value);
    displayName = template?.name ?? row.value;
  }

  const aliasSet = new Map<string, NpcAliasRow>();
  for (const row of all) {
    if (canonicalFor(index, row.value) === displayName) {
      aliasSet.set(row.key, row);
    }
  }
  return buildEntity(index, displayName, aliasSet, template);
}

/* ------------------------------------------------------------------ the view */

/**
 * The **NPC view** — `GET /api/npcs/:id` (P6-17 / D112; docs/spec-api.md L496-550).
 *
 * Task 6.5 shipped the namespace ({@link searchNpcEntities}, {@link npcEntityById});
 * the plan carried this endpoint to task 6.6 because two of its arms need the
 * **speaker ladder's index** (`persona_index`, `server/src/services/sync/personaIndex.ts`):
 * `personas` and `dialogs` are exactly the reverse of `persona name → NPC`, and
 * answering them as empty arrays before that index existed would have claimed "this
 * NPC has no personas" when the truth was "nothing could resolve them".
 *
 * Every arm is resolved live from the indexed tables and the corpus files — the same
 * rule the evidence endpoint follows. `counts` are computed from the arms that were
 * actually returned, so a caller never re-derives them and can never disagree with
 * what it sees.
 */

/** One persona of the NPC: the persona key plus its resolved components. */
export interface NpcViewPersona {
  /** The persona name as the corpus references it (`WC_RAV-NPC02_Persona` spelling preserved). */
  persona_key: string;
  /** The resolved `m_firstName` text, or `null` when no persona struct supplied one. */
  first: string | null;
  /** The resolved `m_lastName` text, or `null`. */
  last: string | null;
  /** The manifest id this persona resolves to — the id that made it this NPC's persona. */
  template_id: number | null;
}

/** One dialogue line of the NPC, as recorded by a corpus quest file. */
export interface NpcViewDialog {
  quest_name: string;
  /** Position among that quest's dialogue entries, in document order (0-based). */
  index: number;
  /** The resolved `m_dialog` text, or `null` when the key resolves to nothing. */
  text: string | null;
}

/** One NPC-keyed inventory file. */
export interface NpcInventoryRow {
  /** The object key (`TemplateID`, stringified). */
  key: string;
  /** The file's path relative to the SpiralDB root. */
  file: string;
}

export interface NpcView {
  npc_key: string;
  template_id: number | null;
  display_name: string;
  aliases: string[];
  personas: NpcViewPersona[];
  dialogs: NpcViewDialog[];
  quests: string[];
  inventories: {
    npc_inventories: NpcInventoryRow[];
    npc_spell_inventories: NpcInventoryRow[];
    npc_drop_tables: NpcInventoryRow[];
  };
  counts: { aliases: number; personas: number; dialogs: number; quests: number };
  /**
   * Why an arm is empty, when the reason is not "there are no rows": a public
   * endpoint that answers `[]` for an arm it could **not resolve** would read as a
   * claim about the corpus. Each note names the arm and the missing input, and the
   * array is empty unless an arm genuinely could not be populated.
   */
  notes: string[];
}

/** The three NPC-keyed inventory families and their corpus directories. */
const NPC_INVENTORY_FAMILIES = [
  { arm: 'npc_inventories', fileType: 'npcinventory', directory: 'NpcInventory' },
  { arm: 'npc_spell_inventories', fileType: 'npcspellinventory', directory: 'NpcSpellInventory' },
  { arm: 'npc_drop_tables', fileType: 'npcdroptable', directory: 'NpcDropTable' },
] as const;

/** One `persona_index` row, as the view needs it. */
interface PersonaIndexRow {
  object_name: string;
  template_id: number | null;
  first_key: string | null;
  last_key: string | null;
}

/** Non-empty string member, else `null`. */
function viewText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** `WC_ShopArea_RobeShop_Persona` → `WC_ShopArea_RobeShop` (the index's key). */
function personaObjectName(personaName: string): string {
  return personaName.endsWith('_Persona') ? personaName.slice(0, -'_Persona'.length) : personaName;
}

/**
 * Every dialogue entry of one quest file, in document order, with the path-free
 * index the view reports. The detection rule is the evidence endpoint's — an
 * object's own `$type` names `NPCDialogEntry` — so the two readers cannot disagree
 * about what a dialogue entry is.
 */
function questDialogEntries(document: unknown): Array<{ entry: Record<string, unknown> }> {
  const found: Array<{ entry: Record<string, unknown> }> = [];
  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== 'object' || value === null) {
      return;
    }
    const record = value as Record<string, unknown>;
    const declared = record.$type;
    if (typeof declared === 'string' && declared.includes('NPCDialogEntry')) {
      found.push({ entry: record });
    }
    for (const [key, child] of Object.entries(record)) {
      if (key !== '$type') {
        visit(child);
      }
    }
  }
  visit(document);
  return found;
}

/** `true` when one dialogue entry names this NPC (by persona, or by template id directly). */
function entryNamesNpc(
  entry: Record<string, unknown>,
  personaObjects: ReadonlySet<string>,
  templateId: number | null,
): boolean {
  const persona = viewText(entry.m_personaName);
  if (persona !== null && personaObjects.has(personaObjectName(persona))) {
    return true;
  }
  if (templateId === null) {
    return false;
  }
  // The entry may also name the NPC's template outright (`m_actorTemplateID` on the zone
  // entries, `m_walkAwayNpcTemplateID` when the actor walks away) — a direct link the
  // persona arm does not cover, so it is its own test rather than an inference.
  return entry.m_actorTemplateID === templateId || entry.m_walkAwayNpcTemplateID === templateId;
}

/**
 * One NPC's view, or `undefined` for an id that resolves to nothing (⇒ 404).
 *
 * @param rawId the numeric template id **or** an alias-vocabulary key
 *              (`WC-NPCs_00000003`) — both forms {@link npcEntityById} accepts.
 */
export function buildNpcView(db: Db, index: SpiraldbIndex, rawId: string): NpcView | undefined {
  const entity = npcEntityById(db, rawId);
  if (entity === undefined) {
    return undefined;
  }

  const strings = new Map<string, string>();
  for (const row of db
    .prepare<[], { key: string; value: string }>('SELECT key, value FROM string_table')
    .all()) {
    strings.set(row.key, row.value);
  }

  const notes: string[] = [];
  const templateId = entity.template_id;

  // --- personas: every persona_index row that resolves to this NPC's template id ---
  const personaRows =
    templateId === null
      ? []
      : db
          .prepare<[number], PersonaIndexRow>(
            `SELECT object_name, template_id, first_key, last_key
               FROM persona_index WHERE template_id = ? ORDER BY object_name`,
          )
          .all(templateId);
  const personas: NpcViewPersona[] = personaRows.map((row) => ({
    persona_key: `${row.object_name}_Persona`,
    first: row.first_key === null ? null : (strings.get(row.first_key) ?? row.first_key),
    last: row.last_key === null ? null : (strings.get(row.last_key) ?? row.last_key),
    template_id: row.template_id,
  }));
  // Keyed by the persona's object name, so both spellings the corpus uses
  // (`X_Persona` and bare `X`) match through `personaObjectName` below.
  const personaObjects = new Set<string>(personaRows.map((row) => row.object_name));

  // --- dialogs + quests: a live scan of the corpus quest files ---
  const dialogs: NpcViewDialog[] = [];
  const questNames = new Set<string>();
  const actorMarker = templateId === null ? null : String(templateId);
  for (const questName of index.keys('questtemplates')) {
    const file = index.pathFor('questtemplates', questName);
    if (file === undefined) {
      continue;
    }
    let raw: string;
    try {
      raw = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    // A cheap gate first: only a file that mentions one of this NPC's persona names (or its
    // template id beside the actor keys) can hold a line for it, so the JSON5 parse is paid
    // once per matching file rather than once per corpus file.
    const mentionsPersona = [...personaObjects].some((objectName) =>
      raw.includes(`${objectName}_Persona`),
    );
    const mentionsActor =
      actorMarker !== null &&
      new RegExp(`"m_(actor|walkAwayNpc)TemplateID"\\s*:\\s*${actorMarker}\\b`).test(raw);
    if (!mentionsPersona && !mentionsActor) {
      continue;
    }
    let document: unknown;
    try {
      document = parseJsonLenient(raw);
    } catch {
      continue;
    }
    questDialogEntries(document).forEach((node, position) => {
      if (!entryNamesNpc(node.entry, personaObjects, templateId)) {
        return;
      }
      questNames.add(questName);
      const dialogKey = viewText(node.entry.m_dialog);
      dialogs.push({
        quest_name: questName,
        index: position,
        text: dialogKey === null ? null : (strings.get(dialogKey) ?? null),
      });
    });
  }

  // --- inventories: the corpus files whose key IS this NPC's template id ---
  const inventories: NpcView['inventories'] = {
    npc_inventories: [],
    npc_spell_inventories: [],
    npc_drop_tables: [],
  };
  for (const family of NPC_INVENTORY_FAMILIES) {
    if (templateId === null) {
      continue;
    }
    const rows: NpcInventoryRow[] = [];
    for (const key of index.keys(family.fileType)) {
      // The key **is** the `TemplateID` (shared/objectTypes.ts's `keyField`), compared as a
      // number rather than as text so `44169` and `044169` cannot disagree.
      if (!/^\d+$/.test(key) || Number(key) !== templateId) {
        continue;
      }
      const file = index.pathFor(family.fileType, key);
      if (file !== undefined) {
        rows.push({ key, file: path.relative(index.root, file) });
      }
    }
    inventories[family.arm] = rows;
  }

  if (templateId === null) {
    notes.push(
      `personas, dialogs, quests and the inventory arms could not be resolved: "${entity.npc_key}" is an alias-only entity with no template id (the manifest index places none of its names on an NPC template).`,
    );
  }
  for (const family of NPC_INVENTORY_FAMILIES) {
    if (inventories[family.arm].length > 0) {
      continue;
    }
    if (!existsSync(path.join(index.root, family.directory))) {
      notes.push(
        `inventories.${family.arm} is empty because ${family.directory}/ does not exist in this corpus, not because no row matched.`,
      );
    }
  }

  return {
    npc_key: entity.npc_key,
    template_id: templateId,
    display_name: entity.display_name,
    aliases: entity.aliases,
    personas,
    dialogs,
    quests: [...questNames].sort(),
    inventories,
    counts: {
      aliases: entity.aliases.length,
      personas: personas.length,
      dialogs: dialogs.length,
      quests: questNames.size,
    },
    notes,
  };
}
