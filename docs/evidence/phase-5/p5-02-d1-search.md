# p5-02 D1 — `GET /api/search?q=&limit=20` (story p5-02, plan task 5.2; decision D27)

## What was built

| file | change |
|---|---|
| `server/src/services/search.ts` | new, 526 lines: `SEARCH_DEFAULT_LIMIT` (20), `SEARCH_MAX_LIMIT` (50), `SEARCH_GROUPS` (the one group table), `SEARCH_GROUP_TYPES`, `SearchResultRow` / `SearchGroup` / `SearchResult`, `searchAll`, `parseSearchLimit`, `parseSearchQuery` |
| `server/src/routes/search.ts` | new, 48 lines: `createSearchRouter({ db })`, one `GET /` |
| `server/src/routes/index.ts` | +15: `apiRouter.use('/search', …)`, lazily mounted (D32) |
| `server/src/services/names.ts` | `escapeLike` is now **exported** (one implementation, two callers — see below) |
| `tests/unit/search.test.ts` | new, 650 lines / 43 tests, all `:memory:` (D17) |

```
$ npx vitest run tests/unit/search.test.ts
 ✓ tests/unit/search.test.ts (43 tests) 69ms
 Test Files  1 passed (1)
      Tests  43 passed (43)
$ npx vitest run tests/unit/names.test.ts      # the file whose helper was exported
 ✓ tests/unit/names.test.ts (66 tests) 479ms
      Tests  66 passed (66)
$ npx tsc -p server/tsconfig.json --noEmit     # rc=0
$ npx tsc -p tests/tsconfig.json --noEmit      # rc=0
$ npx eslint server/src/services/search.ts server/src/routes/search.ts \
    server/src/routes/index.ts server/src/services/names.ts tests/unit/search.test.ts   # rc=0
```

## The decisions the story asked for, each with the measurement behind it

### 1. What the two arms span, and which of them can be linked

**Arm 1 — object keys.** All eight D4 `entry_status.object_type` values, matched on
`object_key`. These rows carry `object_type` + `object_key` + `status`, i.e. exactly what the
palette's dot and its link need. This is what makes the AC's own example work: in the owner's
fork the drop table for a quest is named *after the quest*, so `DS-ACAD-C01-00` matches the
quest `DS-ACAD-C01-001` **and** the drop table `DS-ACAD-C01-002`.

**Arm 2 — friendly names.** Four tables, per §5.2's own list, with two different treatments
because the app's routes are what they are:

| table | matched column | treatment | why |
|---|---|---|---|
| `items` | `name` | informational — `object_type: null`, `object_key: null`, `status: null`, counted in `unresolved` | there is **no** `/items/:gid` page; inventing one is a hard failure mode in the brief |
| `spells` | `name` | same | same |
| `npcs` | `name` | same | same |
| `quests` | `title` (left-joined to `entry_status`) | **navigable** — a normal quest row, `matched_on: 'name'`, status from `entry_status` | `quests.quest_name` *is* the `entry_status.object_key` the real `/quests/:questName` route takes, so the link is the existing one, not a new one |

`zones` and `drop_tables` are **not** searched by name: `drop_tables.name` is byte-identical to
the `drop_table` object key (measured: same 317 strings), so a name arm over it would duplicate
arm 1 exactly; `zones.display_name` is a humanised form of a key arm 1 already matches, and §5.2
names only items/spells/npcs/quests.

**The row set is the tracked spine.** Both arms are driven from `entry_status` (the quest title
is a `LEFT JOIN` onto it), so every returned row has both a route and a status. Measured limit:
the `quests` table holds **328** rows but `entry_status` holds **322** quest rows, so **6** quest
names are not reachable through the search — all six spell the same title, `To Ravenwood!`, on six
school-specific keys (`WC-COMMONS-MAIN-002-{BALANCE,DEATH,FIRE,ICE,LIFE,MYTH}`). Returned instead
of a fabricated status. **Flagged for the lead, not fixed here:** the corpus has 328 quest files
and `quests` has 328 rows, so the 322 in `entry_status` is the D37 first-startup import's
*once-only* result (it runs only on an empty table) and D80(b)'s recorded 322→328 re-sync is not
what this database shows.

**No second route mapping.** The rows carry `object_type`/`object_key` and nothing else about
navigation; the client resolves them through the existing D4 mapping (`activityHref` →
`objectDetailPath`).

