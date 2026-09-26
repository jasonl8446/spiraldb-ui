#!/usr/bin/env node
/**
 * Copies the server's non-TypeScript assets into the `tsc` output.
 *
 * `tsc` only emits `.js`/`.d.ts`, so `server/migrations/*.sql` would be missing
 * from `server/dist/` and `initSchema()` would throw at runtime. The compiled
 * layout is `server/dist/server/src/db.js`, so the SQL lands in the sibling
 * `server/dist/server/migrations/` — the same relative position as in the source
 * tree, which is why `db.ts` can resolve it with `../migrations/` in both modes.
 *
 * Wired into `build:server` (package.json) immediately after `tsc`.
 */
import { cp, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(repoRoot, 'server', 'migrations');
const targetDir = path.join(repoRoot, 'server', 'dist', 'server', 'migrations');

const entries = await readdir(sourceDir, { withFileTypes: true });
const assets = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
  .map((entry) => entry.name)
  .sort();

if (assets.length === 0) {
  throw new Error(
    `No server assets found in ${sourceDir} — refusing to build a server without migrations.`,
  );
}

await mkdir(targetDir, { recursive: true });
for (const name of assets) {
  await cp(path.join(sourceDir, name), path.join(targetDir, name));
}

console.log(
  `[build] copied ${assets.length} server asset(s) to ${path.relative(repoRoot, targetDir)}: ${assets.join(', ')}`,
);
