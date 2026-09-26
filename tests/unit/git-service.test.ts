import fs from 'node:fs';
import path from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import {
  buildCommitMessage,
  commitAuthorEmail,
  createGitService,
  DirtyRepoError,
  sessionBranchName,
  type GitClient,
} from '@server/services/git';
import {
  commitCount,
  commitSubjects,
  createTempGitRepo,
  logLines,
  readRepoFile,
  removeTempGitRepo,
  writeRepoFile,
  type TempRepo,
} from '../helpers/temp-git-repo';

/**
 * Story p2-05 acceptance for the git layer: the D14 dirty guard (fail closed, the
 * actionable message, never a stash), the session branch (`content/YYYY-MM-DD`
 * created from main's HEAD when absent, `settings.git_branch` persisted), the
 * exact commit message/author of D13/docs/spec-data-model.md L216-232, and N
 * sequential commits for N saves.
 *
 * Every repository is a throwaway under `data/__test-scratch__/` with a per-command
 * identity, so the owner's fork and the clone are never touched (decision D17).
 */

const REPOS: TempRepo[] = [];

afterEach(() => {
  while (REPOS.length > 0) {
    const repo = REPOS.pop();
    if (repo !== undefined) {
      removeTempGitRepo(repo);
    }
  }
});

afterAll(() => {
  // `afterEach` drains the list; this is the belt-and-braces version for a failure path.
  for (const repo of REPOS) {
    removeTempGitRepo(repo);
  }
});

function repo(prefix = 'git-', options: { branch?: string } = {}): TempRepo {
  const created = createTempGitRepo(prefix, options);
  REPOS.push(created);
  return created;
}

describe('the dirty-repo guard (D14)', () => {
  it('passes on a clean repository and reports an empty porcelain', async () => {
    const target = repo();
    const git = createGitService({ repoPath: target.dir });

    await expect(git.assertClean()).resolves.toBeUndefined();
    await expect(git.statusPorcelain()).resolves.toBe('');
  });

  it('fails closed with the actionable message and lists the dirty paths', async () => {
    const target = repo();
    writeRepoFile(target, 'README.md', 'seed\nmodified by the user\n');
    writeRepoFile(target, 'QuestTemplates/questtemplates_NEW.json', '{"m_questName":"NEW"}');

    const git = createGitService({ repoPath: target.dir });

    const error = await git.assertClean().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DirtyRepoError);
    const dirty = error as DirtyRepoError;
    expect(dirty.message).toContain('has uncommitted changes — resolve them first');
    expect(dirty.message).toContain('never stashes or discards your work');
    expect(dirty.repoPath).toBe(path.resolve(target.dir));
    // The porcelain lines verbatim — untracked directories stay collapsed, as git
    // itself reports them.
    expect(dirty.statusLines).toEqual(['M README.md', '?? QuestTemplates/']);
    // Nothing was stashed, discarded or committed.
    expect(target.git(['stash', 'list']).trim()).toBe('');
    expect(commitCount(target)).toBe(1);
    expect(readRepoFile(target, 'README.md')).toContain('modified by the user');
  });

  it('fails with an actionable message when the path is not the root of a working tree', async () => {
    const target = repo();
    // A subdirectory of a repository is inside a work tree but is not its root:
    // `spiraldb_path` pointed here would commit into the enclosing repository.
    const subdirectory = path.join(target.dir, 'not-the-root');
    fs.mkdirSync(subdirectory);

    await expect(createGitService({ repoPath: subdirectory }).assertClean()).rejects.toThrow(
      /is not the root of a git working tree — check settings.spiraldb_path/,
    );
  });
});

