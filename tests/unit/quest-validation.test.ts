import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import json5 from 'json5';
import { describe, expect, it, beforeAll } from 'vitest';

import { applyEdits, serializeDoc, type JsonDocument } from '@shared/document';
import { DEFAULT_SPIRALDB_PATH } from '@server/db';
import { GOAL_TYPES, RESULT_TYPES, TYPE_STRINGS } from '@shared/quest/typeConstants';
import {
  REFERENCE_FIELDS,
  goalLogicReachability,
  validateQuest,
  type QuestFinding,
  type QuestFindingKind,
  type QuestValidationReferences,
  type QuestValidationResult,
} from '@shared/quest/validation';
import {
  blockingSummary,
  fieldErrorMap,
  findingField,
  findingMessage,
  kindLabel,
} from '@shared/quest/validation-messages';

import { deleteGoalEdit } from '../../client/src/lib/quest-goals';

/**
 * Story p3-09's engine test — plan task 3.9, [spec-domain-reference.md] L525-547.
 *
 * Two arms, on purpose:
 *
 * 1. **The real corpus sweep** (owner run; skipped with a printed reason when the checkout or
 *    the synced database is absent, which is CI's state — D40). It asserts the *measured*
 *    numbers, so a rule that fires on real data, or an engine that misses it, fails here:
 *    re-measured at the owner's `f9a1055` baseline (D79/D80): **328** files (was 322), **0**
 *    findings of the six zero-instance rules, **3** quests with unreachable goals (**25** goal
 *    findings; was 5 quests / 35 findings), **94** zone warnings (0 since the D120 zones table, D145), and **0** reference warnings —
 *    the last one only under the dual-source handling of `ResDrawHand.m_templateID` (D63(c)),
 *    which is asserted directly too. The reference count needed the tool's own database to be
 *    **re-synced** to the owner's 328 quests (D80b): before that the sweep reported six
 *    `m_questName` misses that were the DB's staleness (322 rows), not the corpus's.
 * 2. **Fixture cases** for every rule, which is the only way six of the nine kinds are ever
 *    exercised (their corpus count is zero). The fixtures are labelled where they are the
 *    only proof, and the AC's own flow — delete a referenced start goal → a blocking finding
 *    — is driven through the shipped `deleteGoalEdit` builder rather than a hand-written
 *    document, so the editor's real mutation is what the engine sees.
 *
 * Purity is asserted, not assumed: the corpus sweep serializes every document before and
 * after validation and requires the bytes to be identical (a rule that mutates the document
 * is the first failure mode the story's brief names).
 *
 * Measured at the owner's `f9a1055` baseline against `/home/jason/Documents/git-projects/spiraldb`
 * (328 files) and `data/spiraldb-ui.db` (`zones` 1,241 / `npcs` 23,033 / `spells` 18,173 /
 * `drop_tables` 317 / `quests` **328** rows after this task's deliberate D80b re-sync; it was 322
 * before). The path follows p3-02's convention: `SPIRALDB_QUEST_CORPUS` overrides the checkout,
 * and the D17 clone is **not** a fallback here because it holds 323 files (this tool's own writes
 * included) and was **not** re-cloned (D80c), so its counts are not the measured ones.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CORPUS_DIR =
  process.env.SPIRALDB_QUEST_CORPUS ?? path.join(DEFAULT_SPIRALDB_PATH, 'QuestTemplates');
const DB_PATH = path.join(ROOT, 'data', 'spiraldb-ui.db');

/* ---------------------------------------------------------------- corpus loading */

interface CorpusQuest {
  file: string;
  name: string;
  doc: JsonDocument;
}

/** Every `QuestTemplates/*.json` of the checkout, or `null` when the directory is absent. */
function loadCorpus(): CorpusQuest[] | null {
  if (!existsSync(CORPUS_DIR)) {
    return null;
  }
  return readdirSync(CORPUS_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const doc = json5.parse(readFileSync(path.join(CORPUS_DIR, file), 'utf8')) as JsonDocument;
      const name = (doc as { m_questName?: unknown }).m_questName;
      return { file, name: typeof name === 'string' ? name : file, doc };
    });
}

