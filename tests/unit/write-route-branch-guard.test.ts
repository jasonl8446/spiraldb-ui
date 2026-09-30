import { createRequire } from 'node:module';

import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OBJECT_TYPES, type ObjectTypeConfig } from '@shared/objectTypes';
import { TYPE_STRINGS } from '@shared/quest/index';
import { writeSetting } from '@server/db';
import {
  commitCount,
  createTempGitRepo,
  removeTempGitRepo,
  type TempRepo,
} from '../helpers/temp-git-repo';

/**
 * Task 7.14 — the D119 `git_branch` guard on **every** write path (D182), one test per route.
 *
 * The rule (`resolveScaffoldBranch`, the helper the scaffold CLI already uses): a save whose
 * `settings.git_branch` names a branch the working tree is not on is refused with a 409 **before**
 * that branch would be created from `main` and the tree replaced. The guard lives in the save
 * pipeline — the one chokepoint every file-writing route passes through.
 *
 * ## The route list is derived, not hand-written (like `api-error-envelope.test.ts`)
 *
 * Every non-GET route the mounted app exposes is enumerated by recording the routers as they serve
 * a request. Each one must be **guarded** (driven below: refused with 409 while the setting
 * mismatches, then accepted once it matches — the positive partner, so the 409 is the guard and
 * not "this route always fails") or **exempt with a reason**. A new write route that is in neither
 * table fails `classifies every write route`, so it cannot ship without a decision.
 *
 * Hermetic: an in-memory database and a throwaway `git init` repository under
 * `data/__test-scratch__/`, checked out on `content/checked-out` (not `main`, which the helper
 * treats as safe to branch from). The owner's fork and the D17 clone are never touched.
 */

const CHECKED_OUT = 'content/checked-out';
const MISMATCHED = 'content/somewhere-else';
const USER = 'Guard Tester';

const expressCjs = createRequire(import.meta.url)('express') as {
  Router: { handle: (req: unknown, res: unknown, next: unknown) => void };
};

interface LayerLike {
  route?: { path: string; methods: Record<string, boolean | undefined> };
  regexp?: RegExp;
}

/** Routes that write **no** SpiralDB file and make no commit — with the reason, checked by review. */
const EXEMPT: Record<string, string> = {
  'post /api/sync': 'replaces SQLite tables from the game data; reads the corpus, never writes it',
  'put /api/settings': 'writes the settings table (git_branch itself included)',
  'patch /api/status/:type/:key': 'entry_status lifecycle is SQLite only (D4); no file, no commit',
  'post /api/drafts/rebuild': 'stages quest_suggestions rows in SQLite (D129); reads the corpus',
  'post /api/suggestions/:id/reject': 'flips a quest_suggestions row in SQLite',
  'post /api/extract/quests': 'returns the extracted quest for review; a save is POST /api/quests',
};

/** The body each guarded route is driven with — valid enough to reach the pipeline. */
function objectBody(config: ObjectTypeConfig): unknown {
  if (config.keyField === null) {
    return { object: { GlobalRegistryValues: { GuardFlag: 0 } } };
  }
  const key = config.keyType === 'ulong' ? 990001 : 'GUARD-TEST-001';
  return { object: { [config.keyField]: key } };
}

const GUARDED: Record<string, () => unknown> = {
  'post /api/quests': () => ({
    quest: {
      m_questName: 'GUARD-TEST-001',
      m_goals: [{ $type: TYPE_STRINGS.WaypointGoalTemplate, m_goalName: '1_A' }],
    },
  }),
  'post /api/quests/scaffold': () => ({ quest_name: 'GUARD-SCAFFOLD-001' }),
  ...Object.fromEntries(
    OBJECT_TYPES.map((config) => [`post ${config.urlPath}`, () => objectBody(config)]),
  ),
};

