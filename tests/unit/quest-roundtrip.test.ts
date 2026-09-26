import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import JSON5 from 'json5';
import { describe, expect, it } from 'vitest';

import { DEFAULT_SPIRALDB_PATH } from '@server/db';
import {
  DocumentPathError,
  applyEdits,
  deleteAtPath,
  formatDocPath,
  getAtPath,
  hasAtPath,
  insertIntoArray,
  loadDoc,
  serializeDoc,
  setAtPath,
  type DocEdit,
  type DocPath,
  type JsonDocument,
} from '@shared/document';
import {
  DIALOG_TYPES,
  GOAL_TYPES,
  QUEST_TEMPLATE_FIELDS,
  REQUIREMENT_LIST_TYPE,
  REQUIREMENT_TYPES,
  RESULT_TYPES,
  TYPE_STRINGS,
  shortTypeName,
  type KnownTypeName,
} from '@shared/quest';

/**
 * Task 3.2 / story p3-02 — the round-trip fidelity harness that gates Phase 3 (D5 + D57).
 *
 * Two acceptance criteria, and the three falsifications that prove the harness can fail:
 *
 * | section | criterion | what it proves |
 * |---|---|---|
 * | `p3-02 ac1` fixtures | the CI-side half of the round-trip | `JSON5.parse → serializeDoc(unedited) → JSON.parse → deep-equal` for every committed quest fixture, over both document shapes (explicit `null`s, omitted keys), plus the D57 order/null/absence properties asserted explicitly |
 * | `p3-02 ac1` corpus | "322/322 QuestTemplates" | the same sweep over every `*.json` in the corpus directory (real checkout **and** the D17 clone when they exist), count printed and compared against the number of files discovered |
 * | `p3-02 ac2` sample | "≥1 mutation per goal/requirement/result type" | one mutation per `$type` the committed corpus recording lists, applied through the mutation primitives, asserting the mutated path changed and everything else is deep-equal |
 * | `p3-02 ac2` corpus | the same, on real data | the same mutation applied inside a real corpus file that contains the type (owner run) |
 * | `the harness's own failure detection` | — | a dropped explicit `null`, a reordered key set and a mutation that touches a sibling each make the harness fail, with the offending path named |
 *
 * The corpus is never committed (`.gitignore` line 5 is `data/`, and the real checkout is a sibling
 * repository), so the sweep prints an explicit reason and skips when neither is on disk; the
 * committed fixtures carry the always-on half. That is the `manifest.test.ts` /
 * `quest-type-constants.test.ts` pattern: **real files are never committed, a recording is.**
 *
 * Measured shapes (2026-09-26, this harness): the real `QuestTemplates/` is 322/322 files with all
 * 36 modelled top-level keys, every optional value an explicit `null`; the D17 clone is 320 files
 * of that shape plus **2** of this tool's own writes where `NullValueHandling.Ignore` omitted every
 * null-valued key (18 keys) — `questtemplates_WC-CYCLOPS-MAIN-002.json`,
 * `questtemplates_WC-UNICORN-MAIN-004.json`. Both shapes are legal input and both must survive
 * unchanged (D57a), which is why the fixture sweep pins one of each.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURES = path.join(ROOT, 'server', 'test', 'fixtures');

/**
 * The corpus measurement p3-01 recorded (`quest_corpus_type_strings.json`, 26 distinct `$type`
 * strings over 7,956 occurrences in the real checkout). The type list `p3-02 ac2` must cover is
 * derived from it, so CI covers every type without needing the corpus on disk.
 */
interface RecordedCorpus {
  corpusPath: string;
  corpusFiles: number;
  distinctTypeStrings: number;
  typeStringCounts: Record<string, number>;
}

const RECORDED = JSON.parse(
  readFileSync(path.join(FIXTURES, 'quest_corpus_type_strings.json'), 'utf8'),
) as RecordedCorpus;

/** Every `$type` string the corpus measurement recorded, in the recording's order. */
const MEASURED_TYPE_STRINGS: readonly string[] = Object.keys(RECORDED.typeStringCounts);

/**
 * The corpus directories, in order of authority: the repository's default SpiralDB path (the
 * recording's source), overridable for a different checkout, then the D17 test clone. Both are
 * gitignored/absent in CI, where {@link CORPORA} is empty and the sweep says so.
 */
const CORPUS_DIR =
  process.env.SPIRALDB_QUEST_CORPUS ?? path.join(DEFAULT_SPIRALDB_PATH, 'QuestTemplates');
const CLONE_CORPUS_DIR = path.join(ROOT, 'data', 'test-spiraldb', 'QuestTemplates');
const CORPORA = [...new Set([CORPUS_DIR, CLONE_CORPUS_DIR])].filter((dir) => existsSync(dir));

if (CORPORA.length === 0) {
  console.log(
    `[p3-02 ac1] no SpiralDB quest corpus on disk (checked ${CORPUS_DIR} and ${CLONE_CORPUS_DIR}) — ` +
      'the live sweep is skipped and the committed fixtures below carry the round-trip assertions ' +
      '(CI has no sibling repo, and the D17 clone is gitignored).',
  );
}

/* ------------------------------------------------------------------ helpers (test-local) */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A short description of a value, for the harness's own messages. */
function describeValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `an array of length ${value.length}`;
  }
  if (isPlainObject(value)) {
    return 'an object';
  }
  return `${typeof value} (${JSON.stringify(value)})`;
}

