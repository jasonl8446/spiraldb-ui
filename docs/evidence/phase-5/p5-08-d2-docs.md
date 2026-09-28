# p5-08 D2 — the docs (AC2 + AC3) and the two carried cleanups

Covers the README rewrite (AC2), the `spec-api.md` append (AC3), the AGENTS.md re-audit, and the
two cleanups earlier stories handed to this one (the dead stub code and the mobile spec's
screenshot directory). Everything here was measured on the tree after the edits; the gate numbers
are in `p5-08-d3-proof.md`.

## 1. README rewrite (AC2)

`README.md` was 111 lines and had four stale claims and three omissions. Both directions were
checked — what the file said that stopped being true, and what a first run needs that it never said:

| line | was | is now | why |
|---|---|---|---|
| 7 | "**Project status (2026-09-25):** … **no code has been written yet**"; "decisions **D1–D27**" | all five phases implemented in-tree; **D1–D87** | the plan's own record is at D87, and the code exists |
| 39 | "**Node.js 18+**" | "**Node.js 20+** — [package.json](package.json) pins `engines.node` to `>=20`; verified here on v24.21.0 / npm 11.19.0" | `package.json` is what npm enforces; measured `node --version` → v24.21.0 |
| 48 | "These commands become functional as Phase 1 (Foundation) lands; the repository currently contains specs and the plan only" | deleted | Phase 1 landed long ago |
| 67 | "Express :3001 + **Vite :5173**" for the harness | ":5181" (`VITE_PORT`) plus a bullet explaining the override | D84(c): the harness moved off the port a sibling checkout holds |
| 78 | artifacts bullet (no screenshot rule) | adds that a spec's own screenshots go under `test-results/`, so a run cannot rewrite committed evidence | cleanup 2 below |
| 94 | "decisions D1–D27" | "D1–D87" | same as line 7 |
| — | *missing*: which mode serves what | a two-row dev/prod table (start command, who serves the client, who serves `/api`, URL, SPA fallback) | the AC's "without Vite" claim needs the two modes named |
| — | *missing*: the prerequisites the AC names | `.NET 9` (**9.0.318**, and *why* it is needed: extraction only), the `build:cli` **D18 flags** with the `CS0579` warning, the prebuilt **imcodec** default (**D3**, so syncing needs no SDK), and **`npm run sync` before first use** | P5 AC#16 |
| — | *missing*: how to point the tool at your own clones | the seeded-once settings contract (`SPIRALDB_PATH`, `AURORIUM_PATH`, `IMCODEC_PATH`, `USER_NAME`, `GIT_BRANCH`) | D31(b); without it "a clean checkout" cannot work |

The document also gained the two things AC#16's second clause needs: `npm run build:cli` is now in
Getting Started (before it, the only mention of `.NET` was a prerequisite bullet with no command),
and the production pair `npm run build` + `npm start` is written out.

### The mechanical link check — every referenced path, not the ones I remembered

`/tmp/p5-08/link-check.sh README.md` reads the references **out of the document**. Class A is every
markdown link target that is a relative path; class B is every backticked path-like token (≥ 1 `/`).
It exits non-zero if any class-A target is missing or any class-B path that git tracks is missing.
Full output (`/tmp/p5-08/d2-linkcheck.txt`):

