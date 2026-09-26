import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * `.lang` string-table parser — task 1.4e
 * ([plan-phase-1-foundation.md](../../../../docs/plan-phase-1-foundation.md) §1.4e,
 * [spec-domain-reference.md](../../../../docs/spec-domain-reference.md) L662-695,
 * decision **D33(d)/(e)**).
 *
 * Format (measured, spike 1.4a §5): **UTF-16LE with BOM `\xFF\xFE`**, header line
 * `1:{Category}`, then repeating records
 *
 * ```
 * {key}\r\n{middle}\r\n{value}\r\n
 * ```
 *
 * Scope is `Locale/en-US/*.lang` only — 5,132 files / 25.9 MB of the 33,932
 * files / 185 MB across all eight locales (D33(c)).
 *
 * ## Key resolution is FORM-MATCHED — two earlier readings are retracted here
 *
 * A key is `{Category}_{suffix}` and the suffix is written in one of **two
 * lexical forms**: all-digit (`126346`, `00001717` — the form the corpus's
 * `m_displayName` uses everywhere: `Items_00022716`, `NPCs_01749407`) or hex
 * (`1ED8A`). Both forms index **one** numeric space, and the same numeric index
 * can be written both ways **with different values**. Measured in the committed
 * fixture `server/test/fixtures/en-US_QuestTitle.lang`:
 *
 * ```
 * QuestTitle_126346             (decimal token)    → "Letters of Light"
 * QuestTitle_1ED8A  (0x1ED8A = 126346, hex token) → "Forged in Fire"
 * QuestTitle_1ED8D  (0x1ED8D = 126349, hex token) → "Quest for Perfection"
 * ```
 *
 * Two earlier readings of this file are **wrong and retracted**:
 *
 * 1. Spike 1.4a skipped A–F-containing index tokens while reading, saw 2,238 of
 *    the file's 5,959 records, and concluded that `QuestTitle_1ED8D` was absent
 *    and that `1ED8A` resolved to "Letters of Light". Both claims were artefacts
 *    of that skip: `1ED8D` **is** present, and "Letters of Light" belongs to the
 *    decimal token `126346`.
 * 2. The first version of this module read **every** token through one numeric
 *    ladder into a single `entries: Map<number, string>` ("later record wins").
 *    That collapses the two records above onto one numeric key, so
 *    `QuestTitle_126346` — a real `m_displayName` form — resolved to "Forged in
 *    Fire". On today's corpus it happens to agree with the correct answer for all
 *    315 keyed quests (0 disagreements) only because the hex record comes later
 *    in this file; it is latently wrong for every decimal-written friendly name
 *    whose category also writes the index in hex.
 *
 * The rule implemented instead — and the one `scripts/sync-dry-run.ts` is
 * measured against:
 *
 *  - a suffix written in **hex form** (it contains `A–F`, so `^\d+$` fails) looks
 *    up `hexEntries` first, then the same numeric index in `decimalEntries`;
 *  - a suffix written in **decimal form** (`^\d+$`) looks up `decimalEntries`
 *    first, then the same numeric index in `hexEntries`;
 *  - a suffix that is neither (named-key tables) → `undefined` → raw-key fallback.
 *
 * The two forms therefore live in **two separate maps** and never overwrite each
 * other. `entries` still exists as a *merged* numeric view (later record wins
 * across both forms); it is for counting/reporting only — handing it to a lookup
 * is precisely the bug above.
 *
 * ## The "dense block + sparse tail" model is retracted too
 *
 * The file used to be described as a dense `0–2237` block plus a sparse numeric
 * tail reaching `199272`. That is the **decimal-only projection**: in the fixture
 * the first 1,473 records are decimal-written, the first hex token appears at
 * record 1,473, and the two forms then interleave (the last decimal record sits
 * at position 5,408, 551 records from the end). There is one index space and one
 * interleaved record stream; only the lexical form varies — 26 numeric indices in
 * the fixture are written both ways with different values.
 */

/** UTF-16LE byte-order mark (spike 1.4a §5). */
export const UTF16LE_BOM = Buffer.from([0xff, 0xfe]);

