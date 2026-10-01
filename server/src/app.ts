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

  // D196: every write is refused for a foreign origin before a body is parsed or a router runs.
  app.use('/api', refuseCrossOriginWrites(appOrigins()));

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

/** The names a loopback page reaches this tool by (`server/src/index.ts` binds `127.0.0.1`). */
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/**
 * The origins a page of **this app** sends (D196): the API's own port (`PORT`, the built client is
 * served by this process) and the Vite dev server's (`VITE_PORT`, default 5173 — its `/api` proxy
 * forwards the browser's `Origin` untouched; `changeOrigin` rewrites only `Host`), on every
 * loopback name. The tier-1 harness sets both (3181/5181), so its browser's
 * `Origin: http://localhost:5181` is one of them.
 */
export function appOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const ports = new Set([String(Number(env.PORT ?? 3001)), String(Number(env.VITE_PORT ?? 5173))]);
  const origins = new Set<string>();
  for (const host of LOOPBACK_HOSTS) {
    for (const port of ports) {
      origins.add(`http://${host}:${port}`);
    }
  }
  return origins;
}

/**
 * D196 (closes D94(c)'s write half; amends D88): a non-GET `/api` request is refused `403` when it
 * carries an `Origin` that is not one of {@link appOrigins}, or `Sec-Fetch-Site: cross-site`.
 *
 * D88's no-CORS rule stops a foreign page only where the browser needs a preflight, i.e. for the
 * non-simple `application/json` write. A bodiless `POST` (reject a suggestion, rebuild the drafts,
 * run a sync) or a multipart upload is a **simple** request: the browser sends it without asking,
 * and the side effect happens even though the page can never read the answer (final-review round
 * 1, M3, reproduced with `Origin: https://evil.example`, `Content-Type: text/plain`). Browsers set
 * `Origin` on every cross-origin `POST`/`PUT`/`PATCH`/`DELETE`, so checking it covers every write;
 * a request **without** one (curl, the CLI scripts, supertest) is not a browser page and passes.
 * `Origin: null` (a sandboxed frame, a `file:` page) is present and foreign, so it is refused.
 *
 * Reads (`GET`/`HEAD`/`OPTIONS`) are not checked: they have no side effect, and D88's missing
 * CORS grant already keeps their answers from a foreign page. The DNS-rebinding read residual
 * (a `Host` check) stays D94(c)'s recorded owner decision.
 */
export function refuseCrossOriginWrites(allowed: ReadonlySet<string>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }
    const origin = req.get('origin');
    const foreignOrigin = origin !== undefined && !allowed.has(origin);
    const crossSite = req.get('sec-fetch-site') === 'cross-site';
    if (foreignOrigin || crossSite) {
      res.status(403).json({
        error:
          `Refusing ${req.method} ${req.originalUrl}: the request came from ` +
          `${foreignOrigin ? `another origin (${origin})` : 'another site (Sec-Fetch-Site: cross-site)'}` +
          `, and this tool accepts writes only from its own pages.`,
      } satisfies ApiError);
      return;
    }
    next();
  };
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
