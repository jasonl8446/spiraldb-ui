import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

/**
 * WAD unpack runner — task 1.4c
 * ([plan-phase-1-foundation.md](../../../../Docs/plan-phase-1-foundation.md) §1.4c,
 * spike 1.4a §9/1.4c).
 *
 * ```
 * execFile(imcodec_path, ['wad', 'unpack', '--deser', rootWad, tempDir])
 * ```
 *
 * Measured on this machine: **17.2 s, 173,088 files, ~1.15 GB apparent** for the
 * real `Root.wad`. `--verbose` is never passed — the CLI source warns it "can
 * tremendously decrease performance" on large archives.
 */

const execFileAsync = promisify(execFile);

/** The exact subcommand prefix — the argv is unit-tested against this. */
export const UNPACK_ARGV_PREFIX = ['wad', 'unpack', '--deser'] as const;

/** Default temp-dir prefix (the tree lives directly under `os.tmpdir()`). */
export const TEMP_DIR_PREFIX = 'spiraldb-wad-';

/** Headroom for slower disks — the measured run is 17 s (spike 1.4a §2). */
export const DEFAULT_UNPACK_TIMEOUT_MS = 300_000;

/**
 * The CLI prints exactly one line on success, but a pathological archive could
 * print more; 64 MB is far above anything measured while never truncating.
 */
export const DEFAULT_UNPACK_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/**
 * Pure argv builder — the single home of the unpack command line, so the shape
 * is unit-testable without spawning anything (and so `--verbose` can never
 * creep back in).
 */
export function buildUnpackArgs(rootWadPath: string, tempDir: string): string[] {
  return [...UNPACK_ARGV_PREFIX, rootWadPath, tempDir];
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/** The `execFile`-shaped dependency; injected so tests never spawn a process. */
export type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: { maxBuffer: number; timeout: number },
) => Promise<ExecResult>;

export const defaultExecFile: ExecFileLike = async (file, args, options) => {
  const result = await execFileAsync(file, args as string[], options);
  return { stdout: String(result.stdout), stderr: String(result.stderr) };
};

export interface RunUnpackOptions {
  /** Settings `imcodec_path` — the prebuilt CLI binary (decision D3). */
  imcodecPath: string;
  /** `{aurorium_path}/data/{revision}/Data/GameData/Root.wad`. */
  rootWadPath: string;
  /**
   * An existing unpack tree to reuse (e.g. the spike-retained `/tmp/wad-spike`).
   * When it already holds entries the runner does **not** spawn a process and
   * reports `reused: true`. A caller-provided path is never deleted.
   */
  tempDir?: string;
  /**
   * Keep the runner-created temp dir instead of deleting it in `finally`.
   * Ignored for a caller-provided `tempDir` (which the caller owns anyway).
   */
  keepTempDir?: boolean;
  /** Injected process runner. */
  exec?: ExecFileLike;
  timeoutMs?: number;
  maxBufferBytes?: number;
  /** Injected temp-dir factory (tests pin the path). */
  createTempDir?: () => Promise<string>;
}

export interface RunUnpackResult {
  /** The directory the unpacked tree lives in. */
  tempDir: string;
  /** `true` when an existing tree was reused and no process was spawned. */
  reused: boolean;
  /** Wall-clock milliseconds of the spawn (0 when reused). */
  durationMs: number;
  /** `true` when the runner deleted the tree (owned + not kept). */
  removed: boolean;
  /** `true` when the tree still exists after the call. */
  kept: boolean;
  stdout: string;
}

/** Carries the temp dir alongside the failure so callers can report/clean up. */
export class UnpackError extends Error {
  readonly tempDir: string;

  constructor(message: string, tempDir: string, cause: unknown) {
    super(message, { cause });
    this.name = 'UnpackError';
    this.tempDir = tempDir;
  }
}

/** `true` when `dir` exists and holds at least one entry. */
export async function hasUnpackTree(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

/**
 * Unpacks `Root.wad` into a temp directory under `os.tmpdir()`.
 *
 * Two reuse paths exist, both reported through `reused`:
 *  - an explicit `tempDir` that already holds an unpack (spike-retained tree);
 *  - nothing — the runner creates its own dir, unpacks, and removes it in
 *    `finally` (including when the process fails) unless `keepTempDir` is set.
 */
export async function runUnpack(options: RunUnpackOptions): Promise<RunUnpackResult> {
  const exec = options.exec ?? defaultExecFile;
  const timeoutMs = options.timeoutMs ?? DEFAULT_UNPACK_TIMEOUT_MS;
  const maxBuffer = options.maxBufferBytes ?? DEFAULT_UNPACK_MAX_BUFFER_BYTES;
  const createTempDir =
    options.createTempDir ?? (() => mkdtemp(path.join(os.tmpdir(), TEMP_DIR_PREFIX)));

  let tempDir: string;
  if (options.tempDir) {
    tempDir = options.tempDir;
    if (await hasUnpackTree(tempDir)) {
      return { tempDir, reused: true, durationMs: 0, removed: false, kept: true, stdout: '' };
    }
    // An explicit but empty/missing path: unpack into it; the caller keeps it.
    await mkdir(tempDir, { recursive: true });
  } else {
    tempDir = await createTempDir();
    // `mkdtemp` already created it; an injected factory may not have — the
    // process needs a real destination, so make the guarantee explicit.
    await mkdir(tempDir, { recursive: true });
  }

  const owned = options.tempDir === undefined;
  const args = buildUnpackArgs(options.rootWadPath, tempDir);
  const started = Date.now();
  let stdout = '';
  let removed = false;

  try {
    const result = await exec(options.imcodecPath, args, { maxBuffer, timeout: timeoutMs });
    stdout = result.stdout;
    if (result.stderr.trim()) {
      // The CLI writes diagnostics to stderr; surface them without failing the sync.
      process.emitWarning(`[sync] imcodec wad unpack stderr: ${result.stderr.trim()}`);
    }
  } catch (error) {
    throw new UnpackError(
      `imcodec wad unpack failed for ${options.rootWadPath} (command: "${options.imcodecPath} ${args.join(
        ' ',
      )}"): ${error instanceof Error ? error.message : String(error)}`,
      tempDir,
      error,
    );
  } finally {
    if (owned && !options.keepTempDir) {
      await rm(tempDir, { recursive: true, force: true });
      removed = true;
    }
  }

  return {
    tempDir,
    reused: false,
    durationMs: Date.now() - started,
    removed,
    kept: !removed,
    stdout,
  };
}
