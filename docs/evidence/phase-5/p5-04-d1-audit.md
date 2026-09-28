# p5-04 D1 — the error-envelope audit (AC2 / P5 AC#7; decision D37)

`tests/unit/api-error-envelope.test.ts` — new, 7 tests, all green.

Command: `npx vitest run tests/unit/api-error-envelope.test.ts` → `Tests 7 passed (7)`, 0.5 s.

## The route list is derived, not hand-written

The audit discovers the routes at run time in two steps, because `routes/index.ts` mounts
every feature router **lazily** (D32) — the inner routers do not exist at import time and
nothing in `apiRouter.stack` points at them:

1. **Mount prefixes** are parsed from `apiRouter.stack` (`layer.regexp.source`).
2. **Router instances** are recorded by wrapping `express.Router.handle` — in Express 4 every
   router inherits from the exported `Router` function, so one wrapped property catches every
   router the app builds, including the lazily-built ones. Each prefix is probed once
   (`GET /api<prefix>/___p5_04_audit_missing___`) to force the lazy factory to run and record
   the instance with its real `req.baseUrl` (`/api/status`, `/api/drop-tables`, …).
3. Each recorded router's `stack` is walked; a route's full path is `baseUrl + route.path`.

**Measured: 43 routes over 17 mount prefixes** (19 routers captured, incl. the app router and
`/api` itself). This matches the route files by hand: health 1 + settings 2 + sync 3 + names 2
+ status 4 + dashboard 1 + activity 1 + search 1 + extract 1 + quests 3 + 8 object families ×
3 = 43.

Two assertions make the derivation an **anti-escape** property rather than decoration:

| test | what it stops |
|---|---|
| `covers every enumerated route with a malformed-input probe` | a route added without a probe entry fails the audit loudly |
| the same test's `staleProbes` half | a deleted route leaving a stale probe entry fails too |
| `enumerates the mounted router rather than a hand-written list` | every mount prefix from `apiRouter.stack` must have been reached, so a **new family** cannot quietly shrink the audit |

## What each route is driven with

**56 probes; 41 answer a 4xx `{error}` body.**

| probe | count | routes |
|---|---|---|
| a syntactically broken JSON body | 13 | every write route (8 object POSTs, quests, extract, settings PUT, status PATCH, sync) |
| a JSON array where an object is required | 11 | the 8 object POSTs, quests, extract, settings PUT |
| a key that does not exist | 10 | 8 object `/:key`, quests `/:name`, status `/:type/:key/history` |
| a limit that is not a positive integer (400) | 3 | activity, search, names list |
| a type no name table backs (404) | 1 | names `/:type` |
| an id that is not in the table (404) | 1 | names `/:type/:id` |
| a type with no lifecycle (404) | 1 | status `/:type` |
| a missing status in a well-formed body (400) | 1 | status PATCH |
| a garbage query string the route must tolerate (200) | 15 | the routes with **no input at all** (below) |

`POST /api/sync` is deliberately given only the broken-JSON probe: its handler ignores the
body, and any well-formed body would make it run a **real name sync** (79835 items / 18173
spells / 23033 npcs / 322 quests, measured 23.6 s in an exploratory probe). Malformed JSON is
rejected by `express.json()` before the handler, so the audit stays side-effect-free.

## The 15 routes with no input surface

`GET` on: health, dashboard, settings, sync/status, sync/history, status/_import, the 8 object
lists, and quests. They take no parameter, so no malformed input can make them fail; the audit
asserts what can honestly be asserted — a garbage query is **tolerated** (`200`, no crash,
no 5xx) — and their failure surface is covered by the induced-500 test below. This is the
audit's one honest limit; it is stated here rather than hidden behind a vacuous assertion.

## No-leak assertion — shape, not a sample message

Every error body is checked against `LEAK_PATTERNS`, independently of what the message says:

- no multi-line body (a stack trace cannot be one line) and no `"stack":` key anywhere;
- no `\n\s*at\s` frame line; no `node_modules`;
- no `.ts`/`.tsx`/`.js`/`.mjs`/`.cjs` **with a line number** (`file.ts:12:3` forms both with and
  without a function name);
- no absolute filesystem path (`/home`, `/tmp`, `/var`, `/workspace`, …) in an error body.

The body shape is `{ error }`, or `{ error, fields }` for the one documented companion (the
per-field map of a 400, D64) — **any other key fails**, which is how a debug dump would be
caught. The path rule is applied to *error* bodies only: `GET /api/settings` legitimately
answers with the configured absolute paths in a 200.

## The 5xx path (stack-trace leak on a thrown error)

No malformed input reaches a 5xx (the exact-status assertion proves it: every probe answers the
documented 4xx). The failure is therefore **injected**: the shared connection is closed
(`closeDb()`), after which the settings route's handler throws
`TypeError: The database connection is not open`. Asserted: `500`, `application/json`, the
`{error}` envelope, no leak pattern, body < 500 bytes, no HTML.

Measured output of that request: `{"error":"The database connection is not open"}` — the app
**logs** the stack to the server console (`app.ts`'s 5xx branch) and sends the message only.
This test is deliberately last in the file: it leaves the connection closed.

## Hermetic (D17 / D44 / D81)

`SPIRALDB_UI_DB=:memory:` (the documented `getDb()` override) and `SPIRALDB_PATH` at a
throwaway, **empty** corpus in `os.tmpdir()` (one empty directory per `SPIRALDB_COLLECTIONS`
row, so a new family needs no edit here). No assertion depends on the disposable test clone or
on the owner's fork: an unknown key is a 404 because nothing exists, and no probe can trigger a
name sync or a corpus import.

One measured variance, stated rather than hidden: the **unkeyed GlobalRegistry** detail route
(D74) answers 404 only when its directory holds no JSON entry at all; with files present it
resolves the key to a *file* (falling back to the convention file) and answers 200 with the
merged document — so on the real corpus an unknown key is a 200. The audit's empty fixture is
what makes "unknown key ⇒ 404" deterministic here.

## What had to change

**Nothing.** All 43 routes already complied: no route answered a 5xx to malformed input, every
failure spoke the envelope, and no response carried a stack, a source file with a line number,
or a filesystem path. `server/src` contains no reference to `err.stack` at all, and the five
async handlers (`extract`, `objects` POST, `quests` GET/POST, `sync` POST) each wrap their work
in `try/catch` and answer the envelope themselves — which matters because **Express 4 does not
catch async handler rejections**; an uncaught one would hang the request rather than leak.