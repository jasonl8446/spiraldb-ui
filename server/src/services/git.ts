import path from 'node:path';

import { simpleGit } from 'simple-git';

import { formatLocalDate } from '../db.js';

/**
 * The git layer of the save pipeline (task 2.4 / story p2-05): the dirty-repo
 * guard, the session branch, and one commit per saved object.
 *
 * specs: dirty-guard + branch strategy + commit format are
 * docs/spec-data-model.md L206-232; the guard and the one-commit-per-object rule
 * are decisions D13/D14. There is **no watermark trailer** on runtime commits
 * (decision D11) — the trailer rule applies to agent-authored commits in *this*
 * repository only.
 *
 * The client is injected (`GitClient`, structurally satisfied by `simple-git`) so
 * unit tests run against throwaway repositories under `data/__test-scratch__`
 * and never against the owner's fork (decision D17). Only the eight methods this
 * layer actually uses are declared — a fake is a five-line object.
 */

/** The `simple-git` behaviour this layer depends on (`simpleGit()` satisfies it). */
export interface GitClient {
  /** Replaces the child process environment for the following commands. */
  env(env: Record<string, string>): unknown;
  raw(...commands: string[]): Promise<string>;
  branchLocal(): Promise<{ all: string[]; current: string }>;
  checkout(branch: string): Promise<unknown>;
  checkoutBranch(branch: string, startPoint: string): Promise<unknown>;
  add(files: string | string[]): Promise<unknown>;
  commit(message: string): Promise<{ commit: string; branch: string }>;
}

/**
 * The dirty-working-tree failure (decision D14). Exported as a type so callers can
 * map it to their own status code; the message is the actionable text the UI shows.
 */
export class DirtyRepoError extends Error {
  readonly repoPath: string;
  /** The `git status --porcelain` lines, verbatim — the evidence for the refusal. */
  readonly statusLines: string[];

  constructor(repoPath: string, statusLines: string[]) {
    const preview = statusLines.slice(0, 5).join(', ');
    const more = statusLines.length > 5 ? `, … ${statusLines.length - 5} more` : '';
    super(
      `SpiralDB repo at ${repoPath} has uncommitted changes — resolve them first. ` +
        `The save pipeline never stashes or discards your work. ` +
        `git status --porcelain (${statusLines.length}): ${preview}${more}`,
    );
    this.name = 'DirtyRepoError';
    this.repoPath = repoPath;
    this.statusLines = statusLines;
  }
}

/** The commit message header (docs/spec-data-model.md L216-223). */
export function buildCommitMessage(options: {
  action: string;
  objectType: string;
  objectKey: string;
  notes?: string;
}): string {
  const header = `spiraldb: ${options.action} ${options.objectType} ${options.objectKey}`;
  const notes = options.notes?.trim();
  return notes !== undefined && notes !== '' ? `${header}\n\n${notes}` : header;
}

/**
 * The email committed alongside `settings.user_name`.
 *
 * The spec fixes the commit *author name* (`user_name`, L225-232) and says nothing
 * about an email, while git requires a syntactically valid one. A synthetic
 * local-only address is used rather than the host's configured identity, so a save
 * can never commit as somebody else's address. Whitespace and anything outside the
 * conservative email set collapses to `-`.
 */
export function commitAuthorEmail(author: string): string {
  const slug = author.trim().replace(/[^A-Za-z0-9._+-]+/g, '-') || 'spiraldb-ui';
  return `${slug}@spiraldb-ui.local`;
}

