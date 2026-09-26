import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { afterAll, describe, expect, it } from 'vitest';

import { MEMORY_DB, openDb, writeSettings, type Db } from '@server/db';
import { createSavePipeline } from '@server/services/savePipeline';
import { readSpiraldbJson } from '@server/services/spiraldbFiles';
import { createSpiraldbIndex } from '@server/services/spiraldbIndex';
import { getStatusEntry, getStatusHistory } from '@server/services/status';
import { saveQuest } from '@server/services/quests';
import { applyEdits, type DocEdit, type JsonDocument } from '@shared/document';
import { DIALOG_LIST_KEY, setEntryNumberFieldEdit } from '../../client/src/lib/quest-dialog';
import { goalNumberFieldEdit } from '../../client/src/lib/quest-goals';

/**
 * Story p3-10, AC1 — **real-quest edit isolation** (plan task 3.10; plan-phase-3 §3.10's
 * "Real-quest edit isolation" criterion; decisions D17 and D49).
 *
 * The claim, stated as the AC states it: pick a corpus quest with ≥3 goals and a dialog list,
 * edit **one goal field + one dialog field**, save, and `git diff` **in the D17 clone** shows
 * only those fields changed — plus the first-rewrite formatting normalization D49(c) measured.
 *
 * Why this is a node integration test and not a tier-1 spec: the tier-1 harness is hermetic
 * (D40 — a route-mocked browser with a throwaway database), so it can prove the *payload* but
 * never the *file*. This test therefore drives the real stack's own path end to end:
 *
 * 1. the corpus file is read from the clone with the server's own lenient reader;
 * 2. the two edits are produced by the **UI's own builders** (`goalNumberFieldEdit`,
 *    `setEntryNumberFieldEdit`) and applied with the D58 primitive the editors use, so the
 *    document is exactly what a browser click would have produced;
 * 3. `saveQuest` — the service behind `POST /api/quests` — runs the real Phase-2 pipeline
 *    against the clone: file write, D20 metadata refresh, `spiraldb: update quest {name}` commit;
 * 4. the proof is the raw `git diff` output **plus** a leaf-level comparison of the parsed
 *    documents, because the raw diff is dominated by the legacy file's formatting normalization
 *    (`,\n}` trailing commas, 11 interior blank lines, 161 integral floats, the missing final
 *    newline) and only the leaf diff can name what actually changed.
 *
 * `DS-ACAD-C01-002` is the chosen quest, and the reasons are measurable: 3 goals
 * (`1_WizardQuestGoals_ExploreZone`, `2_WizardQuestGoals_Explore`, `3_WizardQuestGoals_TalkNPC`),
 * a quest-level `m_dialogList` with 7 dialog entries, all 36 top-level keys, 8 trailing commas —
 * and it is present in the clone. The lead's brief named it as a measured candidate; the goal
 * field is goal **1**'s `m_goalNameID` (a number input the Goals tab owns) and the dialog field
 * is the first Prep entry's `m_maxTimeSeconds` (a number input the Dialog tab owns).
 *
 * **D17 / the rig hazard.** The clone is the only repository this test touches: the pipeline is
 * handed the clone path directly rather than through a server, so `settings.spiraldb_path` (the
 * D65(g) hazard) never enters the picture and the owner's real fork cannot be reached. The clone
 * is restored with `git reset --hard <base>` in a `finally` **and** in `afterAll`, and the test
 * asserts the restore worked.
 */

const CLONE = path.resolve(fileURLToPath(new URL('../../data/test-spiraldb/', import.meta.url)));
const QUEST_NAME = 'DS-ACAD-C01-002';
const QUEST_FILE = `QuestTemplates/questtemplates_${QUEST_NAME}.json`;
const META_FILE = `QuestMetadatas/questmetadata_${QUEST_NAME}.json`;

/** Goal index 1 (`2_WizardQuestGoals_Explore`) and the field the Goals tab owns. */
const GOAL_INDEX = 1;
const GOAL_FIELD = 'm_goalNameID';
const GOAL_BEFORE = 606539207;
const GOAL_AFTER = 606539208;

/** The first dialog group's first entry (`m_dialogTag: "Prep"`) and a Dialog-tab number field. */
const DIALOG_GROUP = 0;
const DIALOG_ENTRY = 0;
const DIALOG_FIELD = 'm_maxTimeSeconds';
const DIALOG_BEFORE = -1;
const DIALOG_AFTER = 45;

const DIFF_QUEST_PATH = `${QUEST_FILE}`;

