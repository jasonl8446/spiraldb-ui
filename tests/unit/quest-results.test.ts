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
} from '@shared/document';
import { RESULT_TYPES, TYPE_STRINGS } from '@shared/quest/typeConstants';
import { DEFAULT_SPIRALDB_PATH } from '@server/db';

import {
  ACTIVATE_RESULTS_PATH,
  addResultEdits,
  COMPLETE_RESULTS_PATH,
  deleteResultEdits,
  END_RESULTS_PATH,
  hasSoundRouter,
  KNOWN_RESULT_KEYS,
  newResultObject,
  newResultRequirementsWrapper,
  newSoundRouter,
  RAW_FIELDS_LABEL,
  readResultCards,
  rawResultFields,
  REQUIREMENTS_KEY,
  resultField,
  resultFieldPath,
  resultItemsPath,
  resultNodePath,
  resultNodes,
  resultRequirementsPath,
  RESULT_TYPE_SPECS,
  resultScalarText,
  resultSelectOptions,
  resultShortTypeName,
  resultTypeSelectOptions,
  resultTypeSpecByName,
  resultTypeSpecForResult,
  resultTypeSpecForTypeString,
  SOUND_ROUTER_FIELD_SPECS,
  START_RESULTS_PATH,
  TALLY_COUNTER_PATH,
  TALLY_RESULTS_PATH,
  setResultBooleanFieldEdit,
  setResultIdFieldEdit,
  setResultNumberFieldEdit,
  setResultTextFieldEdit,
  setRouterBooleanFieldEdit,
  setRouterFieldEdit,
  soundRouterField,
  soundRouterPath,
  soundRouterView,
  unmodelledResultKeys,
  type ResultFieldSpec,
  type ResultShortTypeName,
  type ResultTypeSpec,
} from '../../client/src/lib/quest-results';

/**
 * The Results editor's pure rules (plan task 3.7 / story p3-07).
 *
 * Everything asserted here is a rule a browser cannot state more clearly: the 14-class
 * table keyed to the corpus `$type` strings, the exact field set and key order of each
 * class, the friendly-name source of every ID field, the read helpers' treatment of the
 * corpus's own oddities (an untagged wrapper, the ambiguous `ResDrawHand` id, an absent
 * `m_router`), and the edit builders applied to real documents through `applyEdits` so the
 * assertions are about documents rather than intermediate objects.
 *
 * The `$type` literals are **spelled out in full** rather than imported, so the test cannot
 * prove the model agrees with itself.
 *
 * The measured corpus facts — re-measured at the owner's `f9a1055` baseline (D79): **421**
 * result nodes (was 381); ResDropTable 323, ResAddDynaMod 34, ResLearnSpell 21, ResGiveSpell 10,
 * ResDrawHand 8, ResTeleport 8, **ResActorDialog 5** (the corpus-only class), ResPostEvent 3,
 * ResPlaySound 2, ResAddSpell 2, and one each of ResAddHealth/ResAddMana/ResModifyEntry/
 * ResDespawn/ResWait — are re-measured by the sweep at the bottom, which is skipped with an
 * explicit reason when no corpus exists on the machine.
 */

/* ------------------------------------------------------------- fixtures */

const RDROP = 'Imcodec.ObjectProperty.TypeCache.ResDropTable, Imcodec.ObjectProperty';
const RMOD = 'Imcodec.ObjectProperty.TypeCache.ResModifyEntry, Imcodec.ObjectProperty';
const RADM = 'Imcodec.ObjectProperty.TypeCache.ResAddDynaMod, Imcodec.ObjectProperty';
const RLEARN = 'Imcodec.ObjectProperty.TypeCache.ResLearnSpell, Imcodec.ObjectProperty';
const REVENT = 'Imcodec.ObjectProperty.TypeCache.ResPostEvent, Imcodec.ObjectProperty';
const RHEALTH = 'Imcodec.ObjectProperty.TypeCache.ResAddHealth, Imcodec.ObjectProperty';
const RMANA = 'Imcodec.ObjectProperty.TypeCache.ResAddMana, Imcodec.ObjectProperty';
const RADDS = 'Imcodec.ObjectProperty.TypeCache.ResAddSpell, Imcodec.ObjectProperty';
const RDESPAWN = 'Imcodec.ObjectProperty.TypeCache.ResDespawn, Imcodec.ObjectProperty';
const RDRAW = 'Imcodec.ObjectProperty.TypeCache.ResDrawHand, Imcodec.ObjectProperty';
const RGIVE = 'Imcodec.ObjectProperty.TypeCache.ResGiveSpell, Imcodec.ObjectProperty';
const RSOUND = 'Imcodec.ObjectProperty.TypeCache.ResPlaySound, Imcodec.ObjectProperty';
const RTELE = 'Imcodec.ObjectProperty.TypeCache.ResTeleport, Imcodec.ObjectProperty';
const RWAIT = 'Imcodec.ObjectProperty.TypeCache.ResWait, Imcodec.ObjectProperty';
const RSOF = 'Imcodec.ObjectProperty.TypeCache.ReqSchoolOfFocus, Imcodec.ObjectProperty';

/** The corpus `$type` literals, hand-written (see the header). */
const LITERALS: Record<ResultShortTypeName, string> = {
  ResDropTable: RDROP,
  ResModifyEntry: RMOD,
  ResAddDynaMod: RADM,
  ResLearnSpell: RLEARN,
  ResPostEvent: REVENT,
  ResAddHealth: RHEALTH,
  ResAddMana: RMANA,
  ResAddSpell: RADDS,
  ResDespawn: RDESPAWN,
  ResDrawHand: RDRAW,
  ResGiveSpell: RGIVE,
  ResPlaySound: RSOUND,
  ResTeleport: RTELE,
  ResWait: RWAIT,
  // The corpus-only class (D79), spelled out exactly as the grep prints it.
  ResActorDialog: 'Imcodec.ObjectProperty.TypeCache.ResActorDialog, Imcodec.ObjectProperty',
};

