import { fileNameFor, type ObjectFileType } from './naming.js';

/**
 * The per-type table task 4.1's generic scaffolding is driven by — the eight
 * non-quest object types of docs/spec-api.md L310-319, one row each.
 *
 * One row answers every question the router, the list/detail/save service and the
 * client page need, so the eight types share one code path and their editors can
 * only diverge in the form:
 *
 * | field        | meaning                                                             |
 * |--------------|---------------------------------------------------------------------|
 * | `fileType`   | the naming/index family id (`shared/naming.ts`) — the resolution key |
 * | `urlPath`    | the base path of docs/spec-api.md L310-319, `/api` included         |
 * | `routeType`  | the D4 plural status route type, `null` where D4 has none           |
 * | `objectType` | the D4 singular `entry_status.object_type`, `null` for GlobalRegistry |
 * | `directory`  | the SpiralDB subdirectory the family lives in                        |
 * | `keyField`   | the JSON field the key is read from, `null` for the unkeyed registry |
 * | `keyType`    | `'ulong'` for the four `TemplateID` families — see `shared/ulong.ts` |
 * | `audit`      | where audit metadata lives (see the doc-comment below)               |
 *
 * `fileType`, `objectType`, `directory` and `keyField` are each *also* stated by
 * `SPIRALDB_COLLECTIONS` in `server/src/services/spiraldbFiles.ts` (the file layer's
 * own table) and `objectType` again by D4's `STATUS_TYPE_BY_ROUTE`. This table is
 * the one the route and the client read; `tests/unit/object-types.test.ts` asserts
 * all three agree row for row, so a divergence fails a test instead of producing a
 * 404 or a wrong status join.
 *
 * ## `audit` is declarative, and nothing in this story stamps it
 *
 * docs/spec-data-model.md L189-191: only **quests** get a companion metadata file;
 * every other type that needs `CreatedAt`/`CreatedBy`/`ModifiedAt`/`ModifiedBy`
 * embeds them in its main JSON. Measured in the fork: `DropTables/` carries all four
 * in 316 of 317 files, and the other six keyed families carry none.
 *
 * So `audit: 'embedded'` marks the family whose document *is* the audit record (the
 * drop table) and `'none'` the rest; it tells the client to render the audit
 * disclosure and tells the server that those keys are ordinary document fields that
 * ride through the D5 merge untouched. **Task 4.1 deliberately does not stamp them**:
 * a generic writer that refreshed `ModifiedAt` on every save would add an invisible
 * second writer to 2,000 corpus files, and per-type stamping is the per-type
 * editor's contract (plan task 4.2 owns the DropTable Audit section; L189-191 is
 * about where the fields live, not about who fills them). Recorded for the lead.
 *
 * ## The create name is `fileNameFor`, never a hand-built string
 *
 * `createNameFor` delegates to `shared/naming.ts`, which is the single home of the
 * `{prefix}_{key}.json` convention — including the singular `droptable_` prefix
 * that D26 chooses for new files even though every legacy file is `droptables_`,
 * and the zone `/` → `_` transform. The save path the router actually uses is the
 * pipeline's `createTargetPath`, which calls the same function.
 */

/** Which representation the family's key uses in JSON — see `shared/ulong.ts`. */
export type ObjectKeyType = 'string' | 'ulong';

/**
 * The D4 **singular** type names of the eight families (what
 * `entry_status.object_type` holds). Spelled here rather than imported from
 * `server/src/services/status.ts` because this table is also read by the client,
 * which must not reach into the server tree; `tests/unit/object-types.test.ts`
 * asserts the two lists agree, so the duplication cannot drift.
 */
export type ObjectStatusType =
  | 'drop_table'
  | 'npc_inventory'
  | 'npc_spell_inventory'
  | 'creature_spellbook'
  | 'npc_drop_table'
  | 'treasure_card_inventory'
  | 'zone_transfer';

/** The D4 **plural** route names — what `/api/status/:type` accepts. `null` for GlobalRegistry. */
export type ObjectRouteType =
  | 'drop_tables'
  | 'npc_inventories'
  | 'npc_spell_inventories'
  | 'creature_spellbooks'
  | 'npc_drop_tables'
  | 'treasure_card_inventories'
  | 'zone_transfers';

/**
 * Where the family's audit metadata lives: embedded in the document
 * (`'embedded'`, the drop table today) or nowhere (`'none'`). Declarative — see
 * the module doc-comment.
 */
export type ObjectAuditMode = 'embedded' | 'none';

