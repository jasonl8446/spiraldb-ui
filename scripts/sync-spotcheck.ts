/**
 * AC#2 spot-check for story p1-06 (+ p1-06b, task 1.4h) — verifies synced
 * `string_table`/name rows against the **unpacked source tree and corpus on
 * disk**, not against the sync code that wrote them.
 *
 * ```
 * npx tsx scripts/sync-spotcheck.ts [--tree /tmp/wad-spike] [--db data/spiraldb-ui.db]
 *                                   [--sample 5] [--seed 20260926]
 * ```
 *
 * For each name table it picks `--sample` random database rows and re-reads the
 * originating file fresh:
 *
 * - `items`/`npcs` — the id must equal the **manifest** `m_id` for the row's
 *   source path (`TemplateManifest_deser.json`, D35), cross-checked against the
 *   file's own `m_templateID`; the name must equal
 *   `lookupString(db, m_displayName)` (or the D33(b) ladder's fallback).
 * - `spells` — the id is resolved back through the manifest:
 *   `template_id` → `m_filename` → the real `<name>_deser.json` → the resolved
 *   name must equal the database `name` (p1-06b-ac2). This is the check the old
 *   `m_displayName`-index keying could not pass at all.
 * - `corpus spell coverage` — every spell id the corpus references
 *   (`NpcSpellInventory` `Spells[].TemplateID`/`RequiredSpellID`,
 *   `CreatureSpellbook.SpellTemplateIds`, quest `m_spellID`) is looked up in the
 *   database, with concrete `id -> file -> name` triples (p1-06b-ac2).
 * - `quests` — the `QuestTemplates/*.json` file: `m_questTitle` resolved through
 *   **the database's** `string_table`, compared with `quests.title`/`level`.
 * - `zones` — the `ZoneTransfer/*.json` file that carries `ZoneName` /
 *   `m_destinationZone`, compared with `humanizeZonePath`.
 * - `drop_tables` — the `DropTables/*.json` file's `Name`/`Description`.
 * - `string_table` — the exact token re-read from the real `Locale/en-US` `.lang`
 *   file (value compared byte-for-byte, so the "token as written" key rule is
 *   proven, not assumed).
 *
 * Exit code is `0` only when every sampled row verified.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { defaultDbFile, openDb, readSettings, resolveRepoRoot } from '../server/src/db.js';
import { humanizeZonePath } from '../server/src/services/sync/corpus.js';
import { parseJsonLenient } from '../server/src/services/sync/json.js';
import { parseLangBuffer, type LangTable } from '../server/src/services/sync/lang.js';
import {
  TEMPLATE_MANIFEST_FILE,
  loadTemplateManifest,
  manifestPathToDeserPath,
} from '../server/src/services/sync/manifest.js';
import { lookupString } from '../server/src/services/sync/lookup.js';
import {
  manifestPathForSource,
  scanTemplateTree,
  type TemplateRow,
} from '../server/src/services/sync/templates.js';

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (hit) {
    return hit.slice(prefix.length);
  }
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

const TREE = flag('tree') ?? '/tmp/wad-spike';
const DB_FILE = flag('db') ?? defaultDbFile(resolveRepoRoot());
const SAMPLE = Number(flag('sample') ?? 5);
const SEED = Number(flag('seed') ?? 20260926);

/** mulberry32 — deterministic "random" sampling so the report is reproducible. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = makeRandom(SEED);

function sample<T>(rows: readonly T[], count: number): T[] {
  const pool = [...rows];
  const picked: T[] = [];
  while (picked.length < count && pool.length > 0) {
    const index = Math.floor(random() * pool.length);
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked;
}

let failures = 0;
let checks = 0;

function headed(text: string): void {
  console.log(`\n${text}`);
}

function report(ok: boolean, detail: string): void {
  checks += 1;
  if (!ok) {
    failures += 1;
  }
  console.log(`     ${ok ? 'OK  ' : 'FAIL'} ${detail}`);
}

async function readJson(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    const doc = parseJsonLenient(await readFile(file, 'utf8'));
    return typeof doc === 'object' && doc !== null ? (doc as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function objectOf(doc: Record<string, unknown> | undefined): Record<string, unknown> {
  const object = doc?._object;
  return typeof object === 'object' && object !== null ? (object as Record<string, unknown>) : {};
}

const db = openDb({ file: DB_FILE });
const settings = readSettings(db);

console.log('=== SpiralDB UI — sync spot-check (p1-06 AC#2) ===');
console.log(`  db file          : ${DB_FILE}`);
console.log(`  tree             : ${TREE}`);
console.log(`  spiraldb corpus  : ${settings.spiraldb_path}`);
console.log(`  sample / seed    : ${SAMPLE} rows per table / seed ${SEED}`);
console.log(
  `  string_table rows: ${
    (db.prepare('SELECT COUNT(*) AS count FROM string_table').get() as { count: number }).count
  }`,
);

// ---------------------------------------------------------------- templates --
const manifestFile = path.join(TREE, TEMPLATE_MANIFEST_FILE);
const manifest = await loadTemplateManifest(manifestFile);
headed('[manifest] TemplateManifest_deser.json — the authoritative id space (D35)');
console.log(`  file             : ${manifestFile}`);
console.log(
  `  entries          : ${manifest.counts.entries.toLocaleString('en-US')} → ` +
    `${manifest.counts.ids.toLocaleString('en-US')} ids / ${manifest.counts.files.toLocaleString('en-US')} files`,
);
console.log(
  `  rejected/dupes   : rejected ${manifest.counts.rejected}; duplicate ids ${manifest.counts.duplicateIds}, duplicate files ${manifest.counts.duplicateFiles}`,
);
for (const sample of manifest.rejectedSamples) {
  console.log(`  rejected sample  : index ${sample.index} — ${sample.reason} — ${sample.raw}`);
}
for (const sample of manifest.duplicateSamples) {
  console.log(
    `  duplicate sample : index ${sample.index} — ${sample.reason} — ` +
      `m_id ${String(sample.m_id)} / ${String(sample.m_filename)} (kept m_id ${String(sample.kept?.m_id)})`,
  );
}

headed('[items / npcs / spells] re-read the source _deser.json for each sampled row');
const templates = await scanTemplateTree(TREE, { manifest });
const templateByKey = new Map<string, TemplateRow>();
for (const row of templates.rows) {
  if (row.id !== null) {
    templateByKey.set(`${row.family}:${row.id}`, row);
  }
}
console.log(
  `  scanned ${templates.counts.scannedFiles.toLocaleString('en-US')} template files; ` +
    `items=${templates.items.length.toLocaleString('en-US')} ` +
    `spells=${templates.spells.length.toLocaleString('en-US')} ` +
    `npcs=${templates.npcs.length.toLocaleString('en-US')}`,
);
console.log(
  `  manifest ids used: ${templates.manifest.assigned.toLocaleString('en-US')} / ` +
    `fallback ${templates.manifest.fallback.toLocaleString('en-US')} / ` +
    `missing ${templates.manifest.missing.toLocaleString('en-US')} / ` +
    `mismatches ${templates.manifest.mismatches.toLocaleString('en-US')}`,
);

/** The D33(b) name ladder, shared by the items/npcs/spell checks. */
function ladderName(
  doc: Record<string, unknown> | undefined,
  object: Record<string, unknown>,
): { expected: string; ladder: string } {
  const displayName = typeof object.m_displayName === 'string' ? object.m_displayName : '';
  const objectName = typeof object.m_objectName === 'string' ? object.m_objectName : '';
  const spellName = typeof object.m_name === 'string' ? object.m_name : '';
  const resolved = lookupString(db, displayName);
  if (displayName !== '') {
    return resolved !== undefined && resolved !== ''
      ? { expected: resolved, ladder: `m_displayName → string_table (${displayName})` }
      : { expected: displayName, ladder: `m_displayName raw-key fallback (${displayName})` };
  }
  if (objectName !== '') {
    return { expected: objectName, ladder: 'm_objectName (m_displayName empty)' };
  }
  return {
    expected: spellName,
    ladder: `m_name (m_displayName and m_objectName empty) — ${String(doc?._className)}`,
  };
}

