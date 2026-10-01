import fs from 'node:fs';
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
  /** `simple-git`'s `commit(message, files, options)`: here always `--only` this save's paths. */
  commit(
    message: string,
    files?: string[],
    options?: Record<string, null>,
  ): Promise<{ commit: string; branch: string }>;
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

/**
 * A save refused because `settings.git_branch` names a branch other than the checked-out one
 * (D119, extended to every write path by task 7.14). Nothing was written or checked out. Exported
 * so both write routers map it to a 409 with the actionable message.
 */
export class BranchMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BranchMismatchError';
  }
}

/**
 * Which branch a scaffold commits to, decided from the three facts the caller has (added after
 * the trap this story's own first CLI run hit).
 *
 * **The trap, measured.** `settings.git_branch` is what the save pipeline commits to
 * (`ensureSessionBranch`), and when that branch does not exist locally it is **created from
 * `main` and checked out** — which replaces the working tree with main's contents. A scratch
 * database seeded today carries `content/{today}`; a clone sitting on `content/2026-09-27` then
 * loses whatever exists only on that branch (measured: the clone's two branch-only files) *and*
 * keeps the new branch afterwards. That is D76(b)'s shape one level deeper: not a `reset --hard`
 * that strands a branch, but **a database branch name that disagrees with the tree**.
 *
 * The rule this function encodes, and the decision it represents:
 *
 * 1. **No explicit branch (`--branch` absent) — follow the working tree.** The caller pointed the
 *    command at a *repository*; the only branch that cannot strand work is the one already checked
 *    out, so the setting is moved to it (`updateSetting: true`) and the caller says so. The
 *    alternative — refusing — would make the safe case need a manual `UPDATE`; the other
 *    alternative — checking a branch out from inside the tool — mutates git state the operator
 *    owns, which a scaffold command has no business doing.
 * 2. **An explicit branch that is not the checked-out one — refuse.** Creating it from `main` is
 *    precisely the stranding behaviour, and the fix belongs in git (`git -C <root> checkout`), not
 *    in a database setting. Refusing keeps the decision visible where it can be reviewed.
 *    **Exception (task 7.14, D182, narrowed by D195): the working tree is on `main` and the
 *    requested branch does not exist yet.** Creating the branch from `main` then replaces the
 *    tree with the contents it already has, so nothing can strand and the spec's branch strategy
 *    (docs/spec-data-model.md L206-214: the session branch is created from main) keeps working.
 *    A branch that **already exists** is checked out instead — the tree becomes *its* content,
 *    main's own files vanish from it — so that arm is refused like any other (PR #14 review 2).
 *    `requestedExists` left `undefined` is no exemption: the caller must say (fail closed).
 * 3. **No repository context (`currentBranch` empty) or no setting — no opinion.** Nothing to
 *    follow; the pipeline's own default (`content/{today}`) applies unchanged.
 *
 * **One helper for every write path (task 7.14, D182).** The scaffold CLI calls it with
 * `--branch`; the save pipeline calls it with `settings.git_branch` as the requested branch
 * (`requestedFrom: 'setting'`), so a save through any route is refused on the same rule.
 */
export type ScaffoldBranchDecision =
  { kind: 'use'; branch: string; updateSetting: boolean } | { kind: 'refuse'; message: string };

