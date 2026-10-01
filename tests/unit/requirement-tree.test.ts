import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import JSON5 from 'json5';
import { describe, expect, it } from 'vitest';

import {
  applyEdits,
  getAtPath,
  hasAtPath,
  loadDoc,
  serializeDoc,
  type DocEdit,
  type DocPath,
  type JsonDocument,
} from '@shared/document';
import { MAGIC_SCHOOLS, TYPE_STRINGS } from '@shared/quest/typeConstants';
import { DEFAULT_SPIRALDB_PATH } from '@server/db';

import {
  addConditionEdits,
  addGroupEdits,
  changeLeafTypeEdits,
  deleteNodeEdits,
  initializeTreeEdits,
  newRequirementGroup,
  newRequirementLeaf,
  PREP_REQUIREMENTS_PATH,
  readRequirementTree,
  requirementApplyNOT,
  requirementChildrenPath,
  requirementChildPath,
  requirementEffectiveOperator,
  requirementGroupBorderClass,
  requirementGroupChildren,
  requirementNodeIsGroup,
  requirementOperator,
  requirementGroupChildren as childrenOfGroup,
  requirementSelectOptions,
  requirementTypeSelectOptions,
  requirementTypeSelectValue,
  requirementTypeSpecByName,
  requirementTypeSpecForTypeString,
  REQUIREMENTS_PATH,
  REQUIREMENT_GROUP_BORDER_CLASSES,
  REQUIREMENT_LEAF_BORDER_CLASS,
  REQUIREMENT_TYPE_SPECS,
  setBooleanFieldEdit,
  setLeafFieldEdit,
  setOperatorEdit,
  toggleApplyNOTEdit,
  type RequirementNodeView,
} from '../../client/src/lib/requirement-tree';

/**
 * The Requirements tree's pure rules (plan task 3.6 / story p3-06).
 *
 * Everything asserted here is a rule a browser cannot state more clearly: the 4-class
 * table keyed to the corpus `$type` strings, the read helpers' treatment of the corpus's
 * own oddities (an **untyped** wrapper, the two `ReqHasEntry` keys the spec omits, a
 * group's absent operator), and the edit builders applied to real documents through
 * `applyEdits` so the assertions are about documents, not about intermediate objects.
 *
 * **Fixture-only, three times over.** The `AND(ReqHasQuest{NOT}, OR(ReqSchoolOfFocus,
 * ReqHasEntry))` tree of the last block exists in no corpus file: `ROP_OR` never occurs
 * (631/631 measured nodes are `ROP_AND`), the corpus never nests a group inside a group
 * (depths 0 and 1 only), and those two leaf classes never share a tree with a quest's own
 * requirements (`ReqSchoolOfFocus` lives in DropTable items and result objects). The
 * expectation below is hand-written — the `$type` strings are spelled out in full rather
 * than imported, so the test cannot prove the model agrees with itself.
 */

/* ------------------------------------------------------------- fixtures */

const RL = 'Imcodec.ObjectProperty.TypeCache.RequirementList, Imcodec.ObjectProperty';
const RHQ = 'Imcodec.ObjectProperty.TypeCache.ReqHasQuest, Imcodec.ObjectProperty';
const RHE = 'Imcodec.ObjectProperty.TypeCache.ReqHasEntry, Imcodec.ObjectProperty';
const RSOF = 'Imcodec.ObjectProperty.TypeCache.ReqSchoolOfFocus, Imcodec.ObjectProperty';
const RIS = 'Imcodec.ObjectProperty.TypeCache.ReqIsSchool, Imcodec.ObjectProperty';

/**
 * A requirement wrapper fixture: the keys the cases address, plus anything else. The
 * children array is typed so a case can read `m_requirements[0]` without a cast.
 */
interface WrapperFixture {
  $type?: string;
  m_requirements?: unknown[];
  m_applyNOT?: unknown;
  m_operator?: unknown;
  [key: string]: unknown;
}

/**
 * The corpus's dominant wrapper order — `$type, m_applyNOT, m_operator, m_requirements`
 * (277×) — around one `ReqHasQuest`.
 */
const CORPUS_TYPED_WRAPPER: WrapperFixture = {
  $type: RL,
  m_applyNOT: false,
  m_operator: 'ROP_AND',
  m_requirements: [
    {
      $type: RHQ,
      m_applyNOT: false,
      m_operator: 'ROP_AND',
      m_questName: 'WC-TRITON-MAIN-009',
    },
  ],
};

/**
 * One of the 7 **untyped** wrappers (`WC-UNICORN-MAIN-001/002/003`), which is also the
 * DropTable item shape (`droptables_wc-firecat-main-006.json`): key order
 * `m_requirements, m_applyNOT, m_operator`, no `$type`. Editing anything must not add one.
 */
const CORPUS_UNTYPED_WRAPPER: WrapperFixture = {
  m_requirements: [
    { $type: RSOF, m_magicSchool: 'Balance', m_applyNOT: false, m_operator: 'ROP_AND' },
  ],
  m_applyNOT: false,
  m_operator: 'ROP_AND',
};

/**
 * The wrapper order `$type, m_requirements, m_applyNOT, m_operator` (30 corpus wrappers,
 * e.g. `WC-OLDE-MAIN-003A`) holding the `ReqHasEntry` order measured 40/40, including a
 * key the model has never heard of.
 */
const CORPUS_ENTRY_WRAPPER: WrapperFixture = {
  $type: RL,
  m_requirements: [
    {
      $type: RHE,
      m_entryName: 'Complete',
      m_displayName: null,
      m_isQuestRegistry: true,
      m_questName: 'WC-CYCLOPS-MAIN-005',
      m_applyNOT: false,
      m_operator: 'ROP_AND',
      m_unmodelledLegacyKey: 'keep me',
    },
  ],
  m_applyNOT: false,
  m_operator: 'ROP_AND',
};

