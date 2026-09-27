import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import json5 from 'json5';
import { describe, expect, it } from 'vitest';

import { serializeDoc, type JsonDocument } from '@shared/document';
import {
  canonicalItemId,
  DROP_TABLE_AUDIT_KEYS,
  DROP_TABLE_CORPUS,
  DROP_TABLE_FIELDS,
  DROP_TABLE_ITEM_FIELDS,
  dropTableFieldSpec,
  itemIdLookupValue,
  otherDropTableNames,
} from '@shared/dropTable/model';
import {
  validateDropTable,
  type DropTableFinding,
  type DropTableFindingKind,
} from '@shared/dropTable/validation';
import {
  dropTableBlockingSummary,
  dropTableFieldErrorMap,
  dropTableFindingField,
  dropTableFindingMessage,
  dropTableKindLabel,
} from '@shared/dropTable/validation-messages';
import { DEFAULT_SPIRALDB_PATH } from '@server/db';

/**
 * Story p4-02's model + rules test — plan task 4.2, docs/spec-domain-reference.md L77-91 and
 * L536-540.
 *
 * Two arms, mirroring `tests/unit/quest-validation.test.ts`'s shape:
 *
 * 1. **The real corpus sweep** (owner run; skipped with a printed reason when the checkout or
 *    the synced database is absent, which is CI's state — D40). It asserts the *measured*
 *    numbers, so a rule that fires on real data, or a field table that starts padding keys,
 *    fails here: **317** files, **0** findings of all four rules, 317 distinct non-empty
 *    names, `GrantsPotionSlot` in **35** files, the audit quartet in **316**, **72** item
 *    rows with exactly the four measured keys, **65** requirement leaves, and all **72**
 *    `ItemId` values JSON strings of which **64** resolve numerically in `items` (0 as raw
 *    strings — the string↔number trap this story exists to get right).
 * 2. **Fixture cases** for every rule and for the conversion helpers, which is the only way
 *    the rules are ever exercised (their corpus count is zero) and the only way the eight
 *    genuinely-unresolvable ids are pinned without the live table.
 *
 * Purity is asserted, not assumed: the sweep serializes every document before and after
 * validation and requires the bytes to be identical.
 *
 * **D68**: nothing eager runs at collection time. The two guards below are `existsSync`
 * booleans only; the corpus and the database are read inside the tests that need them.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CORPUS_DIR =
  process.env.SPIRALDB_DROP_TABLE_CORPUS ?? path.join(DEFAULT_SPIRALDB_PATH, 'DropTables');
const DB_PATH = path.join(ROOT, 'data', 'spiraldb-ui.db');

// D68: booleans only — no readdir/readFile/DB handle at module scope.
const CORPUS_PRESENT = existsSync(CORPUS_DIR);
const DB_PRESENT = existsSync(DB_PATH);

if (!CORPUS_PRESENT) {
  console.log(
    `[p4-02 corpus] live DropTable sweep skipped — corpus absent at ${CORPUS_DIR} ` +
      '(CI has no sibling SpiralDB checkout, D40). The fixture cases below carry every rule.',
  );
}
if (!DB_PRESENT) {
  console.log(
    `[p4-02 corpus] synced-database check skipped — no ${DB_PATH}. The string↔number ` +
      'conversion is still pinned by fixtures.',
  );
}

/** Every `DropTables/*.json` of the checkout, parsed. Called only inside tests (D68). */
function loadCorpus(): Array<{ file: string; doc: Record<string, unknown> }> {
  return readdirSync(CORPUS_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => ({
      file,
      doc: json5.parse(readFileSync(path.join(CORPUS_DIR, file), 'utf8')) as Record<
        string,
        unknown
      >,
    }));
}

/** The findings of one kind. */
function ofKind(findings: readonly DropTableFinding[], kind: DropTableFindingKind) {
  return findings.filter((finding) => finding.kind === kind);
}

/* ------------------------------------------------------------------- fixtures */

/** A minimal document that passes every rule — the shape a new entry starts from. */
function validDocument(): Record<string, unknown> {
  return {
    Name: 'DS-ACAD1-C01-001',
    Description: '',
    RollChance: 1.0,
    Weight: 100,
    NoneChance: 0.0,
    PityCounter: 0.0,
    MinGold: 10,
    MaxGold: 100,
    ExperienceAmount: 0,
    TrainingPoints: 0,
    GrantsPotionSlot: false,
    Items: [],
  };
}

