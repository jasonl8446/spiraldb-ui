import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  UTF16LE_BOM,
  createKeyLookup,
  decodeLangBuffer,
  formatLangKey,
  langKeyCategory,
  langKeyForm,
  langKeySuffix,
  langKeyToIndex,
  parseLangBuffer,
  resolveLangKey,
} from '@server/services/sync/lang';

/**
 * Task 1.4e acceptance (p1-05-ac1): the `.lang` parser against the **real**
 * `Locale/en-US/QuestTitle.lang` fixture (313,632 bytes, byte-exact copy from
 * spike 1.4a) plus tiny synthetic buffers for the edge cases.
 *
 * ## Key resolution is FORM-MATCHED — both earlier readings retracted here
 *
 * `QuestTitle.lang` writes its keys in **two lexical forms** over one numeric
 * index, and the same index can be written both ways with **different** values:
 *
 * ```
 * QuestTitle_126346             (decimal token)    → "Letters of Light"
 * QuestTitle_1ED8A  (0x1ED8A = 126346, hex token) → "Forged in Fire"
 * QuestTitle_1ED8D  (0x1ED8D = 126349, hex token) → "Quest for Perfection"
 * ```
 *
 * Two earlier readings of this file were wrong:
 *
 *  - spike 1.4a skipped A–F-containing index tokens, so it saw 2,238 of the
 *    5,959 records and reported `1ED8D` absent and `1ED8A` → "Letters of Light";
 *  - the module's first version merged both forms into a single numeric map
 *    ("later record wins"), which resolves the **decimal** key
 *    `QuestTitle_126346` to "Forged in Fire". That is the bug these tests pin:
 *    the real `m_displayName` form (`Items_00022716`, `NPCs_01749407`) is
 *    decimal, so it must read the decimal map.
 *
 * The "dense 0–2237 block + sparse tail" model is retracted too: it is the
 * decimal-only projection of one interleaved record stream (the first hex token
 * sits at record 1,473; the last decimal record at position 5,408). The
 * assertions below encode the measured fixture values.
 */

const FIXTURES = fileURLToPath(new URL('../../server/test/fixtures/', import.meta.url));
const QUEST_TITLE_LANG = path.join(FIXTURES, 'en-US_QuestTitle.lang');
const SPARSE_LANG = path.join(FIXTURES, 'lang_sparse_index.lang');

/** Builds a UTF-16LE `.lang` buffer; `withBom` controls the BOM only. */
function langBuffer(text: string, options: { bom?: boolean } = {}): Buffer {
  const body = Buffer.from(text, 'utf16le');
  return options.bom === false ? body : Buffer.concat([UTF16LE_BOM, body]);
}

const EMPTY_LOOKUP = {
  decimalEntries: new Map<number, string>(),
  hexEntries: new Map<number, string>(),
};

