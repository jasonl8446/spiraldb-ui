/**
 * The Results editor's model and every pure rule behind it (plan task 3.7, story p3-07;
 * docs/spec-ui-design.md L320, docs/spec-domain-reference.md L354-412).
 *
 * Data and rules, not JSX — the same split as `lib/quest-goals.ts` and
 * `lib/requirement-tree.ts`: the 14 result types ({@link RESULT_TYPE_SPECS}), the corpus
 * `$type` literals (taken from `shared/quest/typeConstants.ts`, never re-typed here), the
 * `m_router` sub-object ({@link SOUND_ROUTER_FIELD_SPECS}), the read helpers a card
 * renderer walks, and the path-addressed edit builders every control calls.
 *
 * **The model is host-agnostic.** Everything is addressed by the absolute
 * {@link DocPath} of a *result-list wrapper* — a quest's `m_startResults`
 * (`['m_startResults']`), its `m_endResults`, a goal's `m_completeResults`
 * (`['m_goals', i, 'm_completeResults']`) / `m_activateResults`, or a tally counter's
 * `m_tallyResults` (`['m_goals', i, 'm_tallyCounter', 'm_tallyResults']`) — so the pair
 * (wrapper path, document state) is the whole contract and the card renderer that consumes
 * it never sees a "quest".
 *
 * ## Measured corpus facts this model is built on
 *
 * Re-measured at the owner's `f9a1055` baseline
 * (`/home/jason/Documents/git-projects/spiraldb/QuestTemplates`, 328 files, D79; the
 * 322-file numbers are the parentheses): **421 result nodes** (was 381) and the type counts are
 * ResDropTable **323** (317), ResAddDynaMod **34** (13), ResLearnSpell **21**, ResGiveSpell
 * **10**, ResDrawHand **8**, ResTeleport **8** (1), ResActorDialog **5** (0, new),
 * ResPostEvent **3**, ResPlaySound **2** (1), ResAddSpell **2**, and **exactly one each** of
 * ResAddHealth, ResAddMana, ResModifyEntry, ResDespawn, ResWait. So **7 of the 15 forms are
 * exercised by five or fewer corpus nodes**; ResDropTable is the only common one.
 * Nothing in this module claims more coverage than that, and the unit test's corpus sweep
 * counts the nodes rather than assuming a healthy population.
 *
 * - **One key order per type, preserved byte-for-byte.** The 15 measured orders are
 *   exactly {@link RESULT_TYPE_SPECS}' field lists (checked by the corpus sweep; the
 *   corpus-only `ResActorDialog`'s list is `$type, m_dialog` and its second key is unowned). A **new**
 *   node is built in its type's own order; an **existing** node is never rebuilt — every
 *   builder writes one key, so a corpus node keeps its order (the one thing a
 *   sort-then-serialize writer would destroy, see D58e).
 * - **No undocumented extra keys.** Field presence matches the spec exactly for the spec's 14
 *   types (unlike `ReqHasEntry` in p3-06), so {@link KNOWN_RESULT_KEYS} is the union of
 *   `$type`, those 14 types' fields and `m_router`'s own keys. The one exception is
 *   `ResActorDialog`, whose `m_dialog` is **deliberately unowned** and therefore reaches the
 *   card's raw-fields disclosure — which is the honest rendering for a nested dialog block this
 *   module has no control for (D79).
 * - **The wrapper is `{"m_results": [...]}` with NO `$type`** — measured in **2206 of
 *   2206** wrappers, each holding exactly that one key (322 `m_startResults` + 322
 *   `m_endResults` + 772 `m_completeResults` + 772 `m_activateResults` + 18
 *   `m_tallyResults`), unlike the *requirement* wrapper. Nothing here tags or reorders it.
 * - **`m_router` is a plain object with its own key order and no `$type`**:
 *   `m_locX, m_locY, m_locZ, m_routingType, m_useLocation, m_useTriggerLocation`, the one
 *   measured sample being
 *   `{"m_locX":0,"m_locY":0,"m_locZ":0,"m_routingType":"ROUTING_ACTOR","m_useLocation":false,"m_useTriggerLocation":false}`.
 *   It is a sub-object, never a tagged node; {@link SOUND_ROUTER_FIELD_SPECS} is its
 *   field list and {@link newSoundRouter} is the only thing that builds one.
 * - **`ResLearnSpell.m_requirements` is present in 21 of 21** (the spec calls it optional;
 *   the corpus always has it) and is an **untyped** wrapper whose key order is
 *   `m_requirements, m_applyNOT, m_operator` and whose children are `ReqSchoolOfFocus`
 *   leaves (7 measured school values). A new node therefore gets
 *   {@link newResultRequirementsWrapper} — an untyped wrapper with one
 *   `ReqSchoolOfFocus` leaf, **not** a `RequirementList`-tagged group — and the editing
 *   surface is the shared `RequirementTreeEditor` mounted at that slot (D62f).
 * - **Friendly-name sources are the real table columns** (`zones.zone_path`,
 *   `spells.template_id`, `npcs.template_id`, `drop_tables.name`, `quests.quest_name`),
 *   and the per-field resolution rates were re-measured through the synced database:
 *   `ResLearnSpell.m_templateID` → spells **16/16** distinct; `ResGiveSpell.m_spellID` →
 *   spells **10/10**; `ResAddSpell.m_templateID` → spells **2/2**; `ResGiveSpell.m_templateID`
 *   → npcs **2/2**; `ResDespawn.m_templateID` → npcs **1/1**; `ResDropTable.m_tableName` →
 *   drop_tables **317/317**; `ResAddDynaMod.m_zoneName` → zones **2/2**;
 *   `ResTeleport.m_destinationZone` → zones **1/1**.
 * - **`ResDrawHand.m_templateID` is split, and it is this story's one genuinely ambiguous
 *   ID field.** All 8 distinct corpus values live in one quest (`WC-TUT-C03-001`); **6
 *   resolve in `spells`** (35528, 126461 resolve in neither) and **2 resolve in `npcs`**
 *   (35528 → Draconian, 126461 → Draconian), and **none resolves in both**. The domain
 *   reference calls it an NPC dropdown; the corpus proves both namespaces are used (the 6
 *   spell-valued ids are also `ResAddSpell`/`ResLearnSpell` template ids). The decision is
 *   recorded in {@link RESULT_TYPE_SPECS} and implemented as a **dual-source, miss-safe**
 *   control: {@link ResultFieldSpec.nameSources} carries both tables and the editor lets
 *   the user pick the source, defaulting to whichever table the value resolves in (and to
 *   `npcs`, the domain reference's own claim, when neither does). An unresolved value stays
 *   displayed and selected and is **never rewritten** (the D60(c) rule) — picking one table
 *   would have left 6 of the 8 real values nameless.
 * - **Two reference hazards are honoured, not defended against** (D59(c)): the one
 *   `ResModifyEntry.m_questName` is `""` and 7 of 13 `ResAddDynaMod.m_zoneName` are `null`
 *   (2 are `""`). An emptied/absent reference must therefore produce **no lookup and no
 *   request**, and clearing a field **deletes the key** when it exists rather than writing
 *   `''` into a typed slot (every empty-string arm below returns a `delete` or nothing).
 *
 * ## The write rule (D57/D58d): edits, never rebuilds
 *
 * {@link readResultCards} returns a **render-only view** — each card's own document value,
 * its path and its fields. It is deliberately not invertible: the document *is* the
 * serialization, and a view→value function would be a second write path around
 * `shared/document.ts`'s primitives. Every builder returns {@link DocEdit}s the caller
 * applies with `applyEdits`, so untouched keys, their order, explicit `null`s and absent
 * keys survive.
 *
 * One care the primitives force, decided here rather than discovered at runtime: the
 * array a card is inserted into may not exist. The corpus always has `m_results`
 * (2206/2206) and always has the four wrappers, but the schema makes both optional
 * (`{ "m_results": [] }` and `{}` both parse), so {@link addResultEdits} takes the two
 * presence flags and writes `{m_results: [node]}` as a whole when there is nothing to
 * insert into. That is still a single `set` of the corpus's wrapper shape, never a
 * `$type`.
 *
 * The same primitive rule has one visible consequence, recorded rather than hidden: a key
 * that an **existing** node does not carry is **appended at the end** (`setAtPath`'s
 * documented merge rule — it never rewrites the keys around it), so adding `m_router` to a
 * `ResPlaySound` node that lacked it puts the key last rather than in the corpus's own
 * position. Only a node this editor **created** carries the canonical order
 * ({@link newResultObject}); an existing node's order is preserved, never re-sorted.
 *
 * `moveResultEdits` is deliberately **absent**: the UI spec's Results section (L320)
 * describes Add and per-card forms but no reordering, and an unused move builder would be
 * a second, untested write path. The requirement-tree module's reorder-free shape is the
 * precedent.
 */

