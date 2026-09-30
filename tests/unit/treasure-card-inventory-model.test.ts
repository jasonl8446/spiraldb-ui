import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import json5 from 'json5';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { applyEdits, serializeDoc } from '@shared/document';
import { objectTypeConfig } from '@shared/objectTypes';
import {
  addTreasureCardEdit,
  NEW_TREASURE_CARD_PRICE,
  newTreasureCardEntry,
  PRICE_ZERO_HINT,
  priceShowsBaseCostHint,
  readTreasureCards,
  removeTreasureCardEdit,
  TREASURE_CARD_ENTRY_KEYS,
  TREASURE_CARD_INVENTORY_CORPUS,
  TREASURE_CARD_INVENTORY_FIELDS,
  TREASURE_CARD_INVENTORY_KEY_FIELD,
  TREASURE_CARD_INVENTORY_LIST_KEY,
  TREASURE_CARD_NAME_SUFFIX,
  treasureCardFieldPath,
  treasureCardPriceEdit,
  treasureCardSpellNameEdit,
  validateTreasureCardInventory,
} from '@shared/simpleObjects';
import { fieldHasError } from '../../client/src/lib/validation-message';
import {
  toTreasureCardValidationMessages,
  treasureCardFindingField,
} from '../../client/src/lib/treasure-card-validation';
import { DEFAULT_SPIRALDB_PATH, MEMORY_DB, openDb, writeSettings, type Db } from '@server/db';
import { objectRuntimeFor, saveObjectEntry, type ObjectRuntime } from '@server/services/objects';
import { readSpiraldbJson } from '@server/services/spiraldbFiles';
import {
  commitSubjects,
  createTempGitRepo,
  removeTempGitRepo,
  repoFileExists,
  writeRepoFile,
  type TempRepo,
} from '../helpers/temp-git-repo';

/**
 * Story p4-05's model + save-path test — plan task 4.7, `TreasureCardInventory`
 * (docs/spec-domain-reference.md §"TreasureCardInventory") and the one warn-not-block rule
 * (§"General Validation").
 *
 * Three things are pinned here, and the third is the AC itself:
 *
 * 1. **The live sweep over the one real file.** `TreasureCardInventory/` holds exactly one
 *    `NpcTreasureCards_2019-A.json`, 71 entries of exactly `{SpellName, Price}`, prices in
 *    {100, 150, 200, 250}. The sweep **re-measures** every constant in
 *    `TREASURE_CARD_INVENTORY_CORPUS` and would fail the day a file changes — including the
 *    match finding: **0 of 71** names match `spells.name` literally and **71 of 71** match once
 *    the trailing `" TC"` is stripped. The second number is asserted as a *finding about the
 *    data*, never as behaviour: the engine's own arms below prove the suffix is **not**
 *    stripped.
 * 2. **The rule's severity.** One warning per offending row, `blocking` empty, `blocked`
 *    `false` (the literal type). No `Price` rule exists because the spec prints none.
 * 3. **The save arm.** A document whose 71 names all fail the match is still saved in-process
 *    into a throwaway `git init` repository (D17 — the fork and the clone are never written by
 *    a test): the entry is written, the legacy path is kept (D19), the key set is the
 *    document's own two keys plus each row's two, and nothing throws. That is AC#11's "Save
 *    succeeds" proven rather than asserted, on the server side, where a warning must not
 *    become a rejection.
 *
 * **D68**: nothing eager runs at collection time — the guards are `existsSync` booleans and
 * the corpus/DB are read inside the tests that need them. The skip is provable (and is proven
 * in the story's evidence) by running this file with `SPIRALDB_SIMPLE_OBJECTS_ROOT` pointed at
 * a path with no `TreasureCardInventory/`.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CORPUS_ROOT = process.env.SPIRALDB_SIMPLE_OBJECTS_ROOT ?? DEFAULT_SPIRALDB_PATH;
const DB_PATH = path.join(ROOT, 'data', 'spiraldb-ui.db');

/** The one corpus file, relative to a SpiralDB root. */
const CORPUS_REL = `TreasureCardInventory/${TREASURE_CARD_INVENTORY_CORPUS.legacyFileName}`;
const CORPUS_FILE = path.join(CORPUS_ROOT, CORPUS_REL);

// D68: booleans only — no readdir/readFile/DB handle at module scope.
const FORK_PRESENT = fs.existsSync(CORPUS_FILE);
const DB_PRESENT = fs.existsSync(DB_PATH);

if (!FORK_PRESENT) {
  console.log(
    `[p4-05 corpus] the live sweep was skipped — no ${CORPUS_REL} under ${CORPUS_ROOT} (CI has ` +
      'no sibling SpiralDB checkout, D40). The fixtures below carry every primitive.',
  );
}
if (!DB_PRESENT) {
  console.log(
    `[p4-05 names] the spells sweeps were skipped — no ${DB_PATH}. The reference-set semantics ` +
      'are still pinned by the fixtures.',
  );
}

const OPEN_DBS: Db[] = [];
const REPOS: TempRepo[] = [];