describe('the session branch (docs/spec-data-model.md L206-214)', () => {
  const DATE = new Date(2026, 8, 26, 10, 30, 0);

  it('derives content/YYYY-MM-DD from the local date', () => {
    expect(sessionBranchName(DATE)).toBe('content/2026-09-26');
  });

  it('creates the branch from main HEAD when absent and persists it', async () => {
    const target = repo();
    const mainHead = target.git(['rev-parse', 'main']).trim();
    const persisted: string[] = [];
    const git = createGitService({
      repoPath: target.dir,
      settingsBranch: () => '',
      persistBranch: (branch) => persisted.push(branch),
    });

    const result = await git.ensureSessionBranch({ date: DATE });

    expect(result).toEqual({
      branch: 'content/2026-09-26',
      created: true,
      createdFrom: mainHead,
      persisted: true,
    });
    expect(persisted).toEqual(['content/2026-09-26']);
    await expect(git.currentBranch()).resolves.toBe('content/2026-09-26');
    // main has not moved.
    expect(target.git(['rev-parse', 'main']).trim()).toBe(mainHead);
    // The working tree is still clean after the checkout.
    await expect(git.statusPorcelain()).resolves.toBe('');
  });

  it('reuses an existing branch without re-creating it, and does not re-persist', async () => {
    const target = repo();
    // `git_branch` starts unset; the first save persists the branch it resolved,
    // so the second save (stored value now equal) has nothing to persist.
    let stored = '';
    const persisted: string[] = [];
    const git = createGitService({
      repoPath: target.dir,
      settingsBranch: () => stored,
      persistBranch: (branch) => {
        persisted.push(branch);
        stored = branch;
      },
    });

    const first = await git.ensureSessionBranch({ date: DATE });
    // A second save in the same session resolves the same branch.
    const second = await git.ensureSessionBranch({ date: DATE });

    expect(first).toEqual({
      branch: 'content/2026-09-26',
      created: true,
      createdFrom: target.git(['rev-parse', 'main']).trim(),
      persisted: true,
    });
    expect(second).toEqual({
      branch: 'content/2026-09-26',
      created: false,
      createdFrom: null,
      persisted: false,
    });
    expect(persisted).toEqual(['content/2026-09-26']);
  });

  it('commits to settings.git_branch when the user pointed it elsewhere (D42)', async () => {
    const target = repo();
    const git = createGitService({
      repoPath: target.dir,
      settingsBranch: () => 'content/user-chosen',
      persistBranch: () => {
        throw new Error('must not re-persist an unchanged branch');
      },
    });

    await expect(git.ensureSessionBranch({ date: DATE })).resolves.toMatchObject({
      branch: 'content/user-chosen',
      created: true,
      persisted: false,
    });
    await expect(git.currentBranch()).resolves.toBe('content/user-chosen');
  });

  it('creates the branch from main even when another branch is checked out', async () => {
    const target = repo();
    target.git(['checkout', '-b', 'scratch']);
    writeRepoFile(target, 'scratch.txt', 'scratch\n');
    target.git(['add', 'scratch.txt']);
    target.git(['commit', '-m', 'scratch work']);
    const mainHead = target.git(['rev-parse', 'main']).trim();

    const git = createGitService({ repoPath: target.dir, settingsBranch: () => '' });
    const result = await git.ensureSessionBranch({ date: DATE });

    expect(result.createdFrom).toBe(mainHead);
    expect(target.git(['rev-parse', 'content/2026-09-26']).trim()).toBe(mainHead);
  });

  it('fails with an actionable message when there is no main branch', async () => {
    const target = repo('git-nomain-', { branch: 'trunk' });
    const git = createGitService({ repoPath: target.dir, settingsBranch: () => '' });

    await expect(git.ensureSessionBranch({ date: DATE })).rejects.toThrow(
      /has no "main" branch to create it from/,
    );
  });
});

