import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import {
  OBJECT_TYPES,
  objectTypeConfig,
  type ObjectRouteType,
  type ObjectStatusType,
  type ObjectTypeConfig,
} from '@shared/objectTypes';
import { openDb, MEMORY_DB, writeSettings, type Db } from '@server/db';
import { createObjectRouter } from '@server/routes/objects';
import { createStatusRouter } from '@server/routes/status';
import { validateDropTableSave } from '@server/services/dropTables';
import { getStatusEntry, getStatusHistory } from '@server/services/status';
import {
  commitCount,
  createTempGitRepo,
  removeTempGitRepo,
  writeRepoFile,
  type TempRepo,
} from '../helpers/temp-git-repo';

/**
 * Story p4-08, AC2 (the Phase 4 plan §4.10 "Status integration for all types"): **a create via `POST`
 * tracks the entry as `extracted` with the history note `Created via UI`, and an edit does
 * not change the status** — asserted, as the story asks, **per tracked type** rather than
 * re-implemented.
 *
 * The mechanism is the pipeline's and predates this story (p4-01's `saveObjectEntry` status
 * upsert with `historyNotesOnCreate`, p4-02/p4-05's live runs: p4-05 measured a live no-op POST
 * answering `commit: ""` with the status unchanged, and its one-field POST keeping
 * `extracted`). So this file adds **no production code**: it drives the real
 * `POST /api/<type>` and the real `PATCH /api/status/<route>/<key>` over a throwaway git repo
 * and an in-memory database, for each of the **seven** tracked families, and reads every
 * result back through the endpoints the UI reads (`GET
 * /api/status/<route>/<key>/history` is the history panel's own read).
 *
 * `global_registry` is deliberately **not** in the table: it has no `object_type`, no status
 * route and no `entry_status` row (Q1, D75(j)). Its absence from `STATUS_OBJECT_TYPES` is
 * pinned by `tests/unit/objects-api.test.ts` and p4-07's AC3; the last test here pins the other
 * half of the same fact — its create answers `status_created: false` and writes no row.
 *
 * Hermetic by construction (D44/D68): no module-scope work, no reads of the real corpus or the
 * D17 clone.
 */

const USER = 'P4-08 Tester';
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
  while (REPOS.length > 0) {
    const repo = REPOS.pop();
    if (repo !== undefined) {
      removeTempGitRepo(repo);
    }
  }
});

/** A row of `OBJECT_TYPES` that has both halves of a lifecycle: D4's type and route. */
type TrackedConfig = ObjectTypeConfig & {
  objectType: ObjectStatusType;
  routeType: ObjectRouteType;
};

function isTracked(config: ObjectTypeConfig): config is TrackedConfig {
  return config.objectType !== null && config.routeType !== null;
}

/** The seven tracked families — GlobalRegistry is the one row `objectType: null` excludes. */
const TRACKED: readonly TrackedConfig[] = OBJECT_TYPES.filter(isTracked);

/**
 * One create document and one **edit** document per family, using only the fields
 * `docs/spec-domain-reference.md` names for that type, so a save can never be rejected by a
 * family's own validator and the two documents differ by exactly one real field.
 */
const DOCUMENTS: Record<
  string,
  { create: Record<string, unknown>; edit: Record<string, unknown> }
> = {
  droptable: {
    // `RollChance: 1.0` because this family's validator runs server-side (task 4.2) and a
    // created file should look like a drop table; the edit then changes `Description`, which
    // touches none of the four blocking rules.
    create: { Name: 'P4-08-NEW', RollChance: 1.0 },
    edit: { Name: 'P4-08-NEW', RollChance: 1.0, Description: 'edited by p4-08' },
  },
  npcinventory: {
    create: { TemplateID: 808001, Inventory: [] },
    edit: { TemplateID: 808001, Inventory: [160936] },
  },
  npcspellinventory: {
    create: { TemplateID: 808002, Spells: [] },
    edit: { TemplateID: 808002, Spells: [{ TemplateID: 84361, RequiredSpellID: 0, Level: 1 }] },
  },
  creaturespellbook: {
    create: { DeckName: 'p4-08-deck', SpellTemplateIds: [] },
    edit: { DeckName: 'p4-08-deck', SpellTemplateIds: [409737272] },
  },
  npcdroptable: {
    create: { TemplateID: 808003, DropTableNames: [] },
    edit: { TemplateID: 808003, DropTableNames: ['P4-08-NEW'] },
  },
  treasurecardinventory: {
    create: { TemplateID: 808004, TreasureCards: [] },
    edit: { TemplateID: 808004, TreasureCards: [{ SpellName: 'Fire Shield TC', Price: 100 }] },
  },
  zonetransfer: {
    create: { ZoneName: 'P4-08/Test_Zone', Teleports: [] },
    edit: {
      ZoneName: 'P4-08/Test_Zone',
      Teleports: [
        {
          TriggerName: 'TeleportToP4-08',
          Teleport: {
            m_destinationLoc: '-95.55735,-849.2842,-30.46902,-0.03700731',
            m_destinationZone: 'WizardCity/WC_Hub',
            m_exitTeleporter: 0,
            m_teleporterTag: 0,
            m_teleportType: 'TELEPORT_STATIC',
            m_transitionID: 0,
          },
        },
      ],
    },
  },
};

interface Harness {
  repo: TempRepo;
  db: Db;
  app: Express;
}