describe('the four blocking rules (L536-540)', () => {
  it('an untouched corpus-shaped document passes', () => {
    const result = validateDropTable(validDocument(), { otherNames: new Set(['OTHER']) });
    expect(result.findings).toEqual([]);
    expect(result.blocked).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it('AC1 negative 1: an empty Name is a blocking finding at Name', () => {
    const result = validateDropTable({ ...validDocument(), Name: '' });
    expect(result.blocked).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      kind: 'drop-table-name-missing',
      severity: 'error',
      path: ['Name'],
      value: '',
    });
  });

  it('a missing or non-string Name is the same finding, and never doubles with the duplicate rule', () => {
    for (const name of [undefined, null, 7, '   ']) {
      const doc = validDocument();
      if (name === undefined) {
        delete doc.Name;
      } else {
        doc.Name = name;
      }
      const result = validateDropTable(doc, { otherNames: new Set(['', 'X']) });
      expect(ofKind(result.findings, 'drop-table-name-missing')).toHaveLength(1);
      expect(ofKind(result.findings, 'drop-table-name-duplicate')).toHaveLength(0);
    }
  });

  it('AC1 negative 2: a Name another drop table carries is a blocking duplicate', () => {
    const result = validateDropTable(validDocument(), {
      otherNames: otherDropTableNames(['DS-ACAD1-C01-001', 'SOMETHING-ELSE'], 'SOMETHING-ELSE'),
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      kind: 'drop-table-name-duplicate',
      path: ['Name'],
      value: 'DS-ACAD1-C01-001',
    });
  });

  it('the entry being saved is forgiven its own name — an unmodified save never collides with itself', () => {
    const result = validateDropTable(validDocument(), {
      otherNames: otherDropTableNames(['DS-ACAD1-C01-001', 'OTHER'], 'DS-ACAD1-C01-001'),
    });
    expect(result.findings).toEqual([]);
  });

  it('no injected corpus disables the duplicate rule instead of reporting every name', () => {
    const result = validateDropTable(validDocument());
    expect(result.findings).toEqual([]);
  });

  it('AC1 negative 3: RollChance 1.5 is a blocking finding at RollChance', () => {
    const result = validateDropTable({ ...validDocument(), RollChance: 1.5 });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      kind: 'roll-chance-out-of-range',
      path: ['RollChance'],
      value: 1.5,
    });
  });

  it('AC1 negative 4: NoneChance -0.1 is a blocking finding at NoneChance', () => {
    const result = validateDropTable({ ...validDocument(), NoneChance: -0.1 });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      kind: 'none-chance-out-of-range',
      path: ['NoneChance'],
      value: -0.1,
    });
  });

  it('AC1 negative 5: MinGold 100 + MaxGold 10 is one blocking finding at MaxGold', () => {
    const result = validateDropTable({ ...validDocument(), MinGold: 100, MaxGold: 10 });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      kind: 'gold-range-inverted',
      path: ['MaxGold'],
      value: 10,
      minGold: 100,
      maxGold: 10,
    });
  });

  it('boundary values pass: 0 and 1 are in range, MinGold == MaxGold is not inverted', () => {
    expect(
      validateDropTable({ ...validDocument(), RollChance: 0, NoneChance: 1 }).findings,
    ).toEqual([]);
    expect(validateDropTable({ ...validDocument(), MinGold: 50, MaxGold: 50 }).findings).toEqual(
      [],
    );
  });

  it('a non-numeric chance (or a JSON null) is out of range, but an ABSENT key is not a finding (D57)', () => {
    expect(
      ofKind(
        validateDropTable({ ...validDocument(), RollChance: '1.5' }).findings,
        'roll-chance-out-of-range',
      ),
    ).toHaveLength(1);
    expect(
      ofKind(
        validateDropTable({ ...validDocument(), NoneChance: null }).findings,
        'none-chance-out-of-range',
      ),
    ).toHaveLength(1);

    const absent = validDocument();
    delete absent.RollChance;
    delete absent.NoneChance;
    delete absent.MinGold;
    delete absent.MaxGold;
    delete absent.GrantsPotionSlot;
    expect(validateDropTable(absent).findings).toEqual([]);
  });

  it('a document that is not an object is the missing-name case, never a throw', () => {
    for (const value of [null, 3, 'x', []]) {
      const result = validateDropTable(value);
      expect(result.blocked).toBe(true);
      expect(ofKind(result.findings, 'drop-table-name-missing')).toHaveLength(1);
    }
  });

  it('validation mutates nothing: the bytes before and after are identical (D57)', () => {
    const doc = { ...validDocument(), Name: '', RollChance: 1.5, MinGold: 100, MaxGold: 10 };
    const before = serializeDoc(doc as JsonDocument);
    validateDropTable(doc, { otherNames: new Set(['x']) });
    expect(serializeDoc(doc as JsonDocument)).toBe(before);
  });

  it('one finding per rule, so a fully-bad document reports four errors and three kinds', () => {
    const result = validateDropTable(
      { ...validDocument(), Name: '', RollChance: 2, NoneChance: -1, MinGold: 100, MaxGold: 10 },
      { otherNames: new Set<string>() },
    );
    expect(result.findings).toHaveLength(4);
    expect(new Set(result.findings.map((finding) => finding.kind)).size).toBe(4);
    expect(result.blocked).toBe(true);
  });
});

