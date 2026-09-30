import { Router } from 'express';

import { mountPathFor, OBJECT_TYPES, type ObjectTypeConfig } from '../../../shared/objectTypes.js';
import { getDb } from '../db.js';
import { createActivityRouter } from './activity.js';
import { createDashboardRouter } from './dashboard.js';
import { createDraftsRouter, createSuggestionsRouter } from './drafts.js';
import { createExtractRouter } from './extract.js';
import { createNamesRouter } from './names.js';
import { createObjectRouter } from './objects.js';
import { createNpcsRouter } from './npcs.js';
import { createQuestIdsRouter } from './questIds.js';
import { createQuestsRouter } from './quests.js';
import { createSearchRouter } from './search.js';
import { createSettingsRouter } from './settings.js';
import { createStatusRouter } from './status.js';
import { createSyncRouter } from './sync.js';
import { storeCaptureSuggestions } from '../services/drafts.js';
import { validateDropTableSave } from '../services/dropTables.js';
import type { ObjectSaveValidator } from '../services/objects.js';
import { SIMPLE_OBJECT_FIELDS, validateSimpleObjectSave } from '../services/simpleObjectLists.js';

/**
 * `/api` router registry.
 *
 * Task 1.1 mounted it empty on purpose — no `/api` endpoints exist yet, and this
 * story must not invent spec endpoints. Later Phase 1 tasks mount their routers
 * here: settings (1.3), sync + history (1.4g), names (1.5), status + dashboard (1.6).
 */
export const apiRouter: Router = Router();

/** Liveness probe. Not part of the REST spec — operational only. */
apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

/**
 * Settings (task 1.3).
 *
 * The router is built on the first request instead of at import time: `getDb()`
 * opens and seeds `data/spiraldb-ui.db` (db.ts L246 promises importing a router
 * never touches disk), and importing `app.ts` happens in unit tests too — where
 * `NODE_ENV=test` would seed the real database with the test-clone paths (D17).
 */
let settingsRouter: Router | undefined;

apiRouter.use('/settings', (req, res, next) => {
  settingsRouter ??= createSettingsRouter({ db: getDb() });
  settingsRouter(req, res, next);
});

/**
 * Sync + history (task 1.4g) — mounted lazily for the same reason as settings:
 * a request is the first moment the process needs `data/spiraldb-ui.db`.
 *
 * `POST /` calls `runSync` (the real orchestrator) with the connection's own
 * settings; the response is sent only when the sync has finished.
 */
let syncRouter: Router | undefined;

apiRouter.use('/sync', (req, res, next) => {
  syncRouter ??= createSyncRouter({ db: getDb() });
  syncRouter(req, res, next);
});

/**
 * Names (task 1.5) — lazily mounted for the same reason as settings/sync: the
 * first request is the first moment the process needs `data/spiraldb-ui.db`.
 *
 * The seven type routers are pure reads (`/api/names/:type`, `/api/names/:type/:id`).
 */
let namesRouter: Router | undefined;

apiRouter.use('/names', (req, res, next) => {
  namesRouter ??= createNamesRouter({ db: getDb() });
  namesRouter(req, res, next);
});

/**
 * Status lifecycle (task 1.6) — lazily mounted for the same reason as the three
 * routers above: the first request is the first moment the process needs
 * `data/spiraldb-ui.db`.
 *
 * `/status/:type`, `/status/:type/:key`, `/status/:type/:key/history` and the
 * literal `/status/_import` (declared before `/:type` in the router).
 */
let statusRouter: Router | undefined;

apiRouter.use('/status', (req, res, next) => {
  statusRouter ??= createStatusRouter({ db: getDb() });
  statusRouter(req, res, next);
});

/**
 * Dashboard (task 1.6) — `GET /api/dashboard`, the aggregate read. Lazily mounted
 * like every other feature router (decision D32).
 */
let dashboardRouter: Router | undefined;

apiRouter.use('/dashboard', (req, res, next) => {
  dashboardRouter ??= createDashboardRouter({ db: getDb() });
  dashboardRouter(req, res, next);
});

/**
 * Activity (task 5.1, story p5-01) — `GET /api/activity?limit=10`, the dashboard
 * feed's `status_history` × `entry_status` join (decision D27).
 *
 * Lazily mounted like the five routers above, and for the same reason: the first
 * request is the first moment the process needs `data/spiraldb-ui.db` (D32).
 */
let activityRouter: Router | undefined;

apiRouter.use('/activity', (req, res, next) => {
  activityRouter ??= createActivityRouter({ db: getDb() });
  activityRouter(req, res, next);
});

/**
 * Cross-type search (task 5.2, story p5-02) — `GET /api/search?q=&limit=20`, the ⌘K
 * palette's read (decision D27).
 *
 * Lazily mounted like the six routers above, and for the same reason: the first request
 * is the first moment the process needs `data/spiraldb-ui.db` (D32). A blank `?q=` is
 * answered without touching that connection at all.
 */
let searchRouter: Router | undefined;

apiRouter.use('/search', (req, res, next) => {
  searchRouter ??= createSearchRouter({ db: getDb() });
  searchRouter(req, res, next);
});

