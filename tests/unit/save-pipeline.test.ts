import fs from 'node:fs';
import path from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import {
  formatLocalDate,
  MEMORY_DB,
  openDb,
  readSettings,
  writeSettings,
  type Db,
} from '@server/db';
import {
  createGitService,
  DirtyRepoError,
  sessionBranchName,
  type GitService,
} from '@server/services/git';
import {
  createSavePipeline,
  questMetadataSaveTarget,
  UncommittedSaveError,
  type SaveObjectRequest,
  type SavePipeline,
} from '@server/services/savePipeline';
import {
  readSpiraldbJson,
  SpiraldbFileError,
  stringifySpiraldbJson,
} from '@server/services/spiraldbFiles';
import { createSpiraldbIndex, type SpiraldbIndex } from '@server/services/spiraldbIndex';
import { getStatusEntry, getStatusHistory, readDashboard } from '@server/services/status';
import {
  commitCount,
  commitSubjects,
  createTempGitRepo,
  readRepoFile,
  removeTempGitRepo,
  repoFileExists,
  writeRepoFile,
  type TempRepo,
} from '../helpers/temp-git-repo';

/**
 * Story p2-05 acceptance for the save pipeline itself: Save All of N extracted
 * quests (N files, N metadata files, N commits, `settings.git_branch`), the
 * metadata pairing of D20, the D14 dirty guard, the status upsert + history of
 * D37, the ac5 update path (file updated in place, action `update`), and the D19
 * content-keyed resolution that makes an update land on the file's original path.
 *
 * The tests are hermetic: a throwaway `git init` repository under
 * `data/__test-scratch__/`, an in-memory database, and an injected clock. The real
 * corpus, the disposable clone and the owner's fork are never touched (D17).
 */

const NOW = '2026-09-26T12:00:00.000Z';
const USER = 'P2-05 Tester';
const OPEN_DBS: Db[] = [];
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
  for (const db of OPEN_DBS) {
    db.close();
  }
  for (const repo of REPOS) {
    removeTempGitRepo(repo);
  }
});

function memoryDb(): Db {
  const db = openDb({ file: MEMORY_DB });
  OPEN_DBS.push(db);
  return db;
}

function repo(prefix = 'save-'): TempRepo {
  const created = createTempGitRepo(prefix);
  REPOS.push(created);
  return created;
}

interface Harness {
  repo: TempRepo;
  db: Db;
  index: SpiraldbIndex;
  pipeline: SavePipeline;
  date: Date;
}

function harness(options: { user?: string; branch?: string } = {}): Harness {
  const target = repo();
  const db = memoryDb();
  writeSettings(db, {
    spiraldb_path: target.dir,
    user_name: options.user ?? USER,
    git_branch: options.branch ?? '',
  });

  const date = new Date(NOW);
  const index = createSpiraldbIndex(target.dir);
  index.rebuild();
  const pipeline = createSavePipeline({
    db,
    spiraldbPath: target.dir,
    index,
    now: () => new Date(NOW),
  });

  return { repo: target, db, index, pipeline, date };
}

/** A quest shaped like the corpus: explicit nulls, nested objects and an array. */
function questFixture(name: string, level = 5): Record<string, unknown> {
  return {
    m_questName: name,
    m_questTitle: 'QuestTitle_1',
    m_questLevel: level,
    m_questInfo: null,
    m_mainline: false,
    m_goals: [
      {
        $type: 'Imcodec.ObjectProperty.TypeCache.GoalCompilation, Imcodec.ObjectProperty',
        m_goalName: '1_Start',
        m_goalType: 'GOAL_TYPE_WAYPOINT',
        m_goalUnderway: null,
        m_hyperlink: null,
        m_clientTags: [],
        m_targets: [{ m_targetName: 'WC_Hub', m_zoneName: null }],
      },
    ],
    m_dialogList: {
      $type: 'Imcodec.ObjectProperty.TypeCache.ActorDialogList, Imcodec.ObjectProperty',
      m_dialogs: [],
    },
  };
}

/** The shape the CLI emits: the same object with every null-valued key dropped. */
function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripNulls);
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== null) {
        out[key] = stripNulls(entry);
      }
    }
    return out;
  }
  return value;
}

/** Metadata shaped like the corpus files: UUID-named, `Name`-paired, extra fields. */
function metadataFixture(name: string): Record<string, unknown> {
  return {
    QuestTemplateId: `questtemplates/${name}`,
    Name: name,
    Description: 'Quest imported from packet capture on 2025-10-17 20:37:23',
    CreatedAt: '2025-10-18T00:37:23.8805776Z',
    ModifiedAt: '2026-04-03T07:00:36.2653256Z',
    CreatedBy: 'jay',
    ModifiedBy: 'makima',
  };
}

function request(name: string, extra: Partial<SaveObjectRequest> = {}): SaveObjectRequest {
  return {
    fileType: 'questtemplates',
    data: questFixture(name),
    action: 'extract',
    status: 'extracted',
    historyNotes: 'Imported from packet capture session_2026-06-01.json',
    ...extra,
  };
}