/**
 * The first difference between two documents, as a path and a reason — or `undefined` when they are
 * identical **including key order**.
 *
 * Deliberately not `isDeepStrictEqual` alone: property order is not part of deep equality, so a
 * serializer that reorders keys would pass a value-only comparison while rewriting every line of a
 * file. This walk compares key sets *and their order* at every level, then array lengths and
 * elements, and only then the scalars — so a failure can always name one concrete path.
 */
function firstDiff(left: unknown, right: unknown, at = '<root>'): string | undefined {
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    const missingRight = leftKeys.filter((key) => !rightKeys.includes(key));
    const missingLeft = rightKeys.filter((key) => !leftKeys.includes(key));
    if (missingRight.length > 0 || missingLeft.length > 0) {
      return `${at}: key sets differ (missing on the left: [${missingLeft.join(', ')}], missing on the right: [${missingRight.join(', ')}])`;
    }
    if (leftKeys.join('\u0000') !== rightKeys.join('\u0000')) {
      return `${at}: key order differs (left: [${leftKeys.join(', ')}] vs right: [${rightKeys.join(', ')}])`;
    }
    for (const key of leftKeys) {
      const nested = firstDiff(left[key], right[key], `${at}.${key}`);
      if (nested !== undefined) {
        return nested;
      }
    }
    return undefined;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return `${at}: array length differs (${left.length} vs ${right.length})`;
    }
    for (let index = 0; index < left.length; index += 1) {
      const nested = firstDiff(left[index], right[index], `${at}[${index}]`);
      if (nested !== undefined) {
        return nested;
      }
    }
    return undefined;
  }
  return isDeepStrictEqual(left, right)
    ? undefined
    : `${at}: ${describeValue(left)} !== ${describeValue(right)}`;
}

/** Every key path of a value, in document order (`<key>`, `<key>.m_goals[0]`, …). */
function orderedKeyPaths(value: unknown, at = ''): string[] {
  const paths: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => paths.push(...orderedKeyPaths(item, `${at}[${index}]`)));
  } else if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      const here = at === '' ? key : `${at}.${key}`;
      paths.push(here);
      paths.push(...orderedKeyPaths(item, here));
    }
  }
  return paths;
}

/** Every path in a document whose value is an explicit `null`. */
function collectNullPaths(value: unknown, at: DocPath = [], paths: DocPath[] = []): DocPath[] {
  if (value === null) {
    if (at.length > 0) {
      paths.push(at);
    }
    return paths;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectNullPaths(item, [...at, index], paths));
  } else if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      collectNullPaths(item, [...at, key], paths);
    }
  }
  return paths;
}

/** Every `$type` string occurring anywhere in a document. */
function collectTypeStrings(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectTypeStrings(item, found));
  } else if (isPlainObject(value)) {
    if (typeof value.$type === 'string') {
      found.add(value.$type);
    }
    Object.values(value).forEach((item) => collectTypeStrings(item, found));
  }
  return found;
}

/** The path of the first node in document order whose `$type` is {@link type}. */
function findFirstPathByType(value: unknown, type: string, at: DocPath = []): DocPath | undefined {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findFirstPathByType(value[index], type, [...at, index]);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  if (isPlainObject(value)) {
    if (value.$type === type) {
      return at;
    }
    for (const [key, item] of Object.entries(value)) {
      const found = findFirstPathByType(item, type, [...at, key]);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
}

/** `true` when every container in the tree supports `Object.freeze` (a strict-mode write throws). */
function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
  } else if (isPlainObject(value)) {
    Object.values(value).forEach(deepFreeze);
  }
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
  }
  return value;
}

/**
 * The **lenient** drop of a path, used only by the "everything else" comparison: unlike
 * `deleteAtPath` (which refuses a path that does not exist), dropping an index past the end is a
 * no-op — which is what makes one symmetric rule work for a set, a tail insert and a tail delete.
 */
function omitPath(doc: JsonDocument, path: DocPath): JsonDocument {
  return hasAtPath(doc, path) ? deleteAtPath(doc, path) : doc;
}

/**
 * "Everything else is deep-equal": drop the mutated path from both documents and compare what is
 * left (value order included). Returns `''` when nothing else moved, and a message naming the first
 * unintended difference otherwise.
 */
function everythingElseDetail(
  before: JsonDocument,
  after: JsonDocument,
  mutatedPath: DocPath,
): string {
  const diff = firstDiff(omitPath(before, mutatedPath), omitPath(after, mutatedPath));
  if (diff === undefined) {
    return '';
  }
  return `everything-else check found ${diff} outside the mutated path ${formatDocPath(mutatedPath)}`;
}

/**
 * Two strings that are equal on success and differ on failure, so a failing `expect` prints the
 * *reason* instead of a bare `false`. Used where the interesting value is a description, not a
 * predicate.
 */
function assertReported(label: string, ok: string, failure: string): void {
  expect(`${label}: ${ok}`).toBe(`${label}: ${failure}`);
}

/* ---------------------------------------------------------- the harness's own failure modes */

/**
 * A serializer that drops explicit `null`s — i.e. this tool's "NullValueHandling.Ignore" shape
 * applied to a document that carries them. Used by the harness's self-tests, never by the model.
 */
function dropNullsBytes(doc: JsonDocument): string {
  return `${JSON.stringify(doc, (_key, value: unknown) => (value === null ? undefined : value), 2)}\n`;
}

