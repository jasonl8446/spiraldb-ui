import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import type { Db } from '../../db.js';
import { humanizeZonePath, zoneWorld, type ZoneRow } from './corpus.js';
import { runWadScan, type RunWadScanOptions, type WadScanResult } from './wadscan.js';
import type { TemplateManifest } from './manifest.js';

/**
 * Zone, recipe and deck breadth — task 6.9
 * ([plan-phase-6-quest-catalog.md](../../../../docs/plan-phase-6-quest-catalog.md) §6.9).
 *
 * Three families the friendly-name set never had, all read through the **same 6.2 tool**
 * (`wad-scan extract`):
 *
 * | table | source | objects | where they live |
 * |---|---|---|---|
 * | `zones` | `WizZoneData` | 3,356 | every zone's `gamedata.bin` |
 * | `decks` | `DeckTemplate` | 599 | `Decks/**` in **Root.wad** |
 * | `recipes` | `RecipeTemplate` | 12,402 | **`Recipes-WorldData.wad`** |
 *
 * ## Why not the template scanner (measured, and it refutes the plan's assumption)
 *
 * The plan says the counts come from the sync's template scanner. They cannot. Measured over the
 * Root.wad unpack tree (`133,937` `_deser.json` files, a raw `_className` census): `DeckTemplate`
 * 599, **`RecipeTemplate` 0**, **`WizZoneData` 0**. `scanTemplateTree` walks `ObjectData/**` and
 * `Spells/**` — `Decks/**` is a third root it never visits — and `Recipes-WorldData.wad` is a WAD
 * that `runUnpack` never unpacks at all. The 12,402 recipes are exactly the entry count of that
 * one archive, and one of them (`ObjectData/HowToServerMan.xml`) carries no "Recipe" in its name,
 * so an entry-name glob cannot select the family: `**\/*Recipe*` over the whole tree finds 11,895
 * of the 12,402 and silently loses 507 (entry names spelled `Recipie`, plus `Cantrips/`,
 * `Pet Recipes/`, `Spellement Recipes/` and the flat one).
 *
 * ## One-wad scope: the tool's own `--gamedata` is the only selection it has
 *
 * `wad-scan extract` selects entries by **name glob**, and globs cannot see which archive an entry
 * came from. Scoping by *archive* is therefore done through the tool's own input: a temporary
 * directory holding one **symlink** to the WAD in question, passed as `--gamedata`. The tool walks
 * `*.wad` under that directory, so the run sees exactly one archive — measured `12,402 rows, 0
 * failed, 2,163 ms` for `Recipes-WorldData.wad --select ObjectData/**`, and `599 rows, 0 failed,
 * 589 ms` for `Root.wad --select Decks/**`. Over-selecting (e.g. adding `Decks/**` to the
 * whole-tree run) was rejected: it pulls 192 `.nif` assets out of `Mob-WorldData.wad` and reports
 * them as 192 failed rows, which muddies the "0 dropped" claim for no gain.
 *
 * ## D35 provenance is the identity, not a cross-check
 *
 * Neither family carries `m_templateID` (measured 0 of 12,402 and 0 of 599), so the manifest id
 * **is** the primary key. The manifest names a non-Root archive's templates with a prefix:
 * `|<stem with '-' replaced by '|'>|` — `Decks/Battlegrounds/X.xml` under Root.wad is verbatim,
 * while `ObjectData/…/X.xml` under `Recipes-WorldData.wad` is `|Recipes|WorldData|ObjectData/…`.
 * Two measured defects are handled explicitly rather than smoothed over:
 *
 * 1. **36 manifest entries are prefixed with two NUL bytes and their `.xml` suffix is truncated to
 *    `.x`** (`\u0000\u0000|Recipes|WorldData|…Recipe-Shard-…-01.x`). All 36 are `RecipeTemplate`
 *    rows of `ObjectData/Spellement Recipes/Fusion_Recipes/Shadow_Enhanced_Recipes/`; stripping the
 *    NULs and restoring `ml` resolves **exactly** those 36 and nothing else, with no collision —
 *    measured `12,366` verbatim + `36` repaired = `12,402`, `0` unresolved.
 * 2. A row that still has no manifest entry is **dropped and named**, never keyed by a guess.
 *
 * ## `zones` is reconciled, not replaced
 *
 * The new source is keyed by `m_zoneName` (3,356 distinct — unique per object). `m_zoneDisplayName`
 * is a many-to-one value (1,108 distinct: many zones share one) and is never a key **of `zones`** —
 * but the value itself is a **string-table key** (`WizardZone_00000485` -> "Garden Of
 * Hesperides"), measured: 1,900 `WizardZone_*` keys exist in `string_table`, 3,340 of the 3,356
 * objects carry one, and 5 of the keys have an empty value. So the label ladder is *resolved
 * value* -> *humanised path* (exactly what every `zones` row showed before task 6.9, so an
 * unresolved key cannot make a dropdown worse) -> the raw key. `ZoneTransfer/*.json`'s paths are
 * the client's own keys, so a corpus path the new source does not cover is **kept** with its
 * humanised label: the union is **3,357** — the 3,356 wiz
 * names plus `Karamelle/KM_Z06_Mines` — and both counts are reported, which is what ac2's
 * "reconciled explicitly" means. The consequence for a covered corpus row is stated in
 * {@link BreadthReport.zones}: its `display_name` becomes the game's own `m_zoneDisplayName`.
 *
 * ## The skipped path (D55)
 *
 * CI has no .NET SDK, so a missing `tools/bin/wad-scan` must leave the sync succeeding. On that
 * path this stage reports `skipped` with the tool's own message, contributes **no** recipes/decks,
 * and the caller writes `zones` from the corpus rows alone — i.e. exactly the D21 behaviour, so no
 * editor dropdown regresses on a machine that never built the tool.
 */