describe('Save All of N extracted quests (ac1)', () => {
  it('writes N files, N metadata files and N commits on content/{today}', async () => {
    const h = harness();
    const names = ['DS-P205-A-001', 'DS-P205-A-002', 'DS-P205-A-003'];

    const results = await h.pipeline.saveAll(names.map((name) => request(name)));

    // --- One file per quest, named by the convention, holding clean JSON.
    for (const name of names) {
      const relative = `QuestTemplates/questtemplates_${name}.json`;
      expect(repoFileExists(h.repo, relative)).toBe(true);
      const text = readRepoFile(h.repo, relative);
      expect(JSON.parse(text)).toEqual(questFixture(name));
      expect(text).not.toMatch(/,\s*[}\]]/);
      expect(() => readSpiraldbJson(path.join(h.repo.dir, relative))).not.toThrow();
    }

    // --- One metadata file per quest, with exactly the seven spec keys.
    for (const name of names) {
      const relative = `QuestMetadatas/questmetadata_${name}.json`;
      expect(repoFileExists(h.repo, relative)).toBe(true);
      const metadata = JSON.parse(readRepoFile(h.repo, relative)) as Record<string, unknown>;
      expect(Object.keys(metadata)).toEqual([
        'QuestTemplateId',
        'Name',
        'Description',
        'CreatedAt',
        'ModifiedAt',
        'CreatedBy',
        'ModifiedBy',
      ]);
      expect(metadata).toEqual({
        QuestTemplateId: `questtemplates/${name}`,
        Name: name,
        Description: 'Quest extracted from packet capture.',
        CreatedAt: NOW,
        ModifiedAt: NOW,
        CreatedBy: USER,
        ModifiedBy: USER,
      });
    }

    // --- The results describe what happened.
    expect(results.map((result) => result.outcome)).toEqual(['created', 'created', 'created']);
    expect(results.map((result) => result.action)).toEqual(['extract', 'extract', 'extract']);
    expect(results.map((result) => result.metadataOutcome)).toEqual([
      'created',
      'created',
      'created',
    ]);
    expect(results.map((result) => result.relativePath)).toEqual(
      names.map((name) => `QuestTemplates/questtemplates_${name}.json`),
    );

    // --- N commits on the session branch, authored by settings.user_name.
    const branch = sessionBranchName(new Date(NOW));
    expect(branch).toBe(`content/${formatLocalDate(new Date(NOW))}`);
    expect(commitCount(h.repo)).toBe(4); // seed + three saves
    expect(commitSubjects(h.repo).slice(0, 3)).toEqual([
      'spiraldb: extract quest DS-P205-A-003',
      'spiraldb: extract quest DS-P205-A-002',
      'spiraldb: extract quest DS-P205-A-001',
    ]);
    expect(h.repo.git(['branch', '--show-current']).trim()).toBe(branch);
    expect(h.repo.git(['log', '--format=%an']).split('\n')[0]).toBe(USER);
    expect(results.map((result) => result.branch)).toEqual([branch, branch, branch]);
    expect(results.every((result) => /^[0-9a-f]{40}$/.test(result.commit))).toBe(true);

    // --- settings.git_branch was persisted (D42).
    expect(readSettings(h.db).git_branch).toBe(branch);

    // --- Each save committed both its object file and its metadata file (D13).
    expect(h.repo.git(['show', '--name-only', '--format=', 'HEAD']).trim().split('\n')).toEqual([
      `QuestMetadatas/questmetadata_${names[2]}.json`,
      `QuestTemplates/questtemplates_${names[2]}.json`,
    ]);

    // --- Nothing left behind.
    expect(h.repo.git(['status', '--porcelain']).trim()).toBe('');
  });

  it('records one extracted entry and one history row per quest (ac4)', async () => {
    const h = harness();
    const names = ['DS-P205-B-001', 'DS-P205-B-002'];
    const notes = 'Imported from packet capture fixture-WC-UNICORN-MAIN-004.json';

    await h.pipeline.saveAll(names.map((name) => request(name, { historyNotes: notes })));

    for (const name of names) {
      const entry = getStatusEntry(h.db, 'quest', name);
      expect(entry).toEqual({
        object_type: 'quest',
        object_key: name,
        status: 'extracted',
        extracted_at: NOW,
        reviewed_at: null,
        verified_at: null,
        latest_notes: notes,
      });

      const history = getStatusHistory(h.db, 'quest', name);
      expect(history).toEqual({
        found: true,
        history: [
          {
            old_status: null,
            new_status: 'extracted',
            notes,
            changed_by: USER,
            changed_at: NOW,
          },
        ],
      });
    }

    // The dashboard counts the additions (D37).
    const dashboard = readDashboard(h.db);
    expect(dashboard.types.quest).toEqual({
      total: 2,
      extracted: 2,
      reviewed: 0,
      verified: 0,
    });
    expect(dashboard.overall.total).toBe(2);
  });
});