/**
 * The environment variables a git child process inherits.
 *
 * An explicit allow-list, never `process.env`, for two measured reasons:
 *
 * 1. `simple-git` 3.36's `blockUnsafeOperationsPlugin` rejects a `commit` whose
 *    child environment carries `EDITOR`/`VISUAL`/`GIT_EDITOR` (or `PAGER`) —
 *    "Use of \"EDITOR\" is not permitted without enabling allowUnsafeEditor" —
 *    and this host's session environment does set `EDITOR=nano`. A commit through
 *    `simple-git` is otherwise impossible, and enabling `allowUnsafeEditor` would
 *    weaken a safety check we have no use for (this pipeline never opens an editor).
 * 2. Inheriting `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` from the parent would
 *    silently redirect these commands at a *different* repository than
 *    `settings.spiraldb_path`. Dropping them keeps every command anchored to
 *    `repoPath`.
 *
 * `PATH` and `HOME` stay because git needs them (hooks, global config / object
 * identity for non-commit commands); the locale and temp keys keep filenames and
 * lock files behaving the way the rest of the toolchain expects.
 */
const INHERITED_ENV_KEYS = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ'] as const;

function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of INHERITED_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

/**
 * The child environment for a commit: `baseEnv()` plus an explicit
 * author/committer identity.
 *
 * Deliberately **not** `git config user.name …`: writing config into the target
 * repository would silently re-author the owner's own later commits there, and
 * D14's spirit is to touch nothing but the object being saved. The commit is
 * authored and committed by `user_name`; the repository config is left alone.
 */
function commitEnv(author: string): Record<string, string> {
  return {
    ...baseEnv(),
    GIT_AUTHOR_NAME: author,
    GIT_AUTHOR_EMAIL: commitAuthorEmail(author),
    GIT_COMMITTER_NAME: author,
    GIT_COMMITTER_EMAIL: commitAuthorEmail(author),
  };
}

export interface EnsureSessionBranchOptions {
  /** The timestamp the branch date derives from; injectable for tests. */
  date?: Date;
  /** Explicit branch override — used by tests and by a future branch picker. */
  branch?: string;
}

export interface SessionBranchResult {
  /** The branch every later save in this session commits to. */
  branch: string;
  /** `true` when the branch did not exist and was created from main's HEAD. */
  created: boolean;
  /** main's commit sha at the moment the branch was created; `null` when it existed. */
  createdFrom: string | null;
  /** `true` when `settings.git_branch` was (re)written to `branch`. */
  persisted: boolean;
}

export interface CommitObjectOptions {
  /** `extract` | `create` | `update` (docs/spec-data-model.md L223). */
  action: string;
  /** Singular object type token (`quest`, `drop_table`, `global_registry`). */
  objectType: string;
  objectKey: string;
  /** Optional body lines (the extraction flow's capture note, for example). */
  notes?: string;
  /** `settings.user_name` — the commit author. */
  author: string;
  /** Absolute or repo-relative paths that make up this save. */
  paths: string[];
}

export interface CommitObjectResult {
  sha: string;
  branch: string;
  message: string;
  /** The commit's paths, normalised to repo-relative form. */
  paths: string[];
}

export interface GitService {
  readonly repoPath: string;
  /** `git status --porcelain` output, verbatim (empty string means clean). */
  statusPorcelain(): Promise<string>;
  /** @throws {DirtyRepoError} when the working tree is not clean (D14). */
  assertClean(): Promise<void>;
  currentBranch(): Promise<string>;
  /** Checks out the session branch, creating it from main's HEAD when absent. */
  ensureSessionBranch(options?: EnsureSessionBranchOptions): Promise<SessionBranchResult>;
  /** Stages `paths` and commits them as one commit (D13). */
  commitObject(options: CommitObjectOptions): Promise<CommitObjectResult>;
}

export interface CreateGitServiceOptions {
  /** The SpiralDB repository root (`settings.spiraldb_path`). */
  repoPath: string;
  /**
   * The git client. Defaults to `simpleGit(repoPath)`; tests inject a throwaway
   * repository's client (or a fake) — never the owner's fork.
   */
  client?: GitClient;
  /** Reads `settings.git_branch` (the session branch to reuse when set). */
  settingsBranch?: () => string | undefined;
  /** Persists `settings.git_branch` after a branch is resolved. */
  persistBranch?: (branch: string) => void;
}

