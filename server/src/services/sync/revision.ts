import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Revision resolver — task 1.4b (
 * [plan-phase-1-foundation.md](../../../../docs/plan-phase-1-foundation.md) §1.4b,
 * [spec-domain-reference.md](../../../../docs/spec-domain-reference.md) L640-647).
 *
 * Aurorium keeps one directory per game build under `{aurorium_path}/data/`:
 *
 * ```
 * {aurorium_path}/data/{revision}/Data/GameData/Root.wad
 * ```
 *
 * Auto-detection sorts the `data/` entries **alphanumerically descending** and
 * takes the first `V_r*` match; a settings override wins and is validated.
 * Verified on this machine: `V_r806919.Wizard_1_610` is the revision (spike
 * 1.4a, task 1.4a).
 */

/** Every revision directory is named `V_r…` (spec L646). */
export const REVISION_PREFIX = 'V_r';

/** WAD path, relative to a revision directory (spec L644). */
export const ROOT_WAD_RELATIVE_PATH = path.join('Data', 'GameData', 'Root.wad');

/** The filesystem view the resolver may use — injected so tests never touch a real disk. */
export interface RevisionPathProbe {
  /** Directory names directly under `dir` (unsorted). */
  readdir: (dir: string) => string[];
  /** `true` when the path exists *and* is a directory. */
  isDirectory: (candidate: string) => boolean;
  /** `true` when the path exists, whatever its kind. */
  exists: (candidate: string) => boolean;
}

/** The real filesystem. */
export const defaultRevisionPathProbe: RevisionPathProbe = {
  readdir: (dir) => readdirSync(dir),
  isDirectory: (candidate) => {
    try {
      return statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  },
  exists: (candidate) => existsSync(candidate),
};

export interface ResolveRevisionOptions {
  /** Settings `aurorium_path` — the repository root that holds `data/`. */
  auroriumPath: string;
  /**
   * Settings override. Either a bare revision directory name
   * (`V_r806919.Wizard_1_610`) or a full path to the revision directory.
   * Validated to exist before it is used.
   */
  override?: string;
  /** Relative WAD path inside the revision directory; overridable for tests. */
  rootWadRelativePath?: string;
  /** Injected filesystem view. */
  probe?: Partial<RevisionPathProbe>;
}

export interface RevisionInfo {
  /** The revision directory name, e.g. `V_r806919.Wizard_1_610`. */
  revision: string;
  /** `{aurorium_path}/data/{revision}`. */
  dataPath: string;
  /** `{aurorium_path}/data/{revision}/Data/GameData/Root.wad`. */
  rootWadPath: string;
  /** Whether the revision came from the settings override or auto-detection. */
  source: 'override' | 'auto';
}

/** `true` when `name` is a revision directory (`V_r*`). */
export function isRevisionName(name: string): boolean {
  return name.startsWith(REVISION_PREFIX);
}

/**
 * Natural (alphanumeric) ordering of two revision names.
 *
 * Plain lexicographic ordering would rank `V_r9…` above `V_r10…`; the run of
 * digits in a revision name is a build number and must compare numerically
 * (`V_r806919` < `V_r999999`, and `V_r9` < `V_r10`).
 */
export function compareRevisionNames(left: string, right: string): number {
  const leftChunks = left.match(/\d+|\D+/g) ?? [];
  const rightChunks = right.match(/\d+|\D+/g) ?? [];
  const length = Math.min(leftChunks.length, rightChunks.length);

  for (let i = 0; i < length; i += 1) {
    const a = leftChunks[i];
    const b = rightChunks[i];
    if (a === b) {
      continue;
    }
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) {
      const numeric = Number(a) - Number(b);
      if (numeric !== 0) {
        return numeric < 0 ? -1 : 1;
      }
      // Same value with different zero padding — prefer the shorter run.
      if (a.length !== b.length) {
        return a.length < b.length ? -1 : 1;
      }
      continue;
    }
    return a < b ? -1 : 1;
  }

  if (leftChunks.length !== rightChunks.length) {
    return leftChunks.length < rightChunks.length ? -1 : 1;
  }
  return 0;
}

/**
 * Alphanumeric-*descending* sort of revision directory names — the first entry
 * is the newest revision (spec L646). Names that are not `V_r*` are dropped.
 */
export function sortRevisionsDescending(names: readonly string[]): string[] {
  return names
    .filter(isRevisionName)
    .slice()
    .sort((a, b) => compareRevisionNames(b, a));
}

/** Resolves the injected probe against the real filesystem. */
function resolveProbe(options: ResolveRevisionOptions): RevisionPathProbe {
  return { ...defaultRevisionPathProbe, ...options.probe };
}

/**
 * Resolves the revision to sync from.
 *
 * Auto path: read `{aurorium_path}/data/`, keep `V_r*`, sort alphanumerically
 * descending, take the first. Every failure mode carries an actionable message
 * naming the path that was inspected — this runs unattended.
 */
export function resolveRevision(options: ResolveRevisionOptions): RevisionInfo {
  const probe = resolveProbe(options);
  const dataDir = path.join(options.auroriumPath, 'data');
  const rootWadRelativePath = options.rootWadRelativePath ?? ROOT_WAD_RELATIVE_PATH;

  const override = options.override?.trim();
  if (override) {
    // A bare name is resolved under `data/`; anything with a separator is taken as a path.
    const candidate = override.includes(path.sep) ? override : path.join(dataDir, override);
    if (!probe.isDirectory(candidate)) {
      throw new Error(
        `Revision override "${override}" is not a directory (looked at ${candidate}). ` +
          `Set the override to an existing ${REVISION_PREFIX}* directory under ${dataDir}, or clear it to auto-detect.`,
      );
    }
    const rootWadPath = path.join(candidate, rootWadRelativePath);
    if (!probe.exists(rootWadPath)) {
      throw new Error(
        `Revision override "${override}" has no Root.wad at ${rootWadPath}. ` +
          `Expected {aurorium_path}/data/{revision}/${rootWadRelativePath}.`,
      );
    }
    return {
      revision: path.basename(candidate),
      dataPath: candidate,
      rootWadPath,
      source: 'override',
    };
  }

  if (!probe.isDirectory(dataDir)) {
    throw new Error(
      `Aurorium data directory not found: ${dataDir}. ` +
        `Check the aurorium_path setting (currently "${options.auroriumPath}").`,
    );
  }

  let entries: string[];
  try {
    entries = probe.readdir(dataDir);
  } catch (error) {
    throw new Error(
      `Could not read ${dataDir}: ${error instanceof Error ? error.message : String(error)}. ` +
        `Check the aurorium_path setting (currently "${options.auroriumPath}").`,
    );
  }

  const revisions = sortRevisionsDescending(entries);
  if (revisions.length === 0) {
    throw new Error(
      `No ${REVISION_PREFIX}* revision directory found in ${dataDir}. ` +
        `Checked ${entries.length} entries; install a game build there or set an explicit revision override.`,
    );
  }

  const revision = revisions[0];
  const dataPath = path.join(dataDir, revision);
  const rootWadPath = path.join(dataPath, rootWadRelativePath);
  if (!probe.exists(rootWadPath)) {
    throw new Error(
      `Revision ${revision} has no Root.wad at ${rootWadPath}. ` +
        `Expected {aurorium_path}/data/{revision}/${rootWadRelativePath}.`,
    );
  }

  return { revision, dataPath, rootWadPath, source: 'auto' };
}
