import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

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
import { DEFAULT_SPIRALDB_PATH } from '@server/db';

import {
  ABSENT_TAG_LABEL,
  ADD_DIALOG_ENTRY_LABEL,
  ADD_DIALOG_TAG_LABEL,
  DIALOG_ACCORDIONS,
  DIALOG_ENTRY_FIELD_SPECS,
  DIALOG_ENTRY_KEY_ORDER,
  DIALOG_ENTRY_KEY_SHAPES,
  DIALOG_SELECT_UNSET_LABEL,
  EMPTY_TAG_LABEL,
  KNOWN_ENTRY_KEYS,
  KNOWN_GROUP_KEYS,
  NAME_ST_KEYS,
  addDialogEntryEdits,
  addDialogTagEdits,
  deleteEntryEdits,
  dialogEntryPath,
  dialogEntriesPath,
  dialogFieldSpec,
  dialogFieldsInAccordion,
  dialogFieldsInGroup,
  dialogNumberOptions,
  dialogNumberSelectValue,
  dialogScalarText,
  dialogSelectOptions,
  dialogTagLabel,
  dialogTypeString,
  dialogGroups,
  dialogGroupEntries,
  duplicateEntryEdits,
  newDialogEntry,
  newDialogGroup,
  newDialogList,
  dialogEntryFieldPath,
  dialogEntryValueKeys,
  parseStringListText,
  rawEntryFields,
  readDialogList,
  setDialogTagEdit,
  setEntryBooleanFieldEdit,
  setEntryIdFieldEdit,
  setEntryNumberFieldEdit,
  setEntryNumberSelectEdit,
  setEntryStringListEdit,
  setEntryTextFieldEdit,
  stringKeyDisplay,
  stringListToText,
  unmodelledEntryKeys,
  unmodelledGroupKeys,
  type DialogFieldSpec,
  type DialogFieldGroup,
} from '../../client/src/lib/quest-dialog';

/**
 * The Dialog editor's pure rules (plan task 3.8 / story p3-08).
 *
 * Everything asserted here is a rule a browser cannot state more clearly: the 66-field
 * inventory keyed to the corpus's own order, the 5-accordion mapping onto the domain
 * reference's 7 groups, the read helpers' treatment of the corpus's own oddities (three entry
 * key orders, an empty tag, an empty `m_dialogs`, a `null` group key), and the edit builders
 * applied to real documents through `applyEdits` so the assertions are about documents rather
 * than intermediate objects.
 *
 * The `$type` literals and the 66-key order are **spelled out in full** rather than imported —
 * and the arm below asserts they equal the model's own {@link DIALOG_ENTRY_KEY_ORDER} and
 * {@link DIALOG_ENTRY_KEY_SHAPES}, so the test cannot prove the model agrees with itself while
 * the model still cannot disagree with the measurement (D79).
 *
 * The measured corpus facts (**328** files, **797** lists, **769** list-mounted tag groups out
 * of the corpus's 774, **1876** entries in those groups — 1884 with the 5 typed `ActorDialog`
 * blocks, which the results sweep owns — the **five** entry shapes 1860/7/6/2/1, 43 empty lists,
 * tags Completion 442 / Prep 322 / "" 5 / Hyperlink 5) are re-measured at the owner's `f9a1055`
 * baseline (D79; the 322-file numbers were 767/739/1706 in three shapes 1698/6/2 and tags
 * 418/316/5). The sweep at the bottom does the measuring and prints the numbers; it skips with an
 * explicit reason when no corpus exists on the machine (CI has no corpus — the
 * `quest-roundtrip.test.ts` pattern).
 */

/* ------------------------------------------------------------- fixtures */

const ENTRY_TYPE = 'Imcodec.ObjectProperty.TypeCache.NPCDialogEntry, Imcodec.ObjectProperty';
const LIST_TYPE = 'Imcodec.ObjectProperty.TypeCache.ActorDialogList, Imcodec.ObjectProperty';

/**
 * The corpus's own 66-key entry order, hand-written from the measurement (`$type` first). It
 * doubles as the new-entry order, so a model that reordered a field fails here.
 */
const FULL_ORDER = [
  '$type',
  'm_personaName',
  'm_nameOverride',
  'm_nameSTKey',
  'm_guiDisplay',
  'm_maxTimeSeconds',
  'm_invisible',
  'm_requirements',
  'm_dialog',
  'm_picture',
  'm_soundFile',
  'm_action',
  'm_dialogEvent',
  'm_actorTemplateID',
  'm_cameraName',
  'm_interpolationDuration',
  'm_cameraOffsetX',
  'm_cameraOffsetY',
  'm_cameraOffsetZ',
  'm_pitch',
  'm_yaw',
  'm_roll',
  'm_cameraShakeType',
  'm_cameraShakeDuration',
  'm_cameraShakeAmplitude',
  'm_bypassCameraOnReview',
  'm_cameraZoneName',
  'm_duration',
  'm_delay',
  'm_cameraHidePlayers',
  'm_walkAwayNpcTemplateID',
  'm_walkAwayExitDirectionInDegrees',
  'm_walkAwayFadeTime',
  'm_walkAwayUseCurrentFacing',
  'm_standInPlayerTag',
  'm_fadeOutCamera',
  'm_snapCameraToPlayerAtExit',
  'm_secondaryCameraName',
  'm_secondaryInterpolationDuration',
  'm_npcStandInList',
  'm_dialogAnimationList',
  'm_dialogTurningList',
  'm_npcYawOffsetInDegrees',
  'm_allowPlayerToMove',
  'm_soundEffectFile',
  'm_musicFile',
  'm_nonStackableMusic',
  'm_nonRepeatableMusic',
  'm_playMusicAtSFXVolume',
  'm_soundEffectDelay',
  'm_musicDelay',
  'm_musicFadeTime',
  'm_dontReleaseCameraAtExit',
  'm_disableBackButton',
  'm_enableExitButton',
  'm_cameraFadeType',
  'm_cameraFadeTime',
  'm_idleAnimation',
  'm_spamTime',
  'm_playSoundIfSpamming',
  'm_playMusicIfSpamming',
  'm_stopMusicFadeTime',
  'm_restartMusicFadeTime',
  'm_meetsRequirements',
  'm_secondaryCameraInitalDelay',
  'm_displayButtonsOnTimedDialog',
];

/** The 6-key sparse order's missing keys (`WC-TRITON-MAIN-002`; was two entries). */
const MISSING_60 = [
  'm_personaName',
  'm_nameOverride',
  'm_nameSTKey',
  'm_guiDisplay',
  'm_maxTimeSeconds',
  'm_invisible',
];

/** The 45-key order's missing keys (everything after `m_soundEffectFile`). */
const MISSING_45 = [
  'm_musicFile',
  'm_nonStackableMusic',
  'm_nonRepeatableMusic',
  'm_playMusicAtSFXVolume',
  'm_soundEffectDelay',
  'm_musicDelay',
  'm_musicFadeTime',
  'm_dontReleaseCameraAtExit',
  'm_disableBackButton',
  'm_enableExitButton',
  'm_cameraFadeType',
  'm_cameraFadeTime',
  'm_idleAnimation',
  'm_spamTime',
  'm_playSoundIfSpamming',
  'm_playMusicIfSpamming',
  'm_stopMusicFadeTime',
  'm_restartMusicFadeTime',
  'm_meetsRequirements',
  'm_secondaryCameraInitalDelay',
  'm_displayButtonsOnTimedDialog',
];

/**
 * The **documented entry shapes**. The key lists live in the model
 * (`lib/quest-dialog.ts`'s {@link DIALOG_ENTRY_KEY_SHAPES}, one home for every measured key
 * list, count and provenance address — D79); this test keeps its own hand-written
 * {@link FULL_ORDER} and asserts the two are equal, so the model cannot silently disagree with
 * the corpus's own order, and the sweep below then checks every real entry against them.
 */