/** The five injected friendly-name tables from the synced database, or `null` when absent. */
function loadReferences(): QuestValidationReferences | null {
  if (!existsSync(DB_PATH)) {
    return null;
  }
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const values = (sql: string): Set<string> =>
      new Set((db.prepare(sql).all() as Array<{ value: unknown }>).map((row) => String(row.value)));
    return {
      zones: values('select zone_path as value from zones'),
      npcs: values('select template_id as value from npcs'),
      spells: values('select template_id as value from spells'),
      drop_tables: values('select name as value from drop_tables'),
      quests: values('select quest_name as value from quests'),
    };
  } finally {
    db.close();
  }
}

const CORPUS = loadCorpus();
const REFERENCES = loadReferences();

if (CORPUS === null || REFERENCES === null) {
  console.log(
    `[p3-09 corpus] live sweep skipped — corpus ${CORPUS === null ? 'absent' : CORPUS_DIR}, ` +
      `database ${REFERENCES === null ? 'absent' : DB_PATH} (CI has no sibling SpiralDB checkout ` +
      'and no synced database, D40/D23 tier 1). The fixture cases below carry every rule.',
  );
}

if (CORPUS !== null && REFERENCES !== null) {
  console.log(
    `[p3-09 corpus] corpus=${CORPUS_DIR} files=${CORPUS.length} | zones=${REFERENCES.zones?.size} ` +
      `npcs=${REFERENCES.npcs?.size} spells=${REFERENCES.spells?.size} ` +
      `drop_tables=${REFERENCES.drop_tables?.size} quests=${REFERENCES.quests?.size}`,
  );
}

/** The findings of one kind across a result set. */
function ofKind(result: QuestValidationResult, kind: QuestFindingKind): QuestFinding[] {
  return result.findings.filter((finding) => finding.kind === kind);
}

/* ------------------------------------------------------------------ fixtures */

/** A goal in the shape the model reads (the corpus's own keys are not needed by the rules). */
function goal(name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $type: GOAL_TYPES.WaypointGoalTemplate,
    m_goalName: name,
    m_goalType: 'GOAL_TYPE_WAYPOINT',
    ...overrides,
  };
}

/**
 * A quest that violates **nothing**: named, two goals, one start goal, and a final logic entry
 * that completes the quest. Every fixture below is this document with one fault introduced, so
 * a case's finding count cannot be an accident of some other rule.
 */
function cleanQuest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    m_questName: 'DS-TEST-C01-001',
    m_goals: [goal('1_Start'), goal('2_End')],
    m_startGoals: ['1_Start'],
    m_goalLogic: [
      {
        m_goalsAND: ['1_Start'],
        m_goalsOR: [],
        m_goalsToAdd: ['2_End'],
        m_completeQuest: true,
        m_requiredORCount: 1,
      },
    ],
    ...overrides,
  };
}

/** A result node of the given `$type`, carrying its fields. */
function resultNode(type: string, fields: Record<string, unknown>): Record<string, unknown> {
  return { $type: type, ...fields };
}

/** The `{ m_results: [...] }` wrapper every result home uses (untagged, D63(a)). */
function resultList(nodes: Array<Record<string, unknown>>): Record<string, unknown> {
  return { m_results: nodes };
}

/* ------------------------------------------------------------------- the fixtures */

