/**
 * Real-data dry run for tasks **1.4b–1.4e** — the evidence script for story p1-05.
 *
 * ```
 * npm run sync:dry-run                      # reuse /tmp/wad-spike when it exists
 * npx tsx scripts/sync-dry-run.ts --tree /tmp/wad-spike
 * ```
 *
 * It runs the whole parser pipeline against the **real** Aurorium revision and
 * the **real** SpiralDB fork and prints every number the story asks for
 * (revision, `.lang` row count, items/spells/npcs/drop_tables counts, resolved
 * quest samples, zone dedup count, wall clock).
 *
 * It writes **nothing**: no database is opened, no file is created outside the
 * unpack tree, and `scripts/sync-names.ts` stays the untouched stub — the
 * transactional replace (`sync_history`) and the API are task 1.4f/1.4g.
 * The `data/spiraldb-ui.db` fingerprint is captured before and after and
 * compared, so "no DB writes" is evidence rather than a claim.
 *
 * Environment overrides: `SPIRALDB_DRY_RUN_TREE`, `SPIRALDB_DRY_RUN_AURORIUM`,
 * `SPIRALDB_DRY_RUN_SPIRALDB`; every option also has a `--flag=value` form.
 */

import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_AURORIUM_PATH,
  DEFAULT_IMCODEC_PATH,
  DEFAULT_SPIRALDB_PATH,
  resolveRepoRoot,
} from '../server/src/db.js';
import {
  TEMPLATE_MANIFEST_FILE,
  buildDropTableRows,
  buildQuestRows,
  buildZoneRows,
  createKeyLookup,
  langEntryCount,
  loadTemplateManifest,
  resolveRevision,
  runUnpack,
  scanLangDir,
  scanTemplateTree,
} from '../server/src/services/sync/index.js';

/** Parses `--key=value` (and bare `--flag`). */
function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

const AURORIUM_PATH =
  flag('aurorium') ?? process.env.SPIRALDB_DRY_RUN_AURORIUM ?? DEFAULT_AURORIUM_PATH;
const SPIRALDB_PATH =
  flag('spiraldb') ?? process.env.SPIRALDB_DRY_RUN_SPIRALDB ?? DEFAULT_SPIRALDB_PATH;
const TREE = flag('tree') ?? process.env.SPIRALDB_DRY_RUN_TREE ?? path.join('/tmp', 'wad-spike');
const IMCODEC_PATH =
  flag('imcodec') ?? process.env.SPIRALDB_DRY_RUN_IMCODEC ?? DEFAULT_IMCODEC_PATH;

const DB_FILE = path.join(resolveRepoRoot(), 'data', 'spiraldb-ui.db');

const started = process.hrtime.bigint();
let last = started;

function formatDuration(nanoseconds: bigint): string {
  const milliseconds = Number(nanoseconds) / 1e6;
  return milliseconds >= 1000
    ? `${(milliseconds / 1000).toFixed(1)} s`
    : `${milliseconds.toFixed(0)} ms`;
}

function elapsedSince(mark: bigint): string {
  return formatDuration(process.hrtime.bigint() - mark);
}

function step(): string {
  const mark = last;
  last = process.hrtime.bigint();
  return elapsedSince(mark);
}

function total(): string {
  return elapsedSince(started);
}

function n(value: number): string {
  return value.toLocaleString('en-US');
}

