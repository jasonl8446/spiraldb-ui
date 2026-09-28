/**
 * `npm run sync` entry point — task 1.4g (docs/plan-phase-1-foundation.md §1.4g).
 *
 * Opens `data/spiraldb-ui.db` (creating/seeding it on first run), then hands the
 * connection to `runSyncCli`, the same orchestrator `POST /api/sync` drives. All
 * argument parsing, summary formatting and exit-code logic lives in
 * `server/src/services/sync/cli.ts` so it is unit-tested without a subprocess.
 *
 * ```
 * npm run sync                            # fresh unpack (~17 s) into a temp tree
 * npm run sync -- --tree /tmp/wad-spike   # reuse an existing tree (no unpack)
 * SPIRALDB_UI_DB=/tmp/scratch.db npm run sync   # isolate: never touch the live database
 * ```
 *
 * The database is resolved by `resolveSyncDbFile`: `--db`/`SPIRALDB_SYNC_DB` first, then
 * the app-wide `SPIRALDB_UI_DB` (D44), then `data/spiraldb-ui.db`. The middle step was
 * missing until p5-09 — the script ignored `SPIRALDB_UI_DB` and opened the developer's
 * live database, so an intended isolation silently did not apply.
 */

import { openDb, resolveSyncDbFile, seedSettings } from '../server/src/db.js';
import { parseSyncArgs, runSyncCli } from '../server/src/services/sync/cli.js';

const argv = process.argv.slice(2);
const args = parseSyncArgs(argv);

const dbFile = resolveSyncDbFile(args);
const db = openDb({ file: dbFile });
seedSettings(db);

// Name the file actually opened, the way `server/src/index.ts` does for the app's
// connection: the p5-08 finding was that an intended isolation silently did not
// apply, and a run that says which database it wrote cannot repeat that.
console.log(`[spiraldb-ui] sync database at ${dbFile}`);

const exitCode = await runSyncCli({ db, argv });
db.close();
process.exitCode = exitCode;
