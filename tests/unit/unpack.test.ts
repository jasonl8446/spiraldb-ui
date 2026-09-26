import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  UNPACK_ARGV_PREFIX,
  UnpackError,
  buildUnpackArgs,
  runUnpack,
  type ExecFileLike,
} from '@server/services/sync/unpack';

/**
 * Task 1.4c acceptance (p1-05-ac3): the unpack runner spawns exactly
 * `imcodec wad unpack --deser <rootWad> <tempDir>` (never `--verbose`), unpacks
 * into a directory under `os.tmpdir()`, and always cleans up in `finally` —
 * including when the process fails.
 *
 * No test in this suite spawns the real CLI (the fake `exec` proves the call
 * shape); the real 17.2 s unpack is measured in spike 1.4a §2 and exercised
 * end-to-end by `scripts/sync-dry-run.ts` against the retained tree.
 */

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'spiraldb-unpack-test-'));
  tempRoots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const IMCODEC = '/opt/imcodec/imcodec';
const WAD = '/aurorium/data/V_r806919.Wizard_1_610/Data/GameData/Root.wad';

describe('unpack argv (task 1.4c)', () => {
  it('is exactly wad unpack --deser <rootWad> <tempDir>, with no --verbose', () => {
    const args = buildUnpackArgs(WAD, '/tmp/out');
    expect(args).toEqual(['wad', 'unpack', '--deser', WAD, '/tmp/out']);
    expect(args).toHaveLength(5);
    expect(UNPACK_ARGV_PREFIX).toEqual(['wad', 'unpack', '--deser']);
    expect(args).not.toContain('--verbose');
    expect(args.join(' ')).toBe(`wad unpack --deser ${WAD} /tmp/out`);
  });
});

describe('unpack runner — argv, temp dir and cleanup (task 1.4c)', () => {
  it('spawns the CLI with the exact argv and a temp dir under os.tmpdir(), then cleans up', async () => {
    const created = path.join(makeTempRoot(), 'spiraldb-wad-fixed');
    const calls: Array<{ file: string; args: readonly string[]; existsDuringCall: boolean }> = [];
    const exec: ExecFileLike = async (file, args) => {
      calls.push({ file, args, existsDuringCall: existsSync(String(args[4])) });
      return { stdout: "Successfully extracted 'Root.wad'.\n", stderr: '' };
    };

    const result = await runUnpack({
      imcodecPath: IMCODEC,
      rootWadPath: WAD,
      exec,
      createTempDir: async () => created,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].file).toBe(IMCODEC);
    expect(calls[0].args).toEqual(['wad', 'unpack', '--deser', WAD, created]);
    // The destination existed before the process started.
    expect(calls[0].existsDuringCall).toBe(true);
    expect(created.startsWith(os.tmpdir())).toBe(true);

    expect(result).toMatchObject({ tempDir: created, reused: false, removed: true, kept: false });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(existsSync(created)).toBe(false);
  });

  it('creates the temp dir under os.tmpdir() when none is injected', async () => {
    let seen: string | undefined;
    const exec: ExecFileLike = async (_file, args) => {
      seen = String(args[4]);
      expect(existsSync(seen)).toBe(true);
      return { stdout: '', stderr: '' };
    };
    const result = await runUnpack({
      imcodecPath: IMCODEC,
      rootWadPath: WAD,
      exec,
      keepTempDir: true,
    });
    try {
      expect(result.tempDir.startsWith(os.tmpdir())).toBe(true);
      expect(path.basename(result.tempDir).startsWith('spiraldb-wad-')).toBe(true);
      expect(seen).toBe(result.tempDir);
    } finally {
      rmSync(result.tempDir, { recursive: true, force: true });
    }
  });

  it('still cleans up when the fake process rejects, and reports the temp dir on the error', async () => {
    const created = path.join(makeTempRoot(), 'spiraldb-wad-failing');
    const exec: ExecFileLike = async () => {
      throw new Error('imcodec: unexpected end of archive');
    };

    const promise = runUnpack({
      imcodecPath: IMCODEC,
      rootWadPath: WAD,
      exec,
      createTempDir: async () => created,
    });

    // The error carries the temp dir and the underlying cause for reporting.
    const error = await promise.catch((caught: unknown) => caught as UnpackError);
    expect(error).toBeInstanceOf(UnpackError);
    expect(error.tempDir).toBe(created);
    expect((error.cause as Error).message).toBe('imcodec: unexpected end of archive');
    expect(error.message).toContain('imcodec wad unpack failed for');
    await expect(
      runUnpack({
        imcodecPath: IMCODEC,
        rootWadPath: WAD,
        exec,
        createTempDir: async () => created,
      }),
    ).rejects.toThrow(/imcodec wad unpack failed for .*unexpected end of archive/s);

    // Cleanup happened in `finally`, despite the rejection.
    expect(existsSync(created)).toBe(false);
  });

  it('keeps the temp dir when keepTempDir is set', async () => {
    const created = path.join(makeTempRoot(), 'spiraldb-wad-kept');
    const exec: ExecFileLike = async () => ({ stdout: 'ok\n', stderr: '' });
    const result = await runUnpack({
      imcodecPath: IMCODEC,
      rootWadPath: WAD,
      exec,
      keepTempDir: true,
      createTempDir: async () => created,
    });
    expect(result.kept).toBe(true);
    expect(result.removed).toBe(false);
    expect(existsSync(created)).toBe(true);
  });

  it('surfaces stderr without failing the run', async () => {
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    try {
      const exec: ExecFileLike = async () => ({ stdout: '', stderr: 'progress 50%\n' });
      const result = await runUnpack({
        imcodecPath: IMCODEC,
        rootWadPath: WAD,
        exec,
        keepTempDir: true,
      });
      expect(result.kept).toBe(true);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('progress 50%'));
      rmSync(result.tempDir, { recursive: true, force: true });
    } finally {
      warn.mockRestore();
    }
  });

  it('passes the timeout and maxBuffer options through to execFile', async () => {
    const exec = vi.fn<ExecFileLike>(async () => ({ stdout: '', stderr: '' }));
    await runUnpack({
      imcodecPath: IMCODEC,
      rootWadPath: WAD,
      exec,
      keepTempDir: true,
      timeoutMs: 1234,
      maxBufferBytes: 4096,
    });
    expect(exec).toHaveBeenCalledTimes(1);
    const options = exec.mock.calls[0][2];
    expect(options).toEqual({ maxBuffer: 4096, timeout: 1234 });
  });
});