afterEach(() => {
  while (REPOS.length > 0) {
    const repo = REPOS.pop();
    if (repo !== undefined) {
      removeTempGitRepo(repo);
    }
  }
});

afterAll(() => {
  for (const db of OPEN_DBS) {
    db.close();
  }
  while (REPOS.length > 0) {
    const repo = REPOS.pop();
    if (repo !== undefined) {
      removeTempGitRepo(repo);
    }
  }
});

/* -------------------------------------------------------------------- fixtures */

/** The three fixture rows: a matching base name, the real suffix convention, a real miss. */
const SAMPLE_ENTRIES: readonly Record<string, unknown>[] = [
  { SpellName: 'Fire Shield', Price: 100 },
  { SpellName: 'Fire Cat', Price: 150 },
  { SpellName: 'Meteor Strike', Price: 250 },
];

/** The document the save arms write: `TemplateID` 38214, the real key. */
function sampleDocument(
  templateId = 38214,
  entries: readonly Record<string, unknown>[] = SAMPLE_ENTRIES,
): Record<string, unknown> {
  return { TemplateID: templateId, TreasureCards: entries.map((entry) => ({ ...entry })) };
}

/** The synced-name set a client page injects — the three fixture base names, nothing else. */
const SPELL_NAMES: ReadonlySet<string> = new Set(['Fire Shield', 'Fire Cat', 'Meteor Strike']);

/** Reads one corpus document as the server's own reader does (JSON5-tolerant, D5). */
function readCorpusDocument(file: string = CORPUS_FILE): Record<string, unknown> {
  return json5.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
}

interface Harness {
  repo: TempRepo;
  root: string;
  db: Db;
  runtime: ObjectRuntime;
}

/**
 * A throwaway repository holding the family's **legacy file** (copied from the real fork when
 * it is on disk, so the D19 update arm runs on the real content) plus one sibling family, so
 * the index scan is not trivially one directory.
 */
function harness(): Harness {
  const repo = createTempGitRepo('treasure-card-');
  REPOS.push(repo);

  const legacy = FORK_PRESENT
    ? fs.readFileSync(CORPUS_FILE, 'utf8')
    : JSON.stringify(readCorpusDocumentFixtureFallback(), null, 2);
  writeRepoFile(repo, CORPUS_REL, legacy);
  writeRepoFile(
    repo,
    'DropTables/droptables_wc-unicorn-main-007.json',
    '{"Name":"WC-UNICORN-MAIN-007"}',
  );
  repo.git(['add', '--all']);
  repo.git(['commit', '-m', 'measured legacy shapes']);

  const db = openDb({ file: MEMORY_DB });
  OPEN_DBS.push(db);
  writeSettings(db, { spiraldb_path: repo.dir, user_name: 'P4-05 Tester', git_branch: '' });

  const runtime = objectRuntimeFor(db, repo.dir);
  runtime.index.rebuild();
  return { repo, root: repo.dir, db, runtime };
}

/** The 2-entry fixture used when the fork is absent — never a substitute for the sweep. */
function readCorpusDocumentFixtureFallback(): Record<string, unknown> {
  return {
    TemplateID: 38214,
    TreasureCards: [
      { SpellName: 'Fire Shield TC', Price: 100 },
      { SpellName: 'Fire Cat TC', Price: 150 },
    ],
  };
}

const TREASURE_CARD_INVENTORY = objectTypeConfig('treasurecardinventory');

/** Saves one document through the generic pipeline and returns the result. */
function save(h: Harness, object: Record<string, unknown>): ReturnType<typeof saveObjectEntry> {
  return saveObjectEntry({
    db: h.db,
    config: TREASURE_CARD_INVENTORY,
    index: h.runtime.index,
    pipeline: h.runtime.pipeline,
    body: { object },
  });
}

/* ------------------------------------------------------------- the live corpus sweep */