/**
 * A throwaway repo with one existing legacy file (so no family is empty and the create is a
 * create) plus both routers mounted, the DropTable validator injected exactly as
 * `server/src/routes/index.ts` L145 does.
 */
function harness(): Harness {
  const repo = createTempGitRepo('p4-08-status-');
  REPOS.push(repo);
  writeRepoFile(
    repo,
    'DropTables/droptables_existing.json',
    JSON.stringify({ Name: 'DS-EXISTING', RollChance: 1.0 }),
  );
  repo.git(['add', '--all']);
  repo.git(['commit', '-m', 'a minimal measured corpus']);

  const db = openDb({ file: MEMORY_DB });
  OPEN_DBS.push(db);
  writeSettings(db, { spiraldb_path: repo.dir, user_name: USER, git_branch: '' });

  const app = express();
  app.use(express.json());
  app.use('/api/status', createStatusRouter({ db }));
  for (const config of OBJECT_TYPES) {
    app.use(
      config.urlPath,
      createObjectRouter({
        db,
        config,
        ...(config.fileType === 'droptable' ? { validate: validateDropTableSave } : {}),
      }),
    );
  }
  return { repo, db, app };
}

/** How many `entry_status` rows exist for one raw `object_type` string. */
function statusRowCount(db: Db, objectType: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM entry_status WHERE object_type = ?')
    .get(objectType) as { count: number };
  return row.count;
}

describe('AC2: a create tracks the entry as extracted with the "Created via UI" note', () => {
  for (const config of TRACKED) {
    const documents = DOCUMENTS[config.fileType];
    const key = documents === undefined ? '' : String(documents.create[config.keyField ?? '']);

    it(`${config.objectType}: POST → extracted + the note, then an edit moves nothing`, async () => {
      const h = harness();
      if (documents === undefined) {
        throw new Error(`no documents fixture for ${config.fileType}`);
      }

      // 1. The create, through the family's own POST route.
      const created = await request(h.app)
        .post(config.urlPath)
        .send({ object: documents.create })
        .expect(200);
      expect(created.body).toMatchObject({
        key,
        object_type: config.objectType,
        outcome: 'created',
        action: 'create',
        status_created: true,
      });

      // 2. The status row: extracted, under the same text key the list and detail join on.
      expect(getStatusEntry(h.db, config.objectType, key)?.status).toBe('extracted');

      // 3. The history note, read through the endpoint the history panel calls.
      const history = await request(h.app)
        .get(`/api/status/${config.routeType}/${encodeURIComponent(key)}/history`)
        .expect(200);
      expect(history.body.history).toEqual([
        expect.objectContaining({
          old_status: null,
          new_status: 'extracted',
          notes: 'Created via UI',
          changed_by: USER,
        }),
      ]);

      // 4. The mark action's own wire, so the "an edit moves nothing" arm below is a real
      //    claim rather than the untouched default.
      const marked = await request(h.app)
        .patch(`/api/status/${config.routeType}/${encodeURIComponent(key)}`)
        .send({ status: 'reviewed', notes: 'checked by p4-08' })
        .expect(200);
      expect(marked.body.status).toBe('reviewed');
      const commitsBeforeEdit = commitCount(h.repo);

      // 5. The edit: the create document plus one real field, through the same POST route, with
      //    the **exact envelope the client sends** — `{ object, key }`, the key being the route
      //    key the client opened. The third field is not decoration: the DropTable duplicate
      //    rule ignores exactly that corpus occurrence, and without it an unmodified save of an
      //    existing drop table 400s against itself (the client gap this story's per-type
      //    assertion found — see `client/src/pages/ObjectDetailPage.tsx`). The rule's own arms
      //    are p4-02's `tests/unit/drop-table-save.test.ts`.
      const edited = await request(h.app)
        .post(config.urlPath)
        .send({ object: documents.edit, key })
        .expect(200);
      expect(edited.body).toMatchObject({ outcome: 'updated', action: 'update' });
      // A save that changed a field commits; the status is what must not move.
      expect(edited.body.status_created).toBe(false);
      expect(commitCount(h.repo)).toBe(commitsBeforeEdit + 1);

      // 6. Status unchanged, and the history gained exactly nothing.
      expect(getStatusEntry(h.db, config.objectType, key)?.status).toBe('reviewed');
      const after = await request(h.app)
        .get(`/api/status/${config.routeType}/${encodeURIComponent(key)}/history`)
        .expect(200);
      expect(after.body.history.map((row: { new_status: string }) => row.new_status)).toEqual([
        'extracted',
        'reviewed',
      ]);
      expect(after.body.history[1]).toMatchObject({
        notes: 'checked by p4-08',
        changed_by: USER,
      });
      const stored = getStatusHistory(h.db, config.objectType, key);
      expect(stored.found ? stored.history : []).toHaveLength(2);
    });
  }

  it('global_registry is never tracked: status_created false, no row, no v1 route', async () => {
    const h = harness();
    const config = objectTypeConfig('globalregistry');

    const created = await request(h.app)
      .post(config.urlPath)
      .send({ object: { GlobalRegistryValues: { Christmas: 1 } } })
      .expect(200);

    expect(created.body).toMatchObject({ status_created: false, object_type: null, status: null });
    expect(statusRowCount(h.db, 'global_registry')).toBe(0);
    // …and the status route for it does not exist at all (Q1, D75(j), p4-07's AC3).
    const statuses = await request(h.app).get('/api/status/global_registry').expect(404);
    expect(statuses.body.error).toMatch(/Unknown status type/);
  });
});