import { formatDocPath, type DocEdit, type DocPath } from '@shared/document';
import { RESULT_TYPES, shortTypeName as knownShortTypeName } from '@shared/quest/typeConstants';

import type { NamesType } from './display';
import { shortTypeName as lenientShortTypeName } from './extract';
import { newRequirementLeaf } from './requirement-tree';

/* ------------------------------------------------------------------ paths */

/** The key every result wrapper carries its array in. */
export const RESULTS_KEY = 'm_results';

/** A quest's start-results wrapper. */
export const START_RESULTS_PATH = 'm_startResults';

/** A quest's end-results wrapper. */
export const END_RESULTS_PATH = 'm_endResults';

/** A goal's completion-results wrapper (per goal). */
export const COMPLETE_RESULTS_PATH = 'm_completeResults';

/** A goal's activation-results wrapper (per goal). */
export const ACTIVATE_RESULTS_PATH = 'm_activateResults';

/** The per-goal tally counter that owns the fifth results container. */
export const TALLY_COUNTER_PATH = 'm_tallyCounter';

/** The tally counter's own results wrapper. */
export const TALLY_RESULTS_PATH = 'm_tallyResults';

/** The `m_results` array path of the wrapper at {@link listPath}. */
export function resultItemsPath(listPath: DocPath): DocPath {
  return [...listPath, RESULTS_KEY];
}

/** One result node's path: `[…wrapper, 'm_results', index]`. */
export function resultNodePath(listPath: DocPath, index: number): DocPath {
  return [...resultItemsPath(listPath), index];
}

/** One result field's path: `[…wrapper, 'm_results', index, key]`. */
export function resultFieldPath(listPath: DocPath, index: number, key: string): DocPath {
  return [...resultNodePath(listPath, index), key];
}

/** The `m_router` sub-object path of the result at {@link index}. */
export function soundRouterPath(listPath: DocPath, index: number): DocPath {
  return [...resultNodePath(listPath, index), SOUND_ROUTER_KEY];
}

/** A result's `m_requirements` slot path — what the shared tree is mounted at. */
export function resultRequirementsPath(listPath: DocPath, index: number): DocPath {
  return [...resultNodePath(listPath, index), REQUIREMENTS_KEY];
}

/* ------------------------------------------------------------------ UI copy */

/** The card list's default accessible name (a host overrides it per slot). */
export const RESULT_LIST_EDITOR_LABEL = 'Result list editor';

