import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { ULong } from '@shared/ulong';
import { objectKeyFromData, readSpiraldbJson } from '@server/services/spiraldbFiles';

/**
 * Story p4-01, AC3: the ulong (`TemplateID`) conversion helper, both directions.
 *
 * Two halves:
 *
 * 1. **Hermetic** — the table of inputs the helper must accept and reject, run
 *    against `shared/ulong.ts` alone (no disk).
 * 2. **Live** — one check per ulong-keyed type against the **real corpus**, so the
 *    property proved is about the data the tool actually edits rather than a
 *    hand-written opinion of it: for every `TemplateID` in `NpcInventory/`,
 *    `NpcSpellInventory/`, `NpcDropTable/` and `TreasureCardInventory/`,
 *    `ULong.toKey(ULong.toJson(key)) === key` and the JSON form is a `number`.
 *
 * The corpus half reads `data/test-spiraldb` (the D17 clone) **read-only** and does
 * all of its I/O inside `beforeAll` — never at module/collection scope, where a
 * missing clone turned into a CI-only collection error (decision D68). A clone that
 * is not there is reported loudly and the live cases are skipped, never silently
 * passed.
 */

const CLONE = path.resolve(fileURLToPath(new URL('../../data/test-spiraldb/', import.meta.url)));

/** The four `TemplateID` families of `shared/objectTypes.ts` and their corpus directories. */
const ULONG_FAMILIES = [
  { config: 'npcinventory', directory: 'NpcInventory' },
  { config: 'npcspellinventory', directory: 'NpcSpellInventory' },
  { config: 'npcdroptable', directory: 'NpcDropTable' },
  { config: 'treasurecardinventory', directory: 'TreasureCardInventory' },
] as const;

/** `family → the canonical key strings the corpus holds`, filled in `beforeAll`. */
const CORPUS_KEYS = new Map<string, string[]>();
/** `family → why its live half did not run` (empty when it did). */
const CORPUS_SKIPS = new Map<string, string>();

beforeAll(() => {
  for (const family of ULONG_FAMILIES) {
    const directory = path.join(CLONE, family.directory);
    if (!fs.existsSync(directory)) {
      // NpcDropTable/ is absent in the fork today — an empty result, not a failure.
      if (family.directory === 'NpcDropTable') {
        CORPUS_KEYS.set(family.config, []);
        continue;
      }
      CORPUS_SKIPS.set(family.config, `${family.directory}/ is absent from the clone`);
      continue;
    }
    const keys = new Set<string>();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = readSpiraldbJson(path.join(directory, entry.name));
      } catch {
        continue; // Unparsable corpus files are D12's problem, not this helper's.
      }
      const key = objectKeyFromData(parsed, 'TemplateID');
      if (key !== undefined) {
        keys.add(key);
      }
    }
    CORPUS_KEYS.set(family.config, [...keys].sort());
  }
});

describe('ULong.toKey (JSON → object_key / route text)', () => {
  it('stringifies a finite non-negative integer number unchanged', () => {
    expect(ULong.toKey(38226)).toBe('38226');
    expect(ULong.toKey(0)).toBe('0');
    expect(ULong.toKey(Number.MAX_SAFE_INTEGER)).toBe(String(Number.MAX_SAFE_INTEGER));
  });

  it('canonicalises a digits-only string, including leading zeros and beyond 2^53', () => {
    expect(ULong.toKey('38226')).toBe('38226');
    expect(ULong.toKey('0038226')).toBe('38226');
    expect(ULong.toKey('18446744073709551615')).toBe('18446744073709551615');
  });

  it('rejects everything that is not an unsigned integer', () => {
    const rejected: unknown[] = [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '',
      ' 1 ',
      '1.5',
      '-1',
      '+1',
      '0x1F',
      '1e5',
      '38226\n',
      null,
      undefined,
      true,
      {},
      [],
      [38226],
    ];
    for (const value of rejected) {
      expect(
        ULong.toKey(value),
        `expected ${JSON.stringify(value)} to be rejected`,
      ).toBeUndefined();
    }
  });
});

describe('ULong.toJson (object_key / route text → JSON number)', () => {
  it('parses the text form to the number form', () => {
    expect(ULong.toJson('38226')).toBe(38226);
    expect(ULong.toJson('0038226')).toBe(38226);
    expect(ULong.toJson(38226)).toBe(38226);
    expect(ULong.toJson('0')).toBe(0);
  });

  it('refuses a value JSON cannot hold exactly, and the same rejects as toKey', () => {
    expect(ULong.toJson('18446744073709551615')).toBeUndefined();
    expect(ULong.toJson('')).toBeUndefined();
    expect(ULong.toJson('-1')).toBeUndefined();
    expect(ULong.toJson({})).toBeUndefined();
  });
});

for (const family of ULONG_FAMILIES) {
  describe(`the corpus's ${family.config} TemplateIDs round-trip through the helper`, () => {
    it('every real key survives toKey(toJson(key)) and stays a number in JSON', () => {
      const skip = CORPUS_SKIPS.get(family.config);
      if (skip !== undefined) {
        console.warn(`[p4-01 AC3] skipping the ${family.config} live check: ${skip}`);
        return;
      }
      const keys = CORPUS_KEYS.get(family.config) ?? [];

      for (const key of keys) {
        const asJson = ULong.toJson(key);
        expect(asJson, `${family.config}/${key} must be a JSON number`).toBeTypeOf('number');
        expect(ULong.toKey(asJson), `${family.config}/${key} must round-trip`).toBe(key);
      }

      // The measured corpus sizes (317/215/77/0/1 files) are the lead's numbers, not
      // this test's contract; what it asserts is that a family the fork *does* have
      // shows real keys rather than an empty set that would make the loop vacuous.
      if (family.directory !== 'NpcDropTable') {
        expect(keys.length, `${family.directory}/ should hold keys`).toBeGreaterThan(0);
      }
    });
  });
}