**One `escapeLike`.** `services/names.ts`'s LIKE-metacharacter escaper is now exported and
imported here rather than copied, so `?q=%` cannot be a literal on `/api/names` and a wildcard
on `/api/search`.

### 2. Blank/absent `q` → `200` with an empty envelope, and **zero** database work

A palette is in this state the moment it opens, so it is not an error:

```json
{ "query": "", "limit": 20, "total": 0, "truncated": false, "unresolved": 0, "groups": [] }
```

`searchAll` returns before it prepares a statement. The unit test proves it with a `Db` whose
`prepare` throws, plus its positive partner (the same probe *does* throw for a real query), so
"no scan" is witnessed rather than asserted. The tables behind this endpoint hold **123,640**
rows (measured on the live database, below).

`q` is trimmed, and the response's `query` is the trimmed string actually matched. A repeated
`?q=a&q=b` is a **400** (`Query parameter "q" must be a single string value`).

### 3. The `limit` ladder — 400, never a clamp (p5-01's ladder, verbatim)

Absent → **20** (`SEARCH_DEFAULT_LIMIT`); a ceiling of **50** (`SEARCH_MAX_LIMIT`, above which
the 400 names the ceiling); `""`, `"abc"`, `"1.5"`, `"-1"`, `"0"`, `" 1"`, `"+1"`, `"1e3"`,
`"20.0"`, `"0x10"` and a repeated parameter (an array) are all **400**s. The applied cap is
echoed as `limit` so a client can never guess it.

**`limit` is a PER-GROUP cap, and the AC's own example is why.** Measured on the live database:
`DS-ACAD` matches **26 quests and 26 drop tables**, and `KT-` matches **59 quests and 59 drop
tables**. Under a single shared cap the Quests group is first in the order, takes all twenty rows,
and the Drop Tables group never appears — the criterion's sentence *"typing a substring of a
known quest name and of a known DropTable name returns both, grouped by type"* would be false
while the endpoint looked correct. Per group, both survive:

```
q="DS-ACAD"   total=42  groups=[quest:20 drop_table:20 npc:2]
q="DS-ACAD-C01" total=10 groups=[quest:5 drop_table:5]
```

`limit=20` is respected in the sense that bounds a caller: **no group is ever longer than
`limit`**, and a query whose matches live in one type is answered with exactly 20 rows
(measured: `necklace` matches 124 items and nothing else → `total=20`; `?q=necklace&limit=20`).

### 4. Ordering inside a group, and its tiebreak (D37)

`rank` then the row's identifier ascending, where rank is **exact match → prefix → substring**
over the matched column (case-folded), so a query ranks `AB` above `AB-XX` above `XX-AB`.

The tiebreak is the row's own identity, exactly as D37 orders `GET /api/status/:type` by
`object_key` then `object_type`:

- an object group orders by `object_key` — unique within one type, so the order is **total**;
- a name group orders by `name, id` — because a name is **not** unique (79,835 items share
  4,395 repeated names, the measurement already in `services/names.ts`), so `name` alone is not
  a total order and the friendly table's primary key is the tiebreak. That id is also why every
  name row carries `source_id`: it is the palette's React key and cmdk's `value`.

### 5. Case-insensitive, ASCII

Matching folds case with SQLite's `lower()` + `LIKE`, which are ASCII — the same rule and the
same wording `services/names.ts` already carries ("every friendly-name category in the live
database is ASCII"). Asserted in both arms and in both directions
(`DS-ACAD` / `ds-acad` / `Ds-AcAd`, `oBsIdIaN aMuLeT`).

### The envelope (for task 5.7's `spec-api.md` append)

```json
{ "query": "DS-ACAD-C01-00", "limit": 20, "total": 3, "truncated": false, "unresolved": 0,
  "groups": [ { "type": "quest", "label": "Quests",
                "results": [ { "object_type": "quest", "object_key": "DS-ACAD-C01-001",
                               "label": "DS-ACAD-C01-001", "name": "Wizard Tours",
                               "source_id": null, "status": "reviewed",
                               "matched_on": "key" } ] } ] }
```

The append will need to document: the two arms (and that `items`/`spells`/`npcs` hits are
informational); the **per-group** `limit` (20 default, 50 ceiling, 400 above); the blank `q`
→ 200-empty rule; `truncated`; `unresolved` (p5-01's word, same meaning — p5-01 already flagged
that `unresolved` must be documented); the group order; the ranking + tiebreak; and the
case-folding.