import { ULong } from '../ulong.js';

/**
 * The DropTable field inventory — plan task 4.2 (story p4-02), the **data** half of the
 * editor: which fields exist, what each one is, the default docs/spec-domain-reference.md
 * L77-91 prints for it, and which keys the real corpus does *not* carry in every file.
 *
 * It lives in `shared/` because the client form and the server's validation both need the
 * same key list (D62(f)'s host-agnostic rule, the same reason `RequirementTreeEditor` is
 * shared), and because a second field table in the form would be the copy-paste divergence
 * §4's risk table names.
 *
 * ## The measured corpus, 2026-09-26 — the numbers this table encodes
 *
 * All **317** real `DropTables/*.json` files of `/home/jason/Documents/git-projects/spiraldb`
 * were read for the model (`tests/unit/drop-table-model.test.ts` re-runs the same sweep
 * whenever the checkout is on disk):
 *
 * | fact | measured |
 * |---|---|
 * | files | 317 |
 * | distinct, non-empty `Name` values | 317 (317/317 unique — the duplicate rule is fixture-only, see `validation.ts`) |
 * | files carrying `CreatedAt`+`ModifiedAt`+`CreatedBy`+`ModifiedBy` | **316** — `droptables_wc-unicorn-side-001.json` genuinely lacks all four |
 * | files carrying `GrantsPotionSlot` | **35** |
 * | files carrying every other documented top-level key | 317 (no schema drift: the 16 top-level keys the corpus uses are exactly the 16 the spec table lists) |
 * | item rows across the corpus | 72 |
 * | item rows carrying `ItemId`/`ItemName`/`Notes`/`Requirements` | 72 each |
 * | item rows whose `Requirements` is non-null (7 carry an explicit `null`) | 65 |
 * | requirement leaves under those `m_requirements` wrappers (1 each) | 65 |
 * | `ItemId` values that are JSON **strings** | 72 of 72 |
 *
 * ## Presence is a fact, not a default (D57)
 *
 * `presenceSensitive` marks the five keys the corpus does not carry everywhere —
 * `GrantsPotionSlot` (282 files without it) and the audit quartet (1 file without it). The
 * editor renders a control for each (the spec draws one), but a control the user never
 * touched must produce **no edit**: an absent key stays absent, because the loaded document
 * is the write payload (D5/D57) and nothing here injects `defaultValue` into a document.
 * `defaultValue` is what a **brand-new** row or entry starts from — never a repair applied
 * to existing data. The failure this prevents is named in the story brief: a save that
 * silently adds `GrantsPotionSlot` to 282 files (or the audit quartet to one) would be a
 * 283-file diff for a one-field edit.
 */

/** The four form sections of docs/spec-ui-design.md L471-477, in the order they render. */
export type DropTableSection = 'basic' | 'rewards' | 'items' | 'audit';

/** How a top-level field renders. `slider` is the spec's 0-1 control (L473). */
export type DropTableFieldKind = 'text' | 'textarea' | 'slider' | 'number' | 'checkbox';

/** A default value as the spec prints it (`""`, `1.0`, `100`, `false`, `[]`, `null`). */
export type DropTableDefault = string | number | boolean | null | readonly never[];

/** One top-level field's spec (docs/spec-domain-reference.md L77-91). */
export interface DropTableFieldSpec {
  /** The document key, verbatim. */
  readonly key: string;
  /** The control's visible label. */
  readonly label: string;
  readonly section: DropTableSection;
  readonly kind: DropTableFieldKind;
  /** The spec's documented default (L77-91) — what a **new** entry starts from. */
  readonly defaultValue: DropTableDefault;
  /** How many of the 317 measured corpus files carry the key. */
  readonly corpusPresence: number;
  /**
   * `true` when `corpusPresence < 317`: a control for this key must produce **no edit**
   * unless the user changed it, so an absent key stays absent (D57).
   */
  readonly presenceSensitive: boolean;
  /** Inclusive bounds for `slider`/`number` (the spec's own range where it prints one). */
  readonly min?: number;
  readonly max?: number;
  /** Slider/number increment. Doubles step by 0.05; integers by 1. */
  readonly step?: number;
  /** `true` for the audit quartet, which this story renders but never writes (D69(b)). */
  readonly readOnly?: boolean;
  /** One line of help under the control (used where the spec's meaning is not obvious). */
  readonly help?: string;
}

/** How many files the measurements cover. One home for the denominator. */
export const DROP_TABLE_CORPUS_FILES = 317;

