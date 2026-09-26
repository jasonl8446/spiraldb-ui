import { Router } from 'express';

import type { ApiError } from '../../../shared/index.js';
import type { Db } from '../db.js';
import {
  runSync,
  type RunSyncOptions,
  type RunSyncResult,
  type SyncRunner,
} from '../services/sync/execute.js';

/**
 * Sync API — `POST /api/sync`, `GET /api/sync/status`, `GET /api/sync/history`
 * (task 1.4g, docs/spec-api.md L235-287).
 *
 * **`POST /api/sync` is synchronous-blocking**: the response is sent only after
 * the sync has finished (a fresh unpack takes ~17 s; the client shows a spinner).
 * There is no job queue and no polling contract.
 *
 * A failed sync is a server-side operation failure, not a client error: the row
 * is durable in `sync_history` (so `/status` reports `failed`) and the response
 * is `500 {"error": "…"}`.
 */

/** The orchestrator signature the router drives — injectable for tests. */
export type { SyncRunner };

export interface SyncRouterOptions {
  /** Connection holding the friendly-name tables and `sync_history`. */
  db: Db;
  /** Overrides passed to `runSync` (the CLI passes the same ones). */
  runSync?: SyncRunner;
  /** Settings overrides passed to the orchestrator (tests avoid real paths). */
  overrides?: RunSyncOptions['overrides'];
  /** Clock for the POST response timestamp; injectable for tests. */
  now?: () => Date;
}

/** One `sync_history` row as returned by `GET /api/sync/history`. */
export interface SyncHistoryEntry {
  id: number;
  sync_timestamp: string | null;
  revision: string | null;
  items_count: number | null;
  spells_count: number | null;
  npcs_count: number | null;
  quests_count: number | null;
  zones_count: number | null;
  status: string | null;
  error_message: string | null;
}

/** `GET /api/sync/status` body. `status: 'never'` is the empty-history case. */
export interface SyncStatusBody {
  last_sync: string | null;
  revision: string | null;
  status: string;
}

export function createSyncRouter({
  db,
  runSync: runner,
  overrides,
  now,
}: SyncRouterOptions): Router {
  const router = Router();
  const run = runner ?? runSync;

  const latest = db.prepare(
    'SELECT sync_timestamp, revision, status FROM sync_history ORDER BY id DESC LIMIT 1',
  );
  const history = db.prepare('SELECT * FROM sync_history ORDER BY id DESC');

  router.post('/', async (_req, res, _next) => {
    let result: RunSyncResult;
    try {
      result = await run({ db, overrides, now });
    } catch (error) {
      // A thrown orchestrator must still answer the JSON envelope rather than
      // hang the request (Express 4 does not catch async handler rejections).
      res.status(500).json({
        error: error instanceof Error && error.message ? error.message : 'Sync failed',
      } satisfies ApiError);
      return;
    }
    if (result.status !== 'success') {
      res.status(500).json({
        error: result.errorMessage ?? 'Sync failed',
      } satisfies ApiError);
      return;
    }
    // Exactly the spec's four top-level keys, and exactly five keys inside
    // `synced` (docs/spec-api.md L239-252) — drop_tables/string_table counts are
    // deliberately not added here.
    res.json({
      status: 'success',
      synced: {
        items: result.counts.items,
        spells: result.counts.spells,
        npcs: result.counts.npcs,
        quests: result.counts.quests,
        zones: result.counts.zones,
      },
      timestamp: result.timestamp,
    });
  });

  router.get('/status', (_req, res) => {
    const row = latest.get() as
      { sync_timestamp: string | null; revision: string | null; status: string | null } | undefined;
    // No sync yet is a normal first-run state, not an error: nulls plus the
    // literal `never` (the Settings page renders "Never synced").
    const body: SyncStatusBody = row
      ? { last_sync: row.sync_timestamp, revision: row.revision, status: row.status ?? 'never' }
      : { last_sync: null, revision: null, status: 'never' };
    res.json(body);
  });

  router.get('/history', (_req, res) => {
    res.json({ history: history.all() as SyncHistoryEntry[] });
  });

  return router;
}