```
### A. markdown link targets in README.md
OK       AGENTS.md
OK       client/src/lib/routes.ts
OK       client/src/pages/SettingsPage.tsx
OK       docs/evidence/phase-1/story-p1-10.md
OK       docs/evidence/phase-5/p5-08-d1-twomode.md
OK       docs/plan-overview.md
OK       docs/plan-phase-1-foundation.md
OK       docs/plan-phase-2-quest-extraction.md
OK       docs/plan-phase-3-quest-editing.md
OK       docs/plan-phase-4-object-editors.md
OK       docs/plan-phase-5-dashboard-polish.md
OK       docs/spec-api.md
OK       docs/spec-architecture.md
OK       docs/spec-data-model.md
OK       docs/spec-domain-reference.md
OK       docs/spec-ui-design.md
OK       package.json

### B. backticked path-like references in README.md
runtime/gitignored  client/dist
OK(tracked)         client/src/lib/routes.ts
OK(tracked)         client/vite.config.ts
runtime/gitignored  data/spiraldb-ui.db
OK(tracked)         docs/evidence/
OK(tracked)         server/src/app.ts
OK(glob, 112 match)  tests/**
OK(tracked)         tests/ui/shell.spec.ts
runtime/gitignored  tools/.artifacts/
runtime/gitignored  tools/bin/
runtime/gitignored  tools/bin/imview-packet-reader
runtime/gitignored  tools/.nuget/
runtime/gitignored  tools/.playwright-browsers/

class A: 17 resolve, 0 missing
class B: 5 tracked and resolving, 1 globs expanding, 0 missing, 7 runtime-created or gitignored
rc=0
```

**17/17 link targets resolve, 0 missing, rc=0.** The five specs and the six plan docs are all
linked. Two things this check is careful about, because a weaker one would have passed while the
README stayed broken: it tests the **tokens actually in the file** (so a link I forgot cannot be
missing from the list), and it separates the 7 class-B paths that are **runtime-created or
gitignored** (`client/dist` only exists after a build, `data/spiraldb-ui.db` only after the first
boot, `tools/bin/*` only after `build:cli`, `tools/.playwright-browsers/` only after
`test:ui:install`) from the ones a clean checkout must have. Those 7 are prose about where things
live, and each is labelled with the step that creates it.

### Getting Started: which commands were run, verbatim and not

| command | how it was run | result |
|---|---|---|
| `npm run build` | verbatim | rc=0; `client/dist` + `server/dist` (log `/tmp/p5-08/d3-build.log`) |
| `npm start` | verbatim, `PORT` unset → 3001 | rc=0; serves the built client; the whole D1b sweep is against it |
| `npm run dev` | verbatim, with `VITE_PORT=3032` + `PORT=3001` (so it could not collide with a sibling stack) | rc=0; Express :3001 + Vite :3032; D1's dev half |
| `npm run build:cli` | **verbatim** | rc=0, 0 errors, 12 `NU1900` warnings (the sandbox denies NuGet's vulnerability-data cache; they are warnings, not errors), 4.72 s; `tools/bin/imview-packet-reader` symlink recreated |
| `npm run sync` | the script, **not** isolated — see §6 | rc=0, SUCCESS, **21.3 s** ("roughly 22 s" in the README), 79,835 items / 18,173 spells / 23,033 NPCs / 328 quests / 1,241 zones / 317 drop tables, `id mismatches: 0`, `dropped (PK): 0` |
| `npm run sync:dry-run` | **verbatim** | rc=0, 4.4 s, and its own before/after database fingerprint proves **`db writes: none`** |
| `git clone` / `cd` | not run | a clean checkout and clone-to-fresh-directory run is **p5-09's** (plan §5.8's fresh-clone dry run); claiming it here would be faking it |
| `npm install` | not run | the tree already has `node_modules`; re-running it would rewrite `package-lock.json`, which carries an unrelated uncommitted change (D87's `axe-core` pin, not this story's). Also p5-09's |

The `export …` lines in Getting Started are deliberately marked as conditional ("if they are not at
the defaults") — they are not a required step. Their precedence is a code fact this story read
rather than re-measured: `server/src/db.ts`'s seeds take an explicit env value over
`NODE_ENV=test` over the spec default (D31(b)), and seeding runs on the first database creation
only. **The first-boot seeding itself is p5-09's** — every stack this story booted pointed at a
database that already existed, so the env→seed path is not something this story can claim to have
watched.

## 2. `spec-api.md` gains the two endpoints (AC3)

Before this story `docs/spec-api.md` contained **zero** references to `/api/activity` or
`/api/search` (grep for either string returned nothing), so the append was owed rather than a
formality. Two blocks were added, in the file's own voice (`**Request:**` / `**Response:**` blocks,
then bullets, then a provenance line matching its existing "**Added by story pX**" annotations):

