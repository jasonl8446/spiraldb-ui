import express, { type Express, type NextFunction, type Request, type Response } from 'express';

import { NOT_FOUND_MESSAGE, type ApiError } from '../../shared/index.js';
import { apiRouter } from './routes/index.js';

export interface CreateAppOptions {
  /**
   * Absolute path of the built client (`client/dist`). When provided (production,
   * see `server/src/index.ts`) the SPA is served from here with a history fallback.
   * Omitted in tests so route behaviour is deterministic.
   */
  staticDir?: string;
}

/**
 * Builds the Express application.
 *
 * Task 1.1 owns the bootstrap only: JSON body parsing, route mounting,
 * a JSON 404 envelope for unknown routes, and the error-handling middleware.
 * Feature routers are mounted under `/api` in `./routes/index.ts`.
 *
 * **No CORS, deliberately** (final-review gate 2, finding M1). The blanket
 * `cors()` this function used to install answered `Access-Control-Allow-Origin: *`
 * to any origin and approved a foreign-origin preflight for `PUT`, so a page the
 * owner merely visited could drive the write paths (they set `spiraldb_path` /
 * `git_branch` / `user_name` and then create objects, which commit into git). The
 * client is **same-origin in both modes** — dev goes through the Vite `/api` proxy
 * (`client/vite.config.ts`) and production is served by this same process — so no
 * CORS header is needed for the app to work, and the absence of one is also what
 * makes a cross-origin preflight fail: the browser then refuses to send the
 * non-simple `application/json` request at all. See `server/src/index.ts` for the
 * loopback bind that closes the other half of the exposure.
 */
export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  app.use(express.json());

  // Feature routes (names, status, settings, sync, dashboard, ...) mount here.
  app.use('/api', apiRouter);

  // Anything unmatched under /api/ is a JSON 404 — never the SPA HTML.
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: NOT_FOUND_MESSAGE } satisfies ApiError);
  });

  if (options.staticDir) {
    const staticDir = options.staticDir;
    app.use(express.static(staticDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile('index.html', { root: staticDir });
    });
  }

  // Non-API unknown routes get the same JSON envelope.
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: NOT_FOUND_MESSAGE } satisfies ApiError);
  });

  app.use(errorHandler);

  return app;
}

/**
 * Normalises any thrown value into the `{ "error": "..." }` envelope
 * (docs/spec-api.md L227). `status` is preserved when the error carries one
 * (body-parser sets 400 for malformed JSON).
 */
function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const status =
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { status?: unknown }).status === 'number'
      ? ((err as { status: number }).status ?? 500)
      : 500;
  const message =
    err instanceof Error && err.message
      ? err.message
      : typeof err === 'string' && err
        ? err
        : 'Internal server error';

  if (status >= 500) {
    console.error('[spiraldb-ui] unhandled error:', err);
  }

  res.status(status).json({ error: message } satisfies ApiError);
}

/** Application instance used by the HTTP server and by the supertest suite. */
export const app: Express = createApp();
