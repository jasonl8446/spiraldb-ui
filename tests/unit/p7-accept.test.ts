import fs from 'node:fs';
import path from 'node:path';

import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

import { MEMORY_DB, openDb, writeSettings, type Db } from '@server/db';
import { createQuestsRouter } from '@server/routes/quests';
import {
  acceptSuggestions,
  insertSuggestions,
  parseAcceptedSuggestions,
  SuggestionDecisionError,
} from '@server/services/drafts';
import { serializeDoc } from '@shared/document';
import { buildQuestScaffold, QUEST_TEMPLATE_CORPUS_ORDER } from '@shared/quest/scaffold';

import {
  commitCount,
  createTempGitRepo,
  removeTempGitRepo,
  repoFileExists,
  writeRepoFile,
  type TempRepo,
} from '../helpers/temp-git-repo';

/**
 * Story **p7-08** (task 7.7) — accepting suggestions through the two save routes (D141) and
 * naming an unnamed draft through the scaffold route (D142/D137).
 *
 * Every write lands in a throwaway `git init` repository under `data/__test-scratch__/` (D17: never
 * the owner fork; the D17 clone is the tier-1 specs' corpus). The routes are the real ones, mounted
 * on an in-memory database, so each case exercises the pipeline's real file + metadata + commit.
 *
 * The contract under test, from docs/spec-api.md "Accepting" and "Saving a draft":
 *
 * - `accepted_suggestions` is validated **before any write** (400, nothing written);
 * - the ids flip to `accepted` **only after the commit** — a save that fails leaves them pending;
 * - a draft save with `quest` writes that document (the skeleton plus accepted fields) in the
 *   scaffold's single commit;
 * - naming an unnamed id creates exactly one `quests` row and one file, links the id and names its
 *   suggestions, and a duplicate (409) or path-escaping (400) name writes nothing.
 */

const repos: TempRepo[] = [];

afterAll(() => {
  for (const repo of repos.splice(0)) {
    removeTempGitRepo(repo);
  }
});

const QUEST = 'FX-ACCEPT-C01-001';
const MISSING = 'FX-ACCEPT-C01-002';
const UNNAMED_ID = 128004;
const TITLE_KEY = 'QuestTitle_1F404';

function questFile(name: string): string {
  return `QuestTemplates/questtemplates_${name}.json`;
}

/**
 * A repository holding one quest file ({@link QUEST}, the D118 skeleton with no title) and a
 * catalog with that quest, one missing named quest and one unnamed id, each carrying suggestions.
 */
function harness(): { app: express.Express; db: Db; repo: TempRepo; ids: Record<string, number> } {
  const repo = createTempGitRepo('p7-08-accept-');
  repos.push(repo);
  writeRepoFile(
    repo,
    questFile(QUEST),
    // Byte-for-byte what the pipeline itself writes (`stringifySpiraldbJson` → `serializeDoc`).
    serializeDoc(buildQuestScaffold({ name: QUEST, link: { kind: 'none' } })),
  );
  repo.git(['add', '-A']);
  repo.git(['commit', '-m', 'seed quest']);

  const db = openDb({ file: MEMORY_DB });
  writeSettings(db, { user_name: 'P7-08 Tester', spiraldb_path: repo.dir, git_branch: 'main' });
  db.prepare(
    `INSERT INTO quests (quest_name, title, has_definition, link_kind, title_source)
     VALUES (?, ?, 1, 'none', 'none'), (?, ?, 0, 'none', 'none')`,
  ).run(QUEST, QUEST, MISSING, MISSING);
  db.prepare(
    `INSERT INTO quest_ids (quest_id, title_key, title, text_rows, matched_quest_name, link_kind)
     VALUES (?, ?, 'The Lost Lantern', 3, NULL, 'none')`,
  ).run(UNNAMED_ID, TITLE_KEY);
  insertSuggestions(db, [
    suggestion(QUEST, null, 'm_questTitle', 'QuestTitle_1ED8D', 'evidence-title'),
    suggestion(QUEST, null, 'm_questLevel', 7, 'capture-order'),
    suggestion(MISSING, null, 'm_questTitle', 'QuestTitle_2ED8D', 'evidence-title'),
    suggestion(null, UNNAMED_ID, 'm_questTitle', TITLE_KEY, 'evidence-title'),
  ]);
  const ids: Record<string, number> = {};
  for (const row of db
    .prepare<[], { id: number; quest_name: string | null; path: string }>(
      'SELECT id, quest_name, path FROM quest_suggestions',
    )
    .all()) {
    ids[`${row.quest_name ?? UNNAMED_ID}:${row.path}`] = row.id;
  }

  const app = express();
  app.use(express.json());
  app.use('/api/quests', createQuestsRouter({ db }));
  return { app, db, repo, ids };
}

