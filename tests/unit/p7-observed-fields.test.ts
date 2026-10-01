import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { resolveRepoRoot } from '@server/db';
import {
  buildChildEnv,
  createExtractionService,
  type ObservedFieldReport,
  screenObservedFields,
} from '@server/services/extraction';
import { TYPE_STRINGS } from '@shared/quest/index';
import {
  exactIds,
  P7_DIR,
  p7Quests as quests,
  readJson,
  type Envelope,
  type InjectSpec,
  type Step,
} from '../helpers/p7-fixtures';

/**
 * Phase 7 task 7.3 (p7-04, D126/D127) — the wrapper's observed-field post-pass.
 *
 * CI has no .NET SDK (D55), so the CI-bound arm checks the committed wrapper output of every p7 fixture
 * (`<QUEST>.extract.json`, the CLI's stdout) and its report lines (`<QUEST>.extract.reports.jsonl`, the
 * CLI's stderr) against the `--inject` spec that planted the values: every planted observed value is
 * either at its expected path exactly, or reported with its reason — never both, never neither, and no
 * report is unexplained. Goals are identified the way the wrapper joins them (first `GoalID` to carry a
 * `GoalNameID` owns the extracted goal with that `m_goalNameID`), never by array position. The local-only
 * arm regenerates both goldens and byte-compares them, and proves an unmapped enum byte and a non-0/1
 * flag are reported, not written.
 *
 * Task 7.4 (p7-05) checks the reader repairs on the same goldens: every goal the capture introduces is
 * joined to exactly one extracted goal (an ACHIEVERANK goal with an empty title, which the reader drops
 * as a duplicate `GoalNameID`, is added back in capture order) and every goal is named
 * `{n}_{m_goalTitle}` by its position; a goal of a type QuestBuilder does not list is excluded and
 * reported; each container's dialog tags are exactly those of the dialog packets joined to it (the
 * quest's own only from GoalID-0 packets); a planted dialog lands with its lines; and every
 * `reader-repair` / `goal-excluded` line is one the capture explains.
 */

const ROOT = resolveRepoRoot();
const CLI = path.join(ROOT, 'tools', 'bin', 'imview-packet-reader');

// Imcodec's generated ActivityType enum (ActivityType.g.cs), the wrapper's decode table.
const ACTIVITY = [
  'ACTIVITY_NotActivity',
  'ACTIVITY_Spell',
  'ACTIVITY_Crafting',
  'ACTIVITY_Fishing',
  'ACTIVITY_Gardening',
  'ACTIVITY_Pet',
];

// QuestBuilder.GetGoalFromType's list (QuestBuilder.cs:484-494); any other GoalType makes it throw.
const LISTED_GOAL_TYPES = new Set([1, 2, 3, 4, 5, 7, 8]);
const ACHIEVERANK = 7;
const DIALOG_MESSAGES = new Set(['MSG_ACTORDIALOG', 'MSG_ENCOUNTERDIALOG']);
const REWARD_MESSAGES = new Set(['MSG_QUESTREWARDS', 'MSG_LOOT']);

type Json = Record<string, unknown>;
interface Report {
  report: string;
  quest: string;
  path: string;
  source: string;
  value: unknown;
  reason: string;
}
interface PlantedDialog {
  $blob: 'ActorDialog';
  entries: string[];
}

const readCapture = (file: string): Envelope[] =>
  JSON.parse(
    fs.readFileSync(file, 'utf8'),
    exactIds as Parameters<typeof JSON.parse>[1],
  ) as Envelope[];
// Every wrapper report line: observed-field (D152), reader-repair and goal-excluded (task 7.4).
const parseReports = (text: string): Report[] =>
  text
    .split('\n')
    .filter((line) => line.startsWith('{"report":'))
    .map((line) => JSON.parse(line, exactIds as Parameters<typeof JSON.parse>[1]) as Report);

const f = (e: Envelope, name: string): unknown => e.data.fields[name]?.value;
const idOf = (e: Envelope, name: string): unknown => f(e, name) ?? 0;
const text = (value: unknown): string => String(value);
const isPlantedDialog = (value: unknown): value is PlantedDialog =>
  typeof value === 'object' && value !== null && (value as PlantedDialog).$blob === 'ActorDialog';
const dialogsOf = (owner: Json | undefined): Json[] =>
  ((owner?.m_dialogList as Json | null | undefined)?.m_dialogs ?? []) as Json[];
