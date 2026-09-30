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
 */

const ROOT = resolveRepoRoot();
const P7_DIR = path.join(ROOT, 'server', 'test', 'fixtures', 'captures', 'p7');
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

interface Step {
  message: string;
  goal?: number;
  fields?: Record<string, unknown>;
}
interface InjectSpec {
  sendQuestFields: Record<string, unknown>;
  sequence: Step[];
}
interface Envelope {
  data: { name: string; fields: Record<string, { value: unknown }> };
}
type Json = Record<string, unknown>;
interface Report {
  report: string;
  quest: string;
  path: string;
  source: string;
  value: unknown;
  reason: string;
}

const quests = fs
  .readdirSync(P7_DIR)
  .filter((f) => f.endsWith('.inject.json'))
  .map((f) => f.slice(0, -'.inject.json'.length))
  .sort();

const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;

// QuestID/GoalID are u64 and exceed 2^53: parse the capture losslessly (ids become bigints) so two
// GoalIDs can never collide in the test's own goal join.
type Reviver = (key: string, value: unknown, context: { source?: string }) => unknown;
const exactIds: Reviver = (_key, value, context) =>
  typeof value === 'number' && !Number.isSafeInteger(value) && context.source !== undefined
    ? BigInt(context.source)
    : value;
const readCapture = (file: string): Envelope[] =>
  JSON.parse(
    fs.readFileSync(file, 'utf8'),
    exactIds as Parameters<typeof JSON.parse>[1],
  ) as Envelope[];
const parseReports = (text: string): Report[] =>
  text
    .split('\n')
    .filter((line) => line.startsWith('{"report":"observed-field"'))
    .map((line) => JSON.parse(line) as Report);

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
  const f = (e: Envelope, name: string): unknown => e.data.fields[name]?.value;

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

  // The sequence appears in the capture as an in-order subsequence: pair each step with its envelope.
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

  // The wrapper's goal identity: the first GoalID to carry a GoalNameID owns that extracted goal.
  const questId = f(
    capture.find((e) => e.data.name === 'MSG_SENDQUEST')!,
    'QuestID',
  );
  const owner = new Map<unknown, unknown>();
  for (const e of capture) {
    if (
      e.data.name === 'MSG_SENDGOAL' &&
      f(e, 'QuestID') === questId &&
      !owner.has(f(e, 'GoalNameID'))
    ) {
      owner.set(f(e, 'GoalNameID'), f(e, 'GoalID'));
    }
  }
  const goals = (output.m_goals ?? []) as Json[];
  const goalFor = (goalId: unknown): { goal?: Json; path: string } => {
    const send = capture.find((e) => e.data.name === 'MSG_SENDGOAL' && f(e, 'GoalID') === goalId)!;
    const nameId = f(send, 'GoalNameID');
    const goal =
      owner.get(nameId) === goalId ? goals.find((g) => g.m_goalNameID === nameId) : undefined;
    return {
      goal,
      path: goal ? `m_goals[${String(goal.m_goalName)}]` : `m_goals[GoalID ${String(goalId)}]`,
    };
  };

  spec.sequence.forEach((step, index) => {
    const envelope = envelopes[index]!;
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
    (x) => x.data.name === 'MSG_SENDGOAL' && f(x, 'QuestID') === questId,
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
    const reports = parseReports(
      fs.readFileSync(path.join(P7_DIR, `${quest}.extract.reports.jsonl`), 'utf8'),
    );

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
      expect(
        stderr.split('\n').filter((line) => line.startsWith('{"report":"observed-field"')),
      ).toEqual(
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
  },
);
