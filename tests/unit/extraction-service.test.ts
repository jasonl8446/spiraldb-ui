import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildChildEnv,
  ChildRegistry,
  createExtractionService,
  deriveDotnetRoot,
  ExecFileFailure,
  type ExecChildHandle,
  type ExecFileOptions,
  type ExecFileWithChild,
  ExtractionCancelledError,
  ExtractionError,
  parseQuestArray,
  CLI_BUILD_HINT,
} from '@server/services/extraction';

/**
 * Task 2.2 — the extraction service (story p2-04).
 *
 * **No process is ever spawned here and .NET is never needed**: every test injects
 * an `ExecFileWithChild` fake. The DOTNET_ROOT derivation is exercised through
 * injected `exists`/`realpath` probes for the same reason (CI has no
 * `actions/setup-dotnet`).
 */

const CLI = '/repo/tools/bin/imview-packet-reader';

interface RecordedCall {
  file: string;
  args: string[];
  options: ExecFileOptions;
}

/** A fake runner: fixed scripted results, records calls, hands back a fake child. */
function fakeExec(
  script: Array<{ stdout?: string; stderr?: string } | { error: ExecFileFailure }>,
  children: ExecChildHandle[] = [],
): { exec: ExecFileWithChild; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let index = 0;
  const exec: ExecFileWithChild = (file, args, options, onChild) => {
    calls.push({ file, args: [...args], options });
    const step = script[Math.min(index, script.length - 1)];
    index += 1;
    const child: ExecChildHandle = { pid: 4000 + index, kill: vi.fn(() => true) };
    children.push(child);
    onChild?.(child);
    if (step && 'error' in step) {
      return Promise.reject(step.error);
    }
    return Promise.resolve({ stdout: step?.stdout ?? '', stderr: step?.stderr ?? '' });
  };
  return { exec, calls };
}

function serviceWith(
  exec: ExecFileWithChild,
  overrides: Partial<Parameters<typeof createExtractionService>[0]> = {},
) {
  return createExtractionService({
    cliPath: CLI,
    exec,
    env: { PATH: '/nonexistent' },
    fileExists: () => true,
    ...overrides,
  });
}

describe('deriveDotnetRoot (D45(3) — the apphost cannot find its runtime bare)', () => {
  it('returns an explicit DOTNET_ROOT verbatim, without touching PATH', () => {
    const exists = vi.fn(() => true);
    const root = deriveDotnetRoot({
      env: { DOTNET_ROOT: '/explicit/dotnet', PATH: '/usr/bin' },
      exists,
      realpath: (p) => p,
    });

    expect(root).toBe('/explicit/dotnet');
    expect(exists).not.toHaveBeenCalled();
  });

  it('ignores a blank DOTNET_ROOT and falls through to the PATH lookup', () => {
    const root = deriveDotnetRoot({
      env: { DOTNET_ROOT: '   ', PATH: '/usr/bin' },
      exists: (candidate) => candidate === '/usr/bin/dotnet',
      realpath: (p) => p,
    });

    expect(root).toBe('/usr/bin');
  });

  it('resolves dotnet through symlinks and takes its directory', () => {
    const root = deriveDotnetRoot({
      env: { PATH: '/first:/nix/profile/bin:/third' },
      exists: (candidate) => candidate === '/nix/profile/bin/dotnet',
      realpath: (p) =>
        p === '/nix/profile/bin/dotnet'
          ? '/nix/store/abc-dotnet-sdk-9.0.318/share/dotnet/.dotnet-wrapper'
          : p,
    });

    expect(root).toBe('/nix/store/abc-dotnet-sdk-9.0.318/share/dotnet');
  });

  it('returns undefined when no dotnet is on PATH (the caller then passes no DOTNET_ROOT)', () => {
    const root = deriveDotnetRoot({
      env: { PATH: '/usr/bin:/bin' },
      exists: () => false,
      realpath: (p) => p,
    });

    expect(root).toBeUndefined();
  });

  it('skips empty PATH entries instead of probing ./dotnet', () => {
    const probed: string[] = [];
    const root = deriveDotnetRoot({
      env: { PATH: '::/usr/bin' },
      exists: (candidate) => {
        probed.push(candidate);
        return true;
      },
      realpath: (p) => p,
    });

    expect(probed).toEqual(['/usr/bin/dotnet']);
    expect(root).toBe('/usr/bin');
  });

  it('honours an injected separator/executable (the Windows spelling)', () => {
    // `path.join` uses the *host* separator, so a real Windows PATH is resolved
    // with Windows joins on Windows; the injection points are what is under test.
    const root = deriveDotnetRoot({
      env: { PATH: '/one;/two' },
      pathSeparator: ';',
      executable: 'dotnet9',
      exists: (candidate) => candidate === path.join('/two', 'dotnet9'),
      realpath: (p) => p,
    });

    expect(root).toBe('/two');
  });

  it('keeps looking after an unreadable/broken symlink', () => {
    const root = deriveDotnetRoot({
      env: { PATH: '/broken:/good' },
      exists: () => true,
      realpath: (p) => {
        if (p === '/broken/dotnet') {
          throw new Error('EACCES');
        }
        return '/good/dotnet';
      },
    });

    expect(root).toBe('/good');
  });
});

