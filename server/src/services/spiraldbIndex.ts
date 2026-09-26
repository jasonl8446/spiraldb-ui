import fs from 'node:fs';
import path from 'node:path';

import type { ObjectFileType } from '../../../shared/naming.js';
import {
  INDEXED_COLLECTIONS,
  objectKeyFromData,
  readSpiraldbJson,
  type IndexedCollectionSpec,
} from './spiraldbFiles.js';

/**
 * Content-keyed SpiralDB file index (decision D19, task 2.4 / story p2-05).
 *
 * Legacy filenames do **not** follow this tool's convention — `droptables_…json`,
 * `NPCInventories_1025-A.json`, `WizardZoneDatas_10017-A.json` — and quest
 * metadata pairs by content rather than by name (D20). So a key is never turned
 * into a path: the index scans each family's directory, JSON5-parses every file's
 * key field, and maps `key → the path that file actually lives at`. Update saves
 * and `GET /:key` resolve through it and write back to the *original* path; the
 * convention filename (`fileNameFor`) applies to new creates only.
 *
 * Build cost is deliberately ignored: ~2,300 JSON5 parses over ~2.5 MB of local
 * files (measured well under a second). `rebuild()` is the startup path and
 * `rebuildType()` runs after each save so the map always reflects disk; the
 * index is in-memory, per process, and never persisted.
 *
 * Determinism: files inside a directory are scanned in name order and the **first
 * file wins** for a duplicate key (the same rule the first-startup import uses),
 * so two runs agree. Duplicates are reported by `rebuild()` rather than resolved
 * silently — the corpus has a handful of them.
 */

/** What one (re)build saw. Surfaced for diagnostics/tests; the index itself is the map. */
export interface IndexBuildStats {
  /** `*.json` candidate files opened. */
  scanned: number;
  /** Keys added to the map. */
  indexed: number;
  /** Files that parsed but carry no usable key (so they are unreachable by key). */
  skipped: number;
  /** Files that could not be read or parsed — counted, never fatal. */
  failed: number;
  /** Directories that do not exist in this repository (normal: `NpcDropTable/`). */
  missingDirectories: string[];
  /** `directory/key` for every key that appeared more than once (first file wins). */
  duplicateKeys: string[];
}

export interface SpiraldbIndex {
  /** SpiralDB repository root this index was built against. */
  readonly root: string;
  /** Absolute path of the file holding `key`, or `undefined` when no file does. */
  pathFor(fileType: ObjectFileType, key: string): string | undefined;
  /** Every key known for a family, ascending — diagnostics and list helpers. */
  keys(fileType: ObjectFileType): string[];
  /** Re-scans every configured directory. Returns what the scan saw. */
  rebuild(): IndexBuildStats;
  /** Re-scans one family's directory (the after-save path). */
  rebuildType(fileType: ObjectFileType): IndexBuildStats;
}

function emptyStats(): IndexBuildStats {
  return {
    scanned: 0,
    indexed: 0,
    skipped: 0,
    failed: 0,
    missingDirectories: [],
    duplicateKeys: [],
  };
}

/** Adds `source`'s counters into `target` (used to aggregate a full rebuild). */
function mergeStats(target: IndexBuildStats, source: IndexBuildStats): void {
  target.scanned += source.scanned;
  target.indexed += source.indexed;
  target.skipped += source.skipped;
  target.failed += source.failed;
  target.missingDirectories.push(...source.missingDirectories);
  target.duplicateKeys.push(...source.duplicateKeys);
}

/** Directory entries, narrowed to what the scan needs. */
function directoryEntries(directory: string): fs.Dirent[] {
  return fs.readdirSync(directory, { withFileTypes: true });
}

function isJsonFile(entry: fs.Dirent): boolean {
  return entry.isFile() && entry.name.toLowerCase().endsWith('.json');
}

/** `a` before `b` — locale-independent, so the first-file-wins rule is reproducible. */
function byName(a: fs.Dirent, b: fs.Dirent): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * Builds an index over `root`. The scan happens on `rebuild()`/`rebuildType()`,
 * never here — constructing an index touches no disk, so callers decide when the
 * (cheap) scan runs.
 */
export function createSpiraldbIndex(root: string): SpiraldbIndex {
  const resolvedRoot = path.resolve(root);
  const byType = new Map<ObjectFileType, Map<string, string>>();

  function rebuildType(spec: IndexedCollectionSpec): IndexBuildStats {
    const stats = emptyStats();
    const directory = path.join(resolvedRoot, spec.directory);

    let entries: fs.Dirent[];
    try {
      entries = directoryEntries(directory);
    } catch {
      // A family whose directory is absent (NpcDropTable today) contributes nothing.
      stats.missingDirectories.push(spec.directory);
      byType.set(spec.fileType, new Map());
      return stats;
    }

    const map = new Map<string, string>();
    for (const entry of [...entries].sort(byName)) {
      if (!isJsonFile(entry)) {
        continue;
      }
      const filePath = path.join(directory, entry.name);
      stats.scanned += 1;

      let parsed: unknown;
      try {
        parsed = readSpiraldbJson(filePath);
      } catch {
        stats.failed += 1;
        continue;
      }

      const key = objectKeyFromData(parsed, spec.keyField);
      if (key === undefined) {
        stats.skipped += 1;
        continue;
      }
      if (map.has(key)) {
        stats.duplicateKeys.push(`${spec.directory}/${key}`);
        continue;
      }
      map.set(key, filePath);
      stats.indexed += 1;
    }

    byType.set(spec.fileType, map);
    return stats;
  }

  return {
    root: resolvedRoot,

    pathFor(fileType, key) {
      return byType.get(fileType)?.get(key);
    },

    keys(fileType) {
      return [...(byType.get(fileType)?.keys() ?? [])].sort();
    },

    rebuild() {
      const stats = emptyStats();
      for (const spec of INDEXED_COLLECTIONS) {
        mergeStats(stats, rebuildType(spec));
      }
      return stats;
    },

    rebuildType(fileType) {
      const spec = INDEXED_COLLECTIONS.find((row) => row.fileType === fileType);
      if (spec === undefined) {
        // The unkeyed GlobalRegistry family has nothing to index by key.
        byType.set(fileType, new Map());
        return emptyStats();
      }
      return rebuildType(spec);
    },
  };
}