- **`### GET /api/activity`**, placed in `## Verification Status` after `GET /api/dashboard`
  (it reads `status_history` × `entry_status` for the dashboard's feed). Documents: the
  `{activity: [...], unresolved: n}` envelope; the **LEFT join** — a row whose parent entry is
  missing, whose type is outside the eight, or whose key is blank is **returned and counted, never
  dropped**; `unresolved` and the UI's "no link" rendering share one predicate; the
  `ORDER BY changed_at DESC, id DESC` total order; default 10 / ceiling 100; a malformed `limit` is
  a **400, never a clamp**; `notes` may be null and `changed_by` may be `null`/`""`.
- **A new `## Search` section** (after `## Settings`, before `## URL Routes`), documenting the
  **two arms** — `entry_status.object_key` across all eight types (navigable, carrying `status`)
  and the friendly-name arm (`items`/`spells`/`npcs` **informational and not navigable**, with
  `object_type`/`object_key`/`status` null and counted in `unresolved`; `quests.title` **navigable**
  because `quests.quest_name` is already the route key); the **per-group** `limit` (20 default /
  50 ceiling / 400 above) with `total` and `truncated`; the **blank `q` → 200 with an empty envelope
  and zero database work**; the group order; the rank ordering (exact → prefix → substring,
  case-folded) with the row's own identity as the tiebreak; and case-folding/escaping.

Both examples in the appended text are **real responses captured from a running server** on the
scratch database copy (not invented), which is what makes the next check possible.

### The field check, in both directions

`/tmp/p5-08/spec-field-check.mjs` parses the appended sections' JSON examples (stripping the `//`
annotation lines the file already uses) and compares their **key structure** to the live endpoints'
— so a field the API does not return, or a returned field left undocumented, fails. It also
compares the examples' counters to the live ones. `rc=0` (`/tmp/p5-08/d2-spec-fields.txt`):

```
OK   spec-api activity envelope vs live          documented: activity, unresolved
OK   spec-api activity row vs live               documented: changed_at, changed_by, id, new_status, notes, object_key, object_type, old_status
OK   spec-api search envelope (key query) vs live documented: groups, limit, query, total, truncated, unresolved
OK   spec-api search group vs live               documented: label, results, type
OK   spec-api search result (navigable) vs live  documented: label, matched_on, name, object_key, object_type, source_id, status
OK   spec-api search result (informational) vs live  documented: same seven
OK   spec-api search blank envelope vs live      documented: groups, limit, query, total, truncated, unresolved

example counters vs live:
  OK   DS-ACAD-C01-00 limit=20 total: 10/10   truncated: false/false   unresolved: 0/0
  OK   necklace limit=2 total: 2/2            truncated: true/true     unresolved: 2/2
  OK   blank q limit: 20/20

7 key sets + 7 counters checked; rc=0
```

**Deliberately not touched:** `PUT /api/settings` still shows no response body, even though D32
fixed it as "200 with the full updated settings map". That is D32's resolution, not D27's, and AC3
names only the two endpoints — so this story did not widen into it, and records the gap here rather
than silently filling it.

## 3. AGENTS.md re-audit — one stale claim, corrected; everything else verified

Re-audited against implemented reality, item by item (the AC's list: scripts, prerequisites,
`build:cli` flags):