/** A serializer that emits keys sorted, i.e. one that rebuilds a document instead of merging (D57b). */
function sortKeysBytes(doc: JsonDocument): string {
  const sortKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(sortKeys);
    }
    if (isPlainObject(value)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(value).sort()) {
        sorted[key] = sortKeys(value[key]);
      }
      return sorted;
    }
    return value;
  };
  return `${JSON.stringify(sortKeys(doc), null, 2)}\n`;
}

/* ----------------------------------------------------------------- ac1 — the committed fixtures */

/**
 * The always-on half of the round-trip sweep: the fixtures the repository commits, one per shape
 * the corpus and the pipeline produce. All four are swept in CI.
 */
const SWEPT_FIXTURES: readonly { file: string; shape: string }[] = [
  {
    file: 'quest_DS-ACAD-C01-003.json',
    shape:
      'real corpus quest, JSON5 (306 of the 322 corpus files need JSON5), 36 keys with explicit nulls',
  },
  {
    file: 'quest_trailing_comma_synthetic.json',
    shape: 'synthetic trailing commas (JSON5)',
  },
  {
    file: 'quest_hex_title_synthetic.json',
    shape: 'minimal strict JSON — 5 of the 36 modelled keys (absent-key shape)',
  },
  {
    file: 'quest_null_stripped_pipeline.json',
    shape:
      "this tool's own NullValueHandling.Ignore write — 18 keys, every null-valued key omitted (byte copy of data/test-spiraldb, md5 20e9ec054bd15300f502c1d33fc0b89c)",
  },
];

function fixtureBytes(file: string): string {
  return readFileSync(path.join(FIXTURES, file), 'utf8');
}

describe('p3-02 ac1 — round-trip fidelity over the committed fixtures (always runs, CI included)', () => {
  it('round-trips every committed quest fixture and preserves order, explicit nulls and absences', () => {
    const rows: string[] = [];
    let fixturesWithExplicitNulls = 0;
    let fixturesWithAbsentModelledKeys = 0;

    for (const { file, shape } of SWEPT_FIXTURES) {
      // The acceptance criterion's exact chain: JSON5.parse → serializeDoc (unedited) → JSON.parse.
      const source = loadDoc(JSON5.parse(fixtureBytes(file)));
      const reparsed = JSON.parse(serializeDoc(source)) as JsonDocument;

      // (1) deep-equal against the first parse — and key order, which deep equality cannot see.
      assertReported(
        file,
        'deep-equal and order-identical',
        firstDiff(source, reparsed) ?? 'deep-equal and order-identical',
      );
      const leftOrder = orderedKeyPaths(source);
      const rightOrder = orderedKeyPaths(reparsed);
      const orderMismatch = leftOrder.findIndex((keyPath, index) => rightOrder[index] !== keyPath);
      assertReported(
        `${file} key order`,
        'preserved',
        orderMismatch === -1 && leftOrder.length === rightOrder.length
          ? 'preserved'
          : `differs at ${leftOrder[orderMismatch] ?? `length ${leftOrder.length} vs ${rightOrder.length}`}`,
      );

      // (2) D57 — an explicit null stays an explicit null (never dropped, never turned into an absent key).
      const nullPaths = collectNullPaths(source);
      if (nullPaths.length > 0) {
        fixturesWithExplicitNulls += 1;
      }
      for (const nullPath of nullPaths) {
        const kept = hasAtPath(reparsed, nullPath) && getAtPath(reparsed, nullPath) === null;
        assertReported(
          `${file} explicit null`,
          'kept',
          kept ? 'kept' : `DROPPED at ${formatDocPath(nullPath)}`,
        );
      }

      // (3) D57 — a key the source does not have is not injected by the round trip.
      const absentModelledKeys = QUEST_TEMPLATE_FIELDS.filter(
        (field) => !hasAtPath(source, [field]),
      );
      if (absentModelledKeys.length > 0) {
        fixturesWithAbsentModelledKeys += 1;
      }
      const resurrected = absentModelledKeys.filter((field) => hasAtPath(reparsed, [field]));
      assertReported(
        `${file} absent modelled keys`,
        'stayed absent',
        resurrected.length === 0 ? 'stayed absent' : `were injected: ${resurrected.join(', ')}`,
      );

      rows.push(
        `${file.padEnd(38)} keys=${String(Object.keys(source as object).length).padStart(2)} ` +
          `nulls=${String(nullPaths.length).padStart(2)} absentModelledKeys=${String(absentModelledKeys.length).padStart(2)}  ${shape}`,
      );
    }

    console.log(
      `[p3-02 ac1] committed fixtures: ${SWEPT_FIXTURES.length} files round-tripped ` +
        `(explicit-null fixtures=${fixturesWithExplicitNulls}, absent-key fixtures=${fixturesWithAbsentModelledKeys})\n` +
        `[p3-02 ac1] ${rows.join('\n[p3-02 ac1] ')}`,
    );

    // Both shapes must really be exercised by the always-on sweep, or CI proves only one of them.
    expect(fixturesWithExplicitNulls).toBeGreaterThan(0);
    expect(fixturesWithAbsentModelledKeys).toBeGreaterThan(0);
  });
});