/**
 * The **exact field set, in the corpus's own key order**, for each of the **15** classes —
 * hand-written from the measured key orders. `ResModifyEntry` is the one whose corpus
 * order differs from the domain reference's prose order, and `ResActorDialog` is the
 * corpus-only 15th class (D79).
 */
const EXPECTED_ORDER: Record<ResultShortTypeName, string[]> = {
  ResDropTable: ['$type', 'm_tableName', 'm_maxRolls'],
  ResModifyEntry: ['$type', 'm_entryName', 'm_isQuestRegistry', 'm_value', 'm_questName'],
  ResAddDynaMod: [
    '$type',
    'm_dynaModClientTag',
    'm_dynaModRemove',
    'm_useQuestAsOriginator',
    'm_dynaModState',
    'm_zoneName',
  ],
  ResLearnSpell: ['$type', 'm_templateID', 'm_requirements'],
  ResPostEvent: ['$type', 'm_eventName'],
  ResAddHealth: ['$type'],
  ResAddMana: ['$type'],
  ResAddSpell: ['$type', 'm_templateID'],
  ResDespawn: ['$type', 'm_spawnID', 'm_despawnEffect', 'm_templateID'],
  ResDrawHand: ['$type', 'm_templateID'],
  ResGiveSpell: ['$type', 'm_templateID', 'm_spellID'],
  ResPlaySound: ['$type', 'm_router', 'm_soundName', 'm_blocking', 'm_reinteractTime'],
  ResTeleport: [
    '$type',
    'm_destinationLoc',
    'm_destinationZone',
    'm_exitTeleporter',
    'm_teleporterTag',
    'm_teleportType',
    'm_transitionID',
  ],
  ResWait: ['$type', 'm_secondsToWait'],
  // The corpus-only class: `{$type, m_dialog}` in all 5 measured nodes, the nested `m_dialog`
  // being the typed dialog block (`ActorDialog`, 7 keys) that the module owns no field for.
  ResActorDialog: ['$type', 'm_dialog'],
};

/** The friendly-name source(s) of every ID field — the AC's per-field dropdown fact. */
const EXPECTED_SOURCES: Array<[ResultShortTypeName, string, string[]]> = [
  ['ResDropTable', 'm_tableName', ['drop_tables']],
  ['ResModifyEntry', 'm_questName', ['quests']],
  ['ResAddDynaMod', 'm_zoneName', ['zones']],
  ['ResLearnSpell', 'm_templateID', ['spells']],
  ['ResAddSpell', 'm_templateID', ['spells']],
  ['ResDespawn', 'm_templateID', ['npcs']],
  ['ResDrawHand', 'm_templateID', ['spells', 'npcs']],
  ['ResGiveSpell', 'm_templateID', ['npcs']],
  ['ResGiveSpell', 'm_spellID', ['spells']],
  ['ResTeleport', 'm_destinationZone', ['zones']],
];

/** The measurement's router sample, verbatim. */
const ROUTER_SAMPLE = {
  m_locX: 0,
  m_locY: 0,
  m_locZ: 0,
  m_routingType: 'ROUTING_ACTOR',
  m_useLocation: false,
  m_useTriggerLocation: false,
};

/**
 * The edit a builder must produce for this test — `null` is the builders' legitimate
 * "nothing to change" answer, and a test that writes must not accept it silently.
 */
function must(edit: DocEdit | null): DocEdit {
  expect(edit).not.toBeNull();
  return edit as DocEdit;
}

function specOf(type: ResultShortTypeName): ResultTypeSpec {
  const spec = resultTypeSpecByName(type);
  expect(spec, type).toBeDefined();
  return spec as ResultTypeSpec;
}

function fieldOf(type: ResultShortTypeName, key: string): ResultFieldSpec {
  const field = specOf(type).fields.find((candidate) => candidate.key === key);
  expect(field, `${type}.${key}`).toBeDefined();
  return field as ResultFieldSpec;
}

/** A document with one start-results wrapper. */
function docWithStart(items: unknown[]): Record<string, unknown> {
  return { m_questName: 'Q', m_startResults: { m_results: items } };
}

/** One result node at `m_startResults.m_results[0]` of a fresh document. */
function docWithOne(node: unknown): Record<string, unknown> {
  return docWithStart([node]);
}

const START: DocPath = [START_RESULTS_PATH];

/* ------------------------------------------------------- the 15 classes */

