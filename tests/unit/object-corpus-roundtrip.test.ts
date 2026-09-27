import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import JSON5 from 'json5';
import { describe, expect, it } from 'vitest';

import { DEFAULT_SPIRALDB_PATH } from '@server/db';
import {
  formatDocPath,
  getAtPath,
  hasAtPath,
  loadDoc,
  serializeDoc,
  type JsonDocument,
} from '@shared/document';
import { objectTypeConfig } from '@shared/objectTypes';
import type { ObjectFileType } from '@shared/naming';

import {
  collectNullPaths,
  firstDiff,
  isPlainObject,
  orderedKeyPaths,
} from '../helpers/roundtrip-fidelity';

/**
 * Story p4-09 / plan task 4.11 — **AC4: the six-family corpus round-trip sweep** (D5 pattern).
 *
 * Plan Verification Step 1: `npm test` prints a per-type count and compares it with
 * `ls | wc -l` for each directory. The phase criterion is verbatim: *"every existing DropTable
 * (317), NpcInventory, NpcSpellInventory, CreatureSpellbook, TreasureCardInventory, ZoneTransfer
 * file passes parse → serialize(unedited) → re-parse deep-equal"*. The quest corpus's own sweep is
 * `tests/unit/quest-roundtrip.test.ts` (p3-02) and is untouched except for the shared helper
 * extraction below; this file is the other six families.
 *
 * | section | what it proves |
 * |---|---|
 * | committed fixtures (always runs, CI included) | the same walk over the repository's two object fixtures — the always-on half when no corpus is on disk |
 * | corpus sweep (owner run) | per family: `files discovered` vs `ls \| wc -l`, `round-tripped`, `failures`, and a **byte-provenance census** (identical / trailing-whitespace-only / legacy-JSON5 reshape) |
 * | measured key-order & presence properties | the ZoneTransfer top-level order split 1206/1, the nested `Teleport` order split 2353/12, the duplicate in-list values (14 NpcInventory + 4 CreatureSpellbook files), the unprefixed NpcSpellInventory file |
 * | the harness's own failure detection | a dropped null, a reordered key set and a changed value each make the walk fail, by path |
 *
 * ## What "deep-equal" means here, and why key order is asserted separately
 *
 * The walk is the p3-02 one (`tests/helpers/roundtrip-fidelity.ts`): value equality **and** key
 * order at every level, plus "no explicit `null` was dropped" and "no absent key was injected".
 * `isDeepStrictEqual` alone would pass a key-sorting writer (D58e), so order is its own comparison.
 *
 * ## The three byte classes, named rather than hidden
 *
 * A file that has never been written by this tool has never been reformatted, so the raw bytes and
 * `serializeDoc`'s output can differ **without any value changing**. The phase's AC allows a
 * one-time formatting normalisation, and D48(b) names the class; the harness therefore counts
 * which class every file is in and fails on a file it cannot classify. Measured 2026-09-27 in the
 * real fork (the numbers below are those measurements):
 *
 * | family | identical | trailing-whitespace-only | legacy-JSON5 reshape |
 * |---|---|---|---|
 * | DropTables (317) | 0 | 0 | **317** — integral floats `1.0`→`1`, no final newline (`droptables_…`) |
 * | NpcInventory (215) | 215 | 0 | 0 |
 * | NpcSpellInventory (77) | 77 | 0 | 0 |
 * | CreatureSpellbook (134) | 134 | 0 | 0 |
 * | TreasureCardInventory (1) | 0 | 0 | **1** — inline one-line objects expanded (`NpcTreasureCards_2019-A.json`) |
 * | ZoneTransfer (1207) | 1206 | **1** — `WizardZoneDatas_Tutorial_Interior-A.json` ends in two newlines (D74e) | 0 |
 *
 * "Legacy-JSON5 reshape" is checked, not assumed: {@link isLegacyJson5FormattingOnly} strips
 * trailing commas, integral-float spelling and all whitespace from both sides and requires the
 * remainder to be equal — so a byte diff that moved a value fails the sweep instead of being
 * waved through as a normalisation.
 *
 * ## D68 — a skip must be provable
 *
 * Module scope computes **presence booleans only**; every read of the corpus happens inside `it()`.
 * Pointing `SPIRALDB_OBJECT_CORPUS` at an absent path makes the live sweep skip and the always-on
 * arms pass — which is the evidence for the skip, not the local green run.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURES = path.join(ROOT, 'server', 'test', 'fixtures');

/**
 * The corpus root override. When it is set, it **replaces** the default checkout (so pointing it
 * at nothing really means nothing); when it is unset, the repository's default SpiralDB path and
 * the D17 clone are both swept, each when it exists.
 */