async function checkTemplateTable(
  label: string,
  family: 'item' | 'npc',
  rows: Array<{ id: number; name: string }>,
): Promise<void> {
  headed(`[${label}] ${SAMPLE} random rows`);
  for (const row of sample(rows, SAMPLE)) {
    // `npcs` folds NPC + pet + mount templates into one flat table (D33(a)).
    const sources =
      family === 'npc'
        ? ['npc', 'pet', 'mount'].map((kind) => templateByKey.get(`${kind}:${row.id}`))
        : [templateByKey.get(`${family}:${row.id}`)];
    const source = sources.find((candidate) => candidate !== undefined);
    console.log(`  - ${label} id=${row.id}  db name=${JSON.stringify(row.name)}`);
    if (!source) {
      report(false, `no ${family} template with id ${row.id} in the tree`);
      continue;
    }
    const doc = await readJson(source.sourcePath);
    const object = objectOf(doc);
    const rawId = object.m_templateID;
    const manifestPath = manifestPathForSource(TREE, source.sourcePath);
    const manifestId = manifest.byFile.get(manifestPath);
    const { expected, ladder } = ladderName(doc, object);
    console.log(`     source      : ${source.sourcePath}`);
    console.log(`     manifest    : ${manifestPath} → m_id ${String(manifestId)} (D35 id source)`);
    console.log(
      `     _className  : ${String(doc?._className)} (family ${source.family})  m_templateID=${String(rawId)}  m_displayName=${JSON.stringify(object.m_displayName)}  m_objectName=${JSON.stringify(object.m_objectName)}`,
    );
    console.log(`     ladder      : ${ladder}`);
    report(manifestId === row.id, `id equals the manifest m_id (${String(manifestId)})`);
    report(Number(rawId) === row.id, `embedded m_templateID agrees (${String(rawId)})`);
    report(
      expected === row.name,
      `name matches the source-derived name ${JSON.stringify(expected)} (db ${JSON.stringify(row.name)})`,
    );
  }
}