/** Runs git inside the clone and returns stdout (throwaway repository — never the fork). */
function git(args: readonly string[]): string {
  return execFileSync('git', ['-C', CLONE, ...args], { encoding: 'utf8' });
}

/**
 * `true` when the real-file half of this test can run at all: the clone exists, it is a git
 * working tree, it is **clean** (the pipeline's D14 guard refuses a dirty tree, and a dirty tree
 * means somebody's work in progress), and the corpus quest is on disk.
 *
 * A missing or dirty clone is a **skip with a loud reason**, never a silent pass and never a
 * reset of somebody else's work.
 */
function cloneReadiness(): { ok: boolean; reason: string } {
  if (!existsSync(path.join(CLONE, '.git'))) {
    return { ok: false, reason: 'the D17 clone data/test-spiraldb is absent' };
  }
  if (!existsSync(path.join(CLONE, QUEST_FILE))) {
    return { ok: false, reason: `${QUEST_FILE} is absent from the clone` };
  }
  const porcelain = git(['status', '--porcelain']);
  if (porcelain.trim() !== '') {
    return { ok: false, reason: `${CLONE} has uncommitted changes (refusing to reset them)` };
  }
  return { ok: true, reason: '' };
}

const READINESS: { ok: boolean; reason: string } = ((): { ok: boolean; reason: string } => {
  try {
    return cloneReadiness();
  } catch (error) {
    return { ok: false, reason: String(error) };
  }
})();

if (!READINESS.ok) {
  console.warn(`[p3-10 AC1] skipping the real-clone isolation test: ${READINESS.reason}`);
}

/* ------------------------------------------------------------- diff inspection */

interface LeafChange {
  /** A dotted path with `[i]` for array indices; the root is `''`. */
  path: string;
  kind: 'changed' | 'removed' | 'added';
  before: unknown;
  after: unknown;
}

/** `true` for a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Every leaf that differs between two parsed documents — the only honest way to say what
 * changed, because a serialization rewrite moves thousands of *lines* without moving a value.
 */
function leafChanges(before: JsonDocument, after: JsonDocument): LeafChange[] {
  const changes: LeafChange[] = [];

  function walk(a: unknown, b: unknown, at: string): void {
    if (isPlainObject(a) && isPlainObject(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const child = at === '' ? key : `${at}.${key}`;
        if (!Object.prototype.hasOwnProperty.call(a, key)) {
          changes.push({ path: child, kind: 'added', before: undefined, after: b[key] });
        } else if (!Object.prototype.hasOwnProperty.call(b, key)) {
          changes.push({ path: child, kind: 'removed', before: a[key], after: undefined });
        } else {
          walk(a[key], b[key], child);
        }
      }
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        changes.push({ path: at, kind: 'changed', before: a.length, after: b.length });
      }
      for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
        walk(a[index], b[index], `${at}[${index}]`);
      }
      return;
    }
    if (!isDeepStrictEqual(a, b)) {
      changes.push({ path: at === '' ? '<root>' : at, kind: 'changed', before: a, after: b });
    }
  }

  walk(before, after, '');
  return changes;
}

/** The `-`/`+` lines of a unified diff, without the `---`/`+++` headers. */
function diffLines(diff: string): { removed: string[]; added: string[] } {
  const removed: string[] = [];
  const added: string[] = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('---') || line.startsWith('+++')) {
      continue;
    }
    if (line.startsWith('-')) {
      removed.push(line.slice(1));
    } else if (line.startsWith('+')) {
      added.push(line.slice(1));
    }
  }
  return { removed, added };
}

/**
 * The two normalizations that make a legacy line comparable with its rewritten form (D49(c)
 * measured both on the sibling quest `DS-ACAD1-C01-001`; this file reproduces them):
 *
 * - **the comma before a closing brace/bracket** (`,"\n}"`) — the corpus's legacy trailing
 *   commas, 8 of them here — is dropped by `JSON.stringify`, so the line loses only its comma;
 * - **integral floats are respelled** (`1.0` → `1`), 161 lines here.
 *
 * Ordinary separator commas are *not* a difference: `JSON.stringify` writes them too, so those
 * lines are byte-identical and never enter the diff at all.
 */
function normalizeLine(line: string): string {
  return line
    .replace(/,\s*$/, '')
    .replace(/-?(\d)\.0(?=$|[\s,\]}])/g, '$1')
    .trim();
}

/**
 * The lines of `lines` for which `other` has no (multiset) counterpart once normalized — i.e.
 * the lines that are **not** formatting normalization. Multiset, not set, because a value like
 * `"m_maxTimeSeconds": -1` occurs eight times in this file and a set comparison would swallow
 * the one occurrence that really changed.
 */
