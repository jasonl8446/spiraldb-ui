import fs from 'node:fs';
import path from 'node:path';

import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

import { MEMORY_DB, openDb, readSettings, writeSettings, type Db } from '@server/db';
import { createQuestsRouter } from '@server/routes/quests';
import { insertSuggestions } from '@server/services/drafts';
import { createGitService, resolveScaffoldBranch, type GitClient } from '@server/services/git';
import { scaffoldQuest } from '@server/services/questScaffold';
import { saveQuest } from '@server/services/quests';
import { createSavePipeline, UncommittedSaveError } from '@server/services/savePipeline';
import { createSpiraldbIndex } from '@server/services/spiraldbIndex';
import { buildQuestScaffold } from '@shared/quest/scaffold';

import {
  commitCount,
  createTempGitRepo,
  removeTempGitRepo,
  type TempRepo,
} from '../helpers/temp-git-repo';

/**
 * Final gate 2/3 (Phase 7), round 1 fix work — the save path's write-safety findings, each driven
 * through the real modules against a throwaway `git init` repository (D17: never the owner fork
 * or the clone). The reviewer's reproductions are the basis of each arm:
 *
 * - **M1** a second `POST /api/quests/scaffold` of a quest authored since its first scaffold (no
 *   sync in between, so `has_definition` is still 0) must be refused `409`, not overwrite it;
 * - **M2** two concurrent scaffolds must make two commits, each holding exactly its own two files,
 *   both answering a real sha (D13);
 * - **m1** a detached HEAD refuses the save (the D119 stranding), on the shared guard;
 * - **m2** a decision failure after the commit answers success with a warning naming the ids left
 *   undecided, and a naming save keeps the catalog row it created.
 */

const repos: TempRepo[] = [];

afterAll(() => {
  for (const repo of repos.splice(0)) {
    removeTempGitRepo(repo);
  }
});

const USER = 'Round1 Tester';

function questFile(name: string): string {
  return `QuestTemplates/questtemplates_${name}.json`;
}

function metadataFile(name: string): string {
  return `QuestMetadatas/questmetadata_${name}.json`;
}

function harness(
  names: string[],
  branchSetting = 'main',
): { repo: TempRepo; db: Db; app: express.Express } {
  const repo = createTempGitRepo('round1-');
  repos.push(repo);
  const db = openDb({ file: MEMORY_DB });
  writeSettings(db, { user_name: USER, spiraldb_path: repo.dir, git_branch: branchSetting });
  for (const name of names) {
    db.prepare(
      `INSERT INTO quests (quest_name, title, has_definition, link_kind, title_source)
       VALUES (?, ?, 0, 'none', 'none')`,
    ).run(name, name);
  }
  const app = express();
  app.use(express.json());
  app.use('/api/quests', createQuestsRouter({ db }));
  return { repo, db, app };
}

/** The D118 skeleton with a level — a document both save routes accept. */
function skeleton(name: string, level: number): Record<string, unknown> {
  return { ...buildQuestScaffold({ name, link: { kind: 'none' } }), m_questLevel: level };
}