function moduleShape(name: string): readonly string[] {
  const shape = DIALOG_ENTRY_KEY_SHAPES.find((candidate) => candidate.name === name);
  expect(shape, name).toBeDefined();
  return (shape as { keys: readonly string[] }).keys;
}

/** The full shape is the test's own pin (see the header). */
const SHAPE_FULL = FULL_ORDER;
/** The 65-key shape with the null-valued `m_dialogEvent` omitted (new at `f9a1055`). */
const SHAPE_NO_DIALOG_EVENT = moduleShape('noDialogEvent65');
const SHAPE_60 = moduleShape('sparse60');
const SHAPE_45 = moduleShape('truncated45');
/**
 * The shape measured in the **D17 clone** only: 65 keys with `m_requirements` omitted, in the
 * two files this tool itself wrote (`WC-CYCLOPS-MAIN-002`, `WC-UNICORN-MAIN-004`) — the
 * `NullValueHandling.Ignore` shape D57(a) names. Their tag groups likewise omit the null-valued
 * `m_dialogEvents` ({@link GROUP_ORDER_NULL_OMITTED}).
 */
const SHAPE_65 = moduleShape('nullOmitted65');
/** The 58-key shape with no `$type`, no persona prefix and no `m_requirements` (new). */
const SHAPE_58 = moduleShape('sparse58NoType');

/** The corpus's own 6-key group order. */
const GROUP_ORDER = [
  'm_dialogTag',
  'm_dialogEntries',
  'm_madlibs',
  'm_dialogEvents',
  'm_noAggroWhileDialogIsUp',
  'm_noAggroNoDelay',
];

/** The same order with the null-valued `m_dialogEvents` omitted (the D17 clone's shape). */
const GROUP_ORDER_NULL_OMITTED = GROUP_ORDER.filter((key) => key !== 'm_dialogEvents');

/** A minimal quest carrying one dialog list, for the path-addressed builders. */
function questWithList(list: unknown): Record<string, unknown> {
  return { m_questName: 'Q', m_dialogList: list };
}

/** Apply a single possibly-null builder result (a null is "nothing to change"). */
function oneEdit(edit: DocEdit | null): DocEdit[] {
  return edit === null ? [] : [edit];
}

/** `applyEdits` returns `unknown`; the assertions about documents want a record. */
function asRecord(doc: unknown): Record<string, unknown> {
  return doc as Record<string, unknown>;
}

/* ------------------------------------------------------ the field inventory */

describe('the 66-key inventory', () => {
  it('covers every corpus key — the tag plus exactly 65 value fields — with no duplicates', () => {
    // 66 modelled fields = the corpus's 65 value keys + the one spec-listed synthetic field.
    expect(DIALOG_ENTRY_FIELD_SPECS).toHaveLength(66);
    expect(dialogEntryValueKeys()).toHaveLength(65);
    const keys = DIALOG_ENTRY_FIELD_SPECS.map((field) => field.key);
    expect(new Set(keys).size).toBe(66);
    expect(Object.keys(newDialogEntry())).toEqual(FULL_ORDER);
    expect(Object.keys(newDialogEntry())).toHaveLength(66);
    expect(KNOWN_ENTRY_KEYS).toHaveLength(67); // 66 corpus keys + the synthetic spec field
    expect(KNOWN_ENTRY_KEYS).toContain('$type');
    expect(KNOWN_ENTRY_KEYS).toContain('m_defaultDialogAnimation');
    // The one spec-listed key no corpus entry carries is marked synthetic, as are the two
    // corpus-empty slots the story names.
    expect(dialogFieldSpec('m_defaultDialogAnimation')?.synthetic).toBe(true);
    expect(dialogFieldSpec('m_requirements')?.synthetic).toBe(true);
    expect(dialogFieldSpec('m_action')?.synthetic).toBeUndefined();
  });

  it('agrees with the model’s measured shape table, which is the one home for the key lists', () => {
    // The model carries the measurement (DIALOG_ENTRY_KEY_ORDER / DIALOG_ENTRY_KEY_SHAPES); this
    // test carries an independent hand-written order. Both are asserted, so neither can drift.
    expect(DIALOG_ENTRY_KEY_ORDER).toEqual(FULL_ORDER);
    expect(DIALOG_ENTRY_KEY_SHAPES.map((shape) => shape.name)).toEqual([
      'full66',
      'noDialogEvent65',
      'sparse60',
      'truncated45',
      'sparse58NoType',
      'nullOmitted65',
    ]);
    // The five corpus shapes cover the 1,884 measured entries exactly (the sixth is the D17
    // clone's own write), so the counts are a partition of the measurement, not a decoration.
    const corpusCounts = DIALOG_ENTRY_KEY_SHAPES.filter(
      (shape) => shape.name !== 'nullOmitted65',
    ).map((shape) => shape.measuredCount);
    expect(corpusCounts.reduce((sum, count) => sum + count, 0)).toBe(1884);
    expect(
      DIALOG_ENTRY_KEY_SHAPES.find((shape) => shape.name === 'nullOmitted65')?.measuredCount,
    ).toBe(35);
    // Every shape's key list is a real subset of the full order, in the full order.
    for (const shape of DIALOG_ENTRY_KEY_SHAPES) {
      expect(shape.keys).toEqual(FULL_ORDER.filter((key) => shape.keys.includes(key)));
    }
  });

  it('spells out the two $type literals from the 3.1 constant table', () => {
    expect(newDialogEntry().$type).toBe(ENTRY_TYPE);
    expect(newDialogList().$type).toBe(LIST_TYPE);
    expect(Object.keys(newDialogList())).toEqual(['$type', 'm_dialogs']);
  });

  it('maps the 5 accordions onto the 7 field groups with Basic open by default', () => {
    expect(DIALOG_ACCORDIONS.map((accordion) => accordion.id)).toEqual([
      'Basic',
      'Camera',
      'Sound',
      'Animation',
      'Advanced',
    ]);
    expect(
      DIALOG_ACCORDIONS.filter((accordion) => accordion.openByDefault).map((a) => a.id),
    ).toEqual(['Basic']);
    // Every one of the domain reference's seven groups appears in exactly one accordion.
    const grouped = DIALOG_ACCORDIONS.flatMap((accordion) => accordion.groups);
    const expectedGroups: DialogFieldGroup[] = [
      'Basic',
      'Camera',
      'Duration & Timing',
      'Walk-Away',
      'Audio',
      'Animation & NPC',
      'UI Controls',
    ];
    expect([...grouped].sort()).toEqual([...expectedGroups].sort());
    expect(new Set(grouped).size).toBe(expectedGroups.length);
    // …and the fields partition by group, so no field is unreachable and none is duplicated.
    const inGroups = expectedGroups.flatMap((group) =>
      dialogFieldsInGroup(group).map((f) => f.key),
    );
    expect(inGroups.sort()).toEqual(DIALOG_ENTRY_FIELD_SPECS.map((field) => field.key).sort());
    // Advanced is the three groups the spec's five tabs leave over, plus the Basic group's three
    // `advanced`-tier fields (task 7.11); Basic keeps its ten `basic`-tier ones.
    const accordion = (id: string) => DIALOG_ACCORDIONS.find((entry) => entry.id === id) as never;
    expect(dialogFieldsInAccordion(accordion('Advanced')).length).toBe(17);
    expect(dialogFieldsInAccordion(accordion('Basic')).length).toBe(10);
    expect(dialogFieldsInAccordion(accordion('Camera')).length).toBe(22);
    expect(dialogFieldsInAccordion(accordion('Sound')).length).toBe(10);
    expect(dialogFieldsInAccordion(accordion('Animation')).length).toBe(7);
  });

  it('carries the measured accordion of every named field', () => {
    // The spec's own Basic ASCII list, plus the domain reference's Basic additions.
    for (const key of [
      'm_dialog',
      'm_picture',
      'm_actorTemplateID',
      'm_maxTimeSeconds',
      'm_invisible',
      'm_requirements',
      'm_soundFile',
    ]) {
      expect(dialogFieldSpec(key)?.group).toBe('Basic');
    }
    expect(dialogFieldSpec('m_soundEffectFile')?.group).toBe('Audio');
    expect(dialogFieldSpec('m_musicFile')?.group).toBe('Audio');
    expect(dialogFieldSpec('m_cameraHidePlayers')?.group).toBe('Camera');
    expect(dialogFieldSpec('m_walkAwayNpcTemplateID')?.group).toBe('Walk-Away');
    expect(dialogFieldSpec('m_displayButtonsOnTimedDialog')?.group).toBe('Duration & Timing');
    expect(dialogFieldSpec('m_meetsRequirements')?.group).toBe('UI Controls');
    expect(dialogFieldSpec('m_npcStandInList')?.group).toBe('Animation & NPC');
    // The two reference fields and their measured sources.
    expect(dialogFieldSpec('m_actorTemplateID')?.nameSources).toEqual(['npcs']);
    expect(dialogFieldSpec('m_actorTemplateID')?.idValueType).toBe('number');
    expect(dialogFieldSpec('m_walkAwayNpcTemplateID')?.nameSources).toEqual(['npcs']);
    expect(dialogFieldSpec('m_cameraZoneName')?.nameSources).toEqual(['zones']);
    expect(dialogFieldSpec('m_cameraZoneName')?.idValueType).toBe('string');
    // The string-key fields and their measured suggestions.
    expect(dialogFieldSpec('m_dialog')?.kind).toBe('string-key');
    expect(dialogFieldSpec('m_nameSTKey')?.kind).toBe('string-key');
    expect(dialogFieldSpec('m_nameSTKey')?.options).toEqual([...NAME_ST_KEYS]);
    // The numeric select's measured domain.
    expect(dialogFieldSpec('m_cameraHidePlayers')?.kind).toBe('number-select');
    expect(dialogFieldSpec('m_cameraHidePlayers')?.options).toEqual([0, 1, 2, 3]);
    for (const key of ['m_npcStandInList', 'm_dialogAnimationList', 'm_dialogTurningList']) {
      expect(dialogFieldSpec(key)?.kind).toBe('string-list');
    }
    expect(dialogFieldSpec('m_requirements')?.kind).toBe('requirements');
  });

  it('builds a new tag group and list in the corpus’s own orders and values', () => {
    const group = newDialogGroup();
    expect(Object.keys(group)).toEqual(GROUP_ORDER);
    expect(group).toEqual({
      m_dialogTag: 'Prep',
      // 0 of the 774 corpus groups has an empty m_dialogEntries, so a new group starts with
      // one entry (p3-06's rule for a new requirement group) rather than an empty array.
      m_dialogEntries: [newDialogEntry()],
      m_madlibs: null,
      m_dialogEvents: null,
      m_noAggroWhileDialogIsUp: false,
      m_noAggroNoDelay: false,
    });
    expect((group.m_dialogEntries as unknown[]).length).toBe(1);
    expect(Object.keys((group.m_dialogEntries as unknown[])[0] as object)).toEqual(FULL_ORDER);
    expect(newDialogGroup('').m_dialogTag).toBe('');
    expect(KNOWN_GROUP_KEYS).toEqual(GROUP_ORDER);
  });

  it('writes a new entry with the corpus’s full 66 keys and no synthetic key', () => {
    const entry = newDialogEntry();
    expect(Object.keys(entry)).toHaveLength(66);
    expect(Object.keys(entry)).toEqual(FULL_ORDER);
    // `m_defaultDialogAnimation` is corpus-absent and is deliberately not written, while the
    // corpus-present but always-null `m_requirements` is.
    expect(hasAtPath(entry, ['m_defaultDialogAnimation'])).toBe(false);
    expect(entry.m_requirements).toBeNull();
  });
});