const tagsOf = (owner: Json | undefined): string[] =>
  dialogsOf(owner)
    .map((d) => String(d.m_dialogTag))
    .sort();
const linesOf = (dialog: Json | undefined): string[] =>
  ((dialog?.m_dialogEntries ?? []) as Json[]).map((e) => String(e.m_dialog));

/** QuestBuilder's goal-dialog tag rule (QuestBuilder.cs:396-403). */
const goalTag = (completionType: string): string =>
  (
    ({
      questinfo: 'QuestInfo',
      prep: 'Prep',
      underway: 'Underway',
      completion: 'Completion',
      hyperlink: 'Hyperlink',
    }) as Record<string, string>
  )[completionType.toLowerCase()] ?? completionType;
/** The quest-level tags: QuestBuilder's QuestInfo -> Prep and Completion, plus the post-pass's Underway. */
const questTag = (completionType: string): string | undefined =>
  (
    ({ questinfo: 'Prep', completion: 'Completion', underway: 'Underway' }) as Record<
      string,
      string
    >
  )[completionType.toLowerCase()];

/** The capture's goals, joined to the output the way the wrapper joins them (D150 + task 7.4). */
function joinGoals(capture: Envelope[], output: Json) {
  const questId = f(
    capture.find((e) => e.data.name === 'MSG_SENDQUEST')!,
    'QuestID',
  );
  const sends = capture.filter(
    (e) => e.data.name === 'MSG_SENDGOAL' && f(e, 'QuestID') === questId,
  );
  // A goal of a type QuestBuilder does not list is excluded, with every message carrying its GoalID.
  const excluded = new Map<unknown, unknown>();
  for (const e of sends) {
    if (!LISTED_GOAL_TYPES.has(Number(f(e, 'GoalType')))) {
      excluded.set(f(e, 'GoalID'), f(e, 'GoalType'));
    }
  }
  // The first GoalID to carry a GoalNameID owns the extracted goal with that m_goalNameID; a later GoalID
  // whose packet is an ACHIEVERANK goal with an empty title is a distinct goal the wrapper adds back.
  const owner = new Map<unknown, unknown>();
  const joined = new Map<unknown, unknown[]>();
  for (const e of sends) {
    const goalId = f(e, 'GoalID');
    const nameId = f(e, 'GoalNameID');
    if (excluded.has(goalId) || [...joined.values()].some((ids) => ids.includes(goalId))) {
      continue;
    }
    const recovered =
      owner.has(nameId) && f(e, 'GoalType') === ACHIEVERANK && f(e, 'GoalTitle') === '';
    if (!owner.has(nameId)) {
      owner.set(nameId, goalId);
    }
    if (owner.get(nameId) === goalId || recovered) {
      joined.set(nameId, [...(joined.get(nameId) ?? []), goalId]);
    }
  }
  const goals = (output.m_goals ?? []) as Json[];
  const goalById = new Map<unknown, Json | undefined>();
  for (const [nameId, ids] of joined) {
    const matching = goals.filter((g) => g.m_goalNameID === nameId);
    ids.forEach((goalId, i) => goalById.set(goalId, matching[i]));
  }
  const goalFor = (goalId: unknown): { goal?: Json; path: string } => {
    const goal = goalById.get(goalId);
    return {
      goal,
      path: goal ? `m_goals[${String(goal.m_goalName)}]` : `m_goals[GoalID ${String(goalId)}]`,
    };
  };
  return { questId, sends, excluded, owner, goalById, goalFor };
}

/** One planted observed value and where it must end up. */
interface Expectation {
  label: string;
  path: string;
  source: string;
  value: unknown;
  /** The value at `path` in the output, when the value is written. */
  written?: unknown;
  /** Set when the value has no home and must be reported instead. */
  reported?: true;
}

