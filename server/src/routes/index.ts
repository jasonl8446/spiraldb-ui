import { Router } from 'express';

/**
 * `/api` router registry.
 *
 * Task 1.1 mounts it empty on purpose — no `/api` endpoints exist yet, and this
 * story must not invent spec endpoints. Later Phase 1 tasks mount their routers
 * here: settings (1.3), sync + history (1.4g), names (1.5), status + dashboard (1.6).
 */
export const apiRouter: Router = Router();

/** Liveness probe. Not part of the REST spec — operational only. */
apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});