/** A minimal quest document whose two requirement slots are the corpus's `null`. */
function emptyQuest(): JsonDocument {
  return {
    m_questName: 'DS-ACAD1-C01-001',
    m_requirements: null,
    m_prepRequirements: null,
  };
}

/** Applies the builders' edits and hands back the resulting document. */
function apply(doc: JsonDocument, edits: readonly DocEdit[]): JsonDocument {
  return applyEdits(doc, edits);
}

/** `doc[key]` for the fixture documents above. */
function slot(doc: JsonDocument, key: string): unknown {
  return (doc as Record<string, unknown>)[key];
}

/** The result of a nullable edit, asserted to exist so a case states its own intent. */
function must(edit: DocEdit | null): DocEdit {
  if (edit === null) {
    throw new Error('expected an edit, received null (no-op)');
  }
  return edit;
}

/** The key order of a node — the property a deep-equality assertion cannot see. */
function keysOf(value: unknown): string[] {
  return Object.keys(value as Record<string, unknown>);
}

/* --------------------------------------------------------- the 4 types */

describe('the 4 allowed requirement classes', () => {
  it('is exactly the 4 measured classes, in table order', () => {
    expect(REQUIREMENT_TYPE_SPECS.map((spec) => spec.shortName)).toEqual([
      'ReqHasQuest',
      'ReqHasEntry',
      'ReqSchoolOfFocus',
      'ReqIsSchool',
    ]);
    // `ReqHasGoal` and `ReqEntryValue` (spec-domain-reference.md §"Requirement Types — Complete Enumeration") are absent, not
    // merely unused: nothing in the table names them.
    const names = REQUIREMENT_TYPE_SPECS.flatMap((spec) => [
      spec.shortName,
      spec.label,
      spec.$type,
    ]);
    expect(names.some((name) => name.includes('ReqHasGoal'))).toBe(false);
    expect(names.some((name) => name.includes('ReqEntryValue'))).toBe(false);
  });

  it('takes every literal verbatim from the constant table', () => {
    expect(REQUIREMENT_TYPE_SPECS.map((spec) => spec.$type)).toEqual([
      TYPE_STRINGS.ReqHasQuest,
      TYPE_STRINGS.ReqHasEntry,
      TYPE_STRINGS.ReqSchoolOfFocus,
      TYPE_STRINGS.ReqIsSchool,
    ]);
    expect(requirementTypeSpecForTypeString(RHE)?.shortName).toBe('ReqHasEntry');
    expect(
      requirementTypeSpecForTypeString(
        'Imcodec.ObjectProperty.TypeCache.ReqHasGoal, Imcodec.ObjectProperty',
      ),
    ).toBeUndefined();
    expect(requirementTypeSpecForTypeString(undefined)).toBeUndefined();
  });

  it('models the two ReqHasEntry keys the spec omits, in the corpus order', () => {
    const entry = requirementTypeSpecByName('ReqHasEntry');
    expect(entry?.fields.map((field) => field.key)).toEqual([
      'm_entryName',
      'm_displayName',
      'm_isQuestRegistry',
      'm_questName',
    ]);
    expect(entry?.fields.find((field) => field.key === 'm_isQuestRegistry')?.kind).toBe('boolean');
    expect(entry?.fields.find((field) => field.key === 'm_displayName')?.defaultValue).toBeNull();
    expect(entry?.fields.find((field) => field.key === 'm_isQuestRegistry')?.defaultValue).toBe(
      true,
    );
  });

  it('carries the enum options the spec names', () => {
    expect(requirementTypeSpecByName('ReqSchoolOfFocus')?.fields[0]?.options).toEqual([
      'Fire',
      'Ice',
      'Storm',
      'Balance',
      'Life',
      'Death',
      'Myth',
    ]);
    expect(requirementTypeSpecByName('ReqIsSchool')?.fields.map((field) => field.key)).toEqual([
      'm_magicSchoolName',
      'm_targetType',
    ]);
  });

  it('uses the spec left-border colours as literal class strings', () => {
    expect(REQUIREMENT_GROUP_BORDER_CLASSES).toEqual({
      ROP_AND: 'border-l-blue-500',
      ROP_OR: 'border-l-purple-500',
    });
    expect(REQUIREMENT_LEAF_BORDER_CLASS).toBe('border-l-green-500');
    expect(requirementGroupBorderClass({ m_operator: 'ROP_AND' })).toBe('border-l-blue-500');
    expect(requirementGroupBorderClass({ m_operator: 'ROP_OR' })).toBe('border-l-purple-500');
    // An absent operator displays as AND without being written (see the model header).
    expect(requirementGroupBorderClass({ m_requirements: [] })).toBe('border-l-blue-500');
  });
});

/* ------------------------------------------------------------ reading */

