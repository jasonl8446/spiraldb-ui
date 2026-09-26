import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Throwaway git repositories for the save-pipeline tests (story p2-05).
 *
 * Decision D17 forbids automated tests from touching the owner's fork and the
 * disposable clone is reserved for the story's scripted acceptance run, so every
 * git assertion runs against a fresh `git init` repository under
 * `data/__test-scratch__/` (gitignored). Real `git` is used — `simple-git` is
 * what the pipeline drives — but the identity is passed per invocation, so the
 * host's global git config can never influence a test.
 */

/** Gitignored parent of every scratch repository, mirroring `tests/unit/import.test.ts`. */
export const SCRATCH_PARENT = path.join(process.cwd(), 'data', '__test-scratch__');

export interface TempRepo {
  /** Absolute repository root. */
  dir: string;
  /** Runs `git <args>` in the repository and returns stdout (no shell, no global config influence). */
  git(args: string[]): string;
}

/** Runs git in `cwd` with a fixed setup identity and signing off. */
export function gitIn(cwd: string, args: string[]): string {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Test Setup',
      '-c',
      'user.email=setup@spiraldb-ui.local',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    // stderr is captured rather than inherited: git's chatter ("Switched to a new
    // branch …") would otherwise pollute the test report, and a failing command
    // still carries its message on the thrown error.
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

/** Creates a repository with one `seed` commit on `branch` (default `main`). */
export function createTempGitRepo(prefix: string, options: { branch?: string } = {}): TempRepo {
  fs.mkdirSync(SCRATCH_PARENT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(SCRATCH_PARENT, prefix));
  const repo: TempRepo = { dir, git: (args) => gitIn(dir, args) };
  repo.git(['init', '-b', options.branch ?? 'main']);
  writeRepoFile(repo, 'README.md', 'seed\n');
  repo.git(['add', 'README.md']);
  repo.git(['commit', '-m', 'seed']);
  return repo;
}

/** Writes a file inside the repository, creating parent directories. */
export function writeRepoFile(repo: TempRepo, relative: string, content: string): void {
  const file = path.join(repo.dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** Reads a file inside the repository as UTF-8. */
export function readRepoFile(repo: TempRepo, relative: string): string {
  return fs.readFileSync(path.join(repo.dir, relative), 'utf8');
}

/** `true` when the path exists inside the repository. */
export function repoFileExists(repo: TempRepo, relative: string): boolean {
  return fs.existsSync(path.join(repo.dir, relative));
}

/** A repository's commit subjects, newest first (`git log --format=%s`). */
export function commitSubjects(repo: TempRepo): string[] {
  return logLines(repo, '%s').filter((line) => line !== '');
}

/**
 * `git log --format=<format>` split into records: one non-empty line per commit,
 * which is enough for the single-line formats the tests use (`%s`, `%an`, `%H`).
 */
export function logLines(repo: TempRepo, format: string): string[] {
  return repo.git(['log', `--format=${format}`]).split('\n');
}

/** How many commits the branch carries (`git rev-list --count HEAD`). */
export function commitCount(repo: TempRepo): number {
  return Number(repo.git(['rev-list', '--count', 'HEAD']).trim());
}

/** Deletes a scratch repository. */
export function removeTempGitRepo(repo: TempRepo): void {
  fs.rmSync(repo.dir, { recursive: true, force: true });
}