/** Everything the spec (and the capture it produced) says the wrapper must recover or report. */
function expectationsFor(
  quest: string,
  spec: InjectSpec,
  capture: Envelope[],
  output: Json,
): Expectation[] {
  const expectations: Expectation[] = [];

  // Quest-level MSG_SENDQUEST extras. Rewards is inferred data (task 7.5), not an observed field.
  const questKeys: Record<string, [string, (v: unknown) => unknown]> = {
    QuestNameID: ['m_questNameID', (v) => v],
    QuestInfo: ['m_questInfo', (v) => v],
    NoQuestHelper: ['m_noQuestHelper', (v) => v === 1],
    SkipQHAutoSelect: ['m_skipQHAutoSelect', (v) => v === 1],
    ActivityType: ['m_activityType', (v) => ACTIVITY[v as number]],
    ClientTags: ['m_clientTags', (v) => (v as { tags: string[] }).tags],
  };
  for (const [field, value] of Object.entries(spec.sendQuestFields)) {
    const source = `MSG_SENDQUEST.${field}`;
    if (field === 'Rewards') {
      continue;
    }
    if (field === 'PetOnlyQuest') {
      expectations.push({ label: source, path: 'm_petOnlyQuest', source, value, reported: true });
      continue;
    }
    const [key, decode] = questKeys[field] ?? [];
    expect(key, `a planted ${source} the test does not know`).toBeDefined();
    expectations.push({
      label: source,
      path: key!,
      source,
      value: decode!(value),
      written: output[key!],
    });
  }

  const envelopes = stepEnvelopes(quest, spec, capture);
  const { questId, excluded, goalFor } = joinGoals(capture, output);

  spec.sequence.forEach((step, index) => {
    const envelope = envelopes[index]!;
    // Task 7.4's planted goal type and dialogs have their own checks (see the describe block).
    if (excluded.has(idOf(envelope, 'GoalID')) || DIALOG_MESSAGES.has(step.message)) {
      if (DIALOG_MESSAGES.has(step.message)) {
        pushDialogFlags(expectations, step, envelope, capture, questId, goalFor);
      }
      return;
    }
    // Task 7.5's reward packets are inferred data, checked against the sidecar (p7-suggestions.test.ts).
    if (REWARD_MESSAGES.has(step.message)) {
      return;
    }
    for (const [field, value] of Object.entries(step.fields ?? {})) {
      const source = `${step.message}.${field}`;
      const label = `${source} (goal ${step.goal ?? '-'})`;
      if (step.message === 'MSG_COMPLETEQUEST') {
        expectations.push({ label, path: 'm_questComplete', source, value, reported: true });
        continue;
      }
      const key = {
        PersonaName: 'm_personaName',
        CompleteText: 'm_completeText',
        GoalHyperlink: 'm_hyperlink',
      }[field];
      expect(key, `a planted ${source} the test does not know`).toBeDefined();
      const { goal, path: goalPath } = goalFor(f(envelope, 'GoalID'));
      const homeless =
        !goal || (key === 'm_personaName' && goal.$type !== TYPE_STRINGS.PersonaGoalTemplate);
      expectations.push(
        homeless
          ? { label, path: `${goalPath}.${key}`, source, value, reported: true }
          : { label, path: `${goalPath}.${key}`, source, value, written: goal[key!] },
      );
    }
  });

  // The goal flags ride on every MSG_SENDGOAL (corpus values, not planted): written as booleans.
  for (const e of capture.filter(
    (x) =>
      x.data.name === 'MSG_SENDGOAL' &&
      f(x, 'QuestID') === questId &&
      !excluded.has(f(x, 'GoalID')),
  )) {
    const { goal, path: goalPath } = goalFor(f(e, 'GoalID'));
    if (!goal) {
      continue;
    }
    for (const [field, key] of [
      ['NoQuestHelper', 'm_noQuestHelper'],
      ['PetOnlyQuest', 'm_petOnlyQuest'],
    ] as const) {
      const source = `MSG_SENDGOAL.${field}`;
      expectations.push({
        label: `${source} (GoalID ${String(f(e, 'GoalID'))})`,
        path: `${goalPath}.${key}`,
        source,
        value: f(e, field) === 1,
        written: goal[key],
      });
    }
  }

  return expectations;
}

/** The sequence appears in the capture as an in-order subsequence: pair each step with its envelope. */
function stepEnvelopes(quest: string, spec: InjectSpec, capture: Envelope[]): Envelope[] {
  const envelopes: Envelope[] = [];
  let at = 0;
  for (const step of spec.sequence) {
    while (capture[at] && capture[at]!.data.name !== step.message) {
      at += 1;
    }
    expect(capture[at], `${quest}: step ${step.message} not in the capture`).toBeDefined();
    envelopes.push(capture[at]!);
    at += 1;
  }
  return envelopes;
}

