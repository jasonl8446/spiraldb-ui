#!/usr/bin/env node
// Round-trip verifier for the committed capture fixtures (docs/plan-phase-2-quest-extraction.md
// task 2.1a, decision D28; Phase 2 AC#2).
//
// For every capture under server/test/fixtures/captures/ it:
//   1. runs the committed fixture through tools/bin/imview-packet-reader,
//   2. reads the corpus quest the fixture was generated from (JSON5 — the corpus is not strict JSON),
//   3. compares quest name, title, level, mainline, goal count, goal names (in order), goal types,
//      dialog block count, dialog entry count and the per-container dialog entry map,
//   4. regenerates the fixture with tools/bin/fixturegen and asserts it is byte-identical, i.e. the
//      committed artifact really is reproduced by the command recorded in captures/README.md.
//
// Exits non-zero on any mismatch. Usage:
//   npm run verify:captures [-- --corpus <QuestTemplates dir>] [--skip-regenerate]
//
// "dialog entry count" = the number of NPCDialogEntry objects inside m_dialogEntries across every
// ActorDialog of the quest (quest-level plus per-goal dialog lists). "dialog block count" = the
// number of ActorDialog objects. Both are reported, because the two disagree whenever any dialog
// carries more than one entry.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import JSON5 from 'json5';

const ROOT = path.resolve(import.meta.dirname, '..');
const FIXTURE_DIR = path.join(ROOT, 'server/test/fixtures/captures');
const READER = path.join(ROOT, 'tools/bin/imview-packet-reader');
const GENERATOR = path.join(ROOT, 'tools/bin/fixturegen');
const DEFAULT_CORPUS = path.join(ROOT, 'data/test-spiraldb/QuestTemplates');

// Mirrors the generated GOAL_TYPE enum (Imcodec.ObjectProperty TypeCache / GOAL_TYPE.g.cs): the
// CLI serialises m_goalType as a number, the corpus stores the enum name.
const GOAL_TYPES = [
  'GOAL_TYPE_UNKNOWN',
  'GOAL_TYPE_BOUNTY',
  'GOAL_TYPE_BOUNTYCOLLECT',
  'GOAL_TYPE_SCAVENGE',
  'GOAL_TYPE_PERSONA',
  'GOAL_TYPE_WAYPOINT',
  'GOAL_TYPE_SCAVENGEFAKE',
  'GOAL_TYPE_ACHIEVERANK',
  'GOAL_TYPE_USAGE',
  'GOAL_TYPE_COMPLETEQUEST',
  'GOAL_TYPE_SOCIARANK',
  'GOAL_TYPE_SOCIACURRENCY',
  'GOAL_TYPE_SOCIAMINIGAME',
  'GOAL_TYPE_SOCIAGIVEITEM',
  'GOAL_TYPE_SOCIAGETITEM',
  'GOAL_TYPE_COLLECTAFTERBOUNTY',
  'GOAL_TYPE_ENCOUNTER_WAYPOINT_FOREACH',
];

// Reader defects that no capture can work around. Reported on every run, never silently ignored.
//
// `level` used to live here: MSG_QUESTOFFER.Level has no ExtractMethod, so PacketReaderService's
// GetDefaultValue reads node["value"].GetValue<object>() (a System.Text.Json.JsonElement) and
// Convert.ChangeType throws InvalidCastException, which the method swallows into default(int) —
// every extracted quest claimed level 0. It is deliberately NOT excused any more: the CLI wrapper
// restores the level from the same capture (decision D46), and 3 of the 5 fixtures are level 1, so
// a level mismatch now means the repair broke. Do not re-add it here.
const KNOWN_READER_DEFECTS = {};

function parseArgs(argv) {
  const options = { corpus: process.env.SPIRALDB_QUEST_DIR ?? DEFAULT_CORPUS, regenerate: true };

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--corpus') {
      options.corpus = path.resolve(argv[++i] ?? '');
    } else if (argv[i] === '--skip-regenerate') {
      options.regenerate = false;
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }

  return options;
}

const options = parseArgs(process.argv.slice(2));

if (!fs.existsSync(READER)) {
  console.error(`error: ${READER} is missing — run "npm run build:cli" first.`);
  process.exit(1);
}