export function resolveScaffoldBranch(input: {
  /** `settings.git_branch`, trimmed (empty when unset). */
  settingsBranch: string;
  /** The working tree's current branch (`''` when the root is not a git working tree). */
  currentBranch: string;
  /** `--branch`, when the caller named one — or the setting itself on a save. */
  requested?: string;
  /** Whether `requested` already exists as a local branch (the `main` exemption needs `false`). */
  requestedExists?: boolean;
  /** Where `requested` came from, so a refusal names the remedy that applies (default `flag`). */
  requestedFrom?: 'flag' | 'setting';
  /**
   * `true` when HEAD is detached (`git symbolic-ref -q HEAD` fails) — final-review round 1, m1.
   * A commit there lands on no branch (reachable only through the reflog until gc), which is the
   * stranding the D119 guard exists to prevent, so it is refused before any other rule applies.
   */
  detached?: boolean;
}): ScaffoldBranchDecision {
  const requested = input.requested?.trim();
  const current = input.currentBranch.trim();
  const stored = input.settingsBranch.trim();

  if (input.detached === true) {
    return {
      kind: 'refuse',
      message:
        `Refusing to save: the SpiralDB working tree has a detached HEAD (at "${current}"), so a ` +
        `commit would land on no branch and be reachable only through the reflog. Check a branch ` +
        `out first (git -C <root> checkout <branch>).`,
    };
  }

  if (requested !== undefined && requested !== '') {
    const createdFromMain = current === 'main' && input.requestedExists === false;
    if (current === '' || createdFromMain || requested === current) {
      return { kind: 'use', branch: requested, updateSetting: stored !== requested };
    }
    const fromSetting = input.requestedFrom === 'setting';
    return {
      kind: 'refuse',
      message:
        (fromSetting
          ? `Refusing to save on branch "${requested}" (settings.git_branch): `
          : `Refusing to scaffold on branch "${requested}": `) +
        `the working tree is on "${current}". ` +
        (current === 'main' && input.requestedExists === true
          ? `"${requested}" already exists, so committing to it checks it out and replaces the ` +
            `tree with its contents, dropping every file only main has from the tree. `
          : `Committing to a branch that is not checked out creates it from main and replaces the ` +
            `tree with main's contents, stranding anything that exists only on "${current}". `) +
        `Check it out first (git -C <root> checkout ${requested}) or ` +
        (fromSetting
          ? `set git_branch to "${current}" in Settings to commit there.`
          : `drop --branch to commit on "${current}".`),
    };
  }

  if (current === '') {
    return { kind: 'use', branch: stored, updateSetting: false };
  }
  return { kind: 'use', branch: current, updateSetting: stored !== current };
}

/** The longest caller-supplied commit note kept, in **code points** (final-review gate 2, S4). */
export const MAX_COMMIT_NOTES_LENGTH = 255;

/**
 * Reduces caller-supplied `notes` to **one safe line**, or `undefined` for "no body".
 *
 * The commit message is the one place a caller's text reaches the owner's repository history,
 * and the header is server-built (`spiraldb: {action} {type} {key}`) — so unsanitised `notes`
 * could only ever spoof the **body**, but a body with newlines in it can still fabricate a
 * `spiraldb: create quest X` line or a `Co-authored-by:`/`Signed-off-by:` trailer block
 * (final-review gate 2, S4). Every control character (newlines included) and every run of
 * whitespace collapses to a single space, so no caller text can start a line, and the result is
 * capped at {@link MAX_COMMIT_NOTES_LENGTH}.
 *
 * One home: both write paths (`services/quests.ts` and the generic `routes/objects.ts`) reach a
 * commit through {@link buildCommitMessage}, so neither has to remember this. It is deliberately
 * *not* the quests capture-note sanitiser (`sanitizeCaptureSource`) — that one also reduces a
 * path to its base name, which is meaningless for a note a user typed.
 */
export function sanitizeCommitNotes(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const cleaned = value.replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim();
  if (cleaned === '') {
    return undefined;
  }
  // The cap is applied on **code points**, not UTF-16 code units: `String.prototype.slice`
  // counts code units, so a slice boundary landing between the halves of a surrogate pair emits
  // a **lone surrogate** — a string that does not survive a UTF-8 round trip and would reach the
  // repository as U+FFFD. Measured (final-verify gate 3, the real module): 254 ASCII characters
  // followed by one astral character (`'a'.repeat(254) + '😀'`) produced a 255-code-unit body
  // ending in the bare high surrogate `\ud83d`, whose `Buffer.from(…, 'utf8')` re-encode is not
  // equal to itself. ASCII is unaffected — code units equal code points there — which is why the
  // pinned length test (`tests/unit/git-service.test.ts`, an ASCII payload) still holds.
  const points = [...cleaned];
  return points.length <= MAX_COMMIT_NOTES_LENGTH
    ? cleaned
    : points.slice(0, MAX_COMMIT_NOTES_LENGTH).join('');
}

