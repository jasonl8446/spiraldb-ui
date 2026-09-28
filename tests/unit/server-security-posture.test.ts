import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '@server/app';

import { codeOf } from '../helpers/source-text';

/**
 * D88 / final-review gate 2 finding M1 — the loopback-only, no-CORS posture, pinned.
 *
 * ## Why this file exists
 *
 * The independent architect's verification (`docs/evidence/architect-verification.md`,
 * DR-15) measured that the **HIGH** fix was verified by measurement only: a `grep` for
 * CORS/loopback terms across `tests/` returned two hits, both a comment in
 * `tests/unit/extract-api.test.ts` ("No `cors()`: this app mirrors the real
 * composition…"), and **no test imported `server/src/index.ts` at all**. So
 * `app.use(cors())` and a bare `app.listen(PORT)` could both come back and every suite
 * would stay green — a security fix whose removal is not tested is a fix that regresses
 * silently. This file is the regression pin DR-15 asked for.
 *
 * ## The app under test is the real one
 *
 * `createApp()` — the same factory `server/src/index.ts` hands to `listen` — not a
 * hand-built mirror. That distinction is not pedantry: the fix's own comment says an
 * app that "mirrors the real composition" is already there (`extract-api.test.ts:51`),
 * and a mirror is exactly how this drift starts — the previous security work had to
 * change a mirror app **by hand** to keep it honest.
 *
 * ## The four ways a weaker test would be vacuous, and what is done instead
 *
 * 1. **A positive partner per route** (D78(d)): for every "the header is absent" arm
 *    there is a same-route request that must answer **200**, so the absence is the
 *    header's absence and not the route's.
 * 2. **The preflight, not only the simple request**: the reproduced exploit's wire
 *    shape was an `OPTIONS` preflight answered `204` with methods, followed by a `PUT`
 *    — so the preflight is asserted for a foreign `Origin` *and*
 *    `Access-Control-Request-Method: PUT`.
 * 3. **The whole `Access-Control-*` name space**, not one remembered header: every
 *    such header is collected and asserted empty, and both headers a browser acts on
 *    (`Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`) are asserted by
 *    name for the failure message.
 * 4. **The `Vary: Origin` marker, and where each arm's reach actually ends**: every one
 *    of these boundaries was measured against the real `cors` package rather than
 *    assumed, because a sub-assertion that never fires is decoration. A wildcard
 *    re-install is caught by the `Access-Control-Allow-Origin` arm. A string-origin
 *    re-install sets `Access-Control-Allow-Origin` to its *configured* origin regardless
 *    of who asked, so that arm catches it too. An **array**-origin re-install denies the
 *    foreign origin and therefore emits no `Access-Control-Allow-Origin` at all on a
 *    simple request — it is caught by the `Vary: Origin` arm and by nothing else
 *    (measured: `vary: Origin`, `access-control-allow-origin: undefined`, and the failing
 *    assertion is this one). And a **function**-origin allowlist that denies the foreign
 *    origin emits no header whatsoever (the package calls `next()` and stops), so it is
 *    outside this pin's reach — stated rather than hidden, and not a hole in the security
 *    property: a request that receives no `Access-Control-Allow-Origin` is one a foreign
 *    page cannot read or drive. What is pinned is that no foreign-origin request is ever
 *    **granted**, not that no CORS code exists anywhere.
 *
 * 5. **Per-route evasion, and the source itself** (added by the unattended review). Arms 1–4
 *    probe two routes by hand, so a router that installs its own `Access-Control-*` header —
 *    at `router.use` level or inside one handler — passed every one of them. Two arms close
 *    that: a foreign-origin **GET and preflight against every mount prefix** derived from
 *    `apiRouter.stack` (the lazy `apiRouter.use('/x', (req,res,next) => …)` wrappers are
 *    exactly where such a header would be set), and a comment-stripped **scan of every
 *    `server/src` source** for any `Access-Control` literal, any `cors` import, and any
 *    `cors` dependency. Both fail closed: the derived prefix count and the scanned file
 *    count are asserted non-trivial, so a broken derivation cannot pass by enumerating
 *    nothing. The scan's honest limit: it reads text, so a header assembled from string
 *    fragments (`'Access' + '-Control-…'`) would escape it — the per-prefix behaviour arm
 *    is what catches that, and neither arm claims to catch a `next()`-only denylist, for
 *    the same reason arm 4's function-origin case does not.
 *
 * One measurement worth naming, because it looks like an approval and is not: Express's
 * own default handler answers an unmatched `OPTIONS` with a plain `Allow` header —
 * measured `Allow: GET,HEAD,PUT` on `/api/settings`. That is **not** a CORS grant: a
 * page at another origin cannot read any response header without
 * `Access-Control-Allow-Origin`. The assertions below are on the `Access-Control-*`
 * names specifically and never on "a header that names PUT".
 *
 * ## The loopback half is a **source** assertion — and this is its limitation
 *
 * `server/src/index.ts` starts listening when imported (it opens the database and runs
 * the first-startup import), so no test in this suite imports it and this file does not
 * either: booting the entrypoint from a unit test would break the D17/D44 hermeticity
 * this suite is built on, and no repository convention does it. A behavioural check
 * (spawn it on a port we own, then read the bound socket) exists — it is what the
 * architect's own rig measured (`127.0.0.1:5399`, LAN probe refused, `rc=7`) — but it
 * stays a manual rig rather than a unit test.
 *
 * So this is a **reading of the source, not an observation of a socket**, and its
 * honest limits are:
 *
 * - it cannot catch a listener that is not this call — a second `listen`, a proxy, or a
 *   bind moved into another module;
 * - it proves the literal in the text, not that the running process's socket is
 *   loopback-only;
 * - a *different* non-loopback literal **is** caught (`HOST` is asserted to equal
 *   `'127.0.0.1'` exactly, so `0.0.0.0` / `'localhost'` / `'::1'` all fail), but a call
 *   that stops matching the pattern fails closed rather than passing.
 *
 * ## Hermeticity
 *
 * `/api/health` touches no database. `/api/settings` — the exploit's target — opens one
 * lazily on its first request, so `SPIRALDB_UI_DB=:memory:` is set for this file (the
 * documented `getDb()` override, D44) and restored afterwards, as in
 * `tests/unit/api-error-envelope.test.ts`. The developer's `data/spiraldb-ui.db` is never
 * opened.
 */

