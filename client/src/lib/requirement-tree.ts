/**
 * The Requirements tree's model and every pure rule behind it (plan task 3.6, story
 * p3-06; docs/spec-ui-design.md L388-416, docs/spec-domain-reference.md L416-440).
 *
 * Data and rules, not JSX — the same split as `lib/quest-goals.ts`: the 4 requirement
 * types ({@link REQUIREMENT_TYPE_SPECS}), the corpus `$type` literals (taken from
 * `shared/quest/typeConstants.ts`, never re-typed here), the border-colour and
 * control-copy constants, the read helpers a recursive card renderer walks, and the
 * path-addressed edit builders every control calls.
 *
 * **The model is host-agnostic.** Everything here is addressed by an absolute
 * {@link DocPath} to a *requirement wrapper slot* — a quest's `m_requirements`
 * (`['m_requirements']`), its `m_prepRequirements`, a goal's `m_goalRequirements`
 * (`['m_goals', i, 'm_goalRequirements']`), or a DropTable item's `Requirements`
 * (`['Items', i, 'Requirements']`) — so the pair
 * (`slotPath`, document state) is the whole contract and the shared component that
 * renders it never sees a "quest". Phase 4 reuses it inline in DropTable item rows
 * ([spec-domain-reference.md] L708-709).
 *
 * ## The wrapper shape (measured, 322 `QuestTemplates/*.json` + `DropTables/`)
 *
 * Every node — the `RequirementList` wrapper and each leaf — carries `m_applyNOT` and
 * `m_operator`, and a wrapper carries its children in `m_requirements`:
 *
 * ```json
 * { "$type": "Imcodec.ObjectProperty.TypeCache.RequirementList, Imcodec.ObjectProperty",
 *   "m_applyNOT": false, "m_operator": "ROP_AND", "m_requirements": [ … ] }
 * ```
 *
 * - `m_requirements` is a **wrapper object** in 314 of 322 quests and `null` in 8;
 *   `m_prepRequirements` is `null` in **all 322** (and `m_pruneRequirements`, too), so
 *   the editor must be null-tolerant and must not invent an object until the user acts.
 * - Node `$type`s: `RequirementList` 307, `ReqHasQuest` 277, `ReqHasEntry` 40, and **7
 *   wrappers with no `$type` at all** (`{m_requirements, m_applyNOT, m_operator}`, e.g.
 *   `WC-UNICORN-MAIN-001/002/003`). A typeless wrapper is a legal corpus value and is
 *   **never given a `$type`** — every builder here inserts into or below it and never
 *   rewrites the wrapper itself (D57).
 * - **Depths 0 and 1 only**: the corpus never nests a group inside a group. List child
 *   counts are 1 (312×), 2 (1×) and 3 (1×) — never 0.
 * - `m_operator` is `ROP_AND` in **631 of 631** nodes; `ROP_OR` never occurs.
 *   `m_applyNOT` is `false` in 630 and `true` in exactly one node — a `ReqHasEntry` leaf
 *   (`WC-UNICORN-MAIN-002`).
 * - `ReqHasEntry` carries **two keys the spec's field list omits**: `m_displayName`
 *   (`null` in all 40) and `m_isQuestRegistry` (`true` in 39, `false` in 1). Both are
 *   modelled (so they can be seen and edited) and both survive every other edit.
 * - `ReqSchoolOfFocus` (63) and `ReqIsSchool` (2) occur **only inside DropTable item
 *   requirements** — 65 of 72 items, under the item key `Requirements`, whose wrapper is
 *   **untyped** (`m_requirements, m_applyNOT, m_operator`) — plus inside quest *result*
 *   objects (21×, task 3.7's territory). A quest's own `m_requirements` tree in the whole
 *   corpus contains only `ReqHasQuest` and `ReqHasEntry`.
 * - `ReqHasGoal` and `ReqEntryValue`: **0 occurrences corpus-wide** —
 *   `docs/spec-domain-reference.md` L436 says they must not be implemented, and
 *   {@link REQUIREMENT_TYPE_SPECS} has exactly the other four.
 * - `m_goalRequirements` (on goals) is `null` in **all 772** goals, so anything it ever
 *   holds is synthetic.
 *
 * ## FIxture-only, stated three separate ways
 *
 * The story's example `AND(ReqHasQuest{NOT}, OR(ReqSchoolOfFocus, ReqHasEntry))` exists
 * in **no** corpus file, for three independent reasons, and the fixtures that exercise it
 * (the unit fixture, the tier-1 spec) are labelled fixture-only:
 *
 * 1. **`ROP_OR` never occurs** (631/631 nodes are `ROP_AND`) — building the OR group is
 *    the first synthetic act.
 * 2. **A group nested inside a group never occurs** (depths 0 and 1 only) — the OR group
 *    is the second.
 * 3. **The cross-type mix never occurs in one tree**: `ReqHasQuest`/`ReqHasEntry` are the
 *    only leaves a quest's own tree ever holds, while `ReqSchoolOfFocus`/`ReqIsSchool`
 *    live in DropTable items and result objects. The third.
 *
 * Nothing in this module claims the corpus exercises the OR arm, a nested group or that
 * mix; the unit test's expectation is hand-written, and the tier-1 spec says the same
 * thing in its header.
 *
 * ## The write rule (D57/D58d): edits, never rebuilds
 *
 * {@link readRequirementTree} returns a **render-only view** — the node's own document
 * value, its path and its children. It is deliberately not invertible: there is no
 * "serialize the view" function here, because the document *is* the serialization and a
 * view→value function would be a second write path around `shared/document.ts`'s
 * primitives (D58d). Every builder below returns {@link DocEdit}s that the caller applies
 * with `applyEdits`, so untouched keys, their order, explicit `null`s and absent keys all
 * survive (D57). The round trip is a test property, not a function:
 *
 * ```
 * corpus value → readRequirementTree → edits → applyEdits → value
 *              → serializeDoc → JSON.parse → loadDoc → readRequirementTree  (deep-equal)
 * ```
 *
 * Two smaller rules this module decides and records:
 *
 * - **An existing node keeps its key order byte-for-byte; only a NEW node gets a
 *   canonical order.** The corpus has 5 distinct orders and the builders never rewrite a
 *   node's keys in place: they `insert` new nodes and `set`/`delete` single keys. The one
 *   exception is {@link changeLeafTypeEdits}, and it is a *replacement* on purpose: the
 *   old object's keys belong to the old class, so it writes the new class's canonical
 *   object rather than merging two classes' fields (see its own doc comment).
 * - **A group's own `m_applyNOT` is not offered by the editor.** `docs/spec-ui-design.md`
 *   L388-416 puts NOT on a leaf, and the corpus carries `m_applyNOT: false` on all 314
 *   wrappers (the single `true` is a leaf). The value survives every edit; the UI cannot
 *   change it. That is a stated limitation, not a normalisation.
 */