/**
 * The p1-06b-ac2 check: `spells.template_id` → manifest `m_filename` → the real
 * `_deser.json` → the resolved name must equal the database name. The corpus
 * references exactly these ids, so this is the resolution the old
 * `m_displayName`-index keying could never perform.
 */
async function checkSpellTable(rows: Array<{ id: number; name: string }>): Promise<void> {
  const count = Math.max(SAMPLE, 10);
  headed(`[spells] ${count} random rows: template_id → manifest file → _deser.json → name`);
  for (const row of sample(rows, count)) {
    console.log(`  - spells id=${row.id}  db name=${JSON.stringify(row.name)}`);
    const manifestPath = manifest.byId.get(row.id);
    if (manifestPath === undefined) {
      report(false, `id ${row.id} is not in the manifest`);
      continue;
    }
    const deserPath = path.join(TREE, manifestPathToDeserPath(manifestPath));
    const doc = await readJson(deserPath);
    const object = objectOf(doc);
    const { expected, ladder } = ladderName(doc, object);
    const embedded = object.m_templateID;
    console.log(`     manifest    : ${manifestPath}`);
    console.log(`     source      : ${deserPath}`);
    console.log(`     _className  : ${String(doc?._className)}`);
    console.log(`     ladder      : ${ladder}`);
    console.log(`     triple      : ${row.id} -> ${manifestPath} -> ${JSON.stringify(expected)}`);
    report(manifestPath.startsWith('Spells/'), 'the manifest path is under Spells/');
    report(doc !== undefined, 'the manifest target file exists on disk');
    report(
      embedded === undefined || embedded === null,
      'SpellTemplate carries no m_templateID (the id can only come from the manifest)',
    );
    report(expected === row.name, `resolved name matches the db name ${JSON.stringify(row.name)}`);
  }
}