/** The real composition: what `server/src/index.ts` passes to `app.listen`. */
const app = createApp();

/** A page the owner merely visited, at an origin that is not the app's own. */
const FOREIGN_ORIGIN = 'http://foreign.example';

/** The reproduced exploit's preflight exactly: a foreign origin asking to PUT. */
const EXPLOIT_PREFLIGHT = {
  Origin: FOREIGN_ORIGIN,
  'Access-Control-Request-Method': 'PUT',
  'Access-Control-Request-Headers': 'content-type',
};

const ORIGINAL_DB_ENV = process.env.SPIRALDB_UI_DB;

beforeAll(() => {
  process.env.SPIRALDB_UI_DB = ':memory:';
});

afterAll(() => {
  if (ORIGINAL_DB_ENV === undefined) {
    delete process.env.SPIRALDB_UI_DB;
  } else {
    process.env.SPIRALDB_UI_DB = ORIGINAL_DB_ENV;
  }
});

/** Every `Access-Control-*` header name in a response (Node lower-cases names). */
function accessControlHeaders(headers: Record<string, string | string[] | undefined>): string[] {
  return Object.keys(headers).filter((name) => name.toLowerCase().startsWith('access-control-'));
}

/**
 * The whole no-CORS rule, in one place, for both the simple request and the preflight:
 * no `Access-Control-*` header of any name, the two the browser acts on named
 * explicitly, and no `Vary: Origin` — the marker the `cors` package adds for any
 * origin-varying configuration, and the only arm that catches an array-origin
 * re-install on a simple request (the measured boundary table is in this file's header).
 */
function expectNoCorsGrant(headers: Record<string, string | string[] | undefined>): void {
  const found = accessControlHeaders(headers);
  expect(
    found,
    `Access-Control-* headers on a foreign-origin response: ${found.join(', ')}`,
  ).toEqual([]);
  expect(
    headers['access-control-allow-origin'],
    'the header a browser reads as a CORS grant',
  ).toBeUndefined();
  expect(
    headers['access-control-allow-methods'],
    "the header the exploit's approved preflight read",
  ).toBeUndefined();
  expect(
    String(headers['vary'] ?? '').toLowerCase(),
    'Vary: Origin — how cors() marks an answer that varies by origin',
  ).not.toContain('origin');
}

