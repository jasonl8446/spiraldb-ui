import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, readFile as readFileAsync, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolveRepoRoot } from '../db.js';

/**
 * Quest extraction service — task 2.2 (story p2-04).
 *
 * `POST /api/extract/quests` hands an uploaded packet capture to the .NET CLI
 * wrapper `tools/bin/imview-packet-reader` and answers with the JSON array it
 * prints (docs/spec-domain-reference.md L597-612, docs/spec-api.md L208-231).
 * Architecture rule 4: Node never parses a capture itself — the CLI is the only
 * capture reader, and this module owns the whole subprocess contract.
 *
 * Three things here are deliberate refinements over the spec's six-line sketch:
 *
 *  1. **The child is captured, not hidden.** The spec's sketch is
 *     `promisify(execFile)`, which resolves with `{stdout, stderr}` and throws the
 *     `ChildProcess` away — but decision D9 requires the server to *kill* the child
 *     when the client aborts, so the injected runner uses `execFile`'s callback form
 *     and hands the live handle back through `onChild` (the house pattern for
 *     injected processes is `ExecFileLike` in `services/sync/unpack.ts` L52-62).
 *  2. **`DOTNET_ROOT` is derived portably.** The CLI is a .NET *apphost*, and on
 *     NixOS the apphost cannot locate `libhostfxr.so` on its own (decision D45(3)):
 *     bare, it exits 131 with "You must install .NET to run this application".
 *     `deriveDotnetRoot()` is the pure, injectable fix; `buildChildEnv()` is the
 *     wrapper the service uses. On a stock `ubuntu-24.04` runner with
 *     `actions/setup-dotnet` the same derivation finds dotnet on `PATH` and changes
 *     nothing.
 *  3. **stdout is parsed defensively.** A CLI that prints a truncated or non-JSON
 *     payload must produce the spec's `Failed to parse packet capture: …` envelope,
 *     never an unhandled `SyntaxError` in the error middleware. The `maxBuffer`
 *     overflow also has an internal escape hatch: retry once with `--output <file>`
 *     (which keeps stdout empty) and read the file instead.
 */

/** Path of the CLI inside the project root — the artifact `npm run build:cli` builds. */
export const CLI_RELATIVE_PATH = path.join('tools', 'bin', 'imview-packet-reader');

/** Default stdout cap — the spec's number verbatim (docs/spec-domain-reference.md L606). */
export const DEFAULT_MAX_BUFFER_BYTES = 50 * 1024 * 1024;

/**
 * Default timeout: **none** (0 disables it, matching the spec's blocking call).
 *
 * A capture can legitimately take minutes, and a timeout that fires would look
 * exactly like the failure it is not. Cancellation is the *client's* job — the
 * route kills the child on `req` close (D9) — so the server adds no second clock
 * of its own. `timeoutMs` stays injectable for a caller that wants one.
 */
export const DEFAULT_TIMEOUT_MS = 0;

/** How the response describes a not-built CLI — the story's ac3 wording. */
export const CLI_BUILD_HINT = 'npm run build:cli';

/** `--output` retry temp dir prefix (under `os.tmpdir()` unless injected). */
export const TEMP_DIR_PREFIX = 'spiraldb-extract-';

// ---------------------------------------------------------------------------
// Injected subprocess surface
// ---------------------------------------------------------------------------

/** The live child handle D9 needs: enough to kill it and to log its pid. */
export interface ExecChildHandle {
  /** Absent when the spawn itself failed. */
  readonly pid: number | undefined;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface ExecFileOptions {
  /** Full child environment (already carrying `DOTNET_ROOT`). */
  env: NodeJS.ProcessEnv;
  maxBuffer: number;
  /** 0 disables the timeout. */
  timeout: number;
  cwd?: string;
}

export interface ExecFileResult {
  stdout: string;
  stderr: string;
}

/**
 * The `execFile`-shaped dependency. Injected so the test suite never spawns a
 * process (and never needs .NET); the fourth parameter is the D9 hook that hands
 * the live child back before it exits.
 */
export type ExecFileWithChild = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
  onChild?: (child: ExecChildHandle) => void,
) => Promise<ExecFileResult>;

