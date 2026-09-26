/**
 * Cross-form collision survey for `.lang` string tables — evidence for the
 * **form-matched** key resolution fix in `server/src/services/sync/lang.ts`.
 *
 * ```
 * npx tsx scripts/lang-collision-survey.ts                       # /tmp/wad-spike
 * npx tsx scripts/lang-collision-survey.ts --tree /tmp/wad-spike
 * npx tsx scripts/lang-collision-survey.ts --locale /tmp/wad-spike/Locale/en-US
 * npx tsx scripts/lang-collision-survey.ts --examples=5
 * ```
 *
 * For every `Locale/en-US/*.lang` it counts numeric indices written **both** as
 * an all-digit (decimal) token and as a hex token — `126346` vs `1ED8A` — per
 * category, and prints concrete `decimalToken → value` / `hexToken → value`
 * examples for the categories that have any. That is the exposure figure behind
 * the fix: wherever such a pair disagrees, a merged numeric lookup ("later record
 * wins") returns the wrong name for one of the two keys, and an all-digit
 * `m_displayName` form (`Items_00022716`) is the realistic victim.
 *
 * Read-only: it parses files, opens no database and writes nothing. The counts
 * come from `parseLangBuffer` (the tested parser); the token spellings in the
 * examples come from a second, token-level read of just the colliding files, and
 * that read is cross-checked against the parsed maps (a `MISMATCH` warning means
 * the two disagree — treat the numbers as suspect).
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  decodeLangBuffer,
  langKeyForm,
  scanLangDir,
  type LangTable,
} from '../server/src/services/sync/index.js';

/**
 * The categories the template/quest parsers actually look up (`m_displayName`,
 * `m_questTitle`). Measured prefixes in the real tree: `Items_00022716`,
 * `Spells_00000424`, `NPCs_01749407`, `WizardMobs_…`, `ZoneLocName_…`; quest
 * titles use `QuestTitle_…`. A cross-form collision in one of these is a *live*
 * wrong friendly name, not a latent one.
 */
const CORPUS_LOOKUP_CATEGORIES = [
  'Items',
  'Spells',
  'NPCs',
  'Mobs',
  'MobDescriptions',
  'ZoneLocName',
  'QuestTitle',
] as const;

/** Parses `--key=value`. */
function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

const TREE =
  flag('tree') ?? process.env.SPIRALDB_LANG_SURVEY_TREE ?? path.join('/tmp', 'wad-spike');
const LOCALE_DIR = flag('locale') ?? path.join(TREE, 'Locale', 'en-US');
const EXAMPLE_LIMIT = Number.isFinite(Number(flag('examples'))) ? Number(flag('examples')) : 3;

function n(value: number): string {
  return value.toLocaleString('en-US');
}

