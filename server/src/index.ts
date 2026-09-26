import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.js';
import { defaultDbFile, getDb } from './db.js';

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
getDb();
console.log(`[spiraldb-ui] database ready at ${defaultDbFile()}`);

const app = createApp(staticDir ? { staticDir } : {});

app.listen(PORT, () => {
  console.log(`[spiraldb-ui] API listening on http://localhost:${PORT}`);
  if (staticDir) {
    console.log(`[spiraldb-ui] serving built client from ${staticDir}`);
  } else {
    console.log('[spiraldb-ui] client/dist not built — API only (run `npm run build`)');
  }
});
