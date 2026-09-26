import { Router } from 'express';

import { getDb } from '../db.js';
import { createSettingsRouter } from './settings.js';

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
