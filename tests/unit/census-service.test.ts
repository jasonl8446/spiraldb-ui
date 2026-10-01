import { describe, expect, it, vi } from 'vitest';

import { CENSUS_BUILD_HINT, createCensusService } from '@server/services/census';
import {
  ChildRegistry,
  ExecFileFailure,
  type ExecChildHandle,
  type ExecFileWithChild,
} from '@server/services/extraction';

/**
 * Task 7.2 (p7-03, D139) — the census service behind `POST /api/extract/quests?census=1`.
 * No process is spawned and .NET is never needed: every test injects the runner.
 */

const BINARY = '/repo/tools/bin/capture-census';
const ROW = { message: 'MSG_SENDGOAL', field: 'PersonaName', count: 2, consumed: false };

function serviceWith(exec: ExecFileWithChild, fileExists = () => true) {
  return createCensusService({
    binaryPath: BINARY,
    exec,
    env: { PATH: '/nonexistent' },
    fileExists,
  });
}

describe('census service', () => {
  it('runs the binary on the capture and returns messages + rows (dropping the temp input name)', async () => {
    const child: ExecChildHandle = { pid: 1, kill: vi.fn(() => true) };
    const children = new ChildRegistry();
    let registeredWhileRunning: number[] = [];
    const exec: ExecFileWithChild = vi.fn((_file, _args, _options, onChild) => {
      onChild?.(child);
      registeredWhileRunning = children.pids();
      return Promise.resolve({
        stdout: JSON.stringify({ input: 'abc.json', messages: 9, rows: [ROW] }),
        stderr: '',
      });
    });

    const outcome = await serviceWith(exec).run('/tmp/abc.json', children);

    expect(outcome).toEqual({ messages: 9, rows: [ROW] });
    expect(exec).toHaveBeenCalledWith(
      BINARY,
      ['--input', '/tmp/abc.json'],
      expect.objectContaining({ timeout: 0 }),
      expect.any(Function),
    );
    // The child is in the run's registry while it runs, so a client abort (D9) kills it too; it
    // is released once it settles, as the reader's own child is (PR #14 review 9c).
    expect(registeredWhileRunning).toEqual([1]);
    expect(children.pids()).toEqual([]);
  });

  it('is skipped, naming the build command, when the binary is missing (D55)', async () => {
    const exec = vi.fn();
    const outcome = await serviceWith(exec as unknown as ExecFileWithChild, () => false).run(
      '/tmp/abc.json',
      new ChildRegistry(),
    );

    expect(outcome).toEqual({ skipped: expect.stringContaining(CENSUS_BUILD_HINT) });
    expect(exec).not.toHaveBeenCalled();
  });

  it('is skipped, never rejected, when the tool fails', async () => {
    const exec: ExecFileWithChild = () =>
      Promise.reject(new ExecFileFailure({ message: 'exit 1', stderr: 'error: nope' }));

    const outcome = await serviceWith(exec).run('/tmp/abc.json', new ChildRegistry());

    expect(outcome).toEqual({ skipped: 'capture-census failed: exit 1' });
  });

  it('is skipped when the tool prints something that is not a census', async () => {
    const exec: ExecFileWithChild = () => Promise.resolve({ stdout: '{"rows":1}', stderr: '' });
    expect(await serviceWith(exec).run('/tmp/abc.json', new ChildRegistry())).toEqual({
      skipped: 'capture-census printed JSON without messages and rows',
    });

    // A census whose rows drifted from the documented shape is not served as a census (9c): a
    // row with no `consumed` would render as "ignored by the reader".
    for (const row of [
      { message: 'MSG_SENDGOAL', field: 'PersonaName', count: 2 },
      { message: 'MSG_SENDGOAL', field: 'PersonaName', count: '2', consumed: false },
      { message: 7, field: 'PersonaName', count: 2, consumed: true },
      'MSG_SENDGOAL.PersonaName',
    ]) {
      const drifted: ExecFileWithChild = () =>
        Promise.resolve({ stdout: JSON.stringify({ messages: 1, rows: [ROW, row] }), stderr: '' });
      expect(
        await serviceWith(drifted).run('/tmp/abc.json', new ChildRegistry()),
        JSON.stringify(row),
      ).toEqual({
        skipped: 'capture-census printed a row that is not {message, field, count, consumed}',
      });
    }

    const garbage: ExecFileWithChild = () => Promise.resolve({ stdout: 'not json', stderr: '' });
    const outcome = await serviceWith(garbage).run('/tmp/abc.json', new ChildRegistry());
    expect(outcome).toEqual({ skipped: expect.stringContaining('capture-census failed') });
  });
});