const CORPUS_ROOT_ENV = (process.env.SPIRALDB_OBJECT_CORPUS ?? '').trim();
const CLONE_ROOT = path.join(ROOT, 'data', 'test-spiraldb');
const CORPUS_ROOT_CANDIDATES =
  CORPUS_ROOT_ENV === '' ? [DEFAULT_SPIRALDB_PATH, CLONE_ROOT] : [CORPUS_ROOT_ENV];
/** Presence only — no directory is read at collection time (D68). */
const CORPUS_ROOTS = CORPUS_ROOT_CANDIDATES.filter((root) => existsSync(root));

/**
 * One family's measured corpus census — the AC's six families, in the plan's order.
 *
 * `files` is the **`.json` file count** (the unit `ls | wc -l` also reports on a directory with no
 * non-JSON entries, which every one of these is today; the sweep asserts the two agree). The three
 * byte-class counts are the p4-09 measurements the doc-comment tabulates; `legacyJson5Reshaped` is
 * a **class** (checked by normalisation), while `trailingWhitespaceFiles` is named per file because
 * it is one file with one reason.
 */
interface ObjectCorpusCensus {
  readonly fileType: ObjectFileType;
  /** Directory name, read from the one type table so it cannot drift. */
  readonly directory: string;
  readonly files: number;
  readonly byteIdentical: number;
  readonly trailingWhitespaceOnly: number;
  readonly legacyJson5Reshaped: number;
  /** The files whose byte diff is a named, per-file normalisation (`[]` when the class covers all). */
  readonly trailingWhitespaceFiles: readonly string[];
}

const OBJECT_CORPUS_CENSUS: readonly ObjectCorpusCensus[] = [
  {
    fileType: 'droptable',
    directory: objectTypeConfig('droptable').directory,
    files: 317,
    byteIdentical: 0,
    trailingWhitespaceOnly: 0,
    legacyJson5Reshaped: 317,
    trailingWhitespaceFiles: [],
  },
  {
    fileType: 'npcinventory',
    directory: objectTypeConfig('npcinventory').directory,
    files: 215,
    byteIdentical: 215,
    trailingWhitespaceOnly: 0,
    legacyJson5Reshaped: 0,
    trailingWhitespaceFiles: [],
  },
  {
    fileType: 'npcspellinventory',
    directory: objectTypeConfig('npcspellinventory').directory,
    files: 77,
    byteIdentical: 77,
    trailingWhitespaceOnly: 0,
    legacyJson5Reshaped: 0,
    trailingWhitespaceFiles: [],
  },
  {
    fileType: 'creaturespellbook',
    directory: objectTypeConfig('creaturespellbook').directory,
    files: 134,
    byteIdentical: 134,
    trailingWhitespaceOnly: 0,
    legacyJson5Reshaped: 0,
    trailingWhitespaceFiles: [],
  },
  {
    fileType: 'treasurecardinventory',
    directory: objectTypeConfig('treasurecardinventory').directory,
    files: 1,
    byteIdentical: 0,
    trailingWhitespaceOnly: 0,
    legacyJson5Reshaped: 1,
    trailingWhitespaceFiles: [],
  },
  {
    fileType: 'zonetransfer',
    directory: objectTypeConfig('zonetransfer').directory,
    files: 1207,
    byteIdentical: 1206,
    trailingWhitespaceOnly: 1,
    legacyJson5Reshaped: 0,
    trailingWhitespaceFiles: ['WizardZoneDatas_Tutorial_Interior-A.json'],
  },
];

