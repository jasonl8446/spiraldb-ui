import { Router } from 'express';

import type { ApiError } from '../../../shared/index.js';
import type { Db } from '../db.js';
import { parseSearchQuery, searchAll } from '../services/search.js';

/**
 * Search API — `GET /api/search?q=&limit=20`, the ⌘K palette's read
 * (docs/plan-overview.md D27; the endpoint is appended to docs/spec-api.md by task 5.7).
 *
 * One query parameter pair and one envelope:
 *
 * - `?q=` is a case-insensitive **literal substring** (ASCII fold, LIKE metacharacters
 *   escaped) matched against `entry_status.object_key` for all eight D4 types and against
 *   the friendly-name columns of `items` / `spells` / `npcs` / `quests` (the quest title,
 *   joined to its own route key). Absent or blank is not an error: it is the palette's
 *   just-opened state and answers `200` with the empty envelope and **no database work**.
 * - `?limit=` defaults to 20 with a ceiling of 50; a malformed or above-ceiling value is a
 *   **400** naming what was wrong, never a silent clamp (p5-01's ladder).
 *
 * Results are grouped by type in `services/search.ts`'s fixed group order, each row
 * carrying what the palette's status dot and its link need — and `null` for both when the
 * row has no detail route, so a friendly-name hit can never be linked to a page that does
 * not exist.
 *
 * The route itself has no `:param`, so no request can reach a 404 here. Built from an
 * injected connection and mounted lazily in `routes/index.ts`, so importing `app.ts` never
 * opens `data/spiraldb-ui.db` (decision D32).
 */
export interface SearchRouterOptions {
  /** Connection holding `entry_status` and the friendly-name tables. */
  db: Db;
}

export function createSearchRouter({ db }: SearchRouterOptions): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const parsed = parseSearchQuery(req.query);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error } satisfies ApiError);
      return;
    }
    res.json(searchAll(db, { q: parsed.q, limit: parsed.limit }));
  });

  return router;
}