/* --------------------------------------------------------- the read helpers */

describe('the read helpers', () => {
  it('reads the three levels and the empty/null states without inventing anything', () => {
    // Absent and explicit null are both "no list", and both keep the Add control.
    for (const value of [undefined, null]) {
      const view = readDialogList(['m_dialogList'], value);
      expect(view.readable).toBe(false);
      expect(view.groups).toEqual([]);
      expect(view.dialogsPresent).toBe(false);
      expect(view.typeString).toBeNull();
    }

    // The measured empty-array state (43 of 797 lists) is a readable list with no groups.
    const empty = readDialogList(['m_dialogList'], { $type: LIST_TYPE, m_dialogs: [] });
    expect(empty.readable).toBe(true);
    expect(empty.typeString).toBe(LIST_TYPE);
    expect(empty.dialogsPresent).toBe(true);
    expect(empty.groups).toEqual([]);

    // A list whose m_dialogs is not an array is still readable and still not padded.
    const wrong = readDialogList(['m_dialogList'], { $type: LIST_TYPE, m_dialogs: null });
    expect(wrong.dialogsPresent).toBe(false);
    expect(wrong.groups).toEqual([]);
  });

  it('labels the empty tag, the absent tag and an unreadable group', () => {
    const view = readDialogList(['m_dialogList'], {
      $type: LIST_TYPE,
      m_dialogs: [
        { m_dialogTag: '', m_dialogEntries: [] },
        { m_dialogEntries: [] },
        'not-an-object',
        { $type: 'a-foreign-but-readable-group' },
      ],
    });
    expect(view.groups[0]?.tagLabel).toBe(EMPTY_TAG_LABEL);
    expect(view.groups[0]?.tag).toBe('');
    expect(view.groups[1]?.tagLabel).toBe(ABSENT_TAG_LABEL);
    expect(view.groups[1]?.tagPresent).toBe(false);
    expect(view.groups[2]?.readable).toBe(false);
    expect(view.groups[2]?.entries).toEqual([]);
    // A foreign `$type` on a group is still a readable object (the group's own tag is absent).
    expect(view.groups[3]?.readable).toBe(true);
    expect(view.groups[3]?.tagLabel).toBe(ABSENT_TAG_LABEL);
    expect(dialogTagLabel({ m_dialogTag: 'Prep' })).toBe('Prep');
    expect(dialogTagLabel({ m_dialogTag: 7 })).toBe(ABSENT_TAG_LABEL);
  });

  it('keeps a non-object entry visible instead of dropping it', () => {
    const view = readDialogList(['m_dialogList'], {
      $type: LIST_TYPE,
      m_dialogs: [{ m_dialogTag: 'Prep', m_dialogEntries: ['broken', { $type: ENTRY_TYPE }] }],
    });
    const entries = view.groups[0]?.entries ?? [];
    expect(entries).toHaveLength(2);
    expect(entries[0]?.readable).toBe(false);
    expect(entries[0]?.ordinal).toBe('Entry 1');
    expect(entries[0]?.fields.every((field) => !field.present)).toBe(true);
    expect(entries[1]?.readable).toBe(true);
    expect(entries[1]?.typeString).toBe(ENTRY_TYPE);
  });

  it('addresses every level, entry and field by its absolute document path', () => {
    const listPath: DocPath = ['m_goals', 2, 'm_dialogList'];
    expect(dialogEntriesPath(listPath, 1)).toEqual([
      'm_goals',
      2,
      'm_dialogList',
      'm_dialogs',
      1,
      'm_dialogEntries',
    ]);
    expect(dialogEntryPath(listPath, 1, 3)).toEqual([
      'm_goals',
      2,
      'm_dialogList',
      'm_dialogs',
      1,
      'm_dialogEntries',
      3,
    ]);
    const view = readDialogList(listPath, {
      $type: LIST_TYPE,
      m_dialogs: [
        { m_dialogTag: 'Prep', m_dialogEntries: [{ $type: ENTRY_TYPE, m_personaName: 'P' }] },
      ],
    });
    const entry = view.groups[0]?.entries[0];
    expect(entry?.address).toBe('m_goals[2].m_dialogList.m_dialogs[0].m_dialogEntries[0]');
    expect(entry?.personaName).toBe('P');
    expect(entry?.keys).toEqual(['$type', 'm_personaName']);
    // A field view is at the entry's own path plus its key.
    expect(entry?.fields.find((field) => field.spec.key === 'm_personaName')?.path).toEqual([
      'm_goals',
      2,
      'm_dialogList',
      'm_dialogs',
      0,
      'm_dialogEntries',
      0,
      'm_personaName',
    ]);
    expect(entry?.fields.find((field) => field.spec.key === 'm_personaName')?.present).toBe(true);
    expect(entry?.fields.find((field) => field.spec.key === 'm_dialog')?.present).toBe(false);
    expect(dialogGroups({ m_dialogs: [] })).toEqual([]);
    expect(dialogGroupEntries({ m_dialogEntries: [1] })).toEqual([1]);
    expect(dialogGroups('nope')).toEqual([]);
    expect(dialogTypeString({ $type: ENTRY_TYPE })).toBe(ENTRY_TYPE);
    expect(dialogTypeString({ $type: 7 })).toBeNull();
  });
});