/** One failure shape for every runner — the real spawn and the test fake agree on it. */
export interface ExecFileFailureInit {
  message?: string;
  stdout?: string;
  stderr?: string;
  /** Node's error code, e.g. `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`, `ENOENT`. */
  code?: string;
  killed?: boolean;
  signal?: NodeJS.Signals;
}

export class ExecFileFailure extends Error {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: string | undefined;
  readonly killed: boolean;
  readonly signal: NodeJS.Signals | undefined;

  constructor(init: ExecFileFailureInit = {}) {
    super(init.message ?? 'CLI process failed');
    this.name = 'ExecFileFailure';
    this.stdout = init.stdout ?? '';
    this.stderr = init.stderr ?? '';
    this.code = init.code;
    this.killed = init.killed ?? false;
    this.signal = init.signal;
  }

  /** Normalises Node's own callback error (and the streams it carries). */
  static from(error: unknown, stdout: string, stderr: string): ExecFileFailure {
    const source = (error ?? {}) as {
      message?: unknown;
      code?: unknown;
      killed?: unknown;
      signal?: unknown;
    };
    return new ExecFileFailure({
      message:
        typeof source.message === 'string' && source.message
          ? source.message
          : 'CLI process failed',
      code: typeof source.code === 'string' ? source.code : undefined,
      killed: source.killed === true,
      signal: typeof source.signal === 'string' ? (source.signal as NodeJS.Signals) : undefined,
      stdout,
      stderr,
    });
  }
}

/**
 * The real runner: `execFile`'s **callback** form (not `promisify`) because the
 * returned `ChildProcess` is a first-class part of this contract.
 */
export const defaultExecFile: ExecFileWithChild = (file, args, options, onChild) =>
  new Promise<ExecFileResult>((resolve, reject) => {
    const child = execFile(
      file,
      args as string[],
      {
        env: options.env,
        maxBuffer: options.maxBuffer,
        timeout: options.timeout,
        cwd: options.cwd,
      },
      (error, stdout, stderr) => {
        const out = String(stdout ?? '');
        const err = String(stderr ?? '');
        if (error) {
          reject(ExecFileFailure.from(error, out, err));
          return;
        }
        resolve({ stdout: out, stderr: err });
      },
    );
    // `pid` is undefined when the spawn failed synchronously (e.g. ENOENT).
    onChild?.({ pid: child.pid, kill: (signal) => child.kill(signal) });
  });

/** `true` when the CLI outran the stdout cap (Node renamed this code over time). */
export function isMaxBufferFailure(error: unknown): boolean {
  if (!(error instanceof ExecFileFailure)) {
    return false;
  }
  return (
    error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ||
    error.code === 'ENOBUFS' ||
    error.code === 'ENOBUFSRANGE' ||
    /maxBuffer/i.test(error.message)
  );
}

// ---------------------------------------------------------------------------
// The child registry (D9)
// ---------------------------------------------------------------------------

/**
 * Every child one extraction run started (the main call plus the `--output`
 * retry). The route holds one of these per request and calls `killAll()` when the
 * client goes away — a per-request registry rather than a process-wide one, so
 * aborting request A can never kill request B's child.
 */
export class ChildRegistry {
  private readonly children = new Set<ExecChildHandle>();
  private killed = false;

  /** `true` once `killAll()` has run — the signal that a failure is a cancellation. */
  get cancelled(): boolean {
    return this.killed;
  }

  add(child: ExecChildHandle): void {
    if (this.killed) {
      // The abort landed between `start()` spawning and this registration; the
      // request is already gone, so do not let the child run on.
      child.kill('SIGKILL');
      return;
    }
    this.children.add(child);
  }

  /** Called when a child's exec promise settles, so `pids()` reflects live work. */
  release(child: ExecChildHandle): void {
    this.children.delete(child);
  }