describe('updating an existing quest (ac5, server half)', () => {
  it('updates the file in place, commits action update and confines the diff (D45(1))', async () => {
    const h = harness();
    const name = 'DS-P205-UPD-001';
    const LEGACY_PATH = 'QuestTemplates/legacy_quest_file.json';
    const META_PATH = 'QuestMetadatas/069f430e-b191-448c-94db-ab03da221c1e.json';
    const existing = questFixture(name);

    // A pre-existing file at an off-convention path (as the corpus has), plus its
    // UUID-named metadata file, committed so the tree is clean.
    writeRepoFile(h.repo, LEGACY_PATH, stringifySpiraldbJson(existing));
    writeRepoFile(h.repo, META_PATH, stringifySpiraldbJson(metadataFixture(name)));
    h.repo.git(['add', '--all']);
    h.repo.git(['commit', '-m', 'legacy corpus shape']);
    h.index.rebuild();

    // The caller sends what an editor would hold: the same object minus nulls, with
    // one deliberate change.
    const incoming = stripNulls(existing) as Record<string, unknown>;
    incoming.m_questLevel = 6;

    const result = await h.pipeline.saveObject({
      fileType: 'questtemplates',
      data: incoming,
      action: 'extract',
      status: 'extracted',
      historyNotes: 'Imported from packet capture session_2026-06-01.json',
    });

    expect(result.outcome).toBe('updated');
    expect(result.action).toBe('update');
    expect(result.filePath).toBe(path.join(h.repo.dir, LEGACY_PATH));
    expect(result.relativePath).toBe(LEGACY_PATH);
    expect(result.metadataOutcome).toBe('updated');
    expect(result.metadataPath).toBe(path.join(h.repo.dir, META_PATH));

    // The file was updated where it lives, not copied to the convention name.
    expect(repoFileExists(h.repo, LEGACY_PATH)).toBe(true);
    expect(repoFileExists(h.repo, `QuestTemplates/questtemplates_${name}.json`)).toBe(false);

    // Every explicit null survived; only the edited field moved.
    const after = readSpiraldbJson(path.join(h.repo.dir, LEGACY_PATH));
    expect(after).toEqual({ ...existing, m_questLevel: 6 });

    // The metadata file was refreshed in place — no second, name-derived file.
    const metadata = readSpiraldbJson(path.join(h.repo.dir, META_PATH)) as Record<string, unknown>;
    expect(metadata).toEqual({
      ...metadataFixture(name),
      ModifiedAt: NOW,
      ModifiedBy: USER,
    });
    const metadataDir = fs.readdirSync(path.join(h.repo.dir, 'QuestMetadatas'));
    expect(metadataDir).toEqual(['069f430e-b191-448c-94db-ab03da221c1e.json']);

    // The commit is one action `update`, holding the object and its metadata.
    expect(commitSubjects(h.repo)[0]).toBe(`spiraldb: update quest ${name}`);
    expect(h.repo.git(['show', '--name-only', '--format=', 'HEAD']).trim().split('\n')).toEqual([
      META_PATH,
      LEGACY_PATH,
    ]);
    expect(h.repo.git(['status', '--porcelain']).trim()).toBe('');

    // D45(1): the diff is exactly the edited line — every omitted null was restored,
    // so no unrequested whiteout appears in the owner's history.
    const diff = h.repo.git(['diff', '--unified=0', 'HEAD~1', 'HEAD', '--', LEGACY_PATH]);
    const added = diff
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'));
    const removed = diff
      .split('\n')
      .filter((line) => line.startsWith('-') && !line.startsWith('---'));
    expect(removed).toEqual(['-  "m_questLevel": 5,']);
    expect(added).toEqual(['+  "m_questLevel": 6,']);
  });

  it('normalises a legacy file to clean JSON on update without losing a field', async () => {
    const h = harness();
    const name = 'DS-P205-FMT-001';
    const LEGACY_PATH = 'QuestTemplates/legacy_trailing.json';
    const existing = questFixture(name);
    // A real corpus file: trailing commas, no trailing newline.
    const legacyText = `${JSON.stringify(existing, null, 2).replace(/\n}/g, ',\n}')}`;
    expect(legacyText.endsWith('\n')).toBe(false);
    writeRepoFile(h.repo, LEGACY_PATH, legacyText);
    writeRepoFile(
      h.repo,
      'QuestMetadatas/metadata.json',
      stringifySpiraldbJson(metadataFixture(name)),
    );
    h.repo.git(['add', '--all']);
    h.repo.git(['commit', '-m', 'legacy trailing commas']);
    h.index.rebuild();

    const incoming = stripNulls(existing) as Record<string, unknown>;
    incoming.m_questTitle = 'QuestTitle_2';
    const result = await h.pipeline.saveObject({
      fileType: 'questtemplates',
      data: incoming,
      action: 'extract',
    });

    const after = readRepoFile(h.repo, LEGACY_PATH);
    expect(result.outcome).toBe('updated');
    expect(after).toBe(stringifySpiraldbJson({ ...existing, m_questTitle: 'QuestTitle_2' }));
    expect(JSON.parse(after)).toEqual({ ...existing, m_questTitle: 'QuestTitle_2' });

    // No value disappeared: every top-level key of the original is still there.
    const parsed = JSON.parse(after) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(Object.keys(existing));
  });

  it('refuses to create over a file another key occupies', async () => {
    const h = harness();
    // The convention path for DS-P205-CLASH-001 holds a *different* quest.
    writeRepoFile(
      h.repo,
      'QuestTemplates/questtemplates_DS-P205-CLASH-001.json',
      stringifySpiraldbJson(questFixture('DS-OTHER')),
    );
    h.repo.git(['add', '--all']);
    h.repo.git(['commit', '-m', 'mismatched filename']);
    h.index.rebuild();

    await expect(h.pipeline.saveObject(request('DS-P205-CLASH-001'))).rejects.toThrow(
      /a different entry already occupies the naming convention's path/,
    );

    // Nothing was written or committed.
    expect(commitCount(h.repo)).toBe(2);
    expect(
      readSpiraldbJson(
        path.join(h.repo.dir, 'QuestTemplates/questtemplates_DS-P205-CLASH-001.json'),
      ),
    ).toEqual(questFixture('DS-OTHER'));
    expect(h.repo.git(['status', '--porcelain']).trim()).toBe('');
  });
});