/* ------------------------------------------------------------ the builders */

describe('the list and group builders', () => {
  it('adds a tag in three presence shapes and never invents a $type', () => {
    // 1. The array exists — one insert into it (the corpus's own case).
    const withArray = questWithList({ $type: LIST_TYPE, m_dialogs: [] });
    const inserted = asRecord(
      applyEdits(
        loadDoc(withArray),
        addDialogTagEdits(['m_dialogList'], 0, { list: true, dialogs: true }, 'Completion'),
      ),
    );
    expect(Object.keys(inserted.m_dialogList as object)).toEqual(['$type', 'm_dialogs']);
    expect(getAtPath(inserted, ['m_dialogList', 'm_dialogs', 0])).toEqual(
      newDialogGroup('Completion'),
    );

    // 2. The wrapper exists but its array does not — one set of m_dialogs.
    const noArray = questWithList({ $type: LIST_TYPE, m_dialogs: null });
    const setArray = asRecord(
      applyEdits(
        loadDoc(noArray),
        addDialogTagEdits(['m_dialogList'], 0, { list: true, dialogs: false }),
      ),
    );
    expect(Object.keys(setArray.m_dialogList as object)).toEqual(['$type', 'm_dialogs']);
    expect(getAtPath(setArray, ['m_dialogList', 'm_dialogs', 0])).toEqual(newDialogGroup());

    // 3. The wrapper is absent or null — one set of the whole corpus-shaped list. `list` is
    // the caller's "the wrapper is an object" flag, so a `null` wrapper takes the same branch
    // as an absent one (and the parent of `m_dialogList` is the quest, so the set is legal).
    for (const wrapper of [undefined, null]) {
      const doc = questWithList(wrapper);
      const created = asRecord(
        applyEdits(
          loadDoc(doc),
          addDialogTagEdits(['m_dialogList'], 0, { list: false, dialogs: false }),
        ),
      );
      expect(created.m_dialogList).toEqual({
        $type: LIST_TYPE,
        m_dialogs: [newDialogGroup()],
      });
      expect(Object.keys(created.m_dialogList as object)).toEqual(['$type', 'm_dialogs']);
    }
  });

  it('adds an entry in two presence shapes, into the group it belongs to', () => {
    const doc = questWithList({
      $type: LIST_TYPE,
      m_dialogs: [
        { m_dialogTag: 'Prep', m_dialogEntries: [] },
        { m_dialogTag: 'Completion', m_dialogEntries: [] },
      ],
    });
    const added = applyEdits(
      loadDoc(doc),
      addDialogEntryEdits(['m_dialogList'], 1, 0, { entries: true }),
    );
    const groups = getAtPath(added, ['m_dialogList', 'm_dialogs']) as Array<
      Record<string, unknown>
    >;
    // The sibling group is untouched (it keeps its own two keys), and the new entry landed in
    // the group that was asked for.
    expect(Object.keys(groups[0] as object)).toEqual(['m_dialogTag', 'm_dialogEntries']);
    expect(groups[0]?.m_dialogEntries).toEqual([]);
    expect(
      Object.keys((groups[1] as { m_dialogEntries: unknown[] }).m_dialogEntries[0] as object),
    ).toEqual(FULL_ORDER);
    // An absent entry array takes one set of that one key; the sibling group keys are untouched.
    const absent = asRecord(
      applyEdits(
        loadDoc(questWithList({ $type: LIST_TYPE, m_dialogs: [{ m_dialogTag: 'Prep' }] })),
        addDialogEntryEdits(['m_dialogList'], 0, 0, { entries: false }),
      ),
    );
    expect(absent.m_dialogList).toEqual({
      $type: LIST_TYPE,
      m_dialogs: [{ m_dialogTag: 'Prep', m_dialogEntries: [newDialogEntry()] }],
    });
  });

  it('deletes exactly one entry', () => {
    const doc = questWithList({
      $type: LIST_TYPE,
      m_dialogs: [
        {
          m_dialogTag: 'Prep',
          m_dialogEntries: [
            { $type: ENTRY_TYPE, m_dialog: 'a' },
            { $type: ENTRY_TYPE, m_dialog: 'b' },
          ],
        },
      ],
    });
    const deleted = applyEdits(loadDoc(doc), deleteEntryEdits(['m_dialogList'], 0, 0));
    expect(getAtPath(deleted, ['m_dialogList', 'm_dialogs', 0, 'm_dialogEntries'])).toEqual([
      { $type: ENTRY_TYPE, m_dialog: 'b' },
    ]);
  });

  it('duplicates an entry verbatim, keeping a sparse shape sparse and a legacy key intact', () => {
    const sparse: Record<string, unknown> = {};
    for (const key of SHAPE_45) {
      sparse[key] = key === '$type' ? ENTRY_TYPE : null;
    }
    sparse.m_dialog = 'WizQst1ED39_00000004';
    sparse.m_legacyKey = 'kept';
    const doc = questWithList({
      $type: LIST_TYPE,
      m_dialogs: [{ m_dialogTag: 'Prep', m_dialogEntries: [sparse] }],
    });
    const duplicated = applyEdits(
      loadDoc(doc),
      duplicateEntryEdits(['m_dialogList'], 0, 0, sparse),
    );
    const entries = getAtPath(duplicated, [
      'm_dialogList',
      'm_dialogs',
      0,
      'm_dialogEntries',
    ]) as unknown[];
    expect(entries).toHaveLength(2);
    expect(Object.keys(entries[1] as object)).toEqual(Object.keys(sparse));
    expect(isDeepStrictEqual(entries[1], sparse)).toBe(true);
    // The copy is independent: mutating the source object does not move the inserted value.
    sparse.m_dialog = 'changed';
    expect(
      getAtPath(duplicated, ['m_dialogList', 'm_dialogs', 0, 'm_dialogEntries', 1, 'm_dialog']),
    ).toBe('WizQst1ED39_00000004');
    // Nothing to duplicate is not a crash.
    expect(duplicateEntryEdits(['m_dialogList'], 0, 0, 'broken')).toEqual([]);
  });

  it('writes the tag verbatim, including the empty string the corpus carries 5 times', () => {
    const doc = questWithList({
      $type: LIST_TYPE,
      m_dialogs: [newDialogGroup('Prep')],
    });
    const renamed = applyEdits(loadDoc(doc), [setDialogTagEdit(['m_dialogList'], 0, 'Completion')]);
    expect(getAtPath(renamed, ['m_dialogList', 'm_dialogs', 0, 'm_dialogTag'])).toBe('Completion');
    // Emptying it keeps the key (the uniform 6-key order) and writes the measured "".
    const emptied = applyEdits(loadDoc(doc), [setDialogTagEdit(['m_dialogList'], 0, '')]);
    expect(Object.keys(getAtPath(emptied, ['m_dialogList', 'm_dialogs', 0]) as object)).toEqual(
      GROUP_ORDER,
    );
    expect(getAtPath(emptied, ['m_dialogList', 'm_dialogs', 0, 'm_dialogTag'])).toBe('');
  });
});

