import { Router } from 'express';

import type { ApiError } from '../../../shared/index.js';
import type { Db } from '../db.js';
import {
  isNamesType,
  listNames,
  lookupName,
  parseListNamesQuery,
  unknownNamesTypeMessage,
} from '../services/names.js';

/**
 * Names API — `GET /api/names/:type` and `GET /api/names/:type/:id`
 * (task 1.5, docs/spec-api.md L5-44).
 *
 * The LIST body is the spec envelope `{ "<type>": [row, …] }` using the requested
 * type name verbatim (`strings` → `{"strings": [...]}`); the single lookup body is
 * exactly one row object, never wrapped. Two optional LIST extensions (`?q=`,
 * `?limit=`) are handled by `parseListNamesQuery`; a bare URL is unchanged.
 *
 * Every failure is a JSON `{ error }`: unknown type / unknown id / an id that
 * cannot be valid for the type → 404, malformed `q`/`limit` → 400.
 *
 * A zone id contains a slash (`WizardCity/WC_Hub`), so its encoded form
 * (`WizardCity%2FWC_Hub`) is the resolvable one: Express matches on the raw path
 * and decodes `%2F` inside a single segment. The unencoded two-segment URL simply
 * does not match `/:type/:id` and falls through to the app's JSON 404.
 *
 * The router is built from an injected connection, so a test can exercise it
 * against a seeded `:memory:` database; `routes/index.ts` mounts it lazily so
 * importing `app.ts` never opens `data/spiraldb-ui.db` (decision D32).
 */
export interface NamesRouterOptions {
  /** Connection holding the seven friendly-name tables. */
  db: Db;
}

export function createNamesRouter({ db }: NamesRouterOptions): Router {
  // Keep ordering results in memory instead of spilling to a SQLite temp file.
  //
  // The documented ordering (display column, then primary key) needs a full sort
  // for `strings`: 216,991 rows exceed the sorter's in-memory budget, and with
  // SQLite's default `temp_store = FILE` the sort tries to create a temp file in
  // `/var/tmp` and fails with `unable to open database file` wherever that
  // directory is not writable — a 500 on a read-only endpoint (measured
  // 2026-09-26, task 1.5, raw evidence in the story report). `temp_store = MEMORY`
  // removes the filesystem from the path; the largest sort here is ~217k short
  // rows. If a later route needs the same guarantee, this belongs in `openDb()`.
  db.pragma('temp_store = MEMORY');

  const router = Router();

  router.get('/:type', (req, res) => {
    const type = req.params.type;
    if (!isNamesType(type)) {
      res.status(404).json({ error: unknownNamesTypeMessage(type) } satisfies ApiError);
      return;
    }

    const parsed = parseListNamesQuery(req.query);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error } satisfies ApiError);
      return;
    }

    res.json({ [type]: listNames(db, type, parsed.options) });
  });

  router.get('/:type/:id', (req, res) => {
    const type = req.params.type;
    if (!isNamesType(type)) {
      res.status(404).json({ error: unknownNamesTypeMessage(type) } satisfies ApiError);
      return;
    }

    const result = lookupName(db, type, req.params.id);
    if (!result.found) {
      res.status(404).json({ error: result.error } satisfies ApiError);
      return;
    }

    res.json(result.row);
  });

  return router;
}