/**
 * Quest extraction (tasks 2.2/2.3, story p2-04) — `POST /api/extract/quests`.
 *
 * Mounted **directly**, not lazily like the five routers above: the extraction
 * router holds no database handle (architecture rule 4 — the CLI is the only
 * capture reader); only its capture-suggestion store (task 7.6) reaches
 * `data/spiraldb-ui.db`, and only from inside a request. It is still
 * free of import-time side effects: the service, the upload directory and
 * multer's `mkdirp` all resolve on the first request (`./extract.ts` header).
 */
apiRouter.use(
  '/extract',
  createExtractRouter({
    // Task 7.6: the capture suggestions are stored when the extraction answers. The database is
    // reached only inside a request that carries suggestions, so the router still opens nothing
    // at import time (D32).
    storeSuggestions: (suggestions, captureName) =>
      storeCaptureSuggestions(getDb(), suggestions, captureName),
  }),
);

/**
 * Quests (task 2.5, story p2-06) — `GET /api/quests`, `GET /api/quests/:name`,
 * `POST /api/quests`.
 *
 * Lazily mounted like settings/sync/names/status/dashboard: the router needs
 * `getDb()` for the settings and the status join, and the first request is the
 * first moment the process needs `data/spiraldb-ui.db` (decision D32). Its D19
 * index and save pipeline are built on the first request that needs them.
 */
let questsRouter: Router | undefined;

apiRouter.use('/quests', (req, res, next) => {
  questsRouter ??= createQuestsRouter({ db: getDb() });
  questsRouter(req, res, next);
});

/**
 * Quest-id evidence (task 6.6, story p6-07) — `GET /api/quest-ids/:id/evidence`, the
 * second tier of the catalog (`quest_ids`). Lazily mounted like every router above.
 */
let questIdsRouter: Router | undefined;

apiRouter.use('/quest-ids', (req, res, next) => {
  questIdsRouter ??= createQuestIdsRouter({ db: getDb() });
  questIdsRouter(req, res, next);
});

/**
 * Drafts and suggestions (task 7.6, story p7-07) — `GET /api/drafts`, `POST /api/drafts/rebuild`
 * and `POST /api/suggestions/:id/reject`. Lazily mounted like every router above (D32). They
 * touch only SQLite; nothing here writes to SpiralDB.
 */
let draftsRouter: Router | undefined;
let suggestionsRouter: Router | undefined;

apiRouter.use('/drafts', (req, res, next) => {
  draftsRouter ??= createDraftsRouter({ db: getDb() });
  draftsRouter(req, res, next);
});

apiRouter.use('/suggestions', (req, res, next) => {
  suggestionsRouter ??= createSuggestionsRouter({ db: getDb() });
  suggestionsRouter(req, res, next);
});

/**
 * NPC view (task 6.6, story p6-07, P6-17/D112) — `GET /api/npcs/:id`. Lazily mounted
 * for the same reason: its first request is the first moment the process needs
 * `data/spiraldb-ui.db` (D32).
 */
let npcsRouter: Router | undefined;

apiRouter.use('/npcs', (req, res, next) => {
  npcsRouter ??= createNpcsRouter({ db: getDb() });
  npcsRouter(req, res, next);
});

/**
 * The eight generic object families (task 4.1) — `/api/drop-tables`,
 * `/api/npc-inventories`, `/api/npc-spell-inventories`, `/api/creature-spellbooks`,
 * `/api/npc-drop-tables`, `/api/treasure-card-inventories`, `/api/zone-transfers`
 * and `/api/global-registry` (docs/spec-api.md L310-319), each with
 * `GET /`, `GET /:key` and `POST /`.
 *
 * Same lazy pattern as every router above — one `Router` per family, built on the
 * first request to that family, so importing `app.ts` never opens
 * `data/spiraldb-ui.db` (D32) and a family nobody visits costs nothing. The paths
 * and the configs come from `shared/objectTypes.ts`, the single table the client
 * reads too, so a mount path cannot drift from the page that calls it.
 *
 * **DropTable carries one extra**: task 4.2's four blocking rules
 * (`server/src/services/dropTables.ts`, the injection half of the shared engine), so a
 * direct POST of an invalid drop table is a **400 with a field map** rather than a write.
 * The six "one key + one list" families carry the final-review F3 null-element guard
 * (`server/src/services/simpleObjectLists.ts`) the same way, and
 * {@link objectSaveValidatorFor} is the one place that decides which family gets which.
 */
const objectRouters = new Map<string, Router>();

/**
 * The family's blocking validator, or `undefined` for the families that have none.
 *
 * One mapping rather than a hand-written choice at the mount, so a family cannot be mounted
 * with the wrong rule (or silently with none) — and `SIMPLE_OBJECT_FIELDS` is the same table
 * the guard itself reads, so "this family is guarded" and "this family has lists" cannot drift.
 */
function objectSaveValidatorFor(config: ObjectTypeConfig): ObjectSaveValidator | undefined {
  if (config.fileType === 'droptable') {
    return validateDropTableSave;
  }
  return config.fileType in SIMPLE_OBJECT_FIELDS ? validateSimpleObjectSave : undefined;
}

for (const config of OBJECT_TYPES) {
  const mountPath = mountPathFor(config);
  const validate = objectSaveValidatorFor(config);
  apiRouter.use(mountPath, (req, res, next) => {
    let router = objectRouters.get(config.fileType);
    if (router === undefined) {
      router = createObjectRouter({
        db: getDb(),
        config,
        ...(validate === undefined ? {} : { validate }),
      });
      objectRouters.set(config.fileType, router);
    }
    router(req, res, next);
  });
}