describe.skipIf(CORPORA.length === 0)(
  'p3-02 ac1 — round-trip fidelity over the corpus on disk (owner run)',
  () => {
    it('round-trips every quest file in every corpus and prints the count', () => {
      for (const dir of CORPORA) {
        const files = readdirSync(dir)
          .filter((file) => file.endsWith('.json'))
          .sort();
        expect(files.length).toBeGreaterThan(0);

        const failures: string[] = [];
        let roundTripped = 0;
        let filesWithExplicitNulls = 0;
        let filesWithAbsentModelledKeys = 0;

        for (const file of files) {
          let source: JsonDocument;
          try {
            source = loadDoc(JSON5.parse(readFileSync(path.join(dir, file), 'utf8')));
          } catch (error) {
            failures.push(`${file}: parse failed: ${String(error)}`);
            continue;
          }
          const reparsed = JSON.parse(serializeDoc(source)) as JsonDocument;

          const diff = firstDiff(source, reparsed);
          if (diff !== undefined) {
            failures.push(`${file}: ${diff}`);
            continue;
          }
          const leftOrder = orderedKeyPaths(source);
          const rightOrder = orderedKeyPaths(reparsed);
          const orderMismatch = leftOrder.findIndex(
            (keyPath, index) => rightOrder[index] !== keyPath,
          );
          if (orderMismatch !== -1 || leftOrder.length !== rightOrder.length) {
            failures.push(
              `${file}: key order differs at ${leftOrder[orderMismatch] ?? `length ${leftOrder.length} vs ${rightOrder.length}`}`,
            );
            continue;
          }
          const droppedNull = collectNullPaths(source).find(
            (nullPath) => !hasAtPath(reparsed, nullPath) || getAtPath(reparsed, nullPath) !== null,
          );
          if (droppedNull !== undefined) {
            failures.push(
              `${file}: explicit null at ${formatDocPath(droppedNull)} did not survive`,
            );
            continue;
          }
          const injected = QUEST_TEMPLATE_FIELDS.filter(
            (field) => !hasAtPath(source, [field]) && hasAtPath(reparsed, [field]),
          );
          if (injected.length > 0) {
            failures.push(`${file}: absent modelled keys were injected: ${injected.join(', ')}`);
            continue;
          }

          if (collectNullPaths(source).length > 0) {
            filesWithExplicitNulls += 1;
          }
          if (QUEST_TEMPLATE_FIELDS.some((field) => !hasAtPath(source, [field]))) {
            filesWithAbsentModelledKeys += 1;
          }
          roundTripped += 1;
        }

        const loud = failures.slice(0, 10).join('\n[p3-02 ac1]   ');
        console.log(
          `[p3-02 ac1] corpus path=${dir}\n` +
            `[p3-02 ac1] files discovered=${files.length} round-tripped=${roundTripped} failures=${failures.length} ` +
            `files with explicit nulls=${filesWithExplicitNulls} files with absent modelled keys=${filesWithAbsentModelledKeys}` +
            (failures.length === 0 ? '' : `\n[p3-02 ac1]   ${loud}`),
        );

        // The count is asserted against the discovery, never against a number: `ls | wc -l` is the
        // plan's own definition of the corpus size and it changes with the checkout.
        expect(roundTripped).toBe(files.length);
        expect(failures.join('\n')).toBe('');
      }
    });
  },
);

/* ------------------------------------------------------------- ac2 — the mutation primitives */

/**
 * One mutation per `$type`, as a set of a known field.
 *
 * Every field is the one the spec's own per-type list names ([spec-domain-reference.md] L316-334
 * for goals, L354-412 for results, L416-438 for requirements), and the value is a legal value for
 * that field so the edit is the kind of edit an editor really makes.
 */
const SET_CASES: Record<string, { field: string; value: unknown }> = {
  // goals (5, all measured in the corpus)
  WaypointGoalTemplate: { field: 'm_zoneTag', value: 'P3-02-ZONE' },
  PersonaGoalTemplate: { field: 'm_personaName', value: 'P3-02-PERSONA' },
  BountyGoalTemplate: { field: 'm_bountyTotal', value: 4242 },
  ScavengeGoalTemplate: { field: 'm_itemTotal', value: 4242 },
  AchieveRankGoalTemplate: { field: 'm_rank', value: 4242 },
  // results (12 of the 14 have a scalar field; ResAddHealth/ResAddMana have none — see APPEND_CASES)
  ResDropTable: { field: 'm_tableName', value: 'P3-02-TABLE' },
  ResModifyEntry: { field: 'm_value', value: 4242 },
  ResAddDynaMod: { field: 'm_dynaModClientTag', value: 'P3-02-TAG' },
  ResLearnSpell: { field: 'm_templateID', value: 4242 },
  ResPostEvent: { field: 'm_eventName', value: 'P3-02-EVENT' },
  ResAddSpell: { field: 'm_templateID', value: 4242 },
  ResDespawn: { field: 'm_spawnID', value: 4242 },
  ResDrawHand: { field: 'm_templateID', value: 4242 },
  ResGiveSpell: { field: 'm_spellID', value: 4242 },
  ResPlaySound: { field: 'm_soundName', value: 'P3-02-SOUND' },
  ResTeleport: { field: 'm_destinationLoc', value: 'P3-02-LOC' },
  ResWait: { field: 'm_secondsToWait', value: 4242 },
  // requirements (all 4 modelled, 3 leaves + the recursive wrapper)
  ReqHasQuest: { field: 'm_questName', value: 'P3-02-REQ-QUEST' },
  ReqHasEntry: { field: 'm_entryName', value: 'P3-02-REQ-ENTRY' },
  ReqSchoolOfFocus: { field: 'm_magicSchool', value: 'Ice' },
  RequirementList: { field: 'm_operator', value: 'ROP_OR' },
  // dialog
  NPCDialogEntry: { field: 'm_dialog', value: 'P3-02-DIALOG' },
  MadlibArgT_ByteString: { field: 'm_madlibToken', value: 'P3-02-TOKEN' },
};