/** The commit message header (docs/spec-data-model.md L216-223). */
export function buildCommitMessage(options: {
  action: string;
  objectType: string;
  objectKey: string;
  notes?: string;
}): string {
  const header = `spiraldb: ${options.action} ${options.objectType} ${options.objectKey}`;
  const notes = sanitizeCommitNotes(options.notes);
  return notes !== undefined ? `${header}\n\n${notes}` : header;
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

/**
 * `path.resolve(candidate)` with symlinks resolved when the filesystem can (N4).
 *
 * Git reports the physical path of a working tree, so comparing a configured path with git's
 * answer has to happen on physical paths or a symlinked `spiraldb_path` is refused. A path the
 * filesystem cannot resolve (a directory that does not exist yet) falls back to its resolved
 * form, which then simply fails the comparison as before.
 */
function physicalPath(candidate: string): string {
  const resolved = path.resolve(candidate);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

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
  /**
   * Paths this save **deletes** in the same commit (D22's consolidate-and-replace). They are
   * staged as deletions with `git rm --cached --ignore-unmatch`, so a tracked file's removal is
   * staged and a path git never knew (an untracked leftover the tool removed from the working
   * tree) is a no-op instead of the `pathspec did not match` failure plain `git add` raises.
   */
  removePaths?: string[];
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
  /** `git status --porcelain [-- <paths>]` output, verbatim (empty string means clean). */
  statusPorcelain(paths?: string[]): Promise<string>;
  /** @throws {DirtyRepoError} when the working tree is not clean (D14). */
  assertClean(): Promise<void>;
  currentBranch(): Promise<string>;
  /** `true` when HEAD is detached — `git symbolic-ref -q HEAD` fails (m1). */
  isDetached(): Promise<boolean>;
  /** `true` when `branch` exists locally (the D119 guard's `main` exemption, D195). */
  branchExists(branch: string): Promise<boolean>;
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
   *
   * The comparison is on **physical** paths (final-review gate 2, N4): git answers with the
   * resolved path, so a `settings.spiraldb_path` that is a symlink to a real work-tree root used
   * to be refused with "not the root of a git working tree — check settings.spiraldb_path",
   * which sent the operator to a setting that was in fact fine. `realpath` keeps the rule that
   * matters (the *root*, not a subdirectory of a repository) and stops refusing a valid
   * configuration.
   */
  async function isWorkingTreeRoot(): Promise<boolean> {
    try {
      if ((await client.raw('rev-parse', '--is-inside-work-tree')).trim() !== 'true') {
        return false;
      }
      const topLevel = (await client.raw('rev-parse', '--show-toplevel')).trim();
      return physicalPath(topLevel) === physicalPath(repoPath);
    } catch {
      return false;
    }
  }

  async function statusPorcelain(paths: string[] = []): Promise<string> {
    client.env(baseEnv());
    if (!(await isWorkingTreeRoot())) {
      throw new Error(
        `SpiralDB path ${repoPath} is not the root of a git working tree — ` +
          `check settings.spiraldb_path.`,
      );
    }
    if (paths.length === 0) {
      return client.raw('status', '--porcelain');
    }
    const relative = paths.map((candidate) =>
      path.isAbsolute(candidate) ? path.relative(repoPath, candidate) : candidate,
    );
    return client.raw('status', '--porcelain', '--', ...relative);
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

    async isDetached() {
      client.env(baseEnv());
      // The ref's name, not the exit code: `-q` makes git fail silently, and simple-git answers a
      // non-zero exit with no stderr as an empty success (measured: a detached tree passed).
      try {
        return !(await client.raw('symbolic-ref', '-q', 'HEAD')).trim().startsWith('refs/heads/');
      } catch {
        return true;
      }
    },

    async branchExists(branch) {
      client.env(baseEnv());
      return (await client.branchLocal()).all.includes(branch);
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
      const removePaths = (commitOptions.removePaths ?? []).map((candidate) =>
        path.isAbsolute(candidate) ? path.relative(repoPath, candidate) : candidate,
      );
      const message = buildCommitMessage(commitOptions);

      client.env(commitEnv(commitOptions.author));
      // The deletions git can commit are the ones HEAD tracks: a path git never knew (an untracked
      // leftover the tool removed) has nothing to commit and would fail `--only`'s pathspec.
      const trackedRemovals =
        removePaths.length === 0
          ? []
          : (await client.raw('ls-tree', '--name-only', 'HEAD', '--', ...removePaths))
              .split('\n')
              .map((line) => line.trim())
              .filter((line) => line !== '');
      // The write first, so a removal can never be committed without the file that replaces it
      // (the D22 failure mode): both are staged before the single commit below.
      await client.add(paths);
      if (removePaths.length > 0) {
        await client.raw('rm', '--cached', '--ignore-unmatch', '--', ...removePaths);
      }
      // `--only` these paths (final-review round 1, M2): a bare `git commit` takes the whole index,
      // so anything else staged — another save's files, measured in the reviewer's concurrent
      // repro — would ride in this commit under this object's message.
      const result = await client.commit(message, [...paths, ...trackedRemovals], {
        '--only': null,
      });

      return {
        sha: result.commit,
        branch: result.branch,
        message,
        paths: [...paths, ...removePaths],
      };
    },
  };
}
