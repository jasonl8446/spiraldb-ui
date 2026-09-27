import type { DocEdit, DocPath } from '../document.js';
import type { SimpleFieldSpec } from './model.js';

/**
 * `TreasureCardInventory` — plan task 4.7 (story p4-05, AC1): docs/spec-domain-reference.md
 * L183-208, and the one warn-not-block rule the phase's AC#11 names (the general validation
 * section, L542-546).
 *
 * ```json
 * {
 *   "TemplateID": 38214,
 *   "TreasureCards": [
 *     { "SpellName": "Fire Shield TC", "Price": 100 },
 *     { "SpellName": "Fire Cat TC", "Price": 150 }
 *   ]
 * }
 * ```
 *
 * ## The measured corpus, 2026-09-27 — **one** file, and every number below comes from it
 *
 * `TreasureCardInventory/` holds exactly one file (`NpcTreasureCards_2019-A.json`, the legacy
 * name — D19's index is what resolves it, never a derived filename):
 *
 * | fact | measured |
 * |---|---|
 * | `TreasureCardInventory/*.json` files | **1** (`NpcTreasureCards_2019-A.json`) |
 * | `entry_status` rows for `treasure_card_inventory` | **1** |
 * | top-level keys | the schema's **two**: `TemplateID`, `TreasureCards` (one order only) |
 * | the file's `TemplateID` | **38214** (a JSON number) |
 * | `TreasureCards` entries | **71** |
 * | entries whose keys are exactly `SpellName` + `Price` | **71 / 71** (one order only) |
 * | entries whose two values are a string and a JSON number | **71 / 71** |
 * | `Price` values present | **{100, 150, 200, 250}** (36 / 13 / 13 / 9) |
 * | entries with `Price === 0` | **0** — see "the `Price 0` hint is fixture-only" |
 * | distinct `SpellName` values | **71** (no duplicates in this file) |
 * | `SpellName` values ending in `" TC"` | **71 / 71** |
 * | `SpellName` values matching `spells.name` **literally** | **0 / 71** |
 * | the same 71 with the trailing `" TC"` stripped | **71 / 71** |
 * | distinct top-level `TemplateID`s missing from `npcs` | 0 (38214 resolves) |
 * | `spells` rows / distinct names / blank names | **18,173 / 4,104 / 0** |
 * | `spells.name` values containing the uppercase substring `TC` | **0** |
 * | `spells.name` values ending in `" TC"` | **0** |
 * | `spells` **rows** containing `tc` case-insensitively | **89** (the briefed number; **17** distinct names) |
 *
 * ## THE MATCH FINDING, and the decision it forces
 *
 * Measured twice (this story's sweep and the lead's own): the file's `SpellName` values are
 * treasure-card **variant** names — `"Fire Shield TC"`, `"Fire Cat TC"`, `"Meteor Strike TC"`;
 * all 71 follow the `" TC"` convention — while `spells.name` holds base spell names. A literal
 * match finds **0 of 71**; stripping the suffix finds **71 of 71**. So there is a real
 * hypothesis the corpus supports: *the document's name is the base spell name plus this
 * family's `" TC"` suffix*.
 *
 * **The decision (lead, per the standing rule that the detailed spec wins): match LITERALLY,
 * as the spec words it** — docs/spec-domain-reference.md L200 says `SpellName` "must match
 * `SpellTemplate.m_name`", and neither a suffix strip nor a fuzzy match is in the spec.
 * Nothing here strips `" TC"`, nothing folds case, nothing consults a second table, and the
 * synced data is never written. **The consequence is honest and non-blocking**: on the one
 * real file the editor shows **71 warnings** and Save still succeeds — which is exactly what
 * AC#11 asks for. The suffix hypothesis is recorded as data ({@link
 * TREASURE_CARD_INVENTORY_CORPUS}.suffixStrippedMatches) and asserted as a *finding* in the
 * unit sweep, **never as behaviour**: if the owner decides the suffix is part of the contract,
 * the change is one line in {@link validateTreasureCardInventory} plus these constants — a
 * decision for the owner, not a silent behaviour of this editor. (Same pattern as D65(a)/D29's
 * "record, do not normalise".)
 *
 * ## The warn-not-block mechanics, and which side carries which claim
 *
 * docs/spec-domain-reference.md L542-546 is one section carrying two sentences: *"Item/Spell/
 * NPC references should warn (not block) if ID not found in friendly names DB"* and *"Save
 * button disabled while validation **errors** exist."* — *errors*, not warnings. The finding
 * below is therefore `severity: 'warning'`, `blocking` is empty by construction and
 * {@link TreasureCardValidationResult.blocked} is the **literal type `false`** (so a future
 * story that wants a blocking rule has to change this type, not sneak one in).
 *
 * Who claims what:
 *
 * - **The client carries the claim that a user sees.** The page runs this engine with the
 *   synced `spells` names injected and renders one inline warning per offending row through
 *   the shared `FieldValidation` plumbing; the Save button's gate is
 *   `fieldHasError(messages)`, which filters `severity === 'error'` — so a warning cannot
 *   disable it. That is AC#11's two arms, and both are asserted by the story's tier-1 spec.
 * - **The shared engine carries the rule**, pure and free of React/SQLite/`server/`, so
 *   either half of the app can run the same implementation (the p4-02 precedent). Its only
 *   reader today is the client, which is where the spec's L547 talks about a Save button.
 * - **The server carries no claim about this family, and rejects nothing for a warning.**
 *   This family has **no** rule that blocks, so there is nothing for a POST-path validator to
 *   enforce: `shared/objectTypes.ts`'s `treasurecardinventory` row is mounted without a
 *   `validate` (the seam `server/src/routes/objects.ts` exposes, taken on by DropTable alone),
 *   and a direct `POST /api/treasure-card-inventories` with 71 non-matching `SpellName`s is a
 *   normal save — proven in-process by `tests/unit/treasure-card-inventory-model.test.ts`
 *   against a throwaway git repo, not asserted. A server-side validator that could only ever
 *   return would be copy without a surface; the AC's own arm is *Save succeeds*.
 *
 * ## The `Price 0` hint is DATA, not a rule — and the corpus never contains a 0
 *
 * The schema says `Price`: `0` = use spell template's `m_baseCost` (L200). All 71 real prices
 * are in {100, 150, 200, 250}, so **no corpus file exercises the hint**: it is fixture-only,
 * and this module says so rather than pretending a real example exists.
 * {@link PRICE_ZERO_HINT} is the sentence, {@link priceShowsBaseCostHint} is the predicate the
 * row renders it under — neither is a finding. Nothing here invents a `Price` rule: the spec
 * prints no bound for `Price` (not even a lower one), so a negative or fractional price is
 * **not** flagged, and the only rule this family has is the name match.
 *
 * ## The entry shape is unanimous, so an emptied box never deletes a key
 *
 * `{SpellName, Price}` is 2-of-2 keys in 71 of 71 entries, and both keys are required by the
 * schema — so the entry-level editors follow D71(c)'s shape rule rather than the top-level
 * scalar rule (D59(c)): an emptied `Price` box writes `0` (a value the schema gives a meaning,
 * and the one the hint labels) and an emptied `SpellName` box writes `''` (a present value
 * that matches no name, which the warn rule then reports). Deleting either key would write a
 * one-key entry the schema forbids, which is the failure this rule exists to prevent.
 */

