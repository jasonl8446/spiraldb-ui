import { Router, type Response } from 'express';

import type { ApiError } from '../../../shared/index.js';
import { readSettings, type Db } from '../db.js';
import { DirtyRepoError } from '../services/git.js';
import { listQuests, QuestRequestError, readQuest, saveQuest } from '../services/quests.js';
import { createSavePipeline, type SavePipeline } from '../services/savePipeline.js';
import { createSpiraldbIndex, type SpiraldbIndex } from '../services/spiraldbIndex.js';

/**
 * Quests API — task 2.5, the three endpoints of docs/spec-api.md L164-180:
 *
 * - `GET  /api/quests`        list the corpus (D12: scan + JSON5 parse per request)
 * - `GET  /api/quests/:name`  one quest's full JSON, via the D19 content-keyed index
 * - `POST /api/quests`        save `{ quest, notes?, source? }` through the task 2.4 pipeline
 *
 * The spec fixes no response shape ("List all quests" / "Single quest JSON"), so
 * the shapes the client will consume are documented on the service types
 * (`server/src/services/quests.ts`) and in docs/spec-api.md, and they follow the
 * house precedent of `GET /api/status/:type`:
 *
 * ```
 * GET  /api/quests        → { quests: [ {quest_name, title, title_key, title_source,
 *                            level, goal_count, is_mainline, modified_at, status} ],
 *                             summary: {total, extracted, reviewed, verified},
 *                             skipped: [ {file, message} ] }          (skipped = unparsable files)
 * GET  /api/quests/:name  → the parsed quest object itself (exactly what POST round-trips)
 * POST /api/quests        → { quest_name, outcome, action, commit, branch, commit_message,
 *                             file, metadata, metadata_outcome, status, warnings }
 * ```
 *
 * **Status codes** (spec-silent, chosen here and reported to the lead):
 *
 * | case                                         | status |
 * |----------------------------------------------|--------|
 * | body without a usable `quest`/`m_questName`  | 400    |
 * | `settings.spiraldb_path` not configured      | 400    |
 * | unknown quest name (GET `/:name`)            | 404    |
 * | dirty SpiralDB working tree (`DirtyRepoError`, D14) | 409 |
 * | anything else thrown by the pipeline         | 500    |
 *
 * A 500 is deliberately used for every other pipeline failure — including the
 * pipeline's own actionable `SpiraldbFileError` (e.g. an empty `settings.user_name`,
 * D38) — because the plan's mapping says "a pipeline failure → 500"; the message is
 * still the actionable one.
 *
 * **List `summary` vs `GET /api/status/quests`** — the list's buckets count the
 * rows it just returned (so the filter tabs count exactly what the table holds),
 * while the status route counts `entry_status`. The two are equal because the
 * first-startup import inserts a row per corpus file and every save inserts one;
 * they diverge only when a quest file is added to the repository *outside* this
 * tool (the table then shows it as `extracted` while the database does not know
 * it). That is reported as a D-item, not papered over.
 *
 * The router is built from an injected connection and mounted lazily in
 * `routes/index.ts` so importing `app.ts` never opens `data/spiraldb-ui.db`
 * (decision D32). The D19 index and the save pipeline are built together, once per
 * SpiralDB root, on the first request that needs them — the list needs neither.
 */

export interface QuestsRouterOptions {
  /** Connection holding `settings`, `entry_status` and the string table. */
  db: Db;
}

/** The shared per-root index + pipeline pair (D19). */
interface QuestRuntime {
  root: string;
  index: SpiraldbIndex;
  pipeline: SavePipeline;
}

export function createQuestsRouter({ db }: QuestsRouterOptions): Router {
  const router = Router();

  // One runtime per process, rebuilt when settings.spiraldb_path changes (the
  // owner can repoint SpiralDB through PUT /api/settings between requests).
  let runtime: QuestRuntime | undefined;

  function runtimeFor(root: string): QuestRuntime {
    if (runtime === undefined || runtime.root !== root) {
      const index = createSpiraldbIndex(root);
      index.rebuild();
      runtime = { root, index, pipeline: createSavePipeline({ db, spiraldbPath: root, index }) };
    }
    return runtime;
  }

  /** `settings.spiraldb_path`, or a 400 when it is unset. */
  function spiraldbRoot(res: Response): string | undefined {
    const root = (readSettings(db).spiraldb_path ?? '').trim();
    if (root === '') {
      res.status(400).json({
        error:
          'SpiralDB path is not configured. Set spiraldb_path in Settings before browsing or saving quests.',
      } satisfies ApiError);
      return undefined;
    }
    return root;
  }

  /** The documented status mapping; 500 logs the thrown value like the middleware. */
  function fail(res: Response, error: unknown): void {
    if (error instanceof QuestRequestError) {
      res.status(400).json({ error: error.message } satisfies ApiError);
      return;
    }
    if (error instanceof DirtyRepoError) {
      res.status(409).json({ error: error.message } satisfies ApiError);
      return;
    }
    console.error('[spiraldb-ui] quests API error:', error);
    res.status(500).json({
      error: error instanceof Error && error.message ? error.message : 'The quest operation failed',
    } satisfies ApiError);
  }

  router.get('/', async (_req, res) => {
    const root = spiraldbRoot(res);
    if (root === undefined) {
      return;
    }
    try {
      res.json(await listQuests({ db, spiraldbPath: root }));
    } catch (error) {
      fail(res, error);
    }
  });

  router.get('/:name', (req, res) => {
    const root = spiraldbRoot(res);
    if (root === undefined) {
      return;
    }
    try {
      const { index } = runtimeFor(root);
      // D12/D19: re-scan this family so a file changed or added outside the tool is
      // seen immediately (322 JSON5 parses, tens of milliseconds locally).
      index.rebuildType('questtemplates');

      const detail = readQuest({ index, name: req.params.name });
      if (detail === undefined) {
        res.status(404).json({
          error: `Unknown quest "${req.params.name}"`,
        } satisfies ApiError);
        return;
      }
      res.json(detail.quest);
    } catch (error) {
      fail(res, error);
    }
  });

  router.post('/', async (req, res) => {
    const root = spiraldbRoot(res);
    if (root === undefined) {
      return;
    }
    try {
      const { index, pipeline } = runtimeFor(root);
      res.json(await saveQuest({ db, index, pipeline, body: req.body }));
    } catch (error) {
      fail(res, error);
    }
  });

  return router;
}