if (!fs.existsSync(options.corpus)) {
  console.error(
    `error: corpus not found at ${options.corpus}. The fixtures are generated from the disposable ` +
      'SpiralDB clone — run "npm run test:reset-clone" first, or pass --corpus <QuestTemplates dir>.',
  );
  process.exit(1);
}

// The generated apphost needs DOTNET_ROOT on NixOS (D45(3)); derive it so the script is portable.
const dotnetRoot = fs.existsSync('/usr/bin/dotnet') ? '/usr/bin' : deriveDotnetRoot();
const childEnv = { ...process.env, ...(dotnetRoot ? { DOTNET_ROOT: dotnetRoot } : {}) };

function deriveDotnetRoot() {
  try {
    const resolved = execFileSync('bash', ['-c', 'readlink -f "$(command -v dotnet)"'], {
      encoding: 'utf8',
    }).trim();
    return resolved ? path.dirname(resolved) : undefined;
  } catch {
    return undefined;
  }
}

function dialogsOf(owner) {
  return owner?.m_dialogList?.m_dialogs ?? [];
}

function containerMap(quest) {
  const containers = new Map();

  const add = (key, entries) => {
    const seen = containers.get(key) ?? { blocks: 0, entries: 0 };
    containers.set(key, { blocks: seen.blocks + 1, entries: seen.entries + entries });
  };

  for (const dialog of dialogsOf(quest)) {
    add(`quest/${dialog.m_dialogTag ?? ''}`, dialog.m_dialogEntries?.length ?? 0);
  }

  for (const goal of quest.m_goals ?? []) {
    for (const dialog of dialogsOf(goal)) {
      add(`${goal.m_goalName}/${dialog.m_dialogTag ?? ''}`, dialog.m_dialogEntries?.length ?? 0);
    }
  }

  return containers;
}

function snapshot(quest, normalizeType) {
  const goals = quest.m_goals ?? [];
  const blocks = dialogsOf(quest).length + goals.reduce((n, g) => n + dialogsOf(g).length, 0);
  const entries =
    dialogsOf(quest).reduce((n, d) => n + (d.m_dialogEntries?.length ?? 0), 0) +
    goals.reduce(
      (n, g) => n + dialogsOf(g).reduce((m, d) => m + (d.m_dialogEntries?.length ?? 0), 0),
      0,
    );

  return {
    name: quest.m_questName,
    title: quest.m_questTitle,
    level: quest.m_questLevel,
    mainline: quest.m_mainline === true,
    goalCount: goals.length,
    goalNames: goals.map((g) => g.m_goalName),
    goalTypes: goals.map((g) => normalizeType(g.m_goalType)),
    dialogBlocks: blocks,
    dialogEntries: entries,
    containers: containerMap(quest),
  };
}

const corpusSnapshot = (quest) =>
  snapshot(quest, (t) => (typeof t === 'string' ? t : `unexpected:${JSON.stringify(t)}`));

const readerSnapshot = (quest) =>
  snapshot(quest, (t) => (typeof t === 'number' ? (GOAL_TYPES[t] ?? `#${t}`) : String(t)));

function formatList(items) {
  return `[${items.join(', ')}]`;
}

function formatTypes(types) {
  const runs = [];

  for (const type of types) {
    const last = runs.at(-1);

    if (last && last.type === type) {
      last.count++;
    } else {
      runs.push({ type, count: 1 });
    }
  }

  return formatList(runs.map((r) => (r.count > 1 ? `${r.type} x${r.count}` : r.type)));
}