describe('committing one saved object (D13, docs/spec-data-model.md L216-232)', () => {
  const author = 'P2-05 Tester';

  it('builds the exact header, with notes as the body when given', () => {
    expect(
      buildCommitMessage({ action: 'extract', objectType: 'quest', objectKey: 'DS-ACAD1-C01-001' }),
    ).toBe('spiraldb: extract quest DS-ACAD1-C01-001');
    expect(
      buildCommitMessage({
        action: 'update',
        objectType: 'drop_table',
        objectKey: 'WC-UNICORN-MAIN-007',
        notes: 'Imported from packet capture session.json',
      }),
    ).toBe(
      'spiraldb: update drop_table WC-UNICORN-MAIN-007\n\nImported from packet capture session.json',
    );
    // Blank notes never leave an empty body.
    expect(
      buildCommitMessage({ action: 'create', objectType: 'quest', objectKey: 'X', notes: '  ' }),
    ).toBe('spiraldb: create quest X');
  });

  it('synthesises a local-only author email from the configured name', () => {
    expect(commitAuthorEmail('Jason')).toBe('Jason@spiraldb-ui.local');
    expect(commitAuthorEmail('P2-05 Tester')).toBe('P2-05-Tester@spiraldb-ui.local');
    expect(commitAuthorEmail('')).toBe('spiraldb-ui@spiraldb-ui.local');
  });

  it('commits the message, the author name and only the given paths', async () => {
    const target = repo();
    writeRepoFile(target, 'QuestTemplates/questtemplates_DS-ACAD1-C01-001.json', '{"a":1}\n');
    writeRepoFile(target, 'QuestMetadatas/questmetadata_DS-ACAD1-C01-001.json', '{"b":2}\n');
    const git = createGitService({
      repoPath: target.dir,
      settingsBranch: () => 'content/2026-09-26',
    });
    await git.ensureSessionBranch();

    const result = await git.commitObject({
      action: 'extract',
      objectType: 'quest',
      objectKey: 'DS-ACAD1-C01-001',
      author,
      paths: [
        path.join(target.dir, 'QuestTemplates/questtemplates_DS-ACAD1-C01-001.json'),
        path.join(target.dir, 'QuestMetadatas/questmetadata_DS-ACAD1-C01-001.json'),
      ],
    });

    expect(result.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.branch).toBe('content/2026-09-26');
    expect(result.paths).toEqual([
      'QuestTemplates/questtemplates_DS-ACAD1-C01-001.json',
      'QuestMetadatas/questmetadata_DS-ACAD1-C01-001.json',
    ]);
    expect(result.message).toBe('spiraldb: extract quest DS-ACAD1-C01-001');

    // Read back from git itself: author name, email and subject.
    expect(target.git(['log', '-1', '--format=%an']).trim()).toBe(author);
    expect(target.git(['log', '-1', '--format=%ae']).trim()).toBe('P2-05-Tester@spiraldb-ui.local');
    expect(target.git(['log', '-1', '--format=%s']).trim()).toBe(
      'spiraldb: extract quest DS-ACAD1-C01-001',
    );
    // The commit holds exactly the two paths, and no watermark trailer (D11).
    expect(target.git(['show', '--name-only', '--format=', 'HEAD']).trim().split('\n')).toEqual([
      'QuestMetadatas/questmetadata_DS-ACAD1-C01-001.json',
      'QuestTemplates/questtemplates_DS-ACAD1-C01-001.json',
    ]);
    expect(target.git(['log', '-1', '--format=%B'])).not.toContain('DeepSeek');
    expect(target.git(['status', '--porcelain']).trim()).toBe('');
    expect(result.sha).toBe(target.git(['rev-parse', 'HEAD']).trim());
  });

  it('carries the notes as the commit body', async () => {
    const target = repo();
    writeRepoFile(target, 'DropTables/droptable_X.json', '{"Name":"X"}\n');
    const git = createGitService({
      repoPath: target.dir,
      settingsBranch: () => 'content/2026-09-26',
    });
    await git.ensureSessionBranch();

    await git.commitObject({
      action: 'create',
      objectType: 'drop_table',
      objectKey: 'X',
      notes: 'Imported from packet capture session_2026-06-01.json',
      author,
      paths: ['DropTables/droptable_X.json'],
    });

    expect(target.git(['log', '-1', '--format=%s']).trim()).toBe('spiraldb: create drop_table X');
    expect(target.git(['log', '-1', '--format=%b']).trim()).toBe(
      'Imported from packet capture session_2026-06-01.json',
    );
  });

  it('produces N sequential commits for N saves (D13)', async () => {
    const target = repo();
    const git = createGitService({
      repoPath: target.dir,
      settingsBranch: () => 'content/2026-09-26',
    });
    await git.ensureSessionBranch();

    for (const name of ['DS-ONE', 'DS-TWO', 'DS-THREE']) {
      writeRepoFile(
        target,
        `QuestTemplates/questtemplates_${name}.json`,
        `{"m_questName":"${name}"}\n`,
      );
      await git.commitObject({
        action: 'extract',
        objectType: 'quest',
        objectKey: name,
        author,
        paths: [`QuestTemplates/questtemplates_${name}.json`],
      });
    }

    expect(commitCount(target)).toBe(4); // seed + three saves
    expect(commitSubjects(target).slice(0, 3)).toEqual([
      'spiraldb: extract quest DS-THREE',
      'spiraldb: extract quest DS-TWO',
      'spiraldb: extract quest DS-ONE',
    ]);
    expect(logLines(target, '%an').filter((line) => line === author)).toHaveLength(3);
    expect(target.git(['status', '--porcelain']).trim()).toBe('');
  });

  it('refuses a commit with no paths instead of sweeping the tree in', async () => {
    const target = repo();
    const git = createGitService({
      repoPath: target.dir,
      settingsBranch: () => 'content/2026-09-26',
    });
    await git.ensureSessionBranch();
    writeRepoFile(target, 'QuestTemplates/untracked.json', '{}\n');

    await expect(
      git.commitObject({
        action: 'create',
        objectType: 'quest',
        objectKey: 'X',
        author,
        paths: [],
      }),
    ).rejects.toThrow('commitObject requires at least one path to commit.');
    expect(commitCount(target)).toBe(1);
    expect(target.git(['status', '--porcelain']).trim()).toBe('?? QuestTemplates/');
  });
});

