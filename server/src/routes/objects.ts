import { Router, type Response } from 'express';

import type { ApiError } from '../../../shared/index.js';
import type { ObjectTypeConfig } from '../../../shared/objectTypes.js';
import { ULong } from '../../../shared/ulong.js';
import { readSettings, type Db } from '../db.js';
import { DirtyRepoError } from '../services/git.js';
import {
  listObjects,
  objectRuntimeFor,
  ObjectRequestError,
  readObject,
  saveObjectEntry,
  type ObjectSaveValidator,
} from '../services/objects.js';

/**
 * The generic object API — task 4.1, the eight route families of
 * docs/spec-api.md L310-319, one `createObjectRouter(config)` per family:
 *
 * ```
 * GET  /api/drop-tables           → { objects, summary, skipped, missing_directory, duplicate_keys }
 * GET  /api/drop-tables/:key      → the parsed document itself (exactly what POST round-trips)
 * POST /api/drop-tables           → { key, file_type, object_type, outcome, action, commit,
 *                                     branch, commit_message, file, status, status_created, warnings }
 * ```
 *
 * The spec fixes no response shape ("List all entries" / "Single entry JSON"), so the
 * shapes the client consumes are documented on the service types
 * (`server/src/services/objects.ts`); the list deliberately follows
 * `GET /api/quests`'s house shape (`objects` where quests says `quests`, plus the
 * status tally and the skipped-file report), and POST follows `POST /api/quests`'s
 * sniffable result. The request body is `{ object, notes?, key? }` — the same
 * envelope shape, with the per-type key field inside the document.
 *
 * **Status codes** (spec-silent, chosen here and reported to the lead):
 *
 * | case                                                | status |
 * |------------------------------------------------------|--------|
 * | body without a usable `object`, or an unusable key    | 400    |
 * | `settings.spiraldb_path` not configured               | 400    |
 * | unknown key (GET `/:key`)                             | 404    |
 * | dirty SpiralDB working tree (`DirtyRepoError`, D14)   | 409    |
 * | anything else thrown by the pipeline                  | 500    |
 *
 * A 500 is deliberately used for every other pipeline failure — including the
 * pipeline's own actionable `SpiraldbFileError` (an empty `settings.user_name`, D38)
 * — the message is still the actionable one.
 *
 * The router is built from an injected connection and mounted lazily in
 * `routes/index.ts`, so importing `app.ts` never opens `data/spiraldb-ui.db` (D32).
 * The D19 index and the save pipeline come from the process-wide per-root runtime
 * (`objectRuntimeFor`), shared by all eight families so the corpus scan happens once.
 */

export interface ObjectRouterOptions {
  /** Connection holding `settings` and `entry_status`. */
  db: Db;
  /** One row of `shared/objectTypes.ts`. */
  config: ObjectTypeConfig;
  /**
   * The family's own blocking validation of a save, if it has one (task 4.2's DropTable
   * rules). Injected rather than hard-coded so the generic router stays generic and the
   * rule keeps its single home in `shared/`; `routes/index.ts` supplies the drop-table one.
   */
  validate?: ObjectSaveValidator;
}

export function createObjectRouter({ db, config, validate }: ObjectRouterOptions): Router {
  const router = Router();

  /** `settings.spiraldb_path`, or a 400 when it is unset. */
  function spiraldbRoot(res: Response): string | undefined {
    const root = (readSettings(db).spiraldb_path ?? '').trim();
    if (root === '') {
      res.status(400).json({
        error:
          `SpiralDB path is not configured. Set spiraldb_path in Settings before browsing or ` +
          `saving ${config.label}.`,
      } satisfies ApiError);
      return undefined;
    }
    return root;
  }

  /** The documented status mapping; 500 logs the thrown value like the middleware. */
  function fail(res: Response, error: unknown): void {
    if (error instanceof ObjectRequestError) {
      // The per-field map rides along when the family's validation produced one (the
      // body-shape checks carry none), exactly the quests 400's shape.
      res.status(400).json({
        error: error.message,
        ...(error.fields === undefined ? {} : { fields: error.fields }),
      } satisfies ApiError & { fields?: Record<string, string[]> });
      return;
    }
    if (error instanceof DirtyRepoError) {
      res.status(409).json({ error: error.message } satisfies ApiError);
      return;
    }
    console.error(`[spiraldb-ui] ${config.fileType} API error:`, error);
    res.status(500).json({
      error:
        error instanceof Error && error.message
          ? error.message
          : `The ${config.label} operation failed`,
    } satisfies ApiError);
  }

  router.get('/', (_req, res) => {
    const root = spiraldbRoot(res);
    if (root === undefined) {
      return;
    }
    try {
      // No index and no pipeline on the list path: it is a plain directory scan
      // (D12), so listing NpcDropTable never builds a runtime for an absent family.
      res.json(listObjects({ db, config, spiraldbPath: root }));
    } catch (error) {
      fail(res, error);
    }
  });

  router.get('/:key', (req, res) => {
    const root = spiraldbRoot(res);
    if (root === undefined) {
      return;
    }
    try {
      // A `'ulong'` family's route key is canonicalised through the one conversion
      // helper, so `38226` and `0038226` resolve the same entry (and match the text
      // form `entry_status.object_key` holds). A key the helper rejects is looked up
      // verbatim and simply does not resolve — a 404, not a 400: the key is unknown,
      // and the message says which one was asked for.
      const raw = req.params.key;
      const key = config.keyType === 'ulong' ? (ULong.toKey(raw) ?? raw) : raw;
      const { index } = objectRuntimeFor(db, root);
      // D12/D19: re-scan this family so a file changed or added outside the tool is
      // seen immediately.
      index.rebuildType(config.fileType);

      const detail = readObject({ config, index, key });
      if (detail === undefined) {
        res.status(404).json({
          error: `Unknown ${config.label} entry "${req.params.key}"`,
        } satisfies ApiError);
        return;
      }
      res.json(detail.object);
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
      const { index, pipeline } = objectRuntimeFor(db, root);
      res.json(
        await saveObjectEntry({
          db,
          config,
          index,
          pipeline,
          body: req.body,
          ...(validate === undefined ? {} : { validate }),
        }),
      );
    } catch (error) {
      fail(res, error);
    }
  });

  return router;
}
