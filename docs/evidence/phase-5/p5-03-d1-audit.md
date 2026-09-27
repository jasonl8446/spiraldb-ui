# p5-03 D1 — the status-filtering audit (story p5-03, plan task 5.3)

One acceptance criterion, quoted (`docs/plan-phase-5-dashboard-polish.md` L53):

> **Every list view**: four filter tabs with counts equal to the status API summary;
> filter survives reload via URL param; empty state per filter.

This deliverable changes **no code**. It reports, row by row, what each of the eight list views
does today, and then runs the cross-check the AC's first clause names.

Sources read: `docs/plan-phase-5-dashboard-polish.md` §5.3 (L24–25);
`docs/spec-ui-design.md` L242–268 (the tab bar's own spec: `[All (322)] …` with count badges,
the active tab's `blue-500` underline + white text, and L268's per-filter empty state);
`docs/plan-overview.md` D12, D37, D49, D51, D76, D78(b), D81, D82.

---

## 1. The eight list views, audited against the same bar

| # | route | page / component | tab set | where its counts come from | URL-persisted? | per-filter empty state |
|---|---|---|---|---|---|---|
| 1 | `/quests` | `client/src/pages/QuestsPage.tsx` (p2-08) | `[All][Extracted][Reviewed][Verified]` — `QUEST_FILTERS` → `lib/quests.ts`'s `questFilterTabs` → `lib/object-list.ts`'s `objectFilterTabs` | **the list payload's own `summary`** (`GET /api/quests` → `{quests, summary, skipped}`, D49), *not* `GET /api/status/quests` | **no** — `useState<QuestFilter>('All')` at `QuestsPage.tsx:69` | yes — `emptyStateMessage(filter)` (`lib/quests.ts:222`) → `No Verified quests found.` / `No quests found.` on `All`, rendered at `QuestsPage.tsx:186` |
| 2 | `/drop-tables` | `ObjectListPage` + `DROP_TABLE` (`App.tsx:116`) | same four, from `OBJECT_FILTERS` (`lib/object-list.ts:26`) | **the list payload's own `summary`** (`GET /api/drop-tables` → `listObjects().summary`, D49's rule) | **no** — `useState<ObjectFilter>('All')` at `ObjectListPage.tsx:104` | yes — `objectEmptyStateMessage(filter, nounPlural)` (`lib/object-list.ts:212`), rendered at `ObjectListPage.tsx:246` |
| 3 | `/npc-inventories` | `ObjectListPage` + `NPC_INVENTORY` (`App.tsx:122`) | same four | same (list `summary`) | **no** (same line) | yes (same component) |
| 4 | `/npc-spell-inventories` | `ObjectListPage` + `NPC_SPELL_INVENTORY` (`App.tsx:136`) | same four | same | **no** | yes |
| 5 | `/creature-spellbooks` | `ObjectListPage` + `CREATURE_SPELLBOOK` (`App.tsx:153`) | same four | same | **no** | yes |
| 6 | `/npc-drop-tables` | `ObjectListPage` + `NPC_DROP_TABLE` (`App.tsx:176`) | same four | same (all four buckets `0` against the absent directory) | **no** | yes (+ the absent-directory notice, `CorpusNotices`) |
| 7 | `/treasure-card-inventories` | `ObjectListPage` + `TREASURE_CARD_INVENTORY` (`App.tsx:191`) | same four | same | **no** | yes |
| 8 | `/zone-transfers` | `ObjectListPage` + `ZONE_TRANSFER` (`App.tsx:205`) | same four | same | **no** | yes |

`GlobalRegistry` is **not** in the eight: it is editor-only with no list and no detail route
(D75(a), `docs/spec-api.md` L474), so it has no tab bar to audit. Excluded, as Q1 excludes it
from the tracked set.

### What the audit finds

- **The tab bar itself is already consistent.** All eight views render the same four labels in
  the same order from **one** vocabulary — `lib/object-list.ts`'s `OBJECT_FILTERS` /
  `OBJECT_FILTER_STATUS` / `objectFilterTabs`; `lib/quests.ts` re-exports through it rather than
  forking it (`questFilterTabs` is a one-line delegation). There is **no second tab
  implementation** to remove, and the seven object views already share one page component.
  §5.3's "status filtering consistency pass" therefore has exactly one real gap in the UI:
- **The gap is the AC's second clause.** Both React halves read the filter from
  `useState('All')` and write it with a bare `setFilter`; nothing reads or writes a query
  parameter anywhere in `client/src` (measured: `grep -rn "useSearchParams\|searchParams"
  client/src` → **0 hits**). A hard reload therefore resets every view to `All`, and Back/Forward
  cannot move between filters.
- **The empty states already exist and already name the filter** on all eight views (L268's
  template, with `All` reading `No {noun} found.` rather than the ungrammatical `No All …`,
  D51(d)). No fix is needed for the AC's third clause. Both were re-read rather than assumed:
  `ObjectListPage.tsx:246` and `QuestsPage.tsx:186`.

*(Per-filter empty-state messages as they actually render, one per view:)*

| view | `Extracted` empty message |
|---|---|
| quests | `No Extracted quests found.` |
| drop tables | `No Extracted drop tables found.` |
| NPC inventories | `No Extracted NPC inventories found.` |
| NPC spell inventories | `No Extracted NPC spell inventories found.` |
| creature spellbooks | `No Extracted creature spellbooks found.` |
| NPC drop tables | `No Extracted NPC drop tables found.` |
| treasure card inventories | `No Extracted treasure card inventories found.` |
| zone transfers | `No Extracted zone transfers found.` |

