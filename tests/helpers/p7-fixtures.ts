import fs from 'node:fs';
import path from 'node:path';

import { resolveRepoRoot } from '@server/db';

/**
 * The Phase 7 planted-value fixtures (p7-03, D128): per quest a capture `<QUEST>.json`, the
 * `<QUEST>.inject.json` spec that planted it, and the goldens the census, the observed-field
 * post-pass and the suggestions sidecar produce from it. One home for what the three p7 golden
 * suites share.
 */
export const P7_DIR = path.join(resolveRepoRoot(), 'server', 'test', 'fixtures', 'captures', 'p7');

export interface Step {
  message: string;
  goal?: number;
  fields?: Record<string, unknown>;
}
export interface InjectSpec {
  allowAchieveRank?: boolean;
  sendQuestFields: Record<string, unknown>;
  /** Task 7.5: fields planted on MSG_QUESTOFFER (Rewards). */
  questOfferFields?: Record<string, unknown>;
  sequence: Step[];
}
export interface Envelope {
  data: { name: string; fields: Record<string, { value: unknown }> };
}

/** Every fixture quest that has an `--inject` spec, sorted. */
export const p7Quests: string[] = fs
  .readdirSync(P7_DIR)
  .filter((f) => f.endsWith('.inject.json'))
  .map((f) => f.slice(0, -'.inject.json'.length))
  .sort();

export const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;

export const specOf = (quest: string): InjectSpec =>
  readJson(path.join(P7_DIR, `${quest}.inject.json`));

// QuestID/GoalID are u64 and exceed 2^53: parse the capture losslessly (ids become bigints) so two
// GoalIDs can never collide in a test's own goal join.
type Reviver = (key: string, value: unknown, context: { source?: string }) => unknown;
export const exactIds: Reviver = (_key, value, context) =>
  typeof value === 'number' && !Number.isSafeInteger(value) && context.source !== undefined
    ? BigInt(context.source)
    : value;