import { formatDocPath, type DocEdit, type DocPath } from '@shared/document';
import { enumTerm, fieldLabel } from '@shared/glossary';
import {
  MAGIC_SCHOOLS,
  REQUIREMENT_LIST_TYPE,
  REQUIREMENT_OPERATORS,
  REQUIREMENT_TYPES,
  shortTypeName,
  type RequirementOperator,
} from '@shared/quest/typeConstants';

import { shortTypeName as lenientShortTypeName } from './extract';
import { termText } from './term';

/* ------------------------------------------------------------------ paths */

/** A quest's own requirement slot. */
export const REQUIREMENTS_PATH = 'm_requirements';

/** The quest's preparation slot — `null` in all 322 corpus quests. */
export const PREP_REQUIREMENTS_PATH = 'm_prepRequirements';

/** The quest's prune slot — `null` in all 322 corpus quests, still not editable here. */
export const PRUNE_REQUIREMENTS_PATH = 'm_pruneRequirements';

/** The per-goal slot (`m_goals[i].m_goalRequirements`) — `null` in all 772 corpus goals. */
export const GOAL_REQUIREMENTS_PATH = 'm_goalRequirements';

/** The key a group carries its children in. */
export const REQUIREMENT_CHILDREN_KEY = 'm_requirements';

/** A group's children array path: `[…group, 'm_requirements']`. */
export function requirementChildrenPath(nodePath: DocPath): DocPath {
  return [...nodePath, REQUIREMENT_CHILDREN_KEY];
}

