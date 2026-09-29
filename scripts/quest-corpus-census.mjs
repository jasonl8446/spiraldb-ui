#!/usr/bin/env node
/**
 * The quest corpus census — the reproduction for every number story **p6-09** cites
 * about the 36-key shape, and the independent re-derivation the lead can run.
 *
 * ```
 * node scripts/quest-corpus-census.mjs [--corpus <dir>] [--db <catalog.db>]
 * ```
 *
 * Defaults: `--corpus $SPIRALDB_PATH/QuestTemplates` (falling back to the D17 clone
 * `data/test-spiraldb`) and `--db data/__test-scratch__/p6-09-catalog.db` (skipped when
 * absent; `better-sqlite3` — a runtime dependency — is imported optionally and only the
 * catalog section needs it):
 *
 * 1. **the key orders in the corpus** — how many files share the canonical 36-key order and
 *    which files deviate (the two 18-key extractor-output files `WC-CYCLOPS-MAIN-002` and
 *    `WC-UNICORN-MAIN-004` are named, because a schema check that validated against one of
 *    them would be validating the extractor's sparse output, not the corpus's shape);
 * 2. **the per-key value profile of the canonical files** — the dominant value per key, which
 *    is what the scaffold's skeleton is derived from (a key that is `null` in 320/320 and a
 *    key that is `0` in 320/320 are different facts, and this prints both);
 * 3. **the corpus's own zero-goal files** — the "no goals yet" precedent the empty containers
 *    are copied from;
 * 4. **the direct-link title-key recovery rate** — of the catalog's `link_kind = 'direct'`
 *    rows, how many reach a `QuestTitle_*` **key** through `quest_ids.title_key` and how many
 *    through a unique reverse lookup of `quests.title` in `string_table`. This is the number
 *    that decides whether a scaffold can write the corpus's own spelling (a key) without
 *    guessing.
 *
 * Exit code 0 always (it is a census, not a gate); a missing input is printed as a skip, but a
 * flag given **without a value** is refused (rc=2) rather than silently measuring the default.
 */

import fs from 'node:fs';
import path from 'node:path';

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  Database = null;
}

/**
 * One flag's value, or `undefined` when the flag is absent.
 *
 * A flag that is present **without** a value is refused rather than defaulted: `--corpus` as the
 * last argument (or followed by another flag) used to read `undefined` and this script then measured
 * the *default* corpus while the caller believed it had named one — a census reporting the wrong
 * population, which is the one failure mode a census must not have.
 */
function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(`Refusing to run: ${flag} was given without a value.`);
    console.error('Usage: node scripts/quest-corpus-census.mjs [--corpus <dir>] [--db <file>]');
    process.exit(2);
  }
  return value;
}

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const corpusDir =
  argValue('--corpus') ??
  path.join(
    process.env.SPIRALDB_PATH ?? path.join(repoRoot, 'data', 'test-spiraldb'),
    'QuestTemplates',
  );
const dbFile =
  argValue('--db') ?? path.join(repoRoot, 'data', '__test-scratch__', 'p6-09-catalog.db');

/**
 * A lenient read of one corpus file: strict `JSON.parse`, then (only when that fails) a regex that
 * drops the corpus's **legacy trailing commas** (`,\n}` → `\n}`).
 *
 * This is **not** the read the app uses. `server/src/services/sync/json.ts` recovers through
 * **JSON5**, which accepts a strictly wider grammar; this script's regex covers only the trailing
 * comma the corpus actually exhibits, so a file that is valid JSON5 for any other reason (comments,
 * unquoted keys, `+`/hex numbers, single quotes) is reported here as `UNPARSABLE` while the app reads
 * it fine. That is a deliberate scope choice for a dependency-free census, not an equivalence claim:
 * an `UNPARSABLE` line means "this regex could not read it", not "the app cannot read it".
 */
function parseQuest(text) {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(text.replace(/,\s*([}\]])/g, '$1'));
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

/* ------------------------------------------------------------------ 1. key orders */

