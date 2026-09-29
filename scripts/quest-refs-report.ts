/**
 * Quest reference + id-link report — task 6.3's reproduction command
 * ([plan-phase-6-quest-catalog.md](../../docs/plan-phase-6-quest-catalog.md) L227–235).
 *
 * Prints p6-04-ac1/ac2's numbers against the **real** tree: the 6,733-row NDJSON task 6.2
 * writes, the live `data/spiraldb-ui.db` string table (opened **read-only** — this script never
 * writes to it), and the corpus the settings name.
 *
 * ```
 * npx tsx scripts/quest-refs-report.ts \
 *   --ndjson /tmp/p6/lead-extract2.ndjson \
 *   --db data/spiraldb-ui.db
 * # --corpus <dir> overrides the `spiraldb_path` setting (the hold-out's pair source)
 * ```
 *
 * Regenerate the NDJSON in ≈5 s with:
 *
 * ```
 * export DOTNET_ROOT=$(dirname "$(readlink -f "$(command -v dotnet)")") && \
 * tools/bin/wad-scan extract \
 *   --gamedata <Aurorium>/data/V_r806919.Wizard_1_610/Data/GameData \
 *   --select gamedata.bin,triggers.xml --out /tmp/p6/lead-extract2.ndjson
 * ```
 *
 * The NDJSON is streamed line by line (97.7 MB, so it is never held in memory as text) and fed to
 * the pure extractor as an iterable.
 */

import fs from 'node:fs';
import readline from 'node:readline';

import Database from 'better-sqlite3';

import { DEFAULT_SPIRALDB_PATH } from '../server/src/db.js';
import { buildQuestRows } from '../server/src/services/sync/corpus.js';
import {
  QuestRefsCollector,
  computeHoldoutAccuracy,
  createQuestIdLookups,
  parseQuestTitleKey,
  summarizeQuestRefs,
  type QuestIdPair,
  type QuestRefSourceRow,
} from '../server/src/services/sync/questRefs.js';

interface Args {
  ndjson: string;
  db: string;
  corpus: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { ndjson: '', db: 'data/spiraldb-ui.db', corpus: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`${flag} needs a value`);
    }
    index += 1;
    if (flag === '--ndjson') {
      args.ndjson = value;
    } else if (flag === '--db') {
      args.db = value;
    } else if (flag === '--corpus') {
      args.corpus = value;
    } else {
      throw new Error(`unknown flag ${flag}`);
    }
  }
  if (args.ndjson === '') {
    throw new Error('--ndjson <path> is required (task 6.2’s `wad-scan extract` output)');
  }
  return args;
}

/** The NDJSON rows as a one-pass iterable — the extractor consumes it once. */
async function* readNdjson(file: string): AsyncGenerator<QuestRefSourceRow> {
  const stream = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  });
  for await (const line of stream) {
    if (line === '') {
      continue;
    }
    const row = JSON.parse(line) as QuestRefSourceRow;
    yield row;
  }
}

interface CorpusRead {
  pairs: QuestIdPair[];
  files: number;
  parseErrors: number;
  /** Rows whose `m_questTitle` is absent or is not a usable `QuestTitle_*` id. */
  withoutTitleId: number;
}

/** The corpus's `(m_questName, m_questTitle→id)` pairs — the hold-out's known set. */
async function readCorpusPairs(corpusDir: string): Promise<CorpusRead> {
  const result = await buildQuestRows({ questTemplatesDir: `${corpusDir}/QuestTemplates` });
  const pairs: QuestIdPair[] = [];
  let withoutTitleId = 0;
  for (const row of result.rows) {
    const questId = row.titleKey === null ? null : parseQuestTitleKey(row.titleKey);
    if (questId === null) {
      withoutTitleId += 1;
      continue;
    }
    pairs.push({ quest_name: row.quest_name, quest_id: questId });
  }
  return { pairs, files: result.files, parseErrors: result.parseErrors.length, withoutTitleId };
}

const args = parseArgs(process.argv.slice(2));

const db = new Database(args.db, { readonly: true, fileMustExist: true });
const lookups = createQuestIdLookups(db);

