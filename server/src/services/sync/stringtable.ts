import type { ScanLangDirResult } from './lang.js';

/**
 * `string_table` row construction — task 1.4f, lead decision on key spelling.
 *
 * `string_table.key` is `{Category}_{token}` where **`token` is preserved
 * exactly as written in the `.lang` file** (D33(e)). It is neither normalised to
 * a number nor re-rendered from the parsed integer:
 *
 * ```
 * QuestTitle_126346  → "Letters of Light"   (decimal token, 126346)
 * QuestTitle_1ED8A   → "Forged in Fire"     (hex token, 0x1ED8A = 126346)
 * ```
 *
 * Both are real rows; collapsing them onto the numeric index 126346 would delete
 * one of them and make `QuestTitle_1ED8A` unresolvable. The same rule keeps
 * `Items_00022716` (the zero-padded form the corpus's `m_displayName` uses)
 * byte-identical to the token in the file, so the primary-key lookup in
 * `lookupString` matches verbatim.
 *
 * `value` is copied verbatim too, including an empty string: the column is
 * `NOT NULL`, not "non-empty", and the AC#2 spot-check re-reads the exact token
 * from the real `.lang` file. Empty values are part of the source data.
 */

export interface StringTableRow {
  /** `{Category}_{tokenAsWritten}` — the primary key. */
  key: string;
  /** The record's third line, verbatim (may be `''`). */
  value: string;
  /** The `{Category}` half of the key. */
  category: string;
}

/**
 * Flattens the scanner's exact key space into ordered rows.
 *
 * Ordering is by category then token (both `Array.prototype.sort` defaults) so a
 * run is reproducible; the order carries no meaning for the replace itself.
 */
export function buildStringTableRows(scan: ScanLangDirResult): StringTableRow[] {
  const rows: StringTableRow[] = [];
  for (const category of [...scan.byCategoryKeys.keys()].sort()) {
    const tokens = scan.byCategoryKeys.get(category);
    if (!tokens) {
      continue;
    }
    for (const token of [...tokens.keys()].sort()) {
      rows.push({ key: `${category}_${token}`, value: tokens.get(token) ?? '', category });
    }
  }
  return rows;
}