/** The measured facts above, as data — one home for every number. */
export const TREASURE_CARD_INVENTORY_CORPUS = {
  /** `TreasureCardInventory/*.json` files in the fork: one. */
  files: 1,
  /** `entry_status` rows for `treasure_card_inventory`: one. */
  statusRows: 1,
  /** The one file's legacy name (D19 resolves it by content, never by this string). */
  legacyFileName: 'NpcTreasureCards_2019-A.json',
  /** The exact top-level key set, in the file's own order. */
  topLevelKeys: ['TemplateID', 'TreasureCards'],
  /** The one file's `TemplateID` — a JSON number. */
  templateId: 38214,
  /** `TreasureCards` entries in the one file. */
  entries: 71,
  /** Entries whose keys are exactly `SpellName` + `Price`, in that order. */
  entriesWithBothKeys: 71,
  /** Distinct `SpellName` values (71 — this file repeats none). */
  distinctSpellNames: 71,
  /** `SpellName` values that are absent, `null` or not a string. */
  nonStringSpellNames: 0,
  /** The four `Price` values present, ascending. */
  prices: [100, 150, 200, 250],
  /** Distinct `Price` values: four. */
  distinctPrices: 4,
  /** The most frequent `Price` (36 of 71) — the value a newly added row starts from. */
  commonPrice: 100,
  /** The lowest / highest measured `Price`. */
  minPrice: 100,
  maxPrice: 250,
  /** Entries with `Price === 0` — **0**, which is why the hint is fixture-only. */
  entriesWithPriceZero: 0,
  /** The suffix every one of the 71 names carries. */
  suffix: ' TC',
  /** Entries whose `SpellName` ends in {@link TREASURE_CARD_NAME_SUFFIX}: 71. */
  entriesWithSuffix: 71,
  /** Entries whose `SpellName` matches `spells.name` literally: **0 of 71**. */
  literalMatches: 0,
  /** Entries that match once the trailing suffix is stripped: **71 of 71** (the hypothesis). */
  suffixStrippedMatches: 71,
  /** Entries matching with case folded: 0 — so case never decided this finding. */
  caseInsensitiveLiteralMatches: 0,
  /** `spells` rows — the names source. */
  spellRows: 18173,
  /** Distinct `spells.name` values (the column is not unique). */
  distinctSpellRows: 4104,
  /** `spells.name` values that are NULL or blank. */
  blankSpellNames: 0,
  /** `spells.name` values containing the uppercase substring `TC`. */
  spellNamesContainingTC: 0,
  /** `spells.name` values ending in the suffix — 0, so no base name carries it. */
  spellNamesEndingWithSuffix: 0,
  /**
   * `spells` **rows** containing `tc` case-insensitively: 89 (the lead-measured number this
   * story was briefed with). Row-based, because the brief's count was.
   */
  spellRowsContainingTcCaseInsensitive: 89,
  /**
   * **Distinct** `spells.name` values containing `tc` case-insensitively: 17. The two numbers
   * differ because `spells` has 18,173 rows against 4,104 distinct names; both are recorded so
   * neither can be quoted for the other. The class is incidental — `Cat Scratch`, `Hatch`,
   * `Catch of the Day`, `Switcheroo` — and contains no name-with-suffix.
   */
  distinctSpellNamesContainingTcCaseInsensitive: 17,
} as const;

