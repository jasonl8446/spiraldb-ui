import { afterEach, describe, expect, it } from 'vitest';

import { MEMORY_DB, openDb, type Db } from '@server/db';
import { lookupCandidates, lookupString } from '@server/services/sync/lookup';

/**
 * The `string_table` lookup helper (lead decision 2, p1-06-ac2).
 *
 * The ladder exists to absorb zero-padding and hex case, and must **never**
 * cross the two lexical forms: decimal `126346` and hex `1ED8A` are the same
 * numeric index with different values (D33(e)).
 */

const OPEN: Db[] = [];

afterEach(() => {
  while (OPEN.length > 0) {
    OPEN.pop()?.close();
  }
});

function seededDb(rows: Array<[string, string, string]>): Db {
  const db = openDb({ file: MEMORY_DB });
  OPEN.push(db);
  const insert = db.prepare('INSERT INTO string_table (key, value, category) VALUES (?, ?, ?)');
  for (const [key, value, category] of rows) {
    insert.run(key, value, category);
  }
  return db;
}

const COLLISION_ROWS: Array<[string, string, string]> = [
  ['QuestTitle_126346', 'Letters of Light', 'QuestTitle'],
  ['QuestTitle_1ED8A', 'Forged in Fire', 'QuestTitle'],
  ['QuestTitle_00065535', 'Decimal Sixty-Five Thousand', 'QuestTitle'],
  ['Items_00022716', 'Fire Cat', 'Items'],
  ['ChooseFriendSWF_ChooseFriendTitle', 'Choose Your Friend', 'ChooseFriendSWF'],
  ['Empty_1', '', 'Empty'],
];

describe('lookupString — exact keys', () => {
  it('returns the exact row for both lexical forms of one index', () => {
    const db = seededDb(COLLISION_ROWS);

    expect(lookupString(db, 'QuestTitle_126346')).toBe('Letters of Light');
    expect(lookupString(db, 'QuestTitle_1ED8A')).toBe('Forged in Fire');
  });

  it('treats an empty value as a hit and an absent key as undefined', () => {
    const db = seededDb(COLLISION_ROWS);

    expect(lookupString(db, 'Empty_1')).toBe('');
    expect(lookupString(db, 'QuestTitle_FFFFFF')).toBeUndefined();
    expect(lookupString(db, 'NoSuchCategory_1')).toBeUndefined();
    expect(lookupString(db, 'no_separator')).toBeUndefined();
  });
});

describe('lookupString — spelling ladder', () => {
  it('resolves an unpadded decimal suffix to the padded row and vice versa', () => {
    const db = seededDb(COLLISION_ROWS);

    expect(lookupString(db, 'Items_22716')).toBe('Fire Cat');
    expect(lookupString(db, 'Items_00022716')).toBe('Fire Cat');
  });

  it('absorbs hex case without changing form', () => {
    const db = seededDb(COLLISION_ROWS);

    expect(lookupString(db, 'QuestTitle_1ed8a')).toBe('Forged in Fire');
    expect(lookupString(db, 'QuestTitle_1ED8A')).toBe('Forged in Fire');
  });

  it('never falls back to the other lexical form', () => {
    const db = seededDb(COLLISION_ROWS);

    // `FFFF` is the hex spelling of a different index (65535) which exists in
    // decimal form — returning it would be the exact bug the helper forbids.
    expect(lookupString(db, 'QuestTitle_FFFF')).toBeUndefined();
    // And the decimal spelling of the hex row's index must not resolve it.
    expect(lookupString(db, 'QuestTitle_126346')).toBe('Letters of Light');
    expect(lookupString(db, 'QuestTitle_126346')).not.toBe('Forged in Fire');
  });

  it('resolves named keys verbatim only', () => {
    const db = seededDb(COLLISION_ROWS);

    expect(lookupString(db, 'ChooseFriendSWF_ChooseFriendTitle')).toBe('Choose Your Friend');
    expect(lookupString(db, 'ChooseFriendSWF_ChooseFriendTitl')).toBeUndefined();
  });
});

describe('lookupCandidates', () => {
  it('stays within the input token’s lexical form and is bounded', () => {
    const decimal = lookupCandidates('Items_22716');
    expect(decimal[0]).toBe('Items_22716');
    expect(decimal).toContain('Items_00022716');
    expect(decimal.length).toBeLessThanOrEqual(4);
    for (const candidate of decimal) {
      expect(candidate.slice('Items_'.length)).toMatch(/^\d+$/);
    }

    const hex = lookupCandidates('QuestTitle_1ED8A');
    expect(hex[0]).toBe('QuestTitle_1ED8A');
    expect(hex).toContain('QuestTitle_1ed8a');
    expect(hex.length).toBeLessThanOrEqual(4);
    for (const candidate of hex) {
      const token = candidate.slice('QuestTitle_'.length);
      expect(token).toMatch(/^[0-9A-Fa-f]+$/);
      // The decimal spelling of the same index must never appear.
      expect(token).not.toBe('126346');
    }
  });

  it('returns the key unchanged for named keys and unprefixed input', () => {
    expect(lookupCandidates('ChooseFriendSWF_ChooseFriendTitle')).toEqual([
      'ChooseFriendSWF_ChooseFriendTitle',
    ]);
    expect(lookupCandidates('no-separator')).toEqual(['no-separator']);
  });
});