function readQuest(repo: TempRepo, name: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(repo.dir, questFile(name)), 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('M1 — a scaffold never overwrites a quest file the catalog does not know about yet', () => {
  it('refuses a second scaffold of a quest authored since its first one (409, file unchanged)', async () => {
    const name = 'FX-REVIEW-001';
    const { repo, app } = harness([name]);

    const first = await request(app).post('/api/quests/scaffold').send({ quest_name: name });
    expect(first.status).toBe(200);
    expect(first.body.outcome).toBe('created');

    const authored = { ...first.body.quest, m_questLevel: 42 };
    const save = await request(app).post('/api/quests').send({ quest: authored });
    expect(save.status).toBe(200);
    const commits = commitCount(repo);

    const second = await request(app).post('/api/quests/scaffold').send({ quest_name: name });
    expect(second.status, JSON.stringify(second.body)).toBe(409);
    expect(second.body.error).toMatch(/already has a definition/);
    expect(readQuest(repo, name).m_questLevel).toBe(42);
    expect(commitCount(repo)).toBe(commits);
  });

  it('refuses a draft save POSTed to /scaffold with a document once the file exists', async () => {
    const name = 'FX-REVIEW-002';
    const { repo, app } = harness([name]);
    const first = await request(app).post('/api/quests/scaffold').send({ quest_name: name });
    expect(first.status).toBe(200);
    const commits = commitCount(repo);

    const retry = await request(app)
      .post('/api/quests/scaffold')
      .send({ quest_name: name, quest: { ...first.body.quest, m_questLevel: 9 } });
    expect(retry.status).toBe(409);
    expect(retry.body.error).toMatch(/already has a definition/);
    expect(readQuest(repo, name).m_questLevel).not.toBe(9);
    expect(commitCount(repo)).toBe(commits);
  });

  it('refuses the loser of two concurrent scaffolds of one name under the lock (one commit)', async () => {
    const name = 'FX-REVIEW-003';
    const { repo, app } = harness([name]);
    const commits = commitCount(repo);

    const answers = await Promise.all([
      request(app).post('/api/quests/scaffold').send({ quest_name: name }),
      request(app).post('/api/quests/scaffold').send({ quest_name: name }),
    ]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
    expect(commitCount(repo)).toBe(commits + 1);
    expect(repo.git(['status', '--porcelain'])).toBe('');
  });
});

describe('M2 — concurrent saves are serialised, and each commit holds only its own paths', () => {
  it('two concurrent scaffolds make two commits with exactly their own two files and real shas', async () => {
    const names = ['FX-C-001', 'FX-C-002'];
    const { repo, app } = harness(names);
    const before = commitCount(repo);

    const [a, b] = await Promise.all(
      names.map((name) => request(app).post('/api/quests/scaffold').send({ quest_name: name })),
    );

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(commitCount(repo)).toBe(before + 2);
    for (const [answer, name] of [
      [a, names[0]],
      [b, names[1]],
    ] as const) {
      expect(answer.body.commit, `${name}'s sha`).toMatch(/^[0-9a-f]{40}$/);
      const files = repo
        .git(['show', '--name-only', '--format=', answer.body.commit as string])
        .split('\n')
        .filter((line) => line !== '')
        .sort();
      expect(files, `the files of ${name}'s commit`).toEqual(
        [metadataFile(name), questFile(name)].sort(),
      );
      expect(repo.git(['log', '-1', '--format=%s', answer.body.commit as string]).trim()).toBe(
        `spiraldb: create quest ${name}`,
      );
    }
    expect(a.body.commit).not.toBe(b.body.commit);
    expect(repo.git(['status', '--porcelain'])).toBe('');
  });

  it('commits only its own paths even when something else is staged', async () => {
    const name = 'FX-C-003';
    const { repo, db } = harness([name]);
    const index = createSpiraldbIndex(repo.dir);
    index.rebuild();
    const real = createGitService({
      repoPath: repo.dir,
      settingsBranch: () => readSettings(db).git_branch,
    });
    // A stranger's file staged between this save's guard and its commit — the concurrent shape.
    const pipeline = createSavePipeline({
      db,
      spiraldbPath: repo.dir,
      index,
      git: {
        ...real,
        commitObject: async (options) => {
          fs.writeFileSync(path.join(repo.dir, 'stranger.txt'), 'x\n');
          repo.git(['add', 'stranger.txt']);
          return real.commitObject(options);
        },
      },
    });
    const result = await scaffoldQuest({ db, index, pipeline, name });
    const files = repo
      .git(['show', '--name-only', '--format=', result.commit])
      .split('\n')
      .filter((line) => line !== '')
      .sort();
    expect(files).toEqual([metadataFile(name), questFile(name)].sort());
    expect(repo.git(['status', '--porcelain']).trim()).toBe('A  stranger.txt');
  });

  it('treats an empty commit sha as a failed commit, never a success', async () => {
    const name = 'FX-C-004';
    const { repo, db } = harness([name]);
    const index = createSpiraldbIndex(repo.dir);
    index.rebuild();
    const real = createGitService({ repoPath: repo.dir });
    const emptySha: GitClient = {
      env: () => undefined,
      raw: async () => '',
      branchLocal: async () => ({ all: ['main'], current: 'main' }),
      checkout: async () => undefined,
      checkoutBranch: async () => undefined,
      add: async () => undefined,
      commit: async () => ({ commit: '', branch: '' }),
    };
    const fake = createGitService({ repoPath: repo.dir, client: emptySha });
    const pipeline = createSavePipeline({
      db,
      spiraldbPath: repo.dir,
      index,
      git: { ...real, commitObject: (options) => fake.commitObject(options) },
    });
    await expect(scaffoldQuest({ db, index, pipeline, name })).rejects.toBeInstanceOf(
      UncommittedSaveError,
    );
  });
});

describe('m1 — a detached HEAD refuses the save', () => {
  it('answers 409 and leaves HEAD, the branches and git_branch alone', async () => {
    const name = 'FX-D-001';
    const { repo, db, app } = harness([name], '');
    repo.git(['checkout', '--detach']);
    const head = repo.git(['rev-parse', 'HEAD']).trim();

    const answer = await request(app).post('/api/quests/scaffold').send({ quest_name: name });
    expect(answer.status, JSON.stringify(answer.body)).toBe(409);
    expect(answer.body.error).toMatch(/detached HEAD/);
    expect(repo.git(['rev-parse', 'HEAD']).trim()).toBe(head);
    expect(repo.git(['status', '--porcelain'])).toBe('');
    expect(readSettings(db).git_branch).toBe('');
  });

  it('is refused by the shared helper the scaffold CLI calls, before any other rule', () => {
    const decision = resolveScaffoldBranch({
      settingsBranch: '',
      currentBranch: 'HEAD',
      detached: true,
    });
    expect(decision.kind).toBe('refuse');
  });
});

describe('m2 — a decision failure after the commit is a warning, not a 400', () => {
  /** A pipeline whose git layer runs `during` while the save awaits its commit (the rebuild's slot). */
  function pipelineWith(repo: TempRepo, db: Db, during: () => void) {
    const index = createSpiraldbIndex(repo.dir);
    index.rebuild();
    const real = createGitService({
      repoPath: repo.dir,
      settingsBranch: () => readSettings(db).git_branch,
    });
    const pipeline = createSavePipeline({
      db,
      spiraldbPath: repo.dir,
      index,
      git: {
        ...real,
        commitObject: async (options) => {
          during();
          return real.commitObject(options);
        },
      },
    });
    return { index, pipeline };
  }

  function pendingSuggestion(db: Db, quest: string | null, catalogId: number | null): number {
    insertSuggestions(db, [
      {
        quest_name: quest,
        catalog_id: catalogId,
        path: 'm_questLevel',
        value: 7,
        source: 'capture-order',
        confidence: 1,
        evidence_ref: 'test',
      },
    ]);
    return (db.prepare('SELECT max(id) AS id FROM quest_suggestions').get() as { id: number }).id;
  }

  it('POST /api/quests: the commit stands and the warning names the id left undecided', async () => {
    const name = 'FX-M2-001';
    const { repo, db } = harness([name]);
    const id = pendingSuggestion(db, name, null);
    const { index, pipeline } = pipelineWith(repo, db, () => {
      db.prepare('DELETE FROM quest_suggestions WHERE id = ?').run(id);
    });
    const before = commitCount(repo);

    const result = await saveQuest({
      db,
      index,
      pipeline,
      body: { quest: skeleton(name, 7), accepted_suggestions: [id] },
    });
    expect(commitCount(repo)).toBe(before + 1);
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(result.accepted_suggestions).toEqual([]);
    expect(result.warnings.join('\n')).toContain(`suggestion ${id} was left undecided`);
  });

  it('a naming save keeps its catalog row and link when the decision fails after the commit', async () => {
    const name = 'FX-M2-NAMED-001';
    const catalogId = 129001;
    const { repo, db } = harness([]);
    db.prepare(
      `INSERT INTO quest_ids (quest_id, title_key, title, text_rows, matched_quest_name, link_kind)
       VALUES (?, NULL, 'Unnamed', 1, NULL, 'none')`,
    ).run(catalogId);
    const id = pendingSuggestion(db, null, catalogId);
    const { index, pipeline } = pipelineWith(repo, db, () => {
      db.prepare("UPDATE quest_suggestions SET status = 'rejected' WHERE id = ?").run(id);
    });

    const result = await scaffoldQuest({
      db,
      index,
      pipeline,
      name,
      catalogId,
      quest: skeleton(name, 7),
      acceptedSuggestions: [id],
    });
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(result.named).toBe(true);
    expect(result.accepted_suggestions).toEqual([]);
    expect(result.warnings.join('\n')).toContain(`suggestion ${id} was left undecided`);
    expect(db.prepare('SELECT 1 FROM quests WHERE quest_name = ?').get(name)).toBeDefined();
    expect(
      db.prepare('SELECT matched_quest_name FROM quest_ids WHERE quest_id = ?').get(catalogId),
    ).toEqual({ matched_quest_name: name });
  });
});