describe.runIf(FORK_PRESENT)(
  'the live fork, re-measured (AC1\u2019s two facts: the shape and the literal match)',
  () => {
    it('holds exactly one legacy file with the schema\u2019s two keys and 71 two-key entries', () => {
      const dir = path.join(CORPUS_ROOT, 'TreasureCardInventory');
      const files = fs.readdirSync(dir).filter((file) => file.endsWith('.json'));
      expect(files).toEqual([TREASURE_CARD_INVENTORY_CORPUS.legacyFileName]);
      expect(files).toHaveLength(TREASURE_CARD_INVENTORY_CORPUS.files);

      const document = readCorpusDocument();
      expect(Object.keys(document)).toEqual([...TREASURE_CARD_INVENTORY_CORPUS.topLevelKeys]);
      expect(TREASURE_CARD_INVENTORY_CORPUS.topLevelKeys).toEqual(['TemplateID', 'TreasureCards']);
      expect(document.TemplateID).toBe(TREASURE_CARD_INVENTORY_CORPUS.templateId);
      expect(typeof document.TemplateID).toBe('number');

      const entries = document[TREASURE_CARD_INVENTORY_LIST_KEY] as Record<string, unknown>[];
      expect(entries).toHaveLength(TREASURE_CARD_INVENTORY_CORPUS.entries);
      const twoKey = entries.filter(
        (entry) =>
          JSON.stringify(Object.keys(entry)) === JSON.stringify([...TREASURE_CARD_ENTRY_KEYS]),
      );
      expect(twoKey).toHaveLength(TREASURE_CARD_INVENTORY_CORPUS.entriesWithBothKeys);

      const prices = entries.map((entry) => entry.Price);
      expect(prices.every((price) => typeof price === 'number')).toBe(true);
      expect([...new Set(prices)].sort((a, b) => (a as number) - (b as number))).toEqual([
        ...TREASURE_CARD_INVENTORY_CORPUS.prices,
      ]);
      expect(new Set(prices).size).toBe(TREASURE_CARD_INVENTORY_CORPUS.distinctPrices);
      expect(Math.min(...(prices as number[]))).toBe(TREASURE_CARD_INVENTORY_CORPUS.minPrice);
      expect(Math.max(...(prices as number[]))).toBe(TREASURE_CARD_INVENTORY_CORPUS.maxPrice);
      // The hint is fixture-only: no real price is 0.
      expect(prices.filter((price) => price === 0)).toHaveLength(
        TREASURE_CARD_INVENTORY_CORPUS.entriesWithPriceZero,
      );
      expect(
        entries.filter((entry) => typeof entry.Price === 'number' && entry.Price === 0),
      ).toHaveLength(0);
      expect(prices).toContain(TREASURE_CARD_INVENTORY_CORPUS.commonPrice);

      const names = entries.map((entry) => entry.SpellName);
      expect(names.every((name) => typeof name === 'string')).toBe(true);
      expect(names.filter((name) => typeof name !== 'string')).toHaveLength(
        TREASURE_CARD_INVENTORY_CORPUS.nonStringSpellNames,
      );
      expect(new Set(names).size).toBe(TREASURE_CARD_INVENTORY_CORPUS.distinctSpellNames);
      expect(
        names.filter((name) => (name as string).endsWith(TREASURE_CARD_NAME_SUFFIX)),
      ).toHaveLength(TREASURE_CARD_INVENTORY_CORPUS.entriesWithSuffix);
    });

    it.runIf(DB_PRESENT)(
      'matches 0 of 71 literally, 71 of 71 with the suffix stripped — the recorded finding',
      () => {
        // The hypothesis is asserted HERE, as a fact about the data, and nowhere as behaviour:
        // the engine arms below prove the editor does not strip the suffix.
        const db = new Database(DB_PATH, { readonly: true });
        try {
          const rows = db
            .prepare('SELECT name FROM spells')
            .all()
            .map((row) => (row as { name: string | null }).name);
          expect(rows).toHaveLength(TREASURE_CARD_INVENTORY_CORPUS.spellRows);
          expect(rows.filter((name) => name !== null && name.trim() !== '')).toHaveLength(
            TREASURE_CARD_INVENTORY_CORPUS.spellRows,
          );
          const names = new Set(rows.filter((name): name is string => name !== null));
          expect(names.size).toBe(TREASURE_CARD_INVENTORY_CORPUS.distinctSpellRows);
          expect(rows.filter((name) => name === null || name.trim() === '')).toHaveLength(
            TREASURE_CARD_INVENTORY_CORPUS.blankSpellNames,
          );
          // The uppercase substring the brief's count names; the case-insensitive number is the
          // measured `Catch of the Day` class, not a suffix convention.
          expect([...names].filter((name) => name.includes('TC'))).toHaveLength(
            TREASURE_CARD_INVENTORY_CORPUS.spellNamesContainingTC,
          );
          expect([...names].filter((name) => name.toLowerCase().includes('tc'))).toHaveLength(
            TREASURE_CARD_INVENTORY_CORPUS.distinctSpellNamesContainingTcCaseInsensitive,
          );
          // The briefed count is row-based; both numbers are recorded so neither is quoted for
          // the other (18,173 rows against 4,104 distinct names).
          expect(
            rows.filter((name) => name !== null && name.toLowerCase().includes('tc')),
          ).toHaveLength(TREASURE_CARD_INVENTORY_CORPUS.spellRowsContainingTcCaseInsensitive);
          expect(
            [...names].filter((name) => name.endsWith(TREASURE_CARD_NAME_SUFFIX)),
          ).toHaveLength(TREASURE_CARD_INVENTORY_CORPUS.spellNamesEndingWithSuffix);

          const entries = readCorpusDocument()[TREASURE_CARD_INVENTORY_LIST_KEY] as Record<
            string,
            unknown
          >[];
          const spellNames = entries.map((entry) => String(entry.SpellName));
          expect(spellNames.filter((name) => names.has(name))).toHaveLength(
            TREASURE_CARD_INVENTORY_CORPUS.literalMatches,
          );
          expect(
            spellNames.filter((name) =>
              names.has(
                name.endsWith(TREASURE_CARD_NAME_SUFFIX)
                  ? name.slice(0, -TREASURE_CARD_NAME_SUFFIX.length)
                  : name,
              ),
            ),
          ).toHaveLength(TREASURE_CARD_INVENTORY_CORPUS.suffixStrippedMatches);
          const lower = new Set([...names].map((name) => name.toLowerCase()));
          expect(spellNames.filter((name) => lower.has(name.toLowerCase()))).toHaveLength(
            TREASURE_CARD_INVENTORY_CORPUS.caseInsensitiveLiteralMatches,
          );

          // The AC's live consequence, in one line: with the real 4,104 names injected the real
          // 71-row file produces 71 warnings and nothing blocking, so Save stays enabled.
          const result = validateTreasureCardInventory(readCorpusDocument(), {
            spellNames: names,
          });
          expect(result.warnings).toHaveLength(TREASURE_CARD_INVENTORY_CORPUS.entries);
          expect(result.blocking).toEqual([]);
          expect(result.blocked).toBe(false);
          expect(result.referenceUsed).toBe(true);
        } finally {
          db.close();
        }
      },
    );

    it.runIf(DB_PRESENT)(
      'the engine never strips the suffix: the hypothesis is a finding, not a behaviour',
      () => {
        const db = new Database(DB_PATH, { readonly: true });
        try {
          const names = new Set(
            db
              .prepare('SELECT name FROM spells')
              .all()
              .map((row) => (row as { name: string }).name),
          );
          // Strip the suffix off the real file's rows and inject the SAME real table: with the
          // base spell names the document WOULD match 71 of 71 — and the engine still reports
          // them, because the match is the spec's literal one (D29: the detailed spec wins).
          const document = readCorpusDocument();
          const stripped: Record<string, unknown> = {
            ...document,
            [TREASURE_CARD_INVENTORY_LIST_KEY]: (
              document[TREASURE_CARD_INVENTORY_LIST_KEY] as Record<string, unknown>[]
            ).map((entry) => ({
              ...entry,
              SpellName: String(entry.SpellName).slice(0, -TREASURE_CARD_NAME_SUFFIX.length),
            })),
          };
          // The strip-only document matches: this is what makes the hypothesis real.
          expect(
            validateTreasureCardInventory(stripped, { spellNames: names }).warnings,
          ).toHaveLength(0);
          // The real document still warns — the suffix is not stripped by the editor.
          const real = validateTreasureCardInventory(document, { spellNames: names });
          expect(real.warnings).toHaveLength(TREASURE_CARD_INVENTORY_CORPUS.entries);
          expect(
            real.warnings.every((finding) => finding.kind === 'spell-name-not-in-spells'),
          ).toBe(true);
        } finally {
          db.close();
        }
      },
    );
  },
);

