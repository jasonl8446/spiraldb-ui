/**
 * `npm run drafts -- --db <file>` — the draft builder CLI (task 7.6 / p7-07; D130, D140).
 *
 * Runs exactly what `POST /api/drafts/rebuild` runs (`server/src/services/drafts.ts`): it reads
 * the catalog, the evidence tables and the SpiralDB root's quest files, and stages suggestions in
 * the database's `quest_suggestions`. It writes **only that table**, never a SpiralDB file.
 *
 * ```
 * npm run drafts -- --db $PWD/data/__test-scratch__/p7-07.db
 * SPIRALDB_UI_DB=$PWD/data/__test-scratch__/p7-07.db npm run drafts -- --spiraldb $PWD/data/test-spiraldb
 * ```
 *
 * **The database is never picked implicitly** (the D119 lesson): pass `--db <file>` or set
 * `SPIRALDB_UI_DB`, or the command refuses with exit 2. It names the database and the SpiralDB root
 * it resolved before writing, then prints the run's summary as JSON on stdout.
 *
 * Exit codes: `0` built, `1` no SpiralDB root, `2` bad usage.
 */

import {
  DB_FILE_ENV_VAR,
  openDb,
  readSettings,
  resolveDbFile,
  seedSettings,
} from '../server/src/db.js';
import { buildDrafts } from '../server/src/services/drafts.js';
import { createSpiraldbIndex } from '../server/src/services/spiraldbIndex.js';

interface Args {
  db?: string;
  spiraldb?: string;
}

function usage(exitCode: number): never {
  console.error(
    'Usage: npm run drafts -- [--db <file>] [--spiraldb <dir>]\n' +
      `  --db        the database file; required unless ${DB_FILE_ENV_VAR} is set\n` +
      '  --spiraldb  the SpiralDB root whose quest files are read (default: settings.spiraldb_path)',
  );
  process.exit(exitCode);
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const equals = arg.indexOf('=');
    const flag = equals === -1 ? arg : arg.slice(0, equals);
    let value: string | undefined = equals === -1 ? argv[(index += 1)] : arg.slice(equals + 1);
    if (value === undefined || value.startsWith('--')) {
      value = undefined;
    }
    if (flag === '--db') args.db = value;
    else if (flag === '--spiraldb' || flag === '--spiraldb-path') args.spiraldb = value;
    else {
      console.error(`Unknown argument: ${arg}`);
      usage(2);
    }
    if (value === undefined) {
      console.error(`${flag} needs a value`);
      usage(2);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

// A write command never defaults to the live database (D119): `data/spiraldb-ui.db` is the dev
// server's, and a builder run against it by accident would stage rows the owner never asked for.
if (args.db === undefined && !process.env[DB_FILE_ENV_VAR]) {
  console.error(
    `Refusing to pick a database implicitly: pass --db <file> (or set ${DB_FILE_ENV_VAR}). ` +
      'This command writes quest_suggestions rows into that database.',
  );
  usage(2);
}

const dbFile = args.db ?? resolveDbFile();
const db = openDb({ file: dbFile });
seedSettings(db);

const root = (args.spiraldb ?? readSettings(db).spiraldb_path ?? '').trim();
if (root === '') {
  console.error('No SpiralDB root: pass --spiraldb or set settings.spiraldb_path / SPIRALDB_PATH.');
  db.close();
  process.exit(1);
}

console.log(`[spiraldb-ui] drafts database at ${dbFile}`);
console.log(`[spiraldb-ui] SpiralDB root   at ${root} (read only)`);

const index = createSpiraldbIndex(root);
index.rebuildType('questtemplates');
const result = buildDrafts({ db, index });
console.log(JSON.stringify(result, null, 2));
db.close();