/** UTF-16BE BOM — never seen in this corpus; rejected explicitly. */
export const UTF16BE_BOM = Buffer.from([0xfe, 0xff]);

/** The header line: `1:{Category}`. */
const HEADER_PATTERN = /^\d+:(.*)$/;

/** The hex charset (any case) — the `A–F`-containing reading of an index token. */
const HEX_TOKEN_PATTERN = /^[0-9A-Fa-f]+$/;

/** All-digit index tokens take the decimal reading. */
const DECIMAL_TOKEN_PATTERN = /^\d+$/;

/** Which lexical form an index token is written in. */
export type LangKeyForm = 'decimal' | 'hex';

/** The two form-keyed maps a `{Category}` lookup needs (see the module doc). */
export interface LangEntryMaps {
  /** Tokens matching `^\d+$`, keyed by decimal value (`126346`, `00001717` → 1717). */
  decimalEntries: Map<number, string>;
  /** Tokens containing `A–F`, keyed by hex value (`1ED8A` → 126346). */
  hexEntries: Map<number, string>;
}

/**
 * The lexical form of an index token — the form half of the fix in one function.
 *
 * `^\d+$` → `'decimal'`; a token that is otherwise all hex characters (`A–F` in
 * any case: `1ED8A`, `1ed8d`, the GUI table's `d`) → `'hex'`; anything else
 * (`Pixie`, `ChooseFriendTitle`, the empty string) → `undefined`, i.e. a named key.
 */
export function langKeyForm(token: string): LangKeyForm | undefined {
  const trimmed = token.trim();
  if (trimmed === '') {
    return undefined;
  }
  if (DECIMAL_TOKEN_PATTERN.test(trimmed)) {
    return 'decimal';
  }
  if (HEX_TOKEN_PATTERN.test(trimmed)) {
    return 'hex';
  }
  return undefined;
}

/** Distinct numeric indices across both form maps (the merged `entries.size`). */
export function langEntryCount(maps: LangEntryMaps): number {
  let count = maps.hexEntries.size;
  for (const index of maps.decimalEntries.keys()) {
    if (!maps.hexEntries.has(index)) {
      count += 1;
    }
  }
  return count;
}

export interface LangTable extends LangEntryMaps {
  /** Category from the header (`1:QuestTitle` → `QuestTitle`). */
  category: string;
  /**
   * **Merged** numeric view: later record wins across **both** forms. Kept for
   * counting/reporting (`entries.size`, `collisionCount`) — never use it for
   * lookups; a decimal token and a hex token with the same numeric index and
   * different values collapse here (see the module doc).
   */
  entries: Map<number, string>;
  /** Records whose index token was non-empty (5,959 for `QuestTitle.lang`). */
  recordCount: number;
  /** Records read with the decimal form (2,238 for `QuestTitle.lang`). */
  decimalRecordCount: number;
  /** Records read with the hex form — the token contained `A–F`. */
  hexRecordCount: number;
  /** Records whose index was already present in their **own** form map. */
  sameFormCollisionCount: number;
  /**
   * Distinct numeric indices written in **both** forms in this file (`126346`
   * written as `126346` and as `1ED8A` counts once) — the cross-form exposure.
   */
  crossFormCollisionCount: number;
  /**
   * Of `crossFormCollisionCount`, the ones where the two forms carry **different
   * values** — the cases where a merged lookup returns a wrong name.
   */
  crossFormValueMismatchCount: number;
  /**
   * Named-key records (`ChooseFriendTitle` → `Choose Your Friend`) — the 79
   * tables keyed by name rather than by numeric index. `string_table.key` is TEXT,
   * so these are storable as `{Category}_{name}`.
   */
  namedEntries: Map<string, string>;
  /** Records with a named key (`namedEntries.size` plus name collisions). */
  namedRecordCount: number;
  /** Records whose named key overwrote an earlier record with the same key. */
  namedCollisionCount: number;
  /**
   * Records whose **middle line is non-blank**.
   *
   * The record shape is `{key}\r\n{middle}\r\n{value}\r\n`: the middle line
   * is empty in most tables (`QuestTitle`, `Items`, `GUI`, `Spell`) but carries a
   * secondary label in others (`MobDescriptions.lang` = the mob name above the
   * description, `ZoneLocName.lang` = "Quest location name (autogenerated)").
   * It is not a separator, and a non-blank middle line does **not** misalign the
   * parse (the stride is fixed at three lines).
   */
  nonBlankMiddleLineCount: number;
  /**
   * Records whose numeric index overwrote an earlier record in the **merged**
   * view (any form). This is the figure the dry run has always printed (26 for
   * `QuestTitle.lang`, 298 locale-wide) — kept so runs stay comparable, not a
   * count of lookups that can go wrong (see `crossFormCollisionCount`).
   */
  collisionCount: number;
  /** Raw byte length of the parsed buffer. */
  byteLength: number;
  /** `true` when the buffer carried the UTF-16LE BOM. */
  hasBom: boolean;
}