/* ------------------------------------------------------------------ the object repeater */

describe('readTreasureCards — the object-list reader', () => {
  it('returns rows in document order, each carrying its index in the document array', () => {
    const rows = readTreasureCards(sampleDocument());
    expect(rows.map((row) => row.index)).toEqual([0, 1, 2]);
    expect(rows.map((row) => row.entry.SpellName)).toEqual([
      'Fire Shield',
      'Fire Cat',
      'Meteor Strike',
    ]);
  });

  it('returns [] for every "no list here" shape, and skips a non-object element', () => {
    expect(readTreasureCards({})).toEqual([]);
    expect(readTreasureCards({ TreasureCards: null })).toEqual([]);
    expect(readTreasureCards({ TreasureCards: 'Fire Shield' })).toEqual([]);
    expect(readTreasureCards({ TreasureCards: { 0: {} } })).toEqual([]);
    expect(readTreasureCards({ TreasureCards: [] })).toEqual([]);
    expect(
      readTreasureCards({ TreasureCards: [{ SpellName: 'A', Price: 1 }, 7, null, 'x', ['y']] }).map(
        (row) => row.index,
      ),
    ).toEqual([0]);
  });
});

describe('the entry builders — index-addressed, verbatim values', () => {
  it('builds a new entry in the corpus\u2019s exact two-key order', () => {
    expect(Object.keys(newTreasureCardEntry('Fire Shield', 150))).toEqual([
      ...TREASURE_CARD_ENTRY_KEYS,
    ]);
    expect(newTreasureCardEntry('Fire Shield', 150)).toEqual({
      SpellName: 'Fire Shield',
      Price: 150,
    });
    // The default price is the corpus's most frequent one (36 of 71).
    expect(newTreasureCardEntry('Fire Cat')).toEqual({
      SpellName: 'Fire Cat',
      Price: NEW_TREASURE_CARD_PRICE,
    });
    expect(NEW_TREASURE_CARD_PRICE).toBe(TREASURE_CARD_INVENTORY_CORPUS.commonPrice);
  });

  it('appends with an insert when the key exists and a whole set when it does not', () => {
    const entry = newTreasureCardEntry('Fire Shield', 100);
    expect(addTreasureCardEdit(true, 3, entry)).toEqual({
      op: 'insert',
      path: ['TreasureCards'],
      index: 3,
      value: entry,
    });
    expect(addTreasureCardEdit(false, 0, entry)).toEqual({
      op: 'set',
      path: ['TreasureCards'],
      value: [entry],
    });

    const doc = { TemplateID: 1, TreasureCards: [{ SpellName: 'A', Price: 1 }] };
    const appended = applyEdits(doc, [addTreasureCardEdit(true, 1, entry)]) as Record<
      string,
      unknown
    >;
    expect(appended.TreasureCards).toEqual([{ SpellName: 'A', Price: 1 }, entry]);
    expect(doc.TreasureCards).toEqual([{ SpellName: 'A', Price: 1 }]);
  });

  it('removes exactly the clicked index, so a repeated name survives', () => {
    // A repeater can repeat a name: a value-based removal would collapse the duplicate.
    const doc = {
      TemplateID: 38214,
      TreasureCards: [
        { SpellName: 'Fire Shield', Price: 100 },
        { SpellName: 'Fire Cat', Price: 150 },
        { SpellName: 'Fire Shield', Price: 250 },
      ],
    };
    const afterLast = applyEdits(doc, [removeTreasureCardEdit(2)]) as Record<string, unknown>;
    expect(afterLast.TreasureCards).toEqual([
      { SpellName: 'Fire Shield', Price: 100 },
      { SpellName: 'Fire Cat', Price: 150 },
    ]);
    const afterFirst = applyEdits(doc, [removeTreasureCardEdit(0)]) as Record<string, unknown>;
    expect(afterFirst.TreasureCards).toEqual([
      { SpellName: 'Fire Cat', Price: 150 },
      { SpellName: 'Fire Shield', Price: 250 },
    ]);
    // The original document is never touched.
    expect((doc.TreasureCards as unknown[]).length).toBe(3);
    expect(removeTreasureCardEdit(0)).toEqual({ op: 'delete', path: ['TreasureCards', 0] });
  });

  it('writes a typed name verbatim — no trim, no case folding, no suffix handling', () => {
    expect(treasureCardSpellNameEdit(1, 'Fire Shield TC')).toEqual({
      op: 'set',
      path: treasureCardFieldPath(1, 'SpellName'),
      value: 'Fire Shield TC',
    });
    expect(treasureCardSpellNameEdit(0, ' Fire Shield ')).toEqual({
      op: 'set',
      path: treasureCardFieldPath(0, 'SpellName'),
      value: ' Fire Shield ',
    });
    expect(treasureCardSpellNameEdit(0, 'fire shield')).toEqual({
      op: 'set',
      path: treasureCardFieldPath(0, 'SpellName'),
      value: 'fire shield',
    });
    // An emptied box keeps the required key: '' is a present value that matches nothing.
    expect(treasureCardSpellNameEdit(2, '')).toEqual({
      op: 'set',
      path: treasureCardFieldPath(2, 'SpellName'),
      value: '',
    });
    // A non-string cannot come from a text input; it produces no edit.
    expect(treasureCardSpellNameEdit(0, 7)).toBeNull();
    expect(treasureCardSpellNameEdit(0, null)).toBeNull();
    expect(treasureCardSpellNameEdit(0, undefined)).toBeNull();
  });

  it('writes a finite price verbatim and 0 for an emptied box — never a deleted key', () => {
    expect(treasureCardPriceEdit(0, '150')).toEqual({
      op: 'set',
      path: treasureCardFieldPath(0, 'Price'),
      value: 150,
    });
    expect(treasureCardPriceEdit(0, '0')).toEqual({
      op: 'set',
      path: treasureCardFieldPath(0, 'Price'),
      value: 0,
    });
    // Emptying the box writes the schema's own 0 (the value the hint labels), not a deletion:
    // the two-key entry shape is 71 of 71.
    expect(treasureCardPriceEdit(1, '')).toEqual({
      op: 'set',
      path: treasureCardFieldPath(1, 'Price'),
      value: 0,
    });
    expect(treasureCardPriceEdit(1, '   ')).toEqual({
      op: 'set',
      path: treasureCardFieldPath(1, 'Price'),
      value: 0,
    });
    // No invented range: the spec prints no bound for Price, so nothing is clamped.
    expect(treasureCardPriceEdit(0, '-5')).toEqual({
      op: 'set',
      path: treasureCardFieldPath(0, 'Price'),
      value: -5,
    });
    // A value that is not a finite number writes nothing rather than a NaN.
    expect(treasureCardPriceEdit(0, '1e')).toBeNull();
    expect(treasureCardPriceEdit(0, '-')).toBeNull();
  });

  it('labels the Price 0 hint only for exactly 0 (fixture-only in this corpus)', () => {
    expect(priceShowsBaseCostHint(0)).toBe(true);
    expect(priceShowsBaseCostHint(100)).toBe(false);
    expect(priceShowsBaseCostHint('0')).toBe(false);
    expect(priceShowsBaseCostHint(null)).toBe(false);
    expect(priceShowsBaseCostHint(undefined)).toBe(false);
    // The hint names the schema's own formula, and the corpus never carries a 0 to show it on.
    expect(PRICE_ZERO_HINT).toContain('m_baseCost');
    expect(TREASURE_CARD_INVENTORY_CORPUS.entriesWithPriceZero).toBe(0);
  });
});