/** The bottom "Add Result" control. */
export const ADD_RESULT_LABEL = 'Add Result';

/** The Add Result type selector's label. */
export const ADD_RESULT_TYPE_LABEL = 'New result type';

/** The per-card delete control's label stem (`Delete <address>`). */
export const DELETE_RESULT_LABEL = 'Delete';

/** The empty array's sentence. */
export const NO_RESULTS_TEXT = 'No results.';

/** The absent/null wrapper's sentence — still offered an Add control. */
export const NO_RESULT_WRAPPER_TEXT = 'This list is absent or null.';

/** The read-only disclosure of keys the model does not know. */
export const RAW_FIELDS_LABEL = 'Raw fields';

/** The `—` option every select leads with when the value is unusable. */
export const RESULT_SELECT_UNSET_LABEL = '—';

/** The router group's own note when `m_router` is absent (values shown are the measured new shape). */
export const ROUTER_ABSENT_NOTE =
  'm_router is absent — the values below are the measured new-router shape; the first edit writes it.';

/** The dual-source control's two button labels (ResDrawHand's `m_templateID`). */
export const SPELLS_SOURCE_LABEL = 'Spells';
export const NPCS_SOURCE_LABEL = 'NPCs';

/** The dual-source group's accessible-name stem (`m_templateID source <address>`). */
export const NAME_SOURCE_LABEL = 'source';

/** The new node's default class — the commonest result (323 of 421 corpus nodes at f9a1055). */
export const DEFAULT_RESULT_TYPE: ResultShortTypeName = 'ResDropTable';

/* ------------------------------------------------------------- type specs */

/** How one result field renders. */
export type ResultFieldKind =
  'text' | 'number' | 'boolean' | 'friendly-name' | 'router' | 'requirements' | 'enum';

/** One field of one result class. */
export interface ResultFieldSpec {
  /** The result key this field owns (also the control's visible label and accessible name). */
  key: string;
  kind: ResultFieldKind;
  /** The one-line explanation under the control — the domain reference's own words where it has some. */
  help: string;
  /**
   * For `friendly-name`: the names table(s) the id belongs to. Two entries mean the
   * corpus proves both namespaces are used (only `ResDrawHand.m_templateID`, see the
   * module header) and the editor offers a source choice.
   */
  nameSources?: readonly NamesType[];
  /**
   * For `friendly-name`: the JSON type the raw id is written as. A template id is a
   * number (`ulong`); a table name, zone path or quest name is a string.
   */
  idValueType?: 'string' | 'number';
  /** For `enum`: the listed values. An unlisted current value is appended, never lost. */
  options?: readonly string[];
  /** What a **new** node of this class writes — the corpus's measured majority/new shape. */
  defaultValue: unknown;
}

/** A result short name in the constant table: the 14 classes below. */
export type ResultShortTypeName = keyof typeof RESULT_TYPES;

/** One of the 14 result classes: its `$type` literal and its fields. */
export interface ResultTypeSpec {
  shortName: ResultShortTypeName;
  /**
   * The selector's own vocabulary. The domain reference names the classes and has no
   * friendlier word for them, so the label **is** the short name (`ResDropTable`) — the
   * same choice `requirement-tree.ts` made.
   */
  label: string;
  /** The assembly-qualified `$type`, taken from `shared/quest/typeConstants.ts`. */
  $type: (typeof RESULT_TYPES)[ResultShortTypeName];
  /**
   * The class's fields, in the corpus's own key order. The list doubles as the new node's
   * key order, so the field order and the spec's prose order can differ
   * (`ResModifyEntry` is the measured case: the corpus writes
   * `$type, m_entryName, m_isQuestRegistry, m_value, m_questName`, which is not the order
   * the domain reference lists its fields in) — the saved shape wins.
   */
  fields: readonly ResultFieldSpec[];
  /**
   * `true` for a class the corpus carries but this editor must **not offer to create**
   * ({@link resultTypeSelectOptions} skips it): `ResActorDialog`, whose every measured node
   * carries a nested `m_dialog` this module owns no control for. A *new* node would therefore
   * be `{$type}` alone — a shape the corpus has never had — which is the same
   * shape-invention rule a new dialog group follows (it carries one entry because 0 of 774
   * groups is empty). The class still **resolves**: an existing node renders its title and its
   * raw `m_dialog` disclosure, and nothing about it is rewritten (D79/D57).
   */
  corpusOnly?: boolean;
}

/** The `m_router` sub-object's key in a `ResPlaySound` node. */
export const SOUND_ROUTER_KEY = 'm_router';

/** `ResLearnSpell`'s requirement slot key. */
export const REQUIREMENTS_KEY = 'm_requirements';

/**
 * `m_router`'s fields, in its own measured order and with its own measured values (the
 * one corpus sample). It is a sub-object, **never** a tagged node: nothing here writes a
 * `$type`, and the order is asserted by the unit test and by the tier-1 spec.
 */
export const SOUND_ROUTER_FIELD_SPECS: readonly ResultFieldSpec[] = [
  { key: 'm_locX', kind: 'number', help: 'X coordinate for spatial routing', defaultValue: 0 },
  { key: 'm_locY', kind: 'number', help: 'Y coordinate for spatial routing', defaultValue: 0 },
  { key: 'm_locZ', kind: 'number', help: 'Z coordinate for spatial routing', defaultValue: 0 },
  {
    key: 'm_routingType',
    kind: 'enum',
    help: 'Spatial routing mode (measured: ROUTING_ACTOR only)',
    options: ['ROUTING_ACTOR'],
    defaultValue: 'ROUTING_ACTOR',
  },
  {
    key: 'm_useLocation',
    kind: 'boolean',
    help: 'Route from the router location instead of the actor',
    defaultValue: false,
  },
  {
    key: 'm_useTriggerLocation',
    kind: 'boolean',
    help: 'Route from the trigger’s location',
    defaultValue: false,
  },
];

