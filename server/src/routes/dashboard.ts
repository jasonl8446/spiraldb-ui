import { Router } from 'express';

import type { Db } from '../db.js';
import { readDashboard } from '../services/status.js';

/**
 * Dashboard API — `GET /api/dashboard` (task 1.6, docs/spec-api.md L144-164).
 *
 * One read of `entry_status` aggregated per type: every one of the eight tracked
 * types is present with zeros included (the UI table is stable on a fresh
 * database), plus the overall totals and `percent_verified`. The response is
 * exactly `{ types, overall }`; the per-type buckets are the same
 * `{total, extracted, reviewed, verified}` object the status list returns.
 *
 * Built from an injected connection and mounted lazily in `routes/index.ts`, so
 * importing `app.ts` never opens `data/spiraldb-ui.db` (decision D32).
 */
export interface DashboardRouterOptions {
  db: Db;
}

export function createDashboardRouter({ db }: DashboardRouterOptions): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(readDashboard(db));
  });

  return router;
}