/* ------------------------------------------------------------------------- the rule */

describe('validateTreasureCardInventory — the literal match, as a warning', () => {
  it('warns for a name the synced spells do not carry, and blocks nothing', () => {
    const document = sampleDocument(38214, [
      { SpellName: 'Fire Shield', Price: 100 },
      { SpellName: 'Meteor Strike TC', Price: 150 },
    ]);
    const result = validateTreasureCardInventory(document, { spellNames: SPELL_NAMES });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      kind: 'spell-name-not-in-spells',
      severity: 'warning',
      path: ['TreasureCards', 1, 'SpellName'],
      value: 'Meteor Strike TC',
      index: 1,
    });
    // The AC's other arm: a warning is NOT a blocker, by construction.
    expect(result.blocking).toEqual([]);
    expect(result.blocked).toBe(false);
    expect(result.warnings).toBe(result.findings);
    expect(result.referenceUsed).toBe(true);
  });

  it('does not strip the " TC" suffix, does not fold case, and does not fuzz', () => {
    const document = sampleDocument(38214, [
      // The base name matches; the real file's variant spelling does not — literal, exact.
      { SpellName: 'Fire Shield', Price: 100 },
      { SpellName: 'Fire Shield TC', Price: 100 },
      { SpellName: 'fire shield', Price: 100 },
      { SpellName: '  Fire Shield', Price: 100 },
      { SpellName: 'Fire  Shield', Price: 100 },
    ]);
    const findings = validateTreasureCardInventory(document, { spellNames: SPELL_NAMES }).findings;
    expect(findings.map((finding) => finding.index)).toEqual([1, 2, 3, 4]);
    expect(findings.map((finding) => finding.value)).toEqual([
      'Fire Shield TC',
      'fire shield',
      '  Fire Shield',
      'Fire  Shield',
    ]);
  });

  it('reports a present-but-not-a-name value, and skips an absent or null one', () => {
    const document = sampleDocument(38214, [
      { SpellName: '', Price: 0 },
      { Price: 100 },
      { SpellName: null, Price: 100 },
      { SpellName: 42, Price: 100 },
    ]);
    const findings = validateTreasureCardInventory(document, { spellNames: SPELL_NAMES }).findings;
    // '' and 42 are present and match nothing; the absent and the null key produce no finding
    // (the editor's absent-field contract — a rule must not invent a key the document lacks).
    expect(findings.map((finding) => finding.index)).toEqual([0, 3]);
    expect(findings.map((finding) => finding.value)).toEqual(['', 42]);
  });

  it('skips the rule entirely when the injected reference set is absent or empty (D65(c))', () => {
    const document = sampleDocument();
    for (const options of [{}, { spellNames: undefined }, { spellNames: new Set<string>() }]) {
      const result = validateTreasureCardInventory(document, options);
      expect(result.findings).toEqual([]);
      expect(result.blocking).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.blocked).toBe(false);
      // The flag says why: this side had no reference table, so nothing was checked — an
      // unimported names table must not flood a real file with false warnings (D44).
      expect(result.referenceUsed).toBe(false);
    }
  });

  it('ignores a non-array / non-object list without throwing', () => {
    expect(
      validateTreasureCardInventory({ TreasureCards: 'x' }, { spellNames: SPELL_NAMES }).findings,
    ).toEqual([]);
    expect(
      validateTreasureCardInventory(
        { TreasureCards: [{ SpellName: 'Fire Shield TC', Price: 1 }, 5] },
        { spellNames: SPELL_NAMES },
      ).findings,
    ).toHaveLength(1);
  });

  it('names the exact row path a form places its message under', () => {
    const document = sampleDocument(38214, [
      { SpellName: 'Fire Shield', Price: 1 },
      { SpellName: 'Nope', Price: 1 },
    ]);
    const [finding] = validateTreasureCardInventory(document, { spellNames: SPELL_NAMES }).findings;
    expect(finding.path).toEqual(['TreasureCards', 1, 'SpellName']);
    expect(treasureCardFieldPath(1, 'SpellName')).toEqual(['TreasureCards', 1, 'SpellName']);
  });
});