/** The document key holding the repeater. */
export const TREASURE_CARD_INVENTORY_LIST_KEY = 'TreasureCards';

/** The document key holding the family's key field. */
export const TREASURE_CARD_INVENTORY_KEY_FIELD = 'TemplateID';

/** The entry's two keys, in the file's single measured order (71/71). */
export const TREASURE_CARD_ENTRY_KEYS = ['SpellName', 'Price'] as const;

/** The suffix all 71 measured names carry — recorded, **never** stripped (see the header). */
export const TREASURE_CARD_NAME_SUFFIX = ' TC';

/**
 * The `Price == 0` hint (spec L200), verbatim in meaning: the price is the spell template's
 * own `m_baseCost`. Data, not a finding — nothing blocks or warns on a price.
 */
export const PRICE_ZERO_HINT =
  'Price 0 uses the spell template’s m_baseCost — the card costs whatever the spell’s own base cost is.';

/** The `Price` a newly added row starts from: the corpus's most frequent price (36 of 71). */
export const NEW_TREASURE_CARD_PRICE = 100;

/**
 * The document's two fields, in the file's order. The list's help line states the measured
 * match reality, because that is what tells a user why a warning appears on real content.
 */
export const TREASURE_CARD_INVENTORY_FIELDS: readonly SimpleFieldSpec[] = [
  {
    key: TREASURE_CARD_INVENTORY_KEY_FIELD,
    label: 'NPC',
    kind: 'npc-select',
    namesType: 'npcs',
    required: true,
    corpusPresence: 1,
    help: 'The key of this file: the NPC actor template id. The one corpus file carries 38214.',
  },
  {
    key: TREASURE_CARD_INVENTORY_LIST_KEY,
    label: 'Treasure cards',
    kind: 'treasure-card-list',
    required: true,
    corpusPresence: 1,
    help: 'Cards this NPC sells, each a spell name and a gold price. A name no synced spell matches is warned about, never blocked — the one corpus file’s 71 “ TC” variant names all warn under the spec’s literal match.',
  },
];

/* ------------------------------------------------------------------ the reader */

/** One row of the repeater: the entry object and the index every edit path needs. */
export interface TreasureCardView {
  readonly index: number;
  readonly entry: Record<string, unknown>;
}

/**
 * The `TreasureCards` array as renderable rows, in document order.
 *
 * `[]` for a key that is absent, `null` or not an array — the "no list here" shapes a form
 * renders as its empty state, which is also what an **empty array** renders. An element that
 * is not a plain object is skipped for the same measured-impossible reason
 * `readSpellEntries` documents: 71 of 71 entries are objects, and a row cannot be built from
 * anything else. Each row's index is its **position in the document array**, so an edit
 * addresses the element the user sees — a repeater can repeat a name, and this file's 71
 * names are distinct only by measurement, not by contract.
 */
