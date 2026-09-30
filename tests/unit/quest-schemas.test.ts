import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { describe, expect, it } from 'vitest';

import { DEFAULT_SPIRALDB_PATH } from '@server/db';
import { parseJsonLenient } from '@server/services/sync/json';
import {
  ActorDialogListSchema,
  GoalTemplateSchema,
  GoalTypeEnumSchema,
  NPCDialogEntrySchema,
  QuestTemplateSchema,
  RequirementSchema,
  ResultTemplateSchema,
  SaveQuestRequestSchema,
  TYPE_STRINGS,
  describeSchemaIssues,
} from '@shared/quest';

/**
 * Task 3.1 — the schemas themselves.
 *
 * The four properties the story is judged on, each asserted against **real corpus data** where
 * a fixture exists for it:
 *
 * 1. every corpus value parses (including the legacy JSON5-with-trailing-commas files);
 * 2. the discriminated unions resolve on the assembly-qualified `$type`;
 * 3. `NullValueHandling.Ignore` semantics: an absent optional field stays absent, an explicit
 *    `null` stays `null`, and a parse never injects a default (`toEqual` would not notice an
 *    injected `undefined`, so the strict comparisons here use `Object.keys` and Node's
 *    `isDeepStrictEqual`);
 * 4. an unknown-but-present `$type` fails loudly — and unknown-but-present *fields* survive.
 */

const FIXTURES = fileURLToPath(new URL('../../server/test/fixtures/', import.meta.url));

interface RecordedCorpus {
  corpusPath: string;
  corpusFiles: number;
  npcDialogEntryFields: Record<string, number>;
  topLevelFieldCounts: Record<string, number>;
  reqHasEntryFields: string[];
  goalTypeValues: Record<string, number>;
  dialogTags: Record<string, number>;
}

const RECORDED = JSON.parse(
  readFileSync(path.join(FIXTURES, 'quest_corpus_type_strings.json'), 'utf8'),
) as RecordedCorpus;

/** A real corpus quest committed to the repo (461 lines, 3 trailing-comma lines). */
const REAL_QUEST = 'quest_DS-ACAD-C01-003.json';

function fixtureText(name: string): string {
  return readFileSync(path.join(FIXTURES, name), 'utf8');
}

/** The shape the CLI emits: the same object with every null-valued key dropped (D48). */
function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripNulls);
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== null) {
        out[key] = stripNulls(entry);
      }
    }
    return out;
  }
  return value;
}