describe('metadata pairing (D20)', () => {
  it('pairs a new quest with a fresh file and leaves unrelated metadata alone', async () => {
    const h = harness();
    // Metadata for a *different* quest exists; it must not be touched.
    writeRepoFile(
      h.repo,
      'QuestMetadatas/other-uuid.json',
      stringifySpiraldbJson(metadataFixture('DS-SOMEONE-ELSE')),
    );
    h.repo.git(['add', '--all']);
    h.repo.git(['commit', '-m', 'unrelated metadata']);
    h.index.rebuild();

    const result = await h.pipeline.saveObject(request('DS-P205-NEW-001'));

    expect(result.metadataOutcome).toBe('created');
    expect(result.metadataRelativePath).toBe('QuestMetadatas/questmetadata_DS-P205-NEW-001.json');
    expect(fs.readdirSync(path.join(h.repo.dir, 'QuestMetadatas')).sort()).toEqual([
      'other-uuid.json',
      'questmetadata_DS-P205-NEW-001.json',
    ]);
    expect(readSpiraldbJson(path.join(h.repo.dir, 'QuestMetadatas/other-uuid.json'))).toEqual(
      metadataFixture('DS-SOMEONE-ELSE'),
    );
  });
});

describe('the dirty-repo guard (ac3, D14)', () => {
  it('reports an actionable error and writes nothing at all', async () => {
    const h = harness();
    writeRepoFile(h.repo, 'README.md', 'seed\nlocal edits the owner has not committed\n');
    const before = h.repo.git(['status', '--porcelain']).trim();
    expect(before).toBe('M README.md');

    const error = await h.pipeline
      .saveObject(request('DS-P205-DIRTY-001'))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DirtyRepoError);
    expect((error as Error).message).toContain(
      'SpiralDB repo at ' + path.resolve(h.repo.dir) + ' has uncommitted changes',
    );
    expect((error as Error).message).toContain('resolve them first');

    // No file, no metadata, no commit, no branch, no status row.
    expect(repoFileExists(h.repo, 'QuestTemplates/questtemplates_DS-P205-DIRTY-001.json')).toBe(
      false,
    );
    expect(repoFileExists(h.repo, 'QuestMetadatas/questmetadata_DS-P205-DIRTY-001.json')).toBe(
      false,
    );
    expect(commitCount(h.repo)).toBe(1);
    expect(h.repo.git(['status', '--porcelain']).trim()).toBe(before);
    expect(h.repo.git(['branch', '--list', 'content/*']).trim()).toBe('');
    expect(getStatusEntry(h.db, 'quest', 'DS-P205-DIRTY-001')).toBeUndefined();
    // And the owner's edit is untouched — the pipeline never stashes (D14).
    expect(readRepoFile(h.repo, 'README.md')).toContain('local edits');
    expect(h.repo.git(['stash', 'list']).trim()).toBe('');
  });

  it('refuses every object of a Save All batch at the first dirty check', async () => {
    const h = harness();
    writeRepoFile(h.repo, 'README.md', 'seed\nedit\n');

    const results = await h.pipeline
      .saveAll([request('DS-P205-DIRTY-A'), request('DS-P205-DIRTY-B')])
      .catch((caught: unknown) => caught);

    expect(results).toBeInstanceOf(DirtyRepoError);
    expect(commitCount(h.repo)).toBe(1);
    expect(getStatusEntry(h.db, 'quest', 'DS-P205-DIRTY-A')).toBeUndefined();
    expect(h.repo.git(['branch', '--list', 'content/*']).trim()).toBe('');
  });
});