/**
 * The measured corpus facts, as data. The unit test asserts every number against a live
 * sweep, so a change that starts padding keys — or a corpus that moves underneath the
 * editor — fails loudly instead of silently widening a diff.
 */
export const DROP_TABLE_CORPUS = {
  /** `DropTables/*.json` files measured. */
  files: DROP_TABLE_CORPUS_FILES,
  /** Distinct, non-empty `Name` values (317/317 unique). */
  distinctNames: 317,
  /** Files carrying all four audit keys. */
  auditPresent: 316,
  /** The one file that carries none of them (recorded so the test names it). */
  auditMissingFile: 'droptables_wc-unicorn-side-001.json',
  /** Files carrying `GrantsPotionSlot`. */
  grantsPotionSlotPresent: 35,
  /** Item rows across the corpus. */
  itemRows: 72,
  /** Item rows whose `Requirements` is a non-null wrapper (the other 7 are explicit `null`). */
  itemRowsWithRequirements: 65,
  /** `Items[*].Requirements.m_requirements` leaves in total — one per non-null wrapper. */
  requirementLeaves: 65,
  /** Distinct `ItemId` values (72 rows, 72 distinct). */
  distinctItemIds: 72,
  /** Distinct `ItemId` values whose numeric form resolves in the synced `items` table. */
  resolvableItemIds: 64,
} as const;

/** The four keys of the embedded audit block (docs/spec-data-model.md L189-191). */
export const DROP_TABLE_AUDIT_KEYS = [
  'CreatedAt',
  'ModifiedAt',
  'CreatedBy',
  'ModifiedBy',
] as const;

/**
 * The top-level field inventory, in the spec table's order (L77-91) with the two sections of
 * L471-477 applied: Basic carries `Name`/`Description`/`RollChance`/`Weight`/`NoneChance`
 * and — per the plan's §4.2 line — `PityCounter`; Rewards carries the gold range,
 * `ExperienceAmount`, `TrainingPoints` and `GrantsPotionSlot`; Items is the repeater
 * ({@link DROP_TABLE_ITEM_FIELDS}); Audit is the read-only quartet.
 */
export const DROP_TABLE_FIELDS: readonly DropTableFieldSpec[] = [
  {
    key: 'Name',
    label: 'Name',
    section: 'basic',
    kind: 'text',
    defaultValue: '',
    corpusPresence: 317,
    presenceSensitive: false,
    readOnly: false,
    help: 'Unique name; referenced by NpcDropTable and ResDropTable. It is also this file’s key.',
  },
  {
    key: 'Description',
    label: 'Description',
    section: 'basic',
    kind: 'textarea',
    defaultValue: '',
    corpusPresence: 317,
    presenceSensitive: false,
  },
  {
    key: 'RollChance',
    label: 'Roll chance',
    section: 'basic',
    kind: 'slider',
    defaultValue: 1.0,
    corpusPresence: 317,
    presenceSensitive: false,
    min: 0,
    max: 1,
    step: 0.05,
    help: 'Probability (0.0–1.0) that this table is rolled.',
  },
  {
    key: 'Weight',
    label: 'Weight',
    section: 'basic',
    kind: 'number',
    defaultValue: 100,
    corpusPresence: 317,
    presenceSensitive: false,
    step: 1,
    help: 'Relative weight when multiple tables compete.',
  },
  {
    key: 'NoneChance',
    label: 'None chance',
    section: 'basic',
    kind: 'slider',
    defaultValue: 0.0,
    corpusPresence: 317,
    presenceSensitive: false,
    min: 0,
    max: 1,
    step: 0.05,
    help: 'Probability that the roll produces nothing.',
  },
  {
    key: 'PityCounter',
    label: 'Pity counter',
    section: 'basic',
    kind: 'number',
    defaultValue: 0.0,
    corpusPresence: 317,
    presenceSensitive: false,
    step: 0.05,
    help: 'Pity system counter.',
  },
  {
    key: 'MinGold',
    label: 'Minimum gold',
    section: 'rewards',
    kind: 'number',
    defaultValue: 0,
    corpusPresence: 317,
    presenceSensitive: false,
    step: 1,
  },
  {
    key: 'MaxGold',
    label: 'Maximum gold',
    section: 'rewards',
    kind: 'number',
    defaultValue: 0,
    corpusPresence: 317,
    presenceSensitive: false,
    step: 1,
  },
  {
    key: 'ExperienceAmount',
    label: 'Experience',
    section: 'rewards',
    kind: 'number',
    defaultValue: 0,
    corpusPresence: 317,
    presenceSensitive: false,
    step: 1,
  },
  {
    key: 'TrainingPoints',
    label: 'Training points',
    section: 'rewards',
    kind: 'number',
    defaultValue: 0,
    corpusPresence: 317,
    presenceSensitive: false,
    step: 1,
  },
  {
    key: 'GrantsPotionSlot',
    label: 'Grants potion slot',
    section: 'rewards',
    kind: 'checkbox',
    defaultValue: false,
    // 35 of 317 — the single most presence-sensitive key in the editor.
    corpusPresence: 35,
    presenceSensitive: true,
    help: 'Present in only 35 of the 317 corpus files; leave it alone and it stays absent.',
  },
  {
    key: 'Items',
    label: 'Items',
    section: 'items',
    kind: 'textarea',
    defaultValue: [],
    corpusPresence: 317,
    presenceSensitive: false,
    help: 'Repeater of drop rows — see DROP_TABLE_ITEM_FIELDS.',
  },
  {
    key: 'CreatedAt',
    label: 'Created at',
    section: 'audit',
    kind: 'text',
    defaultValue: null,
    corpusPresence: 316,
    presenceSensitive: true,
    readOnly: true,
    help: 'Embedded audit field. This editor renders it and never writes it (D69(b)).',
  },
  {
    key: 'ModifiedAt',
    label: 'Modified at',
    section: 'audit',
    kind: 'text',
    defaultValue: null,
    corpusPresence: 316,
    presenceSensitive: true,
    readOnly: true,
  },
  {
    key: 'CreatedBy',
    label: 'Created by',
    section: 'audit',
    kind: 'text',
    defaultValue: null,
    corpusPresence: 316,
    presenceSensitive: true,
    readOnly: true,
  },
  {
    key: 'ModifiedBy',
    label: 'Modified by',
    section: 'audit',
    kind: 'text',
    defaultValue: null,
    corpusPresence: 316,
    presenceSensitive: true,
    readOnly: true,
  },
];