/**
 * The 15 result classes (docs/spec-domain-reference.md L354-412, plus the corpus-only
 * `ResActorDialog` appended — D79) in the reference's own order, each with the fields the corpus
 * actually carries in the order it carries them.
 *
 * `ResDrawHand.m_templateID`'s two sources are the module header's ambiguity: the corpus
 * splits 6/2 between `spells` and `npcs` and the domain reference names only NPCs, so the
 * editor offers both (see {@link ResultFieldSpec.nameSources}) instead of making 6 of 8
 * real values nameless.
 */
export const RESULT_TYPE_SPECS: readonly ResultTypeSpec[] = [
  {
    shortName: 'ResDropTable',
    label: 'ResDropTable',
    $type: RESULT_TYPES.ResDropTable,
    fields: [
      {
        key: 'm_tableName',
        kind: 'friendly-name',
        help: 'Drop table name (the drop_tables table’s name)',
        nameSources: ['drop_tables'],
        idValueType: 'string',
        defaultValue: '',
      },
      {
        key: 'm_maxRolls',
        kind: 'number',
        help: 'Number of rolls on the table (1 in 314 of the 317 measured nodes)',
        defaultValue: 1,
      },
    ],
  },
  {
    shortName: 'ResModifyEntry',
    label: 'ResModifyEntry',
    $type: RESULT_TYPES.ResModifyEntry,
    // The corpus's own order: `$type, m_entryName, m_isQuestRegistry, m_value,
    // m_questName` — deliberately not the domain reference's field order.
    fields: [
      {
        key: 'm_entryName',
        kind: 'text',
        help: 'Quest registry entry name (the one measured node uses "GainedEnrollment")',
        defaultValue: '',
      },
      {
        key: 'm_isQuestRegistry',
        kind: 'boolean',
        help: 'Whether the entry lives in the quest registry (false in the one measured node)',
        defaultValue: false,
      },
      { key: 'm_value', kind: 'number', help: 'Registry value to set', defaultValue: 0 },
      {
        key: 'm_questName',
        kind: 'friendly-name',
        help: 'Quest whose registry is modified (measured: "" in the one node — no lookup)',
        nameSources: ['quests'],
        idValueType: 'string',
        defaultValue: '',
      },
    ],
  },
  {
    shortName: 'ResAddDynaMod',
    label: 'ResAddDynaMod',
    $type: RESULT_TYPES.ResAddDynaMod,
    fields: [
      {
        key: 'm_dynaModClientTag',
        kind: 'text',
        help: 'Client tag of the dynamic modifier',
        defaultValue: '',
      },
      {
        key: 'm_dynaModRemove',
        kind: 'boolean',
        help: 'Removes the modifier instead of adding it (false in all 13 measured nodes)',
        defaultValue: false,
      },
      {
        key: 'm_useQuestAsOriginator',
        kind: 'boolean',
        help: 'Uses the quest as the modifier’s originator (false in all 13 measured nodes)',
        defaultValue: false,
      },
      {
        key: 'm_dynaModState',
        kind: 'text',
        help: 'Modifier state (7 distinct measured values, e.g. "Off", "FairyEscaped")',
        defaultValue: '',
      },
      {
        key: 'm_zoneName',
        kind: 'friendly-name',
        help: 'Zone path (null in 7 and "" in 2 of the 13 measured nodes — no lookup)',
        nameSources: ['zones'],
        idValueType: 'string',
        defaultValue: '',
      },
    ],
  },
  {
    shortName: 'ResLearnSpell',
    label: 'ResLearnSpell',
    $type: RESULT_TYPES.ResLearnSpell,
    fields: [
      {
        key: 'm_templateID',
        kind: 'friendly-name',
        help: 'Spell template id (all 16 distinct measured values resolve in spells)',
        nameSources: ['spells'],
        idValueType: 'number',
        defaultValue: 0,
      },
      {
        key: 'm_requirements',
        kind: 'requirements',
        help: 'Untyped requirement wrapper (present in all 21 measured nodes; corpus children are ReqSchoolOfFocus)',
        defaultValue: null,
      },
    ],
  },
  {
    shortName: 'ResPostEvent',
    label: 'ResPostEvent',
    $type: RESULT_TYPES.ResPostEvent,
    fields: [
      {
        key: 'm_eventName',
        kind: 'text',
        help: 'Game event to post',
        defaultValue: '',
      },
    ],
  },
  // The two fieldless types: `$type` only, and the shape is not padded out.
  {
    shortName: 'ResAddHealth',
    label: 'ResAddHealth',
    $type: RESULT_TYPES.ResAddHealth,
    fields: [],
  },
  { shortName: 'ResAddMana', label: 'ResAddMana', $type: RESULT_TYPES.ResAddMana, fields: [] },
  {
    shortName: 'ResAddSpell',
    label: 'ResAddSpell',
    $type: RESULT_TYPES.ResAddSpell,
    fields: [
      {
        key: 'm_templateID',
        kind: 'friendly-name',
        help: 'Spell template id (both measured values resolve in spells)',
        nameSources: ['spells'],
        idValueType: 'number',
        defaultValue: 0,
      },
    ],
  },
  {
    shortName: 'ResDespawn',
    label: 'ResDespawn',
    $type: RESULT_TYPES.ResDespawn,
    fields: [
      { key: 'm_spawnID', kind: 'number', help: 'Spawn id to despawn', defaultValue: 0 },
      {
        key: 'm_despawnEffect',
        kind: 'boolean',
        help: 'Plays the despawn effect',
        defaultValue: false,
      },
      {
        key: 'm_templateID',
        kind: 'friendly-name',
        help: 'NPC template id (the one measured value resolves in npcs)',
        nameSources: ['npcs'],
        idValueType: 'number',
        defaultValue: 0,
      },
    ],
  },
  {
    shortName: 'ResDrawHand',
    label: 'ResDrawHand',
    $type: RESULT_TYPES.ResDrawHand,
    fields: [
      {
        key: 'm_templateID',
        kind: 'friendly-name',
        // The story's one ambiguous ID field: measured 6 of 8 distinct values in
        // `spells`, 2 in `npcs`, none in both. Dual-source and miss-safe.
        help: 'Template id — measured 6 of 8 distinct values resolve in spells and 2 in npcs (never both)',
        nameSources: ['spells', 'npcs'],
        idValueType: 'number',
        defaultValue: 0,
      },
    ],
  },
  {
    shortName: 'ResGiveSpell',
    label: 'ResGiveSpell',
    $type: RESULT_TYPES.ResGiveSpell,
    fields: [
      {
        key: 'm_templateID',
        kind: 'friendly-name',
        help: 'NPC template id (both measured values resolve in npcs)',
        nameSources: ['npcs'],
        idValueType: 'number',
        defaultValue: 0,
      },
      {
        key: 'm_spellID',
        kind: 'friendly-name',
        help: 'Spell template id (all 10 measured values resolve in spells)',
        nameSources: ['spells'],
        idValueType: 'number',
        defaultValue: 0,
      },
    ],
  },
  {
    shortName: 'ResPlaySound',
    label: 'ResPlaySound',
    $type: RESULT_TYPES.ResPlaySound,
    fields: [
      {
        key: SOUND_ROUTER_KEY,
        kind: 'router',
        help: 'Spatial routing sub-object — its own six keys, no $type',
        defaultValue: null,
      },
      { key: 'm_soundName', kind: 'text', help: 'Sound file path', defaultValue: '' },
      {
        key: 'm_blocking',
        kind: 'boolean',
        help: 'Blocks until the sound finishes',
        defaultValue: false,
      },
      {
        key: 'm_reinteractTime',
        kind: 'number',
        help: 'Seconds before the sound can be re-triggered',
        defaultValue: 0,
      },
    ],
  },
  {
    shortName: 'ResTeleport',
    label: 'ResTeleport',
    $type: RESULT_TYPES.ResTeleport,
    fields: [
      {
        key: 'm_destinationLoc',
        kind: 'text',
        help: 'Destination location name (the one measured node: "Target location Landing")',
        defaultValue: '',
      },
      {
        key: 'm_destinationZone',
        kind: 'friendly-name',
        help: 'Zone path (the one measured value resolves in zones)',
        nameSources: ['zones'],
        idValueType: 'string',
        defaultValue: '',
      },
      { key: 'm_exitTeleporter', kind: 'number', help: 'Exit teleporter flag', defaultValue: 0 },
      { key: 'm_teleporterTag', kind: 'number', help: 'Teleporter tag', defaultValue: 0 },
      {
        key: 'm_teleportType',
        kind: 'enum',
        help: 'Teleport mode (measured: TELEPORT_STATIC only)',
        options: ['TELEPORT_STATIC'],
        defaultValue: 'TELEPORT_STATIC',
      },
      { key: 'm_transitionID', kind: 'number', help: 'Transition id', defaultValue: 0 },
    ],
  },
  {
    shortName: 'ResWait',
    label: 'ResWait',
    $type: RESULT_TYPES.ResWait,
    fields: [
      {
        key: 'm_secondsToWait',
        kind: 'number',
        help: 'Seconds to pause (the one measured node waits 5)',
        defaultValue: 0,
      },
    ],
  },
  /**
   * `ResActorDialog` — the corpus-only 15th class (D79; the spec's L354-412 list has 14 and
   * this baseline's corpus carries 5 of these, in 3 quests).
   *
   * Its measured shape is `{$type, m_dialog}`, where `m_dialog` is a **nested typed dialog
   * block** (`ActorDialogSchema`: `$type, m_dialogTag, m_dialogEntries, m_madlibs,
   * m_dialogEvents, m_noAggroWhileDialogIsUp, m_noAggroNoDelay`).
   *
   * **`fields` is deliberately empty.** The dialog block has no control in this module — the
   * dialog editor's own model (`lib/quest-dialog.ts`) owns dialog nodes, and the block's
   * `m_dialogEntries` are full 66-key `NPCDialogEntry` nodes — so claiming `m_dialog` as one of
   * *this* spec's fields would either need a new field kind with a renderer nobody has built, or
   * invite a text control that could overwrite an object with a string. Leaving it unowned puts
   * the whole `m_dialog` value in the card's existing **raw-fields disclosure**
   * ({@link rawResultFields}), which renders it verbatim, read-only, and never writes it: the
   * node survives a save untouched, and the user can see exactly what is there
   * (D57 — acknowledge, never normalise; a control for this sub-tree is editor work, not a
   * baseline re-measure).
   */
  {
    shortName: 'ResActorDialog',
    label: 'ResActorDialog',
    $type: RESULT_TYPES.ResActorDialog,
    fields: [],
    corpusOnly: true,
  },
];

