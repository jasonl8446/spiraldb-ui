import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The D17 clone's shared plumbing: its path, the frozen corpus count, `git` inside it, the axis
 * snapshot and the `reset --hard` restore.
 *
 * Three suites drive a real save into `data/test-spiraldb` (`quest-scaffold.test.ts`,
 * `quest-edit-isolation.test.ts`, `quest-evidence-insert-isolation.test.ts`) and each had grown its
 * own copy of these bodies. Only the **identical** ones live here: `git`, `questFileCount`,
 * `CloneAxes`, `cloneAxes` and the restore were byte-identical across the suites.
 *
 * The **readiness predicate stays per-suite**, deliberately. Each suite's "can the real-file half
 * run at all" check names the files *that suite* needs and the reason it needs them
 * (`WC-CYCLOPS-MAIN-002` plus its metadata; `DS-ACAD-C01-002`; `QuestTemplates/`), and it is the
 * only guard standing between a run and somebody else's work in progress — parameterising it into
 * one shape is exactly how a careless merge widens what a suite is willing to reset. The clone's
 * `path` is the one thing they must not disagree about, so it is shared.
 */

/** The D17 clone: the run's save corpus, a throwaway repository — never the owner's fork. */
export const CLONE = path.resolve(
  fileURLToPath(new URL('../../data/test-spiraldb/', import.meta.url)),
);

/**
 * The corpus is **frozen at 322 by decision (D80(c))** — the 322-era clone is deliberately kept
 * separate from the owner's 328-quest fork, so a corpus that changed under a run must be
 * re-measured knowingly rather than absorbed by a constant that quietly still matched.
 */
export const CLONE_QUEST_FILES = 322;

/** Runs git inside the clone and returns stdout. */
export function cloneGit(args: readonly string[]): string {
  return execFileSync('git', ['-C', CLONE, ...args], { encoding: 'utf8' });
}

/** The five axes a restore has to move back, plus the corpus shape and the local refs. */
export interface CloneAxes {
  branch: string;
  head: string;
  main: string;
  commitCount: string;
  porcelain: string;
  questFiles: number;
  /** Every local branch, verbatim — the D76(b) check (`git reset --hard` can leave one behind). */
  refs: string;
}

/** The corpus shape: the number of `QuestTemplates/*.json` files in the clone. */
export function questFileCount(): number {
  return Number(
    execFileSync('bash', ['-c', `ls ${CLONE}/QuestTemplates/*.json | wc -l`])
      .toString()
      .trim(),
  );
}

/** Every axis at once, so "before" and "after" are the same measurement. */
export function cloneAxes(): CloneAxes {
  return {
    branch: cloneGit(['rev-parse', '--abbrev-ref', 'HEAD']).trim(),
    head: cloneGit(['rev-parse', 'HEAD']).trim(),
    main: cloneGit(['rev-parse', 'main']).trim(),
    commitCount: cloneGit(['rev-list', '--count', 'HEAD']).trim(),
    porcelain: cloneGit(['status', '--porcelain']),
    questFiles: questFileCount(),
    refs: cloneGit(['show-ref', '--heads']),
  };
}

/**
 * Put the clone back on `point` and refuse to return while it is still dirty.
 *
 * The parameter rather than a module-level variable because the *snapshot* is the caller's: each
 * suite records its own restore point (and clears it) around its own write.
 */
export function resetClone(point: string | null): void {
  if (point === null) {
    return;
  }
  cloneGit(['reset', '--hard', point]);
  const porcelain = cloneGit(['status', '--porcelain']);
  if (porcelain.trim() !== '') {
    throw new Error(`the D17 clone is still dirty after reset: ${porcelain}`);
  }
}