describe('lang parser — real en-US/QuestTitle.lang fixture (task 1.4e)', () => {
  const buffer = readFileSync(QUEST_TITLE_LANG);
  const table = parseLangBuffer(buffer);

  it('decodes UTF-16LE and reads the category from the header line', () => {
    expect(table.category).toBe('QuestTitle');
    expect(table.hasBom).toBe(true);
    expect(table.byteLength).toBe(313_632);
  });

  it('parses the dense 0–2237 decimal block', () => {
    expect(table.decimalEntries.get(0)).toBe('The Bear Truth');
    expect(table.decimalEntries.get(1)).toBe('All is Revealed');
    expect(table.decimalEntries.get(2)).toBe('Recover the Goods');
    expect(table.decimalEntries.get(2236)).toBe('The Monster');
  });

  it('keeps the two lexical forms in separate maps — neither shadows the other', () => {
    // One numeric index, two records, two different values…
    expect(table.decimalEntries.get(126_346)).toBe('Letters of Light');
    expect(table.hexEntries.get(126_346)).toBe('Forged in Fire');
    // …and each key resolves through its own form. The decimal form is the one
    // the corpus writes in m_displayName, so this is the live case.
    expect(resolveLangKey('QuestTitle_126346', table)).toBe('Letters of Light');
    expect(resolveLangKey('QuestTitle_000126346', table)).toBe('Letters of Light');
    expect(resolveLangKey('QuestTitle_1ED8A', table)).toBe('Forged in Fire');
    // The merged numeric view is counting-only (documented in the module): it
    // keeps whichever record came last, which is exactly what lookups must not use.
    expect(table.entries.get(126_346)).toBe('Forged in Fire');
  });

  it('resolves the spec worked example hex key (1ED8D) — it IS present in this revision', () => {
    // D33(e) recorded this index as absent; the fixture says otherwise.
    expect(resolveLangKey('QuestTitle_1ED8D', table)).toBe('Quest for Perfection');
  });

  it('resolves real hex and decimal keys to their own form values', () => {
    expect(resolveLangKey('QuestTitle_1ED8A', table)).toBe('Forged in Fire');
    expect(resolveLangKey('QuestTitle_1ED8B', table)).toBe('Earn Your Wings');
    expect(resolveLangKey('QuestTitle_00001717', table)).toBe('Grim Tales');
    expect(resolveLangKey('QuestTitle_00001814', table)).toBe('Oh Me, Oh Minotaur');
    expect(resolveLangKey('QuestTitle_1625BF', table)).toBe('Unicorn Way');
  });

  it("falls back to the other form's numeric equivalent only when the own form is absent", () => {
    // `QuestTitle_6B5` is hex for 1717; only the decimal token exists here.
    expect(table.hexEntries.has(1717)).toBe(false);
    expect(resolveLangKey('QuestTitle_6B5', table)).toBe('Grim Tales');
    // `QuestTitle_00126349` is decimal for 126349; only the hex token exists here.
    expect(table.decimalEntries.has(126_349)).toBe(false);
    expect(resolveLangKey('QuestTitle_00126349', table)).toBe('Quest for Perfection');
  });

  it('falls back to the raw key for an absent index or a non-numeric suffix', () => {
    expect(resolveLangKey('QuestTitle_FFFFFF', table)).toBeUndefined();
    expect(resolveLangKey('QuestTitle_ZZZZ', table)).toBeUndefined();
    expect(resolveLangKey('Spells_Pixie', table)).toBeUndefined();
    expect(resolveLangKey('QuestTitle', table)).toBeUndefined();
    expect(resolveLangKey('QuestTitle_1ED8D', EMPTY_LOOKUP)).toBeUndefined();
    // The fallback the callers use: miss → show the raw key
    // ([spec-domain-reference.md] L694-695).
    expect(resolveLangKey('QuestTitle_ZZZZ', table) ?? 'QuestTitle_ZZZZ').toBe('QuestTitle_ZZZZ');
  });

  it('asks the token own form first, then the other form (function lookup contract)', () => {
    const asked: Array<'decimal' | 'hex'> = [];
    const miss = (_index: number, form: 'decimal' | 'hex'): string | undefined => {
      asked.push(form);
      return undefined;
    };
    expect(resolveLangKey('QuestTitle_1ED8A', miss)).toBeUndefined();
    expect(asked).toEqual(['hex', 'decimal']);
    asked.length = 0;
    expect(resolveLangKey('QuestTitle_00001717', miss)).toBeUndefined();
    expect(asked).toEqual(['decimal', 'hex']);
    // A hit on the own form never consults the other form.
    const hit = (index: number, form: 'decimal' | 'hex'): string | undefined =>
      form === 'hex' && index === 126_346 ? 'hex hit' : undefined;
    expect(resolveLangKey('QuestTitle_1ED8A', hit)).toBe('hex hit');
  });

  it('reads every record, and reports the same-form and cross-form collision counters', () => {
    // 2,238 is exactly the entry count spike 1.4a reported — it is the decimal
    // subset; the other 3,719 records are hex-written and must be kept too.
    expect(table.decimalRecordCount).toBe(2_238);
    expect(table.hexRecordCount).toBe(3_719);
    expect(table.recordCount).toBe(5_959);
    expect(table.decimalEntries.size).toBe(2_238);
    expect(table.hexEntries.size).toBe(3_719);
    // The merged view collapses the 26 indices written in both forms.
    expect(table.entries.size).toBe(5_931);
    expect(table.sameFormCollisionCount).toBe(0);
    expect(table.crossFormCollisionCount).toBe(26);
    expect(table.crossFormValueMismatchCount).toBe(26);
    // The figure the dry run has always printed (merged view, any form).
    expect(table.collisionCount).toBe(26);
    // Three of the records carry something on the middle line where the rest
    // leave it blank — a third (label/description) column that some tables use
    // (`MobDescriptions.lang`, `ZoneLocName.lang`); it does not misalign a parse.
    expect(table.nonBlankMiddleLineCount).toBe(3);
    // Records are fully accounted for: merged numeric entries + their collisions
    // + named-key records.
    expect(table.entries.size + table.collisionCount + table.namedRecordCount).toBe(
      table.recordCount,
    );
    // Two records are keyed by name rather than by index (a third key form;
    // 79 of the 5,132 tables are keyed entirely this way).
    expect([...table.namedEntries.keys()]).toEqual(['Encounter Test', 'QuestFinder']);
    expect(table.namedEntries.get('QuestFinder')).toBe('Quest Finder');
    expect(table.namedRecordCount).toBe(2);
  });

  it('tolerates a missing BOM (same table, no BOM branch)', () => {
    const withoutBom = parseLangBuffer(langBuffer(decodeLangBuffer(buffer).text, { bom: false }));
    expect(withoutBom.hasBom).toBe(false);
    expect(withoutBom.category).toBe('QuestTitle');
    expect(withoutBom.decimalEntries.size).toBe(table.decimalEntries.size);
    expect(withoutBom.hexEntries.size).toBe(table.hexEntries.size);
    expect(withoutBom.crossFormValueMismatchCount).toBe(table.crossFormValueMismatchCount);
    expect(resolveLangKey('QuestTitle_1ED8D', withoutBom)).toBe('Quest for Perfection');
  });

  it('rejects a UTF-16BE buffer with an actionable message', () => {
    const be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('1:QuestTitle', 'utf16le')]);
    expect(() => parseLangBuffer(be)).toThrow(/UTF-16BE/);
  });

  it('rejects a buffer with no header line', () => {
    expect(() => parseLangBuffer(langBuffer('not-a-header\r\n00000000\r\n\r\nx\r\n'))).toThrow(
      /expected "1:\{Category\}"/,
    );
    // An explicit fallback makes a header-less buffer usable.
    const table2 = parseLangBuffer(langBuffer('00000000\r\n\r\nx\r\n'), {
      categoryFallback: 'Fallback',
    });
    expect(table2.category).toBe('Fallback');
    expect(table2.decimalEntries.get(0)).toBe('x');
  });
});