/**
 * The **friendly source** that carries a family's friendly names, per spec-ui-design
 * §Names L56-63 (D105/P6-16), or `null` when the family has no friendly source.
 *
 * One string rather than two loose column names: the server resolves
 * `friendly_name` from exactly one specification per name, so the list row, the
 * search row and a detail header cannot disagree about where a name lives.
 *
 * `npcs` and `zones` are rows of `NAMES_TYPE_SPECS` (`GET /api/names/:type` serves
 * them unchanged). **`decks` is deliberately not a names type**: D112 freezes
 * `spec-api.md` L13's seven types and `tests/unit/names.test.ts` with them, so the
 * `decks` row lives in the same table without joining the endpoint's vocabulary —
 * task 6.9 populated `decks`, and CreatureSpellbook's `friendlyNamesType` is it.
 */
export type ObjectFriendlyNamesType = 'npcs' | 'zones' | 'decks';

export interface ObjectTypeConfig {
  readonly fileType: ObjectFileType;
  /** Base path with the `/api` prefix (docs/spec-api.md L310-319). */
  readonly urlPath: string;
  /** D4 plural status route type; `null` for the family D4 does not list. */
  readonly routeType: ObjectRouteType | null;
  /** D4 singular `entry_status.object_type`; `null` for GlobalRegistry (Q1). */
  readonly objectType: ObjectStatusType | null;
  /** Human label for the client page title. */
  readonly label: string;
  /** SpiralDB subdirectory (docs/spec-data-model.md L266-275). */
  readonly directory: string;
  /** JSON key field, or `null` for the single unkeyed `globalregistry.json`. */
  readonly keyField: string | null;
  readonly keyType: ObjectKeyType;
  readonly audit: ObjectAuditMode;
  /**
   * The names table holding this family's friendly names, or `null` when none
   * exists (spec-ui-design §Names L56-63, D105/P6-16). Drives the server's
   * `ObjectListRow.friendly_name` and the client's single lookup on a detail
   * header — one mapping, both surfaces.
   */
  readonly friendlyNamesType: ObjectFriendlyNamesType | null;
  /**
   * **Why a row of this family has no pair**, in one sentence — `null` when a family
   * that pairs cannot have an unpaired row.
   *
   * It rides to the UI as the key cell's tooltip (`ObjectTable`) on exactly the rows whose
   * `friendly_name` is `null`, so a row with no pair says which state it is in
   * (spec-ui-design L65-69) instead of leaving the reader to guess. It is deliberately a
   * sentence *about the data* rather than a humanised key: a humanised key reads as a name
   * that does not exist.
   *
   * Two families set it. DropTable/GlobalRegistry have no `friendlyNamesType` at all, and
   * **CreatureSpellbook** (task 6.9) does have one but no corpus key reaches it — measured
   * 0 of 134 `DeckName` values against the 599 `decks` rows — so its note explains the miss
   * rather than a missing table.
   */
  readonly friendlyNameNote: string | null;
}

/**
 * The eight rows, in the spec's own order (docs/spec-api.md L310-319). GlobalRegistry
 * is last: it is the one unkeyed, lifecycle-free family (AGENTS.md Q1,
 * docs/spec-data-model.md L277), and D4 deliberately has no route type for it.
 */