await checkTemplateTable(
  'items',
  'item',
  db.prepare('SELECT gid AS id, name FROM items ORDER BY gid').all() as Array<{
    id: number;
    name: string;
  }>,
);
await checkSpellTable(
  db.prepare('SELECT template_id AS id, name FROM spells ORDER BY template_id').all() as Array<{
    id: number;
    name: string;
  }>,
);
await checkTemplateTable(
  'npcs',
  'npc',
  db.prepare('SELECT template_id AS id, name FROM npcs ORDER BY template_id').all() as Array<{
    id: number;
    name: string;
  }>,
);

// ------------------------------------------------- corpus spell coverage --
/** Collects numbers under `keys` anywhere inside `value`. */
function collectNumbers(value: unknown, keys: ReadonlySet<string>, out: Set<number>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectNumbers(item, keys, out);
    }
    return;
  }
  if (typeof value !== 'object' || value === null) {
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(key) && typeof child === 'number' && Number.isFinite(child)) {
      out.add(child);
      continue;
    }
    if (keys.has(key) && Array.isArray(child)) {
      for (const item of child) {
        if (typeof item === 'number' && Number.isFinite(item)) {
          out.add(item);
        }
      }
      continue;
    }
    collectNumbers(child, keys, out);
  }
}

const corpusDir = settings.spiraldb_path;
const referencedSpellIds = new Set<number>();
const referenceSource = new Map<number, string>();
const corpusSpecs = [
  { dir: 'NpcSpellInventory', keys: new Set(['TemplateID', 'RequiredSpellID']) },
  { dir: 'CreatureSpellbook', keys: new Set(['SpellTemplateIds']) },
  { dir: 'QuestTemplates', keys: new Set(['m_spellID']) },
] as const;

headed(`[corpus spell coverage] spell ids referenced by ${corpusDir} (p1-06b-ac2)`);
for (const spec of corpusSpecs) {
  const dir = path.join(corpusDir, spec.dir);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    console.log(`  ${spec.dir}: directory missing — skipped`);
    continue;
  }
  const beforeDir = referencedSpellIds.size;
  for (const name of files.filter((entry) => entry.endsWith('.json'))) {
    const file = path.join(dir, name);
    const doc = await readJson(file);
    if (!doc) {
      continue;
    }
    const before = new Set(referencedSpellIds);
    collectNumbers(doc, spec.keys, referencedSpellIds);
    for (const id of referencedSpellIds) {
      if (!before.has(id) && !referenceSource.has(id)) {
        referenceSource.set(id, path.join(spec.dir, name));
      }
    }
  }
  console.log(`  ${spec.dir.padEnd(20)}: +${referencedSpellIds.size - beforeDir} new id(s)`);
}

