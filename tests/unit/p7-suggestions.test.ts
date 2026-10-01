import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { MEMORY_DB, openDb, resolveRepoRoot, writeSettings, type Db } from '@server/db';
import { createExtractRouter } from '@server/routes/extract';
import { createQuestsRouter } from '@server/routes/quests';
import {
  buildChildEnv,
  createExtractionService,
  type CaptureSuggestion,
} from '@server/services/extraction';
import { parseDocPath, setAtPath } from '@shared/document';
import {
  QuestTemplateSchema,
  ResultTemplateSchema,
  TYPE_STRINGS,
  type ResultTemplate,
} from '@shared/quest/index';
import { goalLogicReachability, validateQuest } from '@shared/quest/validation';
import {
  createTempGitRepo,
  readRepoFile,
  removeTempGitRepo,
  type TempRepo,
} from '../helpers/temp-git-repo';
import {
  exactIds,
  P7_DIR,
  p7Quests as quests,
  readJson,
  specOf,
  type Envelope,
  type InjectSpec,
} from '../helpers/p7-fixtures';

/**
 * Phase 7 task 7.5 (p7-06, D127/D138) — the wrapper's `--suggestions` sidecar.
 *
 * CI has no .NET SDK (D55), so the CI-bound arm checks the committed sidecar of every p7 fixture
 * (`<QUEST>.suggestions.json`) against the `--inject` spec that planted the capture: the suggested
 * `m_goalLogic` chain equals the planted goal order (goals named through the capture's GoalID join, never
 * by array position), a single-goal capture yields no chain, a chain with a goal the reader excluded is
 * reported instead of bridged, and the reward suggestions list every planted loot entry with its type as
 * a rolled observation. Every suggested value is one the shared zod schemas and the save rules accept once
 * applied. Criterion 3 runs the real routes: the extraction route returns the sidecar beside the quests,
 * and a save through `POST /api/quests` writes none of the suggested values until the test accepts them.
 * The local-only arm regenerates the sidecars with the real binary and byte-compares them, and proves the
 * D45 stdout is byte-identical with the flag.
 */

const ROOT = resolveRepoRoot();
const CLI = path.join(ROOT, 'tools', 'bin', 'imview-packet-reader');
const REWARDS_PATH = 'm_endResults.m_results';

interface LootSpec {
  $blob: 'LootInfoList';
  gold?: number;
  magicXp?: number;
  items?: { id: number; count: number }[];
  spells?: number[];
}
type Json = Record<string, unknown>;

const readCapture = (quest: string): Envelope[] =>
  JSON.parse(
    fs.readFileSync(path.join(P7_DIR, `${quest}.json`), 'utf8'),
    exactIds as Parameters<typeof JSON.parse>[1],
  ) as Envelope[];

const extractOf = (quest: string): Json =>
  readJson<Json[]>(path.join(P7_DIR, `${quest}.extract.json`))[0]!;
const sidecarOf = (quest: string): { suggestions: CaptureSuggestion[] } =>
  readJson(path.join(P7_DIR, `${quest}.suggestions.json`));
