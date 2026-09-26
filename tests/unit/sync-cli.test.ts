import { afterEach, describe, expect, it } from 'vitest';

import { MEMORY_DB, openDb, type Db } from '@server/db';
import { formatSyncSummary, parseSyncArgs, runSyncCli } from '@server/services/sync/cli';
import type { RunSyncOptions, RunSyncResult } from '@server/services/sync/execute';

/**
 * `npm run sync` logic (task 1.4g) — flags, summary formatting and exit codes,
 * all exercised by injecting the orchestrator instead of spawning a process.
 */

const OPEN: Db[] = [];

afterEach(() => {
  while (OPEN.length > 0) {
    OPEN.pop()?.close();
  }
});

function memoryDb(): Db {
  const db = openDb({ file: MEMORY_DB });
  OPEN.push(db);
  return db;
}

const SUCCESS: RunSyncResult = {
  status: 'success',
  revision: 'V_r806919.Wizard_1_610',
  counts: {
    items: 1234,
    spells: 2,
    npcs: 3,
    quests: 4,
    zones: 5,
    drop_tables: 6,
    string_table: 217394,
  },
  deduplicated: { items: 0, spells: 0, npcs: 0 },
  durationMs: 24_300,
  timestamp: '2026-09-25T15:30:00Z',
  reused: true,
  treeDir: '/tmp/wad-spike',
  timings: { unpackMs: 0, scanMs: 4100, writeMs: 3000 },
};

interface Capture {
  lines: string[];
  errors: string[];
}

function capture(): { out: (line: string) => void; err: (line: string) => void } & Capture {
  const state: Capture = { lines: [], errors: [] };
  return {
    ...state,
    out: (line) => state.lines.push(line),
    err: (line) => state.errors.push(line),
  };
}

describe('parseSyncArgs', () => {
  it('accepts both --flag value and --flag=value', () => {
    expect(parseSyncArgs(['--tree', '/tmp/x'], {}).tree).toBe('/tmp/x');
    expect(parseSyncArgs(['--tree=/tmp/x'], {}).tree).toBe('/tmp/x');
  });

  it('falls back to the environment, with flags winning', () => {
    const env = { SPIRALDB_SYNC_TREE: '/tmp/env', SPIRALDB_SYNC_DB: '/tmp/db.sqlite' };
    expect(parseSyncArgs([], env).tree).toBe('/tmp/env');
    expect(parseSyncArgs([], env).dbFile).toBe('/tmp/db.sqlite');
    expect(parseSyncArgs(['--tree', '/tmp/flag'], env).tree).toBe('/tmp/flag');
    expect(parseSyncArgs([], { SPIRALDB_SYNC_TREE: '' }).tree).toBeUndefined();
  });

  it('rejects unknown flags and flags with a missing value', () => {
    expect(parseSyncArgs(['--nope'], {}).unknown).toEqual(['--nope']);
    expect(parseSyncArgs(['--tree'], {}).unknown).toEqual(['--tree']);
    expect(parseSyncArgs(['--tree', '--db', '/tmp/x'], {}).unknown).toEqual(['--tree']);
  });

  it('recognises --help', () => {
    expect(parseSyncArgs(['--help'], {}).help).toBe(true);
    expect(parseSyncArgs(['-h'], {}).help).toBe(true);
  });
});

describe('formatSyncSummary', () => {
  it('prints the revision, every table count, the timing split and the status', () => {
    const text = formatSyncSummary(SUCCESS).join('\n');

    expect(text).toContain('success');
    expect(text).toContain('V_r806919.Wizard_1_610');
    expect(text).toContain('reused /tmp/wad-spike');
    expect(text).toContain('items');
    expect(text).toContain('1,234');
    expect(text).toContain('217,394');
    expect(text).toContain('0 ms / 4.1 s / 3.0 s');
    expect(text).toContain('24.3 s');
  });

  it('prints the error and no counts for a failed run', () => {
    const text = formatSyncSummary({
      ...SUCCESS,
      status: 'failed',
      revision: null,
      reused: false,
      errorMessage: 'unpack exploded',
    }).join('\n');

    expect(text).toContain('FAILED');
    expect(text).toContain('unpack exploded');
    expect(text).toContain('failed row written');
    expect(text).not.toContain('string_table');
  });
});

describe('runSyncCli', () => {
  it('returns 0 and prints the summary on success', async () => {
    const io = capture();
    const seen: RunSyncOptions[] = [];

    const code = await runSyncCli({
      db: memoryDb(),
      argv: ['--tree', '/tmp/wad-spike'],
      env: {},
      stdout: io.out,
      stderr: io.err,
      run: async (options) => {
        seen.push(options);
        return SUCCESS;
      },
    });

    expect(code).toBe(0);
    expect(io.errors).toEqual([]);
    expect(io.lines.join('\n')).toContain('V_r806919.Wizard_1_610');
    expect(seen[0].treeDir).toBe('/tmp/wad-spike');
    expect(seen[0].overrides).toEqual({
      auroriumPath: undefined,
      imcodecPath: undefined,
      spiraldbPath: undefined,
    });
  });

  it('returns 1 and reports the error on the stderr stream when the sync fails', async () => {
    const io = capture();

    const code = await runSyncCli({
      db: memoryDb(),
      argv: [],
      env: {},
      stdout: io.out,
      stderr: io.err,
      run: async () => ({ ...SUCCESS, status: 'failed', errorMessage: 'no revision found' }),
    });

    expect(code).toBe(1);
    expect(io.errors.join('\n')).toContain('no revision found');
    expect(io.lines.join('\n')).toContain('FAILED');
  });

  it('returns 2 for an unknown flag, without running the orchestrator', async () => {
    const io = capture();
    let calls = 0;

    const code = await runSyncCli({
      db: memoryDb(),
      argv: ['--bogus'],
      env: {},
      stdout: io.out,
      stderr: io.err,
      run: async () => {
        calls += 1;
        return SUCCESS;
      },
    });

    expect(code).toBe(2);
    expect(calls).toBe(0);
    expect(io.errors.join('\n')).toContain('Unknown option: --bogus');
  });

  it('returns 0 and prints usage for --help, without running the orchestrator', async () => {
    const io = capture();
    let calls = 0;

    const code = await runSyncCli({
      db: memoryDb(),
      argv: ['--help'],
      env: {},
      stdout: io.out,
      stderr: io.err,
      run: async () => {
        calls += 1;
        return SUCCESS;
      },
    });

    expect(code).toBe(0);
    expect(calls).toBe(0);
    expect(io.lines.join('\n')).toContain('Usage: npm run sync');
  });
});