describe('p3-09 — the engine is pure and reports data, not words', () => {
  it('never mutates the document it validates', () => {
    const doc = cleanQuest({
      m_goals: [goal('1_Start'), goal('1_Start'), { m_goalType: 'GOAL_TYPE_WAYPOINT' }],
      m_startGoals: ['1_Start', '9_Deleted'],
      m_endResults: resultList([resultNode(RESULT_TYPES.ResLearnSpell, { m_templateID: -1 })]),
    });
    const before = serializeDoc(doc);
    const result = validateQuest(doc, { references: REFERENCES ?? undefined });
    expect(result.findings.length).toBeGreaterThan(0);
    expect(serializeDoc(doc)).toBe(before);
  });

  it('returns structured findings: a kind, a path, a severity and the offending value', () => {
    const result = validateQuest(cleanQuest({ m_startGoals: ['9_Deleted'] }));
    expect(result.blocking).toHaveLength(1);
    const [finding] = result.blocking;
    expect(finding.kind).toBe('start-goal-unknown');
    expect(finding.severity).toBe('error');
    expect(finding.path).toEqual(['m_startGoals', 0]);
    expect(finding.value).toBe('9_Deleted');
    // The sentence lives in the messages module, never on the finding.
    expect(Object.keys(finding)).not.toContain('message');
    expect(findingMessage(finding)).toBe(
      'The start goal "9_Deleted" is not defined in m_goals. Set another start goal or restore the deleted goal.',
    );
  });

  it('keys the per-field map by the full document path, never a bare field name', () => {
    const doc = cleanQuest({
      m_goals: [goal('1_Start'), goal('1_Start')],
      m_startGoals: ['9_Deleted'],
    });
    const map = fieldErrorMap(validateQuest(doc).blocking);
    expect(Object.keys(map).sort()).toEqual(['m_goals[1].m_goalName', 'm_startGoals[0]']);
    expect(map['m_startGoals[0]']).toHaveLength(1);
    expect(map['m_goals[1].m_goalName'][0]).toContain('"1_Start"');
  });

  it('every referenced short type in the field table is a key of the 3.1 constant table', () => {
    // `$type` knowledge must come from `shared/quest/typeConstants.ts` (D56), never a re-typed
    // literal: a typo in the field table would silently disable a reference rule.
    const names = new Set(Object.keys(TYPE_STRINGS));
    for (const spec of REFERENCE_FIELDS) {
      for (const typeName of spec.types) {
        expect(names, `${spec.key} → ${typeName}`).toContain(typeName);
      }
    }
    expect(REFERENCE_FIELDS.filter((spec) => spec.sources.length > 1)).toHaveLength(1);
  });
});