describe('the 15 result classes', () => {
  it('is exactly the constant table’s 15 classes, character-for-character', () => {
    // The spec's 14 plus the corpus-only ResActorDialog (D79).
    expect(RESULT_TYPE_SPECS).toHaveLength(15);
    expect(
      RESULT_TYPE_SPECS.filter((spec) => spec.corpusOnly === true).map((s) => s.shortName),
    ).toEqual(['ResActorDialog']);
    expect(RESULT_TYPE_SPECS.map((spec) => spec.shortName)).toEqual(Object.keys(RESULT_TYPES));
    for (const spec of RESULT_TYPE_SPECS) {
      expect(spec.$type, spec.shortName).toBe(RESULT_TYPES[spec.shortName]);
      // …and the literal the corpus measurement wrote down (never a composed string).
      expect(spec.$type, spec.shortName).toBe(LITERALS[spec.shortName]);
      expect(TYPE_STRINGS[spec.shortName], spec.shortName).toBe(spec.$type);
      expect(resultTypeSpecForTypeString(spec.$type), spec.shortName).toBe(spec);
    }
    expect(resultTypeSpecForTypeString('Imcodec.ObjectProperty.TypeCache.Nope, X')).toBeUndefined();
    expect(resultTypeSpecForTypeString(undefined)).toBeUndefined();
  });

  it('gives every class exactly its measured field set, in the measured key order', () => {
    // The corpus-only class is excluded here and pinned separately below: its node's second key
    // (`m_dialog`) is deliberately unowned, so `newResultObject` writes `$type` alone — which is
    // why it is not offered as a new node.
    for (const spec of RESULT_TYPE_SPECS.filter((candidate) => candidate.corpusOnly !== true)) {
      expect(
        spec.fields.map((field) => field.key),
        spec.shortName,
      ).toEqual(EXPECTED_ORDER[spec.shortName].slice(1));
      expect(Object.keys(newResultObject(spec.shortName)), spec.shortName).toEqual(
        EXPECTED_ORDER[spec.shortName],
      );
    }
  });

  it('never pads the two fieldless classes out beyond $type', () => {
    expect(newResultObject('ResAddHealth')).toEqual({ $type: RHEALTH });
    expect(newResultObject('ResAddMana')).toEqual({ $type: RMANA });
    expect(specOf('ResAddHealth').fields).toEqual([]);
    expect(specOf('ResAddMana').fields).toEqual([]);
  });

  it('resolves the corpus-only ResActorDialog and discloses its nested dialog read-only', () => {
    const spec = specOf('ResActorDialog');
    expect(spec.corpusOnly).toBe(true);
    expect(spec.fields).toEqual([]);
    // Its measured shape is `{$type, m_dialog}`, and `m_dialog` is unowned → raw disclosure.
    const node = {
      $type: spec.$type,
      m_dialog: { $type: TYPE_STRINGS.ActorDialog, m_dialogTag: 'Hyperlink', m_dialogEntries: [] },
    };
    const card = readResultCards(START, { m_results: [node] })[0];
    expect(card.spec?.shortName).toBe('ResActorDialog');
    expect(card.fields).toEqual([]);
    expect(Object.keys(rawResultFields(node))).toEqual(['m_dialog']);
    // It is not offered as a new node: creating one would write `{$type}` with no `m_dialog`,
    // a shape the corpus has never had.
    expect(resultTypeSelectOptions().map((option) => option.value)).not.toContain('ResActorDialog');
  });

  it('lists every friendly-name field against the table the corpus measures it in', () => {
    const declared: Array<[string, string, readonly string[]]> = [];
    for (const spec of RESULT_TYPE_SPECS) {
      for (const field of spec.fields) {
        if (field.kind === 'friendly-name') {
          declared.push([spec.shortName, field.key, field.nameSources ?? []]);
        }
      }
    }
    expect(declared).toEqual(
      EXPECTED_SOURCES.map(([type, key, sources]) => [type, key, sources] as const),
    );
    // A template id is a number, a table name / zone path / quest name a string.
    for (const spec of RESULT_TYPE_SPECS) {
      for (const field of spec.fields) {
        if (field.kind !== 'friendly-name') {
          continue;
        }
        expect(
          field.idValueType,
          `${spec.shortName}.${field.key} must declare its JSON type`,
        ).toBeDefined();
      }
    }
    expect(fieldOf('ResDropTable', 'm_tableName').idValueType).toBe('string');
    expect(fieldOf('ResLearnSpell', 'm_templateID').idValueType).toBe('number');
  });

  it('records the ResDrawHand ambiguity as two sources, not a silent pick', () => {
    const field = fieldOf('ResDrawHand', 'm_templateID');
    expect(field.nameSources).toEqual(['spells', 'npcs']);
    expect(field.idValueType).toBe('number');
    // The measurement is stated in the field's own help text.
    expect(field.help).toContain('6 of 8');
    expect(field.help).toContain('2 in npcs');
  });

  it('builds a new node’s sub-objects in the corpus’s own shapes', () => {
    // The router: measured order, measured values, no `$type`.
    const sound = newResultObject('ResPlaySound');
    expect(Object.keys(sound)).toEqual(EXPECTED_ORDER.ResPlaySound);
    expect(sound.m_router).toEqual(ROUTER_SAMPLE);
    expect(hasAtPath(sound.m_router, ['$type'])).toBe(false);
    expect(Object.keys(newSoundRouter())).toEqual([
      'm_locX',
      'm_locY',
      'm_locZ',
      'm_routingType',
      'm_useLocation',
      'm_useTriggerLocation',
    ]);

    // The requirement wrapper: untyped, corpus key order, one ReqSchoolOfFocus leaf.
    const learn = newResultObject('ResLearnSpell');
    expect(learn.m_requirements).toEqual({
      m_requirements: [
        { $type: RSOF, m_magicSchool: '', m_applyNOT: false, m_operator: 'ROP_AND' },
      ],
      m_applyNOT: false,
      m_operator: 'ROP_AND',
    });
    expect(hasAtPath(learn.m_requirements, ['$type'])).toBe(false);
    expect(Object.keys(learn.m_requirements as object)).toEqual([
      'm_requirements',
      'm_applyNOT',
      'm_operator',
    ]);
    // Each call builds a fresh object (no shared reference between two new nodes).
    expect(newResultRequirementsWrapper()).not.toBe(newResultRequirementsWrapper());
  });

  it('writes ResModifyEntry in the corpus order, not the reference’s prose order', () => {
    const node = newResultObject('ResModifyEntry');
    expect(Object.keys(node)).toEqual(EXPECTED_ORDER.ResModifyEntry);
    expect(Object.keys(node)).not.toEqual([
      '$type',
      'm_questName',
      'm_entryName',
      'm_isQuestRegistry',
      'm_value',
    ]);
  });
});

/* --------------------------------------------------------- reading a wrapper */