/** One child's path: `[…group, 'm_requirements', index]`. */
export function requirementChildPath(nodePath: DocPath, index: number): DocPath {
  return [...requirementChildrenPath(nodePath), index];
}

/* ------------------------------------------------------------ UI copy */

/** The shared component's default accessible name (a host may override it). */
export const REQUIREMENT_TREE_EDITOR_LABEL = 'Requirement tree editor';

/** The per-node "add a leaf" control (the spec ASCII's `+ Add Condition`). */
export const ADD_CONDITION_LABEL = 'Add Condition';

/** The per-node "add a nested group" control (the spec ASCII's `+ Add Group`). */
export const ADD_GROUP_LABEL = 'Add Group';

/** The per-node delete control (the spec ASCII's `×`). */
export const DELETE_NODE_LABEL = 'Delete';

/** A group card's own noun (its accessible name leads with the operator). */
export const GROUP_LABEL = 'Group';

/** The empty slot's sentence. */
export const NO_REQUIREMENTS_TEXT = 'No requirements.';

/** A node whose value is not an object: kept visible instead of dropped. */
export const UNREADABLE_NODE_TEXT = 'Unrecognised requirement value';

/** The `—` option every enum/text select leads with when the value is unusable. */
export const REQUIREMENT_SELECT_UNSET_LABEL = '—';

/** The operator enum's display words (the toggle's visible text and label stem). */
export const REQUIREMENT_OPERATOR_LABELS: Record<RequirementOperator, string> = {
  ROP_AND: enumTerm('RequirementOperator', 'ROP_AND')?.label ?? 'ROP_AND',
  ROP_OR: enumTerm('RequirementOperator', 'ROP_OR')?.label ?? 'ROP_OR',
};

/** The new condition's default class — the dominant leaf class (277 of 317 leaves). */
export const DEFAULT_REQUIREMENT_TYPE: RequirementShortTypeName = 'ReqHasQuest';

/* -------------------------------------------------------- border colours */

/**
 * A group card's **left**-border colour, keyed by operator (docs/spec-ui-design.md
 * L388-416: AND blue, OR purple). Literal class strings on purpose: a composed name is
 * invisible to Tailwind's scanner and would render unstyled. They are per-side
 * (`border-l-*`) rather than all-sides (`border-*`) so the colour cannot lose a CSS-order
 * race against the card's neutral `border-zinc-800`.
 */
export const REQUIREMENT_GROUP_BORDER_CLASSES: Record<RequirementOperator, string> = {
  ROP_AND: 'border-l-blue-500',
  ROP_OR: 'border-l-purple-500',
};

/** A leaf card's left-border colour (docs/spec-ui-design.md L388-416: green). */
export const REQUIREMENT_LEAF_BORDER_CLASS = 'border-l-green-500';

/* ------------------------------------------------------------- type specs */

/** How one requirement field renders. */
export type RequirementFieldKind = 'text' | 'quest' | 'enum' | 'boolean';

/** One field of one requirement class. */
export interface RequirementFieldSpec {
  /** The requirement key this field owns. */
  key: string;
  kind: RequirementFieldKind;
  /**
   * The control's label. The spec ASCII's own wording where it has one
   * (docs/spec-ui-design.md L388-416: `Quest:` / `School:` / `Entry:`).
   */
  label: string;
  /** The one-line explanation under the control (the spec's words where it has some). */
  help: string;
  /** For `enum`: the listed values. An unlisted current value is appended, never lost. */
  options?: readonly string[];
  /**
   * The value a **new** node of this class writes for the key, in the corpus's own
   * convention where it has one: a string field is `''` (the `newGoalObject` habit), and
   * the two measured majority/null values are used verbatim (`m_isQuestRegistry: true` in
   * 39 of 40 nodes, `m_displayName: null` in 40 of 40).
   */
  defaultValue: unknown;
}

/** A requirement short name in the constant table: the 4 classes below. */
export type RequirementShortTypeName = keyof typeof REQUIREMENT_TYPES;

