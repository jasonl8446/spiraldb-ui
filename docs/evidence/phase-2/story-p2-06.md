# p2-06 — Quests API: list / detail (JSON5-tolerant) / POST save (task 2.5)

Branch `phase-2-quest-extraction`, HEAD `97fd60e` at dispatch (tree left **uncommitted** for the
lead). The three spec endpoints (`docs/spec-api.md` L164-180) over the p2-05 save pipeline and the
D19 content-keyed index.

New source: [`quests.ts` (service)](../../../server/src/services/quests.ts) — `listQuests` /
`readQuest` / `saveQuest` + `QuestRequestError`; [`quests.ts` (route)](../../../server/src/routes/quests.ts)
— `createQuestsRouter`, mounted **lazily** in [`index.ts`](../../../server/src/routes/index.ts) like
settings/sync/names/status/dashboard (D32). `sync/corpus.ts` gained the table columns additively
(`goalCount`, `modifiedAt`, `sourceFile`, `countQuestGoals`). Tests:
[`quests-api.test.ts`](../../../tests/unit/quests-api.test.ts) — 29 new, 639 → **668** in 27 files.
The chosen response shapes are documented in [`docs/spec-api.md`](../../spec-api.md) (see D49(a)).

| AC | Result | Evidence |
|---|---|---|
| **p2-06-ac1** `GET /api/quests` lists the full corpus (322 + saved) with correct status dots; filter-tab counts match `GET /api/status/quests`'s summary; search filters the table (D12) | **PASS** | Real server, clone as `spiraldb_path`, boot import of 2271 entries → **322** rows with every table column populated (`spec-ui-design` L254-262); `.summary` **identical** to `GET /api/status/quests`'s summary at 322 and at 323 after a save, including with a live `reviewed`/`verified` change driving the status dots; the D12 client-side filter contract proven over the returned JSON (substring `UNICORN` → 8 rows; `status=extracted` → 322) — the table wiring itself is p2-08 ([`story-p2-06-ac1.txt`](./story-p2-06-ac1.txt)) |
| **p2-06-ac2** `GET /api/quests/{name}` on a legacy trailing-comma file returns fully parsed JSON (JSON5 tolerance on a real corpus file) | **PASS** | `questtemplates_DS-ACAD1-C01-001.json` (36 KB, **7** trailing commas; strict `JSON.parse` fails at line 349 col 15, removing only the commas makes it parse) → the endpoint returns 36 keys, level 1, 7 goals, the first goal name, 69 explicit nulls; unknown name → `404 {"error":"Unknown quest …"}`. Corpus baseline re-measured: 322 scanned / 306 strict failures / 306 trailing commas / 317 integral floats / 306 no final newline, exactly D48(b) ([`story-p2-06-ac2.txt`](./story-p2-06-ac2.txt)) |
| **p2-06-ac3** GET → POST unmodified for one legacy quest: the test-clone diff is limited to formatting normalisation, no field loss (early D5 proof) | **PASS** | GET → POST returned `outcome=updated`, `action=update`, one commit `spiraldb: update quest DS-ACAD1-C01-001`; the diff is formatting-only ("unmatched removed spellings: **0** — every removed line reappears verbatim once normalised"); **no field loss**: 884 leaves compared, value mismatches **0**, keys only-before/only-after 0/0, explicit nulls 57/57, `isDeepStrictEqual(before, after) = true` ([`story-p2-06-ac3.txt`](./story-p2-06-ac3.txt)) |

## Lead verification (independent, this round)

- **Gate re-run by the lead** ([`gate-p2-06-leadverify.txt`](./gate-p2-06-leadverify.txt)):
  **27 files / 668 tests**, 8 UI specs, eslint 0, prettier 0, `typecheck:tests` 0, server + client
  `tsc --noEmit` 0, `npm run build` 0.
- **The acceptance harness re-run** independently by the lead
  ([`story-p2-06-leadverify.txt`](./story-p2-06-leadverify.txt)): boot #1 with the import skipped →
  `PUT /api/settings` to point at the clone → boot #2 imported 2271 entries → `count=322`,
  `summary` **EQUAL true**, a full row with all nine columns, the filter contract (8 / 322); the
  legacy file rejected by strict `JSON.parse` while the endpoint returned it fully parsed (36 keys,
  7 goals, 69 nulls); and the GET → POST round trip with `action=update`, `git diff --numstat`
  147/161, **742 leaves compared / 0 mismatches / 69/69 nulls preserved / `isDeepStrictEqual` true**
  → "NO FIELD LOSS".
- **Two artifacts in my own commands are recorded rather than hidden**: a `grep -oP ',\s*[}\]]'`
  count that reads `0` because it cannot match across the newline before the closer (the pristine
  file has **7**), and a first corrected measurement that ran *after* my own normalising POST. Both
  numbers and the correction are in the evidence file.
- **Hygiene**: the owner's fork stayed at `c55ccab` on `main`, `status --porcelain` empty, `refs` =
  `main` only; 0 files changed under `Imview` and `~/.nuget`; no stray listener left; the disposable
  clone was reset to `main` with no `content/*` branch.

## Not claimed / flagged (D49)

- The **table itself** (search box, filter tabs, pagination, status dots) is p2-08; this story ships
  and proves the data contract and the client-side filter contract over that payload (D12).
- `POST` records **no** status transition and no history note — it has no capture-file context; a new
  key is inserted `extracted` and an existing entry's status is never reset.
- The list's `summary` (rows returned) and the status endpoint's summary (`entry_status` rows) are
  equal in the normal state but are different computations; `skipped[]` is how the list reports
  files it could not read (D49(b)).
- The first update of a legacy file is a **formatting-only** diff wider than trailing commas alone
  (14 interior blank lines, 183 float respellings, the final newline) — value-preserving, and p2-08
  may want to collapse it (D49(c)).
- Unproven: per-request index refresh cost (D12's caching question stays open), the `resolved` title
  path against a genuinely synced database, and a corpus with a missing `QuestTemplates/` directory.
