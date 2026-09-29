import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { resolveRepoRoot } from '@server/db';
import {
  CENSUS_COMMAND,
  EXTRACT_COMMAND,
  WADSCAN_BUILD_HINT,
  WADSCAN_RELATIVE_PATH,
  WadScanError,
  buildCensusArgs,
  buildExtractArgs,
  buildWadScanArgs,
  defaultWadScanPath,
  runWadScan,
  wadScanSkipMessage,
  type WadScanExec,
  type WadScanRequest,
  type WadScanResult,
} from '@server/services/sync/wadscan';

/**
 * Task 6.2 acceptance (p6-03-ac4): the TypeScript consumer of the batch tool — its argv shape, its
 * typed `skipped` result when the tool has not been built, and its loud failure path.
 *
 * **Not one test in this suite spawns the real binary**, because CI has no .NET SDK (D55): every
 * run injects a fake `exec`, and the "missing tool" cases inject a fake `fileExists` so not even a
 * probe touches the filesystem. The real binary is exercised against the 19 GB tree by the story's
 * evidence runs (`census` 183,676 objects / 141 distinct classes — 142 shape-class rows, because
 * `WizZoneData` appears in both header shapes; `extract` 6,733 rows in 5.31 s).
 */

const GAMEDATA = '/aurorium/data/V_r806919.Wizard_1_610/Data/GameData';
const CLIENT_DUMP =
  '/imview/submodule/Imcodec/src/Imcodec.ObjectProperty/GeneratorInput/ClientDump.json';
const BINARY = '/workspace/tools/bin/wad-scan';

/** The extract request shape, named so a literal's `command` is not widened to `string`. */
type ExtractRequest = Extract<WadScanRequest, { command: 'extract' }>;

/** Narrows a result to its `ok` arm (an `expect` alone does not narrow for TypeScript). */
function expectOk(result: WadScanResult): Extract<WadScanResult, { status: 'ok' }> {
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') {
    throw new Error('expected a completed run');
  }
  return result;
}

/** Narrows a result to its `skipped` arm. */
function expectSkipped(result: WadScanResult): Extract<WadScanResult, { status: 'skipped' }> {
  expect(result.status).toBe('skipped');
  if (result.status !== 'skipped') {
    throw new Error('expected a skipped run');
  }
  return result;
}

/** A fake runner that records the call and answers with the given streams. */
function recordingExec(result: { stdout: string; stderr: string }) {
  const calls: Array<{
    file: string;
    args: readonly string[];
    options: { maxBuffer: number; timeout: number; env: NodeJS.ProcessEnv };
  }> = [];

  const exec: WadScanExec = async (file, args, options) => {
    calls.push({ file, args, options });
    return result;
  };

  return { exec, calls };
}

describe('wad-scan argv (task 6.2)', () => {
  it('builds the census command, omitting flags that were not asked for', () => {
    expect(buildCensusArgs({ command: CENSUS_COMMAND, gamedataDir: GAMEDATA })).toEqual([
      'census',
      '--gamedata',
      GAMEDATA,
    ]);
    expect(buildWadScanArgs({ command: CENSUS_COMMAND, gamedataDir: GAMEDATA })).toHaveLength(3);
  });

  it('builds the census command with --classes and --json in that order', () => {
    const args = buildCensusArgs({
      command: CENSUS_COMMAND,
      gamedataDir: GAMEDATA,
      classesPath: CLIENT_DUMP,
      jsonPath: '/tmp/census.json',
    });

    expect(args).toEqual([
      'census',
      '--gamedata',
      GAMEDATA,
      '--classes',
      CLIENT_DUMP,
      '--json',
      '/tmp/census.json',
    ]);
  });

  it('builds the extract command with the globs comma-joined and the out path last', () => {
    const request: ExtractRequest = {
      command: EXTRACT_COMMAND,
      gamedataDir: GAMEDATA,
      select: ['gamedata.bin', 'triggers.xml'],
      outPath: '/tmp/zone-data.ndjson',
    };

    expect(buildExtractArgs(request)).toEqual([
      'extract',
      '--gamedata',
      GAMEDATA,
      '--select',
      'gamedata.bin,triggers.xml',
      '--out',
      '/tmp/zone-data.ndjson',
    ]);
    // The nested-path form survives verbatim: `**` is the tool's own glob syntax, not the shell's.
    expect(buildExtractArgs({ ...request, select: ['**/triggers.xml'] })).toContain(
      '**/triggers.xml',
    );
  });

  it('refuses an empty selection instead of writing an empty NDJSON file', () => {
    expect(() =>
      buildExtractArgs({
        command: EXTRACT_COMMAND,
        gamedataDir: GAMEDATA,
        select: [],
        outPath: '/tmp/out.ndjson',
      }),
    ).toThrow(/at least one --select glob/);
  });

  it('refuses an extract without an output path', () => {
    expect(() =>
      buildExtractArgs({
        command: EXTRACT_COMMAND,
        gamedataDir: GAMEDATA,
        select: ['gamedata.bin'],
        outPath: '',
      }),
    ).toThrow(/--out path/);
  });
});

