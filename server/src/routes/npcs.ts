import { Router, type Response } from 'express';

import type { ApiError } from '../../../shared/index.js';
import { readSettings, type Db } from '../db.js';
import { buildNpcView } from '../services/npcNames.js';
import { createSpiraldbIndex, type SpiraldbIndex } from '../services/spiraldbIndex.js';

/**
 * NPC view API — task 6.6, `GET /api/npcs/:id` (P6-17 / D112; docs/spec-api.md
 * L496-550).
 *
 * One NPC → its personas, dialogs, quests and NPC-keyed inventories, with counts
 * computed from the arms actually returned. `:id` is either form that resolves: the
 * numeric **template id** or an **alias-vocabulary key** (`WC-NPCs_00000027`,
 * `NPCs_…`, `WizardNPC_…`, a `Persona,First`/`Persona,Last` component). The response
 * echoes which form answered (`npc_key`, `template_id`).
 *
 * The arms resolve live: `personas` and the inventories from the indexed tables and
 * the D19 corpus index, `dialogs`/`quests` from a scan of the corpus quest files
 * (the speaker ladder's reverse — see `services/npcNames.ts`'s view section). No
 * materialised evidence table exists for the NPC view either.
 *
 * **Status code**: an id that resolves to nothing is `404 {"error": "Unknown NPC
 * \"…\""}` (spec L536) — the only error this route has, since both key forms are
 * text. Built from an injected connection and mounted lazily in `routes/index.ts`
 * (decision D32).
 */
export interface NpcsRouterOptions {
  db: Db;
}

export function createNpcsRouter({ db }: NpcsRouterOptions): Router {
  const router = Router();

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

  router.get('/:id', (req, res) => {
    const root = spiraldbRoot(res);
    if (root === undefined) {
      return;
    }
    try {
      const index = indexFor(root);
      // The four families this view reads are re-scanned so a file added or removed outside the
      // tool is seen immediately (D12/D19's on-demand rule; the quest corpus is the large one).
      index.rebuildType('questtemplates');
      for (const fileType of ['npcinventory', 'npcspellinventory', 'npcdroptable'] as const) {
        index.rebuildType(fileType);
      }

      const view = buildNpcView(db, index, req.params.id);
      if (view === undefined) {
        res.status(404).json({ error: `Unknown NPC "${req.params.id}"` } satisfies ApiError);
        return;
      }
      res.json({ npc: view });
    } catch (error) {
      console.error('[spiraldb-ui] npcs API error:', error);
      res.status(500).json({
        error: error instanceof Error && error.message ? error.message : 'The NPC lookup failed',
      } satisfies ApiError);
    }
  });

  return router;
}