describe('reading a corpus value', () => {
  it('classifies a wrapper, a leaf and an untyped wrapper', () => {
    expect(requirementNodeIsGroup(CORPUS_TYPED_WRAPPER)).toBe(true);
    expect(requirementNodeIsGroup(CORPUS_UNTYPED_WRAPPER)).toBe(true);
    expect(requirementNodeIsGroup(CORPUS_TYPED_WRAPPER.m_requirements?.[0])).toBe(false);
    expect(requirementNodeIsGroup(null)).toBe(false);
    expect(requirementNodeIsGroup('not a node')).toBe(false);
  });

  it('returns null for a slot that holds no object, and keeps a raw child visible', () => {
    expect(readRequirementTree([REQUIREMENTS_PATH], null)).toBeNull();
    expect(readRequirementTree([REQUIREMENTS_PATH], undefined)).toBeNull();
    expect(readRequirementTree([REQUIREMENTS_PATH], 'nonsense')).toBeNull();

    const raw = readRequirementTree([REQUIREMENTS_PATH], {
      m_requirements: ['not a node'],
      m_applyNOT: false,
      m_operator: 'ROP_AND',
    });
    expect(raw?.children).toHaveLength(1);
    expect(raw?.children[0]?.readable).toBe(false);
    expect(raw?.children[0]?.value).toBe('not a node');
    expect(raw?.children[0]?.spec).toBeNull();
  });

  it('addresses children as paths under the wrapper slot', () => {
    expect(requirementChildrenPath(['m_requirements'])).toEqual([
      'm_requirements',
      'm_requirements',
    ]);
    expect(requirementChildPath(['m_requirements'], 1)).toEqual([
      'm_requirements',
      'm_requirements',
      1,
    ]);
    // The same builders serve a DropTable item (Phase 4) and a goal.
    expect(requirementChildPath(['Items', 3, 'Requirements'], 0)).toEqual([
      'Items',
      3,
      'Requirements',
      'm_requirements',
      0,
    ]);

    const tree = readRequirementTree(['Items', 3, 'Requirements'], CORPUS_UNTYPED_WRAPPER);
    expect(tree?.path).toEqual(['Items', 3, 'Requirements']);
    expect(tree?.address).toBe('Items[3].Requirements');
    expect(tree?.kind).toBe('group');
    expect(tree?.title).toBe('Group');
    expect(tree?.children[0]?.path).toEqual(['Items', 3, 'Requirements', 'm_requirements', 0]);
    // The address is the slot path plus one index per level — never the repeated child key.
    expect(tree?.children[0]?.address).toBe('Items[3].Requirements[0]');
    expect(tree?.children[0]?.title).toBe('Requires school of focus (ReqSchoolOfFocus)');
  });

  it('names an unknown $type by its own spelling instead of dropping it', () => {
    const tree = readRequirementTree([REQUIREMENTS_PATH], {
      $type: 'Imcodec.ObjectProperty.TypeCache.ReqHasGoal, Imcodec.ObjectProperty',
      m_applyNOT: false,
      m_operator: 'ROP_AND',
    });
    expect(tree?.spec).toBeNull();
    expect(tree?.title).toBe('ReqHasGoal');
    expect(tree?.children).toEqual([]);
  });

  it('reads the flags strictly: absent ≠ false, and an out-of-enum operator is null', () => {
    expect(requirementOperator({ m_operator: 'ROP_OR' })).toBe('ROP_OR');
    expect(requirementOperator({ m_operator: null })).toBeNull();
    expect(requirementOperator({})).toBeNull();
    expect(requirementOperator({ m_operator: 'ROP_XOR' })).toBeNull();
    expect(requirementEffectiveOperator({})).toBe('ROP_AND');
    expect(requirementApplyNOT({ m_applyNOT: true })).toBe(true);
    expect(requirementApplyNOT({ m_applyNOT: null })).toBe(false);
    expect(requirementApplyNOT({})).toBe(false);

    const tree = readRequirementTree([REQUIREMENTS_PATH], {
      m_requirements: [],
      m_operator: 'ROP_OR',
    });
    expect(tree?.operator).toBe('ROP_OR');
    expect(tree?.hasOperator).toBe(true);
    expect(tree?.hasApplyNOT).toBe(false);
    expect(tree?.applyNOT).toBe(false);
    expect(requirementGroupChildren({ m_requirements: null })).toEqual([]);
  });
});

/* --------------------------------------------------------- new nodes */