/** Whole-tree selection for the zone documents (`gamedata.bin` is stored flat in every zone WAD). */
export const BREADTH_ZONE_SELECT: readonly string[] = ['gamedata.bin'];

/** The deck family: every `Decks/**` entry of Root.wad is a `DeckTemplate`. */
export const BREADTH_DECK_SELECT: readonly string[] = ['Decks/**'];

/** The recipe family: every entry of `Recipes-WorldData.wad` is a `RecipeTemplate`. */
export const BREADTH_RECIPE_SELECT: readonly string[] = ['ObjectData/**'];

/** The archive the `Decks/**` family lives in (measured: all 599 `DeckTemplate` objects). */
export const DECK_WAD_NAME = 'Root.wad';

/** The archive that holds nothing but recipes (measured: 12,402 entries, 12,402 `RecipeTemplate`). */
export const RECIPE_WAD_NAME = 'Recipes-WorldData.wad';

/** D35's two NUL bytes, as measured on the 36 truncated manifest entries. */
const MANIFEST_NUL_PREFIX = '\u0000\u0000';

/** One `RecipeTemplate` row as collected, before its label is resolved against `string_table`. */
export interface CollectedRecipe {
  template_id: number;
  /** `m_recipeName` — the technical name, and the last rung of the label ladder. */
  recipe_name: string;
  /** `m_displayKey`, e.g. `Recipes_00005807` — the label's string-table key ('' when absent). */
  display_key: string;
  source_path: string;
}

/** One `DeckTemplate` row: `deck_name` is `m_name`, the value `CreatureSpellbook.DeckName` holds. */
export interface DeckRow {
  template_id: number;
  deck_name: string;
  name: string;
  source_path: string;
}

/**
 * One `WizZoneData` row's **raw** material, before its label is resolved.
 *
 * `m_zoneDisplayName` is not display text — it is a **string-table key** (`WizardZone_00000485`
 * -> "Garden Of Hesperides"), measured on the real tree: 3,340 of the 3,356 objects carry one,
 * there are 1,108 distinct values, and `string_table` holds 1,900 `WizardZone_*` keys. So the key
 * is carried here and resolved against `string_table` inside the transaction, exactly as a
 * recipe's `m_displayKey` is — resolving it before the write would read the pre-sync table.
 */
export interface CollectedZone {
  zone_path: string;
  /** The raw `m_zoneDisplayName` key, or `''` when the object carries none. */
  display_key: string;
  world: string | null;
}

/** One extraction run's own summary, kept so a count can always be traced to a command line. */
export interface BreadthRunSummary {
  select: string;
  gamedata: string;
  rows: number;
  /** The tool's summary line (counts, timings, failures). */
  stderr: string;
}

/** Manifest-join accounting for one family (see the module doc-comment). */
export interface ManifestJoinReport {
  /** Rows whose `|<wad>|`-prefixed source path was already in the manifest verbatim. */
  exact: number;
  /** Rows resolved only through the measured NUL/`.x` repair. */
  repaired: number;
  /** Rows with no manifest entry at all — the first drop reason. */
  missing: number;
  /** Up to five missing source paths, so the drop is nameable. */
  missing_samples: string[];
  /** Repaired aliases that collided with an existing manifest key (measured 0). */
  repair_collisions: number;
}