const corpusDir =
  args.corpus ??
  ((): string => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'spiraldb_path'").get() as
      { value: string } | undefined;
    // The same constant the boot seed uses (`server/src/db.ts`), so this fallback cannot drift
    // from the owner's fork path the rest of the repo names.
    return row?.value ?? DEFAULT_SPIRALDB_PATH;
  })();

const started = Date.now();
const corpus = await readCorpusPairs(corpusDir);
const corpusPairs = corpus.pairs;
const corpusFiles = fs
  .readdirSync(`${corpusDir}/QuestTemplates`)
  .filter((name) => name.endsWith('.json')).length;

const collector = new QuestRefsCollector();
for await (const row of readNdjson(args.ndjson)) {
  collector.add(row);
}
const result = collector.finish(lookups, { anchors: corpusPairs });
const holdout = computeHoldoutAccuracy(corpusPairs, { corpus: corpusDir, lookups });
const report = summarizeQuestRefs(result, { corpus: corpusDir, holdout });

console.log('quest-refs report — task 6.3 (p6-04)');
console.log(`ndjson      ${args.ndjson}`);
console.log(`database    ${args.db} (read-only)`);
console.log(
  `corpus      ${corpusDir} — ${corpusFiles} quest files (${corpus.files} read, ` +
    `${corpus.parseErrors} parse errors), ${corpusPairs.length} (name, id) pairs, ` +
    `${corpus.withoutTitleId} rows without a usable title id`,
);
console.log(`elapsed     ${((Date.now() - started) / 1000).toFixed(2)} s`);
console.log('');
console.log('ac1 — the catalog:');
console.log(`  distinct quest names (m_questName references)   ${report.distinct_quest_names}`);
console.log(`  catalog rows emitted                            ${report.catalog_rows}`);
console.log(`  direct links                                    ${report.direct_links}`);
console.log(`  with goal names + required status               ${report.with_goal_names}`);
console.log(`  references                                      ${report.references}`);
console.log(`    distinct (quest, wad, entry, class, goal)     ${report.reference_keys}`);
console.log(`    rows the UNIQUE absorbs on insert             ${report.duplicate_references}`);
console.log(`  rows without {wad, entry, class} provenance     ${report.rows_without_provenance}`);
console.log(`  registry checks (ac3, never a reference)        ${report.registry_checks.total}`);
console.log(
  `    m_questName: ""                               ${report.registry_checks.empty_quest_name}`,
);
console.log(
  `    m_questName key absent                        ${report.registry_checks.absent_quest_name}`,
);
console.log(
  `    carrying a non-empty m_entryName              ${report.registry_checks.with_entry_name}`,
);
console.log('');
console.log('ac2 — the inferred tier:');
console.log(`  nodes carrying a quest field                    ${report.nodes_scanned}`);
console.log(`  direct pair rows (a non-empty m_displayName)    ${report.direct_candidates}`);
console.log(`  … accepted (exact QuestTitle_* key exists)      ${report.direct_pairs}`);
console.log(`  names whose only trace is a direct pair         ${report.link_only_names}`);
console.log(`  anchors (direct links + corpus pairs)           ${report.anchored_names}`);
console.log(`  interpolation candidates (both neighbours)      ${report.inference_gaps}`);
console.log(`  rejected by the accept rule                     ${report.inference_rejected}`);
console.log(`  inferred links                                  ${report.inferred_links}`);
console.log(`  no link                                         ${report.no_link}`);
console.log(`  conflicting ids for one name                    ${report.link_conflicts}`);
console.log('');
console.log(`hold-out accuracy (${holdout.method}, corpus ${holdout.corpus}):`);
console.log(
  `  pairs ${holdout.pairs}; groups ${holdout.groups}; ascending ${holdout.groups_ascending}; contiguous ${holdout.groups_contiguous}`,
);
console.log(
  `  cases ${holdout.cases}; hits ${holdout.hits}; misses ${holdout.misses}; accuracy ${(holdout.accuracy * 100).toFixed(1)}%`,
);
console.log(
  `  accepted by the key+table rule: ${holdout.accepted_cases} cases, ${holdout.accepted_hits} hits (${holdout.accepted_cases === 0 ? '0.0' : ((holdout.accepted_hits / holdout.accepted_cases) * 100).toFixed(1)}%)`,
);

db.close();