/* -------------------------------------------------------- the Save gate, both arms */

describe('the Save gate: this family warns, and the gate still blocks an error', () => {
  it('emits no error-severity message for any document, so nothing here can disable Save', () => {
    // The AC's converse arm, stated as data: whatever a *blocking* rule would be, this family
    // has none — the schema prints no bound for Price and no non-emptiness rule for SpellName,
    // so inventing one is exactly what the story must not do. The gate itself is unchanged.
    const documents: Record<string, unknown>[] = [
      sampleDocument(),
      sampleDocument(38214, [{ SpellName: '', Price: -1 }]),
      { TemplateID: 38214, TreasureCards: [] },
      {},
    ];
    for (const document of documents) {
      const messages = toTreasureCardValidationMessages(
        validateTreasureCardInventory(document, { spellNames: SPELL_NAMES }),
      );
      expect(messages.filter((message) => message.severity === 'error')).toEqual([]);
    }
  });

  it('leaves the shared `fieldHasError` gate working: an error still blocks', () => {
    // The mechanism the family relies on is not neutered — `fieldHasError` is the one predicate
    // `ObjectDetailPage` disables Save with, and it is true for an error and false for the
    // warning-only list this engine produces. A future blocking rule for this family would land
    // on that gate without touching the renderer.
    expect(
      fieldHasError([
        { severity: 'error', kind: 'x', path: ['Price'], field: 'Price', text: 'blocks' },
      ]),
    ).toBe(true);
    expect(
      fieldHasError(
        toTreasureCardValidationMessages(
          // A document whose every row fails the match, priced 0 and negative: no error.
          validateTreasureCardInventory(
            sampleDocument(38214, [
              { SpellName: 'Nope TC', Price: 0 },
              { SpellName: 'Nope Too', Price: -5 },
            ]),
            { spellNames: SPELL_NAMES },
          ),
        ),
      ),
    ).toBe(false);
    // The row-level path the form places the message under is the shared formatter's.
    expect(
      treasureCardFindingField({
        kind: 'spell-name-not-in-spells',
        severity: 'warning',
        path: ['TreasureCards', 2, 'SpellName'],
        value: 'x',
        index: 2,
        detail: '',
      }),
    ).toBe('TreasureCards[2].SpellName');
  });
});