/**
 * The three types whose own compiled field is a container, or which carry no field beyond `$type`:
 * the edit is the append the editor performs (Add Dialog Tag; Add Result). Appending at the tail
 * also keeps the "drop the mutated path from both documents" comparison exact — the path does not
 * exist in the source, so dropping it there is a no-op.
 */
const APPEND_CASES: Record<string, { field?: string; value: unknown }> = {
  ActorDialogList: {
    field: 'm_dialogs',
    value: { m_dialogTag: 'P3-02-TAG', m_dialogEntries: [], m_madlibs: [] },
  },
  ResAddHealth: { value: { $type: TYPE_STRINGS.ResAddHealth } },
  ResAddMana: { value: { $type: TYPE_STRINGS.ResAddMana } },
};

/** A different value of the same JSON kind — for a real corpus field whose value is whatever the game shipped. */
function probeValueFor(current: unknown): unknown {
  if (typeof current === 'number') {
    const next = current + 1;
    return next === current ? current - 1 : next;
  }
  if (typeof current === 'boolean') {
    return !current;
  }
  if (typeof current === 'string') {
    return `${current}-p3-02`;
  }
  return 'p3-02-probe';
}

/** The first scalar field of a node (never `$type` unless it is the only one). */
function firstScalarField(node: unknown): string | undefined {
  if (!isPlainObject(node)) {
    return undefined;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === '$type') {
      continue;
    }
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      return key;
    }
  }
  return Object.prototype.hasOwnProperty.call(node, '$type') ? '$type' : undefined;
}

interface PlannedEdit {
  edit: DocEdit;
  mutatedPath: DocPath;
  expected: unknown;
  kind: 'set' | 'insert';
  field: string;
  /** `true` when the node lacks the type's signature field and the case probed another field. */
  fallbackField: boolean;
}

/**
 * Builds the mutation for one `$type` from the tables above. Returns `undefined` when the document
 * does not contain the type at all (the caller reports that as uncovered coverage).
 *
 * A real corpus node may not carry its type's signature field (measured: 95 of the 100 Bounty goals
 * carry only `m_bountyTotal`), so the fallback keeps the edit type-appropriate by probing the first
 * scalar field's value instead of writing a value of the wrong kind.
 */
function buildCase(short: string, type: string, doc: JsonDocument): PlannedEdit | undefined {
  const nodePath = findFirstPathByType(doc, type);
  if (nodePath === undefined) {
    return undefined;
  }
  const node = getAtPath(doc, nodePath);
  const setCase = SET_CASES[short];
  if (setCase !== undefined) {
    const hasSignatureField =
      isPlainObject(node) && Object.prototype.hasOwnProperty.call(node, setCase.field);
    const field = hasSignatureField ? setCase.field : firstScalarField(node);
    if (field === undefined) {
      return undefined;
    }
    const mutatedPath: DocPath = [...nodePath, field];
    const expected = hasSignatureField ? setCase.value : probeValueFor(getAtPath(doc, mutatedPath));
    return {
      edit: { op: 'set', path: mutatedPath, value: expected },
      mutatedPath,
      expected,
      kind: 'set',
      field,
      fallbackField: !hasSignatureField,
    };
  }
  const appendCase = APPEND_CASES[short];
  if (appendCase !== undefined) {
    const arrayPath: DocPath =
      appendCase.field === undefined ? nodePath.slice(0, -1) : [...nodePath, appendCase.field];
    const array = getAtPath(doc, arrayPath);
    if (!Array.isArray(array)) {
      return undefined;
    }
    const index = array.length;
    return {
      edit: { op: 'insert', path: arrayPath, index, value: appendCase.value },
      mutatedPath: [...arrayPath, index],
      expected: appendCase.value,
      kind: 'insert',
      field: appendCase.field ?? `${formatDocPath(arrayPath)} (append)`,
      fallbackField: false,
    };
  }
  return undefined;
}

/**
 * Applies one case and asserts the two halves of ac2, printing the row of the report table:
 *
 * (a) the mutated path changed — it holds the intended value now and did not hold it before;
 * (b) everything else is deep-equal — dropping the mutated path from both documents leaves them
 *     identical, so an edit that touched a sibling is a failure, not a pass.
 */
function runCase(prefix: string, type: string, before: JsonDocument, origin = ''): string {
  const short = shortTypeName(type) ?? type;
  const plan = buildCase(short, type, before);
  if (plan === undefined) {
    throw new Error(`${short}: no planned mutation could be built for ${type}`);
  }
  const after = applyEdits(before, [plan.edit]);

  // (a) changed: the intended value is there, and was not there before.
  assertReported(
    `${short} (a) ${formatDocPath(plan.mutatedPath)}`,
    'changed to the intended value',
    isDeepStrictEqual(getAtPath(after, plan.mutatedPath), plan.expected)
      ? 'changed to the intended value'
      : `holds ${describeValue(getAtPath(after, plan.mutatedPath))}`,
  );
  const heldBefore =
    hasAtPath(before, plan.mutatedPath) &&
    isDeepStrictEqual(getAtPath(before, plan.mutatedPath), plan.expected);
  assertReported(
    `${short} (a) ${formatDocPath(plan.mutatedPath)}`,
    'did not hold that value before',
    heldBefore ? 'already held that value before the mutation' : 'did not hold that value before',
  );

  // (b) nothing else moved.
  assertReported(
    `${short} (b) ${formatDocPath(plan.mutatedPath)}`,
    'everything else deep-equal',
    everythingElseDetail(before, after, plan.mutatedPath) || 'everything else deep-equal',
  );

  const note = plan.fallbackField
    ? ` (the type's signature field ${SET_CASES[short]?.field ?? '?'} is absent on this node → probed ${plan.field})`
    : '';
  const line =
    `${short.padEnd(24)} ${plan.kind.padEnd(6)} ${formatDocPath(plan.mutatedPath).padEnd(46)} ` +
    `changed=✓ everything-else=✓${origin === '' ? '' : ` [${origin}]`}${note}`;
  console.log(`[${prefix}] ${line}`);
  return line;
}