/** `content/YYYY-MM-DD` — the branch name the spec derives per session (L208). */
export function sessionBranchName(date: Date): string {
  return `content/${formatLocalDate(date)}`;
}

/**
 * Builds the git service for one SpiralDB root.
 *
 * The branch a save commits to is `settings.git_branch` when that setting is
 * non-blank (the user may point it elsewhere — docs/spec-data-model.md L212,
 * decision D42), otherwise `content/{today}`. Either way the resolved name is
 * persisted to `settings.git_branch` when it differs from what was stored, so the
 * setting reflects the branch that was actually committed to.
 */
export function createGitService(options: CreateGitServiceOptions): GitService {
  const repoPath = path.resolve(options.repoPath);
  const client = options.client ?? (simpleGit({ baseDir: repoPath }) as unknown as GitClient);

  /**
   * `true` when `repoPath` is the root of a git working tree. A linked worktree
   * passes too (`--show-toplevel` names it), which `rev-parse --git-dir` would not
   * report as `.`, and a subdirectory of some repository fails — pointing
   * `spiraldb_path` at one would commit into the wrong tree.
   */
  async function isWorkingTreeRoot(): Promise<boolean> {
    try {
      if ((await client.raw('rev-parse', '--is-inside-work-tree')).trim() !== 'true') {
        return false;
      }
      const topLevel = (await client.raw('rev-parse', '--show-toplevel')).trim();
      return path.resolve(topLevel) === repoPath;
    } catch {
      return false;
    }
  }

  async function statusPorcelain(): Promise<string> {
    client.env(baseEnv());
    if (!(await isWorkingTreeRoot())) {
      throw new Error(
        `SpiralDB path ${repoPath} is not the root of a git working tree — ` +
          `check settings.spiraldb_path.`,
      );
    }
    return client.raw('status', '--porcelain');
  }

  return {
    repoPath,

    statusPorcelain,

    async assertClean() {
      const porcelain = await statusPorcelain();
      const dirtyPaths = porcelain
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
      if (dirtyPaths.length > 0) {
        throw new DirtyRepoError(repoPath, dirtyPaths);
      }
    },

    async currentBranch() {
      client.env(baseEnv());
      const branches = await client.branchLocal();
      return branches.current;
    },

    async ensureSessionBranch(branchOptions = {}) {
      const stored = options.settingsBranch?.()?.trim();
      const branch =
        branchOptions.branch?.trim() ||
        (stored !== undefined && stored !== ''
          ? stored
          : sessionBranchName(branchOptions.date ?? new Date()));

      client.env(baseEnv());
      const local = await client.branchLocal();
      let created = false;
      let createdFrom: string | null = null;
      if (!local.all.includes(branch)) {
        try {
          createdFrom = (await client.raw('rev-parse', 'main')).trim();
        } catch {
          throw new Error(
            `Cannot create session branch ${branch}: the SpiralDB repo at ${repoPath} has no ` +
              `"main" branch to create it from (docs/spec-data-model.md L210).`,
          );
        }
        await client.checkoutBranch(branch, 'main');
        created = true;
      } else if (local.current !== branch) {
        await client.checkout(branch);
      }

      const persisted = stored !== branch;
      if (persisted) {
        options.persistBranch?.(branch);
      }
      return { branch, created, createdFrom, persisted };
    },

    async commitObject(commitOptions) {
      if (commitOptions.paths.length === 0) {
        throw new Error('commitObject requires at least one path to commit.');
      }
      const paths = commitOptions.paths.map((candidate) =>
        path.isAbsolute(candidate) ? path.relative(repoPath, candidate) : candidate,
      );
      const message = buildCommitMessage(commitOptions);

      client.env(commitEnv(commitOptions.author));
      await client.add(paths);
      const result = await client.commit(message);

      return { sha: result.commit, branch: result.branch, message, paths };
    },
  };
}
