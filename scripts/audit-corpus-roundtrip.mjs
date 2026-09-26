#!/usr/bin/env node
// Corpus-wide round-trip fidelity audit (docs/plan-phase-2-quest-extraction.md task 2.1a, D28).
//
// verify-captures.mjs proves the 5 committed fixtures. This proves the *whole* corpus: for every real
// quest file in QuestTemplates/ it runs
//
//     corpus quest -> tools/bin/fixturegen -> tools/bin/imview-packet-reader -> quest'
//
// and compares quest' against the source on the same field list (name, title, level, mainline, goal
// count, goal names in order, goal types, dialog block count, dialog entry count, per-container dialog
// entry map). FixtureGen encodes with the game's own Imcodec serializer and the reader is Imview's
// QuestBuilder, so a pass over the real corpus is the strongest fidelity evidence available without a
// recorded live capture; a mismatch is a concrete extraction defect with a named quest and field.
//
// It reports a per-field histogram as well as per-quest detail, so a systematic defect is visible even
// when it only bites a minority of quests. Usage:
// Exit 0 means "every quest the generator could represent round-tripped identically"; refusals are
// reported as coverage, not counted as failures unless --strict. Usage:
//   npm run audit:corpus [-- --limit 50] [--corpus <QuestTemplates dir>] [--quiet] [--strict]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import JSON5 from 'json5';

import {
  compareSnapshots,
  corpusSnapshot,
  dotnetEnv,
  readerSnapshot,
} from './lib/quest-roundtrip.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const READER = path.join(ROOT, 'tools/bin/imview-packet-reader');
const GENERATOR = path.join(ROOT, 'tools/bin/fixturegen');
const DEFAULT_CORPUS = path.join(ROOT, 'data/test-spiraldb/QuestTemplates');

// Reader limitations that no capture can work around; a mismatch there is reported, not counted as a
// failure. Empty today (see verify-captures.mjs for the `level` defect D46 repaired).
const KNOWN_READER_DEFECTS = {};

function parseArgs(argv) {
  const options = {
    corpus: process.env.SPIRALDB_QUEST_DIR ?? DEFAULT_CORPUS,
    limit: Infinity,
    quiet: false,
    strict: false,
  };

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--corpus') {
      options.corpus = path.resolve(argv[++i] ?? '');
    } else if (argv[i] === '--limit') {
      options.limit = Number.parseInt(argv[++i] ?? '', 10);
    } else if (argv[i] === '--quiet') {
      options.quiet = true;
    } else if (argv[i] === '--strict') {
      options.strict = true;
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }

  return options;
}

const options = parseArgs(process.argv.slice(2));

for (const [label, file] of [
  ['reader', READER],
  ['generator', GENERATOR],
]) {
  if (!fs.existsSync(file)) {
    console.error(
      `error: ${label} at ${file} is missing — run "npm run build:cli" and "npm run build:fixturegen" first.`,
    );
    process.exit(1);
  }
}

if (!fs.existsSync(options.corpus)) {
  console.error(
    `error: corpus not found at ${options.corpus}. Run "npm run test:reset-clone" first, or pass ` +
      '--corpus <QuestTemplates dir>.',
  );
  process.exit(1);
}

const childEnv = dotnetEnv();

const questFiles = fs
  .readdirSync(options.corpus)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .slice(0, options.limit);

if (questFiles.length === 0) {
  console.error(`error: no quest files under ${options.corpus}`);
  process.exit(1);
}

// FixtureGen refuses a quest it cannot represent faithfully rather than emitting a lossy capture
// (tools/FixtureGen). Those refusals are a *coverage* limit of the synthetic harness, measured in
// p2-03's corpus sweep as generated=181 / refused=141 — they are reported with their reasons and do
// NOT count as fidelity failures. Only a recorded live capture can cover them.
const REFUSAL_KEYS = [
  ['cannot attach a dialog to a compilation goal', 'goal-level dialog on a compilation goal'],
  [
    'cannot round-trip on goal names',
    'm_goalName != "{n}_{m_goalTitle}" (ACHIEVERANK/empty title)',
  ],
  ['has m_goalNameID 0', 'goal carries m_goalNameID 0'],
  ['appears on more than one goal', 'm_goalNameID appears on more than one goal'],
  ['is not supported by QuestBuilder.GetGoalFromType', 'goal type unsupported by GetGoalFromType'],
  ['the compilation-prefix assumption does not hold', 'm_startGoals is not a prefix of m_goals'],
  [
    'is not representable: QuestBuilder only attaches',
    'quest-level dialog tag not Prep/Completion',
  ],
  ['QuestBuilder replaces instead of adding', 'two quest-level dialogs share a tag'],
  [
    "carries a dialog tagged 'QuestInfo'",
    'goal dialog tagged QuestInfo also matches quest-level prep',
  ],
  ['quest has no goals', 'quest has no goals'],
  ['quest has an empty m_questName', 'quest has an empty m_questName'],
];

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-corpus-'));
const fieldHistogram = new Map();
const refusalHistogram = new Map();
const failures = [];
const refusals = [];
let checks = 0;
let defectRows = 0;
let mismatchedFields = 0;
let verified = 0;