/** Everything the stage measured, including what it refused to keep. */
export interface BreadthReport {
  status: 'ok' | 'skipped';
  reason: string | null;
  message: string | null;
  /** The command lines actually run, in order. */
  runs: BreadthRunSummary[];
  /** Rows each run emitted (before classification), 0 on the skipped path. */
  raw: { zones: number; decks: number; recipes: number };
  /** `_className` split per run — a foreign row inside a selection is visible, never silent. */
  class_split: {
    zones: Record<string, number>;
    decks: Record<string, number>;
    recipes: Record<string, number>;
  };
  /** D35 join accounting, per family. */
  manifest: { decks: ManifestJoinReport; recipes: ManifestJoinReport };
  /**
   * Rows the insert did not keep, with the reason separated. The unit is a **row** for every
   * field; `decks_duplicate_name` is the second unique key this table has and `items`/`spells`
   * do not.
   */
  dropped: {
    recipes: number;
    recipes_missing_id: number;
    recipes_duplicate_id: number;
    decks: number;
    decks_missing_id: number;
    decks_duplicate_id: number;
    decks_duplicate_name: number;
  };
  /** Up to five dropped rows, `'<family> <source_path> (<reason>)'`. */
  dropped_samples: string[];
  /** The zone reconciliation: the corpus count, the new source's count, the union, and the one
   *  measured path only the corpus carries. */
  zones: {
    corpus: number;
    /** Rows the WizZoneData source contributed (the new count's other half). */
    wiz: number;
    /** Corpus paths the WizZoneData source does not cover — kept, never dropped. */
    corpus_only: number;
    corpus_only_samples: string[];
    /** Corpus rows whose label the new source replaces. */
    relabelled: number;
    /** `count(*)` after the reconciliation — the "new count" ac2 reports. */
    new: number;
  };
  /** Rows written to `recipes` / `decks`. */
  recipes: number;
  decks: number;
}

export const ZERO_MANIFEST_JOIN: ManifestJoinReport = {
  exact: 0,
  repaired: 0,
  missing: 0,
  missing_samples: [],
  repair_collisions: 0,
};

/** The zeroed report (the skipped and failure paths). */
export const ZERO_BREADTH_REPORT: BreadthReport = {
  status: 'skipped',
  reason: 'not-run',
  message: null,
  runs: [],
  raw: { zones: 0, decks: 0, recipes: 0 },
  class_split: { zones: {}, decks: {}, recipes: {} },
  manifest: { decks: { ...ZERO_MANIFEST_JOIN }, recipes: { ...ZERO_MANIFEST_JOIN } },
  dropped: {
    recipes: 0,
    recipes_missing_id: 0,
    recipes_duplicate_id: 0,
    decks: 0,
    decks_missing_id: 0,
    decks_duplicate_id: 0,
    decks_duplicate_name: 0,
  },
  dropped_samples: [],
  zones: { corpus: 0, wiz: 0, corpus_only: 0, corpus_only_samples: [], relabelled: 0, new: 0 },
  recipes: 0,
  decks: 0,
};

/* ------------------------------------------------------------------ D35: source path -> m_id */

/**
 * The manifest spelling of `entry` as stored in `wad` (measured rule, see the module doc-comment).
 *
 * Root.wad is the tree's own archive, so the manifest lists its files verbatim; every other
 * archive is prefixed with its stem, `-` replaced by `|`.
 */
export function manifestKeyFor(wad: string, entry: string): string {
  if (wad === DECK_WAD_NAME) {
    return entry;
  }
  const stem = wad.replace(/\.wad$/, '').replace(/-/g, '|');
  return `|${stem}|${entry}`;
}

/** How a source path was matched: verbatim, through the measured repair, or not at all. */
export type ManifestMatch = 'exact' | 'repaired' | 'missing';

export interface BreadthManifestIndex {
  /** Source path → `m_id`, including the repaired aliases. */
  byFile: Map<string, number>;
  /** How many keys the repair added. */
  repaired: number;
  /** Repaired aliases that an existing key already claimed (measured 0). */
  collisions: number;
}

/**
 * The manifest index this stage joins against: every entry as loaded, plus the **measured repair**
 * of the 36 NUL-prefixed entries whose `.xml` suffix the game truncated to `.x`.
 *
 * The repair is guarded by the NUL prefix rather than by the `.x` tail alone: a file legitimately
 * named `….x` must not be rewritten into `….xml`. Measured: exactly 36 keys carry the NUL prefix,
 * all 36 end in `.x`, and all 36 resolve a recipe row that would otherwise have no identity.
 */