describe('reading a result wrapper', () => {
  it('reads the array tolerantly and leaves the wrapper’s own shape alone', () => {
    expect(resultNodes({ m_results: [1, 2] })).toEqual([1, 2]);
    expect(resultNodes({})).toEqual([]);
    expect(resultNodes({ m_results: null })).toEqual([]);
    expect(resultNodes(null)).toEqual([]);
    expect(resultNodes([1])).toEqual([]);
  });

  it('addresses every card absolutely, so four homes on one page stay distinct', () => {
    const doc = {
      m_startResults: { m_results: [{ $type: RDROP, m_tableName: 'T', m_maxRolls: 1 }] },
      m_goals: [
        {
          m_completeResults: { m_results: [{ $type: RWAIT, m_secondsToWait: 5 }] },
          m_activateResults: { m_results: [] },
        },
      ],
    };
    const start = readResultCards([START_RESULTS_PATH], doc.m_startResults);
    expect(start).toHaveLength(1);
    expect(start[0]?.address).toBe('m_startResults.m_results[0]');
    expect(start[0]?.title).toBe('ResDropTable');
    expect(start[0]?.fields.map((field) => field.spec.key)).toEqual(['m_tableName', 'm_maxRolls']);
    expect(start[0]?.fields.every((field) => field.present)).toBe(true);

    const goal = readResultCards(
      ['m_goals', 0, COMPLETE_RESULTS_PATH],
      doc.m_goals[0]?.m_completeResults,
    );
    expect(goal[0]?.address).toBe('m_goals[0].m_completeResults.m_results[0]');
    expect(goal[0]?.fields[0]?.value).toBe(5);
    expect(readResultCards(['m_goals', 0, ACTIVATE_RESULTS_PATH], { m_results: [] })).toEqual([]);
    expect(readResultCards([TALLY_COUNTER_PATH], {})).toEqual([]);
  });

  it('keeps a value it cannot read visible instead of dropping it', () => {
    const cards = readResultCards(START, { m_results: [null, 7, 'x'] });
    expect(cards).toHaveLength(3);
    expect(cards.every((card) => !card.readable)).toBe(true);
    expect(cards[0]?.spec).toBeNull();
    expect(cards[0]?.title).toBe('unknown');
    expect(cards[0]?.fields).toEqual([]);
  });

  it('names an unknown $type from the lenient $type tail and exposes its keys raw', () => {
    const cards = readResultCards(START, {
      m_results: [{ $type: 'Imcodec.ObjectProperty.TypeCache.ResFuture, X', m_extra: 1 }],
    });
    expect(cards[0]?.spec).toBeNull();
    expect(cards[0]?.title).toBe('ResFuture');
    expect(resultShortTypeName({ $type: RDROP })).toBe('ResDropTable');
    expect(unmodelledResultKeys({ $type: RDROP, m_extra: 1, m_tableName: 'T' })).toEqual([
      'm_extra',
    ]);
    expect(KNOWN_RESULT_KEYS).toContain('m_router');
    expect(KNOWN_RESULT_KEYS).toContain('m_useTriggerLocation');
    expect(RAW_FIELDS_LABEL).toBe('Raw fields');
  });

  it('reads the fields a card’s spec does not own without inventing keys', () => {
    const card = readResultCards(START, { m_results: [{ $type: RDROP, m_tableName: 'T' }] })[0];
    expect(card?.fields.find((field) => field.spec.key === 'm_maxRolls')?.present).toBe(false);
    expect(card?.fields.find((field) => field.spec.key === 'm_maxRolls')?.value).toBeUndefined();
    expect(resultField({ $type: RDROP }, 'm_maxRolls')).toBeUndefined();
    expect(resultField(null, 'm_maxRolls')).toBeUndefined();
    expect(resultTypeSpecForResult(null)).toBeUndefined();
    expect(resultNodePath(START, 2)).toEqual(['m_startResults', 'm_results', 2]);
    expect(resultFieldPath(START, 2, 'm_maxRolls')).toEqual([
      'm_startResults',
      'm_results',
      2,
      'm_maxRolls',
    ]);
    expect(resultRequirementsPath(START, 2)).toEqual([
      'm_startResults',
      'm_results',
      2,
      REQUIREMENTS_KEY,
    ]);
    expect(resultItemsPath(START)).toEqual(['m_startResults', 'm_results']);
  });
});

/* ------------------------------------------------------------- selectors */

describe('the selectors', () => {
  it('offers the 14 creatable classes in the reference’s order with the short name as the value', () => {
    const options = resultTypeSelectOptions();
    // The spec's 14 — `ResActorDialog` resolves but is not offered (no control for `m_dialog`).
    expect(options.map((option) => option.value)).toEqual(
      RESULT_TYPE_SPECS.filter((spec) => spec.corpusOnly !== true).map((spec) => spec.shortName),
    );
    expect(options.every((option) => !option.unlisted)).toBe(true);
    expect(options).toHaveLength(14);
    expect(options.map((option) => option.value)).toEqual(Object.keys(RESULT_TYPES).slice(0, 14));
  });

  it('keeps a value the listed options do not contain and leads with — when unset', () => {
    expect(resultSelectOptions('', ['TELEPORT_STATIC']).map((option) => option.value)).toEqual([
      '',
      'TELEPORT_STATIC',
    ]);
    expect(resultSelectOptions('', ['TELEPORT_STATIC'])[0]?.label).toBe('—');
    expect(resultSelectOptions('TELEPORT_STATIC', ['TELEPORT_STATIC'])).toEqual([
      { value: 'TELEPORT_STATIC', label: 'TELEPORT_STATIC', unlisted: false },
    ]);
    const unlisted = resultSelectOptions('TELEPORT_FUTURE', ['TELEPORT_STATIC']);
    expect(unlisted[unlisted.length - 1]).toEqual({
      value: 'TELEPORT_FUTURE',
      label: 'TELEPORT_FUTURE',
      unlisted: true,
    });
    expect(resultSelectOptions(7, ['TELEPORT_STATIC'])[0]?.value).toBe('');
  });

  it('renders scalars as text and empty for null/absent', () => {
    expect(resultScalarText(null)).toBe('');
    expect(resultScalarText(undefined)).toBe('');
    expect(resultScalarText(false)).toBe('false');
    expect(resultScalarText(5)).toBe('5');
    expect(resultScalarText({ a: 1 })).toBe('{"a":1}');
  });
});

/* ------------------------------------------------- controls reach the document */

