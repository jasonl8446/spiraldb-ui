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
 * ## Where the real fixture contradicts spike 1.4a / D33(e) — measured, not patched
 *
 * Spike 1.4a read only *all-digit* index tokens and skipped the 3,719 records
 * whose index is written in hex, so it saw 2,238 of the file's 5,959 records and
 * reported that `QuestTitle_1ED8D` (0x1ED8D = 126349) is absent and that
 * `QuestTitle_1ED8A` resolves to "Letters of Light".
 *
 * Both claims are artefacts of that skip:
 *  - `1ED8A` **is** an index token in the file (`Forged in Fire`); "Letters of
 *    Light" belongs to the token `126346`, i.e. index 0x126346 = 1,204,806.
 *  - `1ED8D` **is** present (`Quest for Perfection`), which is exactly what the
 *    spec's worked example predicts.
 *
 * Parsing every index token with the D33(d) ladder restores the table and
 * resolves 315 of 315 keyed corpus quests (see `scripts/sync-dry-run.ts`).
 * The assertions below encode the measured fixture values.
 */

const FIXTURES = fileURLToPath(new URL('../../server/test/fixtures/', import.meta.url));
const QUEST_TITLE_LANG = path.join(FIXTURES, 'en-US_QuestTitle.lang');
const SPARSE_LANG = path.join(FIXTURES, 'lang_sparse_index.lang');

/** Builds a UTF-16LE `.lang` buffer; `withBom` controls the BOM only. */
function langBuffer(text: string, options: { bom?: boolean } = {}): Buffer {
  const body = Buffer.from(text, 'utf16le');
  return options.bom === false ? body : Buffer.concat([UTF16LE_BOM, body]);
}

