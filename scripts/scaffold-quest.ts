/**
 * `npm run scaffold:quest -- --name <QUEST_NAME>` — the scaffold CLI (task 6.8 / p6-09).
 *
 * This is the **reproducible command** task 6.11 (story p6-12) calls to scaffold one quest
 * into a named scratch database and a clone before booting Imlight: it runs exactly the
 * path `POST /api/quests/scaffold` runs — the same service, the same save pipeline, the
 * same guard — with no server in the way.
 *
 * ```
 * # the run's shape: a named scratch database + the frozen D17 clone as the corpus
 * NODE_ENV=test SPIRALDB_UI_DB=$PWD/data/__test-scratch__/p6-12.db \
 *   npm run scaffold:quest -- --name LM-NIGHT-MAIN-009
 *
 * # an explicit pair, when the two settings should not come from the environment
 * npm run scaffold:quest -- --name DM-GRAVE-MAIN-008 \
 *   --db $PWD/data/__test-scratch__/p6-12.db --spiraldb $PWD/data/test-spiraldb
 * ```
 *
 * It **names both paths it resolved** before writing anything — the database file and the
 * SpiralDB root — because the two are independent settings (`SPIRALDB_UI_DB` isolates the
 * database, `SPIRALDB_PATH` the corpus) and the failure mode to avoid is an intended
 * isolation that silently did not apply (the p5-08 finding the sync CLI records too).
 *
 * Exit codes: `0` scaffolded, `1` refused (the service's own message on stderr — an unknown
 * catalog name, a quest that already has a file, a name that would write outside
 * `QuestTemplates/`, a dirty tree under D14, a missing `settings.user_name`), `2` bad usage.
 */

import { execFileSync } from 'node:child_process';

import {
  openDb,
  readSettings,
  resolveSyncDbFile,
  seedSettings,
  writeSetting,
} from '../server/src/db.js';
import { createSavePipeline } from '../server/src/services/savePipeline.js';
import { createSpiraldbIndex } from '../server/src/services/spiraldbIndex.js';
import {
  QuestScaffoldError,
  resolveScaffoldBranch,
  scaffoldMetadataDescription,
  scaffoldQuest,
} from '../server/src/services/questScaffold.js';

interface Args {
  name?: string;
  db?: string;
  spiraldb?: string;
  notes?: string;
  branch?: string;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const equals = arg.indexOf('=');
    const flag = equals === -1 ? arg : arg.slice(0, equals);
    let value = equals === -1 ? undefined : arg.slice(equals + 1);
    if (value === undefined) {
      value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        value = undefined;
      } else {
        index += 1;
      }
    }
    if (flag === '--name' || flag === '-n') args.name = value;
    else if (flag === '--db') args.db = value;
    else if (flag === '--spiraldb' || flag === '--spiraldb-path') args.spiraldb = value;
    else if (flag === '--notes') args.notes = value;
    else if (flag === '--branch' || flag === '-b') args.branch = value;
    else {
      console.error(`Unknown argument: ${arg}`);
      usage(2);
    }
  }
  return args;
}

function usage(exitCode: number): never {
  console.error(
    'Usage: npm run scaffold:quest -- --name <QUEST_NAME> [--db <file>] [--spiraldb <dir>] [--notes <body>]\n' +
      '  --name      the catalog quest name to scaffold (required)\n' +
      '  --db        the database file; required unless SPIRALDB_UI_DB / SPIRALDB_SYNC_DB is set (this\n' +
      '              command writes into the SpiralDB root that database names)\n' +
      '  --spiraldb  the SpiralDB root to write into (default: settings.spiraldb_path / SPIRALDB_PATH)\n' +
      '  --notes     the commit body for the scaffold commit\n' +
      '  --branch    the branch to commit on; must be the checked-out branch (default: it)',
  );
  process.exit(exitCode);
}

const args = parseArgs(process.argv.slice(2));
if (args.name === undefined) {
  usage(2);
}

// A **write** command must not silently default to the live database: the live
// `data/spiraldb-ui.db` points `spiraldb_path` at the owner's fork, so an accidental default
// scaffolds a file into a repository the run must not touch. Requiring one of the two
// explicit names (measured while writing this story: the implicit default is what migrated
// `data/spiraldb-ui.db` when this CLI was smoke-tested) costs the caller five characters and
// removes the class of mistake entirely.
if (args.db === undefined && !process.env.SPIRALDB_UI_DB && !process.env.SPIRALDB_SYNC_DB) {
  console.error(
    'Refusing to pick a database implicitly: pass --db <file> (or set SPIRALDB_UI_DB / ' +
      'SPIRALDB_SYNC_DB). This command WRITES a quest file into whatever SpiralDB root the ' +
      "database names, and the default database names the owner's fork.",
  );
  usage(2);
}