/** The container path of a dialog packet, as the wrapper names it. */
function dialogPath(envelope: Envelope, goalFor: (goalId: unknown) => { path: string }): string {
  const completionType = String(f(envelope, 'CompletionType') ?? '');
  const goalId = idOf(envelope, 'GoalID');
  return goalId === 0
    ? `m_dialogList[${questTag(completionType) ?? completionType}]`
    : `${goalFor(goalId).path}.m_dialogList[${goalTag(completionType)}]`;
}

/** A planted IsYesNo (non-zero) / DefaultDialogAnimation (non-empty) has no home: it is reported. */
function pushDialogFlags(
  expectations: Expectation[],
  step: Step,
  envelope: Envelope,
  _capture: Envelope[],
  _questId: unknown,
  goalFor: (goalId: unknown) => { path: string },
): void {
  for (const field of ['IsYesNo', 'DefaultDialogAnimation']) {
    const value = step.fields?.[field];
    if (value === undefined || value === 0 || value === '') {
      continue;
    }
    const source = `${step.message}.${field}`;
    expectations.push({
      label: `${source} (goal ${step.goal ?? '-'})`,
      path: `${dialogPath(envelope, goalFor)}.${field}`,
      source,
      value,
      reported: true,
    });
  }
}

/** The dialog tags each container must carry: those of the dialog packets joined to it. */
function expectedTags(capture: Envelope[], output: Json): Map<string, string[]> {
  const { questId, excluded, goalById, goalFor } = joinGoals(capture, output);
  const mobileId = f(
    capture.find((e) => e.data.name === 'MSG_QUESTOFFER')!,
    'MobileID',
  );
  const tags = new Map<string, Set<string>>([['quest', new Set()]]);
  for (const goal of goalById.values()) {
    tags.set(String(goal?.m_goalName), new Set());
  }
  for (const e of capture.filter((x) => DIALOG_MESSAGES.has(x.data.name))) {
    const completionType = String(f(e, 'CompletionType') ?? '');
    const goalId = idOf(e, 'GoalID');
    if (goalId !== 0) {
      if (!excluded.has(goalId) && goalById.get(goalId)) {
        tags.get(String(goalFor(goalId).goal!.m_goalName))!.add(goalTag(completionType));
      }
      continue;
    }
    const tag = questTag(completionType);
    const ownsIt =
      tag === 'Prep'
        ? e.data.name === 'MSG_ENCOUNTERDIALOG'
          ? f(e, 'QuestID') === questId
          : f(e, 'MobileID') === mobileId
        : f(e, 'QuestID') === questId;
    if (tag && ownsIt) {
      tags.get('quest')!.add(tag);
    }
  }
  return new Map([...tags].map(([k, v]) => [k, [...v].sort()]));
}

/** The reader-repair and goal-excluded lines the capture explains: [path, source, value]. */
function expectedRepairs(capture: Envelope[], output: Json, quest: string): string[] {
  const { questId, excluded, owner, sends, goalFor } = joinGoals(capture, output);
  const mobileId = f(
    capture.find((e) => e.data.name === 'MSG_QUESTOFFER')!,
    'MobileID',
  );
  const lines: string[] = [];
  const line = (kind: string, p: string, source: string, value: unknown): void => {
    lines.push(JSON.stringify([kind, quest, p, source, String(value)]));
  };
  for (const [goalId, goalType] of excluded) {
    line('goal-excluded', `m_goals[GoalID ${String(goalId)}]`, 'MSG_SENDGOAL.GoalType', goalType);
  }
  for (const e of sends) {
    const goalId = f(e, 'GoalID');
    if (!excluded.has(goalId) && owner.get(f(e, 'GoalNameID')) !== goalId) {
      const { goal, path: goalPath } = goalFor(goalId);
      if (goal) {
        line('reader-repair', goalPath, 'MSG_SENDGOAL', goalId);
      }
    }
  }
  // QuestBuilder's quest-level picks ignore GoalID; one made from a goal's packet is replaced or removed.
  for (const [tag, matches] of [
    [
      'Prep',
      (e: Envelope) =>
        f(e, 'MobileID') === mobileId && /^questinfo$/i.test(text(f(e, 'CompletionType'))),
    ],
    [
      'Completion',
      (e: Envelope) =>
        f(e, 'QuestID') === questId && /^completion$/i.test(text(f(e, 'CompletionType'))),
    ],
  ] as const) {
    const pick = capture.find(
      (e) => e.data.name === 'MSG_ACTORDIALOG' && !excluded.has(idOf(e, 'GoalID')) && matches(e),
    );
    if (pick && idOf(pick, 'GoalID') !== 0) {
      line('reader-repair', `m_dialogList[${tag}]`, 'MSG_ACTORDIALOG.GoalID', idOf(pick, 'GoalID'));
    }
  }
  return lines.sort();
}

