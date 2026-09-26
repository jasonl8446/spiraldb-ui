import { Router } from 'express';

import { getDb } from '../db.js';
import { createDashboardRouter } from './dashboard.js';
import { createExtractRouter } from './extract.js';
import { createNamesRouter } from './names.js';
import { createQuestsRouter } from './quests.js';
import { createSettingsRouter } from './settings.js';
import { createStatusRouter } from './status.js';
import { createSyncRouter } from './sync.js';

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
 * Quest extraction (tasks 2.2/2.3, story p2-04) — `POST /api/extract/quests`.
 *
 * Mounted **directly**, not lazily like the five routers above: the extraction
 * router holds no database handle (architecture rule 4 — the CLI is the only
 * capture reader), so a request never needs `data/spiraldb-ui.db`. It is still
 * free of import-time side effects: the service, the upload directory and
 * multer's `mkdirp` all resolve on the first request (`./extract.ts` header).
 */
apiRouter.use('/extract', createExtractRouter());

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