export function buildBreadthManifestIndex(manifest: TemplateManifest): BreadthManifestIndex {
  const byFile = new Map<string, number>();
  let repaired = 0;
  let collisions = 0;
  for (const [key, id] of manifest.byFile) {
    byFile.set(key, id);
    if (!key.startsWith(MANIFEST_NUL_PREFIX)) {
      continue;
    }
    // Strip the leading NULs by string slicing, not a `^\u0000+` regex: the lint rule against
    // control characters in a pattern is there because such a regex is usually a mistake.
    let stripped = key;
    while (stripped.startsWith('\u0000')) {
      stripped = stripped.slice(1);
    }
    const repairedKey = stripped.endsWith('.x') ? `${stripped}ml` : stripped;
    if (repairedKey === key) {
      continue;
    }
    if (byFile.has(repairedKey)) {
      collisions += 1;
      continue;
    }
    byFile.set(repairedKey, id);
    repaired += 1;
  }
  return { byFile, repaired, collisions };
}

/** Looks one source path up and says how it matched (so `exact` and `repaired` stay countable). */
export function matchManifestId(
  index: BreadthManifestIndex,
  manifest: TemplateManifest,
  wad: string,
  entry: string,
): { id: number | null; match: ManifestMatch } {
  const key = manifestKeyFor(wad, entry);
  if (manifest.byFile.has(key)) {
    return { id: manifest.byFile.get(key) as number, match: 'exact' };
  }
  const repairedId = index.byFile.get(key);
  if (repairedId !== undefined) {
    return { id: repairedId, match: 'repaired' };
  }
  return { id: null, match: 'missing' };
}

/* ------------------------------------------------------------------ the extraction runs */

/** One NDJSON row of `wad-scan extract` — the fields this stage reads. */
interface ExtractRow {
  wad?: unknown;
  entry?: unknown;
  class?: unknown;
  object?: unknown;
}

export function asExtractString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function asExtractObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Streams one NDJSON file into `onRow` and returns the row count. The recipe file is 11 MB and
 * the tree-wide zone file larger, so nothing is buffered whole.
 */
export async function readNdjson(file: string, onRow: (row: ExtractRow) => void): Promise<number> {
  const stream = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  });
  let rows = 0;
  for await (const line of stream) {
    if (line === '') {
      continue;
    }
    onRow(JSON.parse(line) as ExtractRow);
    rows += 1;
  }
  return rows;
}

export interface BreadthDeps {
  runWadScan: (options: RunWadScanOptions) => Promise<WadScanResult>;
  readNdjson: typeof readNdjson;
  /**
   * Generic stat probe for a named archive under the resolved `Data/GameData` — injected so a test
   * needs no real 19 GB tree. Returns the absolute path, or `null` when the archive is absent.
   */
  findWad: (gamedataDir: string, wadName: string) => string | null;
  /**
   * Creates the one-archive scope directory (a symlink to `wadPath`) and returns a disposer.
   * Injected so a unit test never writes to the real temp directory.
   */
  makeScopeDir: (wadPath: string, wadName: string) => { dir: string; dispose: () => void };
  /** Temp root for the NDJSON files; `mkdtemp` under `os.tmpdir()` by default. */
  makeTmpDir: () => string;
}

export const defaultBreadthDeps: BreadthDeps = {
  runWadScan,
  readNdjson,
  findWad: (gamedataDir, wadName) => {
    const candidate = path.join(gamedataDir, wadName);
    return fs.existsSync(candidate) ? candidate : null;
  },
  makeScopeDir: (wadPath, wadName) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spiraldb-ui-wadscope-'));
    fs.symlinkSync(wadPath, path.join(dir, wadName));
    return { dir, dispose: () => fs.rmSync(dir, { recursive: true, force: true }) };
  },
  makeTmpDir: () => fs.mkdtempSync(path.join(os.tmpdir(), 'spiraldb-ui-breadth-')),
};

export interface CollectBreadthOptions {
  /** The revision's `Data/GameData` — the tree the zone run walks. */
  gamedataDir: string;
  /** The manifest the ids come from (D35). */
  manifest: TemplateManifest;
  /** An explicit temp directory; one is created and removed when omitted. */
  tmpDir?: string;
  deps?: Partial<BreadthDeps>;
}