describe('verification status (ac4, D37)', () => {
  it('does not re-append history when the same status is saved again', async () => {
    const h = harness();
    await h.pipeline.saveObject(request('DS-P205-ST-001'));
    const entryBefore = getStatusEntry(h.db, 'quest', 'DS-P205-ST-001');

    const second = await h.pipeline.saveObject(
      request('DS-P205-ST-001', { historyNotes: 'second save' }),
    );

    expect(second.outcome).toBe('updated');
    expect(second.status?.status).toBe('extracted');
    const history = getStatusHistory(h.db, 'quest', 'DS-P205-ST-001');
    expect(history.found && history.history).toHaveLength(1);
    // The first milestone timestamp is never rewritten by a later save.
    expect(getStatusEntry(h.db, 'quest', 'DS-P205-ST-001')).toEqual(entryBefore);
  });

  it('appends a transition row when the caller requests a new status', async () => {
    const h = harness();
    await h.pipeline.saveObject(request('DS-P205-ST-002'));

    const result = await h.pipeline.saveObject({
      fileType: 'questtemplates',
      data: questFixture('DS-P205-ST-002'),
      key: 'DS-P205-ST-002',
      status: 'reviewed',
      historyNotes: 'checked the goals against the capture',
    });

    expect(result.status).toMatchObject({
      status: 'reviewed',
      reviewed_at: NOW,
      extracted_at: NOW,
    });
    const history = getStatusHistory(h.db, 'quest', 'DS-P205-ST-002');
    expect(history.found && history.history).toEqual([
      expect.objectContaining({ old_status: null, new_status: 'extracted' }),
      {
        old_status: 'extracted',
        new_status: 'reviewed',
        notes: 'checked the goals against the capture',
        changed_by: USER,
        changed_at: NOW,
      },
    ]);
  });

  it('never resets a verified entry when an editor saves without a status', async () => {
    const h = harness();
    await h.pipeline.saveObject(request('DS-P205-ST-003'));
    await h.pipeline.saveObject({
      fileType: 'questtemplates',
      data: questFixture('DS-P205-ST-003'),
      key: 'DS-P205-ST-003',
      status: 'verified',
    });

    const result = await h.pipeline.saveObject({
      fileType: 'questtemplates',
      data: { ...questFixture('DS-P205-ST-003'), m_questLevel: 9 },
      key: 'DS-P205-ST-003',
    });

    expect(result.outcome).toBe('updated');
    expect(result.status?.status).toBe('verified');
    const history = getStatusHistory(h.db, 'quest', 'DS-P205-ST-003');
    expect(history.found && history.history).toHaveLength(2);
  });

  it('applies a create-only note on the first save and drops it on an update (gap B)', async () => {
    const h = harness();
    const name = 'DS-P207-GAPB-001';

    const created = await h.pipeline.saveObject({
      fileType: 'questtemplates',
      data: questFixture(name),
      key: name,
      // The commit body is not the status note: on a create the create-only note wins.
      historyNotes: 'a commit body that must not become the history note',
      historyNotesOnCreate: 'Imported from packet capture session_1.json',
    });

    expect(created.outcome).toBe('created');
    let history = getStatusHistory(h.db, 'quest', name);
    expect(history.found && history.history).toEqual([
      expect.objectContaining({
        old_status: null,
        new_status: 'extracted',
        notes: 'Imported from packet capture session_1.json',
        changed_by: USER,
      }),
    ]);

    const updated = await h.pipeline.saveObject({
      fileType: 'questtemplates',
      data: questFixture(name, 7),
      key: name,
      historyNotesOnCreate: 'Imported from packet capture other.json',
    });

    expect(updated.outcome).toBe('updated');
    history = getStatusHistory(h.db, 'quest', name);
    expect(history.found && history.history).toHaveLength(1);
    expect(history.found && history.history[0]?.notes).toBe(
      'Imported from packet capture session_1.json',
    );
  });

  // The live defect: the corpus already holds the file, so the save is an update —
  // yet the entry is new to tracking, and the capture note belongs to the entry.
  it('applies the create-only note on a file update that first tracks the entry', async () => {
    const h = harness();
    const name = 'WC-UNICORN-MAIN-004';
    const EXISTING_PATH = 'QuestTemplates/questtemplates_existing_004.json';
    writeRepoFile(h.repo, EXISTING_PATH, stringifySpiraldbJson(questFixture(name)));
    h.repo.git(['add', '--all']);
    h.repo.git(['commit', '-m', 'corpus already holds this quest']);
    h.index.rebuild();

    const result = await h.pipeline.saveObject({
      fileType: 'questtemplates',
      data: questFixture(name, 7),
      key: name,
      historyNotesOnCreate: 'Imported from packet capture WC-UNICORN-MAIN-004.json',
    });

    expect(result.outcome).toBe('updated');
    expect(result.statusCreated).toBe(true);
    const history = getStatusHistory(h.db, 'quest', name);
    expect(history.found && history.history).toEqual([
      expect.objectContaining({
        old_status: null,
        new_status: 'extracted',
        notes: 'Imported from packet capture WC-UNICORN-MAIN-004.json',
        changed_by: USER,
      }),
    ]);
    // The file was updated where it lives, never copied to the convention name.
    expect(repoFileExists(h.repo, EXISTING_PATH)).toBe(true);
  });

  it('reports statusCreated false and writes nothing for an already-tracked entry', async () => {
    const h = harness();
    const name = 'DS-P207-GAPB-002';
    const first = await h.pipeline.saveObject({
      fileType: 'questtemplates',
      data: questFixture(name),
      key: name,
      historyNotesOnCreate: 'Imported from packet capture first.json',
    });
    expect(first.statusCreated).toBe(true);

    const second = await h.pipeline.saveObject({
      fileType: 'questtemplates',
      data: questFixture(name, 8),
      key: name,
      historyNotesOnCreate: 'Imported from packet capture second.json',
    });

    expect(second.outcome).toBe('updated');
    expect(second.statusCreated).toBe(false);
    expect(second.status?.status).toBe('extracted');
    const history = getStatusHistory(h.db, 'quest', name);
    expect(history.found && history.history).toEqual([
      expect.objectContaining({
        old_status: null,
        new_status: 'extracted',
        notes: 'Imported from packet capture first.json',
      }),
    ]);
  });

  it('records no status for a family with no lifecycle', async () => {
    const h = harness();
    const result = await h.pipeline.saveObject({
      fileType: 'globalregistry',
      data: { SomeFlag: 1.5 },
      action: 'create',
    });

    expect(result.status).toBeNull();
    expect(result.statusCreated).toBe(false);
    expect(readDashboard(h.db).overall.total).toBe(0);
  });
});