export interface ParseLangOptions {
  /**
   * Category to use when the header line is missing/malformed. Production
   * `.lang` files always carry `1:{Category}`; this exists for defensive use.
   */
  categoryFallback?: string;
}

/** Strips the UTF-16LE BOM (when present) and decodes the body. */
export function decodeLangBuffer(buffer: Buffer | Uint8Array): {
  text: string;
  hasBom: boolean;
} {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (bytes.length >= 2 && bytes[0] === UTF16BE_BOM[0] && bytes[1] === UTF16BE_BOM[1]) {
    throw new Error(
      'Unsupported .lang encoding: UTF-16BE BOM (0xFE 0xFF). The Imlight corpus is UTF-16LE (0xFF 0xFE).',
    );
  }
  const hasBom = bytes.length >= 2 && bytes[0] === UTF16LE_BOM[0] && bytes[1] === UTF16LE_BOM[1];
  const body = hasBom ? bytes.subarray(2) : bytes;
  return { text: body.toString('utf16le'), hasBom };
}

/**
 * Pure suffix→index conversion — the *numeric value* of a suffix, regardless of
 * which form was written: all-digit → decimal, otherwise → hex. `undefined` when
 * the suffix is neither.
 *
 * ```
 * langKeyToIndex('1ED8D') === 126349   // 0x1ED8D, the spec's worked example
 * langKeyToIndex('00001717') === 1717  // padded decimal (the m_displayName form)
 * ```
 *
 * This is the AC#6 mapping only. It deliberately does **not** decide which record
 * to read — form-aware resolution is `resolveLangKey`, which needs
 * `langKeyForm(suffix)` and the two maps, never this function alone.
 */
export function langKeyToIndex(suffix: string): number | undefined {
  const token = suffix.trim();
  if (token === '') {
    return undefined;
  }
  if (DECIMAL_TOKEN_PATTERN.test(token)) {
    const decimal = Number(token);
    return Number.isSafeInteger(decimal) ? decimal : undefined;
  }
  if (HEX_TOKEN_PATTERN.test(token)) {
    const hex = Number.parseInt(token, 16);
    return Number.isSafeInteger(hex) ? hex : undefined;
  }
  return undefined;
}

/** The `{suffix}` half of a `{Category}_{suffix}` key (split on the last `_`). */
export function langKeySuffix(key: string): string | undefined {
  const separator = key.lastIndexOf('_');
  if (separator <= 0 || separator === key.length - 1) {
    return undefined;
  }
  return key.slice(separator + 1);
}

/** The `{Category}` half of a `{Category}_{suffix}` key. */
export function langKeyCategory(key: string): string | undefined {
  const separator = key.lastIndexOf('_');
  if (separator <= 0) {
    return undefined;
  }
  return key.slice(0, separator);
}

/**
 * Inverse of `langKeyToIndex`: builds a canonical `{Category}_{index}` key. The
 * default style is the 8-digit zero-padded decimal the corpus uses in
 * `m_displayName` values (`Items_00022716`, `QuestTitle_00001717`); pass
 * `{ style: 'hex' }` for the hex-written form (`QuestTitle_1ED8D`).
 *
 * Caveat: an index whose hex spelling happens to be all digits (`0x1234` →
 * `1234`) is indistinguishable from the decimal form — `langKeyForm('1234')` is
 * `'decimal'`. The corpus's hex tokens are ≥ 5 digits with an `A–F`, so this does
 * not bite the measured data, but it is why the form is read from the token, not
 * inferred from the number.
 */