describe('p7 wrapper goldens against their --inject specs (CI-bound)', () => {
  it('commits an extract golden and its report lines beside every p7 fixture', () => {
    expect(quests.length).toBeGreaterThanOrEqual(5);
    for (const quest of quests) {
      for (const suffix of ['.extract.json', '.extract.reports.jsonl']) {
        expect(fs.existsSync(path.join(P7_DIR, `${quest}${suffix}`)), `${quest}${suffix}`).toBe(
          true,
        );
      }
    }
  });

  describe.each(quests)('%s', (quest) => {
    const spec = readJson<InjectSpec>(path.join(P7_DIR, `${quest}.inject.json`));
    const capture = readCapture(path.join(P7_DIR, `${quest}.json`));
    const output = readJson<Json[]>(path.join(P7_DIR, `${quest}.extract.json`));
    const allReports = parseReports(
      fs.readFileSync(path.join(P7_DIR, `${quest}.extract.reports.jsonl`), 'utf8'),
    );
    const reports = allReports.filter((r) => r.report === 'observed-field');

    it('extracts exactly the one planted quest', () => {
      expect(output).toHaveLength(1);
      expect(output[0]!.m_questName).toBe(quest);
    });

    it('recovers every planted observed value exactly, or reports it with a reason (field-level diff = 0)', () => {
      const expectations = expectationsFor(quest, spec, capture, output[0]!);
      const diff: string[] = [];
      for (const e of expectations) {
        const matching = reports.filter((r) => r.path === e.path && r.source === e.source);
        if (e.reported) {
          if (
            !matching.some((r) => JSON.stringify(r.value) === JSON.stringify(e.value) && r.reason)
          ) {
            diff.push(
              `${e.label}: expected a report at ${e.path}, got ${JSON.stringify(matching)}`,
            );
          }
        } else if (JSON.stringify(e.written) !== JSON.stringify(e.value)) {
          diff.push(
            `${e.label}: ${e.path} expected ${JSON.stringify(e.value)}, got ${JSON.stringify(e.written)}`,
          );
        } else if (matching.length > 0) {
          diff.push(`${e.label}: written AND reported at ${e.path}`);
        }
      }
      // No report without a planted value behind it.
      for (const r of reports) {
        if (!expectations.some((e) => e.reported && e.path === r.path && e.source === r.source)) {
          diff.push(`unexplained report: ${JSON.stringify(r)}`);
        }
      }
      expect(diff).toEqual([]);
      expect(expectations.filter((e) => !e.reported).length).toBeGreaterThan(0);
    });

    it('joins every goal the capture introduces to exactly one extracted goal, named {n}_{m_goalTitle}', () => {
      const { sends, excluded, goalById } = joinGoals(capture, output[0]!);
      const goals = (output[0]!.m_goals ?? []) as Json[];
      const introduced = [...new Set(sends.map((e) => f(e, 'GoalID')))].filter(
        (id) => !excluded.has(id),
      );
      const joined = introduced.map((id) => goalById.get(id));
      expect(joined.every(Boolean), 'every GoalID joins a goal').toBe(true);
      expect(new Set(joined).size).toBe(joined.length);
      expect(goals.map((g) => g.m_goalName)).toEqual(
        goals.map((g, i) => `${i + 1}_${String(g.m_goalTitle ?? '')}`),
      );
      for (const goalType of excluded.values()) {
        expect(goals.map((g) => g.m_goalType)).not.toContain(goalType);
      }
    });

    it('gives each container exactly the dialog tags of the packets joined to it, and each planted dialog its lines', () => {
      const expected = expectedTags(capture, output[0]!);
      const actual = new Map<string, string[]>([['quest', tagsOf(output[0]!)]]);
      for (const goal of (output[0]!.m_goals ?? []) as Json[]) {
        if (expected.has(String(goal.m_goalName))) {
          actual.set(String(goal.m_goalName), tagsOf(goal));
        }
      }
      expect(Object.fromEntries(actual)).toEqual(Object.fromEntries(expected));

      const { goalFor } = joinGoals(capture, output[0]!);
      const envelopes = stepEnvelopes(quest, spec, capture);
      spec.sequence.forEach((step, index) => {
        const planted = step.fields?.ActorDialog;
        if (!DIALOG_MESSAGES.has(step.message) || !isPlantedDialog(planted)) {
          return;
        }
        const envelope = envelopes[index]!;
        const completionType = String(step.fields!.CompletionType);
        const owner = step.goal === undefined ? output[0]! : goalFor(f(envelope, 'GoalID')).goal;
        const tag = step.goal === undefined ? questTag(completionType) : goalTag(completionType);
        const dialog = dialogsOf(owner).find((d) => d.m_dialogTag === tag);
        expect(
          linesOf(dialog),
          `${step.message} ${completionType} (goal ${step.goal ?? '-'})`,
        ).toEqual(planted.entries);
      });
    });

    it('prints exactly the reader-repair and goal-excluded lines the capture explains', () => {
      const actual = allReports
        .filter((r) => r.report !== 'observed-field')
        .map((r) => {
          expect(r.reason, `${r.report} ${r.path}`).toBeTruthy();
          return JSON.stringify([r.report, r.quest, r.path, r.source, String(r.value)]);
        })
        .sort();
      expect(actual).toEqual(expectedRepairs(capture, output[0]!, quest));
    });
  });
});