/**
 * The legacy prefixes the fork actually uses, per family (D19: none of them is the convention
 * prefix `fileNameFor` writes). Measured 2026-09-27; the value is `[prefix, files with it,
 * files without it]` and NpcSpellInventory is the one family with a straggler.
 */
const LEGACY_PREFIX_CENSUS: Readonly<Record<string, readonly [string, number, number]>> = {
  droptable: ['droptables_', 317, 0],
  npcinventory: ['NPCInventories_', 215, 0],
  npcspellinventory: ['NPCSpellInventories_', 76, 1],
  creaturespellbook: ['CreatureSpellbooks_', 134, 0],
  treasurecardinventory: ['NpcTreasureCards_', 1, 0],
  zonetransfer: ['WizardZoneDatas_', 1207, 0],
};

/** The one NpcSpellInventory file that carries no legacy prefix (its name is a bare UUID). */
const NPC_SPELL_UNPREFIXED_FILE = '7cd0cf23-3bba-4eb1-b7fb-1b0e9bd1e11f.json';

/** ZoneTransfer's measured key orders — top level (`1206` majority / `1` minority) … */
const ZONE_TRANSFER_TOP_LEVEL_MAJORITY = ['ZoneName', 'Events', 'Teleports'];
const ZONE_TRANSFER_TOP_LEVEL_MINORITY = ['ZoneName', 'Teleports', 'Events'];
const ZONE_TRANSFER_TOP_LEVEL_MAJORITY_FILES = 1206;
const ZONE_TRANSFER_TOP_LEVEL_MINORITY_FILE = 'WizardZoneDatas_1-A.json';

/**
 * … and the nested `Teleport` object's (`2355` serializer order / `13` spec-table order at the
 * owner's `f9a1055` baseline; `2353` / `12` before the merge, D74c/D79).
 */
const ZONE_TRANSFER_TELEPORT_SERIALIZER_ORDER = [
  'm_exitTeleporter',
  'm_teleporterTag',
  'm_teleportType',
  'm_transitionID',
  'm_destinationLoc',
  'm_destinationZone',
];
const ZONE_TRANSFER_TELEPORT_SPEC_ORDER = [
  'm_destinationLoc',
  'm_destinationZone',
  'm_exitTeleporter',
  'm_teleporterTag',
  'm_teleportType',
  'm_transitionID',
];
const ZONE_TRANSFER_TELEPORT_SERIALIZER_ORDER_ENTRIES = 2355;
const ZONE_TRANSFER_TELEPORT_SPEC_ORDER_ENTRIES = 13;

/** The duplicate `ZoneName` pairs in `ZoneTransfer/` (D48f: both are real, the first file wins). */
const ZONE_TRANSFER_DUPLICATE_KEYS = [
  'WizardCity/Tutorial_Exterior',
  'WizardCity/Tutorial_Interior',
];

/** Files carrying a duplicate **inside** their single list (D71a) — a value-based edit would collapse them. */
const DUPLICATE_LIST_VALUE_FILES: readonly {
  readonly fileType: ObjectFileType;
  readonly field: string;
  readonly files: number;
}[] = [
  { fileType: 'npcinventory', field: 'Inventory', files: 14 },
  { fileType: 'npcspellinventory', field: 'Spells', files: 0 },
  { fileType: 'creaturespellbook', field: 'SpellTemplateIds', files: 4 },
];

/* --------------------------------------------------------------------- the walk (test-local) */

/**
 * `true` when `raw` and `serialized` differ **only** in the legacy-JSON5 shape D48(b) names:
 * trailing commas before a closer, an integral float spelled `1.0` where the writer emits `1`, and
 * missing/extra whitespace (which covers the writer's single final newline).
 *
 * The classification is the point: a byte difference that is not explainable this way fails the
 * sweep, so "the run reformatted it" can never be claimed for a change that moved a value. Its one
 * masking limit is whitespace **inside** a string — but value equality is asserted separately by
 * the round trip (`firstDiff`), so a real string change fails there first.
 */