function suggestion(
  quest_name: string | null,
  catalog_id: number | null,
  path: string,
  value: unknown,
  source: 'evidence-title' | 'capture-order',
) {
  return { quest_name, catalog_id, path, value, source, confidence: 1, evidence_ref: 'test' };
}

function statusOf(db: Db, id: number): string {
  return (
    db
      .prepare<[number], { status: string }>('SELECT status FROM quest_suggestions WHERE id = ?')
      .get(id) as { status: string }
  ).status;
}

/** The `+`/`-` body lines of the last commit's diff of one file (headers excluded). */
function changedLines(repo: TempRepo, file: string): string[] {
  return repo
    .git(['show', '--format=', '--unified=0', 'HEAD', '--', file])
    .split('\n')
    .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line));
}

function readQuest(repo: TempRepo, name: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(repo.dir, questFile(name)), 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('p7-08 — accepted_suggestions parsing (D141)', () => {
  it('reads absent/null as none, de-duplicates, and refuses anything but positive integer ids', () => {
    expect(parseAcceptedSuggestions(undefined)).toEqual([]);
    expect(parseAcceptedSuggestions(null)).toEqual([]);
    expect(parseAcceptedSuggestions([3, 1, 3])).toEqual([3, 1]);
    for (const bad of ['1', [1, '2'], [0], [-1], [1.5], {}, [null]]) {
      expect(() => parseAcceptedSuggestions(bad), JSON.stringify(bad)).toThrow(
        SuggestionDecisionError,
      );
    }
  });
});

describe('p7-08 — POST /api/quests with accepted_suggestions (D141)', () => {
  it('writes exactly the accepted field and flips its id only after the commit', async () => {
    const { app, db, repo, ids } = harness();
    const titleId = ids[`${QUEST}:m_questTitle`] as number;
    const levelId = ids[`${QUEST}:m_questLevel`] as number;
    const before = commitCount(repo);

    const quest = { ...readQuest(repo, QUEST), m_questTitle: 'QuestTitle_1ED8D' };
    const response = await request(app)
      .post('/api/quests')
      .send({ quest, accepted_suggestions: [titleId] });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.accepted_suggestions).toEqual([titleId]);
    expect(commitCount(repo)).toBe(before + 1);
    // The template's diff is exactly the one field (the metadata file is the pipeline's own).
    expect(changedLines(repo, questFile(QUEST))).toEqual([
      '-  "m_questTitle": null,',
      '+  "m_questTitle": "QuestTitle_1ED8D",',
    ]);
    expect(statusOf(db, titleId)).toBe('accepted');
    // The id the save did not carry is untouched.
    expect(statusOf(db, levelId)).toBe('pending');
  });

  it('refuses an unknown, decided or foreign id with a 400 before writing anything', async () => {
    const { app, db, repo, ids } = harness();
    const titleId = ids[`${QUEST}:m_questTitle`] as number;
    const foreignId = ids[`${MISSING}:m_questTitle`] as number;
    const quest = { ...readQuest(repo, QUEST), m_questTitle: 'QuestTitle_1ED8D' };
    const head = repo.git(['rev-parse', 'HEAD']);

    // Decided: reject one first.
    const levelId = ids[`${QUEST}:m_questLevel`] as number;
    db.prepare("UPDATE quest_suggestions SET status = 'rejected' WHERE id = ?").run(levelId);

    for (const bad of [999_999, levelId, foreignId]) {
      const response = await request(app)
        .post('/api/quests')
        .send({ quest, accepted_suggestions: [titleId, bad] });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe(
        `Suggestion ${bad} is not a pending suggestion of this quest`,
      );
    }
    const malformed = await request(app)
      .post('/api/quests')
      .send({ quest, accepted_suggestions: 'all' });
    expect(malformed.status).toBe(400);

    expect(repo.git(['rev-parse', 'HEAD'])).toBe(head);
    expect(repo.git(['status', '--porcelain'])).toBe('');
    expect(statusOf(db, titleId)).toBe('pending');
    expect(statusOf(db, foreignId)).toBe('pending');
  });

  it('leaves every id pending when the commit fails', async () => {
    const { app, db, repo, ids } = harness();
    const titleId = ids[`${QUEST}:m_questTitle`] as number;
    const head = repo.git(['rev-parse', 'HEAD']);
    // A real commit failure: git's own pre-commit hook refuses, after the file was written.
    const hook = path.join(repo.dir, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hook, '#!/bin/sh\necho "p7-08: commit refused by hook" >&2\nexit 1\n', {
      mode: 0o755,
    });

    const quest = { ...readQuest(repo, QUEST), m_questTitle: 'QuestTitle_1ED8D' };
    const response = await request(app)
      .post('/api/quests')
      .send({ quest, accepted_suggestions: [titleId] });

    expect(response.status).toBe(500);
    expect(repo.git(['rev-parse', 'HEAD'])).toBe(head);
    expect(statusOf(db, titleId)).toBe('pending');
  });
});

