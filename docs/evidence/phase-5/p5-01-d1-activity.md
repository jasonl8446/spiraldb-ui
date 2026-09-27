# p5-01 D1 — `GET /api/activity` (story p5-01, plan task 5.1; decision D27)

## What was built

`GET /api/activity?limit=10` — a `status_history` × `entry_status` **LEFT** join, newest
first, for the dashboard feed. Files:

| file | change |
|---|---|
| `server/src/services/status.ts` | +152 lines: `ACTIVITY_DEFAULT_LIMIT` (10), `ACTIVITY_MAX_LIMIT` (100), `ActivityRow`, `ActivityResult`, `isResolvedActivity`, `listActivity`, `parseActivityLimit`, `isStatusObjectType` |
| `server/src/routes/activity.ts` | new, 47 lines: `createActivityRouter({ db })`, one `GET /` |
| `server/src/routes/index.ts` | +15: `apiRouter.use('/activity', …)`, lazily mounted (D32) |
| `tests/unit/activity.test.ts` | new, 450 lines / 19 tests, all `:memory:` (D17) |

## The two decisions the story asked for

**A history row whose `entry_status` parent is missing is returned, counted, and never
linked.** The join is LEFT, not INNER: an inner join would silently answer nine rows while
the endpoint claims "the 10 most recent `status_history` rows". The envelope is
`{ activity: [...], unresolved: n }` (the `{ history: [...] }` shape of D37), where
`unresolved` counts returned rows with no usable `(object_type, object_key)` — the parent is
gone, or the type is outside D4's eight, or the key is blank. `isResolvedActivity` is the one
predicate, so the count and the UI's "no link" rendering cannot disagree. The orphan case is
synthesized in the test with `PRAGMA foreign_keys = OFF` (this app's connection has the FK
on), and a hand-written `global_registry` row is asserted to be reported verbatim but
unlinkable — no route can create one (`PATCH /api/status/global_registry/…` is a 404, Q1).

**A malformed `?limit=` is a 400, never a silent clamp.** Absent → 10; `""`, `"abc"`,
`"1.5"`, `"-1"`, `"0"`, `" 1"`, `"+1"`, `"1e3"` and a repeated parameter (an array) → 400;
above the ceiling → 400 naming the ceiling. Same ladder as `?status=` (D37) and the names
router's `?limit=`.

Ordering is `changed_at DESC, id DESC`: the plan's "order by `changed_at desc`" with the
monotonic `id` as the deterministic tiebreak (the same reason D37 orders `latest_notes` by
`id` — `changed_at` may repeat).

## Row shape

```json
{ "id": 3, "object_type": "quest", "object_key": "DS-ACAD-C01-001",
  "old_status": "extracted", "new_status": "reviewed",
  "notes": "Gate-1 acceptance re-run: reviewed at the Phase 1 boundary",
  "changed_by": "Jason", "changed_at": "2026-09-26T06:26:25.798Z" }
```

`id` is carried on purpose: it is the only value that cannot repeat, so the client uses it as
the React key.

## Evidence

```
$ npx vitest run tests/unit/activity.test.ts
 ✓ tests/unit/activity.test.ts (19 tests) 88ms
 Test Files  1 passed (1)
      Tests  19 passed (19)

$ npx tsc -p server/tsconfig.json --noEmit   # rc=0
$ npx tsc -p tests/tsconfig.json --noEmit    # rc=0
$ npx eslint server/src/routes/activity.ts server/src/services/status.ts tests/unit/activity.test.ts  # rc=0
```

Live read against `data/spiraldb-ui.db` (`openDb` + `listActivity`, printed above in the D1
report): 3 rows, `unresolved: 0`, newest first.