if (!fs.existsSync(corpusDir)) {
  console.log(`SKIP: corpus directory ${corpusDir} is absent`);
} else {
  const files = fs.readdirSync(corpusDir).filter((name) => name.endsWith('.json'));
  const orders = new Map();
  const documents = new Map();
  for (const file of files) {
    let parsed;
    try {
      parsed = parseQuest(fs.readFileSync(path.join(corpusDir, file), 'utf8'));
    } catch (error) {
      console.log(`  UNPARSABLE ${file}: ${error.message}`);
      continue;
    }
    const order = Object.keys(parsed);
    const key = order.join(',');
    orders.set(key, (orders.get(key) ?? 0) + 1);
    documents.set(file, { order, parsed });
  }
  const ranked = [...orders.entries()].sort((a, b) => b[1] - a[1]);

  section(`1. key orders — ${files.length} QuestTemplates/*.json in ${corpusDir}`);
  console.log(`distinct key orders: ${ranked.length}`);
  for (const [order, count] of ranked) {
    console.log(`  ${String(count).padStart(4)} files × ${order.split(',').length} keys`);
  }
  const canonical = ranked[0][0].split(',');
  console.log(`\ncanonical order (${canonical.length} keys), as emitted by p6-09's scaffold:`);
  canonical.forEach((key, index) => console.log(`  ${String(index + 1).padStart(2)}. ${key}`));
  const odd = [...documents.entries()].filter(([, doc]) => doc.order.length !== canonical.length);
  console.log(`\nfiles that do NOT carry the canonical order (${odd.length}):`);
  for (const [file, doc] of odd) {
    console.log(`  ${file}: ${doc.order.length} keys -> ${doc.order.join(',')}`);
  }

  /* --------------------------------------------------- 2. per-key profile */

  const canon = [...documents.values()].filter((doc) => doc.order.length === canonical.length);
  section(`2. per-key value profile over the ${canon.length} canonical files`);
  for (const key of canonical) {
    const values = new Map();
    for (const doc of canon) {
      const value = doc.parsed[key];
      const spelling =
        value === null
          ? 'null'
          : Array.isArray(value)
            ? `array[${value.length}]`
            : typeof value === 'object'
              ? 'object'
              : JSON.stringify(value);
      values.set(spelling, (values.get(spelling) ?? 0) + 1);
    }
    const top = [...values.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([spelling, count]) => `${spelling} ×${count}`)
      .join('  ');
    console.log(`  ${key.padEnd(30)} ${top}`);
  }

  /* --------------------------------------------------- 3. zero-goal precedent */

  const zeroGoal = [...documents.entries()].filter(
    ([, doc]) => Array.isArray(doc.parsed.m_goals) && doc.parsed.m_goals.length === 0,
  );
  section(`3. the corpus's own zero-goal files (the "empty goals/results/dialog" precedent)`);
  console.log(`count: ${zeroGoal.length}`);
  for (const [file, doc] of zeroGoal) {
    const q = doc.parsed;
    const shape = (value) => {
      if (value === null) return 'null';
      if (Array.isArray(value)) return `[${value.length}]`;
      if (typeof value === 'object') {
        return `{${Object.keys(value)
          .map(
            (key) =>
              `${key}: ${Array.isArray(value[key]) ? `[${value[key].length}]` : value[key] === null ? 'null' : typeof value[key]}`,
          )
          .join(', ')}}`;
      }
      return JSON.stringify(value);
    };
    console.log(
      `  ${file}\n` +
        `      startGoals=${shape(q.m_startGoals)} goals=${shape(q.m_goals)} goalLogic=${shape(q.m_goalLogic)}\n` +
        `      startResults=${shape(q.m_startResults)} endResults=${shape(q.m_endResults)} requirements=${shape(q.m_requirements)}\n` +
        `      dialogList=${shape(q.m_dialogList)} questNameID=${JSON.stringify(q.m_questNameID)} questLevel=${JSON.stringify(q.m_questLevel)} isHidden=${JSON.stringify(q.m_isHidden)} activityType=${JSON.stringify(q.m_activityType)}`,
    );
  }
}

/* ------------------------------------------------- 4. direct title-key recovery */

if (Database === null || !fs.existsSync(dbFile)) {
  section('4. direct-link title-key recovery');
  console.log(`SKIP: no readable catalog database at ${dbFile}`);
} else {
  const db = new Database(dbFile, { readonly: true });
  const rows = db
    .prepare(
      `SELECT q.quest_name, q.title, q.has_definition, i.title_key
         FROM quests AS q LEFT JOIN quest_ids AS i ON i.matched_quest_name = q.quest_name
        WHERE q.link_kind = 'direct' ORDER BY q.quest_name`,
    )
    .all();
  const byValue = db.prepare(
    `SELECT key FROM string_table WHERE key LIKE 'QuestTitle\\_%' ESCAPE '\\' AND value = ?`,
  );
  let viaId = 0;
  const unique = [];
  const ambiguous = [];
  const missing = [];
  for (const row of rows) {
    if (row.title_key !== null && row.title_key !== undefined) {
      viaId += 1;
      continue;
    }
    const candidates = byValue.all(row.title);
    if (candidates.length === 1) {
      unique.push({ name: row.quest_name, title: row.title, key: candidates[0].key });
    } else if (candidates.length === 0) {
      missing.push({ name: row.quest_name, title: row.title });
    } else {
      ambiguous.push({
        name: row.quest_name,
        title: row.title,
        keys: candidates.map((c) => c.key),
      });
    }
  }
  section(
    `4. direct-link title-key recovery — ${rows.length} link_kind = 'direct' rows in ${dbFile}`,
  );
  console.log(`  via quest_ids.title_key          : ${viaId}`);
  console.log(`  via a UNIQUE reverse value lookup: ${unique.length}`);
  console.log(`  AMBIGUOUS (2+ keys share the text): ${ambiguous.length}`);
  console.log(`  NOT RECOVERABLE                  : ${missing.length}`);
  console.log(`  recoverable total                : ${viaId + unique.length} / ${rows.length}`);
  if (ambiguous.length > 0) console.log(`  ambiguous: ${JSON.stringify(ambiguous.slice(0, 5))}`);
  if (missing.length > 0) console.log(`  missing: ${JSON.stringify(missing.slice(0, 5))}`);
  const dup = db
    .prepare(
      `SELECT value, count(*) AS c FROM string_table
        WHERE key LIKE 'QuestTitle\\_%' ESCAPE '\\' AND value <> ''
        GROUP BY value HAVING c > 1 ORDER BY c DESC LIMIT 5`,
    )
    .all();
  console.log(`  duplicate non-empty QuestTitle values in string_table: ${JSON.stringify(dup)}`);
  db.close();
}