describe('the field inventory is the spec table (L77-91) with its defaults', () => {
  it('carries the 11 keys every corpus file has, plus GrantsPotionSlot and the audit quartet', () => {
    const keys = DROP_TABLE_FIELDS.map((field) => field.key);
    expect(keys).toEqual([
      'Name',
      'Description',
      'RollChance',
      'Weight',
      'NoneChance',
      'PityCounter',
      'MinGold',
      'MaxGold',
      'ExperienceAmount',
      'TrainingPoints',
      'GrantsPotionSlot',
      'Items',
      'CreatedAt',
      'ModifiedAt',
      'CreatedBy',
      'ModifiedBy',
    ]);
    // The sweep's own known-key set is derived from this list, so it is the same 16.
    expect([...new Set(keys)].sort()).toEqual([...keys].sort());
  });

  it('prints the documented default for every scalar field', () => {
    const defaults = Object.fromEntries(
      DROP_TABLE_FIELDS.map((field) => [field.key, field.defaultValue]),
    );
    expect(defaults).toMatchObject({
      Name: '',
      Description: '',
      RollChance: 1.0,
      Weight: 100,
      NoneChance: 0.0,
      PityCounter: 0.0,
      MinGold: 0,
      MaxGold: 0,
      ExperienceAmount: 0,
      TrainingPoints: 0,
      GrantsPotionSlot: false,
    });
    expect(Array.isArray(defaults.Items)).toBe(true);
    expect((defaults.Items as readonly unknown[]).length).toBe(0);
  });

  it('marks exactly the five measured-absent keys presence-sensitive', () => {
    const sensitive = DROP_TABLE_FIELDS.filter((field) => field.presenceSensitive).map(
      (field) => field.key,
    );
    expect(sensitive).toEqual(['GrantsPotionSlot', ...DROP_TABLE_AUDIT_KEYS]);
    expect(dropTableFieldSpec('GrantsPotionSlot')?.corpusPresence).toBe(35);
    expect(dropTableFieldSpec('CreatedAt')?.corpusPresence).toBe(316);
    for (const field of DROP_TABLE_FIELDS) {
      if (!field.presenceSensitive) {
        expect(field.corpusPresence).toBe(DROP_TABLE_CORPUS.files);
      }
    }
  });

  it('renders the four sections of L471-477 and the audit fields read-only', () => {
    expect(new Set(DROP_TABLE_FIELDS.map((field) => field.section))).toEqual(
      new Set(['basic', 'rewards', 'items', 'audit']),
    );
    const audit = DROP_TABLE_FIELDS.filter((field) => field.section === 'audit');
    expect(audit.map((field) => field.key)).toEqual([...DROP_TABLE_AUDIT_KEYS]);
    expect(audit.every((field) => field.readOnly === true)).toBe(true);
    // The two sliders are the spec's 0-1 controls.
    expect(dropTableFieldSpec('RollChance')).toMatchObject({ kind: 'slider', min: 0, max: 1 });
    expect(dropTableFieldSpec('NoneChance')).toMatchObject({ kind: 'slider', min: 0, max: 1 });
  });

  it('carries exactly the four item-row fields of the DropItem table (L93-98)', () => {
    expect(DROP_TABLE_ITEM_FIELDS.map((field) => field.key)).toEqual([
      'ItemId',
      'ItemName',
      'Notes',
      'Requirements',
    ]);
    expect(DROP_TABLE_ITEM_FIELDS.every((field) => field.corpusPresence === 72)).toBe(true);
    // ItemId is a STRING with the default '' (L97) — never a number.
    expect(DROP_TABLE_ITEM_FIELDS[0].defaultValue).toBe('');
    expect(DROP_TABLE_ITEM_FIELDS.map((field) => field.kind)).toEqual([
      'item-id',
      'text',
      'text',
      'requirements',
    ]);
  });
});

