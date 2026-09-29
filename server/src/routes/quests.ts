import { Router, type Response } from 'express';

import type { ApiError } from '../../../shared/index.js';
import { readSettings, type Db } from '../db.js';
import { DirtyRepoError } from '../services/git.js';
import { questEvidenceByName } from '../services/questEvidence.js';
import { listQuests, QuestRequestError, readQuest, saveQuest } from '../services/quests.js';
import {
  parseScaffoldRequest,
  QuestScaffoldError,
  scaffoldQuest,
} from '../services/questScaffold.js';
import { createSavePipeline, type SavePipeline } from '../services/savePipeline.js';
import { createSpiraldbIndex, type SpiraldbIndex } from '../services/spiraldbIndex.js';

/**
 * Quests API — task 2.5, the three endpoints of docs/spec-api.md L164-180:
 *
 * - `GET  /api/quests`                 list the corpus (D12: scan + JSON5 parse per request)
 * - `GET  /api/quests/:name`           one quest's full JSON, via the D19 content-keyed index
 * - `GET  /api/quests/:name/evidence`  the per-quest evidence surface (task 6.6)
 * - `POST /api/quests`                 save `{ quest, notes?, source? }` through the task 2.4 pipeline
 * - `POST /api/quests/scaffold`        create the minimal skeleton for a catalog quest (task 6.8)
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
 * GET  /api/quests/:name/evidence → { quest, text_rows, goal_gates, dialogue, references, warnings }
 *                            (docs/spec-api.md L420-492; `services/questEvidence.ts` documents the shape)
 * POST /api/quests        → { quest_name, outcome, action, commit, branch, commit_message,
 *                             file, metadata, metadata_outcome, status, warnings }
 * POST /api/quests/scaffold → { quest_name, link_kind, title_key, has_definition_before,
 *                            outcome, action, file, metadata, commit, branch, commit_message, quest }
 *                            (`services/questScaffold.ts` documents the shape; task 6.10's
 *                            Catalog view navigates to `/quests/<quest_name>` on success)
 * ```
 *
 * **Status codes** (spec-silent, chosen here and reported to the lead):
 *
 * | case                                         | status |
 * |----------------------------------------------|--------|
 * | body without a usable `quest`/`m_questName`  | 400    |
 * | a schema failure (task 3.1) or a **blocking rule finding** (task 3.9) | 400 |
 * | `settings.spiraldb_path` not configured      | 400    |
 * | unknown quest name (GET `/:name`)            | 404    |
 * | `POST /scaffold` with a name the catalog does not hold | 404 |
 * | `POST /scaffold` with a name that would write outside `QuestTemplates/` (ac3) | 400 |
 * | `POST /scaffold` for a quest that already has a file | 409 |
 * | dirty SpiralDB working tree (`DirtyRepoError`, D14) | 409 |
 * | anything else thrown by the pipeline         | 500    |
 *
 * **The 400 body (story p3-09).** `{ error }` is unchanged; a body that fails the schema pass
 * or the rule pass also carries `fields`: a `path → [message, …]` map keyed by the shared
 * `formatDocPath` (`m_startGoals[0]`, `m_goals[1].m_goalName`), with the request envelope's
 * own `quest.` prefix stripped so a schema key matches the key the client's engine uses. The
 * rule pass re-runs
 * `shared/quest/validation.ts` — the engine the client editor runs — with the friendly-name
 * tables injected, and only **blocking** findings reject the request. Warnings (an unlisted
 * zone path; a reference no table holds) are not a 400: they are the AC's "warning, save still
 * enabled" path, and the corpus ships 94 of them.
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
      // Story p3-09: the rule (and schema) failures carry a per-field error map alongside the
      // one-line message, so a client can place each message under its own control. The map is
      // absent for the Phase-2 hand-written checks, whose 400 bodies are unchanged.
      res.status(400).json({
        error: error.message,
        ...(error.fields === undefined ? {} : { fields: error.fields }),
      } satisfies ApiError & { fields?: Record<string, string[]> });
      return;
    }
    if (error instanceof QuestScaffoldError) {
      // Task 6.8: the scaffold's own refusals carry the status the service chose (400 for a
      // name or path the caller can fix, 404 for a name the catalog does not hold, 409 for a
      // quest that already has a file). They are the actionable messages verbatim.
      res.status(error.status).json({ error: error.message } satisfies ApiError);
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

  /**
   * `GET /api/quests/:name/evidence` — task 6.6.
   *
   * Declared before `/:name` so the two-nearest-segment path is unambiguous to a reader (Express
   * already distinguishes them — `/:name` matches one segment — but the order makes the intent
   * explicit). The name must be in the **catalog** (`quests`); a name nothing names is the spec's
   * 404 with its exact text.
   */
  router.get('/:name/evidence', (req, res) => {
    const root = spiraldbRoot(res);
    if (root === undefined) {
      return;
    }
    try {
      const { index } = runtimeFor(root);
      // The file behind the name is read fresh: its own string values decide `used_by_this_file`,
      // and a file edited outside the tool must not be judged against a stale scan.
      index.rebuildType('questtemplates');

      const result = questEvidenceByName({ db, index }, req.params.name);
      if (result.kind === 'unknown') {
        res.status(404).json({
          error: `Unknown quest "${req.params.name}"`,
        } satisfies ApiError);
        return;
      }
      res.json(result.evidence);
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

  /**
   * `POST /api/quests/scaffold` — task 6.8 / story p6-09.
   *
   * Body `{ quest_name, notes? }`. The service owns the rules (the target-path guard,
   * the catalog row, the direct-link title, the schema pass) and its own status codes;
   * this handler only reads `settings.spiraldb_path` and hands over the shared runtime.
   */
  router.post('/scaffold', async (req, res) => {
    const root = spiraldbRoot(res);
    if (root === undefined) {
      return;
    }
    try {
      const { name, notes } = parseScaffoldRequest(req.body);
      const { index, pipeline } = runtimeFor(root);
      // The catalog row and the string table are read from the database; the index must
      // reflect disk so the pipeline's create/update decision is not made against a stale
      // scan (the same reason `saveQuest` refreshes both families).
      index.rebuildType('questtemplates');
      res.json(await scaffoldQuest({ db, index, pipeline, name, notes }));
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