---

## 2. The cross-check the AC names: the two `summary` derivations, per type

The AC's first clause is a **cross-check**, not a cosmetic claim: the counts the list pages
render come from the **list payload's** `summary` (D49's decision — a tab counts exactly what
the table holds), while the AC's own words say **`GET /api/status/{type}`'s `summary`**. Those
are two different SQL/scans (D49(b) says so explicitly), so they have to be proven equal rather
than assumed.

**How it was run: in-process, not against a live server and not a rig.** `npx tsx` calls the
exact functions the two endpoints call — `listStatus(db, resolveStatusObjectTypes(routeType))`
for the status side (what `server/src/routes/status.ts` does) and `listObjects({db, config,
spiraldbPath})` / `listQuests({db, spiraldbPath})` for the list side — against a **read-only
copy** of the developer's real `data/spiraldb-ui.db` (`/tmp/p503-audit-<pid>.db`, deleted at the
end), with `spiraldb_path` read from that database's own `settings` row
(`/home/jason/Documents/git-projects/spiraldb`, fork HEAD `d57d891`). Nothing was written; no
port was opened. Script: `/tmp/p503-crosscheck.mts`; raw output:
`docs/evidence/phase-5/p5-03-d1-crosscheck.txt`.

```
type                       | list summary (total/ex/rev/ver) | status summary (total/ex/rev/ver) | agree
--------------------------------------------------------------------------------------------------------
quests                     |                     328/327/1/0 |                       322/321/1/0 | NO
drop_tables                |                     317/317/0/0 |                       317/317/0/0 | yes
npc_inventories            |                     215/215/0/0 |                       215/215/0/0 | yes
npc_spell_inventories      |                       77/77/0/0 |                         77/77/0/0 | yes
creature_spellbooks        |                     134/134/0/0 |                       134/134/0/0 | yes
npc_drop_tables            |                         0/0/0/0 |                           0/0/0/0 | yes
treasure_card_inventories  |                         1/1/0/0 |                           1/1/0/0 | yes
zone_transfers             |                   1205/1205/0/0 |                     1205/1205/0/0 | yes
```

**Seven of eight agree, bucket for bucket. One does not: quests, by exactly 6 on `total` and
on `extracted` (`reviewed` 1 = 1, `verified` 0 = 0).**

### The quests disagreement is D82's effect, and it is reported rather than worked around

The 6 are the D82 rows — `WC-COMMONS-MAIN-002-{BALANCE,DEATH,FIRE,ICE,LIFE,MYTH}`, all titled
"To Ravenwood!" — the quest files the owner's fork grew after D37's first-startup-only import
populated `entry_status`, which the import never revisits. The cross-check printed each of the
six as **present in the list payload with `status=extracted`** (and `skipped[]` empty, so they
are not a parse failure). Their effect on the eight views' badges is therefore:

| view | `All` badge | `Extracted` badge | the status API says |
|---|---|---|---|
| `/quests` (list payload) | **328** | **327** | 322 / 321 |
| the other seven | equal | equal | equal |

**Not fixed here, deliberately.** D82(a)'s remedy is an idempotent backfill — an insert into
`entry_status` plus a `status_history` row per missing corpus key — i.e. a schema/import change,
and the story instruction is explicit that a filter story must not grow into one. Switching the
quest tab badges to read `GET /api/status/quests` instead would satisfy the AC's clause
literally while making every badge **disagree with the table under it** (the `Extracted` tab
would say 321 and render 327 rows) — that is the D49 failure mode the codebase decided against,
and a workaround rather than a fix. The divergence is carried as **D82's effect**, with the
numbers above, for the lead to route.

### One correction to D82's wording, from the same measurement

D82 says the six quests are "unreachable through search and **invisible to every list page**".
The search half is right (`GET /api/search` derives its rows from `entry_status`). The
"every list page" half is **not**: the cross-check proves `GET /api/quests` *does* return all
**328** rows, because `listQuests` scans `QuestTemplates/` per request (D12) and defaults a row
with no `entry_status` row to `extracted` (D49(b)) — so the six keys are on the `/quests`
browse page, visible and searchable, and they are the *reason* its `Extracted` badge reads 327.
The list pages that cannot see them are only the ones built on `entry_status` (the search
palette). That is the same staleness D82(b) warns about — *which* table, and *when* it was
written — and it slightly narrows the defect: the data is reachable, its **status** is not
trackable (a `PATCH /api/status/quests/…` on one of the six 404s, D51(f)).

### A structural note the seven agreements do not license

The seven equalities hold **today because the first-startup import happened to cover those
digits**, not because the two derivations are the same computation. D49(b) records the shape:
they can only diverge when a file appears outside the tool. So the equality is a measurement of
this corpus at this commit — the `npc_drop_tables` row (`0/0/0/0` both ways) is the same
statement about an absent directory — and the cross-check is re-runnable rather than a
once-true claim.

---

## 3. What D2 therefore has to change, and nothing else

1. **URL persistence** for the filter on all eight views, through **one** mechanism (a pure
   helper in `lib/object-list.ts` + one hook), so a hard reload and Back/Forward both keep the
   filter, and the default `All` is **absent** from the URL rather than spelled out.
2. Nothing else. The tab vocabulary is already shared, the counts already come from the list
   `summary` on all eight (D49), and every view already has a per-filter empty state that names
   the filter. The quests badge divergence is D82's, and is reported above.