describe('the ItemId string↔number conversion (AC3, the measured trap)', () => {
  it('canonicalises a digits-only string and a number to the same text', () => {
    expect(canonicalItemId('1001')).toBe('1001');
    expect(canonicalItemId(1001)).toBe('1001');
    expect(canonicalItemId('1001')).toBe(canonicalItemId(1001));
    expect(itemIdLookupValue('1001')).toBe('1001');
  });

  it('strips leading zeros through BigInt, so "01001" still resolves', () => {
    expect(canonicalItemId('01001')).toBe('1001');
  });

  it('returns undefined for anything that cannot name an item, so nothing is looked up or rewritten', () => {
    for (const value of [
      '',
      ' 1001 ',
      '-1',
      '1.5',
      '1e5',
      '0x1F',
      'abc',
      null,
      undefined,
      {},
      [],
    ]) {
      expect(canonicalItemId(value)).toBeUndefined();
      expect(itemIdLookupValue(value)).toBeUndefined();
    }
  });

  it('the eight genuinely-unresolvable corpus ids are digits, so they DO get looked up and 404 (miss-safe)', () => {
    for (const id of [
      '1000',
      '1730822561',
      '927448295',
      '975200773',
      '534093744',
      '533943727',
      '1627273980',
      '878360657',
    ]) {
      // A lookup is attempted (the id is well-formed) — the names API answers 404, and the
      // caller keeps the raw id and the stored ItemName. Nothing here invents a name.
      expect(canonicalItemId(id)).toBe(id);
    }
  });
});

describe('otherDropTableNames', () => {
  const cases: Array<[string, string[], string | null, string[]]> = [
    ['edit, name untouched', ['X', 'Y'], 'X', ['Y']],
    ['rename onto another table', ['X', 'Y'], 'X', ['Y']],
    ['create with an existing name', ['X', 'Y'], null, ['X', 'Y']],
    ['create with a new name', ['X'], null, ['X']],
    ['the corpus already held a duplicate', ['X', 'X'], 'X', ['X']],
    ['a name that is not in the corpus at all', ['X'], 'Z', ['X']],
    ['empty own name forgives nothing', ['X'], '', ['X']],
  ];
  for (const [label, corpus, own, expected] of cases) {
    it(`${label} → {${expected.join(', ')}}`, () => {
      expect([...otherDropTableNames(corpus, own)].sort()).toEqual([...expected].sort());
    });
  }
});