describe('p7-08 — POST /api/quests/scaffold with a draft document (D142)', () => {
  it('writes the skeleton plus the accepted field in the scaffold commit, then flips the id', async () => {
    const { app, db, repo, ids } = harness();
    const titleId = ids[`${MISSING}:m_questTitle`] as number;

    const skeleton = await request(app).get(`/api/quests/${MISSING}/scaffold`);
    expect(skeleton.status).toBe(200);
    expect(Object.keys(skeleton.body.quest)).toEqual([...QUEST_TEMPLATE_CORPUS_ORDER]);
    const quest = { ...skeleton.body.quest, m_questTitle: 'QuestTitle_2ED8D' };

    const response = await request(app)
      .post('/api/quests/scaffold')
      .send({ quest_name: MISSING, quest, accepted_suggestions: [titleId] });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({
      quest_name: MISSING,
      named: false,
      accepted_suggestions: [titleId],
    });
    expect(repo.git(['show', '--format=%s', '--name-only', 'HEAD']).trim().split('\n')).toEqual([
      `spiraldb: create quest ${MISSING}`,
      '',
      `QuestMetadatas/questmetadata_${MISSING}.json`,
      questFile(MISSING),
    ]);
    // The new file is the D118 skeleton with exactly that one field changed.
    const written = readQuest(repo, MISSING);
    const bare = buildQuestScaffold({ name: MISSING, link: { kind: 'none' } });
    expect(Object.keys(written)).toEqual([...QUEST_TEMPLATE_CORPUS_ORDER]);
    expect(written).toEqual({ ...bare, m_questTitle: 'QuestTitle_2ED8D' });
    expect(statusOf(db, titleId)).toBe('accepted');
  });

  it('refuses a document whose m_questName is not the save name, writing nothing', async () => {
    const { app, db, repo, ids } = harness();
    const titleId = ids[`${MISSING}:m_questTitle`] as number;
    const quest = buildQuestScaffold({ name: 'SOMETHING-ELSE', link: { kind: 'none' } });
    const response = await request(app)
      .post('/api/quests/scaffold')
      .send({ quest_name: MISSING, quest, accepted_suggestions: [titleId] });
    expect(response.status).toBe(400);
    expect(repoFileExists(repo, questFile(MISSING))).toBe(false);
    expect(statusOf(db, titleId)).toBe('pending');
  });

  it('answers the unwritten skeleton read with 404 for an unknown name and 409 for a defined one', async () => {
    const { app } = harness();
    expect((await request(app).get('/api/quests/NOPE-001/scaffold')).status).toBe(404);
    expect((await request(app).get(`/api/quests/${QUEST}/scaffold`)).status).toBe(409);
  });
});