describe('p3-09 — quest rule fixtures (the six rules with zero corpus instances)', () => {
  it('m_questName missing, empty or non-string → blocking, at m_questName', () => {
    for (const value of [undefined, '', '   ', 7, null]) {
      const result = validateQuest(cleanQuest({ m_questName: value }));
      const findings = ofKind(result, 'quest-name-missing');
      expect(findings, `m_questName=${JSON.stringify(value)}`).toHaveLength(1);
      expect(findings[0].path).toEqual(['m_questName']);
      expect(result.blocked).toBe(true);
    }
    expect(validateQuest(cleanQuest()).blocked).toBe(false);
  });

  it('a dangling m_startGoals entry blocks — driven through the shipped delete-goal edit (AC1)', () => {
    // The AC's own flow: the Goals tab deletes a goal whose name `m_startGoals` still holds.
    const before = cleanQuest();
    const after = applyEdits(before, [deleteGoalEdit(0)]);
    const result = validateQuest(after);
    expect(ofKind(result, 'start-goal-unknown')).toHaveLength(1);
    expect(result.blocking[0].path).toEqual(['m_startGoals', 0]);
    expect(result.blocking[0].value).toBe('1_Start');
    expect(result.blocked).toBe(true);
    // Every index is reported, in order, including a non-string entry.
    const multiple = validateQuest(cleanQuest({ m_startGoals: ['1_Start', '9_Gone', 12] }));
    expect(multiple.blocking.map((finding) => finding.path)).toEqual([
      ['m_startGoals', 1],
      ['m_startGoals', 2],
    ]);
  });

  it('shares one rule between a duplicate name and a nameless goal', () => {
    const duplicate = validateQuest(cleanQuest({ m_goals: [goal('1_Start'), goal('1_Start')] }));
    const findings = ofKind(duplicate, 'duplicate-goal-name');
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toEqual(['m_goals', 1, 'm_goalName']);
    expect(findings[0].goalName).toBe('1_Start');
    expect(findingMessage(findings[0])).toContain('also used by another goal');

    const nameless = validateQuest(
      cleanQuest({ m_goals: [goal('1_Start'), { m_goalType: 'GOAL_TYPE_WAYPOINT' }] }),
    );
    const namelessFindings = ofKind(nameless, 'duplicate-goal-name');
    expect(namelessFindings).toHaveLength(1);
    expect(namelessFindings[0].path).toEqual(['m_goals', 1, 'm_goalName']);
    expect(namelessFindings[0].goalName).toBeUndefined();
    expect(findingMessage(namelessFindings[0])).toContain('has no m_goalName');
  });

  it('the final goal-logic entry must complete the quest — and a quest with no logic is fine', () => {
    const incomplete = validateQuest(
      cleanQuest({
        m_goalLogic: [
          {
            m_goalsAND: ['1_Start'],
            m_goalsOR: [],
            m_goalsToAdd: ['2_End'],
            m_completeQuest: false,
            m_requiredORCount: 1,
          },
        ],
      }),
    );
    const findings = ofKind(incomplete, 'goal-logic-not-completing');
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toEqual(['m_goalLogic', 0, 'm_completeQuest']);
    expect(incomplete.blocked).toBe(true);

    // A quest with no logic at all has no final entry: vacuous, so no finding (15 corpus
    // quests carry `[]` or the key absent).
    expect(
      ofKind(validateQuest(cleanQuest({ m_goalLogic: [] })), 'goal-logic-not-completing'),
    ).toEqual([]);
    expect(
      ofKind(validateQuest(cleanQuest({ m_goalLogic: undefined })), 'goal-logic-not-completing'),
    ).toEqual([]);
  });

  it('a present but unknown $type blocks, and the 3.1 table is the only authority', () => {
    const unknown = 'Imcodec.ObjectProperty.TypeCache.NotAThing, Imcodec.ObjectProperty';
    const result = validateQuest(
      cleanQuest({
        m_goals: [goal('1_Start'), goal('2_End', { $type: unknown })],
        m_endResults: resultList([resultNode(RESULT_TYPES.ResWait, {})]),
      }),
    );
    const findings = ofKind(result, 'unknown-type');
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toEqual(['m_goals', 1, '$type']);
    expect(findings[0].value).toBe(unknown);
    expect(result.blocked).toBe(true);

    // Every string in the table is accepted, and a non-string $type is a finding too.
    for (const type of Object.values(TYPE_STRINGS)) {
      expect(
        ofKind(
          validateQuest(cleanQuest({ m_goals: [goal('1_Start', { $type: type })] })),
          'unknown-type',
        ),
      ).toEqual([]);
    }
    expect(
      ofKind(
        validateQuest(cleanQuest({ m_goals: [goal('1_Start', { $type: 5 })] })),
        'unknown-type',
      ),
    ).toHaveLength(1);
  });

  it('TemplateID fields: positive for result ids, non-negative for the two 0-means-none dialog ids', () => {
    const badSpell = validateQuest(
      cleanQuest({
        m_endResults: resultList([resultNode(RESULT_TYPES.ResLearnSpell, { m_templateID: 0 })]),
      }),
    );
    expect(ofKind(badSpell, 'template-id-not-positive')).toHaveLength(1);
    expect(badSpell.blocking[0].path).toEqual(['m_endResults', 'm_results', 0, 'm_templateID']);
    expect(badSpell.blocking[0].minimum).toBe(1);

    for (const value of [-5, 1.5, '12', null, true]) {
      expect(
        ofKind(
          validateQuest(
            cleanQuest({
              m_endResults: resultList([
                resultNode(RESULT_TYPES.ResGiveSpell, { m_spellID: value }),
              ]),
            }),
          ),
          'template-id-not-positive',
        ),
        `m_spellID=${JSON.stringify(value)}`,
      ).toHaveLength(1);
    }

    // The corpus's 0 sentinels stay legal (330 `m_actorTemplateID` + 1,675
    // `m_walkAwayNpcTemplateID` occurrences), while a negative or fractional value does not.
    const dialog = (walkAway: unknown): Record<string, unknown> => ({
      m_dialogList: {
        m_dialogs: [
          {
            m_dialogTag: 'Prep',
            m_dialogEntries: [
              {
                $type: TYPE_STRINGS.NPCDialogEntry,
                m_actorTemplateID: 0,
                m_walkAwayNpcTemplateID: walkAway,
              },
            ],
          },
        ],
      },
    });
    expect(ofKind(validateQuest(cleanQuest(dialog(0))), 'template-id-not-positive')).toEqual([]);
    expect(ofKind(validateQuest(cleanQuest(dialog(-1))), 'template-id-not-positive')).toHaveLength(
      1,
    );
  });
});