function bytes(value: number): string {
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function heading(text: string): void {
  console.log(`\n${text}`);
}

function field(label: string, value: string): void {
  console.log(`  ${label.padEnd(34)}: ${value}`);
}

interface CollisionExample {
  index: number;
  decimalToken: string;
  decimalValue: string;
  hexToken: string;
  hexValue: string;
}

interface TokenRecord {
  token: string;
  value: string;
}

/** A line that can start a record — the same rule as `parseLangBuffer`'s. */
function isTokenLine(line: string): boolean {
  const token = line.trim();
  if (token === '' || /\s/.test(token)) {
    return false;
  }
  return langKeyForm(token) !== undefined || /^[A-Za-z]/.test(token);
}

/**
 * Second, token-level read of one file: per form map of `index → { token, value }`,
 * later record wins. Deliberately independent of `parseLangBuffer` (which keeps
 * the values but not the token spellings); the caller cross-checks the two.
 */
function readTokenRecords(buffer: Buffer): {
  decimal: Map<number, TokenRecord>;
  hex: Map<number, TokenRecord>;
} {
  const { text } = decodeLangBuffer(buffer);
  const lines = text.split(/\r\n|\n/);
  const header = (lines[0] ?? '').trim();
  const body = /^\d+:/.test(header) ? lines.slice(1) : lines;
  let start = 0;
  while (start < body.length && !isTokenLine(body[start])) {
    start += 1;
  }

  const decimal = new Map<number, TokenRecord>();
  const hex = new Map<number, TokenRecord>();
  for (let i = start; i + 1 < body.length; i += 3) {
    const token = body[i].trim();
    const form = langKeyForm(token);
    if (form === undefined) {
      continue;
    }
    const index = form === 'decimal' ? Number(token) : Number.parseInt(token, 16);
    const record = { token, value: body[i + 2] ?? '' };
    (form === 'decimal' ? decimal : hex).set(index, record);
  }
  return { decimal, hex };
}

/** Numeric indices this file writes in both forms with different values. */
function differingIndices(table: LangTable): number[] {
  const indices: number[] = [];
  for (const [index, value] of table.decimalEntries) {
    const hexValue = table.hexEntries.get(index);
    if (hexValue !== undefined && hexValue !== value) {
      indices.push(index);
    }
  }
  return indices.sort((a, b) => a - b);
}

interface FileSurvey {
  examples: CollisionExample[];
  mismatch?: string;
}

/** Token-level re-read of one colliding file, with a consistency check. */
async function surveyFile(file: string, table: LangTable): Promise<FileSurvey> {
  const tokens = readTokenRecords(await readFile(file));
  if (
    tokens.decimal.size !== table.decimalEntries.size ||
    tokens.hex.size !== table.hexEntries.size
  ) {
    return {
      examples: [],
      mismatch: `map sizes differ (decimal ${tokens.decimal.size}/${table.decimalEntries.size}, hex ${tokens.hex.size}/${table.hexEntries.size})`,
    };
  }
  for (const [index, value] of table.decimalEntries) {
    if (tokens.decimal.get(index)?.value !== value) {
      return { examples: [], mismatch: `decimal index ${index} value differs` };
    }
  }
  for (const [index, value] of table.hexEntries) {
    if (tokens.hex.get(index)?.value !== value) {
      return { examples: [], mismatch: `hex index ${index} value differs` };
    }
  }

  const examples = differingIndices(table).map((index) => ({
    index,
    decimalToken: tokens.decimal.get(index)?.token ?? String(index),
    decimalValue: table.decimalEntries.get(index) ?? '',
    hexToken: tokens.hex.get(index)?.token ?? index.toString(16).toUpperCase(),
    hexValue: table.hexEntries.get(index) ?? '',
  }));
  return { examples };
}

function exampleLine(example: CollisionExample): string {
  return (
    `index ${example.index}: decimal ${example.decimalToken} → ${JSON.stringify(example.decimalValue)}` +
    ` | hex ${example.hexToken} → ${JSON.stringify(example.hexValue)}`
  );
}

const started = process.hrtime.bigint();

console.log('=== SpiralDB UI — .lang cross-form collision survey ===');
field('tree', TREE);
field('locale dir', LOCALE_DIR);
field('example limit', String(EXAMPLE_LIMIT));

const lang = await scanLangDir(LOCALE_DIR);
if (lang.errors.length > 0) {
  for (const error of lang.errors.slice(0, 5)) {
    console.log(`  ERROR ${error.file}: ${error.message}`);
  }
}

interface CategoryStats {
  files: number;
  indicesBothForms: number;
  indicesDifferentValues: number;
  examples: CollisionExample[];
  mismatches: string[];
}

const byCategory = new Map<string, CategoryStats>();
for (const table of lang.tables) {
  const stats = byCategory.get(table.category) ?? {
    files: 0,
    indicesBothForms: 0,
    indicesDifferentValues: 0,
    examples: [],
    mismatches: [],
  };
  stats.files += 1;
  stats.indicesBothForms += table.crossFormCollisionCount;
  stats.indicesDifferentValues += table.crossFormValueMismatchCount;
  if (table.crossFormValueMismatchCount > 0 && stats.examples.length < EXAMPLE_LIMIT) {
    const survey = await surveyFile(table.file, table);
    if (survey.mismatch) {
      stats.mismatches.push(`${path.basename(table.file)}: ${survey.mismatch}`);
    }
    stats.examples.push(...survey.examples.slice(0, EXAMPLE_LIMIT - stats.examples.length));
  }
  byCategory.set(table.category, stats);
}

const colliding = [...byCategory.entries()]
  .filter(([, stats]) => stats.indicesBothForms > 0)
  .sort((a, b) => b[1].indicesBothForms - a[1].indicesBothForms);
const filesWithCollisions = lang.tables.filter((table) => table.crossFormCollisionCount > 0).length;

heading('[totals]');
field(
  'files',
  `${n(lang.fileCount)} (${bytes(lang.byteCount)}, ${n(lang.errors.length)} parse errors)`,
);
field('categories', n(byCategory.size));
field('merged numeric collisions', `${n(lang.collisionCount)} (any overwrite in the merged view)`);
field(
  'same-form collisions',
  `${n(lang.sameFormCollisionCount)} record(s) overwriting their own form`,
);
field(
  'cross-form collisions',
  `${n(lang.crossFormCollisionCount)} index(es) written in both forms, ` +
    `${n(lang.crossFormValueMismatchCount)} with different values`,
);
field('files with a collision', n(filesWithCollisions));
field(
  'categories with a collision',
  `${n(colliding.length)} (${colliding.map(([c]) => c).join(', ') || 'none'})`,
);

heading('[categories with a cross-form collision]');
for (const [category, stats] of colliding) {
  console.log(
    `  ${category.padEnd(24)} files ${String(stats.files).padStart(4)}  ` +
      `bothForms ${String(stats.indicesBothForms).padStart(5)}  ` +
      `differentValues ${String(stats.indicesDifferentValues).padStart(5)}`,
  );
}

heading('[corpus lookup categories — a collision here would be a live wrong name]');
for (const category of CORPUS_LOOKUP_CATEGORIES) {
  const stats = byCategory.get(category);
  console.log(
    `  ${category.padEnd(24)} ${stats ? `${n(stats.indicesBothForms)} cross-form / ${n(stats.indicesDifferentValues)} differing` : 'category not present in this locale'}`,
  );
}

heading('[examples — decimalToken → valueDec, hexToken → valueHex]');
if (colliding.length === 0) {
  console.log('  none: no category writes the same numeric index in both forms');
}
for (const [category, stats] of colliding) {
  console.log(`  ${category} (${n(stats.indicesDifferentValues)} differing indices):`);
  for (const example of stats.examples.slice(0, EXAMPLE_LIMIT)) {
    console.log(`    - ${exampleLine(example)}`);
  }
  if (stats.examples.length === 0) {
    console.log('    - (no example extracted)');
  }
  for (const mismatch of stats.mismatches) {
    console.log(`    ! MISMATCH ${mismatch}`);
  }
}

const milliseconds = Number(process.hrtime.bigint() - started) / 1e6;
heading('[wall clock]');
field(
  'elapsed',
  milliseconds >= 1000 ? `${(milliseconds / 1000).toFixed(1)} s` : `${milliseconds.toFixed(0)} ms`,
);
console.log('');

process.exit(lang.errors.length > 0 ? 1 : 0);
