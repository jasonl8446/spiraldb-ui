import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveRepoRoot } from '@server/db';
import { buildChildEnv } from '@server/services/extraction';

import {
  P7_DIR,
  p7Quests as quests,
  readJson,
  specOf,
  type Envelope,
  type InjectSpec,
} from '../helpers/p7-fixtures';

/**
 * Phase 7 task 7.2 (p7-03, D128/D139) — the planted-value fixtures and their census goldens.
 *
 * CI has no .NET SDK (D55), so nothing here can regenerate a golden in CI. The CI-bound arm therefore
 * checks each committed census golden against the `--inject` spec that produced its fixture: every
 * planted (message, field) pair must be in the golden with exactly the planted count. The local-only
 * arms run only where `tools/bin/capture-census` / `tools/bin/fixturegen` and the D17 clone exist,
 * regenerate, and byte-compare against the committed files; without them they show as skipped.
 */

const ROOT = resolveRepoRoot();
const CENSUS_BIN = path.join(ROOT, 'tools', 'bin', 'capture-census');
const FIXTUREGEN_BIN = path.join(ROOT, 'tools', 'bin', 'fixturegen');
const CORPUS_DIR = path.join(ROOT, 'data', 'test-spiraldb', 'QuestTemplates');

// GOAL_TYPE values (Imcodec's generated enum) of the five goal classes the set must cover.
const GOAL_CLASSES: Record<string, number> = {
  Persona: 4,
  Waypoint: 5,
  'Bounty (or BountyCollect)': 1,
  Scavenge: 3,
  AchieveRank: 7,
};

interface CensusRow {
  message: string;
  field: string;
  count: number;
  consumed: boolean;
}
interface Census {
  input: string;
  messages: number;
  rows: CensusRow[];
}

const goldenOf = (quest: string): Census => readJson(path.join(P7_DIR, `${quest}.census.json`));
const captureOf = (quest: string): Envelope[] => readJson(path.join(P7_DIR, `${quest}.json`));