/* -------------------------------------------------------------- the field inventory */

describe('the field inventory agrees with the schema and the corpus reality', () => {
  it('names exactly the schema\u2019s two keys, in the file\u2019s order', () => {
    expect(TREASURE_CARD_INVENTORY_FIELDS.map((field) => field.key)).toEqual([
      ...TREASURE_CARD_INVENTORY_CORPUS.topLevelKeys,
    ]);
    expect(TREASURE_CARD_INVENTORY_KEY_FIELD).toBe('TemplateID');
    expect(TREASURE_CARD_INVENTORY_LIST_KEY).toBe('TreasureCards');
    expect(TREASURE_CARD_ENTRY_KEYS).toEqual(['SpellName', 'Price']);
  });

  it('is the client form and the server route\u2019s own row: ulong key, no audit, TreasureCardInventory/', () => {
    expect(TREASURE_CARD_INVENTORY.fileType).toBe('treasurecardinventory');
    expect(TREASURE_CARD_INVENTORY.urlPath).toBe('/api/treasure-card-inventories');
    expect(TREASURE_CARD_INVENTORY.directory).toBe('TreasureCardInventory');
    expect(TREASURE_CARD_INVENTORY.keyField).toBe(TREASURE_CARD_INVENTORY_KEY_FIELD);
    expect(TREASURE_CARD_INVENTORY.keyType).toBe('ulong');
    expect(TREASURE_CARD_INVENTORY.objectType).toBe('treasure_card_inventory');
    expect(TREASURE_CARD_INVENTORY.routeType).toBe('treasure_card_inventories');
    // D69(b): no audit quartet, so the form is exactly the two controls the AC names.
    expect(TREASURE_CARD_INVENTORY.audit).toBe('none');
  });

  it('declares the NPC select and the one object repeater, both present in the one file', () => {
    for (const field of TREASURE_CARD_INVENTORY_FIELDS) {
      expect(field.required).toBe(true);
      expect(field.corpusPresence).toBe(TREASURE_CARD_INVENTORY_CORPUS.files);
    }
    expect(TREASURE_CARD_INVENTORY_FIELDS.map((field) => field.kind)).toEqual([
      'npc-select',
      'treasure-card-list',
    ]);
    expect(TREASURE_CARD_INVENTORY_FIELDS.map((field) => field.namesType)).toEqual([
      'npcs',
      undefined,
    ]);
  });

  it('records the measured match constants rather than deriving them at runtime', () => {
    expect(TREASURE_CARD_INVENTORY_CORPUS.literalMatches).toBe(0);
    expect(TREASURE_CARD_INVENTORY_CORPUS.suffixStrippedMatches).toBe(71);
    expect(TREASURE_CARD_INVENTORY_CORPUS.entriesWithSuffix).toBe(71);
    expect(TREASURE_CARD_INVENTORY_CORPUS.suffix).toBe(TREASURE_CARD_NAME_SUFFIX);
    expect(TREASURE_CARD_INVENTORY_CORPUS.entries).toBe(71);
    expect(TREASURE_CARD_INVENTORY_CORPUS.statusRows).toBe(1);
  });
});

/* ------------------------------------------ document preservation and the save arm */