/**
 * Every key the model knows: `$type`, the 14 types' fields and `m_router`'s own keys.
 * Anything else on a result node is **unmodelled** and is surfaced verbatim by the
 * card's raw-fields disclosure; it is never rewritten and never removed.
 */
export const KNOWN_RESULT_KEYS: readonly string[] = [
  '$type',
  ...RESULT_TYPE_SPECS.flatMap((spec) => spec.fields.map((field) => field.key)),
  ...SOUND_ROUTER_FIELD_SPECS.map((field) => field.key),
];

/* ------------------------------------------------------------------ lookups */

/** `true` for a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `container[key]` — `undefined` for a non-object container. */
export function resultField(result: unknown, key: string): unknown {
  return isPlainObject(result) ? result[key] : undefined;
}

/** The spec for a short type name, or `undefined`. */
export function resultTypeSpecByName(name: string): ResultTypeSpec | undefined {
  return RESULT_TYPE_SPECS.find((spec) => spec.shortName === name);
}

/** The spec for an assembly-qualified `$type`, or `undefined` (an unknown string is unknown). */
export function resultTypeSpecForTypeString(typeString: unknown): ResultTypeSpec | undefined {
  if (typeof typeString !== 'string') {
    return undefined;
  }
  return RESULT_TYPE_SPECS.find((spec) => spec.$type === typeString);
}