export function readTreasureCards(document: Record<string, unknown>): TreasureCardView[] {
  const raw = document[TREASURE_CARD_INVENTORY_LIST_KEY];
  if (!Array.isArray(raw)) {
    return [];
  }
  const rows: TreasureCardView[] = [];
  raw.forEach((entry, index) => {
    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
      rows.push({ index, entry: entry as Record<string, unknown> });
    }
  });
  return rows;
}

/* ------------------------------------------------------------- the edit builders */

/** The repeater array's path: `['TreasureCards']`. */
export function treasureCardListPath(): DocPath {
  return [TREASURE_CARD_INVENTORY_LIST_KEY];
}

/** One entry field's path: `['TreasureCards', 2, 'Price']`. */
export function treasureCardFieldPath(index: number, key: string): DocPath {
  return [TREASURE_CARD_INVENTORY_LIST_KEY, index, key];
}

/** A new entry in the file's exact key order (71/71). */
export function newTreasureCardEntry(
  spellName: string,
  price: number = NEW_TREASURE_CARD_PRICE,
): Record<string, unknown> {
  return { SpellName: spellName, Price: price };
}

/**
 * The edit that appends `entry`.
 *
 * `TreasureCards` is present in the one corpus file, but the edit is still keyed on presence:
 * an `insert` into a key that does not exist would throw (`shared/document.ts` never invents
 * structure), so a document without the key takes one `set` of a one-element array — the same
 * rule p3-05's `m_goalLogic` and p4-03's `Spells` follow.
 */
export function addTreasureCardEdit(
  hasCards: boolean,
  currentLength: number,
  entry: Record<string, unknown>,
): DocEdit {
  if (!hasCards) {
    return { op: 'set', path: treasureCardListPath(), value: [entry] };
  }
  return { op: 'insert', path: treasureCardListPath(), index: currentLength, value: entry };
}

/**
 * The edit that removes the entry at `index`. The path is the **element**, not one of its
 * fields: `deleteAtPath` on an array index splices, while deleting `['TreasureCards', i,
 * 'SpellName']` would leave a one-key entry behind.
 */
export function removeTreasureCardEdit(index: number): DocEdit {
  return { op: 'delete', path: [TREASURE_CARD_INVENTORY_LIST_KEY, index] };
}

/**
 * The edit a row's `SpellName` box produces: the typed string, **verbatim** — no `trim`, no
 * case folding, no suffix handling (D57's "validate, never normalise").
 *
 * An emptied box writes `''` rather than deleting the key: the entry's two keys are 71 of 71
 * and `SpellName` is required, so a deletion would write a shape the schema forbids. `''` is a
 * present value that matches no name, which the warn rule then reports — the honest outcome
 * for a value the user really cleared. A non-string (which a text input cannot produce) is a
 * no-op.
 */
export function treasureCardSpellNameEdit(index: number, raw: unknown): DocEdit | null {
  if (typeof raw !== 'string') {
    return null;
  }
  return { op: 'set', path: treasureCardFieldPath(index, 'SpellName'), value: raw };
}

/**
 * The edit a row's `Price` box produces: a finite number written verbatim, `0` for an emptied
 * box (`0` is the schema's own "use the spell's base cost", and the hint labels it).
 *
 * No rounding and no range is enforced — the spec prints no bound for `Price`, so this editor
 * invents none (the same "no invented rule" reading as the `SpellName` match). A value that is
 * not a finite number (`1e`, `-` while typing) produces **no** edit rather than a `NaN`.
 */
export function treasureCardPriceEdit(index: number, raw: string): DocEdit | null {
  if (raw.trim() === '') {
    return { op: 'set', path: treasureCardFieldPath(index, 'Price'), value: 0 };
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return null;
  }
  return { op: 'set', path: treasureCardFieldPath(index, 'Price'), value };
}

/**
 * `true` when a row's `Price` is exactly `0` — the one case the hint is rendered under.
 * Measured: 0 of the 71 real prices are 0, so this predicate is exercised by a fixture only.
 */
export function priceShowsBaseCostHint(price: unknown): boolean {
  return price === 0;
}

/* -------------------------------------------------------------------- the rule */

/** The one severity this family emits. */
export type TreasureCardValidationSeverity = 'warning';