/** One of the 4 requirement classes: its `$type` literal and its fields. */
export interface RequirementTypeSpec {
  shortName: RequirementShortTypeName;
  /**
   * The selector's own vocabulary: the class's glossary pair (`Requires quest (ReqHasQuest)`,
   * D131, task 7.9), which is also the text of a leaf card's accessible name.
   */
  label: string;
  /** The assembly-qualified `$type`, taken from `shared/quest/typeConstants.ts`. */
  $type: (typeof REQUIREMENT_TYPES)[RequirementShortTypeName];
  /**
   * `true` when the corpus writes `m_applyNOT`/`m_operator` **before** this class's own
   * fields. Measured: `ReqHasQuest` is `$type, m_applyNOT, m_operator, m_questName` (277×)
   * while `ReqHasEntry`, `ReqSchoolOfFocus` and `ReqIsSchool` put their fields first and
   * the two flags last. It decides {@link newRequirementLeaf}'s key order only.
   */
  baseFieldsFirst: boolean;
  /** The class's own fields, in the corpus's own order. */
  fields: readonly RequirementFieldSpec[];
}

/**
 * The 4 requirement classes (docs/spec-domain-reference.md L416-438). `ReqHasGoal` and
 * `ReqEntryValue` are deliberately **absent** (L436) — the type selector built from this
 * table therefore cannot offer them, and `tests/unit/requirement-tree.test.ts` asserts
 * that rather than assuming it.
 */
export const REQUIREMENT_TYPE_SPECS: readonly RequirementTypeSpec[] = [
  {
    shortName: 'ReqHasQuest',
    label: termText({ type: 'ReqHasQuest' }),
    $type: REQUIREMENT_TYPES.ReqHasQuest,
    baseFieldsFirst: true,
    fields: [
      {
        key: 'm_questName',
        kind: 'quest',
        label: fieldLabel('m_questName'),
        help: 'Quest the player must have (or, with NOT, must not have) completed',
        defaultValue: '',
      },
    ],
  },
  {
    shortName: 'ReqHasEntry',
    label: termText({ type: 'ReqHasEntry' }),
    $type: REQUIREMENT_TYPES.ReqHasEntry,
    baseFieldsFirst: false,
    // The corpus's own key order for this class (40/40): `$type, m_entryName,
    // m_displayName, m_isQuestRegistry, m_questName, m_applyNOT, m_operator`. The field
    // list doubles as the new node's key order, so `m_questName` reads last here even
    // though the spec ASCII draws `Quest:` before `Entry:` — the saved shape wins.
    fields: [
      {
        key: 'm_entryName',
        kind: 'text',
        label: fieldLabel('m_entryName'),
        help: 'Quest registry entry name (the corpus uses "Complete")',
        defaultValue: '',
      },
      {
        key: 'm_displayName',
        kind: 'text',
        label: fieldLabel('m_displayName'),
        help: 'Corpus-only key the domain reference omits; null in all 40 measured nodes',
        defaultValue: null,
      },
      {
        key: 'm_isQuestRegistry',
        kind: 'boolean',
        label: fieldLabel('m_isQuestRegistry'),
        help: 'Corpus-only key the domain reference omits; true in 39 of the 40 measured nodes',
        defaultValue: true,
      },
      {
        key: 'm_questName',
        kind: 'quest',
        label: fieldLabel('m_questName'),
        help: 'Quest whose registry the entry belongs to',
        defaultValue: '',
      },
    ],
  },
  {
    shortName: 'ReqSchoolOfFocus',
    label: termText({ type: 'ReqSchoolOfFocus' }),
    $type: REQUIREMENT_TYPES.ReqSchoolOfFocus,
    baseFieldsFirst: false,
    fields: [
      {
        key: 'm_magicSchool',
        kind: 'enum',
        label: fieldLabel('m_magicSchool'),
        help: "The player's own magic school",
        options: MAGIC_SCHOOLS,
        defaultValue: '',
      },
    ],
  },
  {
    shortName: 'ReqIsSchool',
    label: termText({ type: 'ReqIsSchool' }),
    $type: REQUIREMENT_TYPES.ReqIsSchool,
    baseFieldsFirst: false,
    fields: [
      {
        key: 'm_magicSchoolName',
        kind: 'enum',
        label: fieldLabel('m_magicSchoolName'),
        help: 'School the target entity must be (spec-only type: 0 occurrences in quests)',
        options: MAGIC_SCHOOLS,
        defaultValue: '',
      },
      {
        key: 'm_targetType',
        kind: 'enum',
        label: fieldLabel('m_targetType'),
        help: 'Entity the school check applies to',
        options: ['RT_Caster'],
        defaultValue: '',
      },
    ],
  },
];