/** The result's class spec, or `undefined` for an absent/unknown `$type`. */
export function resultTypeSpecForResult(result: unknown): ResultTypeSpec | undefined {
  return resultTypeSpecForTypeString(resultField(result, '$type'));
}

/**
 * The result's short type name for display: the constant table's own short name when it
 * knows the `$type`, the same lenient `$type` tail reader the read-only panels use
 * (`lib/extract.ts`) when it does not, and `'unknown'` only when there is nothing to show.
 */
export function resultShortTypeName(result: unknown): string {
  const typeString = resultField(result, '$type');
  if (typeof typeString === 'string') {
    const fromTable = knownShortTypeName(typeString);
    if (fromTable !== undefined) {
      return fromTable;
    }
    return lenientShortTypeName(typeString) ?? 'unknown';
  }
  return 'unknown';
}

/** The keys present on a result node that the model does not know. */
export function unmodelledResultKeys(result: unknown): string[] {
  if (!isPlainObject(result)) {
    return [];
  }
  return Object.keys(result).filter((key) => !KNOWN_RESULT_KEYS.includes(key));
}

/** The unmodelled keys' values, in the node's own key order (never invented). */
export function rawResultFields(result: unknown): Record<string, unknown> {
  if (!isPlainObject(result)) {
    return {};
  }
  const wanted = new Set(unmodelledResultKeys(result));
  const raw: Record<string, unknown> = {};
  for (const key of Object.keys(result)) {
    if (wanted.has(key)) {
      raw[key] = result[key];
    }
  }
  return raw;
}

/** The result wrapper's `m_results` array, or `[]` for an absent/wrongly-typed value. */
export function resultNodes(wrapperValue: unknown): readonly unknown[] {
  if (!isPlainObject(wrapperValue)) {
    return [];
  }
  const items = wrapperValue[RESULTS_KEY];
  return Array.isArray(items) ? items : [];
}

/* ------------------------------------------------------------ read helpers */

/** One field of one card, addressed by its absolute path. */
export interface ResultFieldView {
  spec: ResultFieldSpec;
  path: DocPath;
  value: unknown;
  /** `true` when the key exists in the document (absent ≠ `null`). */
  present: boolean;
}

/** One result card: its own document value, its spec and its fields. */
export interface ResultCardView {
  index: number;
  /** The wrapper path this card was read from. */
  listPath: DocPath;
  /** The node's absolute document path. */
  path: DocPath;
  /**
   * The node's **address** for display and accessible names — its document path
   * (`m_startResults.m_results[0]`, `m_goals[2].m_completeResults.m_results[1]`), unique
   * across every list mounted on a page because the wrapper keys are distinct per list.
   */
  address: string;
  value: unknown;
  /** `false` when the value is not a plain object (the card shows it verbatim). */
  readable: boolean;
  /** The card's class spec, or `null` for an unknown/absent `$type`. */
  spec: ResultTypeSpec | null;
  /** The raw `$type` string exactly as the document carries it. */
  typeString: string | null;
  /** The card's title: the class label, or the lenient `$type` tail. */
  title: string;
  /** The class's fields at this card's paths, in the corpus's own order. */
  fields: readonly ResultFieldView[];
}

/**
 * The card views of an existing wrapper value. A wrapper that is not an object yields the
 * caller's empty state (`[]`); children that are not objects are **kept** in the view
 * ({@link ResultCardView.readable} is `false`) so nothing is hidden by the renderer.
 */
export function readResultCards(listPath: DocPath, wrapperValue: unknown): ResultCardView[] {
  return resultNodes(wrapperValue).map((value, index) => {
    const path = resultNodePath(listPath, index);
    const spec = resultTypeSpecForResult(value);
    const readable = isPlainObject(value);
    return {
      index,
      listPath,
      path,
      address: formatDocPath(path),
      value,
      readable,
      spec: spec ?? null,
      typeString: readable && typeof value.$type === 'string' ? value.$type : null,
      title: spec?.label ?? resultShortTypeName(value),
      fields: (spec?.fields ?? []).map((field) => ({
        spec: field,
        path: [...path, field.key],
        value: resultField(value, field.key),
        present: readable && Object.prototype.hasOwnProperty.call(value, field.key),
      })),
    };
  });
}

/** `container[key]` where the container may be absent — the router's own reader. */
export function soundRouterField(router: unknown, key: string): unknown {
  return isPlainObject(router) ? router[key] : undefined;
}

/** `true` when the node carries an `m_router` object (absent/`null` are the same to the UI). */
export function hasSoundRouter(result: unknown): boolean {
  return isPlainObject(resultField(result, SOUND_ROUTER_KEY));
}