function formatContainers(map) {
  // Sorted so the row is order-independent (the reader and the corpus do not necessarily list the
  // same containers in the same order) and stable across runs.
  return `{${[...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, c]) => `${key}(blocks=${c.blocks}, entries=${c.entries})`)
    .join(', ')}}`;
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const fixtures = fs
  .readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

if (fixtures.length === 0) {
  console.error(`error: no fixtures under ${FIXTURE_DIR}`);
  process.exit(1);
}

let failures = 0;
let defectRows = 0;
let checks = 0;

for (const fixture of fixtures) {
  const fixturePath = path.join(FIXTURE_DIR, fixture);
  const questName = path.basename(fixture, '.json');
  const questPath = path.join(options.corpus, `questtemplates_${questName}.json`);

  console.log(`\n=== ${fixture}  (sha256 ${sha256(fixturePath)})`);

  if (!fs.existsSync(questPath)) {
    console.log(`  FAIL source quest not found: ${questPath}`);
    failures++;
    continue;
  }

  // The committed fixture must be strict JSON: the CLI parses it with System.Text.Json.
  try {
    JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  } catch (error) {
    console.log(`  FAIL fixture is not strict JSON: ${error.message}`);
    failures++;
    continue;
  }

  const wanted = corpusSnapshot(JSON5.parse(fs.readFileSync(questPath, 'utf8')));

  const outPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'verify-captures-')),
    'quests.json',
  );

  try {
    execFileSync(READER, ['--input', fixturePath, '--output', outPath], {
      env: childEnv,
      stdio: 'pipe',
    });
  } catch (error) {
    console.log(
      `  FAIL imview-packet-reader exited ${error.status}: ${(error.stderr ?? '').toString().trim()}`,
    );
    failures++;
    continue;
  }

  const quests = JSON.parse(fs.readFileSync(outPath, 'utf8'));

  if (!Array.isArray(quests) || quests.length !== 1) {
    console.log(
      `  FAIL expected exactly 1 reconstructed quest, got ${Array.isArray(quests) ? quests.length : 'non-array'}`,
    );
    failures++;
    continue;
  }

  const got = readerSnapshot(quests[0]);

  const rows = [
    ['quest name', wanted.name, got.name],
    ['title', wanted.title, got.title],
    ['level', wanted.level, got.level],
    ['mainline', wanted.mainline, got.mainline],
    ['goal count', wanted.goalCount, got.goalCount],
    ['goal names (in order)', formatList(wanted.goalNames), formatList(got.goalNames)],
    ['goal types', formatTypes(wanted.goalTypes), formatTypes(got.goalTypes)],
    ['dialog blocks (ActorDialog count)', wanted.dialogBlocks, got.dialogBlocks],
    ['dialog entries (NPCDialogEntry count)', wanted.dialogEntries, got.dialogEntries],
    [
      'dialog entries per container',
      formatContainers(wanted.containers),
      formatContainers(got.containers),
    ],
  ];

  console.log(`  ${String('field').padEnd(37)} ${String('corpus').padEnd(34)} ${'read back'}`);

  for (const [label, expected, actual] of rows) {
    checks++;
    const same =
      typeof expected === 'boolean' || typeof expected === 'number'
        ? expected === actual
        : String(expected) === String(actual);

    if (same) {
      console.log(`  ${label.padEnd(37)} ${String(expected).padEnd(34)} ${actual}  ok`);
      continue;
    }

    if (KNOWN_READER_DEFECTS[label]) {
      defectRows++;
      console.log(
        `  ${label.padEnd(37)} ${String(expected).padEnd(34)} ${actual}  KNOWN READER DEFECT (not a fixture failure)`,
      );
      console.log(`      ${KNOWN_READER_DEFECTS[label]}`);
      continue;
    }

    failures++;
    console.log(`  ${label.padEnd(37)} ${String(expected).padEnd(34)} ${actual}  MISMATCH`);
  }

  if (options.regenerate && fs.existsSync(GENERATOR)) {
    const regenerated = path.join(path.dirname(outPath), `${questName}.json`);

    execFileSync(GENERATOR, ['--quest', questPath, '--output', regenerated], {
      env: childEnv,
      stdio: ['ignore', 'inherit', 'pipe'],
    });

    const committed = sha256(fixturePath);
    const reproduced = sha256(regenerated);

    if (committed === reproduced) {
      console.log(`  reproducibility: fixturegen reproduces the committed bytes  ok`);
    } else {
      failures++;
      console.log(`  reproducibility: MISMATCH committed ${committed} vs generated ${reproduced}`);
    }
  }
}

if (options.regenerate && !fs.existsSync(GENERATOR)) {
  console.log(
    `\nwarning: ${GENERATOR} missing — skipped the reproducibility check ("npm run build:fixturegen").`,
  );
}

console.log(
  `\n${failures === 0 ? 'PASS' : 'FAIL'}: ${fixtures.length} fixture(s), ${checks} field check(s), ` +
    `${failures} mismatch(es), ${defectRows} known-reader-defect row(s).`,
);

process.exit(failures === 0 ? 0 : 1);