export function formatLangKey(
  category: string,
  index: number,
  options: { style?: 'decimal' | 'hex'; pad?: number } = {},
): string {
  const style = options.style ?? 'decimal';
  const token =
    style === 'hex'
      ? index.toString(16).toUpperCase()
      : String(index).padStart(options.pad ?? 8, '0');
  return `${category}_${token}`;
}

/**
 * A form-aware lookup: either the two maps themselves (any `LangEntryMaps` —
 * including a whole `LangTable`) or a function `(index, form) => value`.
 */
export type LangLookup = LangEntryMaps | ((index: number, form: LangKeyForm) => string | undefined);

function asLookupFn(lookup: LangLookup): (index: number, form: LangKeyForm) => string | undefined {
  if (typeof lookup === 'function') {
    return lookup;
  }
  return (index, form) =>
    (form === 'decimal' ? lookup.decimalEntries : lookup.hexEntries).get(index);
}

/**
 * Resolves `{Category}_{suffix}` **form-matched**: a hex-written suffix reads the
 * hex map first and a decimal-written suffix the decimal map first; only when the
 * token's own form is absent is the other form's numeric equivalent tried (a real
 * fallback — some records exist in only one form). Neither → `undefined`, and the
 * caller shows the raw key (a miss is normal, [spec-domain-reference.md] L694-695).
 *
 * ```
 * resolveLangKey('QuestTitle_126346', table) → "Letters of Light"   // decimal
 * resolveLangKey('QuestTitle_1ED8A',  table) → "Forged in Fire"     // hex, same index
 * resolveLangKey('QuestTitle_1ED8D',  table) → "Quest for Perfection"
 * resolveLangKey('QuestTitle_FFFFFF', table) → undefined            // absent
 * ```
 */
export function resolveLangKey(key: string, lookup: LangLookup): string | undefined {
  const suffix = langKeySuffix(key);
  if (suffix === undefined) {
    return undefined;
  }
  const form = langKeyForm(suffix);
  if (form === undefined) {
    return undefined;
  }
  const index = form === 'decimal' ? Number(suffix) : Number.parseInt(suffix, 16);
  if (!Number.isSafeInteger(index)) {
    return undefined;
  }
  const get = asLookupFn(lookup);
  const primaryForm = get(index, form);
  if (primaryForm !== undefined) {
    return primaryForm;
  }
  return get(index, form === 'decimal' ? 'hex' : 'decimal');
}

/**
 * `true` when the line can start a record.
 *
 * Three key forms exist in the corpus, all in the same three-line record shape
 * `{key}\r\n{middle}\r\n{value}\r\n`:
 *
 *  - zero-padded decimal (`00000000`, `QuestTitle.lang` and ~5,050 more);
 *  - hex (`1ED8D`, interleaved with the decimal tokens from record 1,473 on in
 *    `QuestTitle.lang`);
 *  - **named** (`ChooseFriendTitle` in `ChooseFriendSWF.lang`, `CLASS_ANSWER_1_A_1`
 *    in `CharCreation.lang`, `QuestFinder` in `QuestTitle.lang`) — 79 tables are
 *    named-keyed and would be dropped entirely by a numeric-only rule.
 *
 * A line qualifies when it is a single token that is either hex-shaped or starts
 * with a letter. Multi-word values (`Quest location name (autogenerated)`,
 * `<ITALICS>You find…`) never qualify, so they are not mistaken for a first index.
 */
function isIndexToken(line: string): boolean {
  const token = line.trim();
  if (token === '' || /\s/.test(token)) {
    return false;
  }
  return HEX_TOKEN_PATTERN.test(token) || /^[A-Za-z]/.test(token);
}

