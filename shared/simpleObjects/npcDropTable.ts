import type { SimpleFieldSpec } from './model.js';

/**
 * `NpcDropTable` — plan task 4.6 (story p4-06, AC1): docs/spec-domain-reference.md L166-181.
 *
 * ```json
 * { "TemplateID": 12345, "DropTableNames": ["WC-UNICORN-MAIN-007", "WC-UNICORN-BONUS-001"] }
 * ```
 *
 * ## The measured corpus, 2026-09-27 — this family has **none**
 *
 * `NpcDropTable/` **does not exist** in `/home/jason/Documents/git-projects/spiraldb` (verified
 * this round: the directory is absent, `entry_status` holds **0** rows for `npc_drop_table`, and
 * `GET /api/npc-drop-tables` answers an empty list with `missing_directory: true`). So unlike
 * its three sibling families, **not one number below comes from a corpus file**:
 *
 * | fact | measured |
 * |---|---|
 * | `NpcDropTable/*.json` files in the fork | **0** (the directory is absent) |
 * | `entry_status` rows for `npc_drop_table` | **0** |
 * | top-level keys | the **schema's** two: `TemplateID`, `DropTableNames` |
 * | `drop_tables` rows (the names source) | **317**, 317 distinct, 0 blank |
 * | `DropTables/*.json` files / distinct `Name` values | **317 / 317** |
 * | `drop_tables.name` values absent from the DropTables corpus (exact and case-insensitive) | **0** |
 * | `drop_tables` spec (`server/src/services/names.ts`) | `idColumn: 'name'`, `labelColumn: 'name'`, `idKind: 'text'` |
 *
 * The 317↔317 bijection is the fact the editor's contract rests on: **every name a document may
 * reference is in the synced `drop_tables` table**, so the searchable multi-select can reach the
 * whole vocabulary. It is also why the type is text: the value stored is the DropTable's `Name`,
 * never an id (contrast the numeric lists of tasks 4.3-4.5).
 *
 * ## What the editor must not get wrong
 *
 * - **Exactly two keys.** The document has `TemplateID` (a JSON number, the file's key) and
 *   `DropTableNames` (an array of strings) and nothing else; the loaded document is the write
 *   payload (D5/D57), so a save adds no third key and no audit quartet (`OBJECT_TYPES` records
 *   `audit: 'none'` for this family).
 * - **The key is a ulong, the list is text.** `TemplateID` goes through the one conversion
 *   (`numberIdFromRaw` → `ULong`); a name is stored verbatim (`textIdFromRaw`), because
 *   normalising it would be the editor inventing a name.
 * - **Removal is index-addressed**, like every list in this vocabulary: `DropTableNames` may
 *   repeat a name, and a value-based removal could not even express "the third chip".
 * - **The directory bootstrap is the server's, not the client's.** The save pipeline writes
 *   through `writeSpiraldbJson`, which `mkdirSync`s the parent recursively
 *   (`server/src/services/spiraldbFiles.ts`); the client may not create directories, and this
 *   module deliberately has no "create the directory" helper — AC1's clause is proven against a
 *   real save (live in the D17 clone, and in-process in
 *   `tests/unit/npc-drop-table-model.test.ts`).
 *
 * ## The one name the synced table does **not** hold
 *
 * The spec's own example is `["WC-UNICORN-MAIN-007", "WC-UNICORN-BONUS-001"]`, and the second of
 * those has **no** `DropTables/*.json` file and **no** `drop_tables` row (measured this round:
 * 0 of the 317 names contain `BONUS`). So a document may reference a name the names table cannot
 * render, and the multi-select's raw-name box — the text side of D71(i)'s single
 * `RawIdAddControl` — is the way such a value is typed back after a removal. A chip for it shows
 * the name itself and invents nothing, exactly as a numeric chip for an unresolved id does.
 */

/** The measured facts above, as data — one home for every number. */
export const NPC_DROP_TABLE_CORPUS = {
  /** `NpcDropTable/*.json` files in the fork: none. The directory does not exist. */
  files: 0,
  /** `entry_status` rows for `npc_drop_table`: none. */
  statusRows: 0,
  /**
   * The exact top-level key set — the **schema's** two keys, in the schema's order, since no
   * corpus file can be read to confirm an order (docs/spec-domain-reference.md L168-171).
   */
  topLevelKeys: ['TemplateID', 'DropTableNames'],
  /** Rows in the synced `drop_tables` table — the names the multi-select searches. */
  dropTableNames: 317,
  /** Distinct `drop_tables.name` values (the column is `drop_tables`' primary key). */
  distinctDropTableNames: 317,
  /** `drop_tables.name` values that are NULL or blank. */
  blankDropTableNames: 0,
  /** `DropTables/*.json` files — the corpus the names are synced from. */
  dropTableFiles: 317,
  /** Distinct `Name` values across those files. */
  distinctDropTableKeys: 317,
  /**
   * Names of the DropTables corpus with no `drop_tables` row (exact match), and the reverse.
   * Both are **0**: the table and the corpus are the same 317 names.
   */
  namesMissingFromTable: 0,
  tableNamesMissingFromCorpus: 0,
  /**
   * The shortest and longest synced name, so a test can pin that the table is names and not ids
   * (`DS-ACAD-C01-001` … 25 characters).
   */
  shortestNameLength: 4,
  longestNameLength: 25,
  /** Names containing `BONUS` anywhere — 0, which is why the spec's second example is unreachable. */
  namesContainingBonus: 0,
} as const;

/** The document key holding the list — the one place the form and the tests read it from. */
export const NPC_DROP_TABLE_LIST_KEY = 'DropTableNames';

/** The document key holding the family's key field. */
export const NPC_DROP_TABLE_KEY_FIELD = 'TemplateID';

/**
 * The two fields, in the schema's order. The list's help line states the measured bijection,
 * because that is what tells a user the search reaches every name their file may carry — and it
 * names the one spec example the table cannot hold.
 */
export const NPC_DROP_TABLE_FIELDS: readonly SimpleFieldSpec[] = [
  {
    key: NPC_DROP_TABLE_KEY_FIELD,
    label: 'NPC',
    kind: 'npc-select',
    namesType: 'npcs',
    required: true,
    corpusPresence: 0,
    help: 'The key of this file: the NPC actor template id. NpcDropTable/ has no files yet — the first save creates it.',
  },
  {
    key: NPC_DROP_TABLE_LIST_KEY,
    label: 'Drop tables',
    kind: 'drop-table-multi-select',
    namesType: 'drop_tables',
    required: true,
    corpusPresence: 0,
    help: 'DropTable names to roll, sourced from the synced drop_tables table (317 names, the whole DropTables corpus). A name the table does not hold — the spec\u2019s own WC-UNICORN-BONUS-001 is one — can still be typed in and is stored verbatim.',
  },
];