/* ------------------------------------------------------------ read helpers */

/** `true` for a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The spec for a short type name, or `undefined`. */
export function requirementTypeSpecByName(name: string): RequirementTypeSpec | undefined {
  return REQUIREMENT_TYPE_SPECS.find((spec) => spec.shortName === name);
}

/** The spec for an assembly-qualified `$type`, or `undefined` (an unknown string is unknown). */
export function requirementTypeSpecForTypeString(
  typeString: unknown,
): RequirementTypeSpec | undefined {
  if (typeof typeString !== 'string') {
    return undefined;
  }
  return REQUIREMENT_TYPE_SPECS.find((spec) => spec.$type === typeString);
}

/**
 * `true` when {@link value} is a **group** (a `RequirementList`).
 *
 * The rule is the corpus's own shape, tolerant of both spellings: a node that carries the
 * `m_requirements` key is a group (this is what identifies the 7 **untyped** wrappers),
 * and so is a node whose `$type` is the `RequirementList` literal even if its child key is
 * missing. Everything else is a leaf.
 */
export function requirementNodeIsGroup(value: unknown): boolean {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    Object.prototype.hasOwnProperty.call(value, REQUIREMENT_CHILDREN_KEY) ||
    value.$type === REQUIREMENT_LIST_TYPE
  );
}

/** A group's children, or `[]` when the value is not an object or the key is not an array. */
export function requirementGroupChildren(value: unknown): readonly unknown[] {
  if (!isPlainObject(value)) {
    return [];
  }
  const children = value[REQUIREMENT_CHILDREN_KEY];
  return Array.isArray(children) ? children : [];
}

/** `node[key]` — `undefined` for a non-object node. */
export function requirementField(value: unknown, key: string): unknown {
  return isPlainObject(value) ? value[key] : undefined;
}

/** `true` when the node carries its own `m_applyNOT` key (absent ≠ `false`). */
export function requirementHasApplyNOT(value: unknown): boolean {
  return isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, 'm_applyNOT');
}

/** The node's `m_applyNOT` as a checkbox reads it: only an explicit `true` is checked. */
export function requirementApplyNOT(value: unknown): boolean {
  return requirementField(value, 'm_applyNOT') === true;
}

/** `true` when the node carries its own `m_operator` key. */
export function requirementHasOperator(value: unknown): boolean {
  return isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, 'm_operator');
}

/**
 * The node's `m_operator`, or `null` when it is absent, `null` or a value outside the
 * enum. Strict on purpose: the strict read is what makes "the key stayed absent" and "the
 * key stayed `ROP_OR`" distinguishable.
 */
export function requirementOperator(value: unknown): RequirementOperator | null {
  const operator = requirementField(value, 'm_operator');
  return REQUIREMENT_OPERATORS.includes(operator as RequirementOperator)
    ? (operator as RequirementOperator)
    : null;
}

/**
 * The operator the UI *shows*: the strict read, or `ROP_AND` when the node has none.
 * A display default only — the editor writes nothing until the user acts, so a node
 * without `m_operator` keeps not having it (D57), and the toggle simply reads as AND.
 */
export function requirementEffectiveOperator(value: unknown): RequirementOperator {
  return requirementOperator(value) ?? 'ROP_AND';
}

/** One node of the render-only tree view. */
export interface RequirementNodeView {
  /** The node's absolute document path. */
  path: DocPath;
  /**
   * The node's **address** for display and accessible names: the slot's own path
   * (`m_requirements`, `m_goals[0].m_goalRequirements`) plus one `[index]` per level down
   * (`m_requirements[1][0]`). It is unique within a slot and stable across edits, which is
   * what makes every control's name unambiguous — and it is *not* the document path (that
   * would repeat the `m_requirements` child key at every level).
   */
  address: string;
  kind: 'group' | 'leaf';
  /**
   * The node's own value in the document. Held for raw display only — the view is never
   * written back (module header, "the write rule").
   */
  value: unknown;
  /** `false` when the value is not a plain object (the card shows it verbatim). */
  readable: boolean;
  /** The card's title: a leaf's class label, or {@link GROUP_LABEL}. */
  title: string;
  /** Leaf: the class spec, or `null` for an unknown/absent `$type`. */
  spec: RequirementTypeSpec | null;
  /** Leaf: the raw `$type` string exactly as the document carries it. */
  typeString: string | null;
  /** Strict `m_operator` read (see {@link requirementOperator}). */
  operator: RequirementOperator | null;
  hasOperator: boolean;
  /** Only an explicit `true` (see {@link requirementApplyNOT}). */
  applyNOT: boolean;
  hasApplyNOT: boolean;
  /** Group: its children; leaf: `[]`. */
  children: readonly RequirementNodeView[];
}