let resolved = 0;
let inManifest = 0;
let manifestSpellsPath = 0;
const triples: string[] = [];
for (const id of [...referencedSpellIds].sort((a, b) => a - b)) {
  const manifestPath = manifest.byId.get(id);
  if (manifestPath !== undefined) {
    inManifest += 1;
    if (manifestPath.startsWith('Spells/')) {
      manifestSpellsPath += 1;
    }
  }
  const row = db.prepare('SELECT name FROM spells WHERE template_id = ?').get(id) as
    { name: string } | undefined;
  if (row !== undefined) {
    resolved += 1;
    if (triples.length < 12) {
      triples.push(
        `${id} -> ${manifestPath ?? '(not in the manifest)'} -> ${JSON.stringify(row.name)}` +
          ` (referenced by ${referenceSource.get(id) ?? '?'})`,
      );
    }
  }
}
const total = referencedSpellIds.size;
const rate = total === 0 ? 0 : (resolved / total) * 100;
console.log(`  referenced ids     : ${total.toLocaleString('en-US')}`);
console.log(
  `  in the manifest    : ${inManifest.toLocaleString('en-US')} (${manifestSpellsPath.toLocaleString('en-US')} point at Spells/*.xml)`,
);
console.log(
  `  resolved in spells : ${resolved.toLocaleString('en-US')}/${total.toLocaleString('en-US')} (${rate.toFixed(1)}%) — was 0 before D35, expect ≥700`,
);
for (const triple of triples) {
  console.log(`  triple             : ${triple}`);
}
report(total > 0, 'the corpus references at least one spell id');
report(
  resolved >= 700,
  `≥700 of the referenced spell ids resolve to a name through the database (${resolved}/${total})`,
);
report(
  resolved === manifestSpellsPath,
  `every referenced id that points at a Spells/ file resolves (${resolved} vs ${manifestSpellsPath})`,
);

// ------------------------------------------------------------------ corpus --
const questsDir = path.join(settings.spiraldb_path, 'QuestTemplates');
const questDocByFile = new Map<string, Record<string, unknown>>();
const questFileByName = new Map<string, string>();
for (const name of await readdir(questsDir)) {
  if (!name.endsWith('.json')) {
    continue;
  }
  const file = path.join(questsDir, name);
  const doc = await readJson(file);
  if (!doc) {
    continue;
  }
  questDocByFile.set(file, doc);
  const questName = typeof doc.m_questName === 'string' ? doc.m_questName : '';
  if (questName !== '') {
    questFileByName.set(questName, file);
  }
}

headed(`[quests] ${SAMPLE} random rows against ${questsDir}/*.json`);
const questRows = db
  .prepare('SELECT quest_name, title, level, is_mainline FROM quests ORDER BY quest_name')
  .all() as Array<{ quest_name: string; title: string; level: number | null; is_mainline: number }>;
for (const row of sample(questRows, SAMPLE)) {
  const file = questFileByName.get(row.quest_name);
  console.log(
    `  - quest ${row.quest_name}  db title=${JSON.stringify(row.title)} level=${row.level}`,
  );
  if (!file) {
    report(false, `no corpus file with m_questName=${row.quest_name}`);
    continue;
  }
  const doc = (await readJson(file)) ?? {};
  const titleKey = typeof doc.m_questTitle === 'string' ? doc.m_questTitle : '';
  const resolved = lookupString(db, titleKey);
  console.log(`     source      : ${file}`);
  console.log(
    `     corpus      : m_questTitle=${JSON.stringify(titleKey)} m_questLevel=${String(doc.m_questLevel)} m_mainline=${String(doc.m_mainline)}`,
  );
  console.log(
    `     string_table: lookupString(${JSON.stringify(titleKey)}) = ${JSON.stringify(resolved)}`,
  );
  report(
    resolved !== undefined && resolved === row.title,
    `title resolves through string_table (${JSON.stringify(row.title)})`,
  );
  report(Number(doc.m_questLevel) === row.level, `level matches (${String(row.level)})`);
}