function unexplained(lines: readonly string[], other: readonly string[]): string[] {
  const pool = new Map<string, number>();
  for (const line of other) {
    const key = normalizeLine(line);
    pool.set(key, (pool.get(key) ?? 0) + 1);
  }
  const left: string[] = [];
  for (const line of lines) {
    const key = normalizeLine(line);
    const available = pool.get(key) ?? 0;
    if (available > 0) {
      pool.set(key, available - 1);
    } else {
      left.push(line);
    }
  }
  return left;
}

/** The commit the clone was on when the test started, for the restore. */
let restorePoint: string | null = null;

function restoreClone(): void {
  if (restorePoint === null) {
    return;
  }
  git(['reset', '--hard', restorePoint]);
  const porcelain = git(['status', '--porcelain']);
  if (porcelain.trim() !== '') {
    throw new Error(`the D17 clone is still dirty after reset: ${porcelain}`);
  }
}

afterAll(() => {
  restoreClone();
});

describe.skipIf(!READINESS.ok)('AC1 — real-quest edit isolation in the D17 clone', () => {
  it('saves exactly the two edited fields, refreshes only the metadata stamps, and keeps the verified status', async () => {
    const base = git(['rev-parse', 'HEAD']).trim();
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    restorePoint = base;

    const beforeText = readFileSync(path.join(CLONE, QUEST_FILE), 'utf8');
    const beforeMeta = readSpiraldbJson(path.join(CLONE, META_FILE)) as Record<string, unknown>;
    const original = readSpiraldbJson(path.join(CLONE, QUEST_FILE)) as Record<string, unknown>;

    // The corpus facts this test's expectations rest on, asserted rather than assumed.
    const goals = original.m_goals as unknown[];
    expect(Array.isArray(goals)).toBe(true);
    expect(goals.length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(original)).toHaveLength(36);

    const db: Db = openDb({ file: MEMORY_DB });
    try {
      writeSettings(db, { user_name: 'P3-10 AC1 Tester', git_branch: branch });
      /**
       * Seed a `verified` entry directly: `applyStatusChange` (rightly) only transitions rows that
       * already exist, and the point of this assertion is that the **save** leaves a verified
       * entry alone (plan §3.10's last clause), so the row has to exist before it.
       */
      db.prepare(
        `INSERT INTO entry_status (object_type, object_key, status, extracted_at, verified_at, verified_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        'quest',
        QUEST_NAME,
        'verified',
        '2026-06-01T00:00:00.000Z',
        '2026-06-02T00:00:00.000Z',
        'AC1 Tester',
      );
      const historyBefore = getStatusHistory(db, 'quest', QUEST_NAME);

      const index = createSpiraldbIndex(CLONE);
      index.rebuild();
      const pipeline = createSavePipeline({ db, spiraldbPath: CLONE, index });

      // The two edits, through the UI's own builders (a browser click is exactly this call).
      const goalEdit = goalNumberFieldEdit(GOAL_INDEX, GOAL_FIELD, true, String(GOAL_AFTER));
      const dialogEdit = setEntryNumberFieldEdit(
        [DIALOG_LIST_KEY],
        DIALOG_GROUP,
        DIALOG_ENTRY,
        DIALOG_FIELD,
        true,
        String(DIALOG_AFTER),
      );
      expect(goalEdit).not.toBeNull();
      expect(dialogEdit).not.toBeNull();
      // `filter` with a type guard rather than a cast: a builder that stopped producing an edit
      // for a present field must fail the length assertion, not silently apply one edit.
      const edits: DocEdit[] = [goalEdit, dialogEdit].filter(
        (edit): edit is DocEdit => edit !== null,
      );
      expect(edits).toHaveLength(2);
      const edited = applyEdits(original, edits);

      const result = await saveQuest({ db, index, pipeline, body: { quest: edited } });

      /* -------------------------------------------------- the pipeline's own outcome (AC4) */
      expect(result.quest_name).toBe(QUEST_NAME);
      expect(result.outcome).toBe('updated');
      expect(result.action).toBe('update');
      expect(result.commit_message).toBe(`spiraldb: update quest ${QUEST_NAME}`);
      expect(git(['log', '-1', '--pretty=%s']).trim()).toBe(`spiraldb: update quest ${QUEST_NAME}`);
      expect(result.metadata).toBe(META_FILE);
      expect(result.metadata_outcome).toBe('updated');

      /* ----------------------------------------------------- the changed file set is exact */
      const changedFiles = git(['diff', '--name-only', base, 'HEAD'])
        .trim()
        .split('\n')
        .filter((line) => line !== '')
        .sort();
      expect(changedFiles).toEqual([META_FILE, QUEST_FILE].sort());

      /* ------------------------------------- AC1's core claim: only the edited fields moved */
      const leafChangesQuest = leafChanges(
        original,
        readSpiraldbJson(path.join(CLONE, QUEST_FILE)),
      );
      const expectedPath = `m_goals[${GOAL_INDEX}].${GOAL_FIELD}`;
      const expectedDialogPath =
        `m_dialogList.m_dialogs[${DIALOG_GROUP}]` +
        `.m_dialogEntries[${DIALOG_ENTRY}].${DIALOG_FIELD}`;
      expect(leafChangesQuest.map((change) => `${change.kind}:${change.path}`).sort()).toEqual(
        [`changed:${expectedPath}`, `changed:${expectedDialogPath}`].sort(),
      );
      const byPath = new Map(leafChangesQuest.map((change) => [change.path, change]));
      expect(byPath.get(expectedPath)).toMatchObject({
        before: GOAL_BEFORE,
        after: GOAL_AFTER,
      });
      expect(byPath.get(expectedDialogPath)).toMatchObject({
        before: DIALOG_BEFORE,
        after: DIALOG_AFTER,
      });

      /* ---------------------------------------- the raw git diff, classified line by line */
      const diff = git(['diff', base, 'HEAD', '--', DIFF_QUEST_PATH]);
      expect(diff).toContain(`-${' '.repeat(6)}"${GOAL_FIELD}": ${GOAL_BEFORE},`);
      const { removed, added } = diffLines(diff);
      // D49(c)'s formatting-only rewrite, measured again on this file: 8 trailing commas, 11
      // interior blank lines, 161 integral floats and the missing final newline. Every one of the
      // removed lines must reappear once normalized except the two that carry the edited values.
      const trailingCommas = (beforeText.match(/,\s*[}\]]/g) ?? []).length;
      expect(trailingCommas).toBe(8);
      const blankRemoved = removed.filter((line) => line.trim() === '');
      const removedExplained = unexplained(
        removed.filter((line) => line.trim() !== ''),
        added,
      );
      const addedExplained = unexplained(added, removed);
      expect(removedExplained).toHaveLength(2);
      expect(addedExplained).toHaveLength(2);
      expect(removedExplained.join('\n')).toContain(`${GOAL_FIELD}": ${GOAL_BEFORE}`);
      expect(removedExplained.join('\n')).toContain(`${DIALOG_FIELD}": ${DIALOG_BEFORE}`);
      expect(addedExplained.join('\n')).toContain(`${GOAL_FIELD}": ${GOAL_AFTER}`);
      expect(addedExplained.join('\n')).toContain(`${DIALOG_FIELD}": ${DIALOG_AFTER}`);
      // The blank lines are the one normalization with no counterpart on the other side.
      expect(blankRemoved.length).toBe(11);
      expect(removed.length).toBeGreaterThan(trailingCommas + blankRemoved.length);

      /* ------------------------------------------- the metadata: only the two stamps moved */
      const afterMeta = readSpiraldbJson(path.join(CLONE, META_FILE)) as Record<string, unknown>;
      expect(
        leafChanges(beforeMeta, afterMeta)
          .map((change) => change.path)
          .sort(),
      ).toEqual(['ModifiedAt', 'ModifiedBy']);
      expect(afterMeta.ModifiedBy).toBe('P3-10 AC1 Tester');
      expect(afterMeta.ModifiedAt).not.toBe(beforeMeta.ModifiedAt);
      // The pairing fields are untouched: the save did not re-key the metadata.
      expect(afterMeta.Name).toBe(QUEST_NAME);
      expect(afterMeta.QuestTemplateId).toBe(beforeMeta.QuestTemplateId);

      /* ------------------------------------ the verification status did not move (AC4) */
      const entry = getStatusEntry(db, 'quest', QUEST_NAME);
      expect(entry?.status).toBe('verified');
      const historyAfter = getStatusHistory(db, 'quest', QUEST_NAME);
      expect(historyBefore.found).toBe(true);
      expect(historyAfter.found).toBe(true);
      if (historyAfter.found) {
        expect(historyAfter.history).toHaveLength(0);
      }
    } finally {
      db.close();
      restoreClone();
      restorePoint = null;
    }

    /* --------------------------------------------------------- the clone is pristine again */
    expect(git(['status', '--porcelain']).trim()).toBe('');
    expect(git(['rev-parse', 'HEAD']).trim()).toBe(base);
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe(branch);
  });
});