describe('new nodes get a canonical order, existing ones keep theirs', () => {
  it('spells each class the way the corpus spells it', () => {
    expect(keysOf(newRequirementLeaf('ReqHasQuest'))).toEqual([
      '$type',
      'm_applyNOT',
      'm_operator',
      'm_questName',
    ]);
    expect(keysOf(newRequirementLeaf('ReqHasEntry'))).toEqual([
      '$type',
      'm_entryName',
      'm_displayName',
      'm_isQuestRegistry',
      'm_questName',
      'm_applyNOT',
      'm_operator',
    ]);
    expect(keysOf(newRequirementLeaf('ReqSchoolOfFocus'))).toEqual([
      '$type',
      'm_magicSchool',
      'm_applyNOT',
      'm_operator',
    ]);
    expect(keysOf(newRequirementLeaf('ReqIsSchool'))).toEqual([
      '$type',
      'm_magicSchoolName',
      'm_targetType',
      'm_applyNOT',
      'm_operator',
    ]);
  });

  it('writes the corpus default for each new field', () => {
    expect(newRequirementLeaf('ReqHasQuest')).toEqual({
      $type: RHQ,
      m_applyNOT: false,
      m_operator: 'ROP_AND',
      m_questName: '',
    });
    expect(newRequirementLeaf('ReqHasEntry')).toEqual({
      $type: RHE,
      m_entryName: '',
      m_displayName: null,
      m_isQuestRegistry: true,
      m_questName: '',
      m_applyNOT: false,
      m_operator: 'ROP_AND',
    });
    expect(newRequirementGroup([newRequirementLeaf('ReqHasQuest')])).toEqual({
      $type: RL,
      m_applyNOT: false,
      m_operator: 'ROP_AND',
      m_requirements: [newRequirementLeaf('ReqHasQuest')],
    });
    expect(newRequirementLeaf('ReqIsSchool')['$type']).toBe(RIS);
  });

  it('inserts a condition and a group without touching the wrapper it lands in', () => {
    const doc: JsonDocument = { m_requirements: CORPUS_TYPED_WRAPPER };
    const added = apply(doc, addConditionEdits([REQUIREMENTS_PATH], 1, 'ReqHasEntry'));
    const children = requirementGroupChildren(slot(added, 'm_requirements'));
    expect(children).toHaveLength(2);
    expect(children[1]).toEqual(newRequirementLeaf('ReqHasEntry'));
    // The wrapper's own keys and order are untouched (it is not rebuilt).
    expect(keysOf(slot(added, 'm_requirements'))).toEqual([
      '$type',
      'm_applyNOT',
      'm_operator',
      'm_requirements',
    ]);

    const grouped = apply(doc, addGroupEdits([REQUIREMENTS_PATH], 1));
    const after = slot(grouped, 'm_requirements') as Record<string, unknown>;
    expect((after.m_requirements as unknown[])[1]).toEqual(
      newRequirementGroup([newRequirementLeaf('ReqHasQuest')]),
    );
    // The source object is never written to (D58's "keep the parsed original").
    expect(requirementGroupChildren(CORPUS_TYPED_WRAPPER)).toHaveLength(1);
  });

  it('creates the wrapper only when the user acts, and only in the requested shape', () => {
    const before = emptyQuest();
    expect(slot(before, REQUIREMENTS_PATH)).toBeNull();

    const condition = apply(before, initializeTreeEdits([REQUIREMENTS_PATH], 'condition'));
    expect(slot(condition, REQUIREMENTS_PATH)).toEqual({
      $type: RL,
      m_applyNOT: false,
      m_operator: 'ROP_AND',
      m_requirements: [newRequirementLeaf('ReqHasQuest')],
    });
    // The other slot, and the rest of the document, are untouched.
    expect(slot(condition, PREP_REQUIREMENTS_PATH)).toBeNull();
    expect(slot(condition, 'm_questName')).toBe('DS-ACAD1-C01-001');

    const group = apply(before, initializeTreeEdits([REQUIREMENTS_PATH], 'group'));
    expect(slot(group, REQUIREMENTS_PATH)).toEqual(
      newRequirementGroup([newRequirementGroup([newRequirementLeaf('ReqHasQuest')])]),
    );
  });
});

/* -------------------------------------------------- preservation rules */

