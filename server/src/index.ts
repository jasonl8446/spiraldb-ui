import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.js';
import { getDb, readSettings, resolveDbFile } from './db.js';
import { runFirstStartupImport } from './services/import.js';

const PORT = Number(process.env.PORT ?? 3001);

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

// First-startup import of the existing SpiralDB corpus (task 1.6,
// docs/spec-data-model.md L254-279). It runs here — the real entrypoint, after
// the connection is open — and never as a side effect of importing `app.ts`, so
// unit tests can never scan the owner's repository (decision D17/D32).
// `SPIRALDB_UI_SKIP_IMPORT=1` disables it outright (a test/audit escape hatch —
// the normal skip is automatic: the table already has rows).
if (process.env.SPIRALDB_UI_SKIP_IMPORT !== '1') {
  const importResult = runFirstStartupImport({
    db,
    spiraldbPath: readSettings(db).spiraldb_path ?? '',
  });

  if (importResult.ran) {
    // The spec's toast text, minus the toast (docs/spec-data-model.md L260).
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
  } else {
    console.log('[spiraldb-ui] first-startup import skipped (entry_status already has rows)');
  }
}

const app = createApp(staticDir ? { staticDir } : {});

app.listen(PORT, () => {
  console.log(`[spiraldb-ui] API listening on http://localhost:${PORT}`);
  if (staticDir) {
    console.log(`[spiraldb-ui] serving built client from ${staticDir}`);
  } else {
    console.log('[spiraldb-ui] client/dist not built — API only (run `npm run build`)');
  }
});
