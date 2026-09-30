import { Router, type Response } from 'express';

import type { ApiError } from '../../../shared/index.js';
import { readSettings, type Db } from '../db.js';
import { BranchMismatchError, DirtyRepoError } from '../services/git.js';
import { questEvidenceByName } from '../services/questEvidence.js';
import {
  listQuestCatalog,
  MISSING_ONLY_PARAM,
  parseMissingOnly,
  QuestCatalogQueryError,
  readCoverage,
} from '../services/questCoverage.js';
import { listQuests, QuestRequestError, readQuest, saveQuest } from '../services/quests.js';
import {
  parseScaffoldRequest,
  QuestScaffoldError,
  resolveLink,
  scaffoldQuest,
  type CatalogRow,
} from '../services/questScaffold.js';
import { buildQuestScaffold } from '../../../shared/quest/scaffold.js';
import { createSavePipeline, type SavePipeline } from '../services/savePipeline.js';
import { createSpiraldbIndex, type SpiraldbIndex } from '../services/spiraldbIndex.js';
import { SuggestionDecisionError } from '../services/drafts.js';
import { DraftQueryError, parseStatusFilter, questSuggestionsByName } from './drafts.js';

/**
 * Quests API — task 2.5, the three endpoints of docs/spec-api.md L164-180:
 *
 * - `GET  /api/quests`                 list the corpus (D12: scan + JSON5 parse per request)
 * - `GET  /api/quests/:name`           one quest's full JSON, via the D19 content-keyed index
 * - `GET  /api/quests/coverage`        the `coverage` view, both denominators + the corpus (task 6.10)
 * - `GET  /api/quests/catalog`         the catalog worklist, `?missing_only=` narrowing to has_definition = 0 (task 6.10)
 * - `GET  /api/quests/:name/evidence`  the per-quest evidence surface (task 6.6)
 * - `POST /api/quests`                 save `{ quest, notes?, source? }` through the task 2.4 pipeline
 * - `POST /api/quests/scaffold`        create the minimal skeleton for a catalog quest (task 6.8);
 *                                       task 7.7 adds `quest`, `catalog_id`, `accepted_suggestions`
 * - `GET  /api/quests/:name/scaffold`   the skeleton a missing named draft starts from, unwritten (task 7.7)
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
 * GET  /api/quests/coverage → { nameable, id_space, defined, missing, references,
 *                            corpus: { spiraldb_path, quest_files } }  (task 6.10)
 * GET  /api/quests/catalog → { quests: [ {quest_name, title, title_source, has_definition,
 *                            reference_count} ], total, missing_only,
 *                            corpus: { spiraldb_path, quest_files } }  (task 6.10)
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
 * | malformed `?missing_only=` (not 1/0/true/false) | 400 |
 * | dirty SpiralDB working tree (`DirtyRepoError`, D14) | 409 |
 * | `settings.git_branch` is not the checked-out branch (`BranchMismatchError`, D119/D182) | 409 |
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
    if (error instanceof SuggestionDecisionError) {
      // Task 7.7 (D141): an `accepted_suggestions` id that is unknown, decided or another
      // quest's — refused before anything was written.
      res.status(error.status).json({ error: error.message } satisfies ApiError);
      return;
    }
    if (error instanceof DirtyRepoError || error instanceof BranchMismatchError) {
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
   * `GET /api/quests/coverage` — task 6.10 / story p6-11 (docs/spec-api.md L442-464).
   *
   * Serves the `coverage` **view** so the Quests-page header and the Catalog view read one
   * definition. Registered **before** `/:name`, which would otherwise capture `coverage` as a
   * quest name — the spec states that ordering as part of the contract (spec-api.md L444-445).
   *
   * Unlike the list it needs **no** SpiralDB root: the five axes live in the database, and the
   * corpus block reports the resolved path plus the file count it just measured. A machine with
   * no clone therefore still renders the header (with `quest_files: 0`) instead of a 400.
   */
  router.get('/coverage', (_req, res) => {
    try {
      res.json(readCoverage(db));
    } catch (error) {
      fail(res, error);
    }
  });

  /**
   * `GET /api/quests/catalog` — task 6.10 / story p6-11: the worklist behind the Catalog view.
   *
   * `?missing_only=1` narrows to `has_definition = 0` **in SQL** — the filter is a predicate over
   * the catalog, not a client-side re-derivation of `nameable - defined` (which would be a second
   * definition of "missing" and would silently disagree on a filtered read). A malformed value is
   * the 400 above, never a silent clamp.
   *
   * Registered before `/:name` for the same reason as `/coverage`; the spec already accepts that a
   * quest literally named `catalog` is unreachable by its detail route (spec-api.md L1023-1027).
   */
  router.get('/catalog', (req, res) => {
    try {
      const missingOnly = parseMissingOnly(req.query[MISSING_ONLY_PARAM]);
      res.json(listQuestCatalog(db, { missingOnly }));
    } catch (error) {
      if (error instanceof QuestCatalogQueryError) {
        res.status(400).json({ error: error.message } satisfies ApiError);
        return;
      }
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

  /**
   * `GET /api/quests/:name/suggestions` — task 7.6 (D143). The same shape as the id-tier read;
   * `?status=` defaults to `pending`. Registered before `/:name`, like the evidence read.
   */
  router.get('/:name/suggestions', (req, res) => {
    try {
      const body = questSuggestionsByName(db, req.params.name, parseStatusFilter(req.query.status));
      if (body === undefined) {
        res.status(404).json({ error: `Unknown quest "${req.params.name}"` } satisfies ApiError);
        return;
      }
      res.json(body);
    } catch (error) {
      if (error instanceof DraftQueryError) {
        res.status(400).json({ error: error.message } satisfies ApiError);
        return;
      }
      fail(res, error);
    }
  });

  /**
   * `GET /api/quests/:name/scaffold` — task 7.7: the D118 skeleton a named draft with no file
   * starts from in the editor, **built and not written**. It is the document `POST /scaffold`
   * would write for this catalog row (the direct-link title included), so the draft's first
   * save diffs as "the skeleton plus what was accepted". `404` for a name the catalog does not
   * hold; `409` when the quest already has a file (open it instead).
   */
  router.get('/:name/scaffold', (req, res) => {
    try {
      const row = db
        .prepare<[string], CatalogRow>(
          'SELECT quest_name, title, has_definition, link_kind FROM quests WHERE quest_name = ?',
        )
        .get(req.params.name);
      if (row === undefined) {
        res.status(404).json({ error: `Unknown quest "${req.params.name}"` } satisfies ApiError);
        return;
      }
      // The catalog's column, then the corpus itself: a file scaffolded since the last sync has
      // `has_definition = 0` still, and its editor is the file's, not a fresh skeleton.
      const root = (readSettings(db).spiraldb_path ?? '').trim();
      let hasFile = row.has_definition === 1;
      if (!hasFile && root !== '') {
        const { index } = runtimeFor(root);
        index.rebuildType('questtemplates');
        hasFile = index.pathFor('questtemplates', row.quest_name) !== undefined;
      }
      if (hasFile) {
        res.status(409).json({
          error: `"${row.quest_name}" already has a definition; open it in the editor instead.`,
        } satisfies ApiError);
        return;
      }
      const link = resolveLink(db, row);
      res.json({
        quest_name: row.quest_name,
        link_kind: link.kind,
        title_key: link.titleKey,
        quest: buildQuestScaffold({ name: row.quest_name, link }),
      });
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
      const { name, notes, quest, catalogId, acceptedSuggestions } = parseScaffoldRequest(req.body);
      const { index, pipeline } = runtimeFor(root);
      // The catalog row and the string table are read from the database; the index must
      // reflect disk so the pipeline's create/update decision is not made against a stale
      // scan (the same reason `saveQuest` refreshes both families).
      index.rebuildType('questtemplates');
      res.json(
        await scaffoldQuest({
          db,
          index,
          pipeline,
          name,
          notes,
          quest,
          catalogId,
          acceptedSuggestions,
        }),
      );
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