describe('the messages and the 400 field map', () => {
  it('keys the map by the shared rendered path', () => {
    const result = validateDropTable({
      ...validDocument(),
      Name: '',
      RollChance: 1.5,
      MinGold: 100,
      MaxGold: 10,
    });
    const map = dropTableFieldErrorMap(result.findings);
    expect(Object.keys(map).sort()).toEqual(['MaxGold', 'Name', 'RollChance']);
    expect(map.Name).toHaveLength(1);
    expect(map.Name[0]).toContain('non-empty Name');
    expect(map.MaxGold[0]).toContain('Minimum gold');
    expect(dropTableFindingField(result.findings[1])).toBe('RollChance');
  });

  it('has a label and a sentence for every kind, and a summary naming the kinds', () => {
    const findings: DropTableFinding[] = validateDropTable({
      ...validDocument(),
      Name: '',
      RollChance: 2,
      NoneChance: -1,
      MinGold: 100,
      MaxGold: 10,
    }).findings;
    for (const finding of findings) {
      expect(dropTableKindLabel(finding.kind)).not.toBe('');
      expect(dropTableFindingMessage(finding)).not.toBe('');
    }
    expect(dropTableBlockingSummary(findings)).toContain('4 validation errors');
    expect(dropTableBlockingSummary(findings)).toContain('Missing name');
    expect(
      dropTableBlockingSummary(validateDropTable({ ...validDocument(), RollChance: 2 }).findings),
    ).toContain('1 validation error');
  });
});

/* ------------------------------------------------------------------ live sweep */

describe.runIf(CORPUS_PRESENT)('the live 317-file corpus sweep', () => {
  it('every real file passes every rule (all four negatives are fixture-only)', () => {
    const corpus = loadCorpus();
    const findings: Array<{ file: string; finding: DropTableFinding }> = [];
    for (const { file, doc } of corpus) {
      const result = validateDropTable(doc);
      for (const finding of result.findings) {
        findings.push({ file, finding });
      }
    }
    // Printed even when green: the sweep's own report line.
    console.log(
      `[p4-02 corpus] files=${corpus.length} findings=${findings.length}` +
        (findings.length === 0
          ? ' (0 — every rule is fixture-only, as measured)'
          : ` — ${findings
              .slice(0, 5)
              .map((entry) => `${entry.file}:${entry.finding.kind}`)
              .join(', ')}`),
    );
    expect(findings).toEqual([]);
  });

  it('asserts the measured key-presence facts, so a change that pads keys fails loudly', () => {
    const corpus = loadCorpus();
    expect(corpus).toHaveLength(DROP_TABLE_CORPUS.files);

    const baseFields = [
      'Name',
      'Description',
      'RollChance',
      'Weight',
      'NoneChance',
      'PityCounter',
      'MinGold',
      'MaxGold',
      'ExperienceAmount',
      'TrainingPoints',
      'Items',
    ];
    const names = new Set<string>();
    let audit = 0;
    let potion = 0;
    let auditElsewhere = 0;
    const unmodelled = new Set<string>();
    const known = new Set(DROP_TABLE_FIELDS.map((field) => field.key));

    for (const { file, doc } of corpus) {
      for (const key of Object.keys(doc)) {
        if (!known.has(key)) {
          unmodelled.add(key);
        }
      }
      for (const key of baseFields) {
        // The 11 always-present keys: a missing one is a corpus change, not a rule change.
        expect(Object.prototype.hasOwnProperty.call(doc, key), `${file} lacks ${key}`).toBe(true);
      }
      const hasAudit = DROP_TABLE_AUDIT_KEYS.every((key) =>
        Object.prototype.hasOwnProperty.call(doc, key),
      );
      if (hasAudit) {
        audit += 1;
      } else {
        expect(file).toBe(DROP_TABLE_CORPUS.auditMissingFile);
        // And it carries NOTHING of the quartet — not a partial block.
        for (const key of DROP_TABLE_AUDIT_KEYS) {
          expect(Object.prototype.hasOwnProperty.call(doc, key)).toBe(false);
        }
      }
      if (Object.prototype.hasOwnProperty.call(doc, 'GrantsPotionSlot')) {
        potion += 1;
      }
      if (typeof doc.Name === 'string' && doc.Name.trim() !== '') {
        names.add(doc.Name);
      }
      if (!DROP_TABLE_AUDIT_KEYS.some((key) => Object.prototype.hasOwnProperty.call(doc, key))) {
        auditElsewhere += 1;
      }
    }

    expect(unmodelled).toEqual(new Set());
    expect(names.size).toBe(DROP_TABLE_CORPUS.distinctNames);
    expect(audit).toBe(DROP_TABLE_CORPUS.auditPresent);
    expect(auditElsewhere).toBe(1);
    expect(potion).toBe(DROP_TABLE_CORPUS.grantsPotionSlotPresent);
  });

  it('asserts the item rows: 72 rows, exactly four keys each, 65 non-null trees of one leaf', () => {
    const corpus = loadCorpus();
    const keys = new Set<string>();
    const ids: unknown[] = [];
    let rows = 0;
    let nonNullRequirements = 0;
    let leaves = 0;
    for (const { doc } of corpus) {
      const items = doc.Items;
      if (!Array.isArray(items)) {
        continue;
      }
      for (const raw of items) {
        rows += 1;
        const row = raw as Record<string, unknown>;
        for (const key of Object.keys(row)) {
          keys.add(key);
        }
        ids.push(row.ItemId);
        // The four measured keys, every row.
        expect(Object.keys(row).sort()).toEqual(['ItemId', 'ItemName', 'Notes', 'Requirements']);
        // The key is present in all 72; 7 rows carry an explicit null (D57: present, not absent).
        expect(Object.prototype.hasOwnProperty.call(row, 'Requirements')).toBe(true);
        const requirements = row.Requirements;
        if (requirements !== null) {
          nonNullRequirements += 1;
          const wrapper = requirements as { m_requirements?: unknown };
          expect(Array.isArray(wrapper.m_requirements)).toBe(true);
          leaves += (wrapper.m_requirements as unknown[]).length;
        }
      }
    }
    expect(rows).toBe(DROP_TABLE_CORPUS.itemRows);
    expect(keys).toEqual(new Set(['ItemId', 'ItemName', 'Notes', 'Requirements']));
    expect(nonNullRequirements).toBe(DROP_TABLE_CORPUS.itemRowsWithRequirements);
    expect(leaves).toBe(DROP_TABLE_CORPUS.requirementLeaves);
    // Every ItemId is a JSON string — the fact the conversion exists for.
    expect(ids.every((id) => typeof id === 'string')).toBe(true);
    expect(new Set(ids).size).toBe(DROP_TABLE_CORPUS.distinctItemIds);
  });

  it('validates without mutating: every file serializes byte-identically after the sweep', () => {
    const corpus = loadCorpus();
    for (const { doc } of corpus) {
      const before = serializeDoc(doc as JsonDocument);
      validateDropTable(doc);
      expect(serializeDoc(doc as JsonDocument)).toBe(before);
    }
  });
});