const sidecarReportsOf = (quest: string): string[] => {
  const file = path.join(P7_DIR, `${quest}.suggestions.reports.jsonl`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
};
const f = (e: Envelope, name: string): unknown => e.data.fields[name]?.value;

// QuestBuilder.GetGoalFromType's list (QuestBuilder.cs:484-494); any other GoalType is excluded (task 7.4).
const LISTED_GOAL_TYPES = new Set([1, 2, 3, 4, 5, 7, 8]);

/**
 * The planted goal order, as extracted goal names: the spec's goals in the order of their first
 * `MSG_SENDGOAL` step, each named through its GoalID (the in-order step envelope) -> GoalNameID -> the
 * extracted goal with that `m_goalNameID` (a later GoalID sharing a GoalNameID takes the next such goal,
 * the ACHIEVERANK recovery). A goal the reader excluded has no name (`undefined`).
 */
function plantedOrder(quest: string): (string | undefined)[] {
  const capture = readCapture(quest);
  const goals = (extractOf(quest).m_goals ?? []) as Json[];
  const taken = new Set<Json>();
  const nameById = new Map<unknown, string | undefined>();
  let at = 0;
  const order: (string | undefined)[] = [];
  const firstSent = new Set<number>();
  for (const step of specOf(quest).sequence) {
    while (capture[at] && capture[at]!.data.name !== step.message) {
      at += 1;
    }
    const envelope = capture[at]!;
    at += 1;
    if (step.message !== 'MSG_SENDGOAL' || firstSent.has(step.goal!)) {
      continue;
    }
    firstSent.add(step.goal!);
    const goalId = f(envelope, 'GoalID');
    if (!nameById.has(goalId)) {
      const goal = LISTED_GOAL_TYPES.has(Number(f(envelope, 'GoalType')))
        ? goals.find((g) => g.m_goalNameID === f(envelope, 'GoalNameID') && !taken.has(g))
        : undefined;
      if (goal) {
        taken.add(goal);
      }
      nameById.set(goalId, goal?.m_goalName as string | undefined);
    }
    order.push(nameById.get(goalId));
  }
  return order;
}

/** The corpus's two goal-logic shapes (D61): "A done -> add B" and "Z done -> complete the quest". */
const entry = (and: string, toAdd: string[], completeQuest: boolean): Json => ({
  m_goalsAND: [and],
  m_goalsOR: [],
  m_goalsToAdd: toAdd,
  m_completeQuest: completeQuest,
  m_requiredORCount: 1,
});

/** Every planted loot entry, as the labelled observation the sidecar must carry, with its sources. */
function plantedLoot(spec: InjectSpec): Map<string, { value: Json; sources: Set<string> }> {
  const planted = new Map<string, { value: Json; sources: Set<string> }>();
  const add = (value: Json, source: string): void => {
    const key = JSON.stringify(value);
    const known = planted.get(key) ?? { value, sources: new Set<string>() };
    known.sources.add(source);
    planted.set(key, known);
  };
  const plant = (loot: unknown, source: string): void => {
    if (typeof loot !== 'object' || loot === null || (loot as LootSpec).$blob !== 'LootInfoList') {
      return;
    }
    const { gold, magicXp, items = [], spells = [] } = loot as LootSpec;
    if (gold !== undefined && gold !== 0) {
      add({ kind: 'gold', amount: gold, result: null }, source);
    }
    if (magicXp !== undefined) {
      add({ kind: 'xp', amount: magicXp, result: null }, source);
    }
    for (const item of items) {
      add({ kind: 'item', itemId: item.id, count: item.count, result: null }, source);
    }
    for (const spell of spells) {
      add(
        {
          kind: 'spell',
          spellId: spell,
          result: { $type: TYPE_STRINGS.ResLearnSpell, m_templateID: spell },
        },
        source,
      );
    }
  };
  plant(spec.questOfferFields?.Rewards, 'MSG_QUESTOFFER.Rewards');
  plant(spec.sendQuestFields.Rewards, 'MSG_SENDQUEST.Rewards');
  for (const step of spec.sequence) {
    if (step.message === 'MSG_QUESTREWARDS' || step.message === 'MSG_LOOT') {
      plant(step.fields?.LootList, `${step.message}.LootList`);
    }
  }
  return planted;
}

const LABEL: Record<string, string> = { gold: 'gold', xp: 'XP', item: 'item', spell: 'spell' };

describe('p7 suggestion sidecars against their --inject specs (CI-bound)', () => {
  it('commits a sidecar for every p7 fixture, shaped {"suggestions":[{questName,path,value,source,confidence,note}]}', () => {
    expect(quests.length).toBeGreaterThanOrEqual(9);
    for (const quest of quests) {
      const sidecar = sidecarOf(quest);
      expect(Object.keys(sidecar), quest).toEqual(['suggestions']);
      for (const s of sidecar.suggestions) {
        expect(Object.keys(s)).toEqual([
          'questName',
          'path',
          'value',
          'source',
          'confidence',
          'note',
        ]);
        expect(s.questName).toBe(quest);
        expect(['capture-order', 'capture-rewards']).toContain(s.source);
        expect(s.confidence).toBeGreaterThanOrEqual(0);
        expect(s.confidence).toBeLessThanOrEqual(1);
        expect(s.note).not.toBe('');
        // The path is the document-path notation the editor and the save's field map use.
        expect(parseDocPath(s.path), s.path).not.toBeNull();
      }
    }
  });

  it('covers an ordered chain, a single-goal capture, an excluded goal and every reward packet', () => {
    const orders = quests.map(plantedOrder);
    expect(orders.some((o) => o.length === 1)).toBe(true);
    expect(orders.some((o) => o.length >= 3 && o.every(Boolean))).toBe(true);
    expect(orders.some((o) => o.some((name) => name === undefined))).toBe(true);
    const sources = new Set(
      quests.flatMap((q) => [...plantedLoot(specOf(q)).values()]).flatMap((l) => [...l.sources]),
    );
    for (const source of [
      'MSG_QUESTOFFER.Rewards',
      'MSG_SENDQUEST.Rewards',
      'MSG_QUESTREWARDS.LootList',
      'MSG_LOOT.LootList',
    ]) {
      expect(sources.has(source), source).toBe(true);
    }
    const kinds = new Set(
      quests.flatMap((q) => [...plantedLoot(specOf(q)).values()].map((l) => l.value.kind)),
    );
    expect([...kinds].sort()).toEqual(['gold', 'item', 'spell', 'xp']);
  });

  describe.each(quests)('%s', (quest) => {
    const suggestions = (): CaptureSuggestion[] => sidecarOf(quest).suggestions;
    const at = (p: string): CaptureSuggestion[] => suggestions().filter((s) => s.path === p);

    it('suggests the goal-logic chain in the planted order (single goal: none; excluded goal: reported)', () => {
      const order = plantedOrder(quest);
      const chain = at('m_goalLogic');
      if (order.some((name) => name === undefined)) {
        expect(chain).toEqual([]);
        expect(sidecarReportsOf(quest).map((l) => JSON.parse(l) as Json)).toContainEqual(
          expect.objectContaining({ report: 'suggestion', quest, path: 'm_goalLogic' }),
        );
        return;
      }
      if (order.length === 1) {
        expect(chain).toEqual([]);
        return;
      }
      const names = order as string[];
      const expected = [
        ...names.slice(0, -1).map((name, i) => entry(name, [names[i + 1]!], false)),
        entry(names.at(-1)!, [], true),
      ];
      expect(chain).toHaveLength(1);
      expect(chain[0]!.value).toEqual(expected);
      expect(chain[0]!.source).toBe('capture-order');
      expect(chain[0]!.confidence).toBe(0.8);
      names.slice(1).forEach((name, i) => {
        expect(chain[0]!.note).toContain(
          `MSG_COMPLETEGOAL ${names[i]}, then MSG_REMOVEGOAL ${names[i]}, then MSG_SENDGOAL ${name}`,
        );
      });
      expect(chain[0]!.note).toContain(`MSG_COMPLETEGOAL ${names.at(-1)}, then MSG_COMPLETEQUEST`);
    });

    it('suggests m_startGoals only where the extraction has none', () => {
      const extracted = (extractOf(quest).m_startGoals ?? []) as string[];
      const start = at('m_startGoals');
      if (extracted.length > 0) {
        expect(start).toEqual([]);
        return;
      }
      expect(start.map((s) => s.value)).toEqual([[plantedOrder(quest)[0]]]);
    });

    it('lists every planted loot entry with its type, as a rolled observation, never a drop-table name', () => {
      const planted = plantedLoot(specOf(quest));
      const rewards = at(REWARDS_PATH);
      expect(rewards.map((s) => s.value)).toEqual(
        expect.arrayContaining([...planted.values()].map((l) => l.value)),
      );
      expect(rewards).toHaveLength(planted.size);
      for (const s of rewards) {
        const value = s.value as Json;
        const { sources } = planted.get(JSON.stringify(value))!;
        expect(s.source).toBe('capture-rewards');
        expect(s.note).toMatch(new RegExp(`^rolled observation \\(${LABEL[String(value.kind)]} `));
        expect(s.note).toContain('not a drop-table name');
        expect(s.note).toContain(`from ${[...sources].join(', ')};`);
        expect(s.confidence).toBe(value.kind === 'spell' ? 0.6 : 0.3);
        // A drop-table name would be a ResDropTable result: never suggested.
        expect(JSON.stringify(value)).not.toContain('ResDropTable');
      }
    });

    it('proposes values the shared schemas and the save rules accept once applied', () => {
      let doc: unknown = extractOf(quest);
      for (const s of suggestions()) {
        if (s.path === REWARDS_PATH) {
          const result = (s.value as { result: ResultTemplate | null }).result;
          if (result === null) {
            continue;
          }
          expect(ResultTemplateSchema.safeParse(result).success).toBe(true);
          const list = ((doc as Json).m_endResults as { m_results?: unknown[] } | undefined)
            ?.m_results;
          doc = setAtPath(doc, ['m_endResults'], { m_results: [...(list ?? []), result] });
          continue;
        }
        doc = setAtPath(doc, parseDocPath(s.path)!, s.value);
      }
      expect(QuestTemplateSchema.safeParse(doc).success).toBe(true);
      expect(validateQuest(doc).blocked).toBe(false);
      if (at('m_goalLogic').length > 0) {
        const reach = goalLogicReachability(doc);
        expect(reach.unreachable).toEqual([]);
        expect(reach.completeReachable).toBe(true);
      }
    });

    it('never merges a suggested value into the extracted template (D127)', () => {
      const extracted = extractOf(quest);
      expect(extracted.m_goalLogic ?? null).toBeNull();
      const text = JSON.stringify(extracted);
      for (const s of at(REWARDS_PATH)) {
        const result = (s.value as { result: unknown }).result;
        if (result !== null) {
          expect(text).not.toContain(JSON.stringify(result));
        }
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// Criterion 3: the saved template holds none of the suggested values until they are accepted.
// ---------------------------------------------------------------------------------------------------

const REPOS: TempRepo[] = [];
const DBS: Db[] = [];
const DIRS: string[] = [];

afterEach(() => {
  while (REPOS.length > 0) {
    removeTempGitRepo(REPOS.pop()!);
  }
  while (DIRS.length > 0) {
    fs.rmSync(DIRS.pop()!, { recursive: true, force: true });
  }
});

afterAll(() => {
  for (const db of DBS) {
    db.close();
  }
});

/** The real composition: the extraction and quests routers over a throwaway repo and an in-memory DB. */
function harness(service: ReturnType<typeof createExtractionService>): {
  app: Express;
  repo: TempRepo;
} {
  const repo = createTempGitRepo('p7-suggestions-');
  REPOS.push(repo);
  const db = openDb({ file: MEMORY_DB });
  DBS.push(db);
  writeSettings(db, { spiraldb_path: repo.dir, user_name: 'P7-06 Tester', git_branch: '' });
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7-suggestions-upload-'));
  DIRS.push(uploadDir);

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/extract', createExtractRouter({ service, uploadDir }));
  app.use('/api/quests', createQuestsRouter({ db }));
  return { app, repo };
}

/** A service whose CLI is the committed goldens: stdout is `.extract.json`, the sidecar `.suggestions.json`. */
function goldenService(quest: string): ReturnType<typeof createExtractionService> {
  return createExtractionService({
    cliPath: '/golden/imview-packet-reader',
    env: { PATH: '/nonexistent' },
    fileExists: () => true,
    exec: (_file, args, _options, onChild) => {
      onChild?.({ pid: 1, kill: () => true });
      const sidecar = args[args.indexOf('--suggestions') + 1]!;
      fs.copyFileSync(path.join(P7_DIR, `${quest}.suggestions.json`), sidecar);
      return Promise.resolve({
        stdout: fs.readFileSync(path.join(P7_DIR, `${quest}.extract.json`), 'utf8'),
        stderr: '',
      });
    },
  });
}

const QUEST = 'WC-HAUNTED-MAIN-001';
const questFile = (quest: string): string => `QuestTemplates/questtemplates_${quest}.json`;

async function extractAndSave(
  app: Express,
  repo: TempRepo,
  accept: boolean,
): Promise<{ suggestions: CaptureSuggestion[]; saved: Json; savedText: string }> {
  const extracted = await request(app)
    .post('/api/extract/quests')
    .attach('file', path.join(P7_DIR, `${QUEST}.json`))
    .expect(200);
  const body = extracted.body as { quests: Json[]; suggestions: CaptureSuggestion[] };
  let quest: unknown = body.quests[0];
  if (accept) {
    // What the editor's Accept does (task 7.7): apply the value at its path in the in-memory document.
    for (const s of body.suggestions) {
      const result = s.path === REWARDS_PATH ? (s.value as { result: unknown }).result : s.value;
      if (s.path === REWARDS_PATH) {
        if (result !== null) {
          const list = ((quest as Json).m_endResults as { m_results?: unknown[] } | undefined)
            ?.m_results;
          quest = setAtPath(quest, ['m_endResults'], { m_results: [...(list ?? []), result] });
        }
        continue;
      }
      quest = setAtPath(quest, parseDocPath(s.path)!, s.value);
    }
  }
  await request(app).post('/api/quests').send({ quest }).expect(200);
  const savedText = readRepoFile(repo, questFile(QUEST));
  return { suggestions: body.suggestions, saved: JSON.parse(savedText) as Json, savedText };
}

describe('criterion 3: a saved template holds no suggested value until it is accepted', () => {
  it('extracts with suggestions, saves through POST /api/quests, and the file carries none of them', async () => {
    const { app, repo } = harness(goldenService(QUEST));
    const { suggestions, saved, savedText } = await extractAndSave(app, repo, false);

    // The route handed the sidecar back verbatim, beside the quests.
    expect(suggestions).toEqual(sidecarOf(QUEST).suggestions);
    const chain = suggestions.find((s) => s.path === 'm_goalLogic')!;
    const spell = suggestions.find((s) => (s.value as Json).kind === 'spell')!;
    expect(chain).toBeDefined();
    expect(spell).toBeDefined();

    // The saved file is the extraction as extracted: no goal logic, no end results, no planted reward.
    expect(saved).not.toHaveProperty('m_goalLogic');
    expect(saved).not.toHaveProperty('m_endResults');
    expect(saved).toEqual(extractOf(QUEST));
    for (const s of suggestions) {
      const value = s.path === REWARDS_PATH ? (s.value as Json).result : s.value;
      if (value !== null) {
        expect(savedText, s.path).not.toContain(JSON.stringify(value));
      }
    }
    for (const planted of ['7700611', '7700612', '7700621', '1006', '1016', '506', '516']) {
      expect(savedText).not.toContain(planted);
    }
  });

  it('accepting them is what writes them (the control: the same save with the values applied)', async () => {
    const { app, repo } = harness(goldenService(QUEST));
    const { suggestions, saved } = await extractAndSave(app, repo, true);

    const chain = suggestions.find((s) => s.path === 'm_goalLogic')!;
    expect(saved.m_goalLogic).toEqual(chain.value);
    expect(saved.m_endResults).toEqual({
      m_results: [{ $type: TYPE_STRINGS.ResLearnSpell, m_templateID: 7700621 }],
    });
  });
});

// A binary that is not built is a visible skip (D55 posture), as in p7-observed-fields.test.ts.
describe.skipIf(!fs.existsSync(CLI))(
  'p7 suggestion sidecars regenerate byte-identically, stdout unchanged (local-only)',
  () => {
    it.each(quests)('%s', (quest) => {
      const scratch = fs.mkdtempSync(
        path.join(fs.realpathSync(process.env.TMPDIR ?? os.tmpdir()), 'p7-suggestions-'),
      );
      try {
        const sidecar = path.join(scratch, 'suggestions.json');
        const result = spawnSync(
          CLI,
          ['--input', path.join(P7_DIR, `${quest}.json`), '--suggestions', sidecar],
          { env: buildChildEnv(process.env), encoding: 'utf8' },
        );
        expect(result.status).toBe(0);
        // D45 extended, not changed: stdout with the flag is the committed stdout golden.
        expect(result.stdout).toBe(
          fs.readFileSync(path.join(P7_DIR, `${quest}.extract.json`), 'utf8'),
        );
        expect(fs.readFileSync(sidecar, 'utf8')).toBe(
          fs.readFileSync(path.join(P7_DIR, `${quest}.suggestions.json`), 'utf8'),
        );
        const reports = result.stderr.split('\n').filter((l) => l.startsWith('{"report":'));
        expect(reports.filter((l) => l.startsWith('{"report":"suggestion"'))).toEqual(
          sidecarReportsOf(quest),
        );
        expect(reports.filter((l) => !l.startsWith('{"report":"suggestion"'))).toEqual(
          fs
            .readFileSync(path.join(P7_DIR, `${quest}.extract.reports.jsonl`), 'utf8')
            .split('\n')
            .filter(Boolean),
        );
      } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
      }
    });

    it('returns the real sidecar from the extraction route, unmerged', async () => {
      const { app } = harness(createExtractionService({ cliPath: CLI }));
      const res = await request(app)
        .post('/api/extract/quests')
        .attach('file', path.join(P7_DIR, `${QUEST}.json`))
        .expect(200);
      const body = res.body as { quests: Json[]; suggestions: CaptureSuggestion[] };
      expect(body.suggestions).toEqual(sidecarOf(QUEST).suggestions);
      expect(body.quests).toEqual([extractOf(QUEST)]);
    });
  },
);
