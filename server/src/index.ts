import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.js';
import { getDb, readSettings, resolveDbFile } from './db.js';
import { runCorpusImport } from './services/import.js';

const PORT = Number(process.env.PORT ?? 3001);

/**
 * The interface the API binds, and the only one it may bind.
 *
 * **Loopback, deliberately** (final-review gate 2, finding M1). `app.listen(PORT)`
 * with no host binds the wildcard address — measured as `LISTEN *:3001` — which put
 * an unauthenticated API that writes JSON files and creates commits into a git
 * repository, and that accepts `settings.spiraldb_path` / `git_branch` / `user_name`
 * from the caller, on every interface of the machine. The project's premise is a
 * local single-user tool (docs/spec-architecture.md), so the reachable set is loopback.
 *
 * The IPv4 literal rather than `'localhost'` (which resolves to `::1` first on this
 * host, per Node's default `verbatim` DNS order, and to `127.0.0.1` first on others —
 * so the bound interface would depend on the machine) and rather than `'::1'` alone
 * (which fails on a host without IPv6). Clients that ask for the name still reach it:
 * curl, the browser and Node's own client all fall back to the next resolved address,
 * and the Vite dev proxy's `/api` target is `http://localhost:3001`.
 */
const HOST = '127.0.0.1';

/**
 * Finds the built client by walking up from this module.
 *
 * The emitted layout is `server/dist/server/src/index.js` (tsc mirrors the rootDir
 * because `shared/` sits outside `server/`), and tsx runs the same file as
 * `server/src/index.ts` — so a fixed number of `..` segments would be wrong in one
 * of the two modes. Walking up to the directory that actually holds
 * `client/dist` works in both.
 */
function findStaticDir(startDir: string): string | undefined {
  let dir = startDir;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(dir, 'client', 'dist');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return undefined;
}

const staticDir = findStaticDir(path.dirname(fileURLToPath(import.meta.url)));

// Initialise the SQLite layer on boot (task 1.2): creates `data/` when missing,
// applies the migrations from server/migrations (copied into the build by
// `scripts/copy-server-assets.mjs`) and seeds `settings` on first run.
const db = getDb();
// Log the file actually opened, not the default: `SPIRALDB_UI_DB` (decision D44)
// points the tier-1 harness at a throwaway database, and a boot line naming the
// developer's database would misreport which one the run is writing to.
console.log(`[spiraldb-ui] database ready at ${resolveDbFile()}`);

// Adopting the existing SpiralDB corpus into `entry_status` (task 1.6,
// docs/spec-data-model.md L254-279, plus D82(a)'s idempotent backfill). It runs
// here — the real entrypoint, after the connection is open — and never as a side
// effect of importing `app.ts`, so unit tests can never scan the owner's
// repository (decision D17/D32).
//
// It runs at EVERY startup on purpose: the first-startup-only version made every
// file that arrived later invisible to the search palette and un-statusable
// (D82(a)), and a corpus that grows is the owner's normal workflow, so requiring
// a command to heal it would leave the failure silent. The complete case is a
// scan and no writes (measured: ~80 ms on the owner's 2,279-file corpus), and
// nothing about an already-tracked row is touched by construction.
// `SPIRALDB_UI_SKIP_IMPORT=1` disables it outright (a test/audit escape hatch).
if (process.env.SPIRALDB_UI_SKIP_IMPORT !== '1') {
  const importResult = runCorpusImport({
    db,
    spiraldbPath: readSettings(db).spiraldb_path ?? '',
  });

  if (importResult.ran) {
    // The spec's toast text, minus the toast (docs/spec-data-model.md L260). A
    // backfill reports the same sentence with the number it adopted, so the
    // entries the palette could not see are visible in the log too.
    console.log(`Imported ${importResult.imported} existing entries from SpiralDB`);
    if (importResult.skipped > 0 || importResult.failed > 0) {
      console.log(
        `[spiraldb-ui] import detail: ${importResult.skipped} skipped, ${importResult.failed} unparsable`,
      );
    }
    for (const counts of Object.values(importResult.byType)) {
      if (counts.duplicates.length > 0) {
        console.log(
          `[spiraldb-ui] import duplicate keys (first file wins): ${counts.duplicates.join(', ')}`,
        );
      }
    }
  } else if (importResult.failed > 0) {
    // Nothing adopted, but files exist that could not be read — a broken file
    // must not be silent just because it changed nothing (D82(b)).
    console.log(
      `[spiraldb-ui] corpus already tracked; ${importResult.failed} unparsable file(s) not adopted`,
    );
  } else {
    console.log('[spiraldb-ui] corpus already tracked (entry_status covers every corpus key)');
  }
}

const app = createApp(staticDir ? { staticDir } : {});

app.listen(PORT, HOST, () => {
  // The bound address, not the friendlier `localhost`: this line is what a reader
  // uses to tell whether the API is reachable from another machine, and the answer
  // must be "no" (M1).
  console.log(`[spiraldb-ui] API listening on http://${HOST}:${PORT} (loopback only)`);
  if (staticDir) {
    console.log(`[spiraldb-ui] serving built client from ${staticDir}`);
  } else {
    console.log('[spiraldb-ui] client/dist not built — API only (run `npm run build`)');
  }
});