export const OBJECT_TYPES: readonly ObjectTypeConfig[] = [
  {
    fileType: 'droptable',
    urlPath: '/api/drop-tables',
    routeType: 'drop_tables',
    objectType: 'drop_table',
    label: 'Drop Tables',
    directory: 'DropTables',
    keyField: 'Name',
    keyType: 'string',
    audit: 'embedded',
    friendlyNamesType: null,
    friendlyNameNote:
      'No friendly source: DropTable.description is NULL in 316 of 317 corpus rows, so the key is the name.',
  },
  {
    fileType: 'npcinventory',
    urlPath: '/api/npc-inventories',
    routeType: 'npc_inventories',
    objectType: 'npc_inventory',
    label: 'NPC Inventories',
    directory: 'NpcInventory',
    keyField: 'TemplateID',
    keyType: 'ulong',
    audit: 'none',
    friendlyNamesType: 'npcs',
    friendlyNameNote: null,
  },
  {
    fileType: 'npcspellinventory',
    urlPath: '/api/npc-spell-inventories',
    routeType: 'npc_spell_inventories',
    objectType: 'npc_spell_inventory',
    label: 'NPC Spell Inventories',
    directory: 'NpcSpellInventory',
    keyField: 'TemplateID',
    keyType: 'ulong',
    audit: 'none',
    friendlyNamesType: 'npcs',
    friendlyNameNote: null,
  },
  {
    fileType: 'creaturespellbook',
    urlPath: '/api/creature-spellbooks',
    routeType: 'creature_spellbooks',
    objectType: 'creature_spellbook',
    label: 'Creature Spellbooks',
    directory: 'CreatureSpellbook',
    keyField: 'DeckName',
    keyType: 'string',
    audit: 'none',
    friendlyNamesType: 'decks',
    // Task 6.9 populated `decks` from the 599 `DeckTemplate` objects, so the family is no longer
    // in the "no source" state — but **no corpus key reaches it**: measured, 0 of the 134
    // `CreatureSpellbook.DeckName` values equals a `DeckTemplate` `m_name`. Those 134 name deck
    // *items* (`ObjectData/Decks/**` basenames, 114 of them; `ObjectData/MinionDeck-*.xml`, 15;
    // 5 exist nowhere in the tree), and those items carry no display name of their own
    // (`m_displayName` is `''`, `m_objectName` **is** the id). So a corpus row renders
    // technical-only, and this note is what says why.
    friendlyNameNote:
      'No paired name for this key: 0 of the 134 corpus DeckName values is a row of decks (the 599 DeckTemplate objects), and the deck items those values name carry no display name of their own — the key is the label.',
  },
  {
    fileType: 'npcdroptable',
    urlPath: '/api/npc-drop-tables',
    routeType: 'npc_drop_tables',
    objectType: 'npc_drop_table',
    label: 'NPC Drop Tables',
    directory: 'NpcDropTable',
    keyField: 'TemplateID',
    keyType: 'ulong',
    audit: 'none',
    friendlyNamesType: 'npcs',
    friendlyNameNote: null,
  },
  {
    fileType: 'treasurecardinventory',
    urlPath: '/api/treasure-card-inventories',
    routeType: 'treasure_card_inventories',
    objectType: 'treasure_card_inventory',
    label: 'Treasure Card Inventories',
    directory: 'TreasureCardInventory',
    keyField: 'TemplateID',
    keyType: 'ulong',
    audit: 'none',
    friendlyNamesType: 'npcs',
    friendlyNameNote: null,
  },
  {
    fileType: 'zonetransfer',
    urlPath: '/api/zone-transfers',
    routeType: 'zone_transfers',
    objectType: 'zone_transfer',
    label: 'Zone Transfers',
    directory: 'ZoneTransfer',
    keyField: 'ZoneName',
    keyType: 'string',
    audit: 'none',
    friendlyNamesType: 'zones',
    friendlyNameNote: null,
  },
  {
    fileType: 'globalregistry',
    urlPath: '/api/global-registry',
    routeType: null,
    objectType: null,
    label: 'Global Registry',
    directory: 'GlobalRegistry',
    keyField: null,
    keyType: 'string',
    audit: 'none',
    friendlyNamesType: null,
    friendlyNameNote:
      'No friendly source: a GlobalRegistry key is a flag name, and the dictionary has no id/label split.',
  },
];

const BY_FILE_TYPE = new Map<string, ObjectTypeConfig>(
  OBJECT_TYPES.map((config) => [config.fileType, config]),
);
/** The config for a family id; throws for anything outside the eight. */
export function objectTypeConfig(fileType: ObjectFileType): ObjectTypeConfig {
  const config = BY_FILE_TYPE.get(fileType);
  if (config === undefined) {
    throw new Error(
      `Unknown object type "${String(fileType)}". Known types: ${OBJECT_TYPES.map(
        (row) => row.fileType,
      ).join(', ')}.`,
    );
  }
  return config;
}

/**
 * The path the family is mounted at **below `/api`** on the server
 * (`routes/index.ts`) and **as the frontend route** of the same name
 * (`docs/spec-api.md` L325-350's `/drop-tables`, `/npc-inventories`, …).
 *
 * One transform, two callers: the API path and the client route are the same string
 * once `/api` is gone, so a mount path and the page that calls it cannot drift.
 */
export function mountPathFor(config: ObjectTypeConfig): string {
  return config.urlPath.replace(/^\/api/, '');
}

/**
 * The file name a **new** entry of `config` is created as — `fileNameFor`, so the
 * create convention has one home. An unkeyed family ignores `key` (the single
 * `globalregistry.json`).
 *
 * @throws {NamingError} see `fileNameFor`: a blank key, a path separator, a NUL, or
 * a key that already ends in `.json`.
 */
export function createNameFor(config: ObjectTypeConfig, key: string): string {
  return fileNameFor(config.fileType, key);
}