describe('buildChildEnv', () => {
  it('adds the derived DOTNET_ROOT on top of the base environment', () => {
    const env = buildChildEnv(
      { PATH: '/usr/bin', KEEP: 'yes' },
      { exists: () => true, realpath: () => '/usr/share/dotnet/dotnet' },
    );

    expect(env).toEqual({ PATH: '/usr/bin', KEEP: 'yes', DOTNET_ROOT: '/usr/share/dotnet' });
  });

  it('passes no DOTNET_ROOT when dotnet cannot be found', () => {
    const env = buildChildEnv({ PATH: '/usr/bin' }, { exists: () => false });

    expect(env).toEqual({ PATH: '/usr/bin' });
    expect('DOTNET_ROOT' in env).toBe(false);
  });

  it('preserves an explicitly provided DOTNET_ROOT', () => {
    const env = buildChildEnv({ PATH: '/usr/bin', DOTNET_ROOT: '/custom' }, { exists: () => true });

    expect(env.DOTNET_ROOT).toBe('/custom');
  });
});

describe('parseQuestArray', () => {
  it('accepts a JSON array (including the legitimate empty result)', () => {
    expect(parseQuestArray('[{"m_questName":"A"}]', 'stdout')).toEqual([{ m_questName: 'A' }]);
    expect(parseQuestArray('  []\n', 'stdout')).toEqual([]);
  });

  it('rejects non-JSON output with the spec envelope', () => {
    expect(() => parseQuestArray('not json at all', 'stdout')).toThrowError(
      /^Failed to parse packet capture: CLI output was not valid JSON \(stdout:/,
    );
  });

  it('rejects a non-array JSON payload', () => {
    expect(() => parseQuestArray('{"quests":[]}', 'stdout')).toThrowError(
      'Failed to parse packet capture: expected a JSON array of quests, got object (stdout)',
    );
    expect(() => parseQuestArray('null', 'stdout')).toThrowError(/got null/);
  });

  it('rejects empty output', () => {
    expect(() => parseQuestArray('   \n', 'stdout')).toThrowError(
      'Failed to parse packet capture: the CLI produced no output (stdout)',
    );
  });

  it('always carries a 400 status', () => {
    try {
      parseQuestArray('x', 'stdout');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ExtractionError);
      expect((error as ExtractionError).status).toBe(400);
    }
  });
});

describe('extraction service — happy path', () => {
  it('runs the CLI with --input and parses stdout as the quest array', async () => {
    const { exec, calls } = fakeExec([
      { stdout: JSON.stringify([{ m_questName: 'MB-YARD1-C01-001' }, { m_questName: 'B' }]) },
    ]);
    const service = serviceWith(exec, { env: { PATH: '/none' } });

    const quests = await service.start('/tmp/capture.json').result;

    expect(quests).toEqual([{ m_questName: 'MB-YARD1-C01-001' }, { m_questName: 'B' }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].file).toBe(CLI);
    expect(calls[0].args).toEqual(['--input', '/tmp/capture.json']);
    // The spec's 50 MB cap (docs/spec-domain-reference.md L606).
    expect(calls[0].options.maxBuffer).toBe(50 * 1024 * 1024);
  });

  it('passes the derived DOTNET_ROOT in the child environment', async () => {
    const { exec, calls } = fakeExec([{ stdout: '[]' }]);
    const service = serviceWith(exec, {
      env: { PATH: '/usr/bin', DOTNET_ROOT: '/custom/root' },
    });

    await service.start('/tmp/capture.json').result;

    expect(calls[0].options.env.DOTNET_ROOT).toBe('/custom/root');
  });

  it('accepts an empty quest list as success (a capture with no quest packets)', async () => {
    const { exec } = fakeExec([{ stdout: '[]' }]);
    const quests = await serviceWith(exec).start('/tmp/capture.json').result;

    expect(quests).toEqual([]);
  });
});