describe('the document-preservation contract on the real file (D57/D58)', () => {
  it.runIf(FORK_PRESENT)(
    'a no-op edit leaves the document byte-identical with the same key set',
    () => {
      const original = readCorpusDocument();
      const before = serializeDoc(original);

      // No edits at all, and two edits that set a value to the value it already carries.
      const paths: Array<[number, string]> = [
        [0, 'SpellName'],
        [70, 'Price'],
      ];
      const noop = applyEdits(
        original,
        paths.map(([index, key]) => ({
          op: 'set' as const,
          path: treasureCardFieldPath(index, key),
          value: (original[TREASURE_CARD_INVENTORY_LIST_KEY] as Record<string, unknown>[])[index][
            key
          ],
        })),
      );
      expect(serializeDoc(applyEdits(original, []))).toBe(before);
      expect(serializeDoc(noop)).toBe(before);

      // The key set is the document's own: two top-level keys and two per row, nothing added.
      const restored = noop as Record<string, unknown>;
      expect(Object.keys(restored)).toEqual([...TREASURE_CARD_INVENTORY_CORPUS.topLevelKeys]);
      const entries = restored[TREASURE_CARD_INVENTORY_LIST_KEY] as Record<string, unknown>[];
      expect(entries).toHaveLength(TREASURE_CARD_INVENTORY_CORPUS.entries);
      for (const entry of entries) {
        expect(Object.keys(entry)).toEqual([...TREASURE_CARD_ENTRY_KEYS]);
      }
    },
  );

  it.runIf(FORK_PRESENT)(
    'saves the unmodified real document back to its legacy path, keeping the key set (D19)',
    async () => {
      const h = harness();
      const file = path.join(h.root, CORPUS_REL);
      const source = readCorpusDocument(file);

      const result = await save(h, source);

      // The update lands on the legacy file, never on a convention-derived name (D19).
      expect(result.outcome).toBe('updated');
      expect(result.action).toBe('update');
      expect(result.file).toBe(CORPUS_REL);
      expect(repoFileExists(h.repo, CORPUS_REL)).toBe(true);
      expect(fs.readdirSync(path.join(h.root, 'TreasureCardInventory'))).toEqual([
        TREASURE_CARD_INVENTORY_CORPUS.legacyFileName,
      ]);
      expect(commitSubjects(h.repo)[0]).toBe('spiraldb: update treasure_card_inventory 38214');

      const written = readSpiraldbJson(file) as Record<string, unknown>;
      expect(written).toEqual(source);
      expect(Object.keys(written)).toEqual([...TREASURE_CARD_INVENTORY_CORPUS.topLevelKeys]);
      const entries = written[TREASURE_CARD_INVENTORY_LIST_KEY] as Record<string, unknown>[];
      expect(entries).toHaveLength(TREASURE_CARD_INVENTORY_CORPUS.entries);
      expect(entries[0]).toEqual({ SpellName: 'Fire Shield TC', Price: 100 });
    },
  );

  it.runIf(FORK_PRESENT)(
    'saves a document whose every SpellName fails the match — the warning is not a rejection',
    async () => {
      const h = harness();
      const file = path.join(h.root, CORPUS_REL);
      const source = readCorpusDocument(file);
      // The live rule's own verdict: 71 warnings, nothing blocking.
      const names = new Set(['Fire Shield', 'Fire Cat']);
      const verdict = validateTreasureCardInventory(source, { spellNames: names });
      expect(verdict.warnings).toHaveLength(71);
      expect(verdict.blocked).toBe(false);

      // The save path carries no claim about a warning and rejects nothing: no throw, an
      // `updated` outcome, and the offending values written verbatim.
      const result = await save(h, source);
      expect(result.outcome).toBe('updated');
      expect(result.warnings).toEqual([]);
      const written = readSpiraldbJson(file) as Record<string, unknown>;
      expect(
        (written[TREASURE_CARD_INVENTORY_LIST_KEY] as Record<string, unknown>[])[0].SpellName,
      ).toBe('Fire Shield TC');
    },
  );
});

describe('the save path: a fixture document with an unmatched name', () => {
  it('creates the entry and writes exactly the document\u2019s two keys and each row\u2019s two', async () => {
    const h = harness();
    const document = sampleDocument(4242, [
      { SpellName: 'Fire Shield', Price: 100 },
      // A name no synced spell carries — the AC's case, and the save still succeeds.
      { SpellName: 'Nope TC', Price: 0 },
    ]);
    expect(
      validateTreasureCardInventory(document, { spellNames: SPELL_NAMES }).warnings,
    ).toHaveLength(1);

    const result = await save(h, document);

    expect(result).toMatchObject({
      key: '4242',
      file_type: 'treasurecardinventory',
      object_type: 'treasure_card_inventory',
      outcome: 'created',
      action: 'create',
      commit_message: 'spiraldb: create treasure_card_inventory 4242',
    });
    expect(result.file).toBe('TreasureCardInventory/treasurecardinventory_4242.json');
    const written = readSpiraldbJson(path.join(h.root, result.file)) as Record<string, unknown>;
    expect(Object.keys(written)).toEqual([...TREASURE_CARD_INVENTORY_CORPUS.topLevelKeys]);
    expect(written.TemplateID).toBe(4242);
    const entries = written[TREASURE_CARD_INVENTORY_LIST_KEY] as Record<string, unknown>[];
    expect(entries).toEqual([
      { SpellName: 'Fire Shield', Price: 100 },
      { SpellName: 'Nope TC', Price: 0 },
    ]);
    for (const entry of entries) {
      expect(Object.keys(entry)).toEqual([...TREASURE_CARD_ENTRY_KEYS]);
    }
    // The 0 the AC's hint is about round-trips as a number, fixture-only.
    expect(entries[1].Price).toBe(0);
    expect(commitSubjects(h.repo)[0]).toBe('spiraldb: create treasure_card_inventory 4242');
  });
});