describe('p7-08 — naming an unnamed draft (D137/D142)', () => {
  const NEW_NAME = 'FX-LANTERN-C01-001';

  function unnamedDocument(name: string): Record<string, unknown> {
    return { ...buildQuestScaffold({ name, link: { kind: 'none' } }), m_questTitle: TITLE_KEY };
  }

  it('creates exactly one catalog row and one file, links the id and names its suggestions', async () => {
    const { app, db, repo, ids } = harness();
    const titleId = ids[`${UNNAMED_ID}:m_questTitle`] as number;
    const questsBefore = (db.prepare('SELECT count(*) AS c FROM quests').get() as { c: number }).c;
    const before = commitCount(repo);

    const response = await request(app)
      .post('/api/quests/scaffold')
      .send({
        quest_name: NEW_NAME,
        catalog_id: UNNAMED_ID,
        quest: unnamedDocument(NEW_NAME),
        accepted_suggestions: [titleId],
      });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({
      quest_name: NEW_NAME,
      catalog_id: UNNAMED_ID,
      named: true,
      accepted_suggestions: [titleId],
    });

    expect(commitCount(repo)).toBe(before + 1);
    expect(repoFileExists(repo, questFile(NEW_NAME))).toBe(true);
    expect((db.prepare('SELECT count(*) AS c FROM quests').get() as { c: number }).c).toBe(
      questsBefore + 1,
    );
    expect(
      db
        .prepare(
          'SELECT title, has_definition, link_kind, title_source FROM quests WHERE quest_name = ?',
        )
        .get(NEW_NAME),
    ).toEqual({
      title: 'The Lost Lantern',
      has_definition: 1,
      link_kind: 'direct',
      title_source: 'direct',
    });
    expect(
      db
        .prepare('SELECT matched_quest_name, link_kind FROM quest_ids WHERE quest_id = ?')
        .get(UNNAMED_ID),
    ).toEqual({ matched_quest_name: NEW_NAME, link_kind: 'direct' });
    expect(
      db.prepare('SELECT quest_name, status FROM quest_suggestions WHERE id = ?').get(titleId),
    ).toEqual({ quest_name: NEW_NAME, status: 'accepted' });
  });

  it('refuses a duplicate name (409) and a path-escaping one (400), writing nothing', async () => {
    const { app, db, repo, ids } = harness();
    const titleId = ids[`${UNNAMED_ID}:m_questTitle`] as number;
    const snapshot = (): unknown => ({
      head: repo.git(['rev-parse', 'HEAD']),
      porcelain: repo.git(['status', '--porcelain']),
      quests: db.prepare('SELECT count(*) AS c FROM quests').get(),
      link: db
        .prepare('SELECT matched_quest_name FROM quest_ids WHERE quest_id = ?')
        .get(UNNAMED_ID),
      suggestion: db
        .prepare('SELECT quest_name, status FROM quest_suggestions WHERE id = ?')
        .get(titleId),
    });
    const before = snapshot();

    // A catalog name, and a name only a corpus file carries (no catalog row) — both taken.
    writeRepoFile(repo, questFile('FX-ORPHAN-C01-001'), '{ "m_questName": "FX-ORPHAN-C01-001" }\n');
    repo.git(['add', '-A']);
    repo.git(['commit', '-m', 'orphan file']);
    const afterOrphan = snapshot();
    for (const taken of [QUEST, 'FX-ORPHAN-C01-001']) {
      const response = await request(app)
        .post('/api/quests/scaffold')
        .send({
          quest_name: taken,
          catalog_id: UNNAMED_ID,
          quest: unnamedDocument(taken),
          accepted_suggestions: [titleId],
        });
      expect(response.status, taken).toBe(409);
      expect(response.body.error).toContain('is already a quest name');
    }
    expect(snapshot()).toEqual(afterOrphan);

    for (const hostile of ['x/../../evil', 'a/b', 'a\\b']) {
      const response = await request(app)
        .post('/api/quests/scaffold')
        .send({
          quest_name: hostile,
          catalog_id: UNNAMED_ID,
          quest: unnamedDocument(hostile),
          accepted_suggestions: [titleId],
        });
      expect(response.status, hostile).toBe(400);
    }
    expect(snapshot()).toEqual(afterOrphan);
    expect(fs.existsSync(path.join(repo.dir, 'evil.json'))).toBe(false);
    expect((before as { suggestion: unknown }).suggestion).toEqual({
      quest_name: null,
      status: 'pending',
    });
  });

  it('refuses an id already linked to another quest, and an unknown id', async () => {
    const { app, db } = harness();
    db.prepare(
      `INSERT INTO quest_ids (quest_id, title_key, title, text_rows, matched_quest_name, link_kind)
       VALUES (5, NULL, NULL, 0, ?, 'direct')`,
    ).run(QUEST);
    const linked = await request(app)
      .post('/api/quests/scaffold')
      .send({ quest_name: NEW_NAME, catalog_id: 5, quest: unnamedDocument(NEW_NAME) });
    expect(linked.status).toBe(400);
    const unknown = await request(app)
      .post('/api/quests/scaffold')
      .send({ quest_name: NEW_NAME, catalog_id: 6, quest: unnamedDocument(NEW_NAME) });
    expect(unknown.status).toBe(404);
  });
});

describe('p7-08 — acceptSuggestions inside an outer transaction', () => {
  it('rolls back with the outer transaction when a later statement fails', () => {
    const db = openDb({ file: MEMORY_DB });
    insertSuggestions(db, [
      suggestion('FX-A-C01-001', null, 'm_questTitle', 'k', 'evidence-title'),
    ]);
    const id = (db.prepare('SELECT id FROM quest_suggestions').get() as { id: number }).id;
    expect(() =>
      db.transaction(() => {
        acceptSuggestions(db, [id], { quest_name: 'FX-A-C01-001', catalog_id: null });
        throw new Error('later failure');
      })(),
    ).toThrow('later failure');
    expect(statusOf(db, id)).toBe('pending');
  });
});