describe('a control reaches the document', () => {
  it('inserts a new result at the end of an existing array', () => {
    const doc = docWithStart([{ $type: RWAIT, m_secondsToWait: 5 }]);
    const edited = applyEdits(
      doc,
      addResultEdits(START, 1, 'ResDropTable', {
        wrapper: true,
        items: true,
      }),
    );
    const items = getAtPath(edited, resultItemsPath(START)) as unknown[];
    expect(items).toHaveLength(2);
    expect(items[1]).toEqual({
      $type: RDROP,
      m_tableName: '',
      m_maxRolls: 1,
    });
    // The existing node is untouched, and so is the wrapper's own key set.
    expect(items[0]).toEqual({ $type: RWAIT, m_secondsToWait: 5 });
    expect(Object.keys(getAtPath(edited, START) as object)).toEqual(['m_results']);
  });

  it('creates m_results when the wrapper exists without it', () => {
    const doc = { m_startResults: {} };
    const edited = applyEdits(
      doc,
      addResultEdits(START, 0, 'ResAddHealth', {
        wrapper: true,
        items: false,
      }),
    );
    expect(getAtPath(edited, resultItemsPath(START))).toEqual([{ $type: RHEALTH }]);
    expect(Object.keys(getAtPath(edited, START) as object)).toEqual(['m_results']);
  });

  it('creates the wrapper itself, untagged, when it is absent', () => {
    const doc = { m_questName: 'Q' };
    const edited = applyEdits(
      doc,
      addResultEdits(START, 0, 'ResAddMana', {
        wrapper: false,
        items: false,
      }),
    );
    expect(getAtPath(edited, START)).toEqual({ m_results: [{ $type: RMANA }] });
    expect(hasAtPath(getAtPath(edited, START), ['$type'])).toBe(false);
  });

  it('deletes exactly one node and shifts the rest', () => {
    const doc = docWithStart([
      { $type: RWAIT, m_secondsToWait: 5 },
      { $type: RDROP, m_tableName: 'T', m_maxRolls: 1 },
    ]);
    const edited = applyEdits(doc, deleteResultEdits(START, 0));
    expect(getAtPath(edited, resultItemsPath(START))).toEqual([
      { $type: RDROP, m_tableName: 'T', m_maxRolls: 1 },
    ]);
  });

  it('deletes a key when a text control is emptied, and writes nothing when it was absent', () => {
    const present = applyEdits(docWithOne({ $type: RDROP, m_tableName: 'T' }), [
      must(setResultTextFieldEdit(START, 0, 'm_tableName', true, '')),
    ]);
    expect(hasAtPath(getAtPath(present, resultNodePath(START, 0)), ['m_tableName'])).toBe(false);
    expect(setResultTextFieldEdit(START, 0, 'm_tableName', false, '')).toBeNull();
    const written = applyEdits(docWithOne({ $type: RDROP }), [
      must(setResultTextFieldEdit(START, 0, 'm_tableName', false, 'Drop')),
    ]);
    expect(getAtPath(written, resultFieldPath(START, 0, 'm_tableName'))).toBe('Drop');
  });

  it('writes numbers exactly as parsed and never writes NaN', () => {
    const written = applyEdits(docWithOne({ $type: RWAIT, m_secondsToWait: 5 }), [
      must(setResultNumberFieldEdit(START, 0, 'm_secondsToWait', true, '2.5')),
    ]);
    expect(getAtPath(written, resultFieldPath(START, 0, 'm_secondsToWait'))).toBe(2.5);
    expect(setResultNumberFieldEdit(START, 0, 'm_secondsToWait', true, '1e')).toBeNull();
    const cleared = applyEdits(docWithOne({ $type: RWAIT, m_secondsToWait: 5 }), [
      must(setResultNumberFieldEdit(START, 0, 'm_secondsToWait', true, '')),
    ]);
    expect(hasAtPath(getAtPath(cleared, resultNodePath(START, 0)), ['m_secondsToWait'])).toBe(
      false,
    );
  });

  it('writes a friendly-name id as the field’s own JSON type', () => {
    const doc = docWithOne({ $type: RDROP, m_tableName: 'Old' });
    const named = applyEdits(doc, [
      must(setResultIdFieldEdit(START, 0, fieldOf('ResDropTable', 'm_tableName'), true, 'New')),
    ]);
    expect(getAtPath(named, resultFieldPath(START, 0, 'm_tableName'))).toBe('New');

    const spell = applyEdits(docWithOne({ $type: RLEARN, m_templateID: 0 }), [
      must(
        setResultIdFieldEdit(START, 0, fieldOf('ResLearnSpell', 'm_templateID'), true, '625720646'),
      ),
    ]);
    expect(getAtPath(spell, resultFieldPath(START, 0, 'm_templateID'))).toBe(625720646);

    // Clearing deletes; a non-numeric id for a numeric field writes nothing.
    const cleared = applyEdits(docWithOne({ $type: RDROP, m_tableName: 'Old' }), [
      must(setResultIdFieldEdit(START, 0, fieldOf('ResDropTable', 'm_tableName'), true, '')),
    ]);
    expect(hasAtPath(getAtPath(cleared, resultNodePath(START, 0)), ['m_tableName'])).toBe(false);
    expect(
      setResultIdFieldEdit(START, 0, fieldOf('ResLearnSpell', 'm_templateID'), true, 'abc'),
    ).toBeNull();
    expect(
      setResultIdFieldEdit(START, 0, fieldOf('ResLearnSpell', 'm_templateID'), false, ''),
    ).toBeNull();
  });

  it('toggles a boolean on and off without touching its neighbours', () => {
    const doc = docWithOne({
      $type: RDESPAWN,
      m_spawnID: 1,
      m_despawnEffect: false,
      m_templateID: 2,
    });
    const on = applyEdits(doc, [setResultBooleanFieldEdit(START, 0, 'm_despawnEffect', true)]);
    expect(getAtPath(on, resultNodePath(START, 0))).toEqual({
      $type: RDESPAWN,
      m_spawnID: 1,
      m_despawnEffect: true,
      m_templateID: 2,
    });
  });
});