describe('validate, never normalise (D57)', () => {
  it('never adds a $type to an untyped wrapper, and keeps its key order', () => {
    const doc: JsonDocument = { m_requirements: CORPUS_UNTYPED_WRAPPER };
    const edited = apply(doc, [
      ...addConditionEdits([REQUIREMENTS_PATH], 1, 'ReqIsSchool'),
      toggleApplyNOTEdit(
        [REQUIREMENTS_PATH, 'm_requirements', 0],
        CORPUS_UNTYPED_WRAPPER.m_requirements?.[0],
      ),
    ]);
    const wrapper = slot(edited, 'm_requirements') as Record<string, unknown>;
    expect(hasAtPath(wrapper, ['$type'])).toBe(false);
    expect(keysOf(wrapper)).toEqual(['m_requirements', 'm_applyNOT', 'm_operator']);
    expect(requirementGroupChildren(wrapper)).toHaveLength(2);
    // The edited leaf was a corpus node: its own key order is untouched.
    expect(keysOf(requirementGroupChildren(wrapper)[0])).toEqual([
      '$type',
      'm_magicSchool',
      'm_applyNOT',
      'm_operator',
    ]);
    expect(requirementApplyNOT(requirementGroupChildren(wrapper)[0])).toBe(true);
  });

  it('keeps a node’s key order and unmodelled keys through an unrelated edit', () => {
    const doc: JsonDocument = { m_requirements: CORPUS_ENTRY_WRAPPER };
    const path = [REQUIREMENTS_PATH, 'm_requirements', 0];
    const edited = apply(doc, [
      must(setLeafFieldEdit(path, 'm_entryName', true, 'Completed')),
      setBooleanFieldEdit(path, 'm_isQuestRegistry', false),
      toggleApplyNOTEdit(path, { m_applyNOT: false }),
      setOperatorEdit(path, 'ROP_OR'),
    ]);
    const leaf = (slot(edited, 'm_requirements') as Record<string, unknown>)
      .m_requirements as Record<string, unknown>[];
    // Byte-for-byte the corpus order, with the unmodelled key still in its own place.
    expect(keysOf(leaf[0])).toEqual([
      '$type',
      'm_entryName',
      'm_displayName',
      'm_isQuestRegistry',
      'm_questName',
      'm_applyNOT',
      'm_operator',
      'm_unmodelledLegacyKey',
    ]);
    expect(leaf[0]).toEqual({
      $type: RHE,
      m_entryName: 'Completed',
      m_displayName: null,
      m_isQuestRegistry: false,
      m_questName: 'WC-CYCLOPS-MAIN-005',
      m_applyNOT: true,
      m_operator: 'ROP_OR',
      m_unmodelledLegacyKey: 'keep me',
    });
    // The wrapper's own order (d) survives too.
    expect(keysOf(slot(edited, 'm_requirements'))).toEqual([
      '$type',
      'm_requirements',
      'm_applyNOT',
      'm_operator',
    ]);
  });

  it('deletes exactly one node, shifts the rest and does not collapse the group', () => {
    const doc: JsonDocument = {
      m_requirements: {
        ...CORPUS_TYPED_WRAPPER,
        m_requirements: [
          { $type: RHQ, m_applyNOT: false, m_operator: 'ROP_AND', m_questName: 'A' },
          { $type: RHQ, m_applyNOT: false, m_operator: 'ROP_AND', m_questName: 'B' },
          { $type: RHQ, m_applyNOT: false, m_operator: 'ROP_AND', m_questName: 'C' },
        ],
      },
    };
    const after = apply(doc, deleteNodeEdits([REQUIREMENTS_PATH, 'm_requirements', 1]));
    const wrapper = slot(after, 'm_requirements') as Record<string, unknown>;
    expect(
      requirementGroupChildren(wrapper).map(
        (node) => (node as Record<string, unknown>).m_questName,
      ),
    ).toEqual(['A', 'C']);

    const emptied = apply(
      apply(doc, deleteNodeEdits([REQUIREMENTS_PATH, 'm_requirements', 0])),
      deleteNodeEdits([REQUIREMENTS_PATH, 'm_requirements', 0]),
    );
    const twice = apply(emptied, deleteNodeEdits([REQUIREMENTS_PATH, 'm_requirements', 0]));
    expect(requirementGroupChildren(slot(twice, 'm_requirements'))).toEqual([]);
    // An emptied group keeps its wrapper and its operator: no normalisation.
    expect(keysOf(slot(twice, 'm_requirements'))).toEqual([
      '$type',
      'm_applyNOT',
      'm_operator',
      'm_requirements',
    ]);
  });

  it('a type change is a replacement in the new class’s canonical order', () => {
    const path = [REQUIREMENTS_PATH, 'm_requirements', 0];
    const doc: JsonDocument = {
      m_requirements: {
        ...CORPUS_ENTRY_WRAPPER,
        m_requirements: [CORPUS_ENTRY_WRAPPER.m_requirements?.[0]],
      },
    };
    const after = apply(doc, changeLeafTypeEdits(path, 'ReqSchoolOfFocus'));
    const leaf = requirementGroupChildren(slot(after, 'm_requirements'))[0];
    expect(leaf).toEqual(newRequirementLeaf('ReqSchoolOfFocus'));
    // The old class's fields — including the unmodelled key — are gone, on purpose.
    expect(keysOf(leaf)).toEqual(['$type', 'm_magicSchool', 'm_applyNOT', 'm_operator']);
  });

  it('an emptied field deletes its key when present and edits nothing when absent', () => {
    const path = [REQUIREMENTS_PATH, 'm_requirements', 0];
    const doc: JsonDocument = { m_requirements: CORPUS_ENTRY_WRAPPER };
    expect(setLeafFieldEdit(path, 'm_entryName', false, '')).toBeNull();
    expect(must(setLeafFieldEdit(path, 'm_entryName', true, ''))).toEqual({
      op: 'delete',
      path: [...path, 'm_entryName'],
    });
    expect(must(setLeafFieldEdit(path, 'm_entryName', true, 'Complete'))).toEqual({
      op: 'set',
      path: [...path, 'm_entryName'],
      value: 'Complete',
    });
    const after = apply(doc, [must(setLeafFieldEdit(path, 'm_entryName', true, ''))]);
    expect(hasAtPath(slot(after, 'm_requirements'), ['m_requirements', 0, 'm_entryName'])).toBe(
      false,
    );
  });

  it('toggles NOT from either unset state and back', () => {
    const path = [REQUIREMENTS_PATH, 'm_requirements', 0];
    expect(toggleApplyNOTEdit(path, { m_applyNOT: false })).toEqual({
      op: 'set',
      path: [...path, 'm_applyNOT'],
      value: true,
    });
    expect(toggleApplyNOTEdit(path, {})).toEqual({
      op: 'set',
      path: [...path, 'm_applyNOT'],
      value: true,
    });
    expect(toggleApplyNOTEdit(path, { m_applyNOT: null })).toEqual({
      op: 'set',
      path: [...path, 'm_applyNOT'],
      value: true,
    });
    expect(toggleApplyNOTEdit(path, CORPUS_UNTYPED_WRAPPER.m_requirements?.[0])).toEqual({
      op: 'set',
      path: [...path, 'm_applyNOT'],
      value: true,
    });
    expect(toggleApplyNOTEdit(path, { m_applyNOT: true })).toEqual({
      op: 'set',
      path: [...path, 'm_applyNOT'],
      value: false,
    });
  });

  it('sets the operator on a node that had none', () => {
    const path = [REQUIREMENTS_PATH, 'm_requirements', 0];
    // The inner node carries no `m_operator` at all: the key is created, not rewritten.
    const doc: JsonDocument = {
      m_requirements: {
        m_requirements: [{ m_requirements: [], m_applyNOT: false }],
        m_applyNOT: false,
        m_operator: 'ROP_AND',
      },
    };
    expect(
      requirementOperator(requirementGroupChildren(slot(doc, 'm_requirements'))[0]),
    ).toBeNull();
    const after = apply(doc, [setOperatorEdit(path, 'ROP_AND')]);
    const inner = requirementGroupChildren(slot(after, 'm_requirements'))[0] as Record<
      string,
      unknown
    >;
    expect(keysOf(inner)).toEqual(['m_requirements', 'm_applyNOT', 'm_operator']);
    expect(requirementOperator(inner)).toBe('ROP_AND');
  });
});

/* ------------------------------------------------------------ selects */