describe('extraction service — friendly failure modes', () => {
  it('names the CLI path and `npm run build:cli` when the binary is missing', async () => {
    const { exec, calls } = fakeExec([{ stdout: '[]' }]);
    const service = serviceWith(exec, { fileExists: () => false });

    await expect(service.start('/tmp/capture.json').result).rejects.toThrowError(
      `Packet capture CLI not found at ${CLI}. Build it with: ${CLI_BUILD_HINT}`,
    );
    // The existence probe is a guard, not a gate on a real spawn.
    expect(calls).toHaveLength(0);
  });

  it('maps a non-zero exit to `Failed to parse packet capture: <stderr>`', async () => {
    const { exec } = fakeExec([
      {
        error: new ExecFileFailure({
          code: '1',
          message: 'Command failed',
          stderr: "error: '/tmp/x.txt' is not valid JSON: 'h' is an invalid start of a value.",
        }),
      },
    ]);

    await expect(serviceWith(exec).start('/tmp/x.txt').result).rejects.toThrowError(
      "Failed to parse packet capture: error: '/tmp/x.txt' is not valid JSON: 'h' is an invalid start of a value.",
    );
  });

  it('falls back to the runner message when the CLI wrote nothing to stderr', async () => {
    const { exec } = fakeExec([
      { error: new ExecFileFailure({ code: '1', message: 'Command failed: exit 1' }) },
    ]);

    await expect(serviceWith(exec).start('/tmp/x.json').result).rejects.toThrowError(
      'Failed to parse packet capture: Command failed: exit 1',
    );
  });

  it('treats a vanished binary (spawn ENOENT) as the CLI-missing error', async () => {
    const { exec } = fakeExec([
      { error: new ExecFileFailure({ code: 'ENOENT', message: 'spawn /x ENOENT' }) },
    ]);

    await expect(serviceWith(exec).start('/tmp/x.json').result).rejects.toThrowError(
      new RegExp(CLI_BUILD_HINT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
  });

  it('never lets a malformed CLI payload escape as a raw SyntaxError', async () => {
    const { exec } = fakeExec([{ stdout: '[{"m_questName": "truncated"' }]);

    const failure = await serviceWith(exec)
      .start('/tmp/x.json')
      .result.then(() => undefined)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ExtractionError);
    expect((failure as Error).message).toMatch(/^Failed to parse packet capture: /);
  });
});

describe('extraction service — the maxBuffer escape hatch (--output file mode)', () => {
  it('retries once with --output, reads the file, and removes the temp dir', async () => {
    const { exec, calls } = fakeExec([
      {
        error: new ExecFileFailure({
          code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
          message: 'stdout maxBuffer length exceeded',
        }),
      },
      { stdout: '', stderr: '' },
    ]);
    const removePath = vi.fn(() => Promise.resolve());
    const service = serviceWith(exec, {
      createTempDir: () => Promise.resolve('/tmp/spiraldb-extract-TEST'),
      readTextFile: (file) => {
        expect(file).toBe('/tmp/spiraldb-extract-TEST/quests.json');
        return Promise.resolve('[{"m_questName":"FROM-FILE"}]');
      },
      removePath,
    });

    const quests = await service.start('/tmp/big.json').result;

    expect(quests).toEqual([{ m_questName: 'FROM-FILE' }]);
    expect(calls).toHaveLength(2);
    expect(calls[0].args).toEqual(['--input', '/tmp/big.json']);
    expect(calls[1].args).toEqual([
      '--input',
      '/tmp/big.json',
      '--output',
      '/tmp/spiraldb-extract-TEST/quests.json',
    ]);
    expect(removePath).toHaveBeenCalledWith('/tmp/spiraldb-extract-TEST');
  });

  it('removes the temp dir even when the retry itself fails', async () => {
    const { exec } = fakeExec([
      {
        error: new ExecFileFailure({
          code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
          message: 'stdout maxBuffer length exceeded',
        }),
      },
      { error: new ExecFileFailure({ code: '1', stderr: 'boom' }) },
    ]);
    const removePath = vi.fn(() => Promise.resolve());
    const service = serviceWith(exec, {
      createTempDir: () => Promise.resolve('/tmp/spiraldb-extract-TEST'),
      readTextFile: () => Promise.resolve('[]'),
      removePath,
    });

    await expect(service.start('/tmp/big.json').result).rejects.toThrowError(
      'Failed to parse packet capture: boom (retried with --output file mode)',
    );
    expect(removePath).toHaveBeenCalledWith('/tmp/spiraldb-extract-TEST');
  });

  it('advises a smaller capture when file mode also overflows', async () => {
    const { exec } = fakeExec([
      {
        error: new ExecFileFailure({
          code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
          message: 'stdout maxBuffer length exceeded',
        }),
      },
      {
        error: new ExecFileFailure({
          code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
          message: 'stdout maxBuffer length exceeded',
        }),
      },
    ]);
    const service = serviceWith(exec, {
      createTempDir: () => Promise.resolve('/tmp/spiraldb-extract-TEST'),
      readTextFile: () => Promise.resolve('[]'),
      removePath: () => Promise.resolve(),
    });

    await expect(service.start('/tmp/big.json').result).rejects.toThrowError(
      /exceeded the 50 MB buffer even in --output file mode.*smaller capture/s,
    );
  });
});

describe('cancellation (D9)', () => {
  it('kills the running child and reports a cancellation, not a parse failure', async () => {
    const children: ExecChildHandle[] = [];
    let settle: (() => void) | undefined;
    const exec: ExecFileWithChild = (_file, _args, options, onChild) => {
      const child: ExecChildHandle = {
        pid: 4242,
        kill: vi.fn(() => true),
      };
      children.push(child);
      onChild?.(child);
      expect(options.maxBuffer).toBeGreaterThan(0);
      return new Promise((_resolve, reject) => {
        settle = () =>
          reject(new ExecFileFailure({ code: 'ABORT_ERR', killed: true, signal: 'SIGTERM' }));
      });
    };
    const service = serviceWith(exec);

    const run = service.start('/tmp/big.json');
    expect(run.children.pids()).toEqual([4242]);

    run.children.killAll();
    settle?.();

    await expect(run.result).rejects.toBeInstanceOf(ExtractionCancelledError);
    expect(children[0].kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('kills a child that registers after the abort already happened', () => {
    const registry = new ChildRegistry();
    registry.killAll();

    const late: ExecChildHandle = { pid: 9, kill: vi.fn(() => true) };
    registry.add(late);

    expect(registry.cancelled).toBe(true);
    expect(late.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('kills both the main child and the --output retry child', async () => {
    const children: ExecChildHandle[] = [];
    let retryReject: ((error: unknown) => void) | undefined;
    let call = 0;
    const exec: ExecFileWithChild = (_file, _args, _options, onChild) => {
      call += 1;
      const index = call;
      const child: ExecChildHandle = { pid: 5000 + index, kill: vi.fn(() => true) };
      children.push(child);
      onChild?.(child);
      if (index === 1) {
        return Promise.reject(
          new ExecFileFailure({
            code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
            message: 'maxBuffer',
          }),
        );
      }
      return new Promise((_resolve, reject) => {
        retryReject = reject;
      });
    };
    const service = serviceWith(exec, {
      createTempDir: () => Promise.resolve('/tmp/spiraldb-extract-TEST'),
      readTextFile: () => Promise.resolve('[]'),
      removePath: () => Promise.resolve(),
    });

    const run = service.start('/tmp/big.json');
    // Let the main call fail and the retry start.
    await vi.waitFor(() => expect(call).toBe(2));

    run.children.killAll('SIGKILL');
    retryReject?.(new ExecFileFailure({ killed: true, signal: 'SIGKILL' }));

    await expect(run.result).rejects.toBeInstanceOf(ExtractionCancelledError);
    expect(children[1].kill).toHaveBeenCalledWith('SIGKILL');
  });
});
