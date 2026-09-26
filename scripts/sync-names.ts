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
 * ```
 */

import { openDb, seedSettings } from '../server/src/db.js';
import { parseSyncArgs, runSyncCli } from '../server/src/services/sync/cli.js';

const argv = process.argv.slice(2);
const args = parseSyncArgs(argv);

const db = openDb(args.dbFile ? { file: args.dbFile } : {});
seedSettings(db);

const exitCode = await runSyncCli({ db, argv });
db.close();
process.exitCode = exitCode;
