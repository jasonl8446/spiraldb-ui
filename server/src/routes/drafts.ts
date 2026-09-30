import { Router, type Request, type Response } from 'express';

import type { ApiError } from '../../../shared/index.js';
import { readSettings, type Db } from '../db.js';
import {
  buildDrafts,
  listDrafts,
  listSuggestions,
  rejectSuggestion,
  SUGGESTION_SOURCES,
  SUGGESTION_STATUSES,
  SuggestionDecisionError,
  type DraftBuildResult,
  type DraftFilters,
  type SuggestionRow,
  type SuggestionSource,
  type SuggestionStatusFilter,
} from '../services/drafts.js';
import { createSpiraldbIndex } from '../services/spiraldbIndex.js';

/**
 * Drafts and suggestions API — task 7.6 (story p7-07; D130, D141, D143; docs/spec-api.md
 * "Suggestions and Drafts").
 *
 * - `GET  /api/drafts`                   the queue, read from the `quest_drafts` view
 * - `POST /api/drafts/rebuild`           the draft builder, synchronous; `409` while one runs
 * - `POST /api/suggestions/:id/reject`   pending → rejected, immediately; `409` on a decided row
 *
 * The two per-quest reads (`GET /api/quests/:name/suggestions`, `GET /api/quest-ids/:id/suggestions`)
 * live on their own routers beside the evidence endpoints they mirror, and answer through
 * {@link suggestionsBody}. **None of these routes writes to SpiralDB**: they touch only SQLite, so
 * the D119 branch guard applies through the save routes and not here.
 *
 * Built from an injected connection and mounted lazily in `routes/index.ts` (decision D32).
 */

/** `?status=` of the two suggestion reads; `pending` when absent. */
export function parseStatusFilter(value: unknown): SuggestionStatusFilter {
  if (value === undefined) {
    return 'pending';
  }
  if (value === 'all' || (SUGGESTION_STATUSES as readonly unknown[]).includes(value)) {
    return value as SuggestionStatusFilter;
  }
  throw new DraftQueryError(
    `status must be one of ${[...SUGGESTION_STATUSES, 'all'].join(', ')}; got ${JSON.stringify(value)}`,
  );
}

/** A malformed query value: always a 400, never a silent clamp. */
export class DraftQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DraftQueryError';
  }
}

/** The shared body of the two per-quest suggestion reads (D143). */
export function suggestionsBody(
  questName: string | null,
  catalogId: number | null,
  suggestions: SuggestionRow[],
): { quest_name: string | null; catalog_id: number | null; suggestions: object[] } {
  return {
    quest_name: questName,
    catalog_id: catalogId,
    // The row's own draft keys are the envelope's, so each item carries only its own fields.
    suggestions: suggestions.map(
      ({ quest_name: _questName, catalog_id: _catalogId, ...row }) => row,
    ),
  };
}

/** `?named=`/`?has_file=`/`?all=`: `1` or `0`, absent → `null`. */
function parseFlag(query: Request['query'], name: string): boolean | null {
  const value = query[name];
  if (value === undefined) {
    return null;
  }
  if (value === '1' || value === '0') {
    return value === '1';
  }
  throw new DraftQueryError(`${name} must be 1 or 0; got ${JSON.stringify(value)}`);
}

function parseCount(query: Request['query'], name: string, fallback: number, max: number): number {
  const value = query[name];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) > max) {
    throw new DraftQueryError(
      `${name} must be an integer from 0 to ${max}; got ${JSON.stringify(value)}`,
    );
  }
  return Number(value);
}

/** Every `GET /api/drafts` filter, validated. */
export function parseDraftFilters(query: Request['query']): DraftFilters {
  const source = query.source;
  if (source !== undefined && !(SUGGESTION_SOURCES as readonly unknown[]).includes(source)) {
    throw new DraftQueryError(
      `source must be one of ${SUGGESTION_SOURCES.join(', ')}; got ${JSON.stringify(source)}`,
    );
  }
  return {
    named: parseFlag(query, 'named'),
    has_file: parseFlag(query, 'has_file'),
    source: (source as SuggestionSource | undefined) ?? null,
    all: parseFlag(query, 'all') ?? false,
    limit: parseCount(query, 'limit', 100, 1000),
    offset: parseCount(query, 'offset', 0, Number.MAX_SAFE_INTEGER),
  };
}

