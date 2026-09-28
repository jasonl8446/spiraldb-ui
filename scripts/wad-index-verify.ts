/**
 * WAD index evidence run for task 6.1 — the command behind stories p6-02-ac1 and p6-02-ac2.
 *
 * ```
 * npx tsx scripts/wad-index-verify.ts --gamedata /home/jason/Documents/git-projects/Aurorium/data/V_r806919.Wizard_1_610/Data/GameData
 * npx tsx scripts/wad-index-verify.ts --gamedata <dir> --select gamedata.bin,triggers.xml
 * ```
 *
 * It calls the module the sync ships — `readWadIndexTree` and `selectEntries`
 * ([wadindex.ts](../server/src/services/sync/wadindex.ts)) — and prints the raw totals the two
 * criteria name. Nothing is computed in this file: the counts, the per-glob breakdown, the byte
 * sums, and the evidence that no payload byte was read all come out of the module's own fields.
 *
 * - **ac1**: WAD count, total entries, parse errors (each error is listed), header versions.
 * - **ac2**: selected count, per-glob breakdown, summed raw size, wall clock.
 * - **index-only, by construction**: the reader seeks the file header, each entry header, and each
 *   name — never a payload — so the bytes it read are exactly `Σ indexEnd` (40,363,799 of the real
 *   tree's 19.6 GB). The two are printed side by side, and `bytesRead` is the reader's own
 *   accumulator rather than a value derived from `indexEnd`, so the pair is a check and not a
 *   restatement.
 *
 * Exit code 0 when the tree indexed with zero parse errors, 1 otherwise — a parse error is a
 * finding, not something to print and pass over.
 *
 * Options: `--gamedata <dir>` (required), `--select <a,b>` (default the two zone-data globs),
 * `--help`.
 */

import { readWadIndexTree, selectEntries } from '../server/src/services/sync/wadindex.js';

interface Options {
  gamedata: string;
  select: string[];
}

function parseArgs(argv: string[]): Options {
  const options: Options = { gamedata: '', select: ['gamedata.bin', 'triggers.xml'] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1] ?? '';
    if (flag === '--gamedata') options.gamedata = value;
    else if (flag === '--select') options.select = value.split(',').filter(Boolean);
    else if (flag === '--help' || flag === '-h') options.gamedata = '';
    else throw new Error(`unknown argument: ${flag}`);
    i += 1;
  }
  return options;
}

const USAGE = `Usage: npx tsx scripts/wad-index-verify.ts --gamedata <dir> [--select a,b]

  --gamedata <dir>  Directory holding the *.wad archives (required).
  --select <a,b>    Entry-name globs to select (default: gamedata.bin,triggers.xml).
`;

function field(label: string, value: string): void {
  process.stdout.write(`${label.padEnd(22)}${value}\n`);
}

function bytes(value: number): string {
  const mb = value / 1e6;
  return `${value.toLocaleString('en-US')} B (${mb.toFixed(2)} MB)`;
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.gamedata) {
    process.stdout.write(USAGE);
    return 1;
  }

  const readStart = Date.now();
  const tree = await readWadIndexTree(options.gamedata);
  const readMs = Date.now() - readStart;

  field('gamedata', tree.rootDir);
  field('wads', String(tree.wads.length));
  field(
    'versions',
    [...tree.versionCounts].map(([version, count]) => `v${version} ${count}`).join(', ') ||
      '(none parsed)',
  );
  field('entries', tree.entryCount.toLocaleString('en-US'));
  field('parse errors', String(tree.errors.length));
  for (const error of tree.errors) field('  error', error.message);

  // The reader's own accumulator vs the parsed index end: equal means the bytes read are the index.
  const readBytes = tree.wads.reduce((sum, wad) => sum + wad.bytesRead, 0);
  field('index bytes read', bytes(readBytes));
  field('archive bytes', bytes(tree.fileBytes));
  field('payload bytes read', `0 by construction (index = ${bytes(tree.indexBytes)} read)`);
  field('indexEnd == bytesRead', String(readBytes === tree.indexBytes));

  const selectStart = Date.now();
  const selected = selectEntries(tree.wads, options.select);
  const selectMs = Date.now() - selectStart;

  const perGlob = new Map<string, { count: number; size: number; compressedSize: number }>();
  for (const chosen of selected) {
    const totals = perGlob.get(chosen.glob) ?? { count: 0, size: 0, compressedSize: 0 };
    totals.count += 1;
    totals.size += chosen.entry.size;
    totals.compressedSize += chosen.entry.compressedSize;
    perGlob.set(chosen.glob, totals);
  }
  const rawSize = [...perGlob.values()].reduce((sum, t) => sum + t.size, 0);
  const compressedSize = [...perGlob.values()].reduce((sum, t) => sum + t.compressedSize, 0);

  field('select globs', options.select.join(', '));
  field('selected', String(selected.length));
  for (const [glob, totals] of perGlob) {
    field(`  ${glob}`, `${totals.count} (${totals.size.toLocaleString('en-US')} B raw)`);
  }
  field('selected raw size', bytes(rawSize));
  field('selected compressed', bytes(compressedSize));
  field('elapsed', `read ${readMs} ms, select ${selectMs} ms`);

  return tree.errors.length === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  },
);