describe('parsing real corpus documents', () => {
  it('accepts the committed corpus quest, which is not strict JSON', () => {
    const text = fixtureText(REAL_QUEST);
    expect(() => JSON.parse(text)).toThrow();

    const source = parseJsonLenient(text) as Record<string, unknown>;
    const parsed = QuestTemplateSchema.parse(source);

    expect(parsed.m_questName).toBe('DS-ACAD-C01-003');
    // Deep equality is the criterion (and p3-02's): Zod emits the modelled keys in the
    // schema's declaration order, so key *order* can differ from the file even though the
    // value, the key set and every explicit null are preserved. The save path therefore
    // hands the pipeline the original object, never a schema parse output.
    expect(isDeepStrictEqual(parsed, source)).toBe(true);
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(source).sort());
    // The corpus carries explicit nulls; they are neither dropped nor turned into "".
    expect(parsed.m_questInfo).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(parsed, 'm_questInfo')).toBe(true);
  });

  it('accepts the CLI-shaped document, whose null keys are absent, without inventing them', () => {
    const source = parseJsonLenient(fixtureText(REAL_QUEST)) as Record<string, unknown>;
    const stripped = stripNulls(source) as Record<string, unknown>;
    expect(stripped.m_questInfo).toBeUndefined();
    expect(Object.keys(stripped).length).toBeLessThan(Object.keys(source).length);

    const parsed = QuestTemplateSchema.parse(stripped);
    expect(isDeepStrictEqual(parsed, stripped)).toBe(true);
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(stripped).sort());
    // No key is invented and none is dropped: the absent optional stayed absent.
    expect(Object.keys(parsed)).toHaveLength(Object.keys(stripped).length);
  });

  it('accepts a legacy document with trailing commas (JSON5 only)', () => {
    const legacy = '{ "m_questName": "LEGACY-1", "m_questInfo": null, "m_goals": [], }';
    expect(() => JSON.parse(legacy)).toThrow();
    const parsed = QuestTemplateSchema.parse(parseJsonLenient(legacy));
    expect(parsed.m_questName).toBe('LEGACY-1');
    expect(parsed.m_questInfo).toBeNull();
  });

  it('accepts the minimal quest the extraction review view and the POST tests send', () => {
    expect(QuestTemplateSchema.safeParse({ m_questName: 'MIN-1' }).success).toBe(true);
    expect(QuestTemplateSchema.safeParse({ m_questName: 'MIN-1', m_goals: [] }).success).toBe(true);
    // `m_questName` is the one required field, and it must not be blank.
    expect(QuestTemplateSchema.safeParse({ m_questLevel: 1 }).success).toBe(false);
    expect(QuestTemplateSchema.safeParse({ m_questName: '' }).success).toBe(false);
  });

  it('models every measured top-level field', () => {
    expect(Object.keys(QuestTemplateSchema.shape).sort()).toEqual(
      Object.keys(RECORDED.topLevelFieldCounts).sort(),
    );
    expect(Object.keys(QuestTemplateSchema.shape)).toHaveLength(36);
  });
});