function fail(res: Response, error: unknown): void {
  if (error instanceof DraftQueryError) {
    res.status(400).json({ error: error.message } satisfies ApiError);
    return;
  }
  if (error instanceof SuggestionDecisionError) {
    res.status(error.status).json({ error: error.message } satisfies ApiError);
    return;
  }
  console.error('[spiraldb-ui] drafts API error:', error);
  res.status(500).json({
    error: error instanceof Error && error.message ? error.message : 'The draft operation failed',
  } satisfies ApiError);
}

/** The builder the rebuild route drives; injectable so a test can hold one open. */
export type DraftRebuilder = (db: Db) => DraftBuildResult | Promise<DraftBuildResult>;

/** The default rebuild: a fresh quest-file scan of `settings.spiraldb_path`, then the builder. */
export const rebuildFromSettings: DraftRebuilder = (db) => {
  const root = (readSettings(db).spiraldb_path ?? '').trim();
  if (root === '') {
    throw new DraftQueryError(
      'SpiralDB path is not configured. Set spiraldb_path in Settings before rebuilding drafts.',
    );
  }
  const index = createSpiraldbIndex(root);
  index.rebuildType('questtemplates');
  return buildDrafts({ db, index });
};

export interface DraftsRouterOptions {
  db: Db;
  rebuild?: DraftRebuilder;
}

export function createDraftsRouter({
  db,
  rebuild = rebuildFromSettings,
}: DraftsRouterOptions): Router {
  const router = Router();
  // One rebuild at a time (D143). The builder is synchronous today, so a second request cannot
  // arrive mid-run in this process; the flag keeps the contract if the builder ever yields.
  let running = false;

  router.get('/', (req, res) => {
    try {
      res.json(listDrafts(db, parseDraftFilters(req.query)));
    } catch (error) {
      fail(res, error);
    }
  });

  router.post('/rebuild', async (_req, res) => {
    if (running) {
      res.status(409).json({ error: 'A draft rebuild is already running' } satisfies ApiError);
      return;
    }
    running = true;
    try {
      res.json(await rebuild(db));
    } catch (error) {
      fail(res, error);
    } finally {
      running = false;
    }
  });

  return router;
}

export function createSuggestionsRouter({ db }: { db: Db }): Router {
  const router = Router();

  router.post('/:id/reject', (req, res) => {
    const id = /^\d+$/.test(req.params.id) ? Number(req.params.id) : Number.NaN;
    if (!Number.isSafeInteger(id)) {
      res.status(404).json({ error: `Unknown suggestion ${req.params.id}` } satisfies ApiError);
      return;
    }
    try {
      const row = rejectSuggestion(db, id);
      res.json(suggestionsBody(row.quest_name, row.catalog_id, [row]).suggestions[0]);
    } catch (error) {
      fail(res, error);
    }
  });

  return router;
}

/**
 * `GET /api/quests/:name/suggestions`: a catalog name, or a name only suggestions carry (an
 * extracted quest whose capture suggestions were stored before it had a catalog row).
 */
export function questSuggestionsByName(
  db: Db,
  name: string,
  status: SuggestionStatusFilter,
): ReturnType<typeof suggestionsBody> | undefined {
  const known =
    db.prepare('SELECT 1 FROM quests WHERE quest_name = ?').get(name) !== undefined ||
    db.prepare('SELECT 1 FROM quest_suggestions WHERE quest_name = ? LIMIT 1').get(name) !==
      undefined;
  if (!known) {
    return undefined;
  }
  const linked = db
    .prepare<[string], { id: number | null }>(
      'SELECT min(quest_id) AS id FROM quest_ids WHERE matched_quest_name = ?',
    )
    .get(name);
  return suggestionsBody(
    name,
    linked?.id ?? null,
    listSuggestions(db, { quest_name: name }, status),
  );
}

/** `GET /api/quest-ids/:id/suggestions`: the unnamed tier's rows of one id. */
export function questSuggestionsById(
  db: Db,
  id: number,
  status: SuggestionStatusFilter,
): ReturnType<typeof suggestionsBody> | undefined {
  if (db.prepare('SELECT 1 FROM quest_ids WHERE quest_id = ?').get(id) === undefined) {
    return undefined;
  }
  return suggestionsBody(null, id, listSuggestions(db, { catalog_id: id }, status));
}