| AGENTS.md claim | verdict |
|---|---|
| "decisions **D1–D87**" and the D-by-D list | correct (the plan's last decision is D87) |
| "Read these … `docs/spec-*.md`", "`docs/plan-phase-{1..5}-*.md`" | correct, lowercase `docs/` (D34); all 6 plan docs exist |
| External-dependency paths (5 rows) | **all five verified to exist** by `ls -d` |
| "CLI Tools: .NET 9 (…)" | correct; `.NET 9` is the right major (SDK 9.0.318) |
| "All 9 types need editors" + the 9-row table | correct: 8 tracked types + GlobalRegistry, all built |
| Architecture rule 2 (names synced, not hardcoded) | correct |
| Architecture rule 3, "**embedded audit fields for all other types**" | **STALE — corrected.** Audit fields are not stamped anywhere: `shared/objectTypes.ts` marks `audit: 'embedded'` for DropTable only and `'none'` for the other seven, and that column is declarative (`D69(b)`: 316 of 317 DropTables carry the quartet, the other six families carry none, and a generic refresh would add an invisible second writer). The corrected text names the quartet, says the editor renders and never writes it, and points at `shared/objectTypes.ts` |
| Architecture rules 1, 4, 5 | correct |
| No script list, no prerequisites section | nothing to correct — the file never claimed either, so nothing was added (touching spec/AGENTS only for recorded resolutions) |

The audit was extended to the same claim expressed **in code comments**, where it was also stale
and would have misled the next agent:

- `client/src/App.tsx` — the header comment and `elementFor`'s doc both said non-built routes render
  the "Arrives in Phase N" stub. Rewritten to say all 20 routes render real pages and the
  `default:` arm is an unreachable-therefore-404 branch.
- `client/src/lib/routes.ts` — `AppRoute.phase`'s doc said it selects the stub ("every other route
  renders …"); now it is provenance, not a rendering switch. Its values are still pinned by
  `tests/unit/ui-shell.test.ts` ("maps stub phases per lead decision 7": `/` → 5, the quest routes →
  2, the eight families → 4, `/settings` → 1) — the test name is now the only place the word "stub"
  survives in that pairing, and it is the pin that keeps a path's owner phase from drifting.

## 4. Cleanup 1 — the dead stub code is deleted, and `default:` renders the real 404

**Decision: delete both components and all three mocks.** The reasoning, and what replaced what:

- `client/src/pages/StubPage.tsx` and `client/src/components/SharedComponentsPreview.tsx` are
  **reachable from nowhere**. `elementFor` cases all 20 `APP_ROUTES` paths (`/` … `/settings`), so
  its `default:` arm — the only `StubPage` call site — is unreachable. Measured in the browser
  afterwards: across 24 paths, `anyStubText: 0`, i.e. the string `Arrives in Phase N` appears on no
  page at all. A stub panel that can only be reached by a dead branch is a **false affordance**: it
  renders live names and status badges and looks like a feature.
- **What `default:` now renders: `<NotFoundPage />` — the shell's real not-found page.** The branch
  cannot be deleted (TypeScript cannot prove a `switch` over `route.path: string` exhaustive), so it
  must return something honest. Rendering a 404 page is the only true answer for "a route the table
  does not hold"; the alternative — keeping a stub — would silently re-introduce the false
  affordance the moment a path is added to `APP_ROUTES` without a case.
- `tests/ui/shell.spec.ts`'s three `/api/names/{items,spells,npcs}` mocks existed for exactly one
  reason (the deleted panel bulk-loaded all three tables) and are gone with it. Nothing that spec
  visits reads those tables: its routes are the 12 sidebar list routes plus `/`,
  `/quests/extract`, `/quests/:questName` and `/settings`, and the only components that read name
  tables are the detail/editor forms behind a `FriendlyNameDropdown`, reachable by clicks this file
  never makes. The three mocks were the **only** thing removed from that file's mock set; the
  remaining route-specific mocks stay, because those assertions depend on them (D81).

Side effect, measured: the client entry chunk went **770,800 B → 769,166 B** (−1,634 B raw) and the
CSS chunk is unchanged — the two components' code is genuinely no longer shipped.

## 5. Cleanup 2 — the mobile spec writes to a gitignored directory, and the PNG churn ends

`tests/ui/object-mobile.spec.ts` wrote its screenshots into `docs/evidence/phase-4/`, another
phase's committed evidence, so **every full `npm run test:ui` rewrote 15–22 of that phase's
committed PNGs** (D83(d): the brief said 7, the measurement said 15; every story since has had to
restore them by hand).

What changed: `screenshotPath` now returns `test-results/object-mobile/<name>` — a directory
Playwright's own artifacts already live in and `.gitignore` already covers (`test-results/`), so a
run's screenshots stay inspectable while being unable to reach a commit. The spec's own doc-comment
now states why, and that phase evidence is committed **once, by the story that produced it**.

**The churn is verified gone two ways after a full run** (numbers in `p5-08-d3-proof.md`):
`git status --porcelain docs/evidence/` empty, and every committed PNG's md5 equal to
`git show HEAD:<path>`. A pre-run snapshot of all 90 committed PNGs (22 phase-4 + 14 phase-5 + the
rest) was taken for that comparison, and the new files land under `test-results/`.

### The same question asked of the other screenshot-writing spec — measured, left alone

`tests/ui/a11y-reduced-motion.spec.ts` also writes into committed evidence
(`docs/evidence/phase-5/p5-05-reduced-motion-*.png`, 6 files, **its own phase's**). Two measurements
decided that it stays as it is:

1. **Its writes are byte-stable.** The p5-07 worker's full `test:ui` run on this tree rewrote those
   six files at 20:51 today (mtime; the run started 20:50:57), and `git status --porcelain
   docs/evidence/` afterwards reported **nothing** — so the bytes it writes equal the committed
   ones. Contrast the mobile spec: its PNGs changed bytes on every run, which is the defect.
2. It writes **its own phase's** evidence, not another phase's.

This story's own full `npm run test:ui` then confirmed it directly rather than by that inference:
all **90** committed PNGs (including those six) were md5-identical to `git show HEAD:<path>`
afterwards — see §"the PNG verification" in `p5-08-d3-proof.md`.

`grep` over `tests/ui/*.spec.ts` confirms these two files were the only screenshot writers, so this
is the complete set. If the reduced-motion bytes ever do drift, the restore is one command —
`git checkout -- docs/evidence/phase-5/` — and that is recorded here for whoever hits it.

## 6. A finding this story hit and must report: `npm run sync` ignores `SPIRALDB_UI_DB`

`npm run sync` was run with `SPIRALDB_UI_DB=/tmp/p5-08/scritch.db`, intending D44's isolation. It
did not apply, and the reason is structural: `scripts/sync-names.ts` opens
`openDb(args.dbFile ? { file: args.dbFile } : {})`, and `openDb()` takes its path from its caller —
only `getDb()`/`resolveDbFile()` read `SPIRALDB_UI_DB` (`server/src/db.ts`'s own doc-comment says
so: "`openDb()` callers keep passing a path explicitly"). `sync:dry-run` says the same thing in its
output (`db file : …/data/spiraldb-ui.db`), so the evidence was in plain sight.

**The sync therefore ran against the owner's live database.** Its effect was measured completely,
by comparing a byte-copy taken immediately before with the database afterwards:

- the seven name tables: **identical row counts and identical key/name/category values**; the only
  column that differs is `updated_at`, the sync's own stamp (e.g. `DS-ACAD-C01-001`:
  `2026-09-27 16:19:09` → `2026-09-28 01:19:10`), on all rows;
- one `sync_history` row appended (`id 7`, `success`, `V_r806919.Wizard_1_610`) — the same routine
  the owner's previous 6 rows came from;
- `entry_status`, `status_history` and `settings` **byte-identical** — no verification data and no
  configuration was touched;
- `id mismatches: 0`, `dropped (PK): 0`, `missing manifest: 0`.

So the command is safe and its result is exactly what the README now promises, but the **isolation
variable does not reach it**: a future rig must use the script's own `--db <path>` argument
(`parseSyncArgs` accepts it). Reported, not hidden, and not "fixed" here — changing `openDb`'s
contract is a D44/D32 decision, not a docs story's.

## 7. What this story does not do (named, not faked)

- **The clean-checkout half of AC#16** — `git clone` into a fresh directory, `npm install`, the
  settings export, `npm run sync`, `npm run build:cli`, `npm run dev`, and the walkthrough — is
  plan §5.8's **fresh-clone dry run, owned by p5-09**. This story ran every command it could from
  the working tree and says which two it did not run.
- **`PUT /api/settings`'s response shape** (§2) — D32's resolution, outside AC3's two endpoints.
- **The `npm run sync` isolation defect** (§6) — recorded with the workaround; the fix belongs to
  the decision that owns `openDb`.