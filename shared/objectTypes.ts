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
  },
];

const BY_FILE_TYPE = new Map<string, ObjectTypeConfig>(
  OBJECT_TYPES.map((config) => [config.fileType, config]),
);
const BY_URL_PATH = new Map<string, ObjectTypeConfig>(
  OBJECT_TYPES.map((config) => [config.urlPath, config]),
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

/** The config mounted at `urlPath`, or `undefined` for a path nothing is mounted at. */
export function objectTypeConfigForUrlPath(urlPath: string): ObjectTypeConfig | undefined {
  return BY_URL_PATH.get(urlPath);
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