function isLegacyJson5FormattingOnly(raw: string, serialized: string): boolean {
  const normalize = (text: string): string =>
    text
      .replace(/,(\s*[}\]])/g, '$1') // JSON5 trailing commas
      .replace(/(\d+)\.0+(?=[,\]}\s]|$)/g, '$1') // integral floats: 1.0 → 1
      .replace(/\s+/g, ''); // all whitespace, final newline included
  return normalize(raw) === normalize(serialized);
}

/**
 * `ls | wc -l` for a directory — the plan's own definition of the corpus size, run as the command
 * it names rather than as a second `readdirSync`, so the two counts are genuinely independent.
 */
function lsLineCount(directory: string): number {
  const output = execSync(`ls ${JSON.stringify(directory)} | wc -l`, { encoding: 'utf8' });
  return Number.parseInt(output.trim(), 10);
}

/** The `.json` file names of a directory, sorted. */
function jsonFilesOf(directory: string): string[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .sort();
}

/** The top-level key order signature (`ZoneName,Events,Teleports`). */
function keySignature(value: Record<string, unknown>): string {
  return Object.keys(value).join(',');
}

/** One family's sweep result, printed and asserted. */
interface FamilySweep {
  fileType: ObjectFileType;
  directory: string;
  discovered: number;
  lsCount: number;
  roundTripped: number;
  failures: string[];
  byteIdentical: number;
  trailingWhitespaceOnly: number;
  legacyJson5Reshaped: number;
  unclassified: string[];
  /** Ordered `[file, keySignature]` for every top-level key order seen. */
  topLevelOrders: Map<string, number>;
  /** The files in each top-level order, capped at a handful for the print. */
  topLevelOrderExamples: Map<string, string[]>;
}

/**
 * The whole sweep for one family in one root: read → `serializeDoc` → re-parse, deep-equal **and**
 * key-order-equal, with the byte class of every file recorded.
 *
 * Nothing here writes; the harness has no write path (the D66(g) companion rule: never write the
 * clone while a test reads it).
 */
function sweepFamily(root: string, census: ObjectCorpusCensus): FamilySweep {
  const directory = path.join(root, census.directory);
  const files = jsonFilesOf(directory);
  const result: FamilySweep = {
    fileType: census.fileType,
    directory,
    discovered: files.length,
    lsCount: lsLineCount(directory),
    roundTripped: 0,
    failures: [],
    byteIdentical: 0,
    trailingWhitespaceOnly: 0,
    legacyJson5Reshaped: 0,
    unclassified: [],
    topLevelOrders: new Map(),
    topLevelOrderExamples: new Map(),
  };

  for (const file of files) {
    const raw = readFileSync(path.join(directory, file), 'utf8');
    let source: JsonDocument;
    try {
      source = loadDoc(JSON5.parse(raw));
    } catch (error) {
      result.failures.push(`${file}: parse failed: ${String(error)}`);
      continue;
    }
    const serialized = serializeDoc(source);
    const reparsed = JSON.parse(serialized) as JsonDocument;

    // 1. Data fidelity: values, key sets, key order, explicit nulls, absences — the p3-02 walk.
    const diff = firstDiff(source, reparsed);
    if (diff !== undefined) {
      result.failures.push(`${file}: ${diff}`);
      continue;
    }
    const leftOrder = orderedKeyPaths(source);
    const rightOrder = orderedKeyPaths(reparsed);
    const orderMismatch = leftOrder.findIndex((keyPath, index) => rightOrder[index] !== keyPath);
    if (orderMismatch !== -1 || leftOrder.length !== rightOrder.length) {
      result.failures.push(
        `${file}: key order differs at ${leftOrder[orderMismatch] ?? `length ${leftOrder.length} vs ${rightOrder.length}`}`,
      );
      continue;
    }
    const droppedNull = collectNullPaths(source).find(
      (nullPath) => !hasAtPath(reparsed, nullPath) || getAtPath(reparsed, nullPath) !== null,
    );
    if (droppedNull !== undefined) {
      result.failures.push(
        `${file}: explicit null at ${formatDocPath(droppedNull)} did not survive`,
      );
      continue;
    }

    // 2. The byte provenance: identical, a named whitespace normalisation, or the legacy reshape.
    if (raw === serialized) {
      result.byteIdentical += 1;
    } else if (raw.trimEnd() === serialized.trimEnd()) {
      result.trailingWhitespaceOnly += 1;
    } else if (isLegacyJson5FormattingOnly(raw, serialized)) {
      result.legacyJson5Reshaped += 1;
    } else {
      result.unclassified.push(file);
    }

    // 3. The measured key-order distributions (ZoneTransfer's two levels; harmless for the rest).
    const signature = keySignature(source as Record<string, unknown>);
    result.topLevelOrders.set(signature, (result.topLevelOrders.get(signature) ?? 0) + 1);
    const examples = result.topLevelOrderExamples.get(signature) ?? [];
    if (examples.length < 4) {
      examples.push(file);
      result.topLevelOrderExamples.set(signature, examples);
    }

    result.roundTripped += 1;
  }

  return result;
}

