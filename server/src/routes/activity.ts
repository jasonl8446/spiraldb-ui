import { Router } from 'express';

import type { ApiError } from '../../../shared/index.js';
import type { Db } from '../db.js';
import { listActivity, parseActivityLimit } from '../services/status.js';

/**
 * Activity API — `GET /api/activity?limit=10`, the dashboard feed's read
 * (docs/plan-overview.md D27; the endpoint is appended to docs/spec-api.md by
 * task 5.7).
 *
 * A `status_history` × `entry_status` **left** join, newest first, capped by
 * `?limit=` (default {@link ACTIVITY_DEFAULT_LIMIT}, ceiling
 * {@link ACTIVITY_MAX_LIMIT}). The response is
 * `{ activity: [...], unresolved: n }` — the same single-envelope shape
 * `GET /api/status/:type/:key/history` uses (`{ history: [...] }`, D37) — where
 * `unresolved` counts rows the join could not tie to a live entry. Those rows are
 * returned rather than dropped; see `listActivity`'s doc-comment for why hiding
 * them would be the worse failure.
 *
 * A malformed `?limit=` (`""`, `"abc"`, `"0"`, `"101"`, a repeated parameter) is a
 * **400** with an actionable message, matching the `?status=` / `?limit=` handling
 * of the status and names routers. The route itself has no `:param`, so no request
 * can reach a 404 here.
 *
 * Built from an injected connection and mounted lazily in `routes/index.ts`, so
 * importing `app.ts` never opens `data/spiraldb-ui.db` (decision D32).
 */
export interface ActivityRouterOptions {
  /** Connection holding `status_history` + `entry_status`. */
  db: Db;
}

export function createActivityRouter({ db }: ActivityRouterOptions): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const parsed = parseActivityLimit(req.query.limit);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error } satisfies ApiError);
      return;
    }
    res.json(listActivity(db, { limit: parsed.limit }));
  });

  return router;
}