describe('the discriminated unions resolve on $type', () => {
  it('resolves each of the 5 goal classes', () => {
    const goals = [
      TYPE_STRINGS.WaypointGoalTemplate,
      TYPE_STRINGS.PersonaGoalTemplate,
      TYPE_STRINGS.BountyGoalTemplate,
      TYPE_STRINGS.ScavengeGoalTemplate,
      TYPE_STRINGS.AchieveRankGoalTemplate,
    ];
    for (const $type of goals) {
      const result = GoalTemplateSchema.safeParse({ $type, m_goalName: '1_Goal' });
      expect(result.success, `goal ${$type}`).toBe(true);
      expect(result.success && result.data.$type).toBe($type);
      expect(result.success && result.data.m_goalName).toBe('1_Goal');
    }
  });

  it('resolves each of the 15 result classes', () => {
    const results = [
      TYPE_STRINGS.ResDropTable,
      TYPE_STRINGS.ResModifyEntry,
      TYPE_STRINGS.ResAddDynaMod,
      TYPE_STRINGS.ResLearnSpell,
      TYPE_STRINGS.ResPostEvent,
      TYPE_STRINGS.ResAddHealth,
      TYPE_STRINGS.ResAddMana,
      TYPE_STRINGS.ResAddSpell,
      TYPE_STRINGS.ResDespawn,
      TYPE_STRINGS.ResDrawHand,
      TYPE_STRINGS.ResGiveSpell,
      TYPE_STRINGS.ResPlaySound,
      TYPE_STRINGS.ResTeleport,
      TYPE_STRINGS.ResWait,
      // The corpus-only 15th class (D79): absent from the spec's list, present 5 times in the
      // owner's corpus, always `{$type, m_dialog}`.
      TYPE_STRINGS.ResActorDialog,
    ];
    expect(results).toHaveLength(15);
    for (const $type of results) {
      const result = ResultTemplateSchema.safeParse({ $type });
      expect(result.success, `result ${$type}`).toBe(true);
      expect(result.success && result.data.$type).toBe($type);
    }
  });

  it('resolves each of the 4 requirement classes and the recursive wrapper', () => {
    const wrapper = { $type: TYPE_STRINGS.RequirementList, m_requirements: [] };
    const leaves = [
      TYPE_STRINGS.ReqHasQuest,
      TYPE_STRINGS.ReqHasEntry,
      TYPE_STRINGS.ReqSchoolOfFocus,
      TYPE_STRINGS.ReqIsSchool,
    ];
    for (const $type of leaves) {
      expect(RequirementSchema.safeParse({ $type, m_applyNOT: false }).success, $type).toBe(true);
    }
    expect(RequirementSchema.safeParse(wrapper).success).toBe(true);

    // AND(ReqHasQuest, OR(ReqHasEntry, ReqSchoolOfFocus)) — the tree shape of task 3.6,
    // driven through the recursive union.
    const tree = {
      $type: TYPE_STRINGS.RequirementList,
      m_operator: 'ROP_AND',
      m_requirements: [
        { $type: TYPE_STRINGS.ReqHasQuest, m_questName: 'Q', m_applyNOT: true },
        {
          $type: TYPE_STRINGS.RequirementList,
          m_operator: 'ROP_OR',
          m_requirements: [
            { $type: TYPE_STRINGS.ReqHasEntry, m_questName: 'Q', m_entryName: 'E' },
            { $type: TYPE_STRINGS.ReqSchoolOfFocus, m_magicSchool: 'Storm' },
          ],
        },
      ],
    };
    const parsed = RequirementSchema.safeParse(tree);
    expect(parsed.success).toBe(true);
    expect(isDeepStrictEqual(parsed.success && parsed.data, tree)).toBe(true);
  });

  it('resolves the dialog wrapper, an entry and the madlib chain', () => {
    const doc = {
      $type: TYPE_STRINGS.ActorDialogList,
      m_dialogs: [
        {
          m_dialogTag: '',
          m_dialogEntries: [{ $type: TYPE_STRINGS.NPCDialogEntry, m_dialog: 'Dialog_1' }],
          m_madlibs: [
            {
              m_index: 0,
              m_madlibBlock: {
                m_blockToken: 'TK',
                m_madlibs: [
                  {
                    $type: TYPE_STRINGS.MadlibArgT_ByteString,
                    m_madlibArgument: 'arg',
                    m_madlibToken: 'tok',
                  },
                ],
              },
            },
          ],
          m_dialogEvents: [],
          m_noAggroWhileDialogIsUp: false,
          m_noAggroNoDelay: false,
        },
      ],
    };
    const parsed = ActorDialogListSchema.safeParse(doc);
    expect(parsed.success).toBe(true);
    expect(isDeepStrictEqual(parsed.success && parsed.data, doc)).toBe(true);
    expect(NPCDialogEntrySchema.safeParse({ $type: TYPE_STRINGS.NPCDialogEntry }).success).toBe(
      true,
    );
    // An empty tag is a legal corpus value (5 occurrences) — the tag is not an enum.
    expect(Object.keys(RECORDED.dialogTags)).toContain('');
  });

  it('fails loudly on an unknown, missing or wrong $type', () => {
    const unknownGoal = QuestTemplateSchema.safeParse({
      m_questName: 'X',
      m_goals: [
        { $type: 'Imcodec.ObjectProperty.TypeCache.NopeGoalTemplate, Imcodec.ObjectProperty' },
      ],
    });
    expect(unknownGoal.success).toBe(false);
    expect(unknownGoal.success === false && unknownGoal.error.issues[0]?.code).toBe(
      'invalid_union_discriminator',
    );

    // A goal with no `$type` at all is malformed: Imlight deserializes on that string.
    expect(GoalTemplateSchema.safeParse({ m_goalName: '1_Goal' }).success).toBe(false);
    expect(ResultTemplateSchema.safeParse({ m_tableName: 'T' }).success).toBe(false);

    // The spec-only GoalCompilation label used by other tests is not a corpus type.
    expect(
      GoalTemplateSchema.safeParse({
        $type: 'Imcodec.ObjectProperty.TypeCache.GoalCompilation, Imcodec.ObjectProperty',
      }).success,
    ).toBe(false);

    // An unknown requirement $type must not silently match the typeless wrapper.
    expect(RequirementSchema.safeParse({ $type: 'Nope', m_questName: 'Q' }).success).toBe(false);
    // …while a wrapper without `$type` is a real corpus value (28 occurrences).
    expect(
      RequirementSchema.safeParse({
        m_applyNOT: false,
        m_operator: 'ROP_AND',
        m_requirements: [],
      }).success,
    ).toBe(true);

    expect(ActorDialogListSchema.safeParse({ $type: 'Nope', m_dialogs: [] }).success).toBe(false);
  });
});