describe('D119 branch guard on every write route (task 7.14)', () => {
  let app: Express;
  let repo: TempRepo;
  let setBranchSetting: (branch: string) => void;
  const writeRoutes: string[] = [];
  const environment: Record<string, string | undefined> = {};
  const originalHandle = expressCjs.Router.handle;
  const refused = new Map<string, { status: number; error: string; commits: number }>();
  let commitsBefore = 0;

  beforeAll(async () => {
    // `main` exists (the pipeline creates a session branch from it), and the tree is on another
    // branch — the D119 incident's shape.
    repo = createTempGitRepo('branch-guard-');
    repo.git(['checkout', '-b', CHECKED_OUT]);
    for (const [key, value] of Object.entries({
      SPIRALDB_UI_DB: ':memory:',
      SPIRALDB_PATH: repo.dir,
      USER_NAME: USER,
      GIT_BRANCH: MISMATCHED,
    })) {
      environment[key] = process.env[key];
      process.env[key] = value;
    }

    const captured = new Map<string, unknown>();
    expressCjs.Router.handle = function recordingHandle(
      this: unknown,
      req: unknown,
      res: unknown,
      next: unknown,
    ): void {
      const baseUrl = (req as { baseUrl?: unknown }).baseUrl;
      captured.set(typeof baseUrl === 'string' ? baseUrl : '', this);
      return originalHandle.call(this, req, res, next);
    };

    const { app: createdApp } = await import('@server/app');
    const { apiRouter } = await import('@server/routes/index');
    const { getDb } = await import('@server/db');
    app = createdApp;
    const db = getDb();
    setBranchSetting = (branch) => writeSetting(db, 'git_branch', branch);
    db.prepare(
      `INSERT INTO quests (quest_name, title, has_definition, link_kind, title_source)
       VALUES ('GUARD-SCAFFOLD-001', 'GUARD-SCAFFOLD-001', 0, 'none', 'none')`,
    ).run();

    // Build every lazily-mounted router, then walk them all.
    const prefixes = (apiRouter as unknown as { stack: LayerLike[] }).stack
      .filter((layer) => layer.route === undefined)
      .map((layer) => layer.regexp?.source ?? '')
      .map((source) =>
        source
          .slice(1)
          .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
          .replace(/\\\//g, '/'),
      );
    for (const prefix of [...prefixes, '']) {
      await request(app).get(`/api${prefix}/___guard_probe___`);
    }
    const seen = new Set<string>();
    for (const [baseUrl, router] of captured) {
      if (baseUrl !== '/api' && !baseUrl.startsWith('/api/')) {
        continue;
      }
      for (const layer of (router as { stack: LayerLike[] }).stack) {
        if (layer.route === undefined) {
          continue;
        }
        const fullPath = `${baseUrl}${layer.route.path === '/' ? '' : layer.route.path}`;
        for (const [method, enabled] of Object.entries(layer.route.methods)) {
          if (enabled === true && method !== 'get') {
            seen.add(`${method} ${fullPath}`);
          }
        }
      }
    }
    writeRoutes.push(...[...seen].sort());

    // Every guarded route, while the setting names a branch the tree is not on.
    commitsBefore = commitCount(repo);
    for (const [route, body] of Object.entries(GUARDED)) {
      const path = route.split(' ')[1] as string;
      const res = await request(app)
        .post(path)
        .send(body() as object);
      refused.set(route, {
        status: res.status,
        error: String((res.body as { error?: unknown }).error ?? res.text),
        commits: commitCount(repo),
      });
    }
  });

  afterAll(() => {
    expressCjs.Router.handle = originalHandle;
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    removeTempGitRepo(repo);
  });

  it('classifies every write route: guarded (with a test below) or exempt (with a reason)', () => {
    // The "did discovery run" floor: the floor is the eight object families, the two quest
    // routes and the six exempt ones.
    expect(writeRoutes.length).toBeGreaterThanOrEqual(16);
    const unclassified = writeRoutes.filter(
      (route) => GUARDED[route] === undefined && EXEMPT[route] === undefined,
    );
    expect(unclassified).toEqual([]);
    // No stale entry either: a table row for a route that no longer exists proves nothing.
    const stale = [...Object.keys(GUARDED), ...Object.keys(EXEMPT)].filter(
      (route) => !writeRoutes.includes(route),
    );
    expect(stale).toEqual([]);
    for (const reason of Object.values(EXEMPT)) {
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  describe.each(Object.keys(GUARDED))('%s', (route) => {
    it('refuses with a 409 while settings.git_branch is not the checked-out branch', () => {
      const result = refused.get(route);
      expect(result?.status, result?.error).toBe(409);
      expect(result?.error).toContain(`Refusing to save on branch "${MISMATCHED}"`);
      expect(result?.error).toContain(`the working tree is on "${CHECKED_OUT}"`);
      // Nothing was written or committed by the refusal.
      expect(result?.commits).toBe(commitsBefore);
    });
  });

  it('left the repository exactly as it was: same branch, no new branch, clean tree', () => {
    expect(repo.git(['branch', '--show-current']).trim()).toBe(CHECKED_OUT);
    expect(repo.git(['branch', '--list', MISMATCHED]).trim()).toBe('');
    expect(repo.git(['status', '--porcelain']).trim()).toBe('');
    expect(commitCount(repo)).toBe(commitsBefore);
  });

  it('accepts every guarded route once the setting names the checked-out branch (positive partner)', async () => {
    setBranchSetting(CHECKED_OUT);
    for (const [route, body] of Object.entries(GUARDED)) {
      const path = route.split(' ')[1] as string;
      const res = await request(app)
        .post(path)
        .send(body() as object);
      expect(res.status, `${route}: ${res.text}`).toBe(200);
    }
    expect(repo.git(['branch', '--show-current']).trim()).toBe(CHECKED_OUT);
    expect(commitCount(repo)).toBe(commitsBefore + Object.keys(GUARDED).length);
  });
});
