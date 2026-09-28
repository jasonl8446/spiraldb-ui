# DR-15 — the HIGH security fix now has its regression test

**Story:** close architect-verification **DR-15** (the task's one gap).
**State:** `main` `d2eb7ad`, plus `tests/unit/server-security-posture.test.ts` and this evidence set.
**No commit and no git writes beyond reading** (the task's D84(a) rule).
**New file:** `tests/unit/server-security-posture.test.ts` (6 tests, 270 lines).
**Changed source files:** none — `server/src/app.ts` and `server/src/index.ts` are byte-identical
before and after the work (`md5sum -c` in
[`final-review-fix-dr15-falsification.txt`](./final-review-fix-dr15-falsification.txt)).
**New dependencies:** none.

## 1. What the verifier measured, and what this closes

DR-15, as written in [`architect-verification.md`](./architect-verification.md):

> Measured: `grep -rniE 'access-control|cors|allow-origin|loopback' tests/` → **2 hits, both a
> comment** in `tests/unit/extract-api.test.ts` … No test asserts the absence of CORS headers, and
> **no test imports `server/src/index.ts`** at all, so the loopback bind is untested too. Every
> suite would stay green if `app.use(cors())` and `app.listen(PORT)` came back.

The fix's own concern is exactly this drift: the "mirror" app in `extract-api.test.ts` had to be
edited **by hand** to keep its claim ("this app mirrors the real composition … which carries no
CORS middleware at all") true — verified by `git blame`, those two comment lines were added by
`b54f45b`, the fix commit itself.

The new file asserts the posture against the **real** `createApp()` object, which is what
`server/src/index.ts` hands to `listen`.

### The six tests

| # | Test | What it pins |
|---|------|--------------|
| 1 | foreign-origin simple `GET /api/health` has no `Access-Control-*` header, **and the same route answers 200** with no `Origin` | absence of the header, not absence of the route (D78(d)) |
| 2 | `OPTIONS /api/settings` with `Origin: http://foreign.example` + `Access-Control-Request-Method: PUT` is **not** approved: no `Access-Control-*`, no `Allow-Methods`, and status is **not 204** | the reproduced exploit's exact shape |
| 3 | foreign-origin `GET /api/settings` (the exploit's target) is unmarked, and a same-origin `GET /api/settings` answers 200 carrying `user_name` | the exploit's route, both arms |
| 4 | `server/src/index.ts` declares `const HOST = '127.0.0.1'` | the loopback literal, exactly |
| 5 | `app.listen(PORT, HOST, …)` — the second argument is `HOST`, not a port-only listen | the wildcard bind cannot return |
| 6 | `server/src/index.ts` contains no `app.use(` | middleware added in the entrypoint, *outside* the object every other arm tests |

Four properties a weaker test would have missed, each deliberate:

1. **Real object, not a mirror.** `createApp()` from `@server/app`, the same factory the entrypoint
   uses. Test 6 exists because that object is the whole composition only if the entrypoint adds
   nothing — with both arms, the running app and the tested object are the same app.
2. **A positive partner per route.** Every "header absent" arm has a same-route request that must
   answer 200, so a 404 (or a route that stopped existing) cannot masquerade as "no CORS header".
3. **The preflight, not just the simple request.** The exploit was a `204` preflight approving
   `PUT`; test 2 drives that request and asserts on the status and on
   `Access-Control-Allow-Methods`, not only on `Access-Control-Allow-Origin`.
4. **The whole `Access-Control-*` name space** — every such header is collected and asserted empty;
   the two a browser acts on are named explicitly so the failure message says which one returned.

One measurement that looks like an approval and is not: Express's default handler answers an
unmatched `OPTIONS` with a plain `Allow: GET,HEAD,PUT` on `/api/settings`. That is not a CORS
grant — a foreign page cannot read a response header without `Access-Control-Allow-Origin` — so the
assertions are on the `Access-Control-*` names and never on "a header that names PUT". Getting this
wrong is how a test would either fail spuriously or pass vacuously.

## 2. The loopback half: which check I chose, and why

**I chose a source assertion** (tests 4–6), with the limitation stated in the test file and repeated
here.

*Why not behavioural:* `server/src/index.ts` starts listening on import — it opens the database and
runs the first-startup import. Booting it from a unit test would break the hermeticity this suite is
built on (D17/D44: throwaway databases, never the developer's `data/spiraldb-ui.db`, never the
owner's fork), and **no repository convention boots the entrypoint in a unit test** (the verifier
measured that too). The behavioural check exists — it is what the architect's own rig measured
(`127.0.0.1:5399`, LAN probe refused `rc=7`) — but it is a manual rig, not a unit test.
No listening server is started by this file; no port is owned or killed.

*What it does catch:* the literal is asserted to equal `'127.0.0.1'` **exactly**, so replacing it
with a different non-loopback literal (`0.0.0.0`) fails — measured, case B. So does `'localhost'` or
`'::1'` (they are not the literal the fix chose). Reverting the call to `app.listen(PORT)` fails —
measured, case B. A rename or rewrite that stops matching the pattern fails **closed** (the
assertion sees `undefined`), rather than passing quietly.

*What it does not catch, stated plainly:* it is a **reading of the source, not an observation of a
socket.** It cannot catch a listener that is not this call — a second `listen`, a proxy, a bind
moved into another module — and it cannot prove the running process's socket is loopback-only.

## 3. Falsification (D67(d)) — the full ledger

Every control ran against the **final** test bytes; each rc was captured immediately after its own
command; every mutation was followed by `cp` from a byte backup and `md5sum -c`, which reported
**OK** every time. Raw log:
[`final-review-fix-dr15-falsification.txt`](./final-review-fix-dr15-falsification.txt).

| Case | Mutation applied | rc | Which assertions failed |
|------|------------------|----|-------------------------|
| baseline | none (final bytes) | **0** | — (6 passed) |
| **A** | `app.use(cors())` re-added to `app.ts`, exactly as removed | **1** | all 3 CORS arms (foreign GET, preflight, exploit's route) |
| **B** | `HOST = '0.0.0.0'` **and** `app.listen(PORT, …)` | **1** | the HOST-literal arm and the listen-argument arm |
| **C** | `app.use(...)` added in `index.ts` after `createApp()` | **1** | the entrypoint-middleware arm |
| **D** | `cors({ origin: 'http://localhost:5173' })` (string) | **1** | all 3 CORS arms (`Access-Control-Allow-Origin`) |
| **F** | `cors({ origin: ['http://localhost:5173'] })` (array) | **1** | the 2 simple-request arms on **`Vary: Origin` only**; the preflight arm on `Allow-Methods`/`Allow-Headers` |
| **E** | function-origin allowlist denying the foreign origin | **0** | none — the **measured boundary**, see §4 |
| final | restored, byte-identical | **0** | — (6 passed) |

**Case A reproduces the exploit's exact wire shape**, measured with the middleware re-added:

```
OPTIONS /api/settings   Origin: http://foreign.example   ACRM: PUT
status: 204
access-control-allow-origin: *
access-control-allow-methods: GET,HEAD,PUT,PATCH,POST,DELETE
access-control-allow-headers: content-type
```

So the test fails on precisely the response the reviewer reproduced, not on a generic header.

**One trap found by running the test rather than by reading it.** The entrypoint's own docblock
quotes the vulnerable form (`app.listen(PORT)`) while explaining why it was rejected, and the first
version of the listen assertion matched *that mention* instead of the real call. The assertion now
parses the source with comments stripped, and the failure mode of that decision is recorded in the
test file's comment. A source assertion that can be satisfied by prose is not a pin.

## 4. Two sub-assertions and where their reach ends (the honest part)

`Vary: Origin` is asserted absent because the `cors` package adds it for any origin-varying
configuration. Whether that arm ever fires was **measured, not assumed**:

* a wildcard re-install sets `Access-Control-Allow-Origin: *` → caught by the ACAO arm (case A);
* a **string**-origin re-install sets `Access-Control-Allow-Origin` to its *configured* origin
  regardless of who asked → caught by the ACAO arm (case D);
* an **array**-origin re-install denies the foreign origin and emits **no** `Access-Control-Allow-
  Origin` on a simple request — measured `access-control-allow-origin: undefined`, `vary: Origin`,
  and the failing assertion is the `Vary` one (case F). Without that arm, case F's two simple-
  request arms would pass;
* a **function**-origin allowlist that denies the foreign origin emits **no header at all** (the
  package calls `next()` and stops) → caught by nothing here (case E, 6/6 green). That is outside
  this pin's reach, and it is stated rather than hidden. It is not a hole in the security property:
  a request that receives no `Access-Control-Allow-Origin` is one a foreign page can neither read
  nor drive. What is pinned is that no foreign-origin request is ever **granted** — not that no
  identity-aware CORS code exists anywhere.

Also recorded: `cors@2.8.6` is still physically present in `node_modules` as **extraneous** (absent
from `package.json` **and** `package-lock.json`, per the architect's `npm ls cors`), which is why the
falsification could re-add the real middleware. A fresh `npm ci` would not have it, so a re-added
`import cors` would fail the build — but the header assertions are what stop the regression, not the
missing package.

## 5. Gates (final frozen tree; every rc captured in-artifact)

Raw log: [`final-review-fix-dr15-gates.txt`](./final-review-fix-dr15-gates.txt).

| Command | rc | Result |
|---------|----|--------|
| `npm test` | **0** | 68 files passed, **1478** tests passed (was 67/1472; +6 from this file) |
| `npx vitest run` (new + plausibly affected suites) | **0** | 5 files, 56 tests |
| `npm run typecheck:tests` | **0** | clean |
| `npm run lint` | **0** | `eslint .` + `prettier --check .` clean |
| `npm run lint` (re-run after these evidence documents were written) | **0** | the evidence files are under prettier's reach and pass; no test *reads* `docs/`, so the full-suite run stands for the same test bytes |

**D17/D90(b) clone check, after the suite** (`npm test` mutates and self-restores it):
`git status --porcelain` = **0** lines, HEAD `18dc924` (`spiraldb: extract quest
WC-CYCLOPS-MAIN-002`), branch `content/2026-09-27` — the frozen base, unchanged.

**D84** was respected throughout: no gate ran against a tree under edit. The full suite ran on a
frozen tree (before the falsification mutations) and again, in-artifact, after the final edit of the
test; both rc 0. Every mutation was reverted before the next run, and the falsification ledger was
re-run after the last test-file change so that it too ran on the final bytes.

## 6. What is still not covered (so this is not read as more than it is)

* This pins an **app-level composition property**. A CORS header installed per-route inside one
  lazily-mounted feature router (e.g. inside `createSettingsRouter`) would not be caught by the
  `/api/health` arms, though the `/api/settings` arms (test 3) cover the exploit's family. Only a
  sweep over every router would close that, and it is not what DR-15 asked for.
* The loopback half remains a **source** assertion with the limits in §2.
* The residual the architect already flagged stands unchanged: there is no `Origin`/`Host` check —
  the defence is the bind and the absence of CORS, not request validation.
* `docs/evidence/architect-verification.md` is **not** edited by this work: DR-15's disposition is
  the lead's call, and this file is the evidence it would cite.