describe('NullValueHandling.Ignore — nothing is injected, nothing is dropped', () => {
  it('never adds an absent optional field', () => {
    const parsed = QuestTemplateSchema.parse({ m_questName: 'ABSENT-1' }) as Record<
      string,
      unknown
    >;
    expect(Object.keys(parsed)).toEqual(['m_questName']);
    expect(Object.keys(parsed)).toHaveLength(1);
    for (const field of [
      'm_goals',
      'm_goalLogic',
      'm_requirements',
      'm_dialogList',
      'm_clientTags',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(parsed, field), field).toBe(false);
    }
    expect(JSON.stringify(parsed)).toBe('{"m_questName":"ABSENT-1"}');
  });

  it('preserves an explicit null instead of deleting it', () => {
    const source = { m_questName: 'NULL-1', m_questInfo: null, m_clientTags: null };
    const parsed = QuestTemplateSchema.parse(source) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(['m_questName', 'm_questInfo', 'm_clientTags']);
    expect(isDeepStrictEqual(parsed, source)).toBe(true);
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(source));
  });

  it('accepts an explicit null on a dialog list and a requirement list (corpus reality)', () => {
    const parsed = QuestTemplateSchema.parse({
      m_questName: 'NULL-2',
      m_dialogList: null,
      m_requirements: null,
      m_prepRequirements: null,
      m_startResults: null,
    }) as Record<string, unknown>;
    expect(parsed.m_dialogList).toBeNull();
    expect(parsed.m_requirements).toBeNull();
    expect(parsed.m_startResults).toBeNull();
  });
});