/**
 * Parses one `.lang` buffer.
 *
 * The record layout is positional and three lines wide —
 * `{key}\r\n{middle}\r\n{value}\r\n` — because an empty value would otherwise
 * swallow the next key (spike 1.4a §5: "indices are not always zero-padded";
 * `QuestTitle.lang` has records with an empty value). Reading starts at the first
 * line after the header that parses as an index token and then strides by three;
 * the middle line is a secondary label (empty in most tables, a name/description
 * in others) and is reported through `nonBlankMiddleLineCount`.
 *
 * Each numeric record lands in its **form** map (`decimalEntries` for `^\d+$`
 * tokens, `hexEntries` for `A–F`-containing ones) and the two maps are merged
 * into `entries` only for counting. Collisions are reported at three levels: a
 * record overwriting its own form, a numeric index written in both forms, and —
 * the dangerous subset — the same index written in both forms with different
 * values.
 *
 * The three-line shape is verified against real cross-references: a Wizard City
 * tutorial quest (`Tutorials/WC-PreCel-MAIN-001`) carries
 * `m_locationName: "ZoneLocName_595390"` with the *Diego the Duelmaster* portrait
 * and `m_zoneTag: "WizardCity/WC_Ravenwood"`, and this parser resolves that key to
 * `"Wizard City|Unicorn Way"` — the third line. Pairing the index with the
 * preceding line instead would yield `"MooShu|Cave of Solitude"`.
 */
export function parseLangBuffer(
  buffer: Buffer | Uint8Array,
  options: ParseLangOptions = {},
): LangTable {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const { text, hasBom } = decodeLangBuffer(bytes);
  const lines = text.split(/\r\n|\n/);
  const [firstLine = '', ...rest] = lines;
  const header = firstLine.trim();
  const match = HEADER_PATTERN.exec(header);
  // Without a recognisable header the whole buffer is body (the fallback path).
  const body = match ? rest : lines;
  const category = match?.[1] || options.categoryFallback;
  if (category === undefined || category === '') {
    throw new Error(
      `Not a .lang string table: first line is ${JSON.stringify(header)} but expected "1:{Category}" ` +
        `(e.g. "1:QuestTitle"). Pass { categoryFallback } when the header is known to be absent.`,
    );
  }

  let start = 0;
  while (start < body.length && !isIndexToken(body[start])) {
    start += 1;
  }

  const decimalEntries = new Map<number, string>();
  const hexEntries = new Map<number, string>();
  const entries = new Map<number, string>();
  const namedEntries = new Map<string, string>();
  let namedCollisionCount = 0;
  let recordCount = 0;
  let decimalRecordCount = 0;
  let hexRecordCount = 0;
  let nonBlankMiddleLineCount = 0;
  let sameFormCollisionCount = 0;
  let collisionCount = 0;

  for (let i = start; i + 1 < body.length; i += 3) {
    const token = body[i].trim();
    const separator = body[i + 1];
    const value = body[i + 2] ?? '';
    if (token === '') {
      continue;
    }
    recordCount += 1;
    if (separator.trim() !== '') {
      nonBlankMiddleLineCount += 1;
    }
    const form = langKeyForm(token);
    if (form === undefined) {
      if (namedEntries.has(token)) {
        namedCollisionCount += 1;
      }
      namedEntries.set(token, value);
      continue;
    }
    const index = form === 'decimal' ? Number(token) : Number.parseInt(token, 16);
    if (!Number.isSafeInteger(index)) {
      // Numeric-looking but too large for a JS number (defensive; the real corpus
      // is far below 2^53). Keep it in the named map rather than dropping the
      // record, so `recordCount` stays fully accounted for.
      if (namedEntries.has(token)) {
        namedCollisionCount += 1;
      }
      namedEntries.set(token, value);
      continue;
    }
    if (form === 'decimal') {
      decimalRecordCount += 1;
      if (decimalEntries.has(index)) {
        sameFormCollisionCount += 1;
      }
      decimalEntries.set(index, value);
    } else {
      hexRecordCount += 1;
      if (hexEntries.has(index)) {
        sameFormCollisionCount += 1;
      }
      hexEntries.set(index, value);
    }
    // Merged view (counting only): a record that lands on an index any form has
    // already written is the collision figure the dry run reports.
    if (entries.has(index)) {
      collisionCount += 1;
    }
    entries.set(index, value);
  }

  // Cross-form collisions are counted per numeric index, so a pair counts once
  // regardless of how many records each form wrote for that index.
  let crossFormCollisionCount = 0;
  let crossFormValueMismatchCount = 0;
  for (const [index, value] of decimalEntries) {
    const hexValue = hexEntries.get(index);
    if (hexValue === undefined) {
      continue;
    }
    crossFormCollisionCount += 1;
    if (hexValue !== value) {
      crossFormValueMismatchCount += 1;
    }
  }

  return {
    category,
    decimalEntries,
    hexEntries,
    entries,
    recordCount,
    decimalRecordCount,
    hexRecordCount,
    sameFormCollisionCount,
    crossFormCollisionCount,
    crossFormValueMismatchCount,
    namedEntries,
    namedRecordCount: namedEntries.size + namedCollisionCount,
    namedCollisionCount,
    nonBlankMiddleLineCount,
    collisionCount,
    byteLength: bytes.length,
    hasBom,
  };
}

