import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SPIRALDB_COLLECTIONS } from '@server/services/spiraldbFiles';

/**
 * Story p5-04 (plan task 5.4) — the **error-envelope audit** (AC2, P5 AC#7, D37).
 *
 * > Every API route returns the `{ error: ... }` envelope with an appropriate status
 * > code on failure; no stack traces leak to clients.
 *
 * ## The route list is derived, not hand-written
 *
 * The eight generic families and every other feature router are mounted **lazily**
 * (`routes/index.ts`, decision D32), so their inner routers do not exist until the
 * first request and cannot be reached by walking `apiRouter.stack`. This audit
 * therefore does two things:
 *
 * 1. it walks `apiRouter.stack` for the set of **mount prefixes** — the part a new
 *    route family cannot avoid adding to; and
 * 2. it records every router instance at request time (by wrapping
 *    `express.Router.handle`, the shared prototype of every router this app builds)
 *    after probing each mount prefix once, so the previously lazily-built routers
 *    can be walked too.
 *
 * A route that escapes both is still caught: `every enumerated route carries a probe`
 * and `every mount prefix was reached` fail loudly when a new route or a new family
 * appears without an entry here. That is the point of deriving the list — a future
 * route cannot pass this audit by being forgotten.
 *
 * ## Hermetic (D17/D44/D81)
 *
 * The audit never points at the owner's SpiralDB fork or at the developer's
 * `data/spiraldb-ui.db`: `SPIRALDB_UI_DB=:memory:` (the documented `getDb()` override)
 * and `SPIRALDB_PATH` at a **throwaway, empty corpus** created under `os.tmpdir()`
 * (one empty directory per `SPIRALDB_COLLECTIONS` row). So no assertion here depends on
 * what the corpus happens to contain — an unknown key is a 404 because nothing exists,
 * not because the owner's clone says so, and the sweep makes a name-sync or an import
 * of the real corpus impossible.
 */

/** Serpentine determinism: the value no fixture ever holds, used for "missing". */
const MISSING = '___p5_04_audit_missing___';

type HttpMethod = 'get' | 'post' | 'put' | 'patch';

interface RouteRecord {
  method: HttpMethod;
  /** Full URL path with the `/api` prefix and its `:params` intact. */
  path: string;
}

interface Probe {
  route: RouteRecord;
  /** The malformed input, named for the failure message. */
  input: string;
  url: string;
  body?: string;
  /**
   * Exact status the route must answer. Every one is a **client** error: a malformed
   * request answered with 500 would mean the route let the failure escape.
   */
  status: number;
}

interface ProbeResult extends Probe {
  actual: number;
  contentType: string;
  text: string;
}

interface LayerLike {
  route?: { path: string; methods: Record<string, boolean | undefined> };
  regexp?: RegExp;
  handle?: unknown;
}

/**
 * `express.Router.handle` — in Express 4 every router instance is built by
 * `Router()` and inherits from the exported function itself, so wrapping this one
 * property catches every router the app builds, including the lazily-mounted ones.
 * The real Express type is `Router & { handle: ... }`; the app only needs the shape
 * below, and the cast keeps this file free of `any`.
 */
const expressCjs = createRequire(import.meta.url)('express') as {
  Router: { handle: (req: unknown, res: unknown, next: unknown) => void };
};

const MOUNT_SUFFIX = '\\/?(?=\\/|$)';