describe('the selector vocabularies', () => {
  it('offers exactly the 4 classes, with an unset option only when nothing matches', () => {
    expect(requirementTypeSelectOptions({ $type: RSOF }).map((option) => option.label)).toEqual([
      'Requires quest (ReqHasQuest)',
      'Requires quest registry entry (ReqHasEntry)',
      'Requires school of focus (ReqSchoolOfFocus)',
      'Requires target school (ReqIsSchool)',
    ]);
    expect(requirementTypeSelectValue({ $type: RSOF })).toBe('ReqSchoolOfFocus');
    expect(requirementTypeSelectValue({ $type: 'unknown' })).toBe('');
    expect(requirementTypeSelectValue({})).toBe('');

    const unset = requirementTypeSelectOptions({});
    expect(unset[0]).toEqual({ value: '', label: '—', unlisted: false });
    expect(unset).toHaveLength(5);
  });

  it('keeps an unlisted enum value instead of snapping it to a listed one', () => {
    expect(requirementSelectOptions('Fire', MAGIC_SCHOOLS).map((option) => option.value)).toEqual([
      'Fire',
      'Ice',
      'Storm',
      'Balance',
      'Life',
      'Death',
      'Myth',
    ]);
    expect(requirementSelectOptions('Fire', MAGIC_SCHOOLS)[0]).toEqual({
      value: 'Fire',
      label: 'Fire',
      unlisted: false,
    });
    expect(requirementSelectOptions('', MAGIC_SCHOOLS)).toHaveLength(8);
    expect(requirementSelectOptions('', MAGIC_SCHOOLS)[0]).toEqual({
      value: '',
      label: '—',
      unlisted: false,
    });
    expect(requirementSelectOptions('Shadow', MAGIC_SCHOOLS).at(-1)).toEqual({
      value: 'Shadow',
      label: 'Shadow',
      unlisted: true,
    });
    expect(requirementSelectOptions(null, ['A'])[0]?.value).toBe('');
    expect(requirementSelectOptions(7, ['A'])[0]?.value).toBe('');
  });
});

/* ---------------------------------------------------------- round trip */

describe('the round-trip rule', () => {
  it('reloads an edited corpus document deep-equal, key order and all', () => {
    const doc: JsonDocument = { m_questName: 'X', m_requirements: CORPUS_ENTRY_WRAPPER };
    const edited = apply(doc, [
      must(setLeafFieldEdit([REQUIREMENTS_PATH, 'm_requirements', 0], 'm_entryName', true, 'Done')),
      ...deleteNodeEdits([REQUIREMENTS_PATH, 'm_requirements', 0]),
      ...addConditionEdits([REQUIREMENTS_PATH], 0, 'ReqIsSchool'),
    ]);

    // The view before the reload, the text, and the view after it.
    const before = readRequirementTree([REQUIREMENTS_PATH], slot(edited, 'm_requirements'));
    const text = serializeDoc(edited);
    const reloaded = loadDoc(JSON.parse(text) as JsonDocument);
    const after = readRequirementTree([REQUIREMENTS_PATH], slot(reloaded, 'm_requirements'));

    expect(after).toEqual(before);
    expect(reloaded).toEqual(edited);
    // Deep equality alone cannot certify the round trip (D58e): the bytes are the check.
    expect(serializeDoc(reloaded)).toBe(text);
    expect(slot(reloaded, 'm_requirements')).toEqual({
      $type: RL,
      m_applyNOT: false,
      m_operator: 'ROP_AND',
      m_requirements: [newRequirementLeaf('ReqIsSchool')],
    });
  });

  it('leaves a null slot null through a reload', () => {
    const text = serializeDoc(emptyQuest());
    const reloaded = loadDoc(JSON.parse(text) as JsonDocument);
    expect(slot(reloaded, REQUIREMENTS_PATH)).toBeNull();
    expect(slot(reloaded, PREP_REQUIREMENTS_PATH)).toBeNull();
    expect(
      readRequirementTree([PREP_REQUIREMENTS_PATH], slot(reloaded, PREP_REQUIREMENTS_PATH)),
    ).toBeNull();
    expect(text).toContain('"m_requirements": null');
  });
});

/* ------------------------------------------- AC1 shape (fixture-only) */

/**
 * The hand-written expectation for `AND(ReqHasQuest{NOT}, OR(ReqSchoolOfFocus,
 * ReqHasEntry))`, in the corpus's polymorphic shape: `$type` first on every node, the
 * canonical new-node order for each class, `m_applyNOT`/`m_operator` on every node.
 *
 * This tree is **fixture-only**: the corpus has no `ROP_OR` node (631/631 are `ROP_AND`),
 * never nests a group in a group (depths 0 and 1 only), and never mixes `ReqSchoolOfFocus`
 * or `ReqHasEntry` into a quest's own `m_requirements` tree with a `ReqHasQuest` (the two
 * school classes live in DropTable items and result objects). No corpus file carries it.
 */
const AC1_EXPECTED = {
  $type: RL,
  m_applyNOT: false,
  m_operator: 'ROP_AND',
  m_requirements: [
    {
      $type: RHQ,
      m_applyNOT: true,
      m_operator: 'ROP_AND',
      m_questName: 'DS-ACAD1-C01-002',
    },
    {
      $type: RL,
      m_applyNOT: false,
      m_operator: 'ROP_OR',
      m_requirements: [
        {
          $type: RSOF,
          m_magicSchool: 'Fire',
          m_applyNOT: false,
          m_operator: 'ROP_AND',
        },
        {
          $type: RHE,
          m_entryName: 'Complete',
          m_displayName: null,
          m_isQuestRegistry: true,
          m_questName: 'DS-ACAD1-C01-002',
          m_applyNOT: false,
          m_operator: 'ROP_AND',
        },
      ],
    },
  ],
};