describe('the injected client seam', () => {
  it('sets the identity environment and stages exactly the requested paths', async () => {
    const target = repo();
    const calls: string[] = [];
    let seenEnv: Record<string, string> = {};
    let seenMessage = '';
    const fake: GitClient = {
      env: (environment) => {
        calls.push('env');
        seenEnv = environment;
        return fake;
      },
      raw: async () => '',
      branchLocal: async () => ({ all: ['content/2026-09-26'], current: 'content/2026-09-26' }),
      checkout: async () => undefined,
      checkoutBranch: async () => undefined,
      add: async (files) => {
        calls.push(`add:${(Array.isArray(files) ? files : [files]).join(',')}`);
        return undefined;
      },
      commit: async (message) => {
        calls.push('commit');
        seenMessage = message;
        return { commit: 'a'.repeat(40), branch: 'content/2026-09-26' };
      },
    };

    const git = createGitService({ repoPath: target.dir, client: fake });
    const result = await git.commitObject({
      action: 'update',
      objectType: 'quest',
      objectKey: 'DS-ACAD1-C01-001',
      author: 'P2-05 Tester',
      paths: [path.join(target.dir, 'QuestTemplates/questtemplates_DS-ACAD1-C01-001.json')],
    });

    expect(calls).toEqual([
      'env',
      'add:QuestTemplates/questtemplates_DS-ACAD1-C01-001.json',
      'commit',
    ]);
    expect(seenMessage).toBe('spiraldb: update quest DS-ACAD1-C01-001');
    expect(seenEnv.GIT_AUTHOR_NAME).toBe('P2-05 Tester');
    expect(seenEnv.GIT_COMMITTER_EMAIL).toBe('P2-05-Tester@spiraldb-ui.local');
    expect(seenEnv.PATH).toBe(process.env.PATH);
    expect(result).toEqual({
      sha: 'a'.repeat(40),
      branch: 'content/2026-09-26',
      message: 'spiraldb: update quest DS-ACAD1-C01-001',
      paths: ['QuestTemplates/questtemplates_DS-ACAD1-C01-001.json'],
    });
  });
});