/**
 * The values the router sub-controls render: the document's own router when it is an
 * object, otherwise the measured new-router shape ({@link newSoundRouter}) so the user can
 * see and change what a first edit will write. Render-only — nothing is written until a
 * control is used.
 */
export function soundRouterView(result: unknown): Record<string, unknown> {
  const router = resultField(result, SOUND_ROUTER_KEY);
  return isPlainObject(router) ? router : newSoundRouter();
}

/* --------------------------------------------------------------- selects */

/** The select's value for a document value: the string itself, `''` otherwise. */
export function resultSelectValue(current: unknown): string {
  return typeof current === 'string' ? current : '';
}

/** One `<option>` of a result select. */
export interface ResultSelectOption {
  value: string;
  label: string;
  /** `true` for the document's own value when the listed values do not include it. */
  unlisted: boolean;
}

/**
 * The options a result select offers, mirroring `goalSelectOptions`: the listed values,
 * plus (a) a leading unset option when the document has no usable value, or (b) the
 * document's own value appended when the list has never heard of it. Real content is never
 * silently snapped to a listed option, and the select's value is always the document's own.
 */
export function resultSelectOptions(
  current: unknown,
  listed: readonly string[],
): ResultSelectOption[] {
  const options: ResultSelectOption[] = listed.map((value) => ({
    value,
    label: value,
    unlisted: false,
  }));
  const raw = resultSelectValue(current);
  if (raw === '') {
    return [{ value: '', label: RESULT_SELECT_UNSET_LABEL, unlisted: false }, ...options];
  }
  if (!listed.includes(raw)) {
    return [...options, { value: raw, label: raw, unlisted: true }];
  }
  return options;
}

/** The 14 classes, in the domain reference's order (the Add selector's vocabulary). */
export function resultTypeSelectOptions(): ResultSelectOption[] {
  return RESULT_TYPE_SPECS.filter((spec) => spec.corpusOnly !== true).map((spec) => ({
    value: spec.shortName,
    label: spec.label,
    unlisted: false,
  }));
}

/* ------------------------------------------------------------ new nodes */

/** A brand-new `m_router` in the corpus's own key order and measured values. */
export function newSoundRouter(): Record<string, unknown> {
  const router: Record<string, unknown> = {};
  for (const field of SOUND_ROUTER_FIELD_SPECS) {
    router[field.key] = field.defaultValue;
  }
  return router;
}

/**
 * A brand-new `ResLearnSpell.m_requirements`: the **untyped** wrapper
 * (`m_requirements, m_applyNOT, m_operator` — the corpus's own order, no `$type`) holding
 * one canonical `ReqSchoolOfFocus` leaf, the only class the corpus puts inside a result
 * wrapper (21 of 21 nodes). Built through the shared tree's own `newRequirementLeaf`, not
 * a copy of it.
 */
export function newResultRequirementsWrapper(): Record<string, unknown> {
  return {
    m_requirements: [newRequirementLeaf('ReqSchoolOfFocus')],
    m_applyNOT: false,
    m_operator: 'ROP_AND',
  };
}

/** The value a new node gives one field of its class. */
function newResultFieldValue(field: ResultFieldSpec): unknown {
  switch (field.kind) {
    case 'router':
      return newSoundRouter();
    case 'requirements':
      return newResultRequirementsWrapper();
    default:
      return field.defaultValue;
  }
}

/**
 * A brand-new result in its class's **canonical new-node order**: `$type` first, then the
 * class's fields at their measured defaults. The order is asserted for new nodes only —
 * an existing node is never rebuilt from it (module header).
 */
export function newResultObject(type: ResultShortTypeName): Record<string, unknown> {
  const spec = resultTypeSpecByName(type);
  if (spec === undefined) {
    throw new Error(`unknown result type "${type}"`);
  }
  const node: Record<string, unknown> = { $type: spec.$type };
  for (const field of spec.fields) {
    node[field.key] = newResultFieldValue(field);
  }
  return node;
}

/* --------------------------------------------------------- list builders */

/** Whether the wrapper (and its array) exist — what {@link addResultEdits} needs to know. */
export interface ResultListPresence {
  /** `true` when the wrapper key exists at all (even holding `null`). */
  wrapper: boolean;
  /** `true` when the wrapper's `m_results` is an array. */
  items: boolean;
}

/**
 * Adding a result of {@link type} to the wrapper at {@link listPath}.
 *
 * Three shapes, because the corpus guarantees the first and the schema allows the others:
 *
 * 1. the array exists → one `insert` at {@link index} (the corpus's own case, 2206/2206);
 * 2. the wrapper exists without an array (`{}` or `{m_results: null}`) → one `set` of
 *    `m_results` to a one-element array, because there is no array to insert into;
 * 3. the wrapper itself is absent → one `set` of the wrapper to `{m_results: [node]}` —
 *    the corpus's own wrapper shape, **without** a `$type`.
 *
 * In cases 2 and 3 the array is empty by definition, so {@link index} is only meaningful
 * for case 1 and the caller passes the current item count.
 */
export function addResultEdits(
  listPath: DocPath,
  index: number,
  type: ResultShortTypeName,
  presence: ResultListPresence,
): DocEdit[] {
  const node = newResultObject(type);
  if (presence.items) {
    return [{ op: 'insert', path: resultItemsPath(listPath), index, value: node }];
  }
  if (presence.wrapper) {
    return [{ op: 'set', path: resultItemsPath(listPath), value: [node] }];
  }
  return [{ op: 'set', path: listPath, value: { [RESULTS_KEY]: [node] } }];
}

/**
 * Deleting the result at {@link index}: one `delete` of exactly that array element.
 * Because a delete shifts the later indices of its own array, the caller applies it on its
 * own rather than batched with another index-addressed edit of the same list.
 */