describe('lang parser — pure key/index/form conversion (P1 AC#6)', () => {
  it('maps QuestTitle_1ED8D → 126349 (hex → decimal)', () => {
    expect(langKeyToIndex('1ED8D')).toBe(126_349);
    expect(langKeyToIndex('1ed8d')).toBe(126_349);
  });

  it('maps padded decimal suffixes through the decimal reading first', () => {
    expect(langKeyToIndex('00001717')).toBe(1717);
    expect(langKeyToIndex('00000424')).toBe(424);
  });

  it('returns undefined for a suffix that is neither decimal nor hex', () => {
    expect(langKeyToIndex('Pixie')).toBeUndefined();
    expect(langKeyToIndex('')).toBeUndefined();
  });

  it('classifies the lexical form of an index token', () => {
    expect(langKeyForm('126346')).toBe('decimal');
    expect(langKeyForm('00001717')).toBe('decimal');
    expect(langKeyForm('1ED8A')).toBe('hex');
    expect(langKeyForm('1ed8d')).toBe('hex');
    // The GUI table really does write hex tokens this short.
    expect(langKeyForm('d')).toBe('hex');
    expect(langKeyForm('Pixie')).toBeUndefined();
    expect(langKeyForm('')).toBeUndefined();
  });

  it('splits keys on the last underscore and round-trips through formatLangKey', () => {
    expect(langKeySuffix('QuestTitle_1ED8D')).toBe('1ED8D');
    expect(langKeyCategory('QuestTitle_1ED8D')).toBe('QuestTitle');
    expect(langKeySuffix('QuestTitle')).toBeUndefined();
    expect(formatLangKey('QuestTitle', 1717)).toBe('QuestTitle_00001717');
    expect(formatLangKey('QuestTitle', 126_349, { style: 'hex' })).toBe('QuestTitle_1ED8D');
    // The inverse direction resolves through the same form-matched rule.
    const lookup = {
      decimalEntries: new Map([[1717, 'Grim Tales']]),
      hexEntries: new Map<number, string>(),
    };
    expect(resolveLangKey(formatLangKey('QuestTitle', 1717), lookup)).toBe('Grim Tales');
    // A hex-style token lands in the hex map and reads back through it.
    const hexLookup = {
      decimalEntries: new Map<number, string>(),
      hexEntries: new Map([[126_349, 'Quest for Perfection']]),
    };
    expect(resolveLangKey(formatLangKey('QuestTitle', 126_349, { style: 'hex' }), hexLookup)).toBe(
      'Quest for Perfection',
    );
  });
});

