import { describe, expect, it } from 'vitest';

import {
  fileNameFor,
  isObjectFileType,
  NamingError,
  OBJECT_FILE_SPECS,
  parseFileName,
  UNKEYED_FILE_NAME,
  type ObjectFileType,
} from '@shared/naming';

/**
 * Phase-1 acceptance 16(c): the filename/key mapping table of
 * `docs/spec-data-model.md` L173-187 as a pure function. The module under test
 * imports nothing at all, and every row below is the spec's own example, so the
 * `it.each` blocks print the nine spec rows one per test under
 * `--reporter=verbose`.
 */

/** The nine keyed spec-table rows, verbatim (`docs/spec-data-model.md` L175-185). */
const SPEC_ROWS: Array<{ type: ObjectFileType; key: string; example: string; fileKey: string }> = [
  {
    type: 'questtemplates',
    key: 'DS-ACAD1-C01-001',
    example: 'questtemplates_DS-ACAD1-C01-001.json',
    fileKey: 'DS-ACAD1-C01-001',
  },
  {
    type: 'droptable',
    key: 'WC-UNICORN-MAIN-007',
    example: 'droptable_WC-UNICORN-MAIN-007.json',
    fileKey: 'WC-UNICORN-MAIN-007',
  },
  {
    type: 'npcinventory',
    key: '87112',
    example: 'npcinventory_87112.json',
    fileKey: '87112',
  },
  {
    type: 'npcspellinventory',
    key: '1452231',
    example: 'npcspellinventory_1452231.json',
    fileKey: '1452231',
  },
  {
    type: 'creaturespellbook',
    key: 'Mdeck-L-BR-DS-SylviaDrake-A-50',
    example: 'creaturespellbook_Mdeck-L-BR-DS-SylviaDrake-A-50.json',
    fileKey: 'Mdeck-L-BR-DS-SylviaDrake-A-50',
  },
  {
    type: 'npcdroptable',
    key: '12345',
    example: 'npcdroptable_12345.json',
    fileKey: '12345',
  },
  {
    type: 'treasurecardinventory',
    key: '38214',
    example: 'treasurecardinventory_38214.json',
    fileKey: '38214',
  },
  {
    // The spec's example is `zonetransfer_WizardCity_WC_Hub.json`, i.e. the ZoneName
    // `WizardCity/WC_Hub` written with `/` → `_` — so the parsed file key differs
    // from the ZoneName (`fileKey`, asserted below; ADR: the transform is lossy).
    type: 'zonetransfer',
    key: 'WizardCity/WC_Hub',
    example: 'zonetransfer_WizardCity_WC_Hub.json',
    fileKey: 'WizardCity_WC_Hub',
  },
  {
    type: 'questmetadata',
    key: 'DS-ACAD1-C01-001',
    example: 'questmetadata_DS-ACAD1-C01-001.json',
    fileKey: 'DS-ACAD1-C01-001',
  },
];

/** The runtime guard is reached only by callers that bypass the union; keep one helper. */
const callWithUnknownType = (type: string, key: string): string =>
  fileNameFor(type as ObjectFileType, key);