export function deleteResultEdits(listPath: DocPath, index: number): DocEdit[] {
  return [{ op: 'delete', path: resultNodePath(listPath, index) }];
}

/* ---------------------------------------------------------- field edits */

/**
 * The edit a text-like control (text input, enum select) produces on `key` of the result
 * at {@link index}. Emptying the control deletes the key when it exists and produces **no**
 * edit when it does not (the p3-03/p3-04/p3-06 rule, D59(c)) — so clearing an
 * already-absent field can never create one, and an enum whose unset option is chosen
 * deletes rather than writing `''`.
 */
export function setResultTextFieldEdit(
  listPath: DocPath,
  index: number,
  key: string,
  present: boolean,
  raw: string,
): DocEdit | null {
  if (raw === '') {
    return present ? { op: 'delete', path: resultFieldPath(listPath, index, key) } : null;
  }
  return { op: 'set', path: resultFieldPath(listPath, index, key), value: raw };
}

/**
 * The edit a number input produces on `key` of the result at {@link index}. `''` behaves
 * like {@link setResultTextFieldEdit}; a non-finite intermediate (`1e`, `-`) produces no
 * edit rather than a `NaN` in the document, and the parsed number is written exactly as
 * parsed — no rounding (D57: validate, never normalise).
 */
export function setResultNumberFieldEdit(
  listPath: DocPath,
  index: number,
  key: string,
  present: boolean,
  raw: string,
): DocEdit | null {
  if (raw.trim() === '') {
    return present ? { op: 'delete', path: resultFieldPath(listPath, index, key) } : null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return null;
  }
  return { op: 'set', path: resultFieldPath(listPath, index, key), value };
}

/**
 * The edit a checkbox produces on `key` of the result at {@link index}. A checkbox can
 * only express `true`/`false`, and the caller invokes this only when the user toggles it —
 * an absent or `null` value renders unchecked and stays untouched until then.
 */
export function setResultBooleanFieldEdit(
  listPath: DocPath,
  index: number,
  key: string,
  checked: boolean,
): DocEdit {
  return { op: 'set', path: resultFieldPath(listPath, index, key), value: checked };
}

/**
 * The edit a friendly-name dropdown produces on a result's ID field: the **raw id**
 * (AGENTS.md rule 5) written as the field's own JSON type — a number for a template id, the
 * string itself for a table name/zone path/quest name.
 *
 * Clearing the control (`''`, the dropdown's "None") deletes the key when it exists and
 * produces no edit when it does not; a numeric id that is not a finite number produces no
 * edit rather than a `NaN`. An unresolved id is never rewritten: the dropdown hands back
 * exactly what the document holds, so this writes the same bytes back.
 */
export function setResultIdFieldEdit(
  listPath: DocPath,
  index: number,
  field: ResultFieldSpec,
  present: boolean,
  rawId: string,
): DocEdit | null {
  const path = resultFieldPath(listPath, index, field.key);
  if (rawId === '') {
    return present ? { op: 'delete', path } : null;
  }
  if (field.idValueType === 'number') {
    const value = Number(rawId);
    if (!Number.isFinite(value)) {
      return null;
    }
    return { op: 'set', path, value };
  }
  return { op: 'set', path, value: rawId };
}

/* ---------------------------------------------------------- router edits */

/**
 * The edit a router sub-control produces on {@link field}.
 *
 * When the node's {@link router} is **not** an object (absent or `null`) the whole router
 * is written in one `set` — the measured shape ({@link newSoundRouter}) with this field
 * overridden — because the document primitives never invent an intermediate object and a
 * sub-key `set` would therefore address a path that does not exist. That is precisely the
 * "the user's first edit creates the sub-object" case, and it writes no `$type`.
 *
 * When the router **is** an object, one key is written or deleted: an emptied control
 * deletes the key when it exists and does nothing when it does not (D59(c)), text/enum
 * values are written as strings, numbers exactly as parsed, and a non-finite number
 * produces no edit rather than a `NaN`.
 */
export function setRouterFieldEdit(
  listPath: DocPath,
  index: number,
  router: unknown,
  field: ResultFieldSpec,
  present: boolean,
  raw: string,
): DocEdit | null {
  const path = soundRouterPath(listPath, index);
  const empty = field.kind === 'number' ? raw.trim() === '' : raw === '';
  const value = field.kind === 'number' ? Number(raw) : raw;
  if (typeof value === 'number' && raw.trim() !== '' && !Number.isFinite(value)) {
    return null;
  }
  if (isPlainObject(router)) {
    if (empty) {
      return present ? { op: 'delete', path: [...path, field.key] } : null;
    }
    return { op: 'set', path: [...path, field.key], value };
  }
  if (empty) {
    return null;
  }
  const created = newSoundRouter();
  created[field.key] = value;
  return { op: 'set', path, value: created };
}

/**
 * The edit the router's checkbox produces. Same absent-router rule as
 * {@link setRouterFieldEdit}: a first toggle writes the whole measured router with that
 * field set, an existing router gets one key.
 */
export function setRouterBooleanFieldEdit(
  listPath: DocPath,
  index: number,
  router: unknown,
  field: ResultFieldSpec,
  checked: boolean,
): DocEdit {
  const path = soundRouterPath(listPath, index);
  if (isPlainObject(router)) {
    return { op: 'set', path: [...path, field.key], value: checked };
  }
  const created = newSoundRouter();
  created[field.key] = checked;
  return { op: 'set', path, value: created };
}

/* -------------------------------------------------------------- display */

/** A scalar document value as text — `null`/absent render empty (p3-03's rule). */
export function resultScalarText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}