function printSweep(sweep: FamilySweep, authoritative: boolean): void {
  const orders = [...sweep.topLevelOrders.entries()]
    .map(
      ([signature, count]) =>
        `${count}×[${signature}] (${sweep.topLevelOrderExamples.get(signature)?.join(', ')})`,
    )
    .join(' ');
  console.log(
    `[p4-09 ac4] ${sweep.fileType} dir=${sweep.directory}${authoritative ? ' [authoritative]' : ' [clone]'}\n` +
      `[p4-09 ac4]   files discovered=${sweep.discovered} ls|wc -l=${sweep.lsCount} ` +
      `round-tripped=${sweep.roundTripped} failures=${sweep.failures.length}\n` +
      `[p4-09 ac4]   bytes: identical=${sweep.byteIdentical} trailing-whitespace-only=${sweep.trailingWhitespaceOnly} ` +
      `legacy-json5-reshape=${sweep.legacyJson5Reshaped} unclassified=${sweep.unclassified.length}` +
      (sweep.unclassified.length === 0 ? '' : ` ${sweep.unclassified.slice(0, 10).join(', ')}`) +
      `\n[p4-09 ac4]   top-level key order: ${orders}` +
      (sweep.failures.length === 0
        ? ''
        : `\n[p4-09 ac4]   ${sweep.failures.slice(0, 10).join('\n[p4-09 ac4]   ')}`),
  );
}

/* ------------------------------------------------- the harness's own failure detection (always on) */

describe('p4-09 ac4 — the fidelity walk detects the failures the sweep exists to catch', () => {
  const SOURCE = { Name: 'X', Nested: { a: 1, b: null }, List: [1, 2], Absent: { present: true } };

  it('accepts a pristine round trip (positive control)', () => {
    expect(firstDiff(SOURCE, JSON.parse(serializeDoc(SOURCE)))).toBeUndefined();
  });

  it('fails on a dropped explicit null, by path', () => {
    const broken = JSON.parse(
      JSON.stringify(SOURCE, (_key, value: unknown) => (value === null ? undefined : value)),
    ) as JsonDocument;
    const detail = firstDiff(SOURCE, broken);
    expect(detail).toBeDefined();
    expect(detail).toContain('Nested');
    console.log(`[p4-09 ac4 falsification] dropped null detected: ${String(detail)}`);
  });

  it('fails on a reordered key set that deep equality alone does not see', () => {
    const reordered = {
      Nested: SOURCE.Nested,
      Name: SOURCE.Name,
      List: SOURCE.List,
      Absent: SOURCE.Absent,
    };
    const detail = firstDiff(SOURCE, reordered);
    expect(detail).toContain('key order differs');
    console.log(`[p4-09 ac4 falsification] reordered keys detected: ${String(detail)}`);
  });

  it('fails on a moved value, by path', () => {
    const broken = { ...SOURCE, Nested: { ...SOURCE.Nested, a: 2 } };
    expect(firstDiff(SOURCE, broken)).toContain('Nested.a: number (1) !== number (2)');
  });

  it('classifies an integral-float + trailing-comma rewrite as the legacy reshape, and a moved value as unclassified', () => {
    const raw = '{\n  "RollChance": 1.0,\n  "Name": "X",\n}\n';
    const doc = JSON5.parse(raw);
    const serialized = serializeDoc(loadDoc(doc));
    expect(isLegacyJson5FormattingOnly(raw, serialized)).toBe(true);
    expect(isLegacyJson5FormattingOnly(raw, serialized.replace('"X"', '"Y"'))).toBe(false);
  });
});

