import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { DEFAULT_AURORIUM_PATH } from '@server/db';
import {
  ROOT_WAD_RELATIVE_PATH,
  compareRevisionNames,
  isRevisionName,
  resolveRevision,
  sortRevisionsDescending,
  type ResolveRevisionOptions,
} from '@server/services/sync/revision';

/**
 * Task 1.4b acceptance (p1-05-ac2): pick the newest `V_r*` directory under
 * `{aurorium_path}/data/` by alphanumeric-descending sort, honour a settings
 * override, and fail with an actionable message when nothing matches.
 *
 * Every synthetic case uses a real (fast, throwaway) temp directory tree; the
 * last case asserts the **real** Aurorium tree on this machine resolves to
 * `V_r806919.Wizard_1_610` (spike 1.4a, task 1.4a).
 */

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'spiraldb-revision-'));
  tempRoots.push(dir);
  return dir;
}

/** Creates `{root}/data/{revision}/Data/GameData/Root.wad` (empty file). */
function makeRevision(root: string, revision: string): void {
  const wad = path.join(root, 'data', revision, ROOT_WAD_RELATIVE_PATH);
  mkdirSync(path.dirname(wad), { recursive: true });
  writeFileSync(wad, '');
}

afterAll(() => {
  for (const dir of tempRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('revision resolver — sorting (task 1.4b)', () => {
  it('filters to V_r* names', () => {
    expect(isRevisionName('V_r806919.Wizard_1_610')).toBe(true);
    expect(isRevisionName('V_806919')).toBe(false);
    expect(isRevisionName('root.wad')).toBe(false);
  });

  it('sorts alphanumerically descending (numeric build runs compare numerically)', () => {
    expect(
      sortRevisionsDescending(['V_r9.A', 'V_r10.A', 'V_r806919.A', 'V_r999999.B', 'notes.txt']),
    ).toEqual(['V_r999999.B', 'V_r806919.A', 'V_r10.A', 'V_r9.A']);
  });

  it('is a natural order, not a lexicographic one', () => {
    expect(compareRevisionNames('V_r9.A', 'V_r10.A')).toBeLessThan(0);
    expect(compareRevisionNames('V_r10.A', 'V_r9.A')).toBeGreaterThan(0);
    expect(compareRevisionNames('V_r10.A', 'V_r10.A')).toBe(0);
  });
});

describe('revision resolver — auto detection (task 1.4b)', () => {
  it('picks V_r806919.Wizard_1_610 from a tree that also holds newer-looking names', () => {
    const root = makeTempRoot();
    for (const revision of ['V_r806919.Wizard_1_610', 'V_r2.Other', 'V_r999999.Else']) {
      makeRevision(root, revision);
    }
    mkdirSync(path.join(root, 'data', 'not-a-revision'), { recursive: true });

    const info = resolveRevision({ auroriumPath: root });
    expect(info.revision).toBe('V_r999999.Else');
    expect(info.source).toBe('auto');
    expect(info.dataPath).toBe(path.join(root, 'data', 'V_r999999.Else'));
    expect(info.rootWadPath).toBe(
      path.join(root, 'data', 'V_r999999.Else', 'Data', 'GameData', 'Root.wad'),
    );
  });

  it('picks the only revision when there is just one', () => {
    const root = makeTempRoot();
    makeRevision(root, 'V_r806919.Wizard_1_610');
    expect(resolveRevision({ auroriumPath: root }).revision).toBe('V_r806919.Wizard_1_610');
  });

  it('fails with an actionable message when no V_r* directory exists', () => {
    const root = makeTempRoot();
    mkdirSync(path.join(root, 'data', 'something-else'), { recursive: true });
    expect(() => resolveRevision({ auroriumPath: root })).toThrow(/No V_r\* revision directory/);
    expect(() => resolveRevision({ auroriumPath: root })).toThrow(root);
  });

  it('fails with an actionable message when the data directory is missing', () => {
    const root = makeTempRoot();
    expect(() => resolveRevision({ auroriumPath: path.join(root, 'nope') })).toThrow(
      /Aurorium data directory not found/,
    );
  });

  it('fails when the newest revision has no Root.wad', () => {
    const root = makeTempRoot();
    mkdirSync(path.join(root, 'data', 'V_r1.Empty'), { recursive: true });
    expect(() => resolveRevision({ auroriumPath: root })).toThrow(/has no Root.wad/);
  });
});

describe('revision resolver — settings override (task 1.4b)', () => {
  it('lets the override win over auto-detection', () => {
    const root = makeTempRoot();
    makeRevision(root, 'V_r806919.Wizard_1_610');
    makeRevision(root, 'V_r999999.Else');
    const info = resolveRevision({ auroriumPath: root, override: 'V_r806919.Wizard_1_610' });
    expect(info.revision).toBe('V_r806919.Wizard_1_610');
    expect(info.source).toBe('override');
  });

  it('accepts a full path as the override', () => {
    const root = makeTempRoot();
    makeRevision(root, 'V_r806919.Wizard_1_610');
    makeRevision(root, 'V_r999999.Else');
    const override = path.join(root, 'data', 'V_r806919.Wizard_1_610');
    expect(resolveRevision({ auroriumPath: root, override }).revision).toBe(
      'V_r806919.Wizard_1_610',
    );
  });

  it('fails with an actionable message when the override does not exist', () => {
    const root = makeTempRoot();
    makeRevision(root, 'V_r806919.Wizard_1_610');
    const call = (): unknown => resolveRevision({ auroriumPath: root, override: 'V_r000000.Nope' });
    expect(call).toThrow(/Revision override "V_r000000.Nope" is not a directory/);
    expect(call).toThrow(/clear it to auto-detect/);
  });

  it('fails when the override points at a revision without Root.wad', () => {
    const root = makeTempRoot();
    mkdirSync(path.join(root, 'data', 'V_r1.Empty'), { recursive: true });
    expect(() =>
      resolveRevision({ auroriumPath: root, override: 'V_r1.Empty' } as ResolveRevisionOptions),
    ).toThrow(/has no Root.wad/);
  });

  it('ignores a blank override and falls back to auto-detection', () => {
    const root = makeTempRoot();
    makeRevision(root, 'V_r806919.Wizard_1_610');
    expect(resolveRevision({ auroriumPath: root, override: '   ' }).source).toBe('auto');
  });
});

describe('revision resolver — the real Aurorium tree (task 1.4b, spike 1.4a)', () => {
  const realWad = path.join(
    DEFAULT_AURORIUM_PATH,
    'data',
    'V_r806919.Wizard_1_610',
    ROOT_WAD_RELATIVE_PATH,
  );

  it.skipIf(!existsSync(realWad))('resolves V_r806919.Wizard_1_610 on this machine', () => {
    const info = resolveRevision({ auroriumPath: DEFAULT_AURORIUM_PATH });
    expect(info.revision).toBe('V_r806919.Wizard_1_610');
    expect(info.rootWadPath).toBe(realWad);
    expect(existsSync(info.rootWadPath)).toBe(true);
  });
});