describe('OBJECT_FILE_SPECS — the spec table as data', () => {
  it('has ten entries: the nine keyed rows plus the GlobalRegistry special case', () => {
    expect(OBJECT_FILE_SPECS).toHaveLength(10);
    expect(OBJECT_FILE_SPECS.filter((spec) => spec.keyed)).toHaveLength(9);

    // The nine keyed rows, in table order, and nothing else.
    expect(OBJECT_FILE_SPECS.map((spec) => spec.type)).toEqual([
      'questtemplates',
      'droptable',
      'npcinventory',
      'npcspellinventory',
      'creaturespellbook',
      'npcdroptable',
      'treasurecardinventory',
      'zonetransfer',
      'questmetadata',
      'globalregistry',
    ]);
  });

  it('carries every type id, prefix, key source and the keyed flag', () => {
    for (const spec of OBJECT_FILE_SPECS) {
      expect(spec.prefix).not.toBe('');
      expect(spec.keySource).not.toBe('');
      expect(typeof spec.keyed).toBe('boolean');
      expect(typeof spec.slashToUnderscore).toBe('boolean');
    }
  });

  it("carries the table's key source for every type, verbatim", () => {
    expect(
      Object.fromEntries(OBJECT_FILE_SPECS.map((spec) => [spec.type, spec.keySource])),
    ).toEqual({
      questtemplates: 'm_questName',
      droptable: 'Name',
      npcinventory: 'TemplateID',
      npcspellinventory: 'TemplateID',
      creaturespellbook: 'DeckName',
      npcdroptable: 'TemplateID',
      treasurecardinventory: 'TemplateID',
      zonetransfer: 'ZoneName',
      questmetadata: 'quest name',
      globalregistry: 'dictionary key',
    });
  });

  it('covers every keyed spec row exactly once, with the spec example each', () => {
    expect(SPEC_ROWS).toHaveLength(9);
    expect(SPEC_ROWS.map((row) => row.type).sort()).toEqual(
      OBJECT_FILE_SPECS.filter((spec) => spec.keyed)
        .map((spec) => spec.type)
        .sort(),
    );
  });

  it('uses a unique prefix per type — prefix → type is a bijection', () => {
    const types = OBJECT_FILE_SPECS.map((spec) => spec.type);
    const prefixes = OBJECT_FILE_SPECS.map((spec) => spec.prefix);
    expect(new Set(types).size).toBe(types.length);
    expect(new Set(prefixes).size).toBe(types.length);
    for (const spec of OBJECT_FILE_SPECS) {
      expect(isObjectFileType(spec.type)).toBe(true);
    }
  });

  it('has no prefix that is a prefix of another — prefix matching cannot collide', () => {
    const prefixes = OBJECT_FILE_SPECS.map((spec) => spec.prefix);
    for (const a of prefixes) {
      for (const b of prefixes) {
        if (a !== b) {
          expect(b.startsWith(a)).toBe(false);
        }
      }
    }
    // The two look-alike prefixes are genuinely distinct tokens.
    expect('npcspellinventory'.startsWith('npcinventory')).toBe(false);
    expect('npcdroptable'.startsWith('npcinventory')).toBe(false);
  });
});

describe('the nine spec-table rows round-trip (docs/spec-data-model.md L175-185)', () => {
  it.each(SPEC_ROWS)('$type writes $example', ({ type, key, example }) => {
    expect(fileNameFor(type, key)).toBe(example);
  });

  it.each(SPEC_ROWS)('$type parses $example back to its file key', ({ type, example, fileKey }) => {
    expect(parseFileName(example)).toEqual({ type, fileKey });
  });

  it.each(SPEC_ROWS)('$type rebuilds the same name from the parsed file key', ({ example }) => {
    const parsed = parseFileName(example);
    if (parsed === null || parsed.fileKey === null) {
      throw new Error(`parseFileName could not read ${example}`);
    }
    expect(fileNameFor(parsed.type, parsed.fileKey)).toBe(example);
  });

  it('round-trips one name per spec, including the unkeyed file', () => {
    for (const spec of OBJECT_FILE_SPECS) {
      const file = fileNameFor(spec.type, spec.keyed ? 'K' : 'ignored');
      const parsed = parseFileName(file);
      if (parsed === null) {
        throw new Error(`parseFileName could not read ${file}`);
      }
      expect(parsed).toEqual({ type: spec.type, fileKey: spec.keyed ? 'K' : null });
    }
  });
});

describe('keys are opaque strings', () => {
  it('splits on the FIRST separator only, so underscores inside a key survive', () => {
    expect(parseFileName('zonetransfer_WizardCity_WC_Hub.json')).toEqual({
      type: 'zonetransfer',
      fileKey: 'WizardCity_WC_Hub',
    });
    expect(parseFileName('droptable_WC_UNICORN_MAIN_007.json')).toEqual({
      type: 'droptable',
      fileKey: 'WC_UNICORN_MAIN_007',
    });
    expect(fileNameFor('droptable', 'WC_UNICORN_MAIN_007')).toBe(
      'droptable_WC_UNICORN_MAIN_007.json',
    );
  });

  it('accepts the spec spelling and the corpus spelling of the same quest name', () => {
    for (const questName of ['DS-ACAD1-C01-001', 'DS-ACAD-C01-001']) {
      const file = `questtemplates_${questName}.json`;
      expect(fileNameFor('questtemplates', questName)).toBe(file);
      expect(parseFileName(file)).toEqual({ type: 'questtemplates', fileKey: questName });
    }
  });
});