/* ------------------------------------------- the always-on arm: the committed object fixtures */

/**
 * The object fixtures the repository commits (not the corpus, which is gitignored). Both are swept
 * in CI; the two synthetic ones are the shapes the corpus does **not** provide — a strict-JSON file
 * and a spec-shaped zone transfer without the corpus's `Events` drift field.
 */
const SWEPT_FIXTURES: readonly string[] = [
  'droptable_ds-acad1-c01-001.json',
  'droptable_synthetic.json',
  'zonetransfer_10017-A.json',
  'zonetransfer_synthetic.json',
];

describe('p4-09 ac4 — round-trip over the committed object fixtures (always runs, CI included)', () => {
  it('round-trips every committed object fixture and preserves key order, nulls and absences', () => {
    const failures: string[] = [];
    for (const file of SWEPT_FIXTURES) {
      const raw = readFileSync(path.join(FIXTURES, file), 'utf8');
      const source = loadDoc(JSON5.parse(raw));
      const reparsed = JSON.parse(serializeDoc(source)) as JsonDocument;
      const diff = firstDiff(source, reparsed);
      if (diff !== undefined) {
        failures.push(`${file}: ${diff}`);
        continue;
      }
      const leftOrder = orderedKeyPaths(source);
      const rightOrder = orderedKeyPaths(reparsed);
      const mismatch = leftOrder.findIndex((keyPath, index) => rightOrder[index] !== keyPath);
      if (mismatch !== -1 || leftOrder.length !== rightOrder.length) {
        failures.push(`${file}: key order differs at ${leftOrder[mismatch] ?? 'length'}`);
      }
    }
    console.log(
      `[p4-09 ac4] committed fixtures swept=${SWEPT_FIXTURES.length} failures=${failures.length}` +
        (failures.length === 0 ? '' : ` ${failures.join(' | ')}`),
    );
    expect(failures.join('\n')).toBe('');
  });

  it('names what each byte class is, so a normalisation is never claimed vaguely', () => {
    // The census is data; the sweep below asserts it against the corpus. This arm makes CI fail if
    // the two facts are ever edited into disagreement (e.g. a file counted twice).
    for (const census of OBJECT_CORPUS_CENSUS) {
      expect(
        census.byteIdentical + census.trailingWhitespaceOnly + census.legacyJson5Reshaped,
      ).toBe(census.files);
      expect(census.trailingWhitespaceFiles).toHaveLength(census.trailingWhitespaceOnly);
    }
    const total = OBJECT_CORPUS_CENSUS.reduce((sum, census) => sum + census.files, 0);
    expect(total).toBe(317 + 215 + 77 + 134 + 1 + 1207);
  });
});

/* ------------------------------------------------------------------ the corpus sweep (owner run) */