export interface LangDirDeps {
  readdir: (dir: string) => Promise<string[]>;
  readFile: (file: string) => Promise<Buffer>;
}

export const defaultLangDirDeps: LangDirDeps = {
  readdir: (dir) => readdir(dir),
  readFile: (file) => readFile(file),
};

export interface ScanLangDirResult {
  /** One parsed table per `*.lang` file, ordered by file name. */
  tables: Array<{ file: string } & LangTable>;
  /** Total `*.lang` files parsed. */
  fileCount: number;
  /** Total bytes of those files. */
  byteCount: number;
  /**
   * Sum of `entries.size` across tables — the **merged** numeric `string_table`
   * row count (a numeric index written in both forms counts once). Kept as the
   * comparable figure; the two form maps together hold every row.
   */
  rowCount: number;
  /** Same, counting only non-empty values (empty strings are corpus noise). */
  nonEmptyRowCount: number;
  /** Named-key records across all tables (`ChooseFriendTitle` → `Choose Your Friend`). */
  namedRowCount: number;
  /** Records whose middle line carried a secondary label (a third column). */
  namedRecordCount: number;
  /** Merged-view overwrites, summed per file (298 locale-wide). */
  collisionCount: number;
  /** Own-form overwrites, summed per file (270 locale-wide). */
  sameFormCollisionCount: number;
  /** Distinct cross-form indices, summed per file (28 locale-wide: 26 + 2). */
  crossFormCollisionCount: number;
  /** Of those, the ones whose two values differ (28 locale-wide). */
  crossFormValueMismatchCount: number;
  /** `decimalEntries`/`hexEntries` merged per category — the maps lookups need. */
  byCategory: Map<string, LangEntryMaps>;
  /** `namedEntries` merged per category. */
  namedByCategory: Map<string, Map<string, string>>;
  /** Files that could not be parsed. A corrupt locale file must not abort a sync. */
  errors: Array<{ file: string; message: string }>;
}

export interface ScanLangDirOptions {
  deps?: Partial<LangDirDeps>;
  /** Bounded read concurrency — 5,132 small files on the real corpus. */
  concurrency?: number;
}

/**
 * Parses every `*.lang` in a locale directory (production:
 * `{tempDir}/Locale/en-US`) and merges the two form maps per category.
 *
 * Injected filesystem so unit tests run against tiny synthetic directories and
 * so nothing in the test suite reads the real unpack tree.
 */