describe('p3-09 — general rules: references warn, they never block (L544-545)', () => {
  const references: QuestValidationReferences = {
    zones: new Set(['WizardCity/WC_Hub']),
    npcs: new Set(['126321']),
    spells: new Set(['2062265892']),
    drop_tables: new Set(['WC-UNICORN-MAIN-007']),
    quests: new Set(['WC-UNICORN-MAIN-004']),
  };

  it('an unknown zone is a warning and Save stays enabled (the corpus-real case)', () => {
    const result = validateQuest(
      cleanQuest({
        m_goals: [
          goal('1_Start', { m_destinationZone: 'WizardCity/WC_Hub' }),
          goal('2_End', { m_destinationZone: 'DragonSpire/DS_A3_Kings/Interiors/DS_School_Fire' }),
        ],
      }),
      { references },
    );
    const warnings = ofKind(result, 'zone-not-known');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warning');
    expect(warnings[0].path).toEqual(['m_goals', 1, 'm_destinationZone']);
    expect(result.blocked).toBe(false);
    expect(result.blocking).toEqual([]);
  });

  it('an empty zone value names nothing and is never a miss (423 corpus occurrences)', () => {
    const result = validateQuest(
      cleanQuest({ m_goals: [goal('1_Start', { m_destinationZone: '' })] }),
      { references },
    );
    expect(ofKind(result, 'zone-not-known')).toEqual([]);
  });

  it('unknown npc, spell, drop-table and quest references warn with their namespace', () => {
    const result = validateQuest(
      cleanQuest({
        m_endResults: resultList([
          resultNode(RESULT_TYPES.ResDropTable, { m_tableName: 'WC-GONE-001' }),
          resultNode(RESULT_TYPES.ResGiveSpell, { m_spellID: 42, m_templateID: 7 }),
        ]),
        m_dialogList: {
          m_dialogs: [
            {
              m_dialogTag: 'Prep',
              m_dialogEntries: [
                {
                  $type: TYPE_STRINGS.NPCDialogEntry,
                  m_actorTemplateID: 999,
                  m_walkAwayNpcTemplateID: 0,
                },
              ],
            },
          ],
        },
        m_requirements: {
          m_requirements: [{ $type: TYPE_STRINGS.ReqHasQuest, m_questName: 'WC-GONE-002' }],
        },
      }),
      { references },
    );
    const warnings = ofKind(result, 'reference-not-known');
    expect(warnings.map((finding) => finding.namespace)).toEqual([
      'drop_tables',
      'spells',
      'npcs',
      'npcs',
      'quests',
    ]);
    expect(warnings.map((finding) => findingField(finding))).toEqual([
      'm_endResults.m_results[0].m_tableName',
      'm_endResults.m_results[1].m_spellID',
      'm_endResults.m_results[1].m_templateID',
      'm_dialogList.m_dialogs[0].m_dialogEntries[0].m_actorTemplateID',
      'm_requirements.m_requirements[0].m_questName',
    ]);
    expect(result.blocked).toBe(false);
    // The `0` walk-away value is the measured "none" and is not looked up.
    expect(warnings.some((finding) => finding.value === 0)).toBe(false);
  });

  it('ResDrawHand.m_templateID resolves against spells OR npcs, and reports only after both miss', () => {
    const drawHand = (id: number): Record<string, unknown> =>
      cleanQuest({
        m_endResults: resultList([resultNode(RESULT_TYPES.ResDrawHand, { m_templateID: id })]),
      });
    expect(
      ofKind(validateQuest(drawHand(2062265892), { references }), 'reference-not-known'),
    ).toEqual([]);
    expect(ofKind(validateQuest(drawHand(126321), { references }), 'reference-not-known')).toEqual(
      [],
    );
    const miss = ofKind(validateQuest(drawHand(625720646), { references }), 'reference-not-known');
    expect(miss).toHaveLength(1);
    expect(miss[0].namespace).toBe('spells');
    expect(miss[0].searchedNamespaces).toEqual(['spells', 'npcs']);
    expect(findingMessage(miss[0])).toContain('spells or npcs');
  });

  it('omitting a namespace disables that rule instead of reporting every value', () => {
    const doc = cleanQuest({
      m_endResults: resultList([
        resultNode(RESULT_TYPES.ResDropTable, { m_tableName: 'WC-GONE-001' }),
      ]),
      m_goals: [goal('1_Start', { m_destinationZone: 'Nope/Not/A/Zone' })],
    });
    expect(validateQuest(doc).warnings).toEqual([]);
    expect(validateQuest(doc, { references: {} }).warnings).toEqual([]);
  });
});