/**
 * The tree view of an existing wrapper value, or `null` when the slot holds no object
 * (absent, `null`, or a wrongly-typed value) — the caller's empty state.
 *
 * Children that are not objects are **kept** in the view ({@link RequirementNodeView.readable}
 * is `false`) so nothing in the document is hidden by the renderer.
 */
export function readRequirementTree(path: DocPath, value: unknown): RequirementNodeView | null {
  return isPlainObject(value) ? readNode(path, formatDocPath(path), value) : null;
}

/** One node — objects and non-objects alike, so a raw child stays visible. */
function readNode(path: DocPath, address: string, value: unknown): RequirementNodeView {
  const readable = isPlainObject(value);
  const group = readable && requirementNodeIsGroup(value);
  const typeString = readable && typeof value.$type === 'string' ? value.$type : null;
  if (group) {
    const children = requirementGroupChildren(value).map((child, index) =>
      readNode(requirementChildPath(path, index), `${address}[${index}]`, child),
    );
    return {
      path,
      address,
      kind: 'group',
      value,
      readable,
      title: GROUP_LABEL,
      spec: null,
      typeString,
      operator: requirementOperator(value),
      hasOperator: requirementHasOperator(value),
      applyNOT: requirementApplyNOT(value),
      hasApplyNOT: requirementHasApplyNOT(value),
      children,
    };
  }
  const spec = requirementTypeSpecForTypeString(typeString);
  return {
    path,
    address,
    kind: 'leaf',
    value,
    readable,
    title: spec?.label ?? requirementUnknownTitle(typeString),
    spec: spec ?? null,
    typeString,
    operator: requirementOperator(value),
    hasOperator: requirementHasOperator(value),
    applyNOT: requirementApplyNOT(value),
    hasApplyNOT: requirementHasApplyNOT(value),
    children: [],
  };
}

/**
 * A leaf's title when no spec matches: the `$type`'s short spelling — the constant table
 * first, then the same lenient split the read-only panels use (`lib/extract.ts`), so a
 * `$type` this tool has never heard of still names itself instead of showing a
 * namespace-qualified string or nothing — or {@link UNREADABLE_NODE_TEXT}.
 */
function requirementUnknownTitle(typeString: string | null): string {
  if (typeString === null || typeString === '') {
    return UNREADABLE_NODE_TEXT;
  }
  return termText({
    type: shortTypeName(typeString) ?? lenientShortTypeName(typeString) ?? typeString,
  });
}

/* ------------------------------------------------------------ select options */

/** The select's value for a document value: the string itself, `''` otherwise. */
export function requirementSelectValue(current: unknown): string {
  return typeof current === 'string' ? current : '';
}

/** One `<option>` of a requirement select. */
export interface RequirementSelectOption {
  value: string;
  label: string;
  /** `true` for the document's own value when the listed values do not include it. */
  unlisted: boolean;
}

/**
 * The options a requirement select offers, mirroring `goalSelectOptions`: the listed
 * values, plus (a) a leading unset option when the document has no usable value, or (b)
 * the document's own value appended when the list has never heard of it. Real content is
 * never silently snapped to a listed option, and the select's value is always the
 * document's own ({@link requirementSelectValue}).
 */
export function requirementSelectOptions(
  current: unknown,
  listed: readonly string[],
): RequirementSelectOption[] {
  const options: RequirementSelectOption[] = listed.map((value) => ({
    value,
    label: value,
    unlisted: false,
  }));
  const raw = requirementSelectValue(current);
  if (raw === '') {
    return [{ value: '', label: REQUIREMENT_SELECT_UNSET_LABEL, unlisted: false }, ...options];
  }
  if (!listed.includes(raw)) {
    return [...options, { value: raw, label: raw, unlisted: true }];
  }
  return options;
}