describe('wad-scan binary location (task 6.2)', () => {
  it('derives tools/bin/wad-scan from the repo root, never a hardcoded path', () => {
    const binaryPath = defaultWadScanPath();

    expect(WADSCAN_RELATIVE_PATH).toBe(path.join('tools', 'bin', 'wad-scan'));
    expect(binaryPath).toBe(path.join(resolveRepoRoot(), 'tools', 'bin', 'wad-scan'));
    expect(path.isAbsolute(binaryPath)).toBe(true);
  });
});

describe('wad-scan invoker — skipped is a result, not a failure (p6-03-ac4)', () => {
  it('returns a typed skipped when the binary is absent, and spawns nothing', async () => {
    const { exec, calls } = recordingExec({ stdout: '', stderr: '' });

    const result = await runWadScan({
      request: {
        command: EXTRACT_COMMAND,
        gamedataDir: GAMEDATA,
        select: ['gamedata.bin'],
        outPath: '/tmp/out.ndjson',
      },
      binaryPath: BINARY,
      exec,
      fileExists: () => false,
    });

    expect(result).toEqual({
      status: 'skipped',
      reason: 'binary-missing',
      command: EXTRACT_COMMAND,
      binaryPath: BINARY,
      args: [
        'extract',
        '--gamedata',
        GAMEDATA,
        '--select',
        'gamedata.bin',
        '--out',
        '/tmp/out.ndjson',
      ],
      message: wadScanSkipMessage(BINARY),
    });
    // The reason is in the message, which is what p6-05's catalog stage reports.
    expect(expectSkipped(result).message).toContain(BINARY);
    expect(expectSkipped(result).message).toContain(WADSCAN_BUILD_HINT);
    expect(calls).toHaveLength(0);
  });

  it('still reports skipped (never a failed sync) when the binary vanishes before the spawn', async () => {
    const exec: WadScanExec = vi.fn(async () => {
      const error = new Error(`spawn ${BINARY} ENOENT`) as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    });

    const result = await runWadScan({
      request: { command: CENSUS_COMMAND, gamedataDir: GAMEDATA },
      binaryPath: BINARY,
      exec,
      fileExists: () => true,
    });

    expect(result.status).toBe('skipped');
    expect(result).toMatchObject({
      reason: 'binary-missing',
      command: CENSUS_COMMAND,
      binaryPath: BINARY,
    });
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('runs through the fake and reports the streams, argv and child environment', async () => {
    const { exec, calls } = recordingExec({
      stdout: 'wads: 3589\nobject entries total: 183676 in 142 classes\n',
      stderr: '',
    });

    const result = await runWadScan({
      request: { command: CENSUS_COMMAND, gamedataDir: GAMEDATA, classesPath: CLIENT_DUMP },
      binaryPath: BINARY,
      exec,
      fileExists: () => true,
      env: { DOTNET_ROOT: '/nix/store/dotnet/share/dotnet' },
      timeoutMs: 1234,
      maxBufferBytes: 4096,
    });

    expect(result.status).toBe('ok');
    expect(result).toMatchObject({
      command: CENSUS_COMMAND,
      binaryPath: BINARY,
      args: ['census', '--gamedata', GAMEDATA, '--classes', CLIENT_DUMP],
      stdout: 'wads: 3589\nobject entries total: 183676 in 142 classes\n',
      stderr: '',
    });
    expect(expectOk(result).durationMs).toBeGreaterThanOrEqual(0);

    expect(calls).toHaveLength(1);
    expect(calls[0].file).toBe(BINARY);
    expect(calls[0].args).toEqual(['census', '--gamedata', GAMEDATA, '--classes', CLIENT_DUMP]);
    expect(calls[0].options).toMatchObject({
      timeout: 1234,
      maxBuffer: 4096,
      // The apphost needs DOTNET_ROOT (D45(3)); the caller's environment is passed through.
      env: { DOTNET_ROOT: '/nix/store/dotnet/share/dotnet' },
    });
  });

  it('throws a typed error, naming the command line, when the tool itself fails', async () => {
    const exec: WadScanExec = async () => {
      throw new Error('Command failed: exit code 1\nstderr: --gamedata directory not found: /nope');
    };

    const failure: unknown = await runWadScan({
      request: {
        command: EXTRACT_COMMAND,
        gamedataDir: '/nope',
        select: ['gamedata.bin'],
        outPath: '/tmp/out.ndjson',
      },
      binaryPath: BINARY,
      exec,
      fileExists: () => true,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(WadScanError);
    expect((failure as WadScanError).command).toBe(EXTRACT_COMMAND);
    // The message carries the exact command line, so a failed run is diagnosable from the log.
    expect((failure as Error).message).toContain(
      `${BINARY} extract --gamedata /nope --select gamedata.bin --out /tmp/out.ndjson`,
    );
  });
});