export async function scanLangDir(
  localeDir: string,
  options: ScanLangDirOptions = {},
): Promise<ScanLangDirResult> {
  const deps: LangDirDeps = { ...defaultLangDirDeps, ...options.deps };
  const concurrency = Math.max(1, options.concurrency ?? 32);

  let names: string[];
  try {
    names = (await deps.readdir(localeDir)).filter((name) => name.endsWith('.lang')).sort();
  } catch (error) {
    throw new Error(
      `Could not list .lang files under ${localeDir}: ${
        error instanceof Error ? error.message : String(error)
      }. Expected the unpacked tree's Locale/en-US directory.`,
    );
  }

  const tables: ScanLangDirResult['tables'] = [];
  const errors: ScanLangDirResult['errors'] = [];
  let byteCount = 0;
  let rowCount = 0;
  let nonEmptyRowCount = 0;
  let namedRecordCount = 0;
  let namedRowCount = 0;
  let collisionCount = 0;
  let sameFormCollisionCount = 0;
  let crossFormCollisionCount = 0;
  let crossFormValueMismatchCount = 0;

  for (let offset = 0; offset < names.length; offset += concurrency) {
    const batch = names.slice(offset, offset + concurrency);
    const parsed = await Promise.all(
      batch.map(async (name) => {
        const file = path.join(localeDir, name);
        try {
          const buffer = await deps.readFile(file);
          const table = parseLangBuffer(buffer, {
            categoryFallback: path.basename(name, '.lang'),
          });
          return { file, table, size: buffer.byteLength };
        } catch (error) {
          errors.push({ file, message: error instanceof Error ? error.message : String(error) });
          return undefined;
        }
      }),
    );
    for (const entry of parsed) {
      if (!entry) {
        continue;
      }
      tables.push({ file: entry.file, ...entry.table });
      byteCount += entry.size;
      rowCount += entry.table.entries.size;
      namedRecordCount += entry.table.nonBlankMiddleLineCount;
      namedRowCount += entry.table.namedEntries.size;
      collisionCount += entry.table.collisionCount;
      sameFormCollisionCount += entry.table.sameFormCollisionCount;
      crossFormCollisionCount += entry.table.crossFormCollisionCount;
      crossFormValueMismatchCount += entry.table.crossFormValueMismatchCount;
      for (const value of entry.table.entries.values()) {
        if (value !== '') {
          nonEmptyRowCount += 1;
        }
      }
    }
  }

  const byCategory = new Map<string, LangEntryMaps>();
  const namedByCategory = new Map<string, Map<string, string>>();
  for (const table of tables) {
    const merged = byCategory.get(table.category) ?? {
      decimalEntries: new Map<number, string>(),
      hexEntries: new Map<number, string>(),
    };
    for (const [index, value] of table.decimalEntries) {
      merged.decimalEntries.set(index, value);
    }
    for (const [index, value] of table.hexEntries) {
      merged.hexEntries.set(index, value);
    }
    byCategory.set(table.category, merged);

    const mergedNamed = namedByCategory.get(table.category) ?? new Map<string, string>();
    for (const [key, value] of table.namedEntries) {
      mergedNamed.set(key, value);
    }
    namedByCategory.set(table.category, mergedNamed);
  }

  return {
    tables,
    fileCount: tables.length,
    byteCount,
    rowCount,
    nonEmptyRowCount,
    namedRowCount,
    namedRecordCount,
    collisionCount,
    sameFormCollisionCount,
    crossFormCollisionCount,
    crossFormValueMismatchCount,
    byCategory,
    namedByCategory,
    errors,
  };
}

/**
 * Builds the `key → value` resolver the template/quest parsers need: splits the
 * key into `{Category}_{suffix}`, runs the **form-matched** rule
 * (`resolveLangKey`) against that category's two maps, and — when the named
 * tables are supplied — falls back to a named-key lookup.
 *
 * Named keys may themselves contain underscores (`CLASS_ANSWER_1_A_1`), so the
 * named path splits on the **first** underscore instead of the last.
 */
export function createKeyLookup(
  byCategory: Map<string, LangEntryMaps>,
  namedByCategory?: Map<string, Map<string, string>>,
): (key: string) => string | undefined {
  return (key) => {
    const category = langKeyCategory(key);
    if (category !== undefined) {
      const table = byCategory.get(category);
      if (table) {
        const resolved = resolveLangKey(key, table);
        if (resolved !== undefined) {
          return resolved;
        }
      }
    }
    if (!namedByCategory) {
      return undefined;
    }
    const separator = key.indexOf('_');
    if (separator <= 0) {
      return undefined;
    }
    return namedByCategory.get(key.slice(0, separator))?.get(key.slice(separator + 1));
  };
}