describe('screenObservedFields — the shared zod schema gate (task 7.3)', () => {
  const persona = TYPE_STRINGS.PersonaGoalTemplate;
  const waypoint = TYPE_STRINGS.WaypointGoalTemplate;
  const sample = (): Json[] => [
    {
      m_questName: 'Q-1',
      m_questLevel: 'not a number, but not an observed field',
      m_questInfo: 'Info',
      m_questNameID: 'seven',
      m_activityType: 2,
      m_clientTags: ['a', 3],
      m_noQuestHelper: true,
      m_goals: [
        { $type: persona, m_goalName: '1_Talk', m_personaName: 42, m_completeText: 'Done' },
        {
          $type: waypoint,
          m_goalName: '2_Go',
          m_personaName: 'P',
          m_petOnlyQuest: 'yes',
          m_hyperlink: 'H',
        },
      ],
    },
  ];

  it('reports and removes each rejected observed value, and keeps everything else', () => {
    const reports: ObservedFieldReport[] = [];
    const [quest] = screenObservedFields(sample(), (r) => reports.push(r)) as Json[];
    const goals = quest!.m_goals as Json[];

    expect(reports.map((r) => r.path).sort()).toEqual(
      [
        'm_activityType',
        'm_clientTags',
        'm_questNameID',
        'm_goals[1_Talk].m_personaName',
        'm_goals[2_Go].m_personaName',
        'm_goals[2_Go].m_petOnlyQuest',
      ].sort(),
    );
    for (const r of reports) {
      expect(r.quest).toBe('Q-1');
      expect(r.reason).toMatch(/shared schema rejects it|schema has no m_personaName/);
    }
    expect(reports.find((r) => r.path === 'm_activityType')!.value).toBe(2);

    // Rejected -> absent from the output.
    for (const key of ['m_activityType', 'm_clientTags', 'm_questNameID']) {
      expect(quest, key).not.toHaveProperty(key);
    }
    expect(goals[0]).not.toHaveProperty('m_personaName');
    expect(goals[1]).not.toHaveProperty('m_personaName');
    expect(goals[1]).not.toHaveProperty('m_petOnlyQuest');

    // Accepted observed values stay; non-observed fields are the untouched D45 payload.
    expect(quest!.m_questInfo).toBe('Info');
    expect(quest!.m_noQuestHelper).toBe(true);
    expect(goals[0]!.m_completeText).toBe('Done');
    expect(goals[1]!.m_hyperlink).toBe('H');
    expect(quest!.m_questLevel).toBe('not a number, but not an observed field');
  });

  it('runs on every extraction, so a rejected value never reaches the caller', async () => {
    const reportObserved = vi.fn();
    const service = createExtractionService({
      cliPath: '/repo/tools/bin/imview-packet-reader',
      env: { PATH: '/nonexistent' },
      fileExists: () => true,
      reportObserved,
      exec: (_file, _args, _options, onChild) => {
        onChild?.({ pid: 1, kill: () => true });
        return Promise.resolve({ stdout: JSON.stringify(sample()), stderr: '' });
      },
    });

    const [quest] = (await service.start('/tmp/capture.json').result) as Json[];
    expect(quest).not.toHaveProperty('m_activityType');
    expect(quest!.m_questInfo).toBe('Info');
    expect(reportObserved).toHaveBeenCalledTimes(6);
    expect(reportObserved).toHaveBeenCalledWith(
      expect.objectContaining({ quest: 'Q-1', path: 'm_activityType', value: 2 }),
    );
  });
});