/** Raw rows per family, before the primary keys filter them. */
export interface CollectedBreadth {
  status: 'ok' | 'skipped';
  reason: string | null;
  message: string | null;
  binaryPath: string | null;
  wizZones: CollectedZone[];
  recipes: CollectedRecipe[];
  decks: DeckRow[];
  report: BreadthReport;
}

/** The "nothing was collected" value — the skipped and failure paths. */
export const NOT_COLLECTED_BREADTH: CollectedBreadth = {
  status: 'skipped',
  reason: 'not-run',
  message: null,
  binaryPath: null,
  wizZones: [],
  recipes: [],
  decks: [],
  report: { ...ZERO_BREADTH_REPORT, zones: { ...ZERO_BREADTH_REPORT.zones } },
};

function countClasses(into: Record<string, number>, row: ExtractRow): void {
  const key = asExtractString(row.class) || '<error>';
  into[key] = (into[key] ?? 0) + 1;
}

/** Runs one `wad-scan extract` and streams its output through `onRow`. */
async function extractInto(
  deps: BreadthDeps,
  options: {
    gamedataDir: string;
    select: readonly string[];
    outPath: string;
  },
  onRow: (row: ExtractRow) => void,
): Promise<{ scan: WadScanResult; rows: number; run: BreadthRunSummary }> {
  const scan = await deps.runWadScan({
    request: {
      command: 'extract',
      gamedataDir: options.gamedataDir,
      select: options.select,
      outPath: options.outPath,
    },
  });
  if (scan.status === 'skipped') {
    return {
      scan,
      rows: 0,
      run: { select: options.select.join(','), gamedata: options.gamedataDir, rows: 0, stderr: '' },
    };
  }
  const rows = await deps.readNdjson(options.outPath, onRow);
  return {
    scan,
    rows,
    run: {
      select: options.select.join(','),
      gamedata: options.gamedataDir,
      rows,
      stderr: scan.stderr.trim(),
    },
  };
}

/**
 * Phase A: run the three scoped extractions and distil their NDJSON into rows.
 *
 * Never throws for a missing binary (all three runs report the same typed `skipped` result and the
 * stage contributes nothing); a run that *happened* and failed still throws `WadScanError` out of
 * `runWadScan`, which fails the sync loudly. The temp directory is removed on the skipped path and
 * on a throw.
 */