/** How an item row's field renders: the friendly-name dropdown, text, or the inline tree. */
export type DropTableItemFieldKind = 'item-id' | 'text' | 'requirements';

/** One `DropItem` field's spec (docs/spec-domain-reference.md L93-98). */
export interface DropTableItemFieldSpec {
  readonly key: string;
  readonly label: string;
  readonly kind: DropTableItemFieldKind;
  readonly defaultValue: DropTableDefault;
  /** How many of the 72 measured item rows carry the key (72 for all four). */
  readonly corpusPresence: number;
  /** `true` for `ItemName`, which the dropdown auto-fills (P4 AC#7). */
  readonly readOnly?: boolean;
  readonly help?: string;
}

/**
 * The item-row inventory, in the corpus's own key order (`ItemId, ItemName, Notes,
 * Requirements` — 72 of 72 rows). `Requirements` is the untyped wrapper
 * `{m_requirements, m_applyNOT, m_operator}` with no `$type`, which is exactly the shape
 * `RequirementTreeEditor` already round-trips byte-exactly for the 65 real item trees
 * (D62(f)); the form mounts that component inline per row and writes no second tree.
 */
export const DROP_TABLE_ITEM_FIELDS: readonly DropTableItemFieldSpec[] = [
  {
    key: 'ItemId',
    label: 'Item',
    kind: 'item-id',
    defaultValue: '',
    corpusPresence: 72,
    help: 'Numeric item template ID stored as a string; picked through the items dropdown.',
  },
  {
    key: 'ItemName',
    label: 'Item name',
    kind: 'text',
    defaultValue: '',
    corpusPresence: 72,
    readOnly: true,
    help: 'Filled from the synced items table when the dropdown resolves a name.',
  },
  {
    key: 'Notes',
    label: 'Notes',
    kind: 'text',
    defaultValue: '',
    corpusPresence: 72,
  },
  {
    key: 'Requirements',
    label: 'Requirements',
    kind: 'requirements',
    defaultValue: null,
    corpusPresence: 72,
    help: 'The shared inline requirement tree editor edits this slot.',
  },
];

/**
 * A brand-new item row, in the corpus's own key order (`ItemId, ItemName, Notes,
 * Requirements`) with each field at its spec default. Built **from** the inventory above, so
 * "add a row" can never invent a second key list; used only by the Add button, never by a
 * load (D57: an existing row is never rebuilt from this).
 */
export function newDropItemRow(): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const field of DROP_TABLE_ITEM_FIELDS) {
    row[field.key] = field.defaultValue;
  }
  return row;
}

const FIELDS_BY_KEY = new Map<string, DropTableFieldSpec>(
  DROP_TABLE_FIELDS.map((field) => [field.key, field]),
);