describe('the field builders', () => {
  const present = true;

  it('deletes a text key when emptied, and produces no edit when it was absent (D59c)', () => {
    expect(setEntryTextFieldEdit(['m_dialogList'], 0, 0, 'm_dialog', present, '')).toEqual({
      op: 'delete',
      path: ['m_dialogList', 'm_dialogs', 0, 'm_dialogEntries', 0, 'm_dialog'],
    });
    expect(setEntryTextFieldEdit(['m_dialogList'], 0, 0, 'm_dialog', false, '')).toBeNull();
    expect(setEntryTextFieldEdit(['m_dialogList'], 0, 0, 'm_dialog', present, 'Key_1')).toEqual({
      op: 'set',
      path: ['m_dialogList', 'm_dialogs', 0, 'm_dialogEntries', 0, 'm_dialog'],
      value: 'Key_1',
    });
  });

  it('writes numbers exactly as parsed, never a NaN, and deletes on empty', () => {
    const path = ['m_dialogList', 'm_dialogs', 0, 'm_dialogEntries', 0, 'm_maxTimeSeconds'];
    expect(
      setEntryNumberFieldEdit(['m_dialogList'], 0, 0, 'm_maxTimeSeconds', present, '-1'),
    ).toEqual({
      op: 'set',
      path,
      value: -1,
    });
    expect(
      setEntryNumberFieldEdit(['m_dialogList'], 0, 0, 'm_maxTimeSeconds', present, '1e'),
    ).toBeNull();
    expect(
      setEntryNumberFieldEdit(['m_dialogList'], 0, 0, 'm_maxTimeSeconds', present, ' '),
    ).toEqual({
      op: 'delete',
      path,
    });
    expect(
      setEntryNumberFieldEdit(['m_dialogList'], 0, 0, 'm_maxTimeSeconds', false, ''),
    ).toBeNull();
  });

  it('writes booleans, and the numeric select writes numbers rather than strings', () => {
    expect(setEntryBooleanFieldEdit(['m_dialogList'], 0, 0, 'm_invisible', true)).toEqual({
      op: 'set',
      path: ['m_dialogList', 'm_dialogs', 0, 'm_dialogEntries', 0, 'm_invisible'],
      value: true,
    });
    const path = ['m_dialogList', 'm_dialogs', 0, 'm_dialogEntries', 0, 'm_cameraHidePlayers'];
    expect(
      setEntryNumberSelectEdit(['m_dialogList'], 0, 0, 'm_cameraHidePlayers', present, '3'),
    ).toEqual({
      op: 'set',
      path,
      value: 3,
    });
    expect(
      setEntryNumberSelectEdit(['m_dialogList'], 0, 0, 'm_cameraHidePlayers', present, ''),
    ).toEqual({
      op: 'delete',
      path,
    });
    expect(
      setEntryNumberSelectEdit(['m_dialogList'], 0, 0, 'm_cameraHidePlayers', false, ''),
    ).toBeNull();
    expect(dialogNumberSelectValue(2)).toBe('2');
    expect(dialogNumberSelectValue(null)).toBe('');
    expect(dialogNumberSelectValue('2')).toBe('');
  });

  it('writes a friendly-name id as the field’s own JSON type and never rewrites a miss', () => {
    const npc = dialogFieldSpec('m_actorTemplateID') as DialogFieldSpec;
    const zone = dialogFieldSpec('m_cameraZoneName') as DialogFieldSpec;
    expect(setEntryIdFieldEdit(['m_dialogList'], 0, 0, npc, present, '126322')).toEqual({
      op: 'set',
      path: ['m_dialogList', 'm_dialogs', 0, 'm_dialogEntries', 0, 'm_actorTemplateID'],
      value: 126322,
    });
    // `0` is a corpus value (330 entries) — it stays a number and is never emptied.
    expect(setEntryIdFieldEdit(['m_dialogList'], 0, 0, npc, present, '0')).toEqual({
      op: 'set',
      path: ['m_dialogList', 'm_dialogs', 0, 'm_dialogEntries', 0, 'm_actorTemplateID'],
      value: 0,
    });
    expect(setEntryIdFieldEdit(['m_dialogList'], 0, 0, npc, present, 'x')).toBeNull();
    expect(setEntryIdFieldEdit(['m_dialogList'], 0, 0, zone, present, 'WizardCity/WC_Hub')).toEqual(
      {
        op: 'set',
        path: ['m_dialogList', 'm_dialogs', 0, 'm_dialogEntries', 0, 'm_cameraZoneName'],
        value: 'WizardCity/WC_Hub',
      },
    );
    expect(setEntryIdFieldEdit(['m_dialogList'], 0, 0, zone, present, '')).toEqual({
      op: 'delete',
      path: ['m_dialogList', 'm_dialogs', 0, 'm_dialogEntries', 0, 'm_cameraZoneName'],
    });
    expect(setEntryIdFieldEdit(['m_dialogList'], 0, 0, zone, false, '')).toBeNull();
  });

  it('writes string lists as arrays, saying [] rather than deleting a key that exists', () => {
    const path = ['m_dialogList', 'm_dialogs', 0, 'm_dialogEntries', 0, 'm_dialogAnimationList'];
    expect(
      setEntryStringListEdit(['m_dialogList'], 0, 0, 'm_dialogAnimationList', present, 'a\nb'),
    ).toEqual({ op: 'set', path, value: ['a', 'b'] });
    expect(
      setEntryStringListEdit(['m_dialogList'], 0, 0, 'm_dialogAnimationList', present, ''),
    ).toEqual({
      op: 'set',
      path,
      value: [],
    });
    expect(
      setEntryStringListEdit(['m_dialogList'], 0, 0, 'm_dialogAnimationList', false, ''),
    ).toBeNull();
  });

  it('round-trips the encoded string lists verbatim, one element per line', () => {
    expect(stringListToText(['0|126322|Gen_Dial_01|5', 'MB_MayorPimsbury instance'])).toBe(
      '0|126322|Gen_Dial_01|5\nMB_MayorPimsbury instance',
    );
    // A trailing newline adds no element; interior spelling is untouched.
    expect(parseStringListText('a|b\n')).toEqual(['a|b']);
    expect(parseStringListText('')).toEqual([]);
    expect(parseStringListText('a||b')).toEqual(['a||b']);
    expect(stringListToText(null)).toBe('');
    expect(stringListToText(3)).toBe('3');
    expect(dialogScalarText(null)).toBe('');
    expect(dialogScalarText(0)).toBe('0');
    expect(dialogScalarText({ a: 1 })).toBe('{"a":1}');
  });

  it('offers the measured domains and keeps an unlisted value selected', () => {
    expect(dialogNumberOptions(2, [0, 1, 2, 3]).map((option) => option.value)).toEqual([
      0, 1, 2, 3,
    ]);
    // An unlisted numeric value is appended, never rewritten.
    const unlisted = dialogNumberOptions(9, [0, 1, 2, 3]);
    expect(unlisted[unlisted.length - 1]).toEqual({ value: 9, label: '9', unlisted: true });
    // A null/absent value leads with the unset arm.
    expect(dialogNumberOptions(null, [0, 1]).map((option) => option.value)).toEqual(['', 0, 1]);
    expect(dialogNumberOptions(2, [0, 1]).filter((option) => option.unlisted)).toEqual([
      { value: 2, label: '2', unlisted: true },
    ]);
    // The string select mirrors the result editor's rule.
    expect(dialogSelectOptions('', ['a', 'b'])[0]).toEqual({
      value: '',
      label: DIALOG_SELECT_UNSET_LABEL,
      unlisted: false,
    });
    expect(dialogSelectOptions('c', ['a', 'b'])).toEqual([
      { value: 'a', label: 'a', unlisted: false },
      { value: 'b', label: 'b', unlisted: false },
      { value: 'c', label: 'c', unlisted: true },
    ]);
    expect(dialogSelectOptions(null, ['a'])).toEqual([
      { value: '', label: DIALOG_SELECT_UNSET_LABEL, unlisted: false },
      { value: 'a', label: 'a', unlisted: false },
    ]);
  });

  it('resolves a string key through the display rule only when there is one', () => {
    expect(stringKeyDisplay('K', { key: 'K', value: 'Hello', category: null })).toBe('Hello');
    expect(stringKeyDisplay('K', undefined)).toBe('K');
    expect(stringKeyDisplay('', { key: '', value: 'x', category: null })).toBe('');
    expect(stringKeyDisplay(null, undefined)).toBe('');
  });
});