// The AC's explicit example: a hex-written token that shares its numeric index
// with a decimal token carrying a *different* value.
headed('[quests] the hex/decimal collision quest (AC#2 example)');
const hexQuest = [...questFileByName.entries()].find(([, file]) => {
  const key = questDocByFile.get(file)?.m_questTitle;
  return typeof key === 'string' && /[A-Fa-f]/.test(key.slice(key.lastIndexOf('_') + 1));
});
if (!hexQuest) {
  report(false, 'no corpus quest has a hex-written m_questTitle');
} else {
  const [questName, file] = hexQuest;
  const doc = questDocByFile.get(file) ?? {};
  const titleKey = typeof doc.m_questTitle === 'string' ? doc.m_questTitle : '';
  const raw = db.prepare('SELECT value FROM string_table WHERE key = ?').get(titleKey);
  const helper = lookupString(db, titleKey);
  const dbRow = db
    .prepare('SELECT quest_name, title, level FROM quests WHERE quest_name = ?')
    .get(questName);
  console.log(`  corpus quest with a hex-form title key: ${questName}`);
  console.log(`  source : ${file}`);
  console.log(`  key    : ${titleKey}`);
  console.log(`  raw SQL: ${JSON.stringify(raw)}`);
  console.log(`  helper : ${JSON.stringify(helper)}`);
  console.log(`  db row : ${JSON.stringify(dbRow)}`);
  report(
    helper !== undefined && helper !== '' && helper !== titleKey,
    'the quest title key resolves to a human-readable value, not the raw key',
  );
  report(
    (dbRow as { title: string }).title === helper,
    'the synced quests.title equals the resolved string_table value',
  );
}

const zoneTransferDir = path.join(settings.spiraldb_path, 'ZoneTransfer');
const zoneSourceByPath = new Map<string, { file: string; field: string; value: string }>();
for (const name of await readdir(zoneTransferDir)) {
  if (!name.endsWith('.json')) {
    continue;
  }
  const file = path.join(zoneTransferDir, name);
  const doc = await readJson(file);
  if (!doc) {
    continue;
  }
  const zoneName = typeof doc.ZoneName === 'string' ? doc.ZoneName : '';
  if (zoneName !== '' && !zoneSourceByPath.has(zoneName)) {
    zoneSourceByPath.set(zoneName, { file, field: 'ZoneName', value: zoneName });
  }
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
      return;
    }
    if (typeof value !== 'object' || value === null) {
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'm_destinationZone' && typeof child === 'string' && child !== '') {
        if (!zoneSourceByPath.has(child)) {
          zoneSourceByPath.set(child, { file, field: 'm_destinationZone', value: child });
        }
        continue;
      }
      walk(child);
    }
  };
  walk(doc);
}

headed(`[zones] ${SAMPLE} random rows against ${zoneTransferDir}/*.json`);
const zoneRows = db
  .prepare('SELECT zone_path, display_name, world FROM zones ORDER BY zone_path')
  .all() as Array<{ zone_path: string; display_name: string; world: string | null }>;
for (const row of sample(zoneRows, SAMPLE)) {
  const source = zoneSourceByPath.get(row.zone_path);
  console.log(`  - zone ${row.zone_path}  db display_name=${JSON.stringify(row.display_name)}`);
  if (!source) {
    report(false, 'no ZoneTransfer file carries this zone path');
    continue;
  }
  console.log(`     source      : ${source.file} (${source.field})`);
  console.log(`     raw         : ${JSON.stringify(source.value)}`);
  console.log(`     humanize    : ${JSON.stringify(humanizeZonePath(source.value))}`);
  report(
    humanizeZonePath(source.value) === row.display_name,
    `display_name matches humanizeZonePath (${JSON.stringify(row.display_name)})`,
  );
}

const dropTablesDir = path.join(settings.spiraldb_path, 'DropTables');
const dropTableFileByName = new Map<string, string>();
for (const name of await readdir(dropTablesDir)) {
  if (!name.endsWith('.json')) {
    continue;
  }
  const file = path.join(dropTablesDir, name);
  const doc = await readJson(file);
  if (doc && typeof doc.Name === 'string' && !dropTableFileByName.has(doc.Name)) {
    dropTableFileByName.set(doc.Name, file);
  }
}

headed(`[drop_tables] ${SAMPLE} random rows against ${dropTablesDir}/*.json`);
const dropTableRows = db
  .prepare('SELECT name, description FROM drop_tables ORDER BY name')
  .all() as Array<{ name: string; description: string | null }>;