describe('p3-09 — reachability: one fixpoint, a warning, and the read of "no logic"', () => {
  it('runs the same fixpoint the flowchart banner uses, for every quest shape', () => {
    const quest = cleanQuest();
    const shared = goalLogicReachability(quest);
    const engine = validateQuest(quest);
    expect(shared.reachable).toEqual(['1_Start', '2_End']);
    expect(shared.unreachable).toEqual([]);
    expect(shared.completeReachable).toBe(true);
    expect(ofKind(engine, 'goal-unreachable')).toEqual([]);
  });

  it('reports every named goal when m_startGoals seeds nothing, as a warning', () => {
    const result = validateQuest(cleanQuest({ m_startGoals: [] }));
    const warnings = ofKind(result, 'goal-unreachable');
    expect(warnings).toHaveLength(2);
    expect(warnings.map((finding) => finding.path)).toEqual([
      ['m_goals', 0],
      ['m_goals', 1],
    ]);
    expect(warnings.every((finding) => finding.severity === 'warning')).toBe(true);
    expect(result.blocked).toBe(false);
  });

  it('flags a non-start goal of a logic-less quest (the literal reading)', () => {
    const result = validateQuest(cleanQuest({ m_goalLogic: [] }));
    expect(ofKind(result, 'goal-unreachable').map((finding) => finding.goalName)).toEqual([
      '2_End',
    ]);
    expect(result.blocked).toBe(false);
  });

  it('honours AND, OR counts and completion exactly as the domain reference states', () => {
    const doc = cleanQuest({
      m_startGoals: ['1_Start'],
      m_goals: [goal('1_Start'), goal('2_A'), goal('3_B'), goal('4_C')],
      m_goalLogic: [
        // `m_requiredORCount: 2` over two names: fires only when both are reachable, and
        // neither is (only `1_Start` is).
        {
          m_goalsAND: [],
          m_goalsOR: ['2_A', '3_B'],
          m_goalsToAdd: ['4_C'],
          m_completeQuest: false,
          m_requiredORCount: 2,
        },
        // A completing entry whose AND list is never reachable: the quest can never complete.
        {
          m_goalsAND: ['2_A', '3_B', '4_C'],
          m_goalsOR: [],
          m_goalsToAdd: [],
          m_completeQuest: true,
          m_requiredORCount: 1,
        },
      ],
    });
    const reachability = goalLogicReachability(doc);
    expect(reachability.reachable).toEqual(['1_Start']);
    expect(reachability.unreachable).toEqual(['2_A', '3_B', '4_C']);
    expect(reachability.completeReachable).toBe(false);
    expect(ofKind(validateQuest(doc), 'goal-unreachable')).toHaveLength(3);
  });

  it('reports nothing for a document with no named goals', () => {
    expect(validateQuest({ m_questName: 'X', m_goals: [], m_startGoals: [] }).findings).toEqual([]);
    // A start goal that names no goal is rule 2's own finding, not a reachability one.
    const dangling = validateQuest({ m_questName: 'X', m_goals: [], m_startGoals: ['1_Start'] });
    expect(ofKind(dangling, 'start-goal-unknown')).toHaveLength(1);
    expect(goalLogicReachability({}).unreachable).toEqual([]);
  });
});

describe('p3-09 — the banner summary vocabulary', () => {
  it('labels every kind and counts a mixed result set', () => {
    const result = validateQuest(
      cleanQuest({
        m_questName: '',
        m_startGoals: ['9_Gone'],
        m_goals: [goal('1_Start', { m_destinationZone: 'Nope/Zone' })],
      }),
      { references: { zones: new Set(['WizardCity/WC_Hub']) } },
    );
    expect(result.blocking).toHaveLength(2);
    // the zone warning, plus the sole goal of this fixture being unreachable
    expect(result.warnings).toHaveLength(2);
    expect(blockingSummary(result.blocking)).toBe(
      'Quest validation failed with 2 validation errors (Missing quest name, Unknown start goal).',
    );
    expect(kindLabel(result.warnings[0].kind)).toBe('Unknown zone');
  });
});