/* ------------------------------------------------------------- the router */

describe('the router sub-object', () => {
  it('keeps an existing router’s own key order when one sub-field is edited', () => {
    const doc = docWithOne({ $type: RSOUND, m_router: { ...ROUTER_SAMPLE }, m_soundName: '' });
    const locX = SOUND_ROUTER_FIELD_SPECS[0] as ResultFieldSpec;
    const edited = applyEdits(doc, [
      must(setRouterFieldEdit(START, 0, ROUTER_SAMPLE, locX, true, '12')),
    ]);
    const router = getAtPath(edited, soundRouterPath(START, 0)) as Record<string, unknown>;
    expect(Object.keys(router)).toEqual([
      'm_locX',
      'm_locY',
      'm_locZ',
      'm_routingType',
      'm_useLocation',
      'm_useTriggerLocation',
    ]);
    expect(router.m_locX).toBe(12);
    expect(hasAtPath(router, ['$type'])).toBe(false);
  });

  it('writes the whole measured router on the first edit when m_router is absent', () => {
    const doc = docWithOne({ $type: RSOUND, m_soundName: '' });
    expect(hasSoundRouter(getAtPath(doc, resultNodePath(START, 0)))).toBe(false);
    expect(soundRouterView(getAtPath(doc, resultNodePath(START, 0)))).toEqual(ROUTER_SAMPLE);

    const routingType = SOUND_ROUTER_FIELD_SPECS[3] as ResultFieldSpec;
    const edited = applyEdits(doc, [
      must(setRouterFieldEdit(START, 0, undefined, routingType, false, 'ROUTING_ACTOR')),
    ]);
    const router = getAtPath(edited, soundRouterPath(START, 0)) as Record<string, unknown>;
    expect(router).toEqual(ROUTER_SAMPLE);
    expect(Object.keys(router)).toEqual(Object.keys(ROUTER_SAMPLE));

    const useLocation = SOUND_ROUTER_FIELD_SPECS[4] as ResultFieldSpec;
    const toggled = applyEdits(doc, [setRouterBooleanFieldEdit(START, 0, null, useLocation, true)]);
    expect(getAtPath(toggled, soundRouterPath(START, 0))).toEqual({
      ...ROUTER_SAMPLE,
      m_useLocation: true,
    });
  });

  it('deletes an emptied sub-field when it is there and writes nothing when it is not', () => {
    const full = { ...ROUTER_SAMPLE } as Record<string, unknown>;
    const locX = SOUND_ROUTER_FIELD_SPECS[0] as ResultFieldSpec;
    const edited = applyEdits(docWithOne({ $type: RSOUND, m_router: full }), [
      must(setRouterFieldEdit(START, 0, full, locX, true, '')),
    ]);
    const router = getAtPath(edited, soundRouterPath(START, 0)) as Record<string, unknown>;
    expect(hasAtPath(router, ['m_locX'])).toBe(false);
    expect(Object.keys(router)).toEqual([
      'm_locY',
      'm_locZ',
      'm_routingType',
      'm_useLocation',
      'm_useTriggerLocation',
    ]);
    expect(setRouterFieldEdit(START, 0, full, locX, false, '')).toBeNull();
    expect(setRouterFieldEdit(START, 0, full, locX, true, '1e')).toBeNull();
    expect(soundRouterField({ m_locX: 3 }, 'm_locX')).toBe(3);
    expect(soundRouterField(null, 'm_locX')).toBeUndefined();
    expect(SOUND_ROUTER_FIELD_SPECS.map((field) => field.key)).toEqual([
      'm_locX',
      'm_locY',
      'm_locZ',
      'm_routingType',
      'm_useLocation',
      'm_useTriggerLocation',
    ]);
  });
});

/* ---------------------------------------------- validate, never normalise (D57) */

describe('validate, never normalise (D57)', () => {
  it('keeps a corpus-shaped node’s own order, explicit nulls and unknown keys', () => {
    const corpusShaped = {
      $type: RADM,
      m_dynaModClientTag: 'WC-FairyCage02 instance',
      m_dynaModRemove: false,
      m_useQuestAsOriginator: false,
      m_dynaModState: 'FairyEscaped',
      m_zoneName: null,
      m_legacyKey: 'kept',
    };
    const doc = docWithOne(corpusShaped);
    const edited = applyEdits(doc, [setResultBooleanFieldEdit(START, 0, 'm_dynaModRemove', true)]);
    const node = getAtPath(edited, resultNodePath(START, 0)) as Record<string, unknown>;
    expect(Object.keys(node)).toEqual(Object.keys(corpusShaped));
    expect(node.m_zoneName).toBeNull();
    expect(node.m_legacyKey).toBe('kept');
    expect(node.m_dynaModRemove).toBe(true);
    expect(unmodelledResultKeys(corpusShaped)).toEqual(['m_legacyKey']);
  });

  it('keeps the one corpus ResModifyEntry node’s empty m_questName empty', () => {
    const node = {
      $type: RMOD,
      m_entryName: 'GainedEnrollment',
      m_isQuestRegistry: false,
      m_value: 1,
      m_questName: '',
    };
    const edited = applyEdits(docWithOne(node), [
      must(setResultNumberFieldEdit(START, 0, 'm_value', true, '2')),
    ]);
    const after = getAtPath(edited, resultNodePath(START, 0)) as Record<string, unknown>;
    expect(Object.keys(after)).toEqual(EXPECTED_ORDER.ResModifyEntry);
    expect(after.m_questName).toBe('');
    expect(after.m_value).toBe(2);
  });

  it('never adds a $type to the wrapper and never reorders its keys', () => {
    const doc: Record<string, unknown> = { m_startResults: { m_results: [] } };
    let edited: unknown = doc;
    // The creatable classes: `ResActorDialog` resolves but is not offered as a new node (its
    // `m_dialog` is unowned, so a new node would be a shape the corpus never has).
    for (const type of RESULT_TYPE_SPECS.filter((spec) => spec.corpusOnly !== true)) {
      edited = applyEdits(
        edited,
        addResultEdits(
          [START_RESULTS_PATH],
          resultNodes(getAtPath(edited, START)).length,
          type.shortName,
          { wrapper: true, items: true },
        ),
      );
    }
    const editedRecord = edited as Record<string, unknown>;
    const wrapper = getAtPath(editedRecord, START) as object;
    expect(Object.keys(wrapper)).toEqual(['m_results']);
    expect(hasAtPath(wrapper, ['$type'])).toBe(false);
    const creatable = RESULT_TYPE_SPECS.filter((spec) => spec.corpusOnly !== true);
    const items = getAtPath(editedRecord, resultItemsPath(START)) as Array<Record<string, unknown>>;
    expect(items).toHaveLength(14);
    items.forEach((node, index) => {
      expect(Object.keys(node), creatable[index]?.shortName).toEqual(
        EXPECTED_ORDER[creatable[index]?.shortName as ResultShortTypeName],
      );
    });
  });

  it('round-trips through serializeDoc with the wrapper untagged', () => {
    const doc = docWithStart([newResultObject('ResLearnSpell')]);
    const text = serializeDoc(loadDoc(doc));
    expect(text).toContain('"m_startResults": {\n    "m_results": [');
    expect(JSON.parse(text).m_startResults).toEqual({
      m_results: [newResultObject('ResLearnSpell')],
    });
    expect(JSON.stringify(JSON.parse(text).m_startResults)).not.toContain(
      '$type":"Imcodec.ObjectProperty.TypeCache.RequirementList',
    );
  });
});