/** `/drop-tables` from the layer regexp `^\/drop-tables\/?(?=\/|$)`. */
function mountPrefixFromLayer(layer: LayerLike): string | undefined {
  const source = layer.regexp?.source;
  if (source === undefined || !source.startsWith('^')) {
    return undefined;
  }
  const body = source.slice(1);
  if (!body.endsWith(MOUNT_SUFFIX)) {
    return undefined;
  }
  return body.slice(0, -MOUNT_SUFFIX.length).replace(/\\\//g, '/');
}

/** The exact strength of the no-leak rule; see the header of `leaks`. */
const LEAK_PATTERNS: Array<[name: string, pattern: RegExp]> = [
  // A stack frame is a newline followed by indented `at ...` — the single most
  // reliable discriminator, independent of what any message says.
  ['stack frame line', /\n\s*at\s/],
  // `at fn (/path/file.ts:12:3)` and bare `(/path/file.ts:12:3)` forms.
  ['source file with line number', /\.(?:ts|tsx|js|mjs|cjs):\d+(?::\d+)?/],
  ['node_modules path', /node_modules/],
  // An absolute filesystem path in a *body*. Every probe below is a validation
  // failure, whose message describes the request, never a file on disk.
  ['absolute filesystem path', /(?:^|[\s"'(=])\/(?:home|Users|tmp|private|var|workspace|root)\//],
];

/**
 * `leaks` reports the no-leak violations in a response body, by name.
 *
 * It asserts on the **shape** rather than on one sample message (the failure mode the
 * story names): the body must be a single-line `{ error }`, must not carry a `stack`
 * key, and its text must match none of `LEAK_PATTERNS`.
 */
function leaks(text: string): string[] {
  const found: string[] = [];
  if (/\n/.test(text.trim())) {
    found.push('multi-line body (a stack trace cannot be one line)');
  }
  if (/"stack"\s*:/.test(text)) {
    found.push('a "stack" key');
  }
  for (const [name, pattern] of LEAK_PATTERNS) {
    if (pattern.test(text)) {
      found.push(name);
    }
  }
  return found;
}

/**
 * `true` when `body` is the D37 envelope: a non-empty string `error`, plus the one
 * documented companion (`fields`, the per-field map a 400 may carry — D64). Nothing
 * else may ride along: an unexpected key is how a stack or a debug dump would escape.
 */
function isEnvelope(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return false;
  }
  const keys = Object.keys(body).sort().join(',');
  if (keys !== 'error' && keys !== 'error,fields') {
    return false;
  }
  const error = (body as { error: unknown }).error;
  return typeof error === 'string' && error.trim().length > 0;
}

/**
 * The malformed input each route is driven with.
 *
 * Rules first, outliers after — and every rule is stated as *the* malformed input for
 * that route shape, so the table can be read as the audit's contract:
 *
 * - a write route: a syntactically broken JSON body (400 from `express.json()`), plus
 *   a well-formed but wrong-shaped body (`[]`) for the routes whose validator rejects it;
 * - a route with a `:param`: a key/type that cannot exist (404 for a missing resource)
 *   or a value the route's own type check rejects;
 * - the two routes with a documented query contract (`/api/activity`, `/api/search`
 *   `?limit=`): a limit that is not a positive integer (400);
 * - a route with **no input at all**: a garbage query string it must tolerate (200) —
 *   it can be made to fail only by breaking its dependency, which is the induced-500
 *   test at the end of this file.
 */
function probesFor(route: RouteRecord): Probe[] {
  const { method, path: routePath } = route;
  const out: Probe[] = [];
  const hasParam = routePath.includes(':');

  if (method === 'get') {
    if (routePath === '/api/names/:type') {
      out.push(
        { route, input: 'a type no name table backs', url: '/api/names/not-a-type', status: 404 },
        {
          route,
          input: 'a limit that is not a positive integer',
          url: '/api/names/items?limit=not-a-number',
          status: 400,
        },
      );
      return out;
    }
    if (routePath === '/api/names/:type/:id') {
      out.push({
        route,
        input: 'an id that is not in the table',
        url: `/api/names/items/${MISSING}`,
        status: 404,
      });
      return out;
    }
    if (routePath === '/api/status/:type') {
      out.push({
        route,
        input: 'a type with no lifecycle',
        url: '/api/status/not-a-type',
        status: 404,
      });
      return out;
    }
    if (routePath === '/api/status/:type/:key/history') {
      out.push({
        route,
        input: 'a key that does not exist',
        url: `/api/status/quests/${MISSING}/history`,
        status: 404,
      });
      return out;
    }
    if (hasParam) {
      // The remaining `:param` GETs (`/api/quests/:name`, the eight `/:key` detail
      // routes) resolve the key against the empty fixture corpus. For the unkeyed
      // GlobalRegistry (D74) that matters: `readObject` answers 404 only when the
      // directory holds no JSON entry at all, and otherwise resolves the key to a
      // *file*, falling back to the convention file — so on the real corpus an unknown
      // key answers 200 with the merged document. This audit's fixture is empty, which
      // is what makes "an unknown key is a failure" deterministic here; the variance is
      // stated in the story's evidence file rather than hidden behind a fixture file.
      out.push({
        route,
        input: 'a key that does not exist',
        url: routePath.replace(/:[A-Za-z]+/g, MISSING),
        status: 404,
      });
      return out;
    }
    if (routePath === '/api/activity' || routePath === '/api/search') {
      out.push({
        route,
        input: 'a limit that is not a positive integer',
        url: `${routePath}?limit=not-a-number`,
        status: 400,
      });
      return out;
    }
    // No input surface: the route must tolerate a garbage query rather than fail.
    out.push({
      route,
      input: 'a garbage query string it must ignore',
      url: `${routePath}?limit=not-a-number&q=%00&${MISSING}=1`,
      status: 200,
    });
    return out;
  }

  // Write routes. The broken-JSON probe is universal: `express.json()` answers 400
  // before any handler runs, so it is safe for every write — including `/api/sync`,
  // whose body is ignored (a *valid* sync body would run a real name sync, which this
  // audit must never do).
  out.push({
    route,
    input: 'a syntactically broken JSON body',
    url: routePath.replace(/:[A-Za-z]+/g, MISSING),
    body: '{',
    status: 400,
  });
  if (routePath === '/api/sync') {
    return out;
  }
  if (routePath === '/api/status/:type/:key') {
    out.push({
      route,
      input: 'a missing status in a well-formed body',
      url: routePath.replace(':type', 'quests').replace(':key', MISSING),
      body: '{}',
      status: 400,
    });
    return out;
  }
  // A JSON array is a well-formed body the object/quest/settings validators reject by
  // shape. `/api/extract/quests` answers its own 400 (no file in the `file` field).
  out.push({
    route,
    input: 'a JSON array where an object is required',
    url: routePath,
    body: '[]',
    status: 400,
  });
  return out;
}

describe('API error envelope audit (AC2 / D37)', () => {
  let app: Express;
  const routes: RouteRecord[] = [];
  let mountPrefixes: string[] = [];
  let capturedBaseUrls: Set<string> = new Set();
  const results: ProbeResult[] = [];
  let uncoveredRoutes: string[] = [];
  let staleProbes: string[] = [];
  const unknownRouteResults: Array<{ url: string; status: number; text: string }> = [];
  let fixtureDir = '';
  const originalEnv: Record<string, string | undefined> = {
    SPIRALDB_UI_DB: process.env.SPIRALDB_UI_DB,
    SPIRALDB_PATH: process.env.SPIRALDB_PATH,
    AURORIUM_PATH: process.env.AURORIUM_PATH,
    IMCODEC_PATH: process.env.IMCODEC_PATH,
  };
  const originalHandle = expressCjs.Router.handle;

  beforeAll(async () => {
    // 1. A throwaway corpus: one empty directory per collection (the file layer's own
    //    table, so a new family is covered without editing this list).
    fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'p5-04-envelope-'));
    for (const collection of SPIRALDB_COLLECTIONS) {
      mkdirSync(path.join(fixtureDir, collection.directory), { recursive: true });
    }

    // 2. Hermetic databases/corpus. Both are read by `getDb()`/`seedSettings()` at the
    //    first request, never at import time.
    process.env.SPIRALDB_UI_DB = ':memory:';
    process.env.SPIRALDB_PATH = fixtureDir;

    // 3. Record every router instance as it serves a request. `req.baseUrl` is the
    //    router's real mount path ('/api/settings', '/api/drop-tables', ...), which is
    //    exactly what the lazily-mounted routers do not otherwise expose.
    expressCjs.Router.handle = function recordingHandle(
      this: unknown,
      req: unknown,
      res: unknown,
      next: unknown,
    ): void {
      const baseUrl = (req as { baseUrl?: unknown }).baseUrl;
      const key = typeof baseUrl === 'string' ? baseUrl : '';
      captured.set(key, this);
      return originalHandle.call(this, req, res, next);
    };
    const captured = new Map<string, unknown>();

    const { app: createdApp } = await import('@server/app');
    const { apiRouter } = await import('@server/routes/index');
    app = createdApp;

    // 4. Mount prefixes, straight from the mounted router.
    const stack = (apiRouter as unknown as { stack: LayerLike[] }).stack;
    mountPrefixes = stack
      .filter((layer) => layer.route === undefined)
      .map((layer) => mountPrefixFromLayer(layer))
      .filter((prefix): prefix is string => prefix !== undefined);

    // 5. Force every lazily-mounted router to build (one probe per prefix, plus one
    //    for the routes mounted on `apiRouter` itself), which is also what records the
    //    instances in step 3.
    for (const prefix of [...mountPrefixes, '']) {
      await request(app).get(`/api${prefix}/${MISSING}`);
    }
    capturedBaseUrls = new Set(captured.keys());

    // 6. Enumerate. A router's route path is relative to its `baseUrl`.
    const seen = new Set<string>();
    for (const [baseUrl, router] of captured) {
      if (baseUrl !== '/api' && !baseUrl.startsWith('/api/')) {
        continue;
      }
      for (const layer of (router as { stack: LayerLike[] }).stack) {
        const route = layer.route;
        if (route === undefined) {
          continue;
        }
        const fullPath = `${baseUrl}${route.path === '/' ? '' : route.path}`;
        for (const [method, enabled] of Object.entries(route.methods)) {
          if (enabled !== true || !['get', 'post', 'put', 'patch'].includes(method)) {
            continue;
          }
          if (seen.has(`${method} ${fullPath}`)) {
            continue;
          }
          seen.add(`${method} ${fullPath}`);
          routes.push({ method: method as HttpMethod, path: fullPath });
        }
      }
    }
    routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

    // 7. Drive every route with its malformed input, once.
    const allProbes = routes.flatMap((route) => probesFor(route));
    const known = new Set(routes.map((route) => `${route.method} ${route.path}`));
    uncoveredRoutes = routes
      .filter((route) => !allProbes.some((probe) => probe.route === route))
      .map((route) => `${route.method} ${route.path}`);
    staleProbes = allProbes
      .filter((probe) => !known.has(`${probe.route.method} ${probe.route.path}`))
      .map((probe) => `${probe.route.method} ${probe.route.path} (${probe.input})`);

    for (const probe of allProbes) {
      const agent = request(app);
      const pending =
        probe.route.method === 'get'
          ? agent.get(probe.url)
          : probe.route.method === 'post'
            ? agent.post(probe.url)
            : probe.route.method === 'put'
              ? agent.put(probe.url)
              : agent.patch(probe.url);
      const res =
        probe.body === undefined
          ? await pending
          : await pending.set('Content-Type', 'application/json').send(probe.body);
      results.push({
        ...probe,
        actual: res.status,
        contentType: String(res.headers['content-type'] ?? ''),
        text: res.text,
      });
    }

    // 8. One unknown sibling path per mount: a client typo under any mount must get the
    //    JSON envelope, never HTML — and never a 500.
    for (const prefix of [...mountPrefixes, '']) {
      const url = `/api${prefix}/${MISSING}`;
      const res = await request(app).delete(url);
      unknownRouteResults.push({ url, status: res.status, text: res.text });
    }
  });

  afterAll(() => {
    expressCjs.Router.handle = originalHandle;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    if (fixtureDir !== '') {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('enumerates the mounted router rather than a hand-written list', () => {
    // Not a magic number for its own sake: it is the "did discovery actually run"
    // floor. The per-route count is reported in the story's evidence file.
    expect(routes.length).toBeGreaterThanOrEqual(40);
    // Every mount prefix the mounted router declares must have been reached by the
    // discovery probe — a new family that fails to build fails here instead of quietly
    // shrinking the audit.
    const unreached = mountPrefixes.filter((prefix) => !capturedBaseUrls.has(`/api${prefix}`));
    expect(unreached).toEqual([]);
    expect(mountPrefixes.length).toBeGreaterThanOrEqual(17);
  });

  it('covers every enumerated route with a malformed-input probe', () => {
    // The anti-escape property: a route added without a probe fails the audit.
    expect(uncoveredRoutes).toEqual([]);
    expect(staleProbes).toEqual([]);
  });

  it('answers every malformed request with the documented status and the { error } envelope', () => {
    const failures = results
      .filter((result) => {
        if (result.actual !== result.status) {
          return true;
        }
        // A failure must speak the envelope; the tolerant probes (a route with no
        // input, answered 200) have a success body, which is a different contract.
        return result.actual >= 400 && !isEnvelope(JSON.parse(result.text || 'null') as unknown);
      })
      .map(
        (result) =>
          `${result.route.method.toUpperCase()} ${result.url} [${result.input}] → ` +
          `${result.actual} (expected ${result.status}): ${result.text.slice(0, 160)}`,
      );
    expect(failures).toEqual([]);
  });

  it('leaks no stack trace, no source file and no filesystem path in the 400s it probes', () => {
    // Only *error* bodies are checked: `GET /api/settings` legitimately answers with
    // the configured absolute paths, so "no filesystem path" is a rule about failures
    // (where a path would name an internal file), not about success payloads.
    //
    // Scope, stated: every probe below is a **malformed request** (a 400), so this arm proves
    // the 400 surface only. A 5xx is *allowed* to name a path — `app.ts`'s `errorHandler`
    // returns `err.message` and the file layer's messages name the file (D37/D38, deliberate
    // actionability: the operator has to be able to find it) — so reading this arm as "no error
    // body ever names a path" would over-read it (final-review gate 2, N2).
    const errorBodies = results.filter((result) => result.actual >= 400);
    expect(errorBodies.length).toBeGreaterThan(30);
    const failures = errorBodies.flatMap((result) => {
      const parsed = JSON.parse(result.text || 'null') as unknown;
      const message = isEnvelope(parsed) ? (parsed as { error: string }).error : undefined;
      const violations = leaks(message ?? result.text);
      return violations.map(
        (violation) =>
          `${result.route.method.toUpperCase()} ${result.url} [${result.input}] → ${violation}: ` +
          `${result.text.slice(0, 200)}`,
      );
    });
    expect(failures).toEqual([]);
  });

  it('answers every malformed request as JSON, never HTML', () => {
    const failures = results
      .filter((result) => !/^application\/json/.test(result.contentType))
      .map(
        (result) =>
          `${result.route.method.toUpperCase()} ${result.route.path} → ${result.contentType}`,
      );
    expect(failures).toEqual([]);
  });

  it('answers an unknown path under every mount with the JSON 404 envelope', () => {
    const failures = unknownRouteResults
      .filter((result) => result.status !== 404)
      .map((result) => `DELETE ${result.url} → ${result.status}`);
    expect(failures).toEqual([]);
    const nonEnvelope = unknownRouteResults
      .filter((result) => !isEnvelope(JSON.parse(result.text || 'null') as unknown))
      .map((result) => `DELETE ${result.url} → ${result.text.slice(0, 120)}`);
    expect(nonEnvelope).toEqual([]);
  });

  /**
   * The 5xx path is the one a naive handler leaks a stack through, and no malformed
   * *input* reaches it (every route above answers 4xx). So the failure is injected
   * instead: with the shared connection closed, a data-backed read throws inside the
   * handler and the app's error middleware must answer the envelope.
   *
   * Deliberately last in the file — it leaves the shared connection closed (the
   * routers hold the handle they were built with, so this cannot be undone).
   */
  it('answers a thrown dependency error with a 500 { error } envelope and no stack', async () => {
    const { closeDb } = await import('@server/db');
    closeDb();

    const res = await request(app).get('/api/settings');

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    const body = res.body as unknown;
    expect(isEnvelope(body)).toBe(true);
    expect(leaks((body as { error: string }).error)).toEqual([]);
    // A 500's message must not become a document dump either.
    expect(res.text.length).toBeLessThan(500);
    expect(res.text).not.toMatch(/<html/i);
  });
});