function bytes(value: number): string {
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function pct(part: number, whole: number): string {
  return whole === 0 ? '0.0%' : `${((part / whole) * 100).toFixed(1)}%`;
}

function heading(text: string): void {
  console.log(`\n${text}`);
}

function field(label: string, value: string): void {
  console.log(`  ${label.padEnd(18)}: ${value}`);
}

/** `absent`, or `sha256=… bytes=… mtimeMs=…` — used to prove no DB writes. */
async function dbFingerprint(): Promise<string> {
  if (!existsSync(DB_FILE)) {
    return 'absent';
  }
  const buffer = await readFile(DB_FILE);
  const stat = statSync(DB_FILE);
  return `sha256=${createHash('sha256').update(buffer).digest('hex')} bytes=${n(
    buffer.byteLength,
  )} mtimeMs=${stat.mtimeMs}`;
}

/** Up to `count` resolved samples, hex-keyed ones first (≥1 hex guaranteed when present). */
function pickQuestSamples<T extends { titleKey: string | null }>(rows: T[], count: number): T[] {
  const isHexKey = (row: T): boolean =>
    row.titleKey !== null && /[A-Fa-f]/.test(row.titleKey.slice(row.titleKey.lastIndexOf('_') + 1));
  return [...rows.filter(isHexKey), ...rows.filter((row) => !isHexKey(row))].slice(0, count);
}

const dbBefore = await dbFingerprint();

console.log('=== SpiralDB UI — friendly-name sync dry run (tasks 1.4b–1.4e) ===');
field('aurorium', AURORIUM_PATH);
field('spiraldb', SPIRALDB_PATH);
field('imcodec', IMCODEC_PATH);
field('unpack tree', TREE);
field('db file', DB_FILE);

// ---------------------------------------------------------------- 1.4b -----
heading('[1.4b] revision resolver — auto-detect V_r* (task 1.4b / p1-05-ac2)');
const revision = resolveRevision({ auroriumPath: AURORIUM_PATH });
const wadStat = statSync(revision.rootWadPath);
field('revision', revision.revision);
field('source', revision.source);
field('data dir', revision.dataPath);
field('root.wad', `${revision.rootWadPath} (${n(wadStat.size)} bytes)`);
field('elapsed', step());

// ---------------------------------------------------------------- 1.4c -----
heading('[1.4c] unpack runner — reuse the spike tree, never spawn twice');
const reuseTree = existsSync(TREE);
if (!reuseTree) {
  console.log(
    `  NOTE: ${TREE} does not exist — running the real unpack (measured 17.2 s, spike 1.4a §2).`,
  );
}
const unpack = await runUnpack({
  imcodecPath: IMCODEC_PATH,
  rootWadPath: revision.rootWadPath,
  tempDir: reuseTree ? TREE : undefined,
  keepTempDir: !reuseTree,
});
const treeDir = unpack.tempDir;
field('mode', unpack.reused ? 'reused existing tree (no process spawned)' : 'unpacked now');
field('temp dir', treeDir);
field('elapsed', step());

// ---------------------------------------------------------------- 1.4e -----
heading('[1.4e] .lang string tables — Locale/en-US/*.lang');
const lang = await scanLangDir(path.join(treeDir, 'Locale', 'en-US'));
const headerOnly = lang.tables.filter((table) => table.recordCount === 0).length;
const topCategories = [...lang.byCategory.entries()]
  .sort((a, b) => langEntryCount(b[1]) - langEntryCount(a[1]))
  .slice(0, 5)
  .map(([category, maps]) => `${category}=${n(langEntryCount(maps))}`)
  .join(', ');
field('files', n(lang.fileCount));
field('bytes', bytes(lang.byteCount));
const langRows = lang.rowCount + lang.namedRowCount;
field(
  'string_table rows',
  `${n(lang.rowCount)} numeric + ${n(lang.namedRowCount)} named = ${n(langRows)}`,
);
field('non-empty values', `${n(lang.nonEmptyRowCount)} (${pct(lang.nonEmptyRowCount, langRows)})`);
field('header-only files', n(headerOnly));
field(
  'labelled records',
  `${n(lang.namedRecordCount)} (middle line non-blank — a third column, e.g. MobDescriptions)`,
);
field('index collisions', n(lang.collisionCount));
field(
  'form collisions',
  `same-form ${n(lang.sameFormCollisionCount)} record(s); cross-form ${n(
    lang.crossFormCollisionCount,
  )} index(es) in both forms, ${n(lang.crossFormValueMismatchCount)} with different values`,
);
field('parse errors', n(lang.errors.length));
field('top categories', topCategories);
field('elapsed', step());

const lookupTitle = createKeyLookup(lang.byCategory, lang.namedByCategory);

// ---------------------------------------------------------------- 1.4h -----
heading('[1.4h] TemplateManifest_deser.json — the authoritative id space (D35)');
const manifestPath = path.join(treeDir, TEMPLATE_MANIFEST_FILE);
const manifest = await loadTemplateManifest(manifestPath);
field('file', `${manifestPath} (${bytes(statSync(manifestPath).size)})`);
field(
  'entries',
  `${n(manifest.counts.entries)} entries → ${n(manifest.counts.ids)} ids / ${n(
    manifest.counts.files,
  )} files`,
);
field(
  'rejected / duplicates',
  `rejected ${n(manifest.counts.rejected)}; duplicate ids ${n(
    manifest.counts.duplicateIds,
  )}, duplicate files ${n(manifest.counts.duplicateFiles)}`,
);
field('elapsed', step());

// ---------------------------------------------------------------- 1.4d -----
heading('[1.4d] template tree — ObjectData/** + Spells/** (classification by _className)');
const templates = await scanTemplateTree(treeDir, { resolveName: lookupTitle, manifest });
const nameSources = { resolved: 0, rawKey: 0, objectName: 0, spellName: 0 };
const idSources = { manifest: 0, m_templateID: 0, displayNameIndex: 0, none: 0 };
for (const row of templates.rows) {
  nameSources[row.nameSource] += 1;
  idSources[row.idSource] += 1;
}
field('scanned files', n(templates.counts.scannedFiles));
field(
  'items',
  `${n(templates.counts.item)} parsed → ${n(templates.items.length)} rows with a numeric gid`,
);
field(
  'spells',
  `${n(templates.counts.spell)} parsed → ${n(templates.spells.length)} rows keyed by the manifest m_id (D35)`,
);
field(
  'npcs (flat)',
  `${n(templates.npcs.length)} = npc ${n(templates.counts.npc)} + pet ${n(
    templates.counts.pet,
  )} + mount ${n(templates.counts.mount)}`,
);
field(
  'rows without a name',
  `${n(templates.counts.noName)} (dropped; by family ${JSON.stringify(templates.counts.noNameByFamily)})`,
);
field('rows without an id', n(templates.counts.noId));
field(
  'manifest ids',
  `used ${n(templates.manifest.assigned)}, fallback ${n(
    templates.manifest.fallback,
  )}, missing ${n(templates.manifest.missing)}, mismatches ${n(templates.manifest.mismatches)}`,
);
for (const sample of templates.manifest.mismatchSamples) {
  field(
    'mismatch',
    `${sample.sourcePath} (m_templateID ${n(sample.embeddedId)} vs manifest ${n(sample.manifestId)})`,
  );
}
for (const sample of templates.manifest.missingSamples) {
  field('missing', `${sample.sourcePath} (manifest path ${sample.manifestPath})`);
}
field(
  'name sources',
  `resolved=${n(nameSources.resolved)}, rawKey=${n(nameSources.rawKey)}, objectName=${n(nameSources.objectName)}, spellName=${n(nameSources.spellName)}`,
);
field(
  'id sources',
  `manifest=${n(idSources.manifest)}, m_templateID=${n(idSources.m_templateID)}, displayNameIndex=${n(idSources.displayNameIndex)}, none=${n(idSources.none)}`,
);
field('skipped classes', n(templates.counts.skippedClasses));
field('parse errors', n(templates.counts.parseErrors));
field('elapsed', step());

// ---------------------------------------------------------------- D21 ------
heading('[1.4d] corpus rows — SpiralDB fork (decision D21)');
const quests = await buildQuestRows({
  questTemplatesDir: path.join(SPIRALDB_PATH, 'QuestTemplates'),
  lookupTitle,
});
field(
  'quests',
  `${n(quests.files)} files → ${n(quests.rows.length)} rows (titles: resolved ${n(
    quests.resolvedTitles,
  )}, raw-key fallback ${n(quests.rawKeyFallbacks)}, none ${n(quests.missingTitles)})`,
);
const resolvedRows = quests.rows.filter((row) => row.titleSource === 'resolved');
console.log('  resolved title samples:');
for (const row of pickQuestSamples(resolvedRows, 5)) {
  console.log(`    - ${row.quest_name} | ${row.titleKey} → ${row.title}`);
}
const fallbacks = quests.rows.filter((row) => row.titleSource === 'rawKey');
console.log(
  `  raw-key fallbacks    : ${fallbacks.length === 0 ? 'none — every keyed quest resolved' : n(fallbacks.length)}`,
);
for (const row of fallbacks.slice(0, 3)) {
  console.log(`    - ${row.quest_name} | ${row.titleKey} → ${row.title} (raw key)`);
}
const untitled = quests.rows.filter((row) => row.titleSource === 'missing');
console.log(`  no m_questTitle       : ${n(untitled.length)} (title falls back to m_questName)`);
for (const row of untitled.slice(0, 3)) {
  console.log(`    - ${row.quest_name} → ${row.title}`);
}
field('elapsed', step());

const zones = await buildZoneRows({ zoneTransferDir: path.join(SPIRALDB_PATH, 'ZoneTransfer') });
field(
  'zones',
  `${n(zones.files)} files → ${n(zones.rows.length)} distinct zone paths (deduplicated)`,
);
for (const row of zones.rows.slice(0, 3)) {
  console.log(`    - ${row.zone_path} → "${row.display_name}" (world ${row.world})`);
}
field('elapsed', step());

const dropTables = await buildDropTableRows({
  dropTablesDir: path.join(SPIRALDB_PATH, 'DropTables'),
});
field(
  'drop_tables',
  `${n(dropTables.files)} files → ${n(dropTables.rows.length)} rows (unique Name)`,
);
field(
  'corpus parse errors',
  n(quests.parseErrors.length + zones.parseErrors.length + dropTables.parseErrors.length),
);
field('elapsed', step());

// -------------------------------------------------------------- summary ----
const dbAfter = await dbFingerprint();
heading('summary');
field('revision', revision.revision);
field('lang files / rows', `${n(lang.fileCount)} / ${n(lang.rowCount + lang.namedRowCount)}`);
field(
  'items / spells / npcs',
  `${n(templates.counts.item)} / ${n(templates.counts.spell)} / ${n(templates.npcs.length)} (parsed rows)`,
);
field(
  'quests / zones / drop_tables',
  `${n(quests.rows.length)} / ${n(zones.rows.length)} / ${n(dropTables.rows.length)}`,
);
field('wall clock', total());
field('db before', dbBefore);
field('db after', dbAfter);
field(
  'db writes',
  dbBefore === dbAfter ? 'none (fingerprint unchanged)' : 'DETECTED — investigate',
);
if (!reuseTree) {
  // Clean up the tree this run created (the SPIKE tree is never touched).
  const { rm } = await import('node:fs/promises');
  await rm(treeDir, { recursive: true, force: true });
  field('temp cleanup', `removed ${treeDir}`);
}
console.log('');
process.exit(dbBefore === dbAfter ? 0 : 1);