describe('unpack runner — reuse path (spike-retained tree)', () => {
  it('reuses an existing unpack tree and never spawns the CLI', async () => {
    const existing = path.join(makeTempRoot(), 'wad-spike');
    mkdirSync(existing, { recursive: true });
    writeFileSync(path.join(existing, 'Locale'), '');

    const exec = vi.fn<ExecFileLike>(async () => ({ stdout: '', stderr: '' }));
    const result = await runUnpack({
      imcodecPath: IMCODEC,
      rootWadPath: WAD,
      tempDir: existing,
      exec,
    });

    expect(exec).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      tempDir: existing,
      reused: true,
      durationMs: 0,
      removed: false,
    });
    expect(existsSync(existing)).toBe(true);
  });

  it('unpacks into an explicit but empty temp dir and leaves it for the caller', async () => {
    const empty = path.join(makeTempRoot(), 'empty-target');
    mkdirSync(empty, { recursive: true });

    const calls: string[][] = [];
    const exec: ExecFileLike = async (_file, args) => {
      calls.push([...args]);
      return { stdout: '', stderr: '' };
    };
    const result = await runUnpack({
      imcodecPath: IMCODEC,
      rootWadPath: WAD,
      tempDir: empty,
      exec,
    });

    expect(result.reused).toBe(false);
    expect(result.removed).toBe(false);
    expect(calls[0]).toEqual(['wad', 'unpack', '--deser', WAD, empty]);
    expect(existsSync(empty)).toBe(true);
  });

  it('creates a missing explicit temp dir before spawning', async () => {
    const missing = path.join(makeTempRoot(), 'not-created-yet');
    const exec: ExecFileLike = async (_file, args) => {
      expect(existsSync(String(args[4]))).toBe(true);
      return { stdout: '', stderr: '' };
    };
    const result = await runUnpack({
      imcodecPath: IMCODEC,
      rootWadPath: WAD,
      tempDir: missing,
      exec,
    });
    expect(result.reused).toBe(false);
    expect(existsSync(missing)).toBe(true);
  });
});