/* ------------------------------------------------------- the real corpus */

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

/** Existing corpus directories, most specific first (the real checkout, then the D17 clone). */
function corpusDirs(sub: string): string[] {
  return [path.join(DEFAULT_SPIRALDB_PATH, sub), path.join(ROOT, 'data', 'test-spiraldb', sub)]
    .filter((dir, index, all) => all.indexOf(dir) === index)
    .filter((dir) => existsSync(dir));
}

const QUEST_CORPORA = corpusDirs('QuestTemplates');

/** The real checkout's own `QuestTemplates/` (the D17 clone is the second corpus). */
const REAL_QUEST_DIR = path.join(DEFAULT_SPIRALDB_PATH, 'QuestTemplates');

/** The five result-wrapper homes of one quest document, in the corpus's own layout. */
function resultSlots(doc: unknown): DocPath[] {
  const slots: DocPath[] = [];
  const push = (at: DocPath, value: unknown): void => {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      slots.push(at);
    }
  };
  const record = doc as Record<string, unknown>;
  push([START_RESULTS_PATH], record.m_startResults);
  push([END_RESULTS_PATH], record.m_endResults);
  const goals = Array.isArray(record.m_goals) ? record.m_goals : [];
  goals.forEach((goal, index) => {
    const goalRecord = (goal ?? {}) as Record<string, unknown>;
    push(['m_goals', index, COMPLETE_RESULTS_PATH], goalRecord.m_completeResults);
    push(['m_goals', index, ACTIVATE_RESULTS_PATH], goalRecord.m_activateResults);
    const tally = goalRecord[TALLY_COUNTER_PATH];
    if (typeof tally === 'object' && tally !== null) {
      push(
        ['m_goals', index, TALLY_COUNTER_PATH, TALLY_RESULTS_PATH],
        (tally as Record<string, unknown>)[TALLY_RESULTS_PATH],
      );
    }
  });
  return slots;
}

/**
 * An edit list that changes nothing: every scalar field of every card re-set to the value
 * it already has, plus every existing router sub-field re-set. Applied through the
 * builders, it can only move what they touch — so a byte-identical serialization is the
 * proof that they touch nothing else. The `m_requirements` slot is deliberately left to
 * `tests/unit/requirement-tree.test.ts`, whose own sweep already drains the 21 result-nested
 * wrappers through the tree's builders (D62e).
 */
function benignEdits(cards: ReturnType<typeof readResultCards>): DocEdit[] {
  const edits: DocEdit[] = [];
  for (const card of cards) {
    for (const field of card.fields) {
      const kind = field.spec.kind;
      if (kind === 'router') {
        const router = field.value;
        if (typeof router !== 'object' || router === null) {
          continue;
        }
        for (const sub of SOUND_ROUTER_FIELD_SPECS) {
          const value = (router as Record<string, unknown>)[sub.key];
          const present = Object.prototype.hasOwnProperty.call(router, sub.key);
          if (!present) {
            continue;
          }
          if (sub.kind === 'boolean') {
            edits.push(
              setRouterBooleanFieldEdit(card.listPath, card.index, router, sub, value === true),
            );
          } else if (value !== null && value !== undefined) {
            const edit = setRouterFieldEdit(
              card.listPath,
              card.index,
              router,
              sub,
              present,
              String(value),
            );
            if (edit !== null) {
              edits.push(edit);
            }
          }
        }
        continue;
      }
      if (kind === 'requirements' || !field.present) {
        continue;
      }
      const value = field.value;
      // An empty string is a value the corpus carries (`m_zoneName: ''` ×2, `m_questName:
      // ''` ×1) but the builders' contract is "emptying a control deletes the key" — so the
      // benign edit re-sets it through the primitive instead, which is exactly the claim
      // being made here: an empty string passes through unchanged.
      if (value === '' || value === null || value === undefined) {
        if (value === '' && field.present) {
          edits.push({ op: 'set', path: field.path, value: '' });
        }
        continue;
      }
      if (kind === 'friendly-name') {
        const edit = setResultIdFieldEdit(
          card.listPath,
          card.index,
          field.spec,
          true,
          String(value),
        );
        if (edit !== null) {
          edits.push(edit);
        }
        continue;
      }
      if (kind === 'boolean') {
        edits.push(
          setResultBooleanFieldEdit(card.listPath, card.index, field.spec.key, value === true),
        );
      } else if (kind === 'number') {
        const edit = setResultNumberFieldEdit(
          card.listPath,
          card.index,
          field.spec.key,
          true,
          String(value),
        );
        if (edit !== null) {
          edits.push(edit);
        }
      } else {
        const edit = setResultTextFieldEdit(
          card.listPath,
          card.index,
          field.spec.key,
          true,
          String(value),
        );
        if (edit !== null) {
          edits.push(edit);
        }
      }
    }
  }
  return edits;
}