export async function collectBreadth(options: CollectBreadthOptions): Promise<CollectedBreadth> {
  const deps: BreadthDeps = { ...defaultBreadthDeps, ...options.deps };
  const ownsTmpDir = options.tmpDir === undefined;
  const tmpDir = options.tmpDir ?? deps.makeTmpDir();
  const index = buildBreadthManifestIndex(options.manifest);
  const runs: BreadthRunSummary[] = [];
  const classSplit = { zones: {}, decks: {}, recipes: {} } as BreadthReport['class_split'];
  const raw = { zones: 0, decks: 0, recipes: 0 };
  const droppedSamples: string[] = [];
  const dropped = { ...ZERO_BREADTH_REPORT.dropped };
  const manifestJoin = {
    decks: {
      ...ZERO_MANIFEST_JOIN,
      missing_samples: [] as string[],
      repair_collisions: index.collisions,
    },
    recipes: {
      ...ZERO_MANIFEST_JOIN,
      missing_samples: [] as string[],
      repair_collisions: index.collisions,
    },
  };

  /** `map` keeps the first row per key — the documented "first wins, the rest are dropped". */
  const dedupe = <T>(
    rows: Iterable<T>,
    key: (row: T) => string | number,
    onDrop: (row: T, reason: 'duplicate') => void,
  ): T[] => {
    const seen = new Set<string | number>();
    const kept: T[] = [];
    for (const row of rows) {
      const id = key(row);
      if (seen.has(id)) {
        onDrop(row, 'duplicate');
        continue;
      }
      seen.add(id);
      kept.push(row);
    }
    return kept;
  };

  try {
    // --- zones: the whole tree, one `gamedata.bin` per zone archive.
    const zoneRows = new Map<string, CollectedZone>();
    const zone = await extractInto(
      deps,
      {
        gamedataDir: options.gamedataDir,
        select: BREADTH_ZONE_SELECT,
        outPath: path.join(tmpDir, 'zones.ndjson'),
      },
      (row) => {
        countClasses(classSplit.zones, row);
        if (asExtractString(row.class) !== 'WizZoneData') {
          return;
        }
        const object = asExtractObject(row.object);
        if (!object) {
          return;
        }
        const zonePath = asExtractString(object.m_zoneName);
        if (zonePath === '') {
          return;
        }
        // The raw key, unresolved: the label is built inside the transaction, where the new
        // `string_table` is already written (see `writeBreadth`).
        zoneRows.set(zonePath, {
          zone_path: zonePath,
          display_key: asExtractString(object.m_zoneDisplayName),
          world: zoneWorld(zonePath),
        });
      },
    );
    runs.push(zone.run);
    raw.zones = zone.rows;
    if (zone.scan.status === 'skipped') {
      return {
        ...NOT_COLLECTED_BREADTH,
        reason: zone.scan.reason,
        message: zone.scan.message,
        binaryPath: zone.scan.binaryPath,
        report: { ...ZERO_BREADTH_REPORT, reason: zone.scan.reason, message: zone.scan.message },
      };
    }

    // --- decks: Root.wad's `Decks/**`, one archive in scope.
    const collectedDecks: DeckRow[] = [];
    const deckWad = deps.findWad(options.gamedataDir, DECK_WAD_NAME);
    if (deckWad === null) {
      throw new Error(
        `No ${DECK_WAD_NAME} under ${options.gamedataDir} — the deck family cannot be read. ` +
          'The resolve step validated that file, so a missing one means the tree changed under the sync.',
      );
    }
    const deckScope = deps.makeScopeDir(deckWad, DECK_WAD_NAME);
    try {
      const decks = await extractInto(
        deps,
        {
          gamedataDir: deckScope.dir,
          select: BREADTH_DECK_SELECT,
          outPath: path.join(tmpDir, 'decks.ndjson'),
        },
        (row) => {
          countClasses(classSplit.decks, row);
          if (asExtractString(row.class) !== 'DeckTemplate') {
            return;
          }
          const object = asExtractObject(row.object);
          if (!object) {
            return;
          }
          const deckName = asExtractString(object.m_name);
          if (deckName === '') {
            return;
          }
          const wad = asExtractString(row.wad);
          const entry = asExtractString(row.entry);
          const { id, match } = matchManifestId(index, options.manifest, wad, entry);
          const sourcePath = manifestKeyFor(wad, entry);
          if (match === 'exact') manifestJoin.decks.exact += 1;
          else if (match === 'repaired') manifestJoin.decks.repaired += 1;
          else {
            manifestJoin.decks.missing += 1;
            dropped.decks_missing_id += 1;
            dropped.decks += 1;
            if (manifestJoin.decks.missing_samples.length < 5) {
              manifestJoin.decks.missing_samples.push(sourcePath);
            }
            if (droppedSamples.length < 5) {
              droppedSamples.push(`decks ${sourcePath} (no manifest entry)`);
            }
            return;
          }
          collectedDecks.push({
            template_id: id as number,
            deck_name: deckName,
            // `DeckTemplate` carries no display field at all (measured keys: m_name,
            // m_spellNameList, m_behaviors), so the label is the object's own name.
            name: deckName,
            source_path: sourcePath,
          });
        },
      );
      runs.push(decks.run);
      raw.decks = decks.rows;
    } finally {
      deckScope.dispose();
    }

    // --- recipes: Recipes-WorldData.wad's whole `ObjectData/**`, one archive in scope.
    const collectedRecipes: CollectedRecipe[] = [];
    const recipeWad = deps.findWad(options.gamedataDir, RECIPE_WAD_NAME);
    if (recipeWad === null) {
      throw new Error(
        `No ${RECIPE_WAD_NAME} under ${options.gamedataDir} — the recipe family cannot be read ` +
          '(measured: that one archive holds all 12,402 `RecipeTemplate` objects).',
      );
    }
    const recipeScope = deps.makeScopeDir(recipeWad, RECIPE_WAD_NAME);
    try {
      const recipes = await extractInto(
        deps,
        {
          gamedataDir: recipeScope.dir,
          select: BREADTH_RECIPE_SELECT,
          outPath: path.join(tmpDir, 'recipes.ndjson'),
        },
        (row) => {
          countClasses(classSplit.recipes, row);
          if (asExtractString(row.class) !== 'RecipeTemplate') {
            return;
          }
          const object = asExtractObject(row.object);
          if (!object) {
            return;
          }
          const wad = asExtractString(row.wad);
          const entry = asExtractString(row.entry);
          const { id, match } = matchManifestId(index, options.manifest, wad, entry);
          const sourcePath = manifestKeyFor(wad, entry);
          if (match === 'exact') manifestJoin.recipes.exact += 1;
          else if (match === 'repaired') manifestJoin.recipes.repaired += 1;
          else {
            manifestJoin.recipes.missing += 1;
            dropped.recipes_missing_id += 1;
            dropped.recipes += 1;
            if (manifestJoin.recipes.missing_samples.length < 5) {
              manifestJoin.recipes.missing_samples.push(sourcePath);
            }
            if (droppedSamples.length < 5) {
              droppedSamples.push(`recipes ${sourcePath} (no manifest entry)`);
            }
            return;
          }
          collectedRecipes.push({
            template_id: id as number,
            recipe_name: asExtractString(object.m_recipeName),
            display_key: asExtractString(object.m_displayKey),
            source_path: sourcePath,
          });
        },
      );
      runs.push(recipes.run);
      raw.recipes = recipes.rows;
    } finally {
      recipeScope.dispose();
    }

    const decksKept = dedupe(
      collectedDecks,
      (row) => row.template_id,
      (row) => {
        dropped.decks_duplicate_id += 1;
        dropped.decks += 1;
        if (droppedSamples.length < 5) {
          droppedSamples.push(
            `decks ${row.source_path} (duplicate manifest id ${row.template_id})`,
          );
        }
      },
    );
    const decksFinal = dedupe(
      decksKept,
      (row) => row.deck_name,
      (row) => {
        dropped.decks_duplicate_name += 1;
        dropped.decks += 1;
        if (droppedSamples.length < 5) {
          droppedSamples.push(`decks ${row.source_path} (duplicate deck_name ${row.deck_name})`);
        }
      },
    );
    const recipesFinal = dedupe(
      collectedRecipes,
      (row) => row.template_id,
      (row) => {
        dropped.recipes_duplicate_id += 1;
        dropped.recipes += 1;
        if (droppedSamples.length < 5) {
          droppedSamples.push(
            `recipes ${row.source_path} (duplicate manifest id ${row.template_id})`,
          );
        }
      },
    );

    const wizZones = [...zoneRows.values()].sort((a, b) => a.zone_path.localeCompare(b.zone_path));
    return {
      status: 'ok',
      reason: null,
      message: null,
      binaryPath: zone.scan.binaryPath,
      wizZones,
      recipes: recipesFinal,
      decks: decksFinal,
      report: {
        status: 'ok',
        reason: null,
        message: null,
        runs,
        raw,
        class_split: classSplit,
        manifest: manifestJoin,
        dropped,
        dropped_samples: droppedSamples,
        // Filled by `writeBreadth`, which is where the corpus rows are known.
        zones: { ...ZERO_BREADTH_REPORT.zones },
        recipes: recipesFinal.length,
        decks: decksFinal.length,
      },
    };
  } finally {
    if (ownsTmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

/* ------------------------------------------------------------------ phase B: write */

export interface WriteBreadthOptions {
  db: Db;
  collected: CollectedBreadth;
  /** The corpus rows the transaction just wrote (`buildZoneRows`) — the client's own zone keys. */
  corpusZones: readonly ZoneRow[];
  /** Whole-statement list order for a caller that wants prepared statements reused. */
}

/** One row of the reconciliation, with the half of its label that still needs resolving. */
export interface ReconciledZone {
  zone_path: string;
  world: string | null;
  /** The corpus row's own label (kept when the WizZoneData source does not cover the path). */
  corpus_display_name: string | null;
  /** The WizZoneData `m_zoneDisplayName` key — the half `writeBreadth` resolves. */
  display_key: string | null;
}

/** The result of the zone reconciliation — the rows to write and ac2's five numbers. */
export interface ZoneReconciliation {
  rows: ReconciledZone[];
  corpus: number;
  wiz: number;
  corpus_only: number;
  corpus_only_samples: string[];
  relabelled: number;
  new: number;
}

/**
 * Merges the client's own zone keys with the WizZoneData names — the one home of the rule.
 *
 * A WizZoneData `m_zoneName` wins the row (its `m_zoneDisplayName` is the game's own label); a
 * corpus path the new source does not carry is **kept** with its humanised label, so no
 * `ZoneTransfer` key and no `m_destinationZone` value loses its dropdown entry. Called by
 * `writeBreadth` and, for the counts the summary reports, by the orchestrator.
 */
export function reconcileZones(
  corpusZones: readonly ZoneRow[],
  wizZones: readonly CollectedZone[],
): ZoneReconciliation {
  const wiz = new Map(wizZones.map((row) => [row.zone_path, row]));
  const merged = new Map<string, ReconciledZone>();
  let relabelled = 0;
  for (const row of corpusZones) {
    if (wiz.has(row.zone_path)) {
      // The corpus row's label is superseded by the game's own; counted so the change is not
      // silent (this is the "reconciled explicitly" half of ac2).
      relabelled += 1;
      continue;
    }
    merged.set(row.zone_path, {
      zone_path: row.zone_path,
      world: row.world,
      corpus_display_name: row.display_name,
      display_key: null,
    });
  }
  for (const row of wiz.values()) {
    merged.set(row.zone_path, {
      zone_path: row.zone_path,
      world: row.world,
      corpus_display_name: null,
      display_key: row.display_key === '' ? null : row.display_key,
    });
  }
  const corpusOnly = [...merged.keys()].filter((zonePath) => !wiz.has(zonePath));
  return {
    rows: [...merged.values()].sort((a, b) => a.zone_path.localeCompare(b.zone_path)),
    corpus: corpusZones.length,
    wiz: wiz.size,
    corpus_only: corpusOnly.length,
    corpus_only_samples: corpusOnly.slice(0, 5),
    relabelled,
    new: merged.size,
  };
}

/**
 * Reconciles `zones` and inserts `recipes`/`decks`, inside the caller's transaction.
 *
 * Called **after** `string_table` is written, because a recipe's label is a string-table lookup of
 * its `m_displayKey` (the same ordering p6-04's catalog stage needs). Nothing here throws on a
 * missing label: the ladder is resolved value → raw key → `m_recipeName`, so a row always has one.
 */
export function writeBreadth(options: WriteBreadthOptions): BreadthReport {
  const { db, collected, corpusZones } = options;
  const report = collected.report;

  const insertRecipe = db.prepare(
    'INSERT INTO recipes (template_id, name, source_path) VALUES (?, ?, ?)',
  );
  const insertDeck = db.prepare(
    'INSERT INTO decks (template_id, deck_name, name, source_path) VALUES (?, ?, ?, ?)',
  );
  const insertZone = db.prepare(
    'INSERT INTO zones (zone_path, display_name, world) VALUES (?, ?, ?)',
  );
  const labelFor = db.prepare<[string], { value: string }>(
    'SELECT value FROM string_table WHERE key = ?',
  );
  /** `string_table`'s value for a key, or `undefined` for a miss (and for an empty value). */
  const resolveKey = (key: string): string | undefined => {
    const hit = labelFor.get(key);
    return hit !== undefined && hit.value !== '' ? hit.value : undefined;
  };

  for (const row of collected.recipes) {
    // The measured ladder: the resolved `m_displayKey`, else the raw key, else `m_recipeName`.
    let name = row.recipe_name;
    if (row.display_key !== '') {
      name = resolveKey(row.display_key) ?? row.display_key;
    }
    insertRecipe.run(row.template_id, name, row.source_path);
  }
  for (const row of collected.decks) {
    insertDeck.run(row.template_id, row.deck_name, row.name, row.source_path);
  }

  const reconciliation = reconcileZones(corpusZones, collected.wizZones);
  // The zone label ladder, measured rather than assumed: the `m_zoneDisplayName` key **resolved**
  // through `string_table` -> the humanised path (which is what every `zones` row showed before
  // task 6.9, so an unresolved key can never make a dropdown worse than it already was) -> the key
  // itself, so the row still carries what the game said rather than an empty string.
  for (const row of reconciliation.rows) {
    const resolved = row.display_key === null ? undefined : resolveKey(row.display_key);
    // `||`, not `??`, for the humaniser rung: `humanizeZonePath` returns `''` for a path whose
    // segments are all empty, and `??` would let that empty string end the ladder — the comment
    // above promises the key is used "rather than an empty string". `display_key` is normalised to
    // `null` at reconciliation (`row.display_key === '' ? null : …`), so the rung after it still
    // falls through to `zone_path`.
    const displayName =
      resolved ??
      row.corpus_display_name ??
      (humanizeZonePath(row.zone_path) || row.display_key) ??
      row.zone_path;
    insertZone.run(row.zone_path, displayName, row.world);
  }

  return {
    ...report,
    zones: {
      corpus: reconciliation.corpus,
      wiz: reconciliation.wiz,
      corpus_only: reconciliation.corpus_only,
      corpus_only_samples: reconciliation.corpus_only_samples,
      relabelled: reconciliation.relabelled,
      new: reconciliation.new,
    },
  };
}