describe('unknown-but-present fields survive (D5 merge-not-replace)', () => {
  /**
   * A `ReqHasEntry` node copied verbatim from
   * `QuestTemplates/questtemplates_WC-COMMONS-MAIN-003.json` (one of 37 corpus quests whose
   * requirement tree carries the two fields the spec's 4-field list omits).
   */
  const REQ_HAS_ENTRY_FROM_CORPUS = {
    $type: TYPE_STRINGS.ReqHasEntry,
    m_entryName: 'Complete',
    m_displayName: null,
    m_isQuestRegistry: true,
    m_questName: 'WC-COMMONS-MAIN-002-STORM',
    m_applyNOT: false,
    m_operator: 'ROP_AND',
  };

  it('keeps the two undocumented ReqHasEntry fields through a parse → JSON round trip', () => {
    expect(Object.keys(REQ_HAS_ENTRY_FROM_CORPUS)).toHaveLength(7);
    expect(RECORDED.reqHasEntryFields).toHaveLength(7);

    const doc = {
      m_questName: 'REQ-1',
      m_requirements: {
        $type: TYPE_STRINGS.RequirementList,
        m_requirements: [REQ_HAS_ENTRY_FROM_CORPUS],
      },
    };
    const parsed = QuestTemplateSchema.parse(doc);
    expect(isDeepStrictEqual(parsed, doc)).toBe(true);
    // Parse → serialize → re-parse is deep-equal (key order aside): the two undocumented
    // fields, and the explicit null, are still there after a full round trip.
    expect(isDeepStrictEqual(JSON.parse(JSON.stringify(parsed)), doc)).toBe(true);

    // The nested node keeps both fields, including the explicit null.
    const node = (parsed.m_requirements as { m_requirements: Record<string, unknown>[] })
      .m_requirements[0];
    expect(node.m_displayName).toBeNull();
    expect(node.m_isQuestRegistry).toBe(true);
    expect(Object.keys(node)).toHaveLength(7);
  });

  it('models every field the corpus uses on a dialog entry, and keeps extras', () => {
    const measured = Object.keys(RECORDED.npcDialogEntryFields);
    expect(measured).toHaveLength(66);
    const unmodelled = measured.filter((field) => !(field in NPCDialogEntrySchema.shape));
    expect(unmodelled, 'measured dialog-entry fields missing from the schema').toEqual([]);

    const entry = {
      $type: TYPE_STRINGS.NPCDialogEntry,
      ...Object.fromEntries(
        measured.map((field) => [field, field === '$type' ? TYPE_STRINGS.NPCDialogEntry : null]),
      ),
      m_futureField: { nested: [1, 2, 3] },
    };
    const parsed = NPCDialogEntrySchema.parse(entry) as Record<string, unknown>;
    expect(parsed.m_futureField).toEqual({ nested: [1, 2, 3] });
    expect(isDeepStrictEqual(parsed, entry)).toBe(true);
  });

  it('keeps an unknown field on every level of the document', () => {
    const doc = {
      m_questName: 'EXTRA-1',
      m_somethingNew: 'keep me',
      m_goals: [
        {
          $type: TYPE_STRINGS.WaypointGoalTemplate,
          m_goalName: '1_G',
          // `m_targets` is real: the Phase-2 test helper `questText()` writes it and no spec
          // table lists it.
          m_targets: [{ m_targetName: 'WC_Hub', m_zoneName: null }],
        },
      ],
      m_goalLogic: [{ m_completeQuest: true, m_notes: 'extra' }],
    };
    const parsed = QuestTemplateSchema.parse(doc);
    expect(isDeepStrictEqual(parsed, doc)).toBe(true);
    expect((parsed as Record<string, unknown>).m_somethingNew).toBe('keep me');
  });

  it('carries exactly the 7 measured goal-type values, none derived from the goal classes', () => {
    const measured = Object.keys(RECORDED.goalTypeValues);
    expect(measured).toHaveLength(7);
    expect(measured).toContain('GOAL_TYPE_BOUNTY');
    expect(measured).toContain('GOAL_TYPE_BOUNTYCOLLECT');
    expect(measured).toContain('GOAL_TYPE_USAGE');
    // The editor's select is the measured enum, value for value — and it is a different axis
    // from the goal `$type`: GOAL_TYPE_USAGE has no goal class here at all.
    expect(GoalTypeEnumSchema.options.slice().sort()).toEqual(measured.slice().sort());
    // `m_goalType` is validated as a free string on purpose (forward compatibility), so a
    // value this repository has never seen is preserved rather than rejected.
    const parsed = GoalTemplateSchema.parse({
      $type: TYPE_STRINGS.WaypointGoalTemplate,
      m_goalType: 'GOAL_TYPE_SOMETHING_NEW',
    });
    expect(parsed.m_goalType).toBe('GOAL_TYPE_SOMETHING_NEW');
  });
});