describe.skipIf(QUEST_CORPORA.length === 0)('the real corpus of result nodes', () => {
  it('matches the measured key order for every node, and re-sets every field byte-for-byte', () => {
    let files = 0;
    let wrappers = 0;
    let nodes = 0;
    let routers = 0;
    let wrappersWithType = 0;
    const counts = new Map<string, number>();
    // The real checkout's own numbers, kept apart from the D17 clone's (the clone carries
    // this tool's two rewritten files, so its totals are smaller and not the measurement).
    let realNodes = 0;
    const realCounts = new Map<string, number>();

    for (const dir of QUEST_CORPORA) {
      for (const file of readdirSync(dir)
        .filter((name) => name.endsWith('.json'))
        .sort()) {
        files += 1;
        const doc = loadDoc(JSON5.parse(readFileSync(path.join(dir, file), 'utf8')));
        for (const slot of resultSlots(doc)) {
          wrappers += 1;
          const wrapper = getAtPath(doc, slot) as Record<string, unknown>;
          expect(Object.keys(wrapper), `${file} ${slot.join('.')}`).toEqual(['m_results']);
          if (hasAtPath(wrapper, ['$type'])) {
            wrappersWithType += 1;
          }
          const cards = readResultCards(slot, wrapper);
          nodes += cards.length;

          for (const card of cards) {
            const node = card.value as Record<string, unknown>;
            const spec = card.spec;
            expect(
              spec,
              `${file} ${card.address} has a $type the table does not know`,
            ).not.toBeNull();
            if (spec === null) {
              continue;
            }
            counts.set(spec.shortName, (counts.get(spec.shortName) ?? 0) + 1);
            if (dir === REAL_QUEST_DIR) {
              realNodes += 1;
              realCounts.set(spec.shortName, (realCounts.get(spec.shortName) ?? 0) + 1);
            }
            // The measured order, exactly — no lost key, no extra key, no reordering.
            expect(Object.keys(node), `${file} ${card.address}`).toEqual(
              EXPECTED_ORDER[spec.shortName],
            );
            if (
              spec.shortName === 'ResPlaySound' &&
              typeof node.m_router === 'object' &&
              node.m_router !== null
            ) {
              routers += 1;
              expect(Object.keys(node.m_router), `${file} ${card.address}`).toEqual([
                'm_locX',
                'm_locY',
                'm_locZ',
                'm_routingType',
                'm_useLocation',
                'm_useTriggerLocation',
              ]);
              expect(hasAtPath(node.m_router, ['$type']), file).toBe(false);
            }
            if (spec.shortName === 'ResLearnSpell') {
              const requirements = node.m_requirements as Record<string, unknown>;
              expect(hasAtPath(requirements, ['$type']), `${file} ${card.address}`).toBe(false);
              expect(Object.keys(requirements), `${file} ${card.address}`).toEqual([
                'm_requirements',
                'm_applyNOT',
                'm_operator',
              ]);
            }
          }

          // Nothing changes, so the whole file must come back byte-identical.
          const edited = applyEdits(doc, benignEdits(cards));
          expect(serializeDoc(edited), `${file} ${slot.join('.')}`).toBe(serializeDoc(doc));
        }
      }
    }

    // The sweep is not vacuous, and all 15 classes are exercised by the corpus.
    expect(files).toBeGreaterThan(0);
    expect(wrappers).toBeGreaterThan(0);
    expect(nodes).toBeGreaterThan(0);
    expect(routers).toBeGreaterThan(0);
    expect(wrappersWithType).toBe(0);
    expect([...counts.keys()].sort()).toEqual(Object.keys(RESULT_TYPES).sort());
    expect(counts.get('ResDropTable')).toBeGreaterThan(0);

    // The measured totals, asserted against the real checkout when it exists (CI has only
    // the clone, which is why this is conditional rather than a hard number).
    if (existsSync(REAL_QUEST_DIR)) {
      // Re-measured at the owner's f9a1055 baseline (D79). 381 before the merge; the whole
      // delta is ResActorDialog +5, ResDropTable 317→323, ResAddDynaMod 13→34,
      // ResTeleport 1→8, ResPlaySound 1→2.
      expect(realNodes).toBe(421);
      expect(realCounts.get('ResActorDialog')).toBe(5);
      expect(realCounts.get('ResDropTable')).toBe(323);
      expect(realCounts.get('ResLearnSpell')).toBe(21);
      expect(realCounts.get('ResAddDynaMod')).toBe(34);
      expect(realCounts.get('ResGiveSpell')).toBe(10);
      expect(realCounts.get('ResDrawHand')).toBe(8);
      expect(realCounts.get('ResPostEvent')).toBe(3);
      expect(realCounts.get('ResAddSpell')).toBe(2);
      expect(realCounts.get('ResTeleport')).toBe(8);
      expect(realCounts.get('ResPlaySound')).toBe(2);
    }
    console.log(
      `[p3-07 corpus] ${files} files, ${wrappers} wrappers (${wrappersWithType} tagged), ` +
        `${nodes} result nodes (${realNodes} in the real checkout, all 15 types present, ` +
        `ResActorDialog ${realCounts.get('ResActorDialog')}), ` +
        `ResDropTable ${realCounts.get('ResDropTable')}, ResLearnSpell ` +
        `${realCounts.get('ResLearnSpell')}, ${routers} router sub-objects — key order and ` +
        `bytes identical to both corpora`,
    );
  });
});
