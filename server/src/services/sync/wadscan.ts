import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { resolveRepoRoot } from '../../db.js';
import { buildChildEnv } from '../extraction.js';

/**
 * `wad-scan` batch tool — task 6.2
 * ([plan-phase-6-quest-catalog.md](../../../../docs/plan-phase-6-quest-catalog.md) L212–225).
 *
 * The TypeScript half of the batch reader: a **pure argv builder** per command, an injectable
 * invoker, and one typed outcome that distinguishes a run from a **missing binary**.
 *
 * ```
 * census   tools/bin/wad-scan census  --gamedata <dir> [--classes <ClientDump.json>] [--json <path>]
 * extract  tools/bin/wad-scan extract --gamedata <dir> --select <glob,glob> --out <ndjson>
 * ```
 *
 * ## Why `skipped` is a result and not an exception (p6-03-ac4, D55)
 *
 * The tool is .NET and CI has no .NET SDK, so its absence is an ordinary state of the world, not a
 * failure: a machine that never ran `npm run build:wadscan` must still sync. A missing binary
 * therefore resolves to `{ status: 'skipped', reason: 'binary-missing', … }` with the path and the
 * build command in `message` — never a throw (that would fail the sync) and never a silent empty
 * result (that would look like a corpus with nothing in it). Two routes reach it: the existence
 * probe before the spawn, and `ENOENT` from the spawn itself when the binary vanishes in between.
 * Every other outcome is loud — a non-zero exit throws {@link WadScanError}.
 *
 * ## Measured on this host (2026-09-28, the 19 GB `V_r806919.Wizard_1_610` tree)
 *
 * | Command | Result |
 * |---|---|
 * | `census` | 3,589 WADs / 183,676 objects in 142 classes, 28.8 s |
 * | `extract --select gamedata.bin,triggers.xml` | **6,733 rows in 5.31 s** (the per-file `imcodec` CLI fallback: ≈22 min) |
 *
 * The timeout is headroom over those numbers, not a tuned value.
 */

const execFileAsync = promisify(execFile);

/** Path of the batch tool inside the project root — the artifact `npm run build:wadscan` builds. */
export const WADSCAN_RELATIVE_PATH = path.join('tools', 'bin', 'wad-scan');

/** How a report describes a tool that has not been built. */
export const WADSCAN_BUILD_HINT = 'npm run build:wadscan';

/** Wall-clock headroom: the measured census is 28.8 s and the 6,733-row extract 5.31 s. */
export const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * stdout cap. The census table is ~150 short lines and `extract` writes its rows to `--out`
 * (nothing to stdout at all), so this is generous by two orders of magnitude.
 */
export const DEFAULT_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

export const CENSUS_COMMAND = 'census';
export const EXTRACT_COMMAND = 'extract';

export type WadScanCommand = typeof CENSUS_COMMAND | typeof EXTRACT_COMMAND;

/** The requested run. `select`/`outPath` are required for `extract` by construction, not by check. */
export type WadScanRequest =
  | {
      command: typeof CENSUS_COMMAND;
      /** Directory tree holding the `*.wad` archives (the sync's resolved `GameData`). */
      gamedataDir: string;
      /** Imcodec `ClientDump.json`; without it `census` cannot recognise shape-B entries. */
      classesPath?: string;
      /** Where the census writes its full JSON result. */
      jsonPath?: string;
    }
  | {
      command: typeof EXTRACT_COMMAND;
      gamedataDir: string;
      /**
       * Entry-name globs, matched case-sensitively against the **full stored entry name** by the
       * tool — the same rule as `matchGlob`/`selectEntries` in
       * [wadindex.ts](./wadindex.ts): `*` and `?` stop at `/`, `**` crosses it, and a bare
       * `gamedata.bin` selects the flat entries. A nested path therefore needs `**`.
       */
      select: readonly string[];
      /** NDJSON destination: one compact row per selected entry. */
      outPath: string;
    };

/** census: `census --gamedata <dir> [--classes <path>] [--json <path>]` — in that order. */
export function buildCensusArgs(request: Extract<WadScanRequest, { command: 'census' }>): string[] {
  const args = [CENSUS_COMMAND, '--gamedata', request.gamedataDir];
  if (request.classesPath !== undefined) {
    args.push('--classes', request.classesPath);
  }
  if (request.jsonPath !== undefined) {
    args.push('--json', request.jsonPath);
  }
  return args;
}

/**
 * extract: `extract --gamedata <dir> --select <globs> --out <ndjson>`.
 *
 * An empty selection is refused here rather than passed on: a tool with no globs writes an empty
 * NDJSON file and exits 0, which is indistinguishable from "the corpus held nothing" — the one
 * outcome a caller can neither see nor recover from.
 */