describe('lang parser — real en-US/QuestTitle.lang fixture (task 1.4e)', () => {
  const buffer = readFileSync(QUEST_TITLE_LANG);
  const table = parseLangBuffer(buffer);

  it('decodes UTF-16LE and reads the category from the header line', () => {
    expect(table.category).toBe('QuestTitle');
    expect(table.hasBom).toBe(true);
    expect(table.byteLength).toBe(313_632);
  });

  it('parses the dense 0–2237 block', () => {
    expect(table.entries.get(0)).toBe('The Bear Truth');
    expect(table.entries.get(1)).toBe('All is Revealed');
    expect(table.entries.get(2)).toBe('Recover the Goods');
    expect(table.entries.get(2236)).toBe('The Monster');
  });

  it('does not stop at the dense block — the sparse tail past 2237 is parsed', () => {
    // The spec's decimal worked examples live in the dense block…
    expect(table.entries.get(1717)).toBe('Grim Tales');
    expect(table.entries.get(1718)).toBe('To Ravenwood!');
    // …while the hex-form quest titles live in the tail (spike 1.4a §5).
    expect(table.entries.has(126_349)).toBe(true);
    expect(table.entries.get(126_349)).toBe('Quest for Perfection');
  });

  it('reads every record: 5,959 records, of which 2,238 use a decimal index token', () => {
    // 2,238 is exactly the entry count spike 1.4a reported — it is the
    // all-digit subset, and the parser must keep the other 3,719 hex records too.
    expect(table.decimalRecordCount).toBe(2_238);
    expect(table.hexRecordCount).toBe(3_719);
    expect(table.recordCount).toBe(5_959);
    expect(table.entries.size).toBe(5_931);
    // Three of the records carry something on the middle line where the rest
    // leave it blank — a third (label/description) column that some tables use
    // (`MobDescriptions.lang`, `ZoneLocName.lang`); it does not misalign a parse.
    expect(table.nonBlankMiddleLineCount).toBe(3);
    // 26 records share an index with another record: an all-digit token takes
    // the decimal reading (D33(d)) and a later hex token can land on the same
    // number, e.g. `126346` (decimal) and `1ED8A` (0x1ED8A = 126346).
    expect(table.collisionCount).toBe(26);
    // Records are fully accounted for: numeric entries + their collisions +
    // named-key records.
    expect(table.entries.size + table.collisionCount + table.namedRecordCount).toBe(
      table.recordCount,
    );
    // Two records are keyed by name rather than by index (a third key form;
    // 79 of the 5,132 tables are keyed entirely this way).
    expect([...table.namedEntries.keys()]).toEqual(['Encounter Test', 'QuestFinder']);
    expect(table.namedEntries.get('QuestFinder')).toBe('Quest Finder');
    expect(table.namedRecordCount).toBe(2);
  });

  it('resolves the spec worked example hex key (1ED8D) — it IS present in this revision', () => {
    // D33(e) recorded this index as absent; the fixture says otherwise.
    expect(resolveLangKey('QuestTitle_1ED8D', table.entries)).toBe('Quest for Perfection');
  });

  it('resolves a real hex key from the sparse tail (1ED8A → Forged in Fire)', () => {
    // Spike 1.4a reported "Letters of Light" here; that value belongs to the
    // decimal-written token `126346` (= index 0x126346), not to `1ED8A`.
    expect(resolveLangKey('QuestTitle_1ED8A', table.entries)).toBe('Forged in Fire');
    expect(resolveLangKey('QuestTitle_1ED8B', table.entries)).toBe('Earn Your Wings');
    expect(table.entries.get(126_346)).toBe('Forged in Fire');
  });

  it('resolves decimal-form keys (m_displayName form) and the D33(d) ladder order', () => {
    expect(resolveLangKey('QuestTitle_00001717', table.entries)).toBe('Grim Tales');
    expect(resolveLangKey('QuestTitle_00001814', table.entries)).toBe('Oh Me, Oh Minotaur');
    expect(resolveLangKey('QuestTitle_1625BF', table.entries)).toBe('Unicorn Way');
  });

  it('falls back to the raw key when the index is missing or the suffix is not numeric', () => {
    expect(resolveLangKey('QuestTitle_ZZZZ', table.entries)).toBeUndefined();
    expect(resolveLangKey('Spells_Pixie', table.entries)).toBeUndefined();
    expect(resolveLangKey('QuestTitle', table.entries)).toBeUndefined();
    expect(resolveLangKey('QuestTitle_1ED8D', new Map())).toBeUndefined();
    // The fallback the callers use: miss → show the raw key
    // ([spec-domain-reference.md] L694-695).
    expect(resolveLangKey('QuestTitle_ZZZZ', table.entries) ?? 'QuestTitle_ZZZZ').toBe(
      'QuestTitle_ZZZZ',
    );
  });

  it('tolerates a missing BOM (same table, no BOM branch)', () => {
    const withoutBom = parseLangBuffer(langBuffer(decodeLangBuffer(buffer).text, { bom: false }));
    expect(withoutBom.hasBom).toBe(false);
    expect(withoutBom.category).toBe('QuestTitle');
    expect(withoutBom.entries.size).toBe(table.entries.size);
    expect(withoutBom.entries.get(126_349)).toBe('Quest for Perfection');
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
    expect(table2.entries.get(0)).toBe('x');
  });
});

describe('lang parser — pure key/index conversion (P1 AC#6)', () => {
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

  it('splits keys on the last underscore and round-trips through formatLangKey', () => {
    expect(langKeySuffix('QuestTitle_1ED8D')).toBe('1ED8D');
    expect(langKeyCategory('QuestTitle_1ED8D')).toBe('QuestTitle');
    expect(langKeySuffix('QuestTitle')).toBeUndefined();
    expect(formatLangKey('QuestTitle', 1717)).toBe('QuestTitle_00001717');
    expect(formatLangKey('QuestTitle', 126_349, { style: 'hex' })).toBe('QuestTitle_1ED8D');
    // The inverse direction resolves through the same ladder.
    const lookup = new Map([[1717, 'Grim Tales']]);
    expect(resolveLangKey(formatLangKey('QuestTitle', 1717), lookup)).toBe('Grim Tales');
  });
});