describe('GlobalRegistry — the single unkeyed file', () => {
  it('is the one spec marked unkeyed, and names the file globalregistry.json', () => {
    const unkeyed = OBJECT_FILE_SPECS.filter((spec) => !spec.keyed);
    expect(unkeyed).toHaveLength(1);
    expect(unkeyed[0].type).toBe('globalregistry');
    expect(unkeyed[0].prefix).toBe('globalregistry');
    expect(UNKEYED_FILE_NAME).toBe('globalregistry.json');
  });

  it('ignores the key entirely, valid or not', () => {
    for (const key of ['', '   ', 'anything', 'a/b', 'x.json', 'a\0b']) {
      expect(fileNameFor('globalregistry', key)).toBe('globalregistry.json');
    }
  });

  it('parses back with a null file key, and a keyed variant is unrecognized', () => {
    expect(parseFileName('globalregistry.json')).toEqual({
      type: 'globalregistry',
      fileKey: null,
    });
    expect(parseFileName('globalregistry_x.json')).toBeNull();
    expect(parseFileName('globalregistryanything.json')).toBeNull();
    expect(parseFileName('GlobalRegistry.json')).toBeNull();
  });
});

describe('the zone slash→underscore transform is lossy (documented, not guessed back)', () => {
  it('writes the slash as an underscore and yields the FILE KEY, not the ZoneName', () => {
    const file = fileNameFor('zonetransfer', 'WizardCity/WC_Hub');
    expect(file).toBe('zonetransfer_WizardCity_WC_Hub.json');

    const parsed = parseFileName(file);
    if (parsed === null) {
      throw new Error(`parseFileName could not read ${file}`);
    }
    // `fileKey` is `string | null` — null only for the unkeyed GlobalRegistry file. This
    // test is about the *keyed* zone transform, so state that requirement (and narrow
    // the type for `fileNameFor`, which takes a `string`).
    if (parsed.fileKey === null) {
      throw new Error(`parseFileName returned no file key for ${file}`);
    }
    expect(parsed).toEqual({ type: 'zonetransfer', fileKey: 'WizardCity_WC_Hub' });
    // The ZoneName is NOT recovered; no heuristic turns `_` back into `/`.
    expect(parsed.fileKey).not.toBe('WizardCity/WC_Hub');
    // The file NAME is stable, so a second pass is idempotent.
    expect(fileNameFor(parsed.type, parsed.fileKey)).toBe(file);
    expect(parseFileName(fileNameFor(parsed.type, parsed.fileKey))).toEqual(parsed);
  });

  it('does not transform other types — a slash there is rejected', () => {
    expect(() => fileNameFor('droptable', 'WizardCity/WC_Hub')).toThrow(NamingError);
    expect(() => fileNameFor('questtemplates', 'a/b')).toThrow(NamingError);
  });
});