const dbFile = resolveSyncDbFile({ dbFile: args.db });
const db = openDb({ file: dbFile });
seedSettings(db);

const settings = readSettings(db);
const root = (args.spiraldb ?? settings.spiraldb_path ?? '').trim();
if (root === '') {
  console.error('No SpiralDB root: pass --spiraldb or set settings.spiraldb_path / SPIRALDB_PATH.');
  db.close();
  process.exit(1);
}

// Name both, before anything is written: the isolation the caller intended must be the
// isolation that happened.
console.log(`[spiraldb-ui] scaffold database at ${dbFile}`);
console.log(`[spiraldb-ui] SpiralDB root       at ${root}`);
console.log(
  `[spiraldb-ui] author              ${settings.user_name || '(empty — the save will refuse)'}`,
);

// The branch trap, measured while writing this story's own evidence (the D76(b) shape):
// the save commits to `settings.git_branch`, and `ensureSessionBranch` **creates that branch
// from `main`** when it does not exist — which checks out main's tree. A scratch database
// seeded today therefore has a `git_branch` of today, and the first save silently replaces a
// clone that sits on another branch with main's contents. Naming both branches is the
// cheapest possible guard; the pipeline's behaviour is by design and is not changed here.
const storedBranch = (settings.git_branch ?? '').trim();
let currentBranch = '';
try {
  currentBranch = execFileSync('git', ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  currentBranch = '';
}
console.log(`[spiraldb-ui] git_branch setting   ${storedBranch || '(empty → content/{today})'}`);
console.log(
  `[spiraldb-ui] working tree branch  ${currentBranch === '' ? '(not a git working tree)' : currentBranch}`,
);

// The branch decision is the service's (`resolveScaffoldBranch`), not this file's: it follows the
// checked-out branch when none is named, refuses a named branch that is not checked out (which
// would be created from main and strand the current one), and moves the setting when it disagrees.
const decision = resolveScaffoldBranch({
  settingsBranch: storedBranch,
  currentBranch,
  requested: args.branch,
});
if (decision.kind === 'refuse') {
  console.error(`[spiraldb-ui] ${decision.message}`);
  db.close();
  process.exit(1);
}
if (decision.updateSetting) {
  writeSetting(db, 'git_branch', decision.branch);
  console.log(
    `[spiraldb-ui] git_branch updated   ${decision.branch} (was "${storedBranch}"; the working ` +
      `tree is on it, and committing to another branch would create it from main and strand this one)`,
  );
}

const index = createSpiraldbIndex(root);
index.rebuild();
const pipeline = createSavePipeline({ db, spiraldbPath: root, index });

try {
  const result = await scaffoldQuest({ db, index, pipeline, name: args.name, notes: args.notes });
  const written = result.quest;
  const order = Object.keys(written);
  console.log('');
  console.log('=== scaffolded ===');
  console.log(`  quest_name            : ${result.quest_name}`);
  console.log(`  link_kind             : ${result.link_kind}`);
  console.log(`  title_key written     : ${result.title_key ?? 'null (no title written)'}`);
  console.log(`  m_questTitle          : ${JSON.stringify(written.m_questTitle)}`);
  console.log(
    `  has_definition (before): ${result.has_definition_before} (the next sync flips it to 1)`,
  );
  console.log(`  file                  : ${result.file}`);
  console.log(`  metadata              : ${result.metadata}`);
  console.log(`  commit                : ${result.commit}`);
  console.log(`  branch                : ${result.branch}`);
  console.log(`  commit message        : ${result.commit_message}`);
  console.log(`  key count             : ${order.length}`);
  console.log(`  key order             : ${order.join(', ')}`);
  console.log('');
  console.log('=== the companion metadata Description (the catalog provenance) ===');
  console.log(
    `  ${scaffoldMetadataDescription({ kind: result.link_kind, titleKey: result.title_key })}`,
  );
  console.log('');
  console.log('=== the file, verbatim ===');
  console.log(JSON.stringify(written, null, 2));
  db.close();
  process.exit(0);
} catch (error) {
  if (error instanceof QuestScaffoldError) {
    console.error(`[spiraldb-ui] refused (${error.status}): ${error.message}`);
  } else {
    console.error(
      `[spiraldb-ui] failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  db.close();
  process.exit(1);
}