/**
 * The type selector's value: the matching class's short name, or `''` when the node's
 * `$type` is absent or is not one of the 4.
 */
export function requirementTypeSelectValue(value: unknown): string {
  return requirementTypeSpecForTypeString(requirementField(value, '$type'))?.shortName ?? '';
}

/**
 * The 4 allowed classes, plus a leading `—` when the node's `$type` matches none of them
 * (an absent or unknown `$type` shows as unset rather than silently reading as one of the
 * four). The option values are the short names, which is what
 * {@link changeLeafTypeEdits} accepts.
 */
export function requirementTypeSelectOptions(value: unknown): RequirementSelectOption[] {
  const options: RequirementSelectOption[] = REQUIREMENT_TYPE_SPECS.map((spec) => ({
    value: spec.shortName,
    label: spec.label,
    unlisted: false,
  }));
  if (requirementTypeSelectValue(value) === '') {
    return [{ value: '', label: REQUIREMENT_SELECT_UNSET_LABEL, unlisted: false }, ...options];
  }
  return options;
}

/** A group's border class for a node — {@link requirementEffectiveOperator} when unset. */
export function requirementGroupBorderClass(value: unknown): string {
  return REQUIREMENT_GROUP_BORDER_CLASSES[requirementEffectiveOperator(value)];
}

/* ---------------------------------------------------------- new nodes */

/**
 * A brand-new leaf of {@link type} in a **canonical new-node order**: `$type` first, then
 * the class's fields and the two base flags in the corpus's own order for that class
 * ({@link RequirementTypeSpec.baseFieldsFirst}), each field at its
 * {@link RequirementFieldSpec.defaultValue}.
 *
 * This order is asserted for new nodes only. An *existing* node is never rebuilt from it:
 * every other builder here writes single keys, so a corpus node keeps its own order
 * byte-for-byte (module header).
 */
export function newRequirementLeaf(type: RequirementShortTypeName): Record<string, unknown> {
  const spec = requirementTypeSpecByName(type);
  if (spec === undefined) {
    throw new Error(`unknown requirement type "${type}"`);
  }
  const node: Record<string, unknown> = { $type: spec.$type };
  const base = { m_applyNOT: false, m_operator: 'ROP_AND' as RequirementOperator };
  if (spec.baseFieldsFirst) {
    Object.assign(node, base);
  }
  for (const field of spec.fields) {
    node[field.key] = field.defaultValue;
  }
  if (!spec.baseFieldsFirst) {
    Object.assign(node, base);
  }
  return node;
}

/**
 * A brand-new group in the corpus's dominant wrapper order
 * (`$type, m_applyNOT, m_operator, m_requirements`) around {@link children}.
 *
 * A new group gets a **`$type`**: 307 of the 314 corpus wrappers carry the
 * `RequirementList` literal. The 7 untyped wrappers are existing corpus values and this
 * builder never touches them — nothing here rewrites a wrapper's keys (D57).
 */
export function newRequirementGroup(children: readonly unknown[]): Record<string, unknown> {
  return {
    $type: REQUIREMENT_LIST_TYPE,
    m_applyNOT: false,
    m_operator: 'ROP_AND' as RequirementOperator,
    m_requirements: [...children],
  };
}

/* --------------------------------------------------------- edit builders */

/**
 * Adding a condition to the group at {@link nodePath}: one `insert` at the end of (or at
 * {@link index} in) its `m_requirements` array. The new leaf is
 * {@link newRequirementLeaf} — a **new** node, so it gets the canonical order; the group
 * it lands in is untouched.
 */
export function addConditionEdits(
  nodePath: DocPath,
  index: number,
  type: RequirementShortTypeName = DEFAULT_REQUIREMENT_TYPE,
): DocEdit[] {
  return [
    {
      op: 'insert',
      path: requirementChildrenPath(nodePath),
      index,
      value: newRequirementLeaf(type),
    },
  ];
}

/**
 * Adding a nested group at {@link index}: one `insert` of a canonical wrapper holding one
 * default condition. It starts with a child rather than an empty `m_requirements` because
 * the corpus never carries an empty list (child counts measured: 1 → 312, 2 → 1, 3 → 1),
 * so "new group" should not invent a shape the corpus has never had.
 */