describe('the unkeyed GlobalRegistry family', () => {
  it('writes the single file and updates it in place on the next save', async () => {
    const h = harness();

    const created = await h.pipeline.saveObject({
      fileType: 'globalregistry',
      data: { SomeFlag: 1.5, OtherFlag: 2.5 },
      action: 'create',
    });

    expect(created.outcome).toBe('created');
    expect(created.key).toBe('globalregistry');
    expect(created.relativePath).toBe('GlobalRegistry/globalregistry.json');
    expect(readSpiraldbJson(path.join(h.repo.dir, 'GlobalRegistry/globalregistry.json'))).toEqual({
      SomeFlag: 1.5,
      OtherFlag: 2.5,
    });
    expect(commitSubjects(h.repo)[0]).toBe('spiraldb: create global_registry globalregistry');

    const updated = await h.pipeline.saveObject({
      fileType: 'globalregistry',
      data: { SomeFlag: 3.5 },
    });

    expect(updated.outcome).toBe('updated');
    expect(updated.action).toBe('update');
    expect(updated.relativePath).toBe('GlobalRegistry/globalregistry.json');
    // **Phase transition (story p4-07 / D22)**: the unkeyed family's document *is* the whole
    // dictionary, so a second save writes the posted object verbatim instead of merging it into
    // the file on disk. The D45(1) merge would resurrect a row the user removed — this
    // dictionary's "absent" is an absent **key**, not a null — and `OtherFlag` disappearing here
    // is exactly that rule exercised on the pipeline. The real editor always posts the whole
    // merged view, so nothing is lost by it; the previous expectation (`OtherFlag` kept) was the
    // p4-01 behaviour, before task 4.9 owned the family.
    expect(readSpiraldbJson(path.join(h.repo.dir, 'GlobalRegistry/globalregistry.json'))).toEqual({
      SomeFlag: 3.5,
    });
    expect(commitSubjects(h.repo)[0]).toBe('spiraldb: update global_registry globalregistry');
    expect(fs.readdirSync(path.join(h.repo.dir, 'GlobalRegistry'))).toEqual([
      'globalregistry.json',
    ]);
    expect(h.repo.git(['status', '--porcelain']).trim()).toBe('');
  });
});

/**
 * `removePaths` — the mechanism story p4-07 (task 4.9, D22) added to the pipeline for
 * consolidate-and-replace. Tested **here**, on the pipeline, so the mechanism is pinned
 * separately from the `GlobalRegistry/` policy that computes the list (that policy is
 * `tests/unit/objects-api.test.ts`'s).
 *
 * The failure modes the AC names live here: the deletion and the write are **one commit**, and a
 * deletion is never committed without the file that replaces it.
 */
describe('removePaths: one commit replaces files', () => {
  it('writes the new file and deletes the replaced one in a single commit', async () => {
    const h = harness();
    const directory = path.join(h.repo.dir, 'GlobalRegistry');
    writeRepoFile(h.repo, 'GlobalRegistry/GlobalRegistryModels_1-A.json', '{"Old": 1}\n');
    h.repo.git(['add', '--all']);
    h.repo.git(['commit', '-m', 'the legacy registry file']);
    const commitsBefore = commitCount(h.repo);

    const result = await h.pipeline.saveObject({
      fileType: 'globalregistry',
      data: { GlobalRegistryValues: { Old: 1, New: 2 } },
      removePaths: [path.join(directory, 'GlobalRegistryModels_1-A.json')],
    });

    // One commit — not two — and it is an `update`, because the entry existed in the file the
    // same commit deletes.
    expect(commitCount(h.repo)).toBe(commitsBefore + 1);
    expect(result.action).toBe('update');
    expect(result.commitMessage).toBe('spiraldb: update global_registry globalregistry');
    expect(repoFileExists(h.repo, 'GlobalRegistry/globalregistry.json')).toBe(true);
    expect(repoFileExists(h.repo, 'GlobalRegistry/GlobalRegistryModels_1-A.json')).toBe(false);

    const stat = h.repo.git(['show', '--stat', '--format=', 'HEAD']);
    expect(stat).toContain('GlobalRegistry/globalregistry.json');
    expect(stat).toContain('GlobalRegistry/GlobalRegistryModels_1-A.json');
    expect(fs.readdirSync(directory)).toEqual(['globalregistry.json']);
    expect(h.repo.git(['status', '--porcelain']).trim()).toBe('');
  });

  it('refuses to delete the file it is writing, or anything outside the SpiralDB root', async () => {
    const h = harness();

    await expect(
      h.pipeline.saveObject({
        fileType: 'globalregistry',
        data: { GlobalRegistryValues: {} },
        removePaths: [path.join(h.repo.dir, 'GlobalRegistry/globalregistry.json')],
      }),
    ).rejects.toThrow(/never deletes the file it writes/);

    await expect(
      h.pipeline.saveObject({
        fileType: 'globalregistry',
        data: { GlobalRegistryValues: {} },
        removePaths: ['/tmp/definitely-not-in-this-repo.json'],
      }),
    ).rejects.toThrow(/outside the SpiralDB root/);
    // Nothing was written by either refusal.
    expect(repoFileExists(h.repo, 'GlobalRegistry/globalregistry.json')).toBe(false);
  });
});

describe('the index reflects the save immediately (ac6)', () => {
  it('resolves a freshly saved key without an explicit rebuild', async () => {
    const h = harness();
    expect(h.index.pathFor('questtemplates', 'DS-P205-IDX-001')).toBeUndefined();

    await h.pipeline.saveObject(request('DS-P205-IDX-001'));

    expect(h.index.pathFor('questtemplates', 'DS-P205-IDX-001')).toBe(
      path.join(h.repo.dir, 'QuestTemplates/questtemplates_DS-P205-IDX-001.json'),
    );
    expect(h.index.pathFor('questmetadata', 'DS-P205-IDX-001')).toBe(
      path.join(h.repo.dir, 'QuestMetadatas/questmetadata_DS-P205-IDX-001.json'),
    );
  });
});

