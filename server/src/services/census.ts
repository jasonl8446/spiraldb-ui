import fs from 'node:fs';
import path from 'node:path';

import { resolveRepoRoot } from '../db.js';
import {
  buildChildEnv,
  DEFAULT_MAX_BUFFER_BYTES,
  defaultExecFile,
  type ChildRegistry,
  type ExecChildHandle,
  type ExecFileWithChild,
} from './extraction.js';

/**
 * Packet-census service — task 7.2 (p7-03, D128/D139).
 *
 * `POST /api/extract/quests?census=1` runs `tools/bin/capture-census` on the same uploaded capture the
 * reader just extracted and returns its rows next to the quests, so the upload page can list what the
 * reader ignored. The census is an extra: the extraction result is already good, so a census that
 * cannot run (binary not built, non-zero exit, unreadable output) is reported as `{ skipped: <reason> }`
 * and never fails the request — the same posture as the sync's missing `wad-scan` (D55).
 */

/** Path of the census tool inside the project root — the artifact `npm run build:census` builds. */
export const CENSUS_RELATIVE_PATH = path.join('tools', 'bin', 'capture-census');

/** How a skipped census names the fix. */
export const CENSUS_BUILD_HINT = 'npm run build:census';

/** One row of the census (docs/spec-domain-reference.md, "the packet census"). */
export interface CensusRow {
  message: string;
  field: string;
  /** Number of messages of this type that carry the field. */
  count: number;
  /** `true` when QuestBuilder or the wrapper reads the field. */
  consumed: boolean;
}

export interface CensusResult {
  /** Envelopes read. */
  messages: number;
  rows: CensusRow[];
}

export type CensusOutcome = CensusResult | { skipped: string };

export interface CensusService {
  /** Never rejects: every failure becomes `{ skipped }`. */
  run(capturePath: string, children: ChildRegistry): Promise<CensusOutcome>;
}

export interface CensusServiceOptions {
  /** Tool to run; defaults to `<repo root>/tools/bin/capture-census`. */
  binaryPath?: string;
  /** Injected process runner (tests never spawn). */
  exec?: ExecFileWithChild;
  /** Base environment the child inherits; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Injected existence probe. */
  fileExists?: (candidate: string) => boolean;
}

export function defaultCensusPath(): string {
  return path.join(resolveRepoRoot(), CENSUS_RELATIVE_PATH);
}

function isCensusResult(value: unknown): value is CensusResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { messages?: unknown; rows?: unknown };
  return typeof candidate.messages === 'number' && Array.isArray(candidate.rows);
}

/**
 * One row of the documented shape (PR #14 review 9c): a drifted tool output must not be served as a
 * census — a row without `consumed` would render as "ignored by the reader".
 */
function isCensusRow(value: unknown): value is CensusRow {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const row = value as Partial<Record<keyof CensusRow, unknown>>;
  return (
    typeof row.message === 'string' &&
    typeof row.field === 'string' &&
    typeof row.count === 'number' &&
    typeof row.consumed === 'boolean'
  );
}

export function createCensusService(options: CensusServiceOptions = {}): CensusService {
  const binaryPath = options.binaryPath ?? defaultCensusPath();
  const exec = options.exec ?? defaultExecFile;
  const fileExists = options.fileExists ?? fs.existsSync;

  return {
    async run(capturePath, children) {
      if (!fileExists(binaryPath)) {
        return {
          skipped: `capture-census not found at ${binaryPath}. Build it with: ${CENSUS_BUILD_HINT}`,
        };
      }
      let child: ExecChildHandle | undefined;
      try {
        const { stdout } = await exec(
          binaryPath,
          ['--input', capturePath],
          {
            env: buildChildEnv(options.env ?? process.env),
            maxBuffer: DEFAULT_MAX_BUFFER_BYTES,
            timeout: 0,
          },
          (handle) => {
            child = handle;
            children.add(handle);
          },
        );
        const parsed: unknown = JSON.parse(stdout);
        if (!isCensusResult(parsed)) {
          return { skipped: 'capture-census printed JSON without messages and rows' };
        }
        if (!parsed.rows.every(isCensusRow)) {
          return {
            skipped: 'capture-census printed a row that is not {message, field, count, consumed}',
          };
        }
        // `input` is the server's temp upload name: not part of the API result.
        return { messages: parsed.messages, rows: parsed.rows };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { skipped: `capture-census failed: ${detail}` };
      } finally {
        // Settled: out of the run's registry, as the reader's own child is (review 9c).
        if (child !== undefined) {
          children.release(child);
        }
      }
    },
  };
}