/** The same value as text — the order-sensitive half of the diff. */
const AC1_EXPECTED_TEXT = `{
  "$type": "${RL}",
  "m_applyNOT": false,
  "m_operator": "ROP_AND",
  "m_requirements": [
    {
      "$type": "${RHQ}",
      "m_applyNOT": true,
      "m_operator": "ROP_AND",
      "m_questName": "DS-ACAD1-C01-002"
    },
    {
      "$type": "${RL}",
      "m_applyNOT": false,
      "m_operator": "ROP_OR",
      "m_requirements": [
        {
          "$type": "${RSOF}",
          "m_magicSchool": "Fire",
          "m_applyNOT": false,
          "m_operator": "ROP_AND"
        },
        {
          "$type": "${RHE}",
          "m_entryName": "Complete",
          "m_displayName": null,
          "m_isQuestRegistry": true,
          "m_questName": "DS-ACAD1-C01-002",
          "m_applyNOT": false,
          "m_operator": "ROP_AND"
        }
      ]
    }
  ]
}`;

describe('AC1: the fixture-only AND(ReqHasQuest{NOT}, OR(...)) tree', () => {
  it('builds the hand-written value, byte-for-byte', () => {
    // The root path, the outer group's two children and the inner group, addressed the way
    // the UI addresses them (the same edits its controls issue, in order).
    const root: DocEdit['path'] = [REQUIREMENTS_PATH];
    const outerQuest = [...root, 'm_requirements', 0];
    const innerGroup = [...root, 'm_requirements', 1];
    const innerFirst = [...innerGroup, 'm_requirements', 0];
    const innerSecond = [...innerGroup, 'm_requirements', 1];

    let doc: JsonDocument = emptyQuest();
    // 1. "Add Condition" on the empty slot → a canonical wrapper with one ReqHasQuest.
    doc = apply(doc, initializeTreeEdits(root, 'condition'));
    // 2. the quest dropdown writes the raw id.
    doc = apply(doc, [must(setLeafFieldEdit(outerQuest, 'm_questName', true, 'DS-ACAD1-C01-002'))]);
    // 3. the NOT checkbox.
    doc = apply(doc, [toggleApplyNOTEdit(outerQuest, { m_applyNOT: false })]);
    // 4. "Add Group" → a canonical wrapper with one default condition.
    doc = apply(doc, addGroupEdits(root, 1));
    // 5. the type selector on that condition → ReqSchoolOfFocus.
    doc = apply(doc, changeLeafTypeEdits(innerFirst, 'ReqSchoolOfFocus'));
    // 6. its School select.
    doc = apply(doc, [must(setLeafFieldEdit(innerFirst, 'm_magicSchool', true, 'Fire'))]);
    // 7. "Add Condition" inside the inner group, then the type selector → ReqHasEntry.
    doc = apply(doc, addConditionEdits(innerGroup, 1));
    doc = apply(doc, changeLeafTypeEdits(innerSecond, 'ReqHasEntry'));
    // 8. the Entry text field and the quest dropdown.
    doc = apply(doc, [
      must(setLeafFieldEdit(innerSecond, 'm_entryName', true, 'Complete')),
      must(setLeafFieldEdit(innerSecond, 'm_questName', true, 'DS-ACAD1-C01-002')),
    ]);
    // 9. the inner group's operator toggle → OR.
    doc = apply(doc, [setOperatorEdit(innerGroup, 'ROP_OR')]);

    const value = slot(doc, REQUIREMENTS_PATH);
    expect(value).toEqual(AC1_EXPECTED);
    expect(JSON.stringify(value, null, 2)).toBe(AC1_EXPECTED_TEXT);
    // The reload "in the tree editor": the same tree reads back, deep-equal.
    const reloaded = loadDoc(JSON.parse(serializeDoc(doc)) as JsonDocument);
    expect(slot(reloaded, REQUIREMENTS_PATH)).toEqual(AC1_EXPECTED);
    expect(readRequirementTree(root, slot(reloaded, REQUIREMENTS_PATH))).toEqual(
      readRequirementTree(root, value),
    );
  });

  it('labels the three ways the shape is fixture-only', () => {
    // 1. the OR operator: `ROP_OR` is not in the corpus at all (631/631 ROP_AND).
    expect(requirementOperator({ m_operator: 'ROP_OR' })).toBe('ROP_OR');
    expect(AC1_EXPECTED.m_requirements[1].m_operator).toBe('ROP_OR');
    // 2. a group inside a group: the corpus nests none (depths 0 and 1 only).
    const tree = readRequirementTree([REQUIREMENTS_PATH], AC1_EXPECTED);
    expect(tree?.children[0]?.kind).toBe('leaf');
    expect(tree?.children[1]?.kind).toBe('group');
    expect(tree?.children[1]?.children.map((child) => child.kind)).toEqual(['leaf', 'leaf']);
    expect([
      tree?.address,
      tree?.children[0]?.address,
      tree?.children[1]?.address,
      tree?.children[1]?.children[1]?.address,
    ]).toEqual([
      'm_requirements',
      'm_requirements[0]',
      'm_requirements[1]',
      'm_requirements[1][1]',
    ]);
    // 3. the cross-type mix: `ReqHasQuest` + `ReqSchoolOfFocus`/`ReqHasEntry` in one quest
    //    tree. The unit-level proxy is that all three classes are distinct specs, i.e. the
    //    tree really mixes classes no corpus quest tree mixes.
    const inner = tree?.children[1];
    expect([
      tree?.children[0]?.spec?.shortName,
      inner?.children[0]?.spec?.shortName,
      inner?.children[1]?.spec?.shortName,
    ]).toEqual(['ReqHasQuest', 'ReqSchoolOfFocus', 'ReqHasEntry']);
  });
});

/* ------------------------------------------------- the real corpus sweep */

