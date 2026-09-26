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

import {
  compareSnapshots,
  corpusSnapshot,
  dotnetEnv,
  readerSnapshot,
} from './lib/quest-roundtrip.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const FIXTURE_DIR = path.join(ROOT, 'server/test/fixtures/captures');
const READER = path.join(ROOT, 'tools/bin/imview-packet-reader');
const GENERATOR = path.join(ROOT, 'tools/bin/fixturegen');
const DEFAULT_CORPUS = path.join(ROOT, 'data/test-spiraldb/QuestTemplates');

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

// The generated apphost needs DOTNET_ROOT on NixOS (D45(3)); deriveDotnetRoot() is portable.
const childEnv = dotnetEnv();

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

  const {
    compared,
    checks: rowChecks,
    mismatches,
    defectRows: rowDefects,
  } = compareSnapshots(wanted, got, KNOWN_READER_DEFECTS);

  checks += rowChecks;
  defectRows += rowDefects;
  failures += mismatches;

  console.log(`  ${String('field').padEnd(37)} ${String('corpus').padEnd(34)} ${'read back'}`);

  for (const row of compared) {
    const { label, expected, actual, same, knownDefect } = row;

    if (same) {
      console.log(`  ${label.padEnd(37)} ${String(expected).padEnd(34)} ${actual}  ok`);
      continue;
    }

    if (knownDefect) {
      console.log(
        `  ${label.padEnd(37)} ${String(expected).padEnd(34)} ${actual}  KNOWN READER DEFECT (not a fixture failure)`,
      );
      console.log(`      ${knownDefect}`);
      continue;
    }

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