describe.runIf(CORPUS_PRESENT && DB_PRESENT)('the live string↔number resolution (64 of 72)', () => {
  it('resolves 64 of 72 distinct ItemIds numerically — and 0 as raw strings', () => {
    const corpus = loadCorpus();
    const distinct = new Set(
      corpus.flatMap(({ doc }) =>
        (Array.isArray(doc.Items) ? doc.Items : []).map(
          (row) => (row as { ItemId: unknown }).ItemId,
        ),
      ),
    );
    const db = new Database(DB_PATH, { readonly: true });
    try {
      const lookup = db.prepare('select gid, name from items where gid = ?');
      const numeric: string[] = [];
      const misses: string[] = [];
      const raw: string[] = [];
      for (const value of distinct) {
        const canonical = canonicalItemId(value);
        if (canonical === undefined) {
          misses.push(String(value));
          continue;
        }
        const row = lookup.get(Number(canonical)) as
          { gid: number; name: string | null } | undefined;
        if (row === undefined) {
          misses.push(canonical);
        } else {
          numeric.push(canonical);
        }
        // The trap, asserted directly: the raw value is a string and never equals the gid.
        if (row !== undefined && (value as unknown) === row.gid) {
          raw.push(canonical);
        }
      }
      console.log(
        `[p4-02 corpus] distinctItemIds=${distinct.size} resolve numerically=${numeric.length} ` +
          `raw-string matches=${raw.length} misses=${misses.length}`,
      );
      expect(distinct.size).toBe(DROP_TABLE_CORPUS.distinctItemIds);
      expect(numeric).toHaveLength(DROP_TABLE_CORPUS.resolvableItemIds);
      expect(raw).toEqual([]);
      // The eight genuine misses, named.
      expect([...misses].sort()).toEqual(
        [
          '1000',
          '1627273980',
          '1730822561',
          '533943727',
          '534093744',
          '878360657',
          '927448295',
          '975200773',
        ].sort(),
      );
    } finally {
      db.close();
    }
  });
});