  /**
   * Kills everything this run started and marks the run cancelled. The handles
   * stay registered (they are released when their exec promise settles), so a
   * caller can still report which pids it killed.
   */
  killAll(signal: NodeJS.Signals = 'SIGTERM'): number {
    this.killed = true;
    let killed = 0;
    for (const child of [...this.children]) {
      if (child.kill(signal)) {
        killed += 1;
      }
    }
    return killed;
  }

  /** Live child pids (the ones that have not settled yet). */
  pids(): number[] {
    return [...this.children]
      .map((child) => child.pid)
      .filter((pid): pid is number => typeof pid === 'number');
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * A failure that maps onto the spec's `{ "error": "…" }` envelope. `status` is
 * carried on the error so the *shared* `app.ts` middleware would render it
 * correctly too, even though the route answers directly.
 *
 * Status codes are not in the spec (it shows only the body). The smallest
 * defensible mapping: a capture the CLI could not parse is a **400** (the upload
 * is the thing that is wrong), a missing CLI is a **500** (the server was not
 * built), an oversized upload is a **413** (set in the router).
 */
export class ExtractionError extends Error {
  readonly status: number;

  constructor(message: string, status = 400, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ExtractionError';
    this.status = status;
  }
}

/** Thrown when the run was killed because the client aborted (never rendered). */
export class ExtractionCancelledError extends Error {
  constructor(message = 'Extraction cancelled: the client aborted the request') {
    super(message);
    this.name = 'ExtractionCancelledError';
  }
}

// ---------------------------------------------------------------------------
// Portable DOTNET_ROOT derivation (D45(3))
// ---------------------------------------------------------------------------

export interface DotnetRootOptions {
  /** Environment to inspect; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** `fs.existsSync` — injected so the derivation is testable without .NET. */
  exists?: (candidate: string) => boolean;
  /** `fs.realpathSync` — injected for the same reason. */
  realpath?: (candidate: string) => string;
  /** PATH separator; defaults to `path.delimiter` (`:` on POSIX, `;` on Windows). */
  pathSeparator?: string;
  /** Executable name to look for; defaults to `dotnet` / `dotnet.exe`. */
  executable?: string;
}

/**
 * The apphost's runtime root, derived in pure Node (commands/comments in
 * decision D45(3): `DOTNET_ROOT=$(dirname "$(readlink -f "$(command -v dotnet)")")`).
 *
 *  - an explicit non-blank `DOTNET_ROOT` in the environment **wins** (an operator
 *    with a side-by-side install keeps control);
 *  - otherwise the first `dotnet` found on `PATH` is resolved through symlinks and
 *    its directory is the root — on NixOS that is
 *    `…/dotnet-sdk-9.0.x/share/dotnet`, on a stock install `/usr/share/dotnet`;
 *  - when no `dotnet` is on `PATH` this returns `undefined` and the caller passes
 *    **no** `DOTNET_ROOT`, letting the apphost try on its own and surfacing its
 *    stderr (the honest failure).
 */
export function deriveDotnetRoot(options: DotnetRootOptions = {}): string | undefined {
  const env = options.env ?? process.env;

  const explicit = env.DOTNET_ROOT;
  if (typeof explicit === 'string' && explicit.trim() !== '') {
    return explicit;
  }

  const exists = options.exists ?? fs.existsSync;
  const realpath = options.realpath ?? fs.realpathSync;
  const separator = options.pathSeparator ?? path.delimiter;
  const executable = options.executable ?? (process.platform === 'win32' ? 'dotnet.exe' : 'dotnet');
  const pathValue = env.PATH ?? '';

  for (const dir of pathValue.split(separator)) {
    // An empty PATH entry means "current directory" to a shell and nothing
    // useful here — skip it rather than probing `./dotnet`.
    if (dir === '') {
      continue;
    }
    const candidate = path.join(dir, executable);
    if (!exists(candidate)) {
      continue;
    }
    try {
      return path.dirname(realpath(candidate));
    } catch {
      // Unreadable/broken symlink: keep looking further down PATH.
    }
  }

  return undefined;
}

/**
 * The child environment the CLI actually gets: the caller's base environment plus
 * a derived `DOTNET_ROOT` when one can be found. Pure (no spawning), so the
 * service can be tested against a fake PATH.
 */
export function buildChildEnv(
  base: Record<string, string | undefined> = process.env,
  options: Omit<DotnetRootOptions, 'env'> = {},
): NodeJS.ProcessEnv {
  const root = deriveDotnetRoot({ ...options, env: base });
  return root ? { ...base, DOTNET_ROOT: root } : { ...base };
}

// ---------------------------------------------------------------------------
// stdout parsing
// ---------------------------------------------------------------------------

/** A short, human name for a JSON value's type (for the "not an array" message). */
function describeJsonType(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  return Array.isArray(value) ? 'an array' : typeof value;
}

/**
 * Parses the CLI's stdout as the contract's JSON **array** of QuestTemplate
 * objects. Every malformed case becomes the spec's error shape instead of an
 * unhandled exception: the whole point of this function is that a bad CLI run can
 * never take the server down (P2 AC#3).
 */
export function parseQuestArray(text: string, source: string): unknown[] {
  const trimmed = text.trim();
  if (trimmed === '') {
    throw new ExtractionError(
      `Failed to parse packet capture: the CLI produced no output (${source})`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new ExtractionError(
      `Failed to parse packet capture: CLI output was not valid JSON (${source}: ${
        error instanceof Error ? error.message : String(error)
      })`,
      400,
      { cause: error },
    );
  }

  if (!Array.isArray(parsed)) {
    throw new ExtractionError(
      `Failed to parse packet capture: expected a JSON array of quests, got ${describeJsonType(
        parsed,
      )} (${source})`,
    );
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export interface ExtractionServiceOptions {
  /** CLI to run; defaults to `<repo root>/tools/bin/imview-packet-reader`. */
  cliPath?: string;
  /** Injected process runner (tests never spawn). */
  exec?: ExecFileWithChild;
  /** Base environment the child inherits; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** stdout cap; defaults to the spec's 50 MB. */
  maxBufferBytes?: number;
  /** 0 (default) means no timeout. */
  timeoutMs?: number;
  /** Where the `--output` retry temp dir is created; defaults to `os.tmpdir()`. */
  tempRoot?: string;
  /** Injected temp-dir factory (tests pin the path). */
  createTempDir?: () => Promise<string>;
  /** Injected file reader for the `--output` retry payload. */
  readTextFile?: (file: string) => Promise<string>;
  /** Injected removal of the retry temp dir. */
  removePath?: (target: string) => Promise<void>;
  /** Injected CLI existence probe (so a "CLI missing" test spawns nothing). */
  fileExists?: (candidate: string) => boolean;
  /** Injected child-environment builder — the DOTNET_ROOT seam. */
  buildEnv?: (base: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
}

/**
 * One extraction attempt. `children` is live from the moment `start()` returns,
 * so the route can arm its abort handler *before* awaiting `result`.
 */
export interface ExtractionRun {
  readonly children: ChildRegistry;
  readonly result: Promise<unknown[]>;
}

export interface ExtractionService {
  /** The path this service will run — reported by callers/errors. */
  readonly cliPath: string;
  start(capturePath: string): ExtractionRun;
}

export function defaultCliPath(): string {
  return path.join(resolveRepoRoot(), CLI_RELATIVE_PATH);
}

/** The spec's message shape, with the CLI's own stderr as the detail. */
function failedToParse(detail: string, cause: unknown): ExtractionError {
  return new ExtractionError(`Failed to parse packet capture: ${detail}`, 400, { cause });
}

/** The ac3 wording for a CLI that is not built (or vanished before the spawn). */
export function cliMissingError(cliPath: string): ExtractionError {
  return new ExtractionError(
    `Packet capture CLI not found at ${cliPath}. Build it with: ${CLI_BUILD_HINT}`,
    500,
  );
}

export function createExtractionService(options: ExtractionServiceOptions = {}): ExtractionService {
  const cliPath = options.cliPath ?? defaultCliPath();
  const exec = options.exec ?? defaultExecFile;
  const baseEnv = options.env ?? process.env;
  const maxBuffer = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fileExists = options.fileExists ?? fs.existsSync;
  const buildEnv = options.buildEnv ?? ((base: NodeJS.ProcessEnv) => buildChildEnv(base));
  const readTextFile = options.readTextFile ?? ((file: string) => readFileAsync(file, 'utf8'));
  const removePath =
    options.removePath ?? ((target: string) => rm(target, { recursive: true, force: true }));
  const createTempDir =
    options.createTempDir ??
    (() => mkdtemp(path.join(options.tempRoot ?? os.tmpdir(), TEMP_DIR_PREFIX)));

  /** Spawns once and keeps the child in the run's registry for D9. */
  async function runCli(
    children: ChildRegistry,
    args: string[],
    env: NodeJS.ProcessEnv,
  ): Promise<ExecFileResult> {
    let child: ExecChildHandle | undefined;
    try {
      return await exec(cliPath, args, { env, maxBuffer, timeout }, (handle) => {
        child = handle;
        children.add(handle);
      });
    } finally {
      if (child) {
        children.release(child);
      }
    }
  }

  /** Maps any runner failure onto the spec's envelope (or a cancellation). */
  function describeFailure(error: unknown, fileMode: boolean): Error {
    if (error instanceof ExtractionError || error instanceof ExtractionCancelledError) {
      return error;
    }
    if (error instanceof ExecFileFailure) {
      if (error.code === 'ENOENT') {
        // The existence probe passed but the spawn still failed — the binary
        // disappeared between the two, or is not executable. Same advice.
        return cliMissingError(cliPath);
      }
      const stderr = error.stderr.trim();
      const detail = stderr || error.message || 'the CLI exited without a message';
      if (isMaxBufferFailure(error)) {
        const mb = Math.round(maxBuffer / (1024 * 1024));
        return failedToParse(
          `the CLI's output exceeded the ${mb} MB buffer even in --output file mode. ` +
            `Try extracting from a smaller capture. (${detail})`,
          error,
        );
      }
      if (fileMode) {
        return failedToParse(`${detail} (retried with --output file mode)`, error);
      }
      return failedToParse(detail, error);
    }
    return failedToParse(error instanceof Error ? error.message : String(error), error);
  }

  async function extract(capturePath: string, children: ChildRegistry): Promise<unknown[]> {
    if (!fileExists(cliPath)) {
      throw cliMissingError(cliPath);
    }
    const env = buildEnv(baseEnv);

    try {
      const { stdout } = await runCli(children, ['--input', capturePath], env);
      return parseQuestArray(stdout, 'stdout');
    } catch (error) {
      if (children.cancelled) {
        throw new ExtractionCancelledError();
      }
      if (!isMaxBufferFailure(error)) {
        throw describeFailure(error, false);
      }

      // --output escape hatch (task 2.2): the same run, with stdout kept empty so
      // the payload can never hit the cap. The CLI creates parent directories.
      //
      // Announced on stderr (the house diagnostic channel — cf. `unpack.ts` L164)
      // so an operator can see that a capture needed the escape hatch at all.
      process.emitWarning(
        `[extract] CLI stdout exceeded the ${Math.round(maxBuffer / (1024 * 1024))} MB buffer ` +
          `for ${capturePath}; retrying with --output file mode`,
      );
      const tempDir = await createTempDir();
      const outFile = path.join(tempDir, 'quests.json');
      try {
        await runCli(children, ['--input', capturePath, '--output', outFile], env);
        return parseQuestArray(await readTextFile(outFile), outFile);
      } catch (retryError) {
        if (children.cancelled) {
          throw new ExtractionCancelledError();
        }
        throw describeFailure(retryError, true);
      } finally {
        // The retry payload can be tens of MB; never leave it behind.
        await removePath(tempDir).catch((cleanupError: unknown) => {
          process.emitWarning(
            `[extract] could not remove the --output temp dir ${tempDir}: ${
              cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
            }`,
          );
        });
      }
    }
  }

  return {
    cliPath,
    start(capturePath: string): ExtractionRun {
      const children = new ChildRegistry();
      return { children, result: extract(capturePath, children) };
    },
  };
}