describe('parseFileName — unrecognized names return null, never throw', () => {
  it('rejects an unknown prefix, including the legacy plural prefixes', () => {
    expect(parseFileName('droptables_ds-acad1-c01-001.json')).toBeNull();
    expect(parseFileName('NPCInventories_1025-A.json')).toBeNull();
    expect(parseFileName('WizardZoneDatas_10017-A.json')).toBeNull();
    expect(parseFileName('quest_DS-ACAD-C01-003.json')).toBeNull();
  });

  it('rejects a name with no separator', () => {
    expect(parseFileName('questtemplates.json')).toBeNull();
    expect(parseFileName('npcspellinventory.json')).toBeNull();
    expect(parseFileName('zonetransfer.json')).toBeNull();
  });

  it('rejects a missing or empty key token', () => {
    expect(parseFileName('questtemplates_.json')).toBeNull();
    expect(parseFileName('.json')).toBeNull();
  });

  it('rejects a name without the .json suffix', () => {
    expect(parseFileName('questtemplates_DS-ACAD1-C01-001')).toBeNull();
    expect(parseFileName('questtemplates_DS-ACAD1-C01-001.JSON')).toBeNull();
    expect(parseFileName('')).toBeNull();
  });

  it('is case-sensitive about the prefix', () => {
    expect(parseFileName('QuestTemplates_DS-ACAD1-C01-001.json')).toBeNull();
    expect(parseFileName('DROPTABLE_x.json')).toBeNull();
  });

  it('returns null for non-string input without throwing', () => {
    expect(parseFileName(null as unknown as string)).toBeNull();
    expect(parseFileName(42 as unknown as string)).toBeNull();
    expect(parseFileName(undefined as unknown as string)).toBeNull();
  });
});

describe('fileNameFor validation', () => {
  it('rejects an empty or blank key, naming the type', () => {
    for (const key of ['', '   ', '\t\n']) {
      expect(() => fileNameFor('questtemplates', key)).toThrow(NamingError);
      expect(() => fileNameFor('questtemplates', key)).toThrow(/questtemplates/);
    }
  });

  it('rejects a path separator AFTER the zone transform, and only then', () => {
    // `/` in a zone key is transformed first, so it is legal…
    expect(() => fileNameFor('zonetransfer', 'WizardCity/WC_Hub')).not.toThrow();
    // …while a backslash survives the transform and is rejected.
    expect(() => fileNameFor('zonetransfer', 'WizardCity\\WC_Hub')).toThrow(NamingError);
    expect(() => fileNameFor('zonetransfer', 'WizardCity\\WC_Hub')).toThrow(/zonetransfer/);
    expect(() => fileNameFor('droptable', 'a/b')).toThrow(NamingError);
    expect(() => fileNameFor('droptable', 'a\\b')).toThrow(NamingError);
  });

  it('rejects a NUL character', () => {
    expect(() => fileNameFor('droptable', 'a\0b')).toThrow(NamingError);
    expect(() => fileNameFor('npcspellinventory', 'a\0b')).toThrow(/NUL/);
  });

  it('rejects a key that already carries the .json suffix', () => {
    expect(() => fileNameFor('droptable', 'droptable_x.json')).toThrow(NamingError);
    expect(() => fileNameFor('questtemplates', 'DS-ACAD1-C01-001.json')).toThrow(
      /already ends with ".json"/,
    );
  });

  it('rejects an unknown type instead of silently inheriting a prefix', () => {
    expect(() => callWithUnknownType('droptables', 'x')).toThrow(NamingError);
    expect(() => callWithUnknownType('droptables', 'x')).toThrow(/droptables/);
    expect(() => callWithUnknownType('', 'x')).toThrow(NamingError);
    expect(() => callWithUnknownType('all', 'x')).toThrow(NamingError);
  });

  it('names both the offending type and the offending key in the message', () => {
    expect(() => fileNameFor('droptable', 'a/b')).toThrow(/"a\/b"/);
    expect(() => fileNameFor('droptable', 'x.json')).toThrow(/"x\.json"/);
    expect(() => fileNameFor('droptable', 'a/b')).toThrow(/Cannot build a droptable file name/);
  });
});

describe('isObjectFileType', () => {
  it('accepts exactly the ten spec types', () => {
    for (const spec of OBJECT_FILE_SPECS) {
      expect(isObjectFileType(spec.type)).toBe(true);
    }
    for (const value of ['quests', 'droptables', 'DropTable', 'global_registry', 'npc', '']) {
      expect(isObjectFileType(value)).toBe(false);
    }
    expect(isObjectFileType(null)).toBe(false);
    expect(isObjectFileType(undefined)).toBe(false);
    expect(isObjectFileType(7)).toBe(false);
  });
});