describe('D88 — the API answers no CORS grant to a foreign origin (M1)', () => {
  it('gives a foreign-origin simple GET no Access-Control-* header, and the same route still answers 200', async () => {
    const foreign = await request(app).get('/api/health').set('Origin', FOREIGN_ORIGIN);

    expectNoCorsGrant(foreign.headers);
    expect(
      foreign.status,
      'the same route answers for a foreign origin too, so the absence above is a header absence, not a route one',
    ).toBe(200);

    // The positive partner (D78(d)): the identical request with no `Origin` — what the
    // same-origin client sends — must be served, with the same body.
    const sameOrigin = await request(app).get('/api/health');

    expect(sameOrigin.status).toBe(200);
    expect(sameOrigin.body).toEqual({ status: 'ok' });
    expectNoCorsGrant(sameOrigin.headers);
  });

  it("does not approve the exploit's preflight (foreign Origin, PUT) with methods or a 204", async () => {
    const preflight = await request(app).options('/api/settings').set(EXPLOIT_PREFLIGHT);

    expectNoCorsGrant(preflight.headers);
    // The exploit's shape was a `204` carrying `Access-Control-Allow-Methods: PUT`.
    expect(preflight.status, 'the status cors() answers an approved preflight with').not.toBe(204);
    expect(preflight.headers['access-control-allow-methods']).toBeUndefined();
  });

  it("leaves the exploit's target route unmarked for a foreign origin, while answering a same-origin GET", async () => {
    const foreign = await request(app).get('/api/settings').set('Origin', FOREIGN_ORIGIN);

    expectNoCorsGrant(foreign.headers);
    expect(foreign.status).toBe(200);

    // The positive partner for this route: the same-origin read the editor performs,
    // carrying the field the exploit wrote (`settings.user_name`).
    const sameOrigin = await request(app).get('/api/settings');

    expect(sameOrigin.status).toBe(200);
    expect(Object.keys(sameOrigin.body as Record<string, unknown>)).toContain('user_name');
    expectNoCorsGrant(sameOrigin.headers);
  });
});

/**
 * The entrypoint, read as text — see the limitation in this file's header. Each arm is
 * fail-closed: a rewrite that stops matching the pattern (a renamed constant, a bind
 * moved elsewhere) makes the assertion fail rather than pass.
 */
describe('server/src/index.ts binds the loopback literal (source assertion)', () => {
  const INDEX_SRC = readFileSync(
    fileURLToPath(new URL('../../server/src/index.ts', import.meta.url)),
    'utf8',
  );

  /**
   * The entrypoint's **code**, with comments removed (see `codeOf`'s note at module scope):
   * the real file's own docblock quotes the vulnerable form while explaining why it was
   * rejected, and the first version of this assertion matched that mention instead of the
   * real call.
   */

  /** The value of the entrypoint's `const HOST = '...'` declaration. */
  function hostLiteral(src: string): string | undefined {
    return /const\s+HOST\s*=\s*'([^']*)'/.exec(src)?.[1];
  }

  /**
   * The named arguments of the entrypoint's `app.listen(...)` call: trimmed, with the
   * callback's own `(` (the arrow function's parameter list) dropped, so the real
   * two-argument call yields `['PORT', 'HOST']` and a reverted port-only
   * `app.listen(PORT)` yields `['PORT']` — the second slot is then genuinely absent and
   * says so, rather than reporting the arrow's `(`.
   */
  function listenArguments(src: string): string[] | undefined {
    const args = /app\.listen\(([^)]*)\)/.exec(src)?.[1];
    if (args === undefined) {
      return undefined;
    }
    return args
      .replace(/\(\s*$/, '')
      .split(',')
      .map((argument) => argument.trim())
      .filter((argument) => argument.length > 0);
  }

  const INDEX_CODE = codeOf(INDEX_SRC);

  it("declares HOST as the IPv4 loopback literal, '127.0.0.1'", () => {
    expect(hostLiteral(INDEX_CODE), 'the HOST literal in server/src/index.ts').toBe('127.0.0.1');
  });

  it('passes HOST to app.listen, not a port-only listen that would bind the wildcard', () => {
    const args = listenArguments(INDEX_CODE);
    expect(
      args,
      'app.listen(...) in server/src/index.ts (a rewrite that hides the bind must fail, not pass)',
    ).toBeDefined();

    expect(args?.[1], 'the second app.listen argument').toBe('HOST');
  });

  it('installs no middleware of its own — the arm a test over the createApp() object cannot see', () => {
    // The CORS arms above run against the object `createApp()` returns. Middleware
    // added in the entrypoint *after* that call would sit outside that object and
    // outside those arms, so the entrypoint is pinned to add none: with both arms,
    // the running composition and the tested object are the same composition.
    expect(INDEX_CODE, 'an app.use( in the entrypoint').not.toMatch(/app\.use\(/);
  });
});

/* ------------------------------------------------- per-family evasion (added by the review) */

interface LayerLike {
  route?: { path: string };
  regexp?: RegExp;
}

const MOUNT_SUFFIX = '\\/?(?=\\/|$)';

/**
 * `/drop-tables` from the layer regexp `^\/drop-tables\/?(?=\/|$)` — the same derivation the
 * route-envelope audit uses (`tests/unit/api-error-envelope.test.ts`), so the two files cannot
 * disagree about what "every mount prefix" means.
 */
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