for (const row of sample(dropTableRows, SAMPLE)) {
  const file = dropTableFileByName.get(row.name);
  console.log(`  - drop_table ${row.name}  db description=${JSON.stringify(row.description)}`);
  if (!file) {
    report(false, 'no DropTables file carries this Name');
    continue;
  }
  const doc = (await readJson(file)) ?? {};
  console.log(`     source      : ${file}`);
  console.log(
    `     raw         : Name=${JSON.stringify(doc.Name)} Description=${JSON.stringify(doc.Description)}`,
  );
  const description =
    typeof doc.Description === 'string' && doc.Description !== '' ? doc.Description : null;
  report(doc.Name === row.name, `Name matches (${JSON.stringify(row.name)})`);
  report(description === row.description, 'Description matches');
}

// ------------------------------------------------------------ string_table --
headed('[string_table] re-read the exact token from the real .lang files');
const localeDir = path.join(TREE, 'Locale', 'en-US');
const filesByCategory = new Map<string, string[]>();
const tableCache = new Map<string, LangTable>();
for (const name of (await readdir(localeDir)).filter((entry) => entry.endsWith('.lang'))) {
  const file = path.join(localeDir, name);
  const table = parseLangBuffer(await readFile(file), {
    categoryFallback: path.basename(name, '.lang'),
  });
  tableCache.set(file, table);
  const files = filesByCategory.get(table.category) ?? [];
  files.push(file);
  filesByCategory.set(table.category, files);
}
console.log(`  parsed ${tableCache.size.toLocaleString('en-US')} .lang files`);

const stringRows = db
  .prepare('SELECT key, value, category FROM string_table ORDER BY key')
  .all() as Array<{ key: string; value: string; category: string }>;
console.log(`  string_table rows: ${stringRows.length.toLocaleString('en-US')}`);
for (const row of sample(stringRows, SAMPLE)) {
  const token = row.key.startsWith(`${row.category}_`)
    ? row.key.slice(row.category.length + 1)
    : row.key;
  const files = filesByCategory.get(row.category) ?? [];
  console.log(`  - ${row.key}  db value=${JSON.stringify(row.value)}`);
  if (files.length === 0) {
    report(false, `no .lang file carries category ${row.category}`);
    continue;
  }
  let found: { file: string; value: string } | undefined;
  for (const file of files) {
    // A fresh read: the cache is only for the category → file mapping.
    const fresh = parseLangBuffer(await readFile(file), {
      categoryFallback: path.basename(file, '.lang'),
    });
    const value = fresh.tokenEntries.get(token) ?? fresh.namedEntries.get(token);
    if (value !== undefined) {
      found = { file, value };
      break;
    }
  }
  if (!found) {
    report(false, `token ${token} not present in any ${row.category} .lang file`);
    continue;
  }
  console.log(`     source      : ${found.file}`);
  console.log(`     raw token   : ${JSON.stringify(token)} → ${JSON.stringify(found.value)}`);
  report(found.value === row.value, 'value matches the .lang file byte-for-byte');
}

// The AC's exact queries: both lexical forms of one numeric index.
headed('[string_table] hex-key queries (AC#2 — both forms, one numeric index)');
for (const key of ['QuestTitle_1ED8A', 'QuestTitle_1ED8D', 'QuestTitle_126346']) {
  const sql = db.prepare('SELECT key, value, category FROM string_table WHERE key = ?').get(key);
  const helper = lookupString(db, key);
  console.log(`  ${key}`);
  console.log(`     raw SQL : ${JSON.stringify(sql)}`);
  console.log(`     helper  : ${JSON.stringify(helper)}`);
  report(
    sql !== undefined && helper === (sql as { value: string }).value,
    'raw SQL and helper agree',
  );
}

headed('summary');
console.log(`  checks: ${checks}  failures: ${failures}  seed: ${SEED}`);
db.close();
process.exit(failures === 0 ? 0 : 1);