/** The spec for a top-level key, or `undefined` when the key is unknown. */
export function dropTableFieldSpec(key: string): DropTableFieldSpec | undefined {
  return FIELDS_BY_KEY.get(key);
}

/** The fields of one section, in inventory order. */
export function dropTableFieldsInSection(section: DropTableSection): DropTableFieldSpec[] {
  return DROP_TABLE_FIELDS.filter((field) => field.section === section);
}

/**
 * `true` when a document carries the key at all — the presence test the form uses to render
 * "absent" honestly and the one a save must not defeat (D57). `undefined` is absent;
 * an explicit `null` is **present** and survives (D57's "explicit nulls survive").
 */
export function dropTableHasField(document: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(document, key);
}

/* ------------------------------------------------------------------- the item id */

/**
 * The canonical text form of an `ItemId`, or `undefined` when the value cannot name an item.
 *
 * **This is the measured string↔number trap.** All **72** corpus `ItemId` values are JSON
 * **strings** (`"1001"`), while the synced `items` table stores the same ids as **integer**
 * `gid`s. Compared as raw values (`"1001" === 1001`), **0 of 72** resolve; compared
 * canonically, **64 of 72** do. The eight that genuinely miss — `1000` (`droptables_test.json`),
 * `1730822561`, `927448295`, `975200773`, `534093744`, `533943727`, `1627273980`, `878360657`
 * — are ids the names table does not carry, and an unresolved id is **kept verbatim**: no
 * `ItemName` is invented for it (D60(c)/D63(c)'s miss-safe rule).
 *
 * The conversion is `shared/ulong.ts`'s `ULong.toKey` — the same one the ulong-keyed families
 * use for `TemplateID` (D69) — rather than a second ad-hoc `String(x)` at each call site:
 * it accepts a finite non-negative integer or a digits-only string, canonicalises through
 * `BigInt` (so `"01001"` → `"1001"`), and rejects `""`, `"-1"`, `"1.5"`, `" 1 "` and
 * non-scalars. A caller with `undefined` back must not look the id up and must not rewrite it.
 */
export function canonicalItemId(value: unknown): string | undefined {
  return ULong.toKey(value);
}

/**
 * The lookup value for `GET /api/names/items/:id`, or `undefined` when the id cannot be
 * looked up at all.
 *
 * The names API validates an `items` id as an integer, so a **non-numeric** items id must
 * never be sent: it is a 404 either way (D36's "a non-numeric items id must 404, never
 * 500"), but skipping the request keeps the raw value on screen and produces no error state.
 * Today all 72 corpus ids are digits, so this is the guard for the ones that are not.
 */
export function itemIdLookupValue(value: unknown): string | undefined {
  return canonicalItemId(value);
}

/* ------------------------------------------------------------ the duplicate rule's input */

/**
 * The names a document must **not** collide with: every drop-table name of the corpus minus
 * the one the entry being saved already has.
 *
 * This is the whole difficulty of the spec's "unique across all drop tables" (L536-540), and
 * it is here — in `shared/`, one home for both halves — rather than in the form (the story's
 * named failure mode is "a client-only duplicate-Name check") or in the server alone.
 *
 * Why an exclusion is needed at all: a save of the file that already carries name `X` has to
 * pass with `X` still in the corpus, or every unmodified save would 400 against itself. The
 * caller supplies `ownCurrentName` — the key of the entry being edited on disk, i.e. the
 * route key the user opened — so that exactly one occurrence is forgiven, and only for the
 * entry actually being saved:
 *
 * | case | corpus | own | document `Name` | duplicate? |
 * |---|---|---|---|---|
 * | edit, name untouched | `X` | `X` | `X` | no |
 * | rename onto another table | `X`,`Y` | `X` | `Y` | **yes** |
 * | edit, name unchanged, corpus already had a duplicate | `X`,`X` | `X` | `X` | **yes** |
 * | create with an existing name | `X` | `null` | `X` | **yes** |
 * | create with a new name | `X` | `null` | `Z` | no |
 *
 * A `null`/empty `ownCurrentName` is the create case (nothing is forgiven).
 */
export function otherDropTableNames(
  corpusNames: Iterable<string>,
  ownCurrentName: string | null,
): Set<string> {
  const others = new Set<string>();
  let forgiven = ownCurrentName === null || ownCurrentName === '';
  for (const name of corpusNames) {
    if (!forgiven && name === ownCurrentName) {
      // The entry being saved: exactly one occurrence is its own name, not a collision.
      forgiven = true;
      continue;
    }
    others.add(name);
  }
  return others;
}