describe('D88 — no mounted router family installs its own CORS grant (per-route evasion)', () => {
  /**
   * Every mount prefix, plus `''` for the routes mounted on `apiRouter` itself — derived from
   * the router rather than hand-listed, so a **new** family is probed the day it is mounted.
   * The lazy `apiRouter.use('/x', (req, res, next) => { router ??= create…Router(); … })`
   * wrappers are the interesting case: a header set there runs for every request into that
   * family while being invisible to a test that only probes two hand-picked routes.
   */
  async function mountPrefixes(): Promise<string[]> {
    const { apiRouter } = await import('@server/routes/index');
    const stack = (apiRouter as unknown as { stack: LayerLike[] }).stack;
    return [
      '',
      ...stack
        .filter((layer) => layer.route === undefined)
        .map((layer) => mountPrefixFromLayer(layer))
        .filter((prefix): prefix is string => prefix !== undefined),
    ];
  }

  it('gives a foreign-origin GET and preflight at every mount prefix no Access-Control-* header', async () => {
    const prefixes = await mountPrefixes();
    expect(
      prefixes.length,
      'mount prefixes derived from apiRouter.stack — a broken derivation must fail, not pass vacuously',
    ).toBeGreaterThanOrEqual(10);

    const measured: Record<string, number> = {};
    for (const prefix of prefixes) {
      // A subpath no route can match: the family's mount wrapper and its router-level
      // middleware run, the route layer does not.
      const url = `/api${prefix}/___posture_probe___`;

      const simple = await request(app).get(url).set('Origin', FOREIGN_ORIGIN);
      expectNoCorsGrant(simple.headers);
      // The probe must be answered as **this application's JSON**, so the absence above is an absence
      // rather than a dead socket or a non-JSON stub. It is deliberately *only* that:
      //
      //  - pinning `< 500` was this arm's own **CI-only defect** (PR #8's `ci` run, 34 s,
      //    `expected 500 to be less than 500`): on a runner with no corpus (D55) a data-reading
      //    family legitimately fails through the error handler;
      //  - pinning the `{ error }` envelope was the same mistake one step further in: locally
      //    `/api/global-registry/___posture_probe___` *matches a real route* and answers that
      //    family's own JSON document, with no `error` key at all.
      //
      // What holds in every environment is the media type; the traversal claim is carried by the
      // per-prefix loop itself plus the root probe below.
      expect(
        String(simple.headers['content-type'] ?? ''),
        `GET ${url} was answered as this app's JSON`,
      ).toContain('application/json');

      // The exploit's wire shape per family, not only for `/api/settings`.
      const preflight = await request(app).options(url).set(EXPLOIT_PREFLIGHT);
      expectNoCorsGrant(preflight.headers);
      expect(preflight.status, `OPTIONS ${url} is not an approved preflight`).not.toBe(204);

      measured[prefix === '' ? '(root)' : prefix] = simple.status;
    }

    // The traversal claim, made explicit: *every* derived prefix was probed (a derivation that
    // silently shrank the loop would leave this short), and the one probe that matches no route in
    // any environment — the root — is this app's own JSON 404 (D78(d)'s positive partner).
    expect(
      Object.keys(measured).length,
      'probes actually issued, one per derived mount prefix',
    ).toBe(prefixes.length);
    expect(measured['(root)']).toBe(404);
  });
});

describe('D88 — no server source installs an Access-Control-* header (source scan)', () => {
  const SERVER_SRC_ROOT = fileURLToPath(new URL('../../server/src/', import.meta.url));

  /** Every `.ts` file under `server/src`, recursively. */
  function serverSources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return serverSources(full);
      }
      return entry.name.endsWith('.ts') ? [full] : [];
    });
  }

  const SOURCES = serverSources(SERVER_SRC_ROOT);

  it('scans the whole server tree (a broken walk must fail, not pass)', () => {
    expect(SOURCES.length, 'server/src/**/*.ts files found').toBeGreaterThanOrEqual(30);
  });

  it('contains no Access-Control literal and no cors import, in code rather than prose', () => {
    const hits: string[] = [];
    for (const file of SOURCES) {
      const relative = path.relative(SERVER_SRC_ROOT, file);
      const code = codeOf(readFileSync(file, 'utf8'));
      if (/access-control/i.test(code)) {
        hits.push(`${relative}: an Access-Control literal`);
      }
      if (/(?:from\s+['"]cors['"]|require\(\s*['"]cors['"]\s*\))/.test(code)) {
        hits.push(`${relative}: imports the cors package`);
      }
    }
    expect(hits, 'CORS code found in server/src').toEqual([]);
  });

  it('carries no cors package in dependencies or devDependencies', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    expect(declared, 'a re-added cors dependency').not.toContain('cors');
  });
});
