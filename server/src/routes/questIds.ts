import { Router, type Response } from 'express';

import type { ApiError } from '../../../shared/index.js';
import { readSettings, type Db } from '../db.js';
import { questEvidenceById } from '../services/questEvidence.js';
import { createSpiraldbIndex, type SpiraldbIndex } from '../services/spiraldbIndex.js';
import { DraftQueryError, parseStatusFilter, questSuggestionsById } from './drafts.js';

/**
 * Quest-id evidence API — task 6.6, `GET /api/quest-ids/:id/evidence`
 * (docs/spec-api.md L267-268, L420-492).
 *
 * One endpoint, one shape. The **id tier** is the second honest denominator
 * (`quest_ids`, ~4,830 ids the client holds text for): an id with no linked catalog
 * name answers `quest_name: null`, `has_definition: false` and a `title_source` read
 * from its own `quest_ids.link_kind` — the same `direct | inferred | none` enum, and
 * `inference_basis` beside it when the link is inferred.
 *
 * **Status codes** (the spec's own text, L492): an unknown id is `404
 * {"error": "Unknown quest \"…\""}` — the id is not a quest name, but the spec gives
 * one 404 text for both endpoints, so both use it verbatim rather than inventing a
 * second sentence. An id that is not a positive integer can reach no row and is the
 * same 404, never a 500 and never a path into SQL.
 *
 * Built from an injected connection and mounted lazily in `routes/index.ts`, so
 * importing `app.ts` never opens `data/spiraldb-ui.db` (decision D32).
 */
export interface QuestIdsRouterOptions {
  db: Db;
}

export function createQuestIdsRouter({ db }: QuestIdsRouterOptions): Router {
  const router = Router();

  // One index per SpiralDB root, rebuilt when the owner repoints the path — the same
  // per-root runtime the quests router keeps (`createQuestsRouter`).
  let runtime: { root: string; index: SpiraldbIndex } | undefined;

  function indexFor(root: string): SpiraldbIndex {
    if (runtime === undefined || runtime.root !== root) {
      const index = createSpiraldbIndex(root);
      index.rebuild();
      runtime = { root, index };
    }
    return runtime.index;
  }

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

  router.get('/:id/evidence', (req, res) => {
    const root = spiraldbRoot(res);
    if (root === undefined) {
      return;
    }
    const rawId = req.params.id;
    try {
      const index = indexFor(root);
      // D12/D19: the file behind a linked id is read fresh, so a file changed outside the tool
      // is seen immediately.
      index.rebuildType('questtemplates');

      const questId = /^\d+$/.test(rawId) ? Number(rawId) : Number.NaN;
      const result = Number.isSafeInteger(questId)
        ? questEvidenceById({ db, index }, questId)
        : ({ kind: 'unknown' } as const);
      if (result.kind === 'unknown') {
        res.status(404).json({ error: `Unknown quest "${rawId}"` } satisfies ApiError);
        return;
      }
      res.json(result.evidence);
    } catch (error) {
      console.error('[spiraldb-ui] quest-ids API error:', error);
      res.status(500).json({
        error:
          error instanceof Error && error.message ? error.message : 'The quest operation failed',
      } satisfies ApiError);
    }
  });

  /** `GET /api/quest-ids/:id/suggestions` — task 7.6 (D143): the unnamed tier's staged rows. */
  router.get('/:id/suggestions', (req, res) => {
    const rawId = req.params.id;
    try {
      const status = parseStatusFilter(req.query.status);
      const questId = /^\d+$/.test(rawId) ? Number(rawId) : Number.NaN;
      const body = Number.isSafeInteger(questId)
        ? questSuggestionsById(db, questId, status)
        : undefined;
      if (body === undefined) {
        res.status(404).json({ error: `Unknown quest "${rawId}"` } satisfies ApiError);
        return;
      }
      res.json(body);
    } catch (error) {
      if (error instanceof DraftQueryError) {
        res.status(400).json({ error: error.message } satisfies ApiError);
        return;
      }
      console.error('[spiraldb-ui] quest-ids API error:', error);
      res.status(500).json({
        error:
          error instanceof Error && error.message ? error.message : 'The quest operation failed',
      } satisfies ApiError);
    }
  });

  return router;
}