describe('lang parser — synthetic sparse-index fixture and record structure', () => {
  it('parses the committed sparse-index fixture (dense + unpadded + sparse tail)', () => {
    const table = parseLangBuffer(readFileSync(SPARSE_LANG));
    expect(table.category).toBe('SparseTest');
    expect(table.hasBom).toBe(true);
    expect(table.decimalEntries.get(0)).toBe('Dense Zero');
    expect(table.decimalEntries.get(2)).toBe('');
    // Unpadded index "7" (spike 1.4a §5 caveat: indices are not always padded).
    expect(table.decimalEntries.get(7)).toBe('Unpadded Seven');
    // The dense-block edge and the sparse tail beyond it.
    expect(table.decimalEntries.get(2237)).toBe('Dense Edge');
    expect(table.decimalEntries.get(199_157)).toBe('Sparse Tail 199157');
    // A hex index token past the dense block lands in the hex map…
    expect(table.hexEntries.get(126_349)).toBe('Hex Tail 126349');
    // …and an all-digit token stays decimal (no 0x00126350 collision).
    expect(table.decimalEntries.get(126_350)).toBe('Padded Sparse Next');
    expect(table.crossFormCollisionCount).toBe(0);
    expect(table.crossFormValueMismatchCount).toBe(0);
    expect(table.decimalRecordCount).toBe(8);
    expect(table.hexRecordCount).toBe(1);
    expect(table.recordCount).toBe(10);
    expect(table.nonBlankMiddleLineCount).toBe(1);
  });

  it('reads records as key / blank / value and tolerates unpadded indices', () => {
    const table = parseLangBuffer(
      langBuffer('1:Mobs\r\n0\r\n\r\nSoup Dragon\r\n00000001\r\n\r\nGuard\r\n'),
    );
    expect(table.category).toBe('Mobs');
    expect(table.decimalEntries.get(0)).toBe('Soup Dragon');
    expect(table.decimalEntries.get(1)).toBe('Guard');
    expect(table.recordCount).toBe(2);
    expect(table.nonBlankMiddleLineCount).toBe(0);
  });

  it('parses a header-only file to an empty table (30 of the 5,132 files are)', () => {
    const table = parseLangBuffer(langBuffer('1:WizQst1234\r\n'));
    expect(table.category).toBe('WizQst1234');
    expect(table.decimalEntries.size).toBe(0);
    expect(table.hexEntries.size).toBe(0);
    expect(table.recordCount).toBe(0);
  });

  it('keeps a table where every record has a non-blank middle column (MobDescriptions shape)', () => {
    // `MobDescriptions.lang` is `{index}\r\n{name}\r\n{description}\r\n` with no
    // blank lines at all — the value is still the third line of each record.
    const table = parseLangBuffer(
      langBuffer(
        '1:MobDescriptions\r\n100322\r\nDishonored Samoorai\r\nFull of a cold rage.\r\n100323\r\nCursed Ronin\r\nQuietly haunts the Village of Sorrow.\r\n',
      ),
    );
    expect(table.decimalEntries.get(100_322)).toBe('Full of a cold rage.');
    expect(table.decimalEntries.get(100_323)).toBe('Quietly haunts the Village of Sorrow.');
    expect(table.recordCount).toBe(2);
    expect(table.nonBlankMiddleLineCount).toBe(2);
  });

  it('keeps named-key tables (Chat.lang / ChooseFriendSWF.lang shape)', () => {
    // 79 of the 5,132 tables are keyed by name; they use the same three-line
    // record shape, so a numeric-only index rule would drop them all.
    const table = parseLangBuffer(
      langBuffer(
        '1:ChooseFriendSWF\r\nChooseFriendTitle\r\nThe title for the window\r\nChoose Your Friend\r\nYesBtn\r\nThe Yes button\r\nYes\r\n',
      ),
    );
    expect(table.decimalEntries.size).toBe(0);
    expect(table.hexEntries.size).toBe(0);
    expect(table.namedEntries.get('ChooseFriendTitle')).toBe('Choose Your Friend');
    expect(table.namedEntries.get('YesBtn')).toBe('Yes');
    expect(table.namedRecordCount).toBe(2);
    expect(table.recordCount).toBe(2);
  });

  it('keeps a numeric token too large for a JS number as a named record', () => {
    // Defensive edge (never measured in the corpus): the token is hex-shaped but
    // 0xFFFFFFFFFFFFFFFFFF exceeds Number.MAX_SAFE_INTEGER, so it cannot be a
    // lookup key — the record is kept, not dropped, and stays fully accounted for.
    const table = parseLangBuffer(langBuffer('1:QuestTitle\r\nFFFFFFFFFFFFFFFFFF\r\n\r\nHuge\r\n'));
    expect(table.hexEntries.size).toBe(0);
    expect(table.namedEntries.get('FFFFFFFFFFFFFFFFFF')).toBe('Huge');
    expect(table.namedRecordCount).toBe(1);
    expect(table.recordCount).toBe(1);
  });

  it('resolves a named key through createKeyLookup (name may contain underscores)', () => {
    const table = parseLangBuffer(
      langBuffer('1:CharCreation\r\nCLASS_ANSWER_1_A_1\r\n\r\n...by myself\r\n'),
    );
    const lookup = createKeyLookup(new Map(), new Map([[table.category, table.namedEntries]]));
    expect(lookup('CharCreation_CLASS_ANSWER_1_A_1')).toBe('...by myself');
    expect(lookup('CharCreation_Nope')).toBeUndefined();
    // Without the named map the form-matched rule alone finds nothing.
    expect(createKeyLookup(new Map())('CharCreation_CLASS_ANSWER_1_A_1')).toBeUndefined();
  });

  it('counts a same-form collision instead of silently duplicating a row', () => {
    const table = parseLangBuffer(
      langBuffer('1:ZoneLocName\r\n0\r\nDesc\r\nFirst Value\r\n00000000\r\n\r\nSecond Value\r\n'),
    );
    // `0` and `00000000` are the same decimal form and the same index; the later
    // record wins and the overwrite is reported (measured: `ZoneLocName.lang`
    // has a 3-line head that repeats index 0 — see the dry-run report).
    expect(table.decimalEntries.get(0)).toBe('Second Value');
    expect(table.decimalEntries.size).toBe(1);
    expect(table.sameFormCollisionCount).toBe(1);
    expect(table.crossFormCollisionCount).toBe(0);
    expect(table.collisionCount).toBe(1);
  });

  it('counts a cross-form collision and keeps both values addressable', () => {
    const table = parseLangBuffer(
      langBuffer(
        '1:QuestTitle\r\n126346\r\n\r\nLetters of Light\r\n1ED8A\r\n\r\nForged in Fire\r\n',
      ),
    );
    expect(table.decimalEntries.get(126_346)).toBe('Letters of Light');
    expect(table.hexEntries.get(126_346)).toBe('Forged in Fire');
    expect(table.crossFormCollisionCount).toBe(1);
    expect(table.crossFormValueMismatchCount).toBe(1);
    expect(table.sameFormCollisionCount).toBe(0);
    expect(table.collisionCount).toBe(1);
    expect(table.entries.size).toBe(1);
    expect(resolveLangKey('QuestTitle_126346', table)).toBe('Letters of Light');
    expect(resolveLangKey('QuestTitle_1ED8A', table)).toBe('Forged in Fire');

    // The same index written both ways with the *same* value is a collision but
    // not a mismatch — nothing can resolve to a wrong name there.
    const equal = parseLangBuffer(
      langBuffer('1:QuestTitle\r\n126346\r\n\r\nSame Title\r\n1ED8A\r\n\r\nSame Title\r\n'),
    );
    expect(equal.crossFormCollisionCount).toBe(1);
    expect(equal.crossFormValueMismatchCount).toBe(0);
  });

  it('falls back across forms when only one form exists (both directions)', () => {
    const hexOnly = parseLangBuffer(
      langBuffer('1:QuestTitle\r\n1ED8D\r\n\r\nQuest for Perfection\r\n'),
    );
    expect(hexOnly.decimalEntries.size).toBe(0);
    expect(resolveLangKey('QuestTitle_1ED8D', hexOnly)).toBe('Quest for Perfection');
    // An all-digit key of the same numeric index still resolves.
    expect(resolveLangKey('QuestTitle_00126349', hexOnly)).toBe('Quest for Perfection');
    expect(resolveLangKey('QuestTitle_FFFFFF', hexOnly)).toBeUndefined();

    const decimalOnly = parseLangBuffer(
      langBuffer('1:QuestTitle\r\n00001717\r\n\r\nGrim Tales\r\n'),
    );
    expect(decimalOnly.hexEntries.size).toBe(0);
    expect(resolveLangKey('QuestTitle_00001717', decimalOnly)).toBe('Grim Tales');
    // A hex-shaped key of the same numeric index still resolves.
    expect(resolveLangKey('QuestTitle_6B5', decimalOnly)).toBe('Grim Tales');
  });

  it('skips a leading non-index line and keeps later records', () => {
    const table = parseLangBuffer(
      langBuffer('1:Items\r\nnoise line\r\n00000000\r\n\r\nReal Value\r\n'),
    );
    expect(table.decimalEntries.get(0)).toBe('Real Value');
  });
});
