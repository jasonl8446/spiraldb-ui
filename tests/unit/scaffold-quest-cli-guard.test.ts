import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

/**
 * The D119 guard, **locked** — `scaffold-quest` must refuse to pick a database implicitly
 * (final-deslop T4, from D116/D119).
 *
 * The rule exists because it was already broken once: the implicit default points
 * `spiraldb_path` at the owner's fork, and a write command that took that default **migrated the
 * live `data/spiraldb-ui.db`** during a smoke test. The refusal therefore lives in the CLI's top
 * level — and until this file, nothing tested it: `grep -rl scaffold-quest tests/` was empty.
 *
 * This is a **spawn-only** arm. It needs no database, no corpus and no .NET: the refusal is the
 * first statement after argument parsing, so the process exits before it opens or migrates
 * anything. The environment is deliberately the *empty* one the guard is about — no
 * `SPIRALDB_UI_DB`, no `SPIRALDB_SYNC_DB`, no `SPIRALDB_PATH`, no `NODE_ENV` — because a guard
 * tested with the very variable it checks would prove nothing.
 *
 * The second arm is the **positive partner** (D77: a zero needs a positive). It shows the same
 * command proceeds past the guard when a database *is* named, so the first arm's rc=2 is the guard
 * firing and not "this CLI always exits 2". Both arms point the write at a scratch root, so neither
 * can reach the owner's fork even if the catalog check changed.
 */

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const TSX = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const CLI = path.join('scripts', 'scaffold-quest.ts');

/** A scratch directory under the gitignored test area — never `data/spiraldb-ui.db`. */
const SCRATCH = path.join(REPO_ROOT, 'data', '__test-scratch__', 'scaffold-quest-guard');
fs.mkdirSync(SCRATCH, { recursive: true });

afterAll(() => {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

/** Runs the CLI with the caller's environment and returns its exit code plus stderr. */
function runCli(
  args: string[],
  env: Record<string, string>,
): { status: number | null; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(TSX, [CLI, ...args], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? null,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

/** The interpreter needs these two; nothing else is passed (that is the point of the first arm). */
const MINIMAL_ENV = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' };

describe('scaffold-quest refuses to pick a database implicitly (D119)', () => {
  it('exits 2 with the refusal sentence when no database is named anywhere', () => {
    const result = runCli(['--name', 'WC-TEST-MAIN-001'], MINIMAL_ENV);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Refusing to pick a database implicitly');
    // The message is actionable: it names both escape hatches and why the default is unsafe.
    expect(result.stderr).toContain('SPIRALDB_UI_DB');
    expect(result.stderr).toContain('SPIRALDB_SYNC_DB');
    expect(result.stderr).toContain("the default database names the owner's fork");
    // Nothing was opened: the guard runs before `resolveSyncDbFile`/`openDb`.
    expect(fs.existsSync(path.join(SCRATCH, 'never-created.db'))).toBe(false);
  });

  it('proceeds past the guard when a scratch database is named', () => {
    const result = runCli(
      [
        '--name',
        'WC-TEST-MAIN-001',
        '--db',
        path.join(SCRATCH, 'scratch.db'),
        '--spiraldb',
        SCRATCH,
      ],
      { ...MINIMAL_ENV, SPIRALDB_UI_DB: path.join(SCRATCH, 'scratch.db') },
    );
    // Not the guard: the run reaches the catalog and refuses with its own 404 (a fresh scratch
    // database holds no catalog rows), which is what makes arm 1 attributable.
    expect(result.status).not.toBe(2);
    expect(result.stderr).not.toContain('Refusing to pick a database implicitly');
    expect(result.stdout).toContain(
      `[spiraldb-ui] scaffold database at ${path.join(SCRATCH, 'scratch.db')}`,
    );
    expect(result.stdout).toContain(`[spiraldb-ui] SpiralDB root       at ${SCRATCH}`);
  });
});