export function addGroupEdits(nodePath: DocPath, index: number): DocEdit[] {
  return [
    {
      op: 'insert',
      path: requirementChildrenPath(nodePath),
      index,
      value: newRequirementGroup([newRequirementLeaf(DEFAULT_REQUIREMENT_TYPE)]),
    },
  ];
}

/**
 * The first write into a slot that holds no wrapper (absent or `null`): one `set` that
 * creates the whole tree. Only called because the user asked for it — merely opening the
 * tab writes nothing (D57), and `m_prepRequirements` therefore stays `null` until then.
 */
export function initializeTreeEdits(slotPath: DocPath, kind: 'condition' | 'group'): DocEdit[] {
  const leaf = newRequirementLeaf(DEFAULT_REQUIREMENT_TYPE);
  return [
    {
      op: 'set',
      path: slotPath,
      value: newRequirementGroup([kind === 'group' ? newRequirementGroup([leaf]) : leaf]),
    },
  ];
}

/**
 * Deleting the node at {@link nodePath}: one `delete` of exactly that array element.
 *
 * Deliberately **not** cascading and **not** collapsing: deleting a group's last child
 * leaves `m_requirements: []` (the empty list is not normalised away), and deleting a
 * group takes its subtree with it because the element is gone. Because a delete shifts the
 * later indices of its own array, the caller applies it on its own rather than batched
 * with another index-addressed edit of the same list.
 */
export function deleteNodeEdits(nodePath: DocPath): DocEdit[] {
  return [{ op: 'delete', path: nodePath }];
}

/**
 * Changing a leaf's class: one `set` at {@link nodePath} with the new class's canonical
 * object (its `$type`, its fields at their defaults, the two base flags).
 *
 * **A replacement, not a merge** — stated because it is the one place an existing node is
 * rebuilt. The old object's keys belong to the old class (`m_magicSchool` means nothing on
 * a `ReqHasQuest`), so carrying them over would either keep foreign keys or silently drop
 * them; merging two classes' field sets is the normalisation D57 forbids. The old class's
 * fields, and any unmodelled key on the node, are therefore gone — which is what "the user
 * changed the type of this condition" means.
 */
export function changeLeafTypeEdits(nodePath: DocPath, type: RequirementShortTypeName): DocEdit[] {
  return [{ op: 'set', path: nodePath, value: newRequirementLeaf(type) }];
}

/**
 * The edit a text-like control (text input, enum select, quest dropdown) produces on
 * {@link key} of the leaf at {@link nodePath}. Emptying the control deletes the key when
 * it exists and produces **no** edit when it does not (the p3-03/p3-04 rule, D59(c)) — so
 * clearing an already-absent field can never create one, and an enum whose "unset" option
 * is chosen deletes rather than writing `''` into an enum-typed field.
 */
export function setLeafFieldEdit(
  nodePath: DocPath,
  key: string,
  present: boolean,
  raw: string,
): DocEdit | null {
  if (raw === '') {
    return present ? { op: 'delete', path: [...nodePath, key] } : null;
  }
  return { op: 'set', path: [...nodePath, key], value: raw };
}

/**
 * The edit a checkbox produces on a boolean field of the leaf at {@link nodePath}. A
 * checkbox can only express `true`/`false` and the caller invokes this only when the user
 * toggles it — an absent or `null` value renders unchecked and stays untouched until then.
 */
export function setBooleanFieldEdit(nodePath: DocPath, key: string, checked: boolean): DocEdit {
  return { op: 'set', path: [...nodePath, key], value: checked };
}

/**
 * The edit the `m_applyNOT` checkbox produces: the negation of the strict read, so an
 * absent or `null` value becomes `true` on the first toggle (that is the requested write)
 * and an explicit `true` becomes `false`.
 */
export function toggleApplyNOTEdit(nodePath: DocPath, current: unknown): DocEdit {
  return { op: 'set', path: [...nodePath, 'm_applyNOT'], value: !requirementApplyNOT(current) };
}

/** The edit an operator control produces on the node at {@link nodePath}. */
export function setOperatorEdit(nodePath: DocPath, operator: RequirementOperator): DocEdit {
  return { op: 'set', path: [...nodePath, 'm_operator'], value: operator };
}