export function buildExtractArgs(
  request: Extract<WadScanRequest, { command: 'extract' }>,
): string[] {
  if (request.select.length === 0) {
    throw new Error('wad-scan extract needs at least one --select glob');
  }
  if (request.outPath === '') {
    throw new Error('wad-scan extract needs an --out path');
  }
  return [
    EXTRACT_COMMAND,
    '--gamedata',
    request.gamedataDir,
    '--select',
    request.select.join(','),
    '--out',
    request.outPath,
  ];
}

/** The argv for a request — the single place a command line is assembled. */
export function buildWadScanArgs(request: WadScanRequest): string[] {
  return request.command === CENSUS_COMMAND ? buildCensusArgs(request) : buildExtractArgs(request);
}

/** `<repo root>/tools/bin/wad-scan` — derived, never a hardcoded absolute path. */
export function defaultWadScanPath(): string {
  return path.join(resolveRepoRoot(), WADSCAN_RELATIVE_PATH);
}

/** `execFile`-shaped, with the child environment — injected so tests never spawn a process. */
export type WadScanExec = (
  file: string,
  args: readonly string[],
  options: { maxBuffer: number; timeout: number; env: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }>;

export const defaultWadScanExec: WadScanExec = async (file, args, options) => {
  const result = await execFileAsync(file, args as string[], options);
  return { stdout: String(result.stdout), stderr: String(result.stderr) };
};

/** Why a run did not happen. The only reason today is the tool not being built. */
export type WadScanSkipReason = 'binary-missing';

/** A completed run. `stderr` carries the tool's summary line (counts, timings, failures). */
export interface WadScanOk {
  status: 'ok';
  command: WadScanCommand;
  binaryPath: string;
  /** The exact argv, so a caller can log the command line it ran. */
  args: string[];
  stdout: string;
  stderr: string;
  durationMs: number;
}

/** A run that did not happen because the tool is absent. Not an error, not a failed sync. */
export interface WadScanSkipped {
  status: 'skipped';
  reason: WadScanSkipReason;
  command: WadScanCommand;
  binaryPath: string;
  args: string[];
  /** Human-readable, names the path and the build command (p6-05's catalog stage reports this). */
  message: string;
}

export type WadScanResult = WadScanOk | WadScanSkipped;

/** A run that happened and failed — loud, unlike the missing-binary path. */
export class WadScanError extends Error {
  readonly command: WadScanCommand;

  constructor(message: string, command: WadScanCommand, cause: unknown) {
    super(message, { cause });
    this.name = 'WadScanError';
    this.command = command;
  }
}

export interface RunWadScanOptions {
  request: WadScanRequest;
  /** Overrides the derived binary path (tests, a non-sibling checkout). */
  binaryPath?: string;
  /** Injected process runner. */
  exec?: WadScanExec;
  /** Injected existence probe (so the `skipped` test spawns nothing). */
  fileExists?: (candidate: string) => boolean;
  /** Base environment for the child; defaults to `process.env` + the derived `DOTNET_ROOT`. */
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxBufferBytes?: number;
}

/** The one message both skip routes report. */
export function wadScanSkipMessage(binaryPath: string): string {
  return `WAD batch tool not found at ${binaryPath}. Build it with: ${WADSCAN_BUILD_HINT}`;
}

function isMissingBinary(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
  );
}

/**
 * Runs one `wad-scan` command.
 *
 * The child gets a derived `DOTNET_ROOT` (D45(3)) for the same reason the packet-reader CLI does:
 * `wad-scan` is a .NET apphost, and on NixOS an apphost started without one exits 131 with
 * "You must install .NET to run this application". On a stock runner the derivation finds dotnet
 * on `PATH` and changes nothing.
 */
export async function runWadScan(options: RunWadScanOptions): Promise<WadScanResult> {
  const { request } = options;
  const binaryPath = options.binaryPath ?? defaultWadScanPath();
  const args = buildWadScanArgs(request);
  const fileExists = options.fileExists ?? fs.existsSync;

  if (!fileExists(binaryPath)) {
    return {
      status: 'skipped',
      reason: 'binary-missing',
      command: request.command,
      binaryPath,
      args,
      message: wadScanSkipMessage(binaryPath),
    };
  }

  const exec = options.exec ?? defaultWadScanExec;
  const env = options.env ?? buildChildEnv();
  const started = Date.now();

  try {
    const result = await exec(binaryPath, args, {
      maxBuffer: options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      env,
    });

    return {
      status: 'ok',
      command: request.command,
      binaryPath,
      args,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    // The binary was there a moment ago and is not now: that is still "not built", not a failed run.
    if (isMissingBinary(error)) {
      return {
        status: 'skipped',
        reason: 'binary-missing',
        command: request.command,
        binaryPath,
        args,
        message: wadScanSkipMessage(binaryPath),
      };
    }

    throw new WadScanError(
      `wad-scan ${request.command} failed (command: "${binaryPath} ${args.join(' ')}"): ${
        error instanceof Error ? error.message : String(error)
      }`,
      request.command,
      error,
    );
  }
}