describe('failure modes', () => {
  it('refuses to save without a configured user name (D38)', async () => {
    const h = harness({ user: '' });

    await expect(h.pipeline.saveObject(request('DS-P205-NONAME-001'))).rejects.toThrow(
      /settings.user_name is empty/,
    );
    expect(repoFileExists(h.repo, 'QuestTemplates/questtemplates_DS-P205-NONAME-001.json')).toBe(
      false,
    );
    expect(commitCount(h.repo)).toBe(1);
    expect(h.repo.git(['branch', '--list', 'content/*']).trim()).toBe('');
  });

  it('refuses to save a companion family directly', async () => {
    const h = harness();

    await expect(
      h.pipeline.saveObject({
        fileType: 'questmetadata',
        data: metadataFixture('DS-P205-X-001'),
      }),
    ).rejects.toThrow(/questmetadata is not a saveable SpiralDB object type/);
  });

  it('requires the index to have been built on the same root', () => {
    const h = harness();
    const other = repo('save-other-');
    const index = createSpiraldbIndex(other.dir);

    expect(() =>
      createSavePipeline({ db: h.db, spiraldbPath: h.repo.dir, index, now: () => new Date(NOW) }),
    ).toThrow(/Save pipeline root mismatch/);
  });

  it('reports a missing key field instead of writing an unnamed file', async () => {
    const h = harness();

    await expect(
      h.pipeline.saveObject({ fileType: 'questtemplates', data: { m_questLevel: 3 } }),
    ).rejects.toThrow(/no usable "m_questName" value/);
    expect(h.repo.git(['status', '--porcelain']).trim()).toBe('');
  });
});

/**
 * Final-review gate 2's blocking-set fix work.
 *
 * M2: the pipeline writes before it commits (deliberately — a D22 deletion must never be
 * committable without the file that replaces it), so a commit-side failure leaves the bytes on
 * disk and uncommitted, and D14's clean-tree guard then refuses every later save. The chosen fix
 * is the reviewer's honest minimum: **name the paths** in the error. This arm forces the failure
 * and shows the cluster's state before and after, so the message cannot claim more than the tree
 * holds.
 *
 * S3: when a metadata `Name` is ambiguous, the tool's own convention file wins over the opaque
 * legacy UUID file. The measured corpus shape is one of each, which is what this arm builds.
 *
 * S4: caller `notes` reach the commit body through `buildCommitMessage`, which now collapses them
 * to one line; this arm reads the body back out of the real repository.
 */
describe('a commit failure after the bytes moved (M2)', () => {
  /** A harness whose git layer writes nothing and rejects the commit. */
  function failingHarness(message = 'pre-commit hook rejected the commit'): {
    h: Harness;
    real: ReturnType<typeof createGitService>;
  } {
    const h = harness();
    const real = createGitService({
      repoPath: h.repo.dir,
      settingsBranch: () => '',
      persistBranch: () => undefined,
    });
    const failing: GitService = {
      ...real,
      commitObject: () => Promise.reject(new Error(message)),
    };
    const pipeline = createSavePipeline({
      db: h.db,
      spiraldbPath: h.repo.dir,
      index: h.index,
      now: () => new Date(NOW),
      git: failing,
    });
    return { h: { ...h, pipeline }, real };
  }

  it('names the written-but-uncommitted paths, and the tree really holds exactly those', async () => {
    const { h, real } = failingHarness();
    const name = 'DS-P205-CFAIL-001';
    const QUEST = `QuestTemplates/questtemplates_${name}.json`;
    const META = `QuestMetadatas/questmetadata_${name}.json`;

    // Before: clean tree, one seed commit, neither file present.
    expect((await real.statusPorcelain()).trim()).toBe('');
    expect(commitCount(h.repo)).toBe(1);

    const failure = await h.pipeline.saveObject(request(name)).then(
      () => null as unknown as Error,
      (error: unknown) => error as Error,
    );

    expect(failure).toBeInstanceOf(UncommittedSaveError);
    const message = failure.message;
    expect(message).toContain('written but not committed');
    expect(message).toContain(QUEST);
    expect(message).toContain(META);
    expect(message).toContain('clean-tree guard (D14)');
    expect(message).toContain('pre-commit hook rejected the commit');

    // After: exactly the paths the message names are on disk and uncommitted, and the claim
    // "every later save is refused" is not rhetoric — D14 refuses the next one.
    const porcelain = (await real.statusPorcelain()).split('\n').filter((line) => line !== '');
    expect(porcelain).toHaveLength(2);
    expect(repoFileExists(h.repo, QUEST)).toBe(true);
    expect(repoFileExists(h.repo, META)).toBe(true);
    expect(commitCount(h.repo)).toBe(1);
    await expect(h.pipeline.saveObject(request('DS-P205-CFAIL-002'))).rejects.toThrow(
      DirtyRepoError,
    );
  });

  it('names the D22 deletions it applied, not only the files it wrote', async () => {
    const { h } = failingHarness();
    const name = 'DS-P205-CFAIL-DEL-001';
    const REPLACED = 'QuestMetadatas/069f430e-b191-448c-94db-ab03da221c1e.json';
    writeRepoFile(h.repo, REPLACED, stringifySpiraldbJson(metadataFixture('DS-P205-OLD-001')));
    h.repo.git(['add', '--all']);
    h.repo.git(['commit', '-m', 'legacy metadata to be replaced']);
    h.index.rebuild();

    const failure = await h.pipeline
      .saveObject({
        ...request(name),
        removePaths: [path.join(h.repo.dir, REPLACED)],
      })
      .then(
        () => null as unknown as Error,
        (error: unknown) => error as Error,
      );

    expect(failure).toBeInstanceOf(UncommittedSaveError);
    expect(failure.message).toContain(`Deleted: ${REPLACED}`);
    // The deletion really happened and is uncommitted, which is what the message says.
    expect(repoFileExists(h.repo, REPLACED)).toBe(false);
    expect(h.repo.git(['status', '--porcelain'])).toContain(REPLACED);
  });

  it('does not claim uncommitted bytes when the failure happened before the write', async () => {
    const h = harness();

    // The replacement guard refuses an outside path before anything is written, so this failure
    // must surface as itself — the wrapper is not a blanket relabel.
    const error = await h.pipeline
      .saveObject({
        ...request('DS-P205-CFAIL-003'),
        removePaths: [path.resolve(path.sep, 'not-in-repo', 'x.json')],
      })
      .then(
        () => null as unknown as Error,
        (thrown: unknown) => thrown as Error,
      );

    expect(error).toBeInstanceOf(SpiraldbFileError);
    expect(error).not.toBeInstanceOf(UncommittedSaveError);
    expect(error.message).toMatch(/outside the SpiralDB root/);
    expect(repoFileExists(h.repo, 'QuestTemplates/questtemplates_DS-P205-CFAIL-003.json')).toBe(
      false,
    );
    expect(commitCount(h.repo)).toBe(1);
  });
});