/** The recorded `$type` strings a family table contributes (the corpus's own membership). */
function corpusTypesIn(table: Record<string, string>): string[] {
  const measured = new Set(MEASURED_TYPE_STRINGS);
  return Object.values(table).filter((type) => measured.has(type));
}

/* ------------------------------------------------------------------------ the sample quest */

/** A sample goal node: the shared keys a goal really has, plus the type's signature field. */
function sampleGoal(
  short: KnownTypeName,
  field: string,
  original: unknown,
): Record<string, unknown> {
  return {
    $type: TYPE_STRINGS[short],
    m_goalName: `SAMPLE-${short}`,
    m_goalType: 'GOAL_TYPE_USAGE',
    [field]: original,
  };
}

/** A sample result node: `$type` then the type's own fields. */
function sampleResult(
  short: KnownTypeName,
  field: string,
  original: unknown,
): Record<string, unknown> {
  return { $type: TYPE_STRINGS[short], [field]: original };
}

/** A sample requirement leaf: the two shared flags then the leaf's own fields. */
function sampleRequirement(
  short: KnownTypeName,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return { $type: TYPE_STRINGS[short], m_applyNOT: false, m_operator: 'ROP_AND', ...fields };
}

/**
 * A sample quest holding exactly one node of every `$type` the corpus measurement records — plus
 * the two D57 edge cases a real document has: `m_questTitle` is an explicit `null` and `m_questInfo`
 * is absent entirely. `m_personaName: null` on the dialog entry is the "an explicit null can still
 * be *edited* to a value" case.
 */
function buildSampleQuest(): Record<string, unknown> {
  return {
    m_questName: 'P3-02-SAMPLE',
    m_questTitle: null,
    m_questLevel: 1,
    m_startGoals: ['SAMPLE-WaypointGoalTemplate'],
    m_goals: [
      sampleGoal('WaypointGoalTemplate', 'm_zoneTag', 'SAMPLE_ZONE'),
      sampleGoal('PersonaGoalTemplate', 'm_personaName', 'SAMPLE_PERSONA'),
      sampleGoal('BountyGoalTemplate', 'm_bountyTotal', 10),
      sampleGoal('ScavengeGoalTemplate', 'm_itemTotal', 4),
      sampleGoal('AchieveRankGoalTemplate', 'm_rank', 2),
    ],
    m_startResults: {
      m_results: [
        sampleResult('ResDropTable', 'm_tableName', 'SAMPLE_TABLE'),
        sampleResult('ResModifyEntry', 'm_value', 1),
        sampleResult('ResAddDynaMod', 'm_dynaModClientTag', 'SAMPLE_TAG'),
        sampleResult('ResLearnSpell', 'm_templateID', 1001),
        sampleResult('ResPostEvent', 'm_eventName', 'SAMPLE_EVENT'),
        { $type: TYPE_STRINGS.ResAddHealth },
        { $type: TYPE_STRINGS.ResAddMana },
        sampleResult('ResAddSpell', 'm_templateID', 1002),
        sampleResult('ResDespawn', 'm_spawnID', 7),
        sampleResult('ResDrawHand', 'm_templateID', 1003),
        sampleResult('ResGiveSpell', 'm_spellID', 55),
        sampleResult('ResPlaySound', 'm_soundName', 'SAMPLE_SOUND'),
        sampleResult('ResTeleport', 'm_destinationLoc', 'SAMPLE_LOC'),
        sampleResult('ResWait', 'm_secondsToWait', 3),
      ],
    },
    m_requirements: {
      $type: REQUIREMENT_LIST_TYPE,
      m_applyNOT: false,
      m_operator: 'ROP_AND',
      m_requirements: [
        sampleRequirement('ReqHasQuest', { m_questName: 'SAMPLE_OTHER' }),
        sampleRequirement('ReqHasEntry', {
          m_questName: 'SAMPLE_OTHER',
          m_entryName: 'SAMPLE_ENTRY',
          m_displayName: null,
          m_isQuestRegistry: false,
        }),
        sampleRequirement('ReqSchoolOfFocus', { m_magicSchool: 'Fire' }),
      ],
    },
    m_dialogList: {
      $type: TYPE_STRINGS.ActorDialogList,
      // A dialog block carries no `$type` (measured: the six keys in all 739 corpus blocks).
      m_dialogs: [
        {
          m_dialogTag: 'Prep',
          m_dialogEntries: [
            { $type: TYPE_STRINGS.NPCDialogEntry, m_personaName: null, m_dialog: 'SAMPLE_DIALOG' },
          ],
          m_madlibs: [
            {
              m_index: 0,
              m_madlibBlock: {
                m_blockToken: 'SAMPLE_BLOCK',
                m_madlibs: [
                  { $type: TYPE_STRINGS.MadlibArgT_ByteString, m_madlibToken: 'SAMPLE_TOKEN' },
                ],
              },
            },
          ],
        },
      ],
    },
  };
}