const started = Date.now();

questFiles.forEach((file, index) => {
  const questPath = path.join(options.corpus, file);
  const label = path.basename(file, '.json').replace(/^questtemplates_/, '');

  const record = (fields, detail) => {
    for (const field of fields) {
      fieldHistogram.set(field, (fieldHistogram.get(field) ?? 0) + 1);
    }
    failures.push({ label, file, fields, detail });
  };

  let quest;

  try {
    quest = JSON5.parse(fs.readFileSync(questPath, 'utf8'));
  } catch (error) {
    record(['<corpus JSON5 parse>'], error.message);
    return;
  }

  const capturePath = path.join(workDir, `${index}-capture.json`);
  const outPath = path.join(workDir, `${index}-quests.json`);

  try {
    execFileSync(GENERATOR, ['--quest', questPath, '--output', capturePath], {
      env: childEnv,
      stdio: 'pipe',
    });
  } catch (error) {
    const message = (error.stderr ?? '').toString().trim();
    const first =
      message
        .split('\n')
        .find((line) => line.trim().startsWith('-'))
        ?.trim() ?? message;
    const match = REFUSAL_KEYS.find(([literal]) => first.includes(literal));

    if (match === undefined) {
      record(['<fixturegen crash>'], `exit ${error.status}: ${first}`);
      return;
    }

    refusalHistogram.set(match[1], (refusalHistogram.get(match[1]) ?? 0) + 1);
    refusals.push({ label, reason: match[1], detail: first });
    return;
  }

  try {
    execFileSync(READER, ['--input', capturePath, '--output', outPath], {
      env: childEnv,
      stdio: 'pipe',
    });
  } catch (error) {
    record(
      ['<imview-packet-reader>'],
      `exit ${error.status}: ${(error.stderr ?? '').toString().trim().split('\n').at(-1) ?? ''}`,
    );
    return;
  }

  let quests;

  try {
    quests = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  } catch (error) {
    record(['<reader stdout>'], `not JSON: ${error.message}`);
    return;
  }

  if (!Array.isArray(quests) || quests.length !== 1) {
    record(
      ['<reader quest count>'],
      `expected exactly 1 quest, got ${Array.isArray(quests) ? quests.length : 'non-array'}`,
    );
    return;
  }

  const result = compareSnapshots(
    corpusSnapshot(quest),
    readerSnapshot(quests[0]),
    KNOWN_READER_DEFECTS,
  );

  checks += result.checks;
  defectRows += result.defectRows;

  const bad = result.compared.filter((r) => !r.same && !r.knownDefect);

  if (bad.length === 0) {
    verified++;
  }

  if (bad.length > 0) {
    mismatchedFields += bad.length;
    record(
      bad.map((r) => r.label),
      bad
        .map((r) => `${r.label}: corpus=${String(r.expected)} read=${String(r.actual)}`)
        .join('; '),
    );
  }

  if (!options.quiet && (index + 1) % 25 === 0) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(0);
    console.log(
      `  … ${index + 1}/${questFiles.length} quests, ${failures.length} failing, ${elapsed}s`,
    );
  }
});

const seconds = ((Date.now() - started) / 1000).toFixed(1);

console.log('');
console.log(`corpus:    ${options.corpus}`);
console.log(`quests:    ${questFiles.length} real corpus quest(s) attempted`);
console.log(
  `verified:  ${verified}/${questFiles.length} round-trip identically through the real reader ` +
    `(${checks} field check(s), ${mismatchedFields} mismatch(es), ${defectRows} known-defect row(s))`,
);
console.log(
  `not covered: ${refusals.length} refused by the generator (a synthetic-harness coverage limit, ` +
    'measured in docs/evidence/phase-2/story-p2-03-diversity.txt — only a recorded live capture can cover these)',
);

for (const [reason, count] of [...refusalHistogram.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)}  ${reason}`);
}

if (failures.length > 0) {
  console.log('');
  console.log('FAILING QUESTS');

  for (const failure of failures) {
    console.log(`  ${failure.label}`);
    console.log(`      ${failure.detail}`);
  }

  console.log('');
  console.log('MISMATCHES BY FIELD');

  for (const [field, count] of [...fieldHistogram.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${field}`);
  }
}

console.log('');
console.log(
  `${failures.length === 0 ? 'PASS' : 'FAIL'}: ${verified}/${questFiles.length} verified, ` +
    `${refusals.length} not covered by the synthetic harness, ${failures.length} failure(s) (${seconds}s).`,
);

if (options.strict && refusals.length > 0) {
  console.log('strict: refusals count as failures (--strict).');
}

fs.rmSync(workDir, { recursive: true, force: true });
process.exit(failures.length === 0 && !(options.strict && refusals.length > 0) ? 0 : 1);