describe('an ambiguous metadata Name (S3)', () => {
  const NAME = 'DS-P205-DUP-001';
  const UUID_PATH = 'QuestMetadatas/069f430e-b191-448c-94db-ab03da221c1e.json';
  const CONVENTION_PATH = `QuestMetadatas/questmetadata_${NAME}.json`;

  function twoFileHarness(): Harness {
    const h = harness();
    writeRepoFile(h.repo, UUID_PATH, stringifySpiraldbJson(metadataFixture(NAME)));
    writeRepoFile(
      h.repo,
      CONVENTION_PATH,
      stringifySpiraldbJson({ ...metadataFixture(NAME), CreatedBy: 'quest_builder' }),
    );
    h.repo.git(['add', '--all']);
    h.repo.git(['commit', '-m', 'legacy UUID file plus the convention file']);
    h.index.rebuild();
    return h;
  }

  it('leaves the ordinary (single-file) resolution alone', () => {
    const h = harness();
    writeRepoFile(h.repo, UUID_PATH, stringifySpiraldbJson(metadataFixture(NAME)));
    h.repo.git(['add', '--all']);
    h.repo.git(['commit', '-m', 'one legacy file']);
    h.index.rebuild();

    expect(questMetadataSaveTarget(h.index, h.repo.dir, NAME)).toEqual({
      path: path.join(h.repo.dir, UUID_PATH),
      outcome: 'updated',
      tieBreak: 'indexed',
    });
  });

  it('updates the tool convention file, and reports which rule chose it', async () => {
    const h = twoFileHarness();

    // The ambiguity is real: the index's own rule resolves the name to the UUID file.
    expect(h.index.pathFor('questmetadata', NAME)).toBe(path.join(h.repo.dir, UUID_PATH));
    expect(questMetadataSaveTarget(h.index, h.repo.dir, NAME)).toEqual({
      path: path.join(h.repo.dir, CONVENTION_PATH),
      outcome: 'updated',
      tieBreak: 'convention',
    });

    const result = await h.pipeline.saveObject(request(NAME));

    expect(result.metadataOutcome).toBe('updated');
    expect(result.metadataPath).toBe(path.join(h.repo.dir, CONVENTION_PATH));
    expect(readRepoFile(h.repo, CONVENTION_PATH)).toContain(USER);
    expect(readRepoFile(h.repo, UUID_PATH)).not.toContain(USER);
    // The measured corpus pair says the legacy file's owner identity is preserved, not refreshed.
    expect(JSON.parse(readRepoFile(h.repo, UUID_PATH))).toMatchObject({ ModifiedBy: 'makima' });
  });
});

describe('caller notes in the commit body (S4)', () => {
  it('collapses newlines and trailers to one line, in the real commit', async () => {
    const h = harness();
    const payload = 'totally normal note\n\nCo-authored-by: evil <evil@example.com>';
    const result = await h.pipeline.saveObject({
      ...request('DS-P205-NOTES-001'),
      notes: payload,
    });

    expect(result.commitMessage).toBe(
      'spiraldb: extract quest DS-P205-NOTES-001\n\ntotally normal note Co-authored-by: evil <evil@example.com>',
    );
    // Read it back out of the repository: the body is one line, so no trailer block can form.
    const rawBody = h.repo.git(['log', '-1', '--pretty=%B']);
    // Exactly three lines: the header, the blank separator and one body line. The body line
    // therefore cannot be the start of a `Co-authored-by:` trailer block.
    const body = rawBody.trimEnd().split('\n');
    expect(body).toHaveLength(3);
    expect(body[1]).toBe('');
    expect(body[2]).toBe('totally normal note Co-authored-by: evil <evil@example.com>');
    expect(rawBody).not.toMatch(/^Co-authored-by:/m);
  });
});