// A binary that is not built is a visible skip (D55 posture), as in p7-capture-census.test.ts.
describe.skipIf(!fs.existsSync(CLI))(
  'p7 wrapper goldens regenerate byte-identically (local-only)',
  () => {
    const run = (input: string): { stdout: string; stderr: string; status: number | null } => {
      const result = spawnSync(CLI, ['--input', input], {
        env: buildChildEnv(process.env),
        encoding: 'utf8',
      });
      return { stdout: result.stdout, stderr: result.stderr, status: result.status };
    };

    it.each(quests)('%s', (quest) => {
      const { stdout, stderr, status } = run(path.join(P7_DIR, `${quest}.json`));
      expect(status).toBe(0);
      expect(stdout).toBe(fs.readFileSync(path.join(P7_DIR, `${quest}.extract.json`), 'utf8'));
      expect(stderr.split('\n').filter((line) => line.startsWith('{"report":'))).toEqual(
        fs
          .readFileSync(path.join(P7_DIR, `${quest}.extract.reports.jsonl`), 'utf8')
          .split('\n')
          .filter(Boolean),
      );
    });

    it('reports an unmapped ActivityType byte and a non-0/1 flag instead of writing them', () => {
      const capture = readJson<Envelope[]>(path.join(P7_DIR, 'DS-ACAD-C01-003.json'));
      const sendQuest = capture.find((e) => e.data.name === 'MSG_SENDQUEST')!;
      sendQuest.data.fields.ActivityType = { value: 9 };
      sendQuest.data.fields.NoQuestHelper = { value: 2 };
      // …and a goal flag of 1, which must land on the goal its GoalID joins to (the persona goal).
      const personaSend = capture.find(
        (e) => e.data.name === 'MSG_SENDGOAL' && e.data.fields.GoalType?.value === 4,
      )!;
      personaSend.data.fields.PetOnlyQuest = { value: 1 };
      const scratch = fs.mkdtempSync(
        path.join(fs.realpathSync(process.env.TMPDIR ?? '/tmp'), 'p7-observed-'),
      );
      try {
        const input = path.join(scratch, 'capture.json');
        fs.writeFileSync(input, JSON.stringify(capture));
        const { stdout, stderr, status } = run(input);
        expect(status).toBe(0);
        const [quest] = JSON.parse(stdout) as Json[];
        // Not written: QuestBuilder's defaults stand.
        expect(quest!.m_activityType).toBe('ACTIVITY_NotActivity');
        expect(quest!.m_noQuestHelper).toBe(false);
        const reports = parseReports(stderr);
        expect(reports).toContainEqual(
          expect.objectContaining({
            path: 'm_activityType',
            source: 'MSG_SENDQUEST.ActivityType',
            value: 9,
            reason: "the byte has no mapping in Imcodec's ActivityType enum",
          }),
        );
        expect(reports).toContainEqual(
          expect.objectContaining({
            path: 'm_noQuestHelper',
            source: 'MSG_SENDQUEST.NoQuestHelper',
            value: 2,
          }),
        );
        // Everything else planted still lands.
        expect(quest!.m_questNameID).toBe(7700002);
        const goals = quest!.m_goals as Json[];
        expect(
          goals.find((g) => g.$type === TYPE_STRINGS.PersonaGoalTemplate)!.m_petOnlyQuest,
        ).toBe(true);
        expect(
          goals.find((g) => g.$type !== TYPE_STRINGS.PersonaGoalTemplate)!.m_petOnlyQuest,
        ).toBe(false);
      } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
      }
    });

    // Task 7.4 paths the committed fixtures do not take: an encounter dialog meeting a block of its tag
    // (identical: skipped; different: reported, never replacing), and a recovered ACHIEVERANK goal that
    // precedes a reader goal in capture order (the reader goal is renamed by its new position).
    const runMutated = (fixture: string, mutate: (capture: Envelope[]) => void) => {
      const capture = readJson<Envelope[]>(path.join(P7_DIR, `${fixture}.json`));
      mutate(capture);
      const scratch = fs.mkdtempSync(
        path.join(fs.realpathSync(process.env.TMPDIR ?? '/tmp'), 'p7-repairs-'),
      );
      try {
        const input = path.join(scratch, 'capture.json');
        fs.writeFileSync(input, JSON.stringify(capture));
        const { stdout, stderr, status } = run(input);
        expect(status).toBe(0);
        return { quest: (JSON.parse(stdout) as Json[])[0]!, reports: parseReports(stderr) };
      } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
      }
    };

    it('skips an identical encounter dialog and reports a different one instead of replacing', () => {
      const { quest, reports } = runMutated('MS-DTH1-C01-002', (capture) => {
        const underway = capture.find(
          (e) =>
            e.data.name === 'MSG_ACTORDIALOG' &&
            e.data.fields.IsYesNo?.value === 1 &&
            e.data.fields.GoalID?.value !== 0,
        )!;
        const encounter = capture.find(
          (e) =>
            e.data.name === 'MSG_ENCOUNTERDIALOG' &&
            e.data.fields.CompletionType?.value === 'Completion' &&
            e.data.fields.GoalID?.value !== 0,
        )!;
        // The goal-1 Completion encounter now repeats the goal-1 Underway actor dialog: identical.
        const identical = structuredClone(encounter);
        identical.data.fields.CompletionType = { value: 'Underway' };
        identical.data.fields.ActorDialog = underway.data.fields.ActorDialog!;
        // …and a second one carries the Completion lines under the same tag: different.
        const different = structuredClone(encounter);
        different.data.fields.CompletionType = { value: 'Underway' };
        capture.push(identical, different);
      });
      const goal = (quest.m_goals as Json[])[1]!;
      expect(linesOf(dialogsOf(goal).find((d) => d.m_dialogTag === 'Underway'))).toEqual([
        'P7-PLANT-Dialog-MS-DTH1-C01-002-g1-Underway-1',
        'P7-PLANT-Dialog-MS-DTH1-C01-002-g1-Underway-2',
      ]);
      const conflicts = reports.filter((r) => r.source === 'MSG_ENCOUNTERDIALOG.ActorDialog');
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.path).toBe(`m_goals[${String(goal.m_goalName)}].m_dialogList[Underway]`);
      expect(conflicts[0]!.reason).toMatch(/never replaces/);
    });

    it('reports an MSG_ACTORDIALOG whose GoalID no extracted quest introduces, as the encounter twin does (PR #14 review 9l)', () => {
      const { reports } = runMutated('MS-DTH1-C01-002', (capture) => {
        const goalDialog = capture.find(
          (e) =>
            e.data.name === 'MSG_ACTORDIALOG' &&
            e.data.fields.GoalID?.value !== 0 &&
            e.data.fields.GoalID?.value !== undefined,
        )!;
        const orphan = structuredClone(goalDialog);
        orphan.data.fields.GoalID = { value: 424242 };
        capture.push(orphan);
      });
      const orphans = reports.filter(
        (r) => r.source === 'MSG_ACTORDIALOG.ActorDialog' && r.path.includes('GoalID 424242'),
      );
      expect(orphans).toHaveLength(1);
      expect(orphans[0]!.reason).toBe(
        'no MSG_SENDGOAL of an extracted quest introduces GoalID 424242',
      );
    });

    it('renames a reader goal that a recovered ACHIEVERANK goal precedes in capture order', () => {
      const { quest, reports } = runMutated('WC-TUT-C05-001', (capture) => {
        const sends = capture.filter((e) => e.data.name === 'MSG_SENDGOAL');
        // The last goal becomes a titled Waypoint: the reader adds it second, after the first ACHIEVERANK.
        Object.assign(sends.at(-1)!.data.fields, {
          GoalType: { value: 5 },
          GoalNameID: { value: 12345 },
          GoalTitle: { value: 'P7-Waypoint' },
        });
      });
      expect((quest.m_goals as Json[]).map((g) => g.m_goalName)).toEqual([
        '1_',
        '2_',
        '3_',
        '4_',
        '5_P7-Waypoint',
      ]);
      expect(reports).toContainEqual(
        expect.objectContaining({
          report: 'reader-repair',
          path: 'm_goals[5_P7-Waypoint]',
          value: '2_P7-Waypoint',
        }),
      );
    });
  },
);