describe('the POST /api/quests request schema', () => {
  it('accepts the established body shapes ({quest, notes?, source?})', () => {
    expect(SaveQuestRequestSchema.safeParse({ quest: { m_questName: 'P-1' } }).success).toBe(true);
    expect(
      SaveQuestRequestSchema.safeParse({ quest: { m_questName: 'P-1' }, notes: null }).success,
    ).toBe(true);
    expect(
      SaveQuestRequestSchema.safeParse({ quest: { m_questName: 'P-1' }, source: 'session.json' })
        .success,
    ).toBe(true);
    expect(
      SaveQuestRequestSchema.safeParse({ quest: { m_questName: 'P-1' }, extra: true }).success,
    ).toBe(true);
  });

  it('rejects the bodies the endpoint answers 400 to', () => {
    expect(SaveQuestRequestSchema.safeParse('nope').success).toBe(false);
    expect(SaveQuestRequestSchema.safeParse({}).success).toBe(false);
    expect(SaveQuestRequestSchema.safeParse({ quest: 'nope' }).success).toBe(false);
    expect(SaveQuestRequestSchema.safeParse({ quest: { m_questLevel: 1 } }).success).toBe(false);
    expect(SaveQuestRequestSchema.safeParse({ quest: { m_questName: '' } }).success).toBe(false);
    expect(
      SaveQuestRequestSchema.safeParse({ quest: { m_questName: 'X' }, notes: 5 }).success,
    ).toBe(false);
    expect(
      SaveQuestRequestSchema.safeParse({ quest: { m_questName: 'X' }, source: ['a'] }).success,
    ).toBe(false);
    // A goal without the $type Imlight deserializes on is malformed now that the same
    // schemas validate the endpoint.
    expect(
      SaveQuestRequestSchema.safeParse({ quest: { m_questName: 'X', m_goals: [{}] } }).success,
    ).toBe(false);
  });

  it('renders the failure as one actionable line naming the offending paths', () => {
    const result = SaveQuestRequestSchema.safeParse({ quest: { m_questName: 'X', m_goals: [{}] } });
    expect(result.success).toBe(false);
    const message = describeSchemaIssues(
      result.success === false ? result.error : (undefined as never),
    );
    expect(message).toContain('Invalid quest payload');
    expect(message).toContain('quest.m_goals.0.$type');
  });
});

/**
 * The corpus-wide claim ("schemas must accept every corpus value") is asserted against the
 * live checkout when it is present — **330** files (328 at `d57d891` plus the two harness-authored scaffolds `7e34bed`/`864bd44` — an owner
 * post-run review item; if the owner drops them this returns to 328 — at the owner fork's `864bd44`, the
 * Phase 7 baseline, D145(b); 322 before the `f9a1055` merge, D79),
 * no fixtures — and skipped with a reason otherwise (CI has no sibling repository; task 3.2 owns
 * the committed-fixture round-trip). This arm is what proves the schema extension: the 3 quests
 * carrying `ResActorDialog`/`ActorDialog` parse, and the 2 dialog entries with **no `$type`**
 * parse after `NPCDialogEntrySchema.$type` was relaxed to `.nullish()`.
 */
const CORPUS_DIR =
  process.env.SPIRALDB_QUEST_CORPUS ?? path.join(DEFAULT_SPIRALDB_PATH, 'QuestTemplates');
const CORPUS_PRESENT = existsSync(CORPUS_DIR);

describe.skipIf(!CORPUS_PRESENT)('the live corpus (owner run)', () => {
  it('accepts all 330 corpus quests and loses nothing on parse', () => {
    const quests = readdirSync(CORPUS_DIR).filter((file) => file.endsWith('.json'));
    expect(quests).toHaveLength(330);

    const rejected: string[] = [];
    const changed: string[] = [];
    for (const file of quests) {
      const source: unknown = parseJsonLenient(readFileSync(path.join(CORPUS_DIR, file), 'utf8'));
      const result = QuestTemplateSchema.safeParse(source);
      if (!result.success) {
        rejected.push(`${file}: ${result.error.issues[0]?.path.join('.')}`);
        continue;
      }
      if (!isDeepStrictEqual(result.data, source)) {
        changed.push(file);
      }
    }

    console.log(
      `[p3-01 schemas] corpus ${quests.length}: accepted=${quests.length - rejected.length}, ` +
        `rejected=${rejected.length}, parse-output-changed=${changed.length}`,
    );
    expect(rejected).toEqual([]);
    expect(changed).toEqual([]);
  });
});