/** The family's single finding kind. */
export type TreasureCardFindingKind = 'spell-name-not-in-spells';

/** One structured finding. Never a sentence, never a bare string. */
export interface TreasureCardFinding {
  kind: TreasureCardFindingKind;
  severity: TreasureCardValidationSeverity;
  /** The offending field's exact path: `['TreasureCards', 3, 'SpellName']`. */
  path: DocPath;
  /** The offending `SpellName`, verbatim (never a normalised copy). */
  value: unknown;
  /** The row's position in the document array — what a form keys the row by. */
  index: number;
  /** A one-line machine-friendly detail (`"Fire Shield TC" is not a synced spell name`). */
  detail: string;
}

export interface TreasureCardValidationOptions {
  /**
   * The synced `spells.name` values — the reference the match is made against. The engine is
   * pure and `shared/` cannot reach SQLite, so the **caller injects** it (the p4-02 rule).
   *
   * Omitted, `undefined` or **empty** means "this side has no reference table", and the rule
   * then produces **nothing** rather than reporting every row as unknown. That is D65(c)'s
   * measured rule: an unimported names table (the tier-1 harness boots exactly that database,
   * D44) must not turn a real 71-row file into a wall of false warnings.
   */
  spellNames?: ReadonlySet<string>;
}

export interface TreasureCardValidationResult {
  /** Every finding, in document order (one per offending row). */
  findings: TreasureCardFinding[];
  /**
   * **Always empty**: no rule of this family blocks (see the header). Kept as a named field so
   * a caller reads the same result shape as every other engine, and typed as an array so a
   * future blocking rule has one obvious place to land.
   */
  blocking: TreasureCardFinding[];
  /** The same findings as `findings` — this family's every finding is a warning. */
  warnings: TreasureCardFinding[];
  /**
   * **Always `false`** — the literal type is the claim: AC#11's rule warns and Save succeeds,
   * and a future blocking rule must change this type rather than quietly flip the value.
   */
  blocked: false;
  /** `false` when the injected reference set was absent or empty, so the rule was skipped. */
  referenceUsed: boolean;
}

/** `true` when a value is a non-blank string — the only thing that can be a spell name. */
function isNameLike(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * The document's `SpellName` findings — the **literal** match of docs/spec-domain-reference.md
 * L200, one warning per row whose name no synced spell carries.
 *
 * Exposed separately from {@link validateTreasureCardInventory} so the single rule has a name
 * and a unit test of its own; the two are the same pass (the latter calls this).
 */
export function treasureCardSpellNameFindings(
  document: Record<string, unknown>,
  options: TreasureCardValidationOptions = {},
): TreasureCardFinding[] {
  const spellNames = options.spellNames;
  if (spellNames === undefined || spellNames.size === 0) {
    return [];
  }
  const findings: TreasureCardFinding[] = [];
  for (const { index, entry } of readTreasureCards(document)) {
    const value = entry.SpellName;
    // An absent or `null` `SpellName` produces no finding: the editor's contract is that an
    // untouched absent control produces no edit, and a rule that warned about a key the
    // document never had would be noise (the p4-02 absent-field rule). A present value that
    // is not a name at all — `''`, a number — *is* reported, because it is present and
    // matches nothing: `''` is what an emptied box writes.
    if (value === undefined || value === null) {
      continue;
    }
    if (isNameLike(value) && spellNames.has(value)) {
      continue;
    }
    findings.push({
      kind: 'spell-name-not-in-spells',
      severity: 'warning',
      path: treasureCardFieldPath(index, 'SpellName'),
      value,
      index,
      detail: `${JSON.stringify(value)} is not a synced spell name`,
    });
  }
  return findings;
}

/**
 * The family's validation pass — one warning per `SpellName` that no synced spell carries, and
 * **no blocking finding ever** (see the header for which side carries which claim).
 *
 * It validates and never normalises (D57): it reads, it never writes, and the offending value
 * is kept verbatim in the finding. A `SpellName` the document does not carry produces no
 * finding at all.
 */
export function validateTreasureCardInventory(
  document: Record<string, unknown>,
  options: TreasureCardValidationOptions = {},
): TreasureCardValidationResult {
  const referenceUsed = options.spellNames !== undefined && options.spellNames.size > 0;
  const findings = treasureCardSpellNameFindings(document, options);
  return {
    findings,
    blocking: [],
    warnings: findings,
    blocked: false,
    referenceUsed,
  };
}