/**
 * The same three risks, against every real requirement wrapper on disk — not a fixture.
 *
 * This is the half a hand-written fixture cannot carry: the corpus's **7 untyped**
 * quest-level wrappers and its **65** untyped DropTable item wrappers must come out of an
 * edit still untyped and still in their own key order, and re-setting every existing key of
 * every existing requirement node to its own value through this module's builders must
 * leave the file **byte-identical** (so no key is dropped, none is reordered, and no `null`
 * is normalised away — D57/D58e). It is the `quest-roundtrip.test.ts` pattern: the corpus is
 * gitignored, so the sweep prints its skip reason in CI and the fixtures above carry the
 * always-on half.
 *
 * The fixture-only shapes are deliberately **not** asserted here: no corpus file carries
 * `ROP_OR`, a group inside a group, or a quest tree mixing `ReqHasQuest` with the school
 * classes (see the module header of `lib/requirement-tree.ts`).
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function corpusDirs(sub: string): string[] {
  const override = sub === 'QuestTemplates' ? process.env.SPIRALDB_QUEST_CORPUS : undefined;
  return [
    override ?? path.join(DEFAULT_SPIRALDB_PATH, sub),
    path.join(ROOT, 'data', 'test-spiraldb', sub),
  ]
    .filter((dir, index, all) => all.indexOf(dir) === index)
    .filter((dir) => existsSync(dir));
}

const QUEST_CORPORA = corpusDirs('QuestTemplates');
const DROP_CORPORA = corpusDirs('DropTables');
const ALL_CORPORA = [...QUEST_CORPORA, ...DROP_CORPORA];

/** Each wrapper slot: an object whose `m_requirements` is an array. Its subtree is not walked. */
function requirementSlots(doc: unknown): DocPath[] {
  const slots: DocPath[] = [];
  const walk = (node: unknown, at: DocPath): void => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, [...at, index]));
      return;
    }
    if (typeof node !== 'object' || node === null) {
      return;
    }
    const record = node as Record<string, unknown>;
    if (Array.isArray(record.m_requirements)) {
      slots.push(at);
      return;
    }
    for (const [key, value] of Object.entries(record)) {
      walk(value, [...at, key]);
    }
  };
  walk(doc, []);
  return slots;
}

/** Every node of a view, parents before children. */
function flatten(view: RequirementNodeView): RequirementNodeView[] {
  return [view, ...view.children.flatMap((child) => flatten(child))];
}

/**
 * An edit list that changes nothing: every existing key of every existing node, re-set to
 * the value it already has. Applied through the builders, it can only move what the
 * builders touch — so a byte-identical result is the proof that they touch nothing else.
 */
function benignEdits(view: RequirementNodeView): DocEdit[] {
  const edits: DocEdit[] = [];
  for (const node of flatten(view)) {
    if (node.kind === 'group') {
      const operator = requirementOperator(node.value);
      if (operator !== null) {
        edits.push(setOperatorEdit(node.path, operator));
      }
      continue;
    }
    if (!node.readable) {
      continue;
    }
    for (const [key, value] of Object.entries(node.value as Record<string, unknown>)) {
      if (
        key === '$type' ||
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        edits.push({ op: 'set', path: [...node.path, key], value });
      }
    }
  }
  return edits;
}

describe.skipIf(ALL_CORPORA.length === 0)('the real corpus of requirement wrappers', () => {
  it('re-sets every existing key in place, byte-for-byte, over every corpus file', () => {
    let files = 0;
    let slots = 0;
    let untyped = 0;
    let leaves = 0;

    for (const dir of ALL_CORPORA) {
      for (const file of readdirSync(dir)
        .filter((name) => name.endsWith('.json'))
        .sort()) {
        files += 1;
        const doc = loadDoc(JSON5.parse(readFileSync(path.join(dir, file), 'utf8')));
        for (const slot of requirementSlots(doc)) {
          slots += 1;
          const value = getAtPath(doc, slot);
          const view = readRequirementTree(slot, value);
          expect(view, `${file} ${formatPath(slot)}`).not.toBeNull();
          if (view === null) {
            continue;
          }
          leaves += flatten(view).filter((node) => node.kind === 'leaf').length;

          // Nothing changes, so the whole file must come back byte-identical.
          const edited = applyEdits(doc, benignEdits(view));
          expect(serializeDoc(edited), `${file} ${formatPath(slot)}`).toBe(serializeDoc(doc));

          // An untyped wrapper stays untyped, keeps its own key order, and gains a child.
          if (!hasAtPath(value, ['$type'])) {
            untyped += 1;
            const before = value as Record<string, unknown>;
            const withChild = applyEdits(
              doc,
              addConditionEdits(slot, childrenOfGroup(before).length),
            );
            const after = getAtPath(withChild, slot) as Record<string, unknown>;
            expect(Object.keys(after), `${file} ${formatPath(slot)}`).toEqual(Object.keys(before));
            expect(hasAtPath(after, ['$type']), file).toBe(false);
            expect(childrenOfGroup(after)).toHaveLength(childrenOfGroup(before).length + 1);
          }
        }
      }
    }

    // The sweep is not vacuous: it found the corpus's wrappers, leaves and untyped shapes.
    expect(files).toBeGreaterThan(0);
    expect(slots).toBeGreaterThan(0);
    expect(leaves).toBeGreaterThan(0);
    expect(untyped).toBeGreaterThan(0);
    console.log(
      `[p3-06 corpus] ${files} files, ${slots} requirement wrappers (${leaves} leaves, ` +
        `${untyped} of them untyped wrappers) re-set byte-identically across ` +
        `${ALL_CORPORA.join(', ')}`,
    );
  });
});

/** `formatPath` for a failure message — `m_goals[0].m_goalRequirements`. */
function formatPath(at: DocPath): string {
  let rendered = '';
  for (const segment of at) {
    if (typeof segment === 'number') {
      rendered += `[${segment}]`;
    } else {
      rendered += rendered === '' ? segment : `.${segment}`;
    }
  }
  return rendered === '' ? '<root>' : rendered;
}