describe('lang parser — synthetic sparse-index fixture and record structure', () => {
  it('parses the committed sparse-index fixture (dense + unpadded + sparse tail)', () => {
    const table = parseLangBuffer(readFileSync(SPARSE_LANG));
    expect(table.category).toBe('SparseTest');
    expect(table.hasBom).toBe(true);
    expect(table.entries.get(0)).toBe('Dense Zero');
    expect(table.entries.get(2)).toBe('');
    // Unpadded index "7" (spike 1.4a §5 caveat: indices are not always padded).
    expect(table.entries.get(7)).toBe('Unpadded Seven');
    // The dense-block edge and the sparse tail beyond it.
    expect(table.entries.get(2237)).toBe('Dense Edge');
    expect(table.entries.get(199_157)).toBe('Sparse Tail 199157');
    // A hex index token past the dense block is read as hex…
    expect(table.entries.get(126_349)).toBe('Hex Tail 126349');
    // …and an all-digit token stays decimal (no 0x00126350 collision).
    expect(table.entries.get(126_350)).toBe('Padded Sparse Next');
    expect(table.decimalRecordCount).toBe(8);
    expect(table.hexRecordCount).toBe(1);
    expect(table.recordCount).toBe(10);
    expect(table.nonBlankMiddleLineCount).toBe(1);
  });

  it('reads records as index / blank / value and tolerates unpadded indices', () => {
    const table = parseLangBuffer(
      langBuffer('1:Mobs\r\n0\r\n\r\nSoup Dragon\r\n00000001\r\n\r\nGuard\r\n'),
    );
    expect(table.category).toBe('Mobs');
    expect(table.entries.get(0)).toBe('Soup Dragon');
    expect(table.entries.get(1)).toBe('Guard');
    expect(table.recordCount).toBe(2);
    expect(table.nonBlankMiddleLineCount).toBe(0);
  });

  it('parses a header-only file to an empty table (30 of the 5,132 files are)', () => {
    const table = parseLangBuffer(langBuffer('1:WizQst1234\r\n'));
    expect(table.category).toBe('WizQst1234');
    expect(table.entries.size).toBe(0);
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
    expect(table.entries.get(100_322)).toBe('Full of a cold rage.');
    expect(table.entries.get(100_323)).toBe('Quietly haunts the Village of Sorrow.');
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
    expect(table.entries.size).toBe(0);
    expect(table.namedEntries.get('ChooseFriendTitle')).toBe('Choose Your Friend');
    expect(table.namedEntries.get('YesBtn')).toBe('Yes');
    expect(table.namedRecordCount).toBe(2);
    expect(table.recordCount).toBe(2);
  });

  it('resolves a named key through createKeyLookup (name may contain underscores)', () => {
    const table = parseLangBuffer(
      langBuffer('1:CharCreation\r\nCLASS_ANSWER_1_A_1\r\n\r\n...by myself\r\n'),
    );
    const lookup = createKeyLookup(new Map(), new Map([[table.category, table.namedEntries]]));
    expect(lookup('CharCreation_CLASS_ANSWER_1_A_1')).toBe('...by myself');
    expect(lookup('CharCreation_Nope')).toBeUndefined();
    // Without the named map the numeric ladder alone finds nothing.
    expect(createKeyLookup(new Map())('CharCreation_CLASS_ANSWER_1_A_1')).toBeUndefined();
  });

  it('counts an index collision instead of silently duplicating a row', () => {
    const table = parseLangBuffer(
      langBuffer('1:ZoneLocName\r\n0\r\nDesc\r\nFirst Value\r\n00000000\r\n\r\nSecond Value\r\n'),
    );
    // `0` and `00000000` are the same index through the D33(d) ladder; the later
    // record wins and the overwrite is reported (measured: `ZoneLocName.lang`
    // has a 3-line head that repeats index 0 — see the dry-run report).
    expect(table.entries.get(0)).toBe('Second Value');
    expect(table.entries.size).toBe(1);
    expect(table.collisionCount).toBe(1);
  });

  it('skips a leading non-index line and keeps later records', () => {
    const table = parseLangBuffer(
      langBuffer('1:Items\r\nnoise line\r\n00000000\r\n\r\nReal Value\r\n'),
    );
    expect(table.entries.get(0)).toBe('Real Value');
  });
});