/* ------------------------------------------------------- AC2 preservation */

describe('AC2 — an unmodelled key and the entry’s own shape survive every edit', () => {
  it('keeps a legacy key, the $type and every null when an unrelated field is edited', () => {
    const entry = {
      $type: ENTRY_TYPE,
      m_personaName: 'DS-ACAD1-NPC01_Persona',
      m_nameSTKey: null,
      m_requirements: null,
      m_cameraZoneName: null,
      m_cameraHidePlayers: 2,
      m_dialogAnimationList: ['0|126322|Gen_Dial_01|5'],
      m_legacyKey: { nested: true },
      m_legacyOther: 7,
    };
    const doc = questWithList({
      $type: LIST_TYPE,
      m_dialogs: [{ m_dialogTag: 'Prep', m_dialogEntries: [entry] }],
    });
    const edited = applyEdits(
      loadDoc(doc),
      oneEdit(
        setEntryTextFieldEdit(['m_dialogList'], 0, 0, 'm_dialog', true, 'WizQst1ED39_00000004'),
      ),
    );
    const result = getAtPath(edited, [
      'm_dialogList',
      'm_dialogs',
      0,
      'm_dialogEntries',
      0,
    ]) as Record<string, unknown>;
    // The edit appended the key at the end (the primitive's documented merge rule) and
    // touched nothing else.
    expect(Object.keys(result)).toEqual([...Object.keys(entry), 'm_dialog']);
    expect(result.$type).toBe(ENTRY_TYPE);
    expect(result.m_nameSTKey).toBeNull();
    expect(result.m_requirements).toBeNull();
    expect(result.m_cameraZoneName).toBeNull();
    expect(result.m_cameraHidePlayers).toBe(2);
    expect(result.m_dialogAnimationList).toEqual(['0|126322|Gen_Dial_01|5']);
    expect(result.m_legacyKey).toEqual({ nested: true });
    expect(result.m_legacyOther).toBe(7);
    // …and both legacy keys are disclosed rather than hidden.
    expect(unmodelledEntryKeys(result)).toEqual(['m_legacyKey', 'm_legacyOther']);
    expect(rawEntryFields(result)).toEqual({
      m_legacyKey: { nested: true },
      m_legacyOther: 7,
    });
    expect(unmodelledEntryKeys(entry)).toEqual(['m_legacyKey', 'm_legacyOther']);
    expect(unmodelledEntryKeys('broken')).toEqual([]);
    expect(rawEntryFields('broken')).toEqual({});
  });

  it('leaves a 45-key sparse entry sparse when a field it does have is edited', () => {
    const sparse: Record<string, unknown> = {};
    for (const key of SHAPE_45) {
      sparse[key] = key === '$type' ? ENTRY_TYPE : null;
    }
    sparse.m_dialog = 'WizQst1ED39_00000004';
    const doc = questWithList({
      $type: LIST_TYPE,
      m_dialogs: [{ m_dialogTag: 'Prep', m_dialogEntries: [sparse] }],
    });
    const edited = applyEdits(
      loadDoc(doc),
      oneEdit(setEntryTextFieldEdit(['m_dialogList'], 0, 0, 'm_dialog', true, 'Renamed')),
    );
    const result = getAtPath(edited, [
      'm_dialogList',
      'm_dialogs',
      0,
      'm_dialogEntries',
      0,
    ]) as Record<string, unknown>;
    expect(Object.keys(result)).toEqual(SHAPE_45);
    expect(Object.keys(result)).toHaveLength(45);
    for (const key of MISSING_45) {
      expect(hasAtPath(result, [key]), key).toBe(false);
    }
    // The 6-key sparse shape keeps its own six missing keys missing too.
    const sparse60 = applyEdits(
      loadDoc(
        questWithList({
          $type: LIST_TYPE,
          m_dialogs: [
            {
              m_dialogTag: 'Prep',
              m_dialogEntries: [
                Object.fromEntries(
                  SHAPE_60.map((key) => [key, key === '$type' ? ENTRY_TYPE : null]),
                ),
              ],
            },
          ],
        }),
      ),
      oneEdit(setEntryTextFieldEdit(['m_dialogList'], 0, 0, 'm_dialog', true, 'X')),
    );
    const result60 = getAtPath(sparse60, [
      'm_dialogList',
      'm_dialogs',
      0,
      'm_dialogEntries',
      0,
    ]) as Record<string, unknown>;
    for (const key of MISSING_60) {
      expect(hasAtPath(result60, [key]), key).toBe(false);
    }
    expect(Object.keys(result60)).toHaveLength(60);
  });

  it('never invents or reorders a $type on an entry or a list', () => {
    const doc = questWithList({
      $type: LIST_TYPE,
      m_dialogs: [
        {
          m_dialogTag: 'Prep',
          m_dialogEntries: [{ $type: 'Legacy.DialogEntry', m_dialog: 'k' }],
        },
      ],
    });
    const edited = applyEdits(
      loadDoc(doc),
      oneEdit(setEntryTextFieldEdit(['m_dialogList'], 0, 0, 'm_dialog', true, 'k2')),
    );
    expect(getAtPath(edited, ['m_dialogList', 'm_dialogs', 0, 'm_dialogEntries', 0, '$type'])).toBe(
      'Legacy.DialogEntry',
    );
    expect(
      Object.keys(
        getAtPath(edited, ['m_dialogList', 'm_dialogs', 0, 'm_dialogEntries', 0]) as object,
      ),
    ).toEqual(['$type', 'm_dialog']);
    expect(dialogTypeString(getAtPath(edited, ['m_dialogList']))).toBe(LIST_TYPE);
  });

  it('reports a legacy group key read-only and leaves it in place', () => {
    const doc = questWithList({
      $type: LIST_TYPE,
      m_dialogs: [{ m_dialogTag: 'Prep', m_dialogEntries: [], m_legacyGroupKey: 1 }],
    });
    const view = readDialogList(['m_dialogList'], getAtPath(doc, ['m_dialogList']));
    expect(view.groups[0]?.unmodelledKeys).toEqual(['m_legacyGroupKey']);
    const edited = applyEdits(loadDoc(doc), [setDialogTagEdit(['m_dialogList'], 0, 'Completion')]);
    expect(getAtPath(edited, ['m_dialogList', 'm_dialogs', 0])).toEqual({
      m_dialogTag: 'Completion',
      m_dialogEntries: [],
      m_legacyGroupKey: 1,
    });
    expect(unmodelledGroupKeys({ m_legacyGroupKey: 1 })).toEqual(['m_legacyGroupKey']);
    expect(unmodelledGroupKeys(null)).toEqual([]);
    expect(ADD_DIALOG_TAG_LABEL).toBe('Add Dialog Tag');
    expect(ADD_DIALOG_ENTRY_LABEL).toBe('Add Dialog Entry');
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

/** Every list path of one quest document: the quest level and every goal level. */
function dialogSlots(doc: unknown): DocPath[] {
  const slots: DocPath[] = [];
  const record = doc as Record<string, unknown>;
  const push = (at: DocPath, value: unknown): void => {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      slots.push(at);
    }
  };
  push(['m_dialogList'], record.m_dialogList);
  const goals = Array.isArray(record.m_goals) ? record.m_goals : [];
  goals.forEach((goal, index) => {
    push(['m_goals', index, 'm_dialogList'], (goal as Record<string, unknown>)?.m_dialogList);
  });
  return slots;
}

/**
 * A benign edit list: every **present, readable** scalar field of every entry re-set to the
 * value it already has, through the model's own builders. Applied to a real file it can only
 * move what those builders touch, so a byte-identical serialization proves that absent keys,
 * explicit `null`s, unmodelled keys, the `$type` and the key order all survive.
 *
 * `m_requirements` (null on every entry that carries it) and the synthetic raw-object field are
 * skipped: the
 * shared tree is `requirement-tree.test.ts`'s subject and neither value exists to re-set.
 */
function benignEdits(
  listPath: DocPath,
  groupIndex: number,
  entryIndex: number,
  entry: unknown,
): DocEdit[] {
  const edits: DocEdit[] = [];
  const record = entry as Record<string, unknown>;
  for (const spec of DIALOG_ENTRY_FIELD_SPECS) {
    if (spec.kind === 'requirements' || spec.kind === 'raw-object') {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(record, spec.key)) {
      continue;
    }
    const value = record[spec.key];
    const path = dialogEntryFieldPath(listPath, groupIndex, entryIndex, spec.key);
    switch (spec.kind) {
      case 'boolean':
        edits.push(
          setEntryBooleanFieldEdit(listPath, groupIndex, entryIndex, spec.key, value === true),
        );
        break;
      case 'number':
        if (value !== null) {
          const edit = setEntryNumberFieldEdit(
            listPath,
            groupIndex,
            entryIndex,
            spec.key,
            true,
            String(value),
          );
          if (edit !== null) {
            edits.push(edit);
          }
        }
        break;
      case 'number-select':
        if (value !== null) {
          const edit = setEntryNumberSelectEdit(
            listPath,
            groupIndex,
            entryIndex,
            spec.key,
            true,
            String(value),
          );
          if (edit !== null) {
            edits.push(edit);
          }
        }
        break;
      case 'friendly-name':
        if (value === '') {
          // An empty reference is a value the corpus carries (`m_cameraZoneName: ''` on 840
          // entries); the builders' contract is "emptying a control deletes the key", so the
          // benign edit re-sets it through the primitive — the claim here is that an empty
          // string passes through unchanged (and issues no lookup).
          edits.push({ op: 'set', path, value: '' });
        } else if (value !== null) {
          const edit = setEntryIdFieldEdit(
            listPath,
            groupIndex,
            entryIndex,
            spec,
            true,
            String(value),
          );
          if (edit !== null) {
            edits.push(edit);
          }
        }
        break;
      case 'string-list':
        if (value !== null) {
          const edit = setEntryStringListEdit(
            listPath,
            groupIndex,
            entryIndex,
            spec.key,
            true,
            stringListToText(value),
          );
          if (edit !== null) {
            edits.push(edit);
          }
        }
        break;
      default:
        // Text and string-key: an empty string is a value the corpus carries, so it is
        // re-set through the primitive rather than through the "emptying deletes" builder.
        if (value === '') {
          edits.push({ op: 'set', path, value: '' });
        } else if (typeof value === 'string') {
          const edit = setEntryTextFieldEdit(
            listPath,
            groupIndex,
            entryIndex,
            spec.key,
            true,
            value,
          );
          if (edit !== null) {
            edits.push(edit);
          }
        }
        break;
    }
  }
  return edits;
}

describe.skipIf(QUEST_CORPORA.length === 0)('the real corpus of dialog lists', () => {
  it('keeps every entry’s own shape, order and bytes across a benign re-set of every field', () => {
    let files = 0;
    let realFiles = 0;
    let lists = 0;
    let realLists = 0;
    let groups = 0;
    let realGroups = 0;
    let entries = 0;
    let realEmptyLists = 0;
    let taggedGroups = 0;
    let taggedEntries = 0;
    let taggedLists = 0;
    let nullRequirements = 0;
    let requirementsNotNull = 0;
    let realNullOmittedGroups = 0;
    let stringListElements = 0;
    const shapeCounts = new Map<string, number>();
    const tagCounts = new Map<string, number>();
    const realTagCounts = new Map<string, number>();
    let realEntries = 0;
    const realShapeCounts = new Map<string, number>();

    for (const dir of QUEST_CORPORA) {
      for (const file of readdirSync(dir)
        .filter((name) => name.endsWith('.json'))
        .sort()) {
        files += 1;
        if (dir === REAL_QUEST_DIR) {
          realFiles += 1;
        }
        const doc = loadDoc(JSON5.parse(readFileSync(path.join(dir, file), 'utf8')));
        const edits: DocEdit[] = [];
        for (const slot of dialogSlots(doc)) {
          lists += 1;
          if (dir === REAL_QUEST_DIR) {
            realLists += 1;
          }
          const wrapper = getAtPath(doc, slot) as Record<string, unknown>;
          // The list is exactly {$type, m_dialogs}, in that order, in 797/797 measured lists.
          expect(Object.keys(wrapper), `${file} ${slot.join('.')}`).toEqual(['$type', 'm_dialogs']);
          if (hasAtPath(wrapper, ['$type'])) {
            taggedLists += 1;
          }
          const view = readDialogList(slot, wrapper);
          if (view.groups.length === 0 && dir === REAL_QUEST_DIR) {
            realEmptyLists += 1;
          }
          for (const group of view.groups) {
            groups += 1;
            if (dir === REAL_QUEST_DIR) {
              realGroups += 1;
            }
            // Every group has the uniform 6-key order and no $type — or, in the two files this
            // tool wrote (D17 clone), the same order with the null-valued m_dialogEvents
            // omitted. Nothing else is legal.
            const groupKeys = Object.keys(group.value as object);
            expect(
              isDeepStrictEqual(groupKeys, GROUP_ORDER) ||
                isDeepStrictEqual(groupKeys, GROUP_ORDER_NULL_OMITTED),
              `${file} ${group.address} carries ${JSON.stringify(groupKeys)}`,
            ).toBe(true);
            expect(hasAtPath(group.value, ['$type']), `${file} ${group.address}`).toBe(false);
            if (dir === REAL_QUEST_DIR && !isDeepStrictEqual(groupKeys, GROUP_ORDER)) {
              realNullOmittedGroups += 1;
            }
            if (group.tagPresent) {
              taggedGroups += 1;
            }
            tagCounts.set(
              group.tag ?? '<absent>',
              (tagCounts.get(group.tag ?? '<absent>') ?? 0) + 1,
            );
            if (dir === REAL_QUEST_DIR) {
              realTagCounts.set(
                group.tag ?? '<absent>',
                (realTagCounts.get(group.tag ?? '<absent>') ?? 0) + 1,
              );
            }
            for (const entry of group.entries) {
              entries += 1;
              if (dir === REAL_QUEST_DIR) {
                realEntries += 1;
              }
              const record = entry.value as Record<string, unknown>;
              const keys = Object.keys(record);
              // The entry's own key list is one of the six documented shapes, in order.
              const shape = shapesMatch(keys);
              expect(
                shape,
                `${file} ${entry.address} has an undocumented entry shape`,
              ).not.toBeNull();
              // A `$type` is present on five of the six shapes; the `sparse58NoType` shape has
              // none at all (2 real entries, new at f9a1055), and nothing here invents one.
              if (shape === 'sparse58NoType') {
                expect(entry.typeString, `${file} ${entry.address}`).toBeNull();
              } else {
                expect(entry.typeString, `${file} ${entry.address}`).toBe(ENTRY_TYPE);
              }
              if (entry.typeString === ENTRY_TYPE) {
                taggedEntries += 1;
              }
              shapeCounts.set(String(shape), (shapeCounts.get(String(shape)) ?? 0) + 1);
              if (dir === REAL_QUEST_DIR) {
                realShapeCounts.set(String(shape), (realShapeCounts.get(String(shape)) ?? 0) + 1);
              }
              if (Object.prototype.hasOwnProperty.call(record, 'm_requirements')) {
                if (record.m_requirements === null) {
                  nullRequirements += 1;
                } else {
                  requirementsNotNull += 1;
                }
              }
              // Every string-list element round-trips verbatim through the line control.
              for (const key of [
                'm_npcStandInList',
                'm_dialogAnimationList',
                'm_dialogTurningList',
              ]) {
                const value = record[key];
                if (Array.isArray(value)) {
                  for (const element of value) {
                    expect(typeof element, `${file} ${entry.address} ${key}`).toBe('string');
                    expect(
                      (element as string).includes('\n'),
                      `${file} ${entry.address} ${key}`,
                    ).toBe(false);
                    stringListElements += 1;
                  }
                  expect(
                    isDeepStrictEqual(parseStringListText(stringListToText(value)), value),
                    `${file} ${entry.address} ${key}`,
                  ).toBe(true);
                }
              }
              // The model knows every key the corpus carries: zero unmodelled keys, so the
              // raw-fields disclosure is a legacy-key affordance, not a corpus one.
              expect(entry.unmodelledKeys, `${file} ${entry.address}`).toEqual([]);
              edits.push(...benignEdits(slot, group.index, entry.index, record));
            }
          }
        }
        // Nothing changed, so the whole file must come back byte-identical — the proof that
        // no absent key was created, no null normalised and no $type touched.
        expect(serializeDoc(applyEdits(doc, edits)), `${file}`).toBe(serializeDoc(doc));
      }
    }

    // The sweep is not vacuous.
    expect(files).toBeGreaterThan(0);
    expect(lists).toBeGreaterThan(0);
    expect(groups).toBeGreaterThan(0);
    expect(entries).toBeGreaterThan(0);
    expect(shapeCounts.get('full')).toBeGreaterThan(0);
    expect(shapeCounts.get('sparse60')).toBeGreaterThan(0);
    expect(shapeCounts.get('truncated45')).toBeGreaterThan(0);
    expect(shapeCounts.get('nullOmitted65')).toBeGreaterThan(0);
    expect(shapeCounts.get('noDialogEvent65')).toBeGreaterThan(0);
    expect(shapeCounts.get('sparse58NoType')).toBeGreaterThan(0);
    expect(taggedGroups).toBe(groups);
    expect(taggedEntries).toBe(entries - (shapeCounts.get('sparse58NoType') ?? 0));
    expect(taggedLists).toBe(lists);
    // No corpus entry carries a non-null m_requirements: the slot is corpus-empty.
    expect(requirementsNotNull).toBe(0);
    expect(nullRequirements).toBeGreaterThan(0);
    expect(stringListElements).toBeGreaterThan(0);
    expect([...tagCounts.keys()]).toContain('Prep');
    expect([...tagCounts.keys()]).toContain('Completion');

    // The measured totals, asserted against the real checkout when it exists (CI has only the
    // clone, which is why these are conditional rather than hard).
    if (existsSync(REAL_QUEST_DIR)) {
      expect(realFiles).toBe(328);
      expect(realLists).toBe(797);
      // The sweep walks the `m_dialogList` slots the editor mounts: 769 of the corpus's 774
      // groups. The other 5 are the typed `ActorDialog` blocks inside `ResActorDialog.m_dialog`
      // (8 entries, all full 66-key), which the results sweep and D79's byte-exact check cover.
      expect(realGroups).toBe(769);
      expect(realEntries).toBe(1876);
      expect(realShapeCounts.get('full')).toBe(1860);
      expect(realEmptyLists).toBe(43);
      expect(realShapeCounts.get('sparse60')).toBe(1);
      expect(realShapeCounts.get('truncated45')).toBe(6);
      expect(realShapeCounts.get('noDialogEvent65')).toBe(7);
      expect(realShapeCounts.get('sparse58NoType')).toBe(2);
      expect(realShapeCounts.get('nullOmitted65') ?? 0).toBe(0);
      // The real checkout's groups are all the full 6-key order; the null-omitted 5-key
      // shape exists only in the two files this tool wrote (the D17 clone).
      expect(realNullOmittedGroups).toBe(0);
      expect(realTagCounts.get('Completion')).toBe(442);
      expect(realTagCounts.get('Prep')).toBe(322);
      expect(realTagCounts.get('')).toBe(5);
      // `Hyperlink` (5 occurrences) exists ONLY on the typed `ActorDialog` blocks, which are not
      // list-mounted, so this sweep correctly sees none of them — the results sweep owns those.
      expect(realTagCounts.get('Hyperlink') ?? 0).toBe(0);
      console.log(
        `[p3-08 corpus] ${realFiles} real + ${files - realFiles} clone files, ` +
          `${realLists} real dialog lists / ${lists} total (${realGroups} real tag groups / ` +
          `${groups} total), ${realEntries} real entries in five corpus shapes (full ` +
          `${realShapeCounts.get('full')} / no-m_dialogEvent 65-key ` +
          `${realShapeCounts.get('noDialogEvent65')} / 60-key ${realShapeCounts.get('sparse60')} / ` +
          `45-key ${realShapeCounts.get('truncated45')} / no-$type 58-key ` +
          `${realShapeCounts.get('sparse58NoType')}), plus the clone's 65-key null-omitted shape ` +
          `(${shapeCounts.get('nullOmitted65')}); the 5 typed ActorDialog blocks (8 entries) are ` +
          `covered by the results sweep; real tags Completion ` +
          `${realTagCounts.get('Completion')} / Prep ${realTagCounts.get('Prep')} / "" ` +
          `${realTagCounts.get('')} / Hyperlink ${realTagCounts.get('Hyperlink') ?? 0} ` +
          `(typed ActorDialog blocks only — not list-mounted), ` +
          `${stringListElements} string-list elements round-tripped, byte-identical in both corpora`,
      );
    } else {
      console.log(
        `[p3-08 corpus] ${files} files, ${lists} lists, ${groups} groups, ${entries} entries — ` +
          `bytes identical (real checkout absent; D17 clone only)`,
      );
    }
  });
});

/** Which of the six documented shapes {@link keys} is, or a printable marker otherwise. */
function shapesMatch(
  keys: readonly string[],
):
  | 'full'
  | 'noDialogEvent65'
  | 'sparse58NoType'
  | 'sparse60'
  | 'truncated45'
  | 'nullOmitted65'
  | null {
  if (isDeepStrictEqual(keys, SHAPE_FULL)) {
    return 'full';
  }
  if (isDeepStrictEqual(keys, SHAPE_NO_DIALOG_EVENT)) {
    return 'noDialogEvent65';
  }
  if (isDeepStrictEqual(keys, SHAPE_58)) {
    return 'sparse58NoType';
  }
  if (isDeepStrictEqual(keys, SHAPE_60)) {
    return 'sparse60';
  }
  if (isDeepStrictEqual(keys, SHAPE_45)) {
    return 'truncated45';
  }
  if (isDeepStrictEqual(keys, SHAPE_65)) {
    return 'nullOmitted65';
  }
  return null;
}