/** The sample quest as the model sees a loaded file: canonical bytes, re-parsed. */
function sampleDocument(): JsonDocument {
  return loadDoc(JSON.parse(serializeDoc(buildSampleQuest())) as JsonDocument);
}

describe('p3-02 ac2 — edit-simulation: one mutation per corpus-measured type, everything else deep-equal', () => {
  it('covers every goal, requirement, result and dialog type the corpus recording lists', () => {
    const before = sampleDocument();
    const families: Record<string, string[]> = {
      goal: corpusTypesIn(GOAL_TYPES),
      result: corpusTypesIn(RESULT_TYPES),
      requirement: corpusTypesIn(REQUIREMENT_TYPES),
      dialog: corpusTypesIn(DIALOG_TYPES),
    };

    // The sample must contain every type the recording measured — the derivation that keeps CI
    // honest without the corpus on disk.
    const sampleTypes = collectTypeStrings(before);
    const absentFromSample = MEASURED_TYPE_STRINGS.filter((type) => !sampleTypes.has(type));
    assertReported(
      'sample quest',
      'contains every recorded $type',
      absentFromSample.length === 0
        ? 'contains every recorded $type'
        : `is missing ${absentFromSample.map((type) => shortTypeName(type) ?? type).join(', ')}`,
    );

    const planned = new Set([...Object.keys(SET_CASES), ...Object.keys(APPEND_CASES)]);
    const unplanned = MEASURED_TYPE_STRINGS.map((type) => shortTypeName(type) ?? type).filter(
      (short) => !planned.has(short),
    );
    assertReported(
      'mutation plans',
      'cover every recorded $type',
      unplanned.length === 0 ? 'cover every recorded $type' : `are missing ${unplanned.join(', ')}`,
    );

    const covered = new Set<string>();
    for (const type of MEASURED_TYPE_STRINGS) {
      runCase('p3-02 ac2', type, before);
      covered.add(type);
    }

    console.log(
      `[p3-02 ac2] sample quest: covered=${covered.size}/${MEASURED_TYPE_STRINGS.length} recorded $type strings ` +
        `(goals=${families.goal.length}, results=${families.result.length}, requirements=${families.requirement.length}, ` +
        `dialog=${families.dialog.length})`,
    );

    for (const [family, types] of Object.entries(families)) {
      const missing = types.filter((type) => !covered.has(type));
      assertReported(
        `${family} types`,
        `all ${types.length} covered`,
        missing.length === 0 ? `all ${types.length} covered` : `missing ${missing.join(', ')}`,
      );
    }
  });
});

describe.skipIf(!existsSync(CORPUS_DIR))(
  'p3-02 ac2 — the same mutations inside real corpus files (owner run)',
  () => {
    it('mutates one real node per corpus-measured type and moves nothing else', () => {
      const files = readdirSync(CORPUS_DIR)
        .filter((file) => file.endsWith('.json'))
        .sort();
      const located = new Map<string, { file: string; doc: JsonDocument }>();
      let scanned = 0;

      for (const file of files) {
        if (located.size === MEASURED_TYPE_STRINGS.length) {
          break;
        }
        scanned += 1;
        let parsed: unknown;
        try {
          parsed = JSON5.parse(readFileSync(path.join(CORPUS_DIR, file), 'utf8'));
        } catch (error) {
          throw new Error(`${file}: ${String(error)}`);
        }
        const doc = loadDoc(parsed);
        for (const type of MEASURED_TYPE_STRINGS) {
          if (!located.has(type) && findFirstPathByType(doc, type) !== undefined) {
            located.set(type, { file, doc });
          }
        }
      }

      const missing = MEASURED_TYPE_STRINGS.filter((type) => !located.has(type));
      assertReported(
        `real corpus ${CORPUS_DIR} (scanned ${scanned} of ${files.length} files)`,
        `located all ${MEASURED_TYPE_STRINGS.length} recorded $type strings`,
        missing.length === 0
          ? `located all ${MEASURED_TYPE_STRINGS.length} recorded $type strings`
          : `could not locate ${missing.map((type) => shortTypeName(type) ?? type).join(', ')}`,
      );

      for (const type of MEASURED_TYPE_STRINGS) {
        const entry = located.get(type);
        if (entry === undefined) {
          continue;
        }
        runCase('p3-02 ac2 real', type, entry.doc, path.basename(entry.file));
      }

      console.log(
        `[p3-02 ac2 real] corpus ${CORPUS_DIR}: scanned ${scanned} of ${files.length} files to locate ` +
          `all ${MEASURED_TYPE_STRINGS.length} recorded $type strings; every mutation is in memory ` +
          '(the harness has no write path).',
      );
    });
  },
);

/* --------------------------------------------- the harness must be able to fail (not vacuous) */