/** The (message, field) -> count the spec plants: one MSG_SENDQUEST extra each, plus every step field. */
function planted(spec: InjectSpec): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (message: string, field: string): void => {
    const key = `${message}\t${field}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (const field of Object.keys(spec.sendQuestFields)) {
    add('MSG_SENDQUEST', field);
  }
  for (const field of Object.keys(spec.questOfferFields ?? {})) {
    add('MSG_QUESTOFFER', field);
  }
  for (const step of spec.sequence) {
    for (const field of Object.keys(step.fields ?? {})) {
      add(step.message, field);
    }
  }
  return counts;
}

/**
 * The count the golden must show for each planted (message, field): the planted count plus the envelopes
 * the engine emitted on its own that carry the same field — every MSG_SENDGOAL carries GoalType, and the
 * corpus dialogs are MSG_ACTORDIALOGs too (task 7.4 plants both). Step envelopes are found as the in-order
 * subsequence of the capture, and each must carry every planted plain value exactly.
 */
function expectedCounts(quest: string, spec: InjectSpec, capture: Envelope[]): Map<string, number> {
  const counts = planted(spec);
  const plantedOn = new Map<Envelope, Set<string>>();
  const sendQuest = capture.find((e) => e.data.name === 'MSG_SENDQUEST');
  if (sendQuest) {
    plantedOn.set(sendQuest, new Set(Object.keys(spec.sendQuestFields)));
  }
  const offer = capture.find((e) => e.data.name === 'MSG_QUESTOFFER');
  if (offer) {
    plantedOn.set(offer, new Set(Object.keys(spec.questOfferFields ?? {})));
  }
  let at = 0;
  for (const step of spec.sequence) {
    while (capture[at] && capture[at]!.data.name !== step.message) {
      at += 1;
    }
    const envelope = capture[at];
    expect(envelope, `${quest}: step ${step.message} not in the capture`).toBeDefined();
    for (const [field, value] of Object.entries(step.fields ?? {})) {
      if (typeof value !== 'object') {
        expect(envelope!.data.fields[field]?.value, `${quest}: ${step.message}.${field}`).toBe(
          value,
        );
      }
    }
    plantedOn.set(envelope!, new Set(Object.keys(step.fields ?? {})));
    at += 1;
  }
  for (const key of counts.keys()) {
    const [message, field] = key.split('\t') as [string, string];
    const unplanted = capture.filter(
      (e) => e.data.name === message && field in e.data.fields && !plantedOn.get(e)?.has(field),
    ).length;
    counts.set(key, counts.get(key)! + unplanted);
  }
  return counts;
}

describe('p7 census goldens against their --inject specs (CI-bound)', () => {
  it('commits at least 5 injected quests, each with a fixture, a spec and a golden', () => {
    expect(quests.length).toBeGreaterThanOrEqual(5);
    for (const quest of quests) {
      for (const suffix of ['.json', '.inject.json', '.census.json']) {
        expect(fs.existsSync(path.join(P7_DIR, `${quest}${suffix}`)), `${quest}${suffix}`).toBe(
          true,
        );
      }
    }
  });

  it('covers every goal class, and at least one single-goal quest', () => {
    const covered = new Set<number>();
    let singleGoal = 0;
    for (const quest of quests) {
      const goalTypes = new Map<number, number>();
      for (const e of captureOf(quest)) {
        if (e.data.name === 'MSG_SENDGOAL') {
          goalTypes.set(Number(e.data.fields.GoalID?.value), Number(e.data.fields.GoalType?.value));
        }
      }
      for (const type of goalTypes.values()) {
        covered.add(type);
      }
      if (goalTypes.size === 1) {
        singleGoal += 1;
      }
    }
    for (const [name, type] of Object.entries(GOAL_CLASSES)) {
      expect(covered.has(type), `goal class ${name}`).toBe(true);
    }
    expect(singleGoal).toBeGreaterThanOrEqual(1);
  });

  it('plants every message type and field the task names across the set', () => {
    const all = new Set<string>();
    for (const quest of quests) {
      for (const key of planted(specOf(quest)).keys()) {
        all.add(key);
      }
    }
    const wanted = [
      ...[
        'QuestNameID',
        'QuestInfo',
        'NoQuestHelper',
        'SkipQHAutoSelect',
        'ActivityType',
        'ClientTags',
        'PetOnlyQuest',
        'Rewards',
      ].map((f) => `MSG_SENDQUEST\t${f}`),
      'MSG_SENDGOAL\tPersonaName',
      'MSG_COMPLETEGOAL\tCompleteText',
      'MSG_COMPLETEQUEST\tCompleteText',
      'MSG_PERSONAINFO\tGoalHyperlink',
      // Task 7.4: an unlisted goal type and the planted dialogs.
      'MSG_SENDGOAL\tGoalType',
      ...['CompletionType', 'ActorDialog', 'IsYesNo', 'DefaultDialogAnimation'].map(
        (f) => `MSG_ACTORDIALOG\t${f}`,
      ),
      ...['CompletionType', 'ActorDialog'].map((f) => `MSG_ENCOUNTERDIALOG\t${f}`),
      // Task 7.5: the reward packets.
      'MSG_QUESTOFFER\tRewards',
      'MSG_QUESTREWARDS\tLootList',
      'MSG_LOOT\tLootList',
    ];
    for (const key of wanted) {
      expect(all.has(key), key.replace('\t', '.')).toBe(true);
    }
    // MSG_REMOVEGOAL carries only ids: it is planted by the sequence, so check it is in there.
    expect(quests.some((q) => specOf(q).sequence.some((s) => s.message === 'MSG_REMOVEGOAL'))).toBe(
      true,
    );
  });

  describe.each(quests)('%s', (quest) => {
    it('lists every planted field with exactly the planted count', () => {
      const golden = goldenOf(quest);
      const counts = new Map(golden.rows.map((r) => [`${r.message}\t${r.field}`, r.count]));
      const expected = expectedCounts(quest, specOf(quest), captureOf(quest));
      expect(expected.size).toBeGreaterThan(0);
      for (const [key, count] of expected) {
        expect(counts.get(key), key.replace('\t', '.')).toBe(count);
      }
    });

    it('carries the spec sequence in the capture, in order', () => {
      const spec = specOf(quest);
      const names = captureOf(quest).map((e) => e.data.name);
      // The sequence appears in the capture as a subsequence, in order.
      const injected = spec.sequence.map((s) => s.message);
      let at = 0;
      for (const name of names) {
        if (at < injected.length && name === injected[at]) {
          at += 1;
        }
      }
      expect(at).toBe(injected.length);
      expect(goldenOf(quest).messages).toBe(names.length);
    });

    it('is sorted by message then field, with a name-only input (byte-stable, D139)', () => {
      const { input, rows } = goldenOf(quest);
      expect(input).toBe(`${quest}.json`);
      const keys = rows.map((r) => `${r.message}\u0000${r.field}`);
      expect(keys).toEqual([...keys].sort());
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('reports the planted fields the reader does not read as ignored', () => {
      const rows = goldenOf(quest).rows;
      const plantedHere = planted(specOf(quest));
      const row = (message: string, field: string): CensusRow | undefined =>
        rows.find((r) => r.message === message && r.field === field);
      // Read by the task 7.5 suggestions pass (flipped in p7-06, goldens regenerated).
      for (const [message, field] of [
        ['MSG_SENDQUEST', 'Rewards'],
        ['MSG_QUESTOFFER', 'Rewards'],
        ['MSG_QUESTREWARDS', 'LootList'],
        ['MSG_LOOT', 'LootList'],
      ] as const) {
        if (plantedHere.has(`${message}\t${field}`)) {
          expect(row(message, field)?.consumed, `${message}.${field}`).toBe(true);
        }
      }
      if (specOf(quest).sequence.some((s) => s.message === 'MSG_REMOVEGOAL')) {
        expect(row('MSG_REMOVEGOAL', 'GoalID')?.consumed).toBe(true);
      }
      // Read by the 7.3 observed-field post-pass (flipped in p7-04) and the 7.4 reader repairs (flipped
      // in p7-05), goldens regenerated; each spec is checked on the fields it plants.
      for (const [message, field] of [
        ['MSG_SENDGOAL', 'PersonaName'],
        ['MSG_SENDQUEST', 'QuestNameID'],
        ['MSG_SENDQUEST', 'QuestInfo'],
        ['MSG_SENDQUEST', 'NoQuestHelper'],
        ['MSG_SENDQUEST', 'SkipQHAutoSelect'],
        ['MSG_SENDQUEST', 'ActivityType'],
        ['MSG_SENDQUEST', 'ClientTags'],
        ['MSG_SENDQUEST', 'PetOnlyQuest'],
        ['MSG_COMPLETEGOAL', 'CompleteText'],
        ['MSG_COMPLETEQUEST', 'CompleteText'],
        ['MSG_SENDGOAL', 'GoalType'],
        ['MSG_ACTORDIALOG', 'CompletionType'],
        ['MSG_ACTORDIALOG', 'ActorDialog'],
        ['MSG_ACTORDIALOG', 'IsYesNo'],
        ['MSG_ACTORDIALOG', 'DefaultDialogAnimation'],
        ['MSG_ENCOUNTERDIALOG', 'CompletionType'],
        ['MSG_ENCOUNTERDIALOG', 'ActorDialog'],
      ] as const) {
        if (plantedHere.has(`${message}\t${field}`)) {
          expect(row(message, field)?.consumed, `${message}.${field}`).toBe(true);
        }
      }
      // …while the fields the reader does read stay consumed.
      expect(row('MSG_SENDQUEST', 'QuestID')?.consumed).toBe(true);
      expect(row('MSG_SENDGOAL', 'GoalNameID')?.consumed).toBe(true);
    });
  });
});

// The same two arms as verify:captures: a binary that is not built is a visible skip (D55 posture).
describe.skipIf(!fs.existsSync(CENSUS_BIN))(
  'p7 census goldens regenerate byte-identically (local-only)',
  () => {
    it.each(quests)('%s', (quest) => {
      const out = execFileSync(CENSUS_BIN, ['--input', path.join(P7_DIR, `${quest}.json`)], {
        env: buildChildEnv(process.env),
        encoding: 'utf8',
      });
      expect(out).toBe(fs.readFileSync(path.join(P7_DIR, `${quest}.census.json`), 'utf8'));
    });
  },
);

describe.skipIf(!fs.existsSync(FIXTUREGEN_BIN) || !fs.existsSync(CORPUS_DIR))(
  'p7 fixtures regenerate byte-identically from the D17 clone (local-only)',
  () => {
    it.each(quests)('%s', (quest) => {
      const scratch = fs.mkdtempSync(
        path.join(fs.realpathSync(process.env.TMPDIR ?? '/tmp'), 'p7-fixture-'),
      );
      try {
        const out = path.join(scratch, `${quest}.json`);
        execFileSync(
          FIXTUREGEN_BIN,
          [
            '--quest',
            path.join(CORPUS_DIR, `questtemplates_${quest}.json`),
            '--inject',
            path.join(P7_DIR, `${quest}.inject.json`),
            '--output',
            out,
          ],
          { env: buildChildEnv(process.env), stdio: 'pipe' },
        );
        expect(fs.readFileSync(out, 'utf8')).toBe(
          fs.readFileSync(path.join(P7_DIR, `${quest}.json`), 'utf8'),
        );
      } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
      }
    });
  },
);