describe.skipIf(CORPUS_ROOTS.length === 0)(
  'p4-09 ac4 — round-trip over the six-family corpus on disk (owner run)',
  () => {
    it('round-trips every file of every family and prints per-type counts vs `ls | wc -l`', () => {
      const authoritativeCounts = new Map<ObjectFileType, number>();

      for (const root of CORPUS_ROOTS) {
        const authoritative = root === DEFAULT_SPIRALDB_PATH;
        for (const census of OBJECT_CORPUS_CENSUS) {
          const directory = path.join(root, census.directory);
          if (!existsSync(directory)) {
            // `NpcDropTable/` is absent and is *not* one of these six; an absent directory here
            // would be a corpus change, so it is reported, not skipped silently.
            console.log(`[p4-09 ac4] ${census.fileType} dir=${directory} ABSENT in ${root}`);
            continue;
          }

          const sweep = sweepFamily(root, census);
          printSweep(sweep, authoritative);

          // The plan's own comparison: what the harness discovered vs what `ls | wc -l` says.
          expect(sweep.lsCount).toBe(sweep.discovered);
          // The count is asserted against the discovery, never against a number (p3-02's rule);
          // every discovered file must have been walked.
          expect(sweep.roundTripped).toBe(sweep.discovered);
          // No file goes unclassified: a byte diff that is not the named class fails here.
          expect(sweep.unclassified.join('\n')).toBe('');
          expect(sweep.failures.join('\n')).toBe('');

          if (authoritative) {
            authoritativeCounts.set(census.fileType, sweep.discovered);
            // The AC's numbers are asserted only against the repository's own checkout, so a
            // clone that a test round left a file in cannot invalidate the corpus measurement.
            expect(sweep.discovered).toBe(census.files);
            expect(sweep.byteIdentical).toBe(census.byteIdentical);
            expect(sweep.trailingWhitespaceOnly).toBe(census.trailingWhitespaceOnly);
            expect(sweep.legacyJson5Reshaped).toBe(census.legacyJson5Reshaped);

            const prefix = LEGACY_PREFIX_CENSUS[census.fileType];
            const names = jsonFilesOf(path.join(root, census.directory));
            const withPrefix = names.filter((file) => file.startsWith(prefix[0])).length;
            expect([prefix[0], withPrefix, names.length - withPrefix]).toEqual([...prefix]);
          } else {
            // The clone is a second, independent corpus read; its counts are printed, not pinned.
            expect(sweep.discovered).toBeGreaterThan(0);
          }
        }
      }

      console.log(
        `[p4-09 ac4] summary vs the AC: ` +
          OBJECT_CORPUS_CENSUS.map(
            (census) => `${census.fileType}=${authoritativeCounts.get(census.fileType)}`,
          ).join(' '),
      );
    });

    it('preserves the measured key-order splits, the duplicate list values and the unprefixed file', () => {
      const root = DEFAULT_SPIRALDB_PATH;
      const directoryOf = (fileType: ObjectFileType): string =>
        path.join(root, objectTypeConfig(fileType).directory);

      // --- ZoneTransfer: the top-level order split 1206/1 (D74d) -----------------------------
      const zoneDir = directoryOf('zonetransfer');
      const topLevel = new Map<string, string[]>();
      const teleportOrders = new Map<string, number>();
      const zoneNameCounts = new Map<string, number>();
      let teleportEntries = 0;

      for (const file of jsonFilesOf(zoneDir)) {
        const doc = JSON5.parse(readFileSync(path.join(zoneDir, file), 'utf8')) as Record<
          string,
          unknown
        >;
        const signature = keySignature(doc);
        topLevel.set(signature, [...(topLevel.get(signature) ?? []), file]);
        if (typeof doc.ZoneName === 'string') {
          zoneNameCounts.set(doc.ZoneName, (zoneNameCounts.get(doc.ZoneName) ?? 0) + 1);
        }
        for (const teleportRow of Array.isArray(doc.Teleports) ? doc.Teleports : []) {
          if (isPlainObject(teleportRow) && isPlainObject(teleportRow.Teleport)) {
            const nested = keySignature(teleportRow.Teleport);
            teleportOrders.set(nested, (teleportOrders.get(nested) ?? 0) + 1);
            teleportEntries += 1;
          }
        }
      }

      const majority = topLevel.get(ZONE_TRANSFER_TOP_LEVEL_MAJORITY.join(',')) ?? [];
      const minority = topLevel.get(ZONE_TRANSFER_TOP_LEVEL_MINORITY.join(',')) ?? [];
      console.log(
        `[p4-09 ac4] ZoneTransfer top-level order: majority=${majority.length} ` +
          `minority=${minority.length} (${minority.join(', ')})`,
      );
      expect(majority).toHaveLength(ZONE_TRANSFER_TOP_LEVEL_MAJORITY_FILES);
      expect(minority).toEqual([ZONE_TRANSFER_TOP_LEVEL_MINORITY_FILE]);

      const serializerOrder =
        teleportOrders.get(ZONE_TRANSFER_TELEPORT_SERIALIZER_ORDER.join(',')) ?? 0;
      const specOrder = teleportOrders.get(ZONE_TRANSFER_TELEPORT_SPEC_ORDER.join(',')) ?? 0;
      console.log(
        `[p4-09 ac4] ZoneTransfer nested Teleport order: serializer=${serializerOrder} spec=${specOrder} ` +
          `(of ${teleportEntries} entries)`,
      );
      expect(serializerOrder).toBe(ZONE_TRANSFER_TELEPORT_SERIALIZER_ORDER_ENTRIES);
      expect(specOrder).toBe(ZONE_TRANSFER_TELEPORT_SPEC_ORDER_ENTRIES);
      expect(teleportOrders.size).toBe(2);

      const duplicates = [...zoneNameCounts.entries()].filter(([, count]) => count > 1);
      console.log(
        `[p4-09 ac4] ZoneTransfer duplicate ZoneName pairs: ${JSON.stringify(duplicates)}`,
      );
      expect(duplicates.map(([key]) => key).sort()).toEqual(
        [...ZONE_TRANSFER_DUPLICATE_KEYS].sort(),
      );

      // --- the double-newline file: named as the one trailing-whitespace normalisation (D74e) --
      const doubleNewlineFile = 'WizardZoneDatas_Tutorial_Interior-A.json';
      const rawDouble = readFileSync(path.join(zoneDir, doubleNewlineFile), 'utf8');
      const serializedDouble = serializeDoc(loadDoc(JSON5.parse(rawDouble)));
      expect(rawDouble.endsWith('\n\n')).toBe(true);
      expect(serializedDouble.endsWith('\n\n')).toBe(false);
      expect(rawDouble.trimEnd()).toBe(serializedDouble.trimEnd());
      console.log(
        `[p4-09 ac4] named normalisation: ${doubleNewlineFile} raw ends in \\n\\n, the writer emits one — ` +
          'whitespace-only, values identical',
      );

      // --- duplicate in-list values survive (D71a) --------------------------------------------
      for (const row of DUPLICATE_LIST_VALUE_FILES) {
        const directory = directoryOf(row.fileType);
        let filesWithDuplicates = 0;
        for (const file of jsonFilesOf(directory)) {
          const doc = JSON5.parse(readFileSync(path.join(directory, file), 'utf8')) as Record<
            string,
            unknown
          >;
          const list = doc[row.field];
          if (!Array.isArray(list)) {
            continue;
          }
          const flat = list.map((item) => (isPlainObject(item) ? JSON.stringify(item) : item));
          if (new Set(flat).size !== flat.length) {
            filesWithDuplicates += 1;
          }
        }
        console.log(
          `[p4-09 ac4] ${row.fileType}.${row.field}: files with a duplicate element=${filesWithDuplicates}`,
        );
        // The count is the measured one; the round trip above already proved the duplicates
        // (array lengths and element values) survive the walk — this pins that they still exist.
        expect(filesWithDuplicates).toBe(row.files);
      }

      // --- the unprefixed NpcSpellInventory file is swept, not skipped --------------------------
      const spellDir = directoryOf('npcspellinventory');
      const unprefixed = jsonFilesOf(spellDir).filter(
        (file) => !file.startsWith(LEGACY_PREFIX_CENSUS.npcspellinventory[0]),
      );
      expect(unprefixed).toEqual([NPC_SPELL_UNPREFIXED_FILE]);
      const straggler = JSON5.parse(
        readFileSync(path.join(spellDir, NPC_SPELL_UNPREFIXED_FILE), 'utf8'),
      ) as JsonDocument;
      const stragglerRoundTrip = JSON.parse(serializeDoc(loadDoc(straggler))) as JsonDocument;
      expect(firstDiff(straggler, stragglerRoundTrip)).toBeUndefined();
      expect(hasAtPath(straggler, ['TemplateID'])).toBe(true);
      console.log(
        `[p4-09 ac4] NpcSpellInventory unprefixed file ${NPC_SPELL_UNPREFIXED_FILE} ` +
          `(TemplateID=${String(getAtPath(straggler, ['TemplateID']))}) round-tripped and is key-resolved by content, not name`,
      );
    });
  },
);