/* --------------------------------------------------------------- corpus sweep */

describe.runIf(CORPUS !== null && REFERENCES !== null)(
  'p3-09 — the engine over the real corpus (owner run)',
  () => {
    // Declared, not initialised, at collection time: `describe.runIf` still EVALUATES this
    // callback on a machine without the sibling checkout — which is what CI is — so any eager
    // work here threw `Cannot read properties of null (reading 'map')` and failed the suite
    // instead of skipping it (found by gate-3's CI run, fixed here).
    let corpus: CorpusQuest[];
    let references: QuestValidationReferences;
    let results: Array<CorpusQuest & { result: QuestValidationResult }>;
    beforeAll(() => {
      corpus = CORPUS as CorpusQuest[];
      references = REFERENCES as QuestValidationReferences;
      results = corpus.map((quest) => ({
        ...quest,
        result: validateQuest(quest.doc, { references }),
      }));
    });

    it('validates every corpus file without mutating one', () => {
      // 330 at the owner fork's `864bd44` (the Phase 7 baseline, D145(b)): 328 at `d57d891` plus the two
      // harness-authored scaffolds `7e34bed`/`864bd44` (an owner post-run review item; if the owner drops
      // them this returns to 328).
      expect(corpus.length).toBe(330);
      const before = corpus.map((quest) => serializeDoc(quest.doc));
      for (const quest of corpus) {
        validateQuest(quest.doc, { references });
      }
      expect(corpus.map((quest) => serializeDoc(quest.doc))).toEqual(before);
    });

    it('produces zero findings of the six zero-instance rules (their UI paths are fixture-only)', () => {
      const zeroKinds: QuestFindingKind[] = [
        'quest-name-missing',
        'start-goal-unknown',
        'duplicate-goal-name',
        'goal-logic-not-completing',
        'unknown-type',
        'template-id-not-positive',
      ];
      const found: string[] = [];
      for (const quest of results) {
        for (const kind of zeroKinds) {
          for (const finding of ofKind(quest.result, kind)) {
            found.push(
              `${quest.name} ${kind} ${findingField(finding)}=${JSON.stringify(finding.value)}`,
            );
          }
        }
      }
      expect(found).toEqual([]);
      expect(results.every((quest) => quest.result.blocking.length === 0)).toBe(true);
    });

    it('finds exactly the 3 measured reachability failures, 25 unreachable goals in total (D79)', () => {
      const perQuest = results
        .map((quest) => ({
          name: quest.name,
          goals: ofKind(quest.result, 'goal-unreachable').length,
        }))
        .filter((entry) => entry.goals > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
      // Re-measured at f9a1055: `WC-CYCLOPS-MAIN-002` (6) and `WC-TRITON-MAIN-008` (4) no
      // longer strand a goal — the owner's own commits fixed both files — so the set is these
      // three, and the total is 25 (the brief's "31" was this file's *other-warnings* count
      // while the six stale-DB reference warnings were still present: 25 + 6).
      expect(perQuest).toEqual([
        { name: 'WC-TUT-C03-001', goals: 19 },
        { name: 'WC-TUT-C05-001', goals: 5 },
        { name: 'WC-TUT-C08-001', goals: 1 },
      ]);
      expect(
        results.reduce((sum, quest) => sum + ofKind(quest.result, 'goal-unreachable').length, 0),
      ).toBe(25);
      // Every failing quest has an **empty** `m_startGoals`; nothing else in the corpus
      // strands a goal, so the literal reading and the "no start goals" case coincide.
      for (const quest of results.filter(
        (entry) => ofKind(entry.result, 'goal-unreachable').length > 0,
      )) {
        expect((quest.doc as { m_startGoals?: unknown }).m_startGoals).toEqual([]);
      }
    });

    it('emits exactly 0 zone warnings and no other warning than the 25 unreachable goals (D145)', () => {
      // Re-measured at p7-02 (D145). The 94 zone warnings (31 m_cameraZoneName / 43 m_destinationZone /
      // 20 m_zoneTag) were the quest zone references absent from a `zones` table of 1,241 rows, the
      // distinct ZoneName + destination set of the ZoneTransfer files; the Phase 6 breadth sync (D120)
      // made `zones` the 3,357 `WizardZoneData` rows, and all 1,510 zone-field values in the 330-file
      // corpus resolve in it. The table size is asserted first so an empty set cannot pass as 0.
      expect(references.zones?.size).toBe(3357);
      const zoneWarnings = results.flatMap((quest) => ofKind(quest.result, 'zone-not-known'));
      expect(zoneWarnings).toHaveLength(0);
      const other = results.flatMap((quest) =>
        quest.result.warnings.filter((finding) => finding.kind !== 'zone-not-known'),
      );
      // Re-measured: 25 unreachable goals are the only other warnings (was 35 unreachable; the
      // 6 that made it 31 here in between were the stale-DB reference misses, see below).
      expect(other).toHaveLength(25); // the reachability warnings are the only others
      expect(other.every((finding) => finding.kind === 'goal-unreachable')).toBe(true);
    });

    it('emits zero reference warnings — the DB was re-synced, and the ResDrawHand values resolve (D63(c)/D80b)', () => {
      const referenceWarnings = results.flatMap((quest) =>
        ofKind(quest.result, 'reference-not-known'),
      );
      expect(referenceWarnings).toEqual([]);

      // The trap, asserted directly: 8 distinct ResDrawHand ids, 6 in spells, 2 in npcs, 0 in both.
      const ids: number[] = [];
      const collect = (node: unknown): void => {
        if (Array.isArray(node)) {
          node.forEach(collect);
          return;
        }
        if (typeof node !== 'object' || node === null) {
          return;
        }
        const record = node as Record<string, unknown>;
        if (record.$type === RESULT_TYPES.ResDrawHand && typeof record.m_templateID === 'number') {
          ids.push(record.m_templateID);
        }
        Object.values(record).forEach(collect);
      };
      for (const quest of corpus) {
        collect(quest.doc);
      }
      const distinct = [...new Set(ids)].sort((a, b) => a - b);
      expect(distinct).toHaveLength(8);
      expect(distinct.filter((id) => references.spells?.has(String(id)) === true)).toHaveLength(6);
      expect(distinct.filter((id) => references.npcs?.has(String(id)) === true)).toHaveLength(2);
      expect(
        distinct.filter(
          (id) =>
            references.spells?.has(String(id)) === true &&
            references.npcs?.has(String(id)) === true,
        ),
      ).toEqual([]);

      // And the counter-check on a fixture built from the corpus's own 8 ids: with the spell
      // table withheld, exactly 6 of them become warnings — the false positives a
      // single-source (NPC-only) reading of D63(c)'s dual-namespace field would emit.
      const drawHands = cleanQuest({
        m_endResults: resultList(
          distinct.map((id) => resultNode(RESULT_TYPES.ResDrawHand, { m_templateID: id })),
        ),
      });
      expect(ofKind(validateQuest(drawHands, { references }), 'reference-not-known')).toEqual([]);
      const npcOnly = validateQuest(drawHands, {
        references: { ...references, spells: undefined },
      });
      expect(ofKind(npcOnly, 'reference-not-known')).toHaveLength(6);
    });

    it('prints the measured summary line (the evidence record)', () => {
      const errors = results.reduce((sum, quest) => sum + quest.result.blocking.length, 0);
      const warnings = results.reduce((sum, quest) => sum + quest.result.warnings.length, 0);
      console.log(
        `[p3-09 corpus] files=${corpus.length} errors=${errors} warnings=${warnings} ` +
          `(zone=${results.reduce((sum, quest) => sum + ofKind(quest.result, 'zone-not-known').length, 0)}, ` +
          `unreachable=${results.reduce((sum, quest) => sum + ofKind(quest.result, 'goal-unreachable').length, 0)}, ` +
          `reference=${results.reduce((sum, quest) => sum + ofKind(quest.result, 'reference-not-known').length, 0)}) ` +
          `| 6 zero-instance rules = 0`,
      );
      expect(errors).toBe(0);
      expect(warnings).toBe(25); // 0 zone + 25 unreachable (was 119 = 94 + 25; D145)
    });
  },
);