describe('p3-02 — the harness detects the failures it exists to catch', () => {
  const realQuest = () => loadDoc(JSON5.parse(fixtureBytes('quest_DS-ACAD-C01-003.json')));

  it('reports a mutation that touches an unintended sibling, by path', () => {
    const before = sampleDocument();
    const target: DocPath = [
      ...(findFirstPathByType(before, TYPE_STRINGS.BountyGoalTemplate) ?? []),
      'm_bountyTotal',
    ];
    const sibling: DocPath = [
      ...(findFirstPathByType(before, TYPE_STRINGS.BountyGoalTemplate) ?? []),
      'm_goalName',
    ];
    // Honest construction: two primitive edits, only the first of which was intended.
    const after = applyEdits(before, [
      { op: 'set', path: target, value: 4242 },
      { op: 'set', path: sibling, value: 'P3-02-TOUCHED-SIBLING' },
    ]);
    const detail = everythingElseDetail(before, after, target);
    expect(detail).not.toBe('');
    expect(detail).toContain('m_goalName');
    console.log(`[p3-02 falsification] sibling touch detected: ${detail}`);
  });

  it('reports a dropped explicit null, by path', () => {
    const source = realQuest();
    const rootNullKeys = Object.keys(source as object).filter(
      (key) => (source as Record<string, unknown>)[key] === null,
    );
    expect(rootNullKeys.length).toBeGreaterThan(0);
    const broken = JSON.parse(dropNullsBytes(source)) as JsonDocument;
    expect(isDeepStrictEqual(broken, source)).toBe(false);
    const detail = firstDiff(source, broken);
    expect(detail).not.toBeUndefined();
    expect(detail).toContain(rootNullKeys[0]);
    console.log(`[p3-02 falsification] dropped null detected: ${String(detail)}`);
  });

  it('reports a reordered key set that deep equality alone does not see', () => {
    const source = realQuest();
    const reordered = JSON.parse(sortKeysBytes(source)) as JsonDocument;
    // The point: value-only deep equality passes a reordering serializer.
    expect(isDeepStrictEqual(reordered, source)).toBe(true);
    expect(orderedKeyPaths(reordered)).not.toEqual(orderedKeyPaths(source));
    const detail = firstDiff(source, reordered);
    expect(detail).not.toBeUndefined();
    expect(detail).toContain('key order differs');
    console.log(`[p3-02 falsification] reordered keys detected: ${String(detail)}`);
  });

  it('does not report a difference when only the mutated path changed (positive control)', () => {
    const before = sampleDocument();
    const path: DocPath = [
      ...(findFirstPathByType(before, TYPE_STRINGS.BountyGoalTemplate) ?? []),
      'm_bountyTotal',
    ];
    const after = setAtPath(before, path, 4242);
    expect(everythingElseDetail(before, after, path)).toBe('');
  });
});

/* ------------------------------------------------------------------- the primitives themselves */

describe('p3-02 — the D5 mutation primitives', () => {
  it('never writes to the document it is given', () => {
    // A deep-frozen document turns any in-place write into a strict-mode TypeError, so freezing
    // every edit target proves the primitives copy instead of mutating.
    const frozen = deepFreeze(sampleDocument());
    for (const type of MEASURED_TYPE_STRINGS) {
      const short = shortTypeName(type) ?? type;
      const plan = buildCase(short, type, frozen);
      expect(plan).not.toBeUndefined();
      if (plan !== undefined) {
        expect(() => applyEdits(frozen, [plan.edit])).not.toThrow();
      }
    }
    const arrayPath: DocPath = ['m_startResults', 'm_results'];
    expect(() =>
      insertIntoArray(frozen, arrayPath, 0, { $type: TYPE_STRINGS.ResWait }),
    ).not.toThrow();
    expect(() => deleteAtPath(frozen, arrayPath)).not.toThrow();
  });

  it('keeps key order, explicit nulls and unknown keys when a field is set', () => {
    const before = sampleDocument();
    const path: DocPath = ['m_goals', 2, 'm_bountyTotal'];
    const after = setAtPath(before, path, 4242);
    expect(getAtPath(after, path)).toBe(4242);
    expect(Object.keys(after as object)).toEqual(Object.keys(before as object));
    expect(Object.keys(getAtPath(after, ['m_goals', 2]) as object)).toEqual(
      Object.keys(getAtPath(before, ['m_goals', 2]) as object),
    );
    expect(hasAtPath(after, ['m_questTitle'])).toBe(true);
    expect(getAtPath(after, ['m_questTitle'])).toBeNull();
    expect(hasAtPath(after, ['m_questInfo'])).toBe(false);
    expect(
      getAtPath(after, ['m_dialogList', 'm_dialogs', 0, 'm_dialogEntries', 0, 'm_personaName']),
    ).toBeNull();
  });

  it('refuses a path the document does not have, and names it', () => {
    const doc = sampleDocument();
    expect(() => getAtPath(doc, ['m_questInfo'])).toThrow(DocumentPathError);
    expect(() => getAtPath(doc, ['m_questInfo'])).toThrow(/m_questInfo does not exist/);
    expect(() => setAtPath(doc, ['m_questInfo', 'm_nested'], 1)).toThrow(/m_questInfo\.m_nested/);
    expect(() => deleteAtPath(doc, ['m_questInfo'])).toThrow(/m_questInfo/);
    expect(() => insertIntoArray(doc, ['m_questTitle'], 0, 'x')).toThrow(/not an array/);
    expect(() => loadDoc('not a document')).toThrow(TypeError);
  });

  it('loads a document by identity: the parsed original is the document', () => {
    const parsed = JSON5.parse(fixtureBytes('quest_null_stripped_pipeline.json')) as JsonDocument;
    expect(loadDoc(parsed)).toBe(parsed);
  });
});
