# final-review — Ultragoal final gate 2/3, an independent code review in fresh context

**Role:** `omd-agent-code-reviewer` (fresh context, no memory of this run's reasoning — deliberately:
the loop must never approve itself).
**Tree:** `main` @ `1bbbda3` ("final-deslop: the ai-slop pass over the authored surface (gate 1/3)").
Working tree clean at launch and clean at the end of this review (`git status --porcelain` empty;
the only file this review created is this one).
**Nothing committed. No git writes beyond reading.** One isolated server rig was started twice, on
ports I own (`5341`, `5343`), with its own throwaway database under `/tmp`; both were torn down by
explicit PID and both ports are confirmed free (`ss` → none).

---

## 0. SCOPE — what I read, what I skipped, and why

**Boundary used (the final-deslop boundary, D1 §0):** the **311 authored-code files** —
`client/src` 115 (excluding the nine vendored `components/ui/` primitives, D39),
`server/src` 39, `server/test` 24, `shared/` 31, `scripts/` 9, `tests/` 108, root configs 11.
Excluded, as in the earlier gate and for the same reasons: `docs/` prose (42k lines of spec and
evidence transcripts — a code pass over them is theatre), the nine vendored primitives,
`package-lock.json`, build output, and `data/` (0 tracked files).

**Read in full (not skimmed), because the AC names them or they are the load-bearing paths:**

| area | files |
|---|---|
| git automation | `server/src/services/git.ts`, the save pipeline `server/src/services/savePipeline.ts` |
| file writes | `server/src/services/spiraldbFiles.ts`, `server/src/services/spiraldbIndex.ts`, `shared/naming.ts`, `shared/objectCreate.ts`, `server/src/routes/objects.ts` (whole) |
| subprocess CLI | `server/src/services/extraction.ts`, `server/src/routes/extract.ts`, `tools/PacketReaderCli/Program.cs` |
| shared model | `shared/document.ts`, `shared/ulong.ts`, `shared/objectSave.ts` |
| routes / envelope | `server/src/app.ts`, `server/src/index.ts`, `server/src/routes/objects.ts` |
| tests that carry the riskiest claims | `tests/unit/save-pipeline.test.ts` (§ updating an existing quest), `tests/unit/api-error-envelope.test.ts` (scope), `tests/ui/quests-goals-editor.spec.ts` |
| decisions | `docs/plan-overview.md` (D1–D87), `docs/evidence/final-deslop-d1-disposition.md` |

**Sampled by search rather than read line by line** (stated so the boundary is honest):
`client/src/lib/*.ts` beyond the model/validation homes, most `client/src/components/**`,
`shared/quest/**` and `shared/simpleObjects/**` schema+validation modules, `server/src/services/sync/*`,
and the remaining 30 tier-1 specs. For these I relied on (a) targeted greps, (b) the suites' own
green runs, and (c) reading the parts an AC names.

**Evidence I generated (commands and numbers below):**

| what | command | result |
|---|---|---|
| unit suite | `npx vitest run` | **rc=0**, 67 files / **1,462 tests passed**, 9.76 s wall |
| tests typecheck | `npx tsc -p tests/tsconfig.json --noEmit` | **rc=0** |
| client typecheck | `npx tsc -p client/tsconfig.json --noEmit` | **rc=0** |
| goals-editor spec (whole file) | `PLAYWRIGHT_BROWSERS_PATH=$PWD/tools/.playwright-browsers npx playwright test tests/ui/quests-goals-editor.spec.ts` | **rc=0**, 13 passed, drag arm **1.0 s** |
| drag arm alone | `… --grep "pointer drag"` | **rc=1** (twice; also `--repeat-each=2` → 2 failed) |
| drag arm with a different predecessor | `… --grep "5 types\|pointer drag"` | **rc=1** at line 558, reads the *predecessor's* document |
| API surface probe | isolated server on `5341`, `5343` (`SPIRALDB_UI_DB` + `SPIRALDB_PATH` in `/tmp`) | bind + CORS + limit findings below |
| corpus measurements | read-only `python3` over the owner's fork (`/home/jason/Documents/git-projects/spiraldb`) | counts below; **nothing written** |

I did **not** run the full tier-1 suite (33 specs) — my budget went to the three security surfaces,
the D-sample, and the one family I could falsify. That limit is stated again in §5.

---

## 1. FINDINGS

Severity is the *failure it would cause*, not a style preference. Confidence is mine.

### MUST-FIX

#### M1 — [HIGH] The API listens on **every** interface, answers **any** origin, and has no CSRF or
origin check — while the same API writes JSON files and auto-commits into a git repository.

- **Where:** `server/src/index.ts:81` — `app.listen(PORT, () => { … })` (no host argument), and
  `server/src/app.ts:26` — `app.use(cors())` (library defaults: `Access-Control-Allow-Origin: *`
  and permissive preflight).
- **Measured** (isolated rig, port `5341`, its own DB and a throwaway `spiraldb_path` under `/tmp`;
  the owner's fork was not touched):
  - `ss -ltnp | grep 5341` → `LISTEN 0 511 *:5341 *:*` — the wildcard address, i.e. all interfaces,
    not loopback.
  - `curl -i http://127.0.0.1:5341/api/settings` → `200` with `Access-Control-Allow-Origin: *`.
  - A cross-origin preflight (as a hostile page would send it):
    `curl -i -X OPTIONS …/api/settings -H 'Origin: https://evil.example'
    -H 'Access-Control-Request-Method: PUT' -H 'Access-Control-Request-Headers: content-type'`
    → `204` with `Access-Control-Allow-Origin: *`,
    `Access-Control-Allow-Methods: GET,HEAD,PUT,PATCH,POST,DELETE`, `Access-Control-Allow-Headers:
    content-type`. The preflight is *answered*, so the browser lets the request through.
  - The write itself, from the same foreign origin:
    `curl -i -X PUT …/api/settings -H 'Origin: https://evil.example' -H 'Content-Type: application/json'
    --data '{"user_name":"CSRF-DEMO-WRITE"}'` → **`200`**, and the value is durably changed
    (`GET /api/settings` read it back as `CSRF-DEMO-WRITE`).
- **The failure it would cause.** Two compounding paths, both reachable by a *page in the owner's own
  browser*, not only by a LAN host:
  1. `settings.spiraldb_path` and `settings.git_branch` are settable through the same unauthenticated
     endpoint (`PUT /api/settings`, validated only as "an existing directory" / free text — D32), and
     `server/src/services/git.ts:234-244` accepts **any** git working-tree root. So a stranger can
     point the tool at an arbitrary repository, name an arbitrary branch (including `main`, which
     removes the spec's `content/{date}` branch strategy), set `user_name` (the commit author), and
     then `POST /api/quests` or `POST /api/<type>` — each of which **writes a file and commits it**
     (`savePipeline.ts:381-407`) with the owner's identity (`git.ts:126-134`).
  2. Even read-only exposure leaks the host's paths (`GET /api/settings` returns `aurorium_path`,
     `imcodec_path`, `spiraldb_path` verbatim) plus the whole corpus and every status note.
- **Why I call it must-fix rather than note.** The project's own premise is "this is a **local
  single-user tool**" (`docs/spec-architecture.md:158`, the Vite proxy targets `localhost`), and the
  code does not implement the "local" half. The minimum fix is two lines and has **no functional
  cost**: the client is same-origin in both modes (`client/vite.config.ts` proxies `/api` in dev;
  Express serves `client/dist` in production; `client/src/lib/api.ts` only ever calls `/api/...`), so
  `cors()` is not needed for the app to work at all.
- **What would prove it fixed:**
  1. `app.listen(PORT, '127.0.0.1', …)` (or `'::1'`, matching Vite's own bind) and `cors()` removed
     (or `cors({ origin: 'http://localhost:5173' })` if the author prefers belt-and-braces).
  2. Re-probe: `ss -ltnp` shows `127.0.0.1:PORT` (or `[::1]:PORT`), and a request to the host's LAN
     address is refused; the preflight from `Origin: https://evil.example` no longer returns an
     `Access-Control-Allow-Origin` header; a browser `fetch` from a foreign origin fails CORS.
  3. Regression proof that nothing was broken: `npm run dev` renders the client, and the official
     tier-1 suite (`npm run test:ui`) stays green on port 5181.
  - A defence-in-depth companion (not required for the finding to be closed): a `Host`/Origin check
    on state-changing routes would also close DNS-rebinding, which a loopback bind alone does not.

#### M2 — [MEDIUM] A git failure mid-save leaves the file written (and the D22 deletions applied) but
uncommitted, and the write order makes the *next* save fail on a tree the user did not dirty.

- **Where:** `server/src/services/savePipeline.ts:381-407` — the sequence is
  `writeSpiraldbJson(filePath, payload)` (381) → `fs.rmSync(candidate)` for every `removePaths`
  (382-384) → `index.rebuildType` (385) → companion metadata write (389-396) → `git.commitObject`
  (399-407). There is **no `try`/`catch` and no rollback** anywhere on this path.
- **The failure it would cause.** Any commit-side failure (a failing `pre-commit` hook, an
  `index.lock` left by another git process, a `commitObject` rejection) surfaces as a 500 with the
  save reported as failed — but the working tree now holds the written file (and, for
  GlobalRegistry, the deletions) with no commit. `git.assertClean()` (step 1, `savePipeline.ts:358`)
  then refuses **every subsequent save** with `DirtyRepoError` naming the user's own uncommitted
  file, so the tool appears to break "for no reason" until the user resolves a state the tool
  created. Nothing is corrupted (the bytes are the user's, git can restore a tracked deletion), which
  is why this is MEDIUM and not HIGH — but the AC's question ("a failure that leaves a file written
  but uncommitted") is answered *yes*, and the pipeline has no self-recovery.
- **What would prove it fixed:** a unit arm that injects a `commitObject` that rejects and asserts
  (a) the working tree is byte-identical to its pre-save state, and (b) the caller receives the error
  *with the written-but-uncommitted paths named*. If restoring the bytes is judged too expensive, the
  honest minimum is (b): name the paths and say the tree is now dirty.

### SHOULD-FIX

#### S1 — [MEDIUM] A tier-1 arm can pass on **another test's clipboard content**: the pointer-drag
document assertions in the Goals editor are not sound, and the final-deslop disposition for this
exact test (its #9) raised the poll budget without touching the helper.

- **Where:** `tests/ui/quests-goals-editor.spec.ts:212-224` (`copyPanelDocument`), used at `:557`;
  the arm is the test at `:511`; the raised poll is at `:542`. Permissions **are** granted
  (`:262`), so this is not a permission failure.
- **Measured (three independent runs, all on this machine, all green-then-red as shown):**
  1. Whole file, in file order: `rc=0`, `13 passed`, and the drag arm itself takes **1.0 s** —
     contradicting the carried "a drag whose operation measures 13.7 s" framing as the arm's
     *characteristic* cost (13.7 s is plausibly peak-load latency; idle it is 1 s).
  2. `--grep "pointer drag"` (the arm alone): **rc=1**, `Timeout 10000ms exceeded while waiting on
     the predicate` at `:224` — i.e. with no predecessor, the clipboard never yields JSON within 10 s.
     `--repeat-each=2` → **2 failed** (12.2 s / 12.3 s).
  3. `--grep "5 types|pointer drag"` (a predecessor that leaves a *different* document): **rc=1** at
     `:558` with `Received + 6` goals — the arm read the **predecessor test's** document. That is the
     proof: the helper polls for "some JSON is on the clipboard", so any stale content satisfies it.
  4. Therefore, in file order (run 1), the arm passes because the immediately preceding
     keyboard-reorder test (`:467`) leaves a document whose `m_goals` order is **the same order the
     drag arm expects**. The `expect.poll(() => cardOrder(page))` at `:542` is genuine evidence that
     the *rendered* cards reordered; the document assertions that follow are not evidence of anything.
- **Why it matters beyond tidiness.** This is the run's Phase-3 evidence for the pointer-drag
  reorder, and the final-deslop gate recorded the *budget* as the defect and shipped a green
  re-run. An arm that can be satisfied by a neighbour's clipboard is exactly the "claim contradicted
  by measurement" class this review was asked to hunt; it is also why the recorded flake family for
  this test mis-names the symptom (the failing wait is the *clipboard* read, not the drag poll).
- **Fix:** the same two lines the other ten clipboard specs already use —
  `await page.context().grantPermissions([...])` (already present) **plus**
  `await page.evaluate(() => navigator.clipboard.writeText(''))` before the `Copy` click, as
  `quest-editor.spec.ts:184`, `quests-dialog-editor.spec.ts:311`, `drop-table-editor.spec.ts:101`
  and five others do. Strengthening option: assert the copied text contains the edit under test
  rather than merely starting with `{`. The same no-wipe shape exists in
  `tests/ui/quests-goal-logic.spec.ts:154-166` (poll, no wipe) and, worse,
  `tests/ui/quests-info-editor.spec.ts:70-73` (a single un-polled read, no wipe) — audit those two
  the same way.
- **What would prove it fixed:** `--grep "pointer drag"` alone goes green **and** the arm goes red
  when the drag's effect is falsified (e.g. make `onDragEnd` a no-op, or have the JSON panel copy a
  fixed document) — i.e. the arm becomes falsifiable in isolation, which it is not today.

#### S2 — [MEDIUM] `dagre` is a **runtime** import declared only in `devDependencies`.

- **Where:** `client/src/lib/quest-goal-logic.ts:56` (`import * as dagre from 'dagre'`), and
  `package.json:79` — `"dagre": "0.8.5"` inside `devDependencies` (the block starts at line 62;
  `dependencies` is lines 34-61). `@xyflow/react` — the other half of the same canvas — is correctly
  in `dependencies` (`package.json:42`), which shows the intended placement.
- **The failure it would cause.** Any install that prunes dev dependencies before building –
  `npm ci --omit=dev && npm run build`, the standard production install – cannot resolve `dagre`, so
  `vite build` (and `tsc -p client/… --noEmit`) fails and the production artifact cannot be produced.
  CI hides it because `ci.yml` runs a full `npm ci`. A dependency audit also reports a phantom:
  `npm ls --omit=dev` does not know the client needs it.
- **Fix:** move `dagre` to `dependencies` (`@types/dagre` stays in dev). Zero runtime change.
- **What would prove it fixed:** `npm ci --omit=dev && npm run build` exits 0, having resolved
  `dagre` from `dependencies`.

#### S3 — [MEDIUM] Metadata pairing's tie-break prefers a **legacy UUID file** over this tool's own
convention file, and the two-file case has no test.

- **Where:** `server/src/services/spiraldbIndex.ts:137-147` (first file in name order wins) →
  `server/src/services/savePipeline.ts:283-291` (`pathFor('questmetadata', name)`) → the warning at
  `server/src/services/quests.ts:397-409`.
- **Measured on the owner's live corpus (read-only):** `QuestMetadatas/` holds **324** files covering
  **316** distinct `Name`s — **8 duplicate `Name`s**, each a UUID-named legacy file plus a
  `questmetadata_<name>.json`: `WC-UNICORN-MAIN-001/002/003/004/006/007/008` and
  `WC-COMMONS-MAIN-001`. Example pair (`069f430e-….json` vs `questmetadata_WC-UNICORN-MAIN-004.json`):
  identical `QuestTemplateId`/`Name`, but the UUID file says *"imported from packet capture on
  2025-10-17"* (`CreatedBy: jay`, `ModifiedBy: makima`, `ModifiedAt 2026-04-03`) while the convention
  file says *"Quest built from packet capture."* (`CreatedBy: quest_builder`, `CreatedAt/ModifiedAt
  2026-06-01`). Since `'0' < 'q'`, the index resolves the name to the **legacy UUID file**, so a save
  refreshes `ModifiedAt/ModifiedBy` there and leaves the owner's newer, own-toolchain file stale.
- **What is *not* wrong (verified, and this is the run's claim holding up):** D48(d)/D49(f) are
  implemented, not aspirational — `quests.ts:397-409` computes the duplicate from the fresh index
  stats, warns with the **exact file it updated**, pushes the line into the response `warnings[]`, and
  logs it; `tests/unit/quests-api.test.ts:760-786` and `tests/ui/extraction.spec.ts:847-864` both
  drive it. So it is **not** a silent wrong-file write.
- **What I do call a defect:** the *direction* of the tie-break. The convention file is the name this
  tool's own create path writes (`shared/naming.ts` `questmetadata_<key>.json`) and the one the
  owner's own builder writes; "first in file-name order" prefers the opaque UUID. And the
  two-file case is **untested at the pipeline level**: `tests/unit/save-pipeline.test.ts:310` uses the
  *real corpus UUID filename* as its fixture — but with the sibling omitted, so the ambiguous case the
  filename comes from is exactly what the arm does not cover.
- **Fix (smallest):** in `writeQuestMetadata`, when the index reports a duplicate for that name,
  prefer the candidate whose basename is `fileNameFor('questmetadata', name)`; keep the warning
  either way. **Proof of fix:** a unit arm with both files present asserting the convention file is
  the one updated (and the warning still emitted), plus the existing pair on the live corpus.

#### S4 — [LOW→MEDIUM] `notes` on the generic object path reaches the commit message unsanitised.

- **Where:** `shared/objectSave.ts:45-64` / `server/src/routes/objects.ts:696` pass `body.notes`
  straight into `savePipeline.ts:403` → `git.ts:59-68` (`buildCommitMessage` → `${header}\n\n${notes}`).
  The **quests** path sanitises its capture note (`quests.ts:106-121`: base-name only, control
  characters stripped, length-capped) but `notes` is not sanitised on either path.
- **The failure it would cause.** A caller (see M1: *any* caller) can inject newlines and git trailers
  into the commit **body** — e.g. a fake `spiraldb: create quest X` line or a `Co-authored-by:`/
  `Signed-off-by:` trailer — into the owner's repository history. The message **header** is built
  server-side from the validated type/key, and the branch/identity come from settings, so this is
  message-body spoofing only. That is why it is a should-fix rather than a must-fix; if M1 is fixed
  the reachable set shrinks to the user themselves.
- **Fix:** cap the length and strip control characters from `notes` in one shared place (the same
  sanitiser `sanitizeCaptureSource` uses), or quote it as a single line.
- **Proof:** a unit arm posting `notes` containing `\n` plus a trailer and asserting the commit body
  has the newlines stripped (or the note on one line).

### NOTE (recorded, not blocking)

- **N1 — the zone `/`→`_` transform can collide on creates; measured safe today.** `shared/naming.ts`
  documents the transform as lossy for *parsing*, and the create path inherits the collision
  (`fileNameFor('zonetransfer','A/B') === fileNameFor('zonetransfer','A_B')`). Measured over the live
  corpus: **1205 distinct `ZoneName`s, 0 collisions between distinct keys** (two files share the key
  `WizardCity/Tutorial_Exterior` — a *duplicate key*, which D74(h) already records as
  unaddressable-through-the-list). The create path fails closed and says so
  (`savePipeline.ts:325-330`), so no data loss is reachable; the residue is that a genuinely new
  `A_B`-style zone is uncreatable next to `A/B`. Worth one sentence in `naming.ts`.
- **N2 — error bodies can disclose absolute host paths.** `errorHandler` (`app.ts:60-86`) returns
  `err.message` for 500s, and the file layer's messages name the full path
  (`spiraldbFiles.ts:261-271`, `301-310`). This is deliberate actionability (D37/D38), and there is
  **no stack trace** — verified in code and by the dedicated audit
  (`tests/unit/api-error-envelope.test.ts:479`). Scope note: that test's "no filesystem path" arm
  probes *malformed input* (400s), so its claim is narrower than it reads. No action required; stated
  so the claim is not over-read.
- **N3 — `express.json()`'s default limit is real and the headroom is measured.**
  `app.ts:27` takes no `limit`, so body-parser's 100 KB default applies. Measured live: a 150 KB body
  → `413 {"error":"request entity too large"}` (correct envelope), 50 KB → 200. The largest real
  quest document is **119,335 bytes pretty / 72,599 bytes minified** (the seven
  `WC-COMMONS-MAIN-002-*` files and `WC-CYCLOPS-MAIN-002`), so the biggest POST body has ~27 KB of
  headroom. Residual risk to know about: a future corpus file wider than ~100 KB minified becomes
  unsaveable with no UI path out, and the 413 message is body-parser's terse text rather than the
  actionable style the rest of the API uses.
- **N4 — `isWorkingTreeRoot` compares a resolved path, so a symlinked `spiraldb_path` fails closed
  with a misleading message.** `git.ts:234-244` compares `path.resolve(rev-parse --show-toplevel)`
  with `path.resolve(repoPath)`; git returns the physical path, so a symlink into the fork reports
  "not the root of a git working tree". Fail-closed and harmless, but the message sends the reader to
  `settings.spiraldb_path` when the path is in fact fine.
- **N5 — the sandbox/rig hygiene the run already learned, restated because it bit me too:** a
  `npx tsx server/src/index.ts` started under a shell wrapper is **two** processes deep — the first
  `kill` of the wrapper left the listener alive (`ss` still showed `*:5343`). Kill the PID from
  `ss -ltnp`, not the one from `$!`, and re-check the port.

---

## 2. THE D-ITEM SAMPLE — claim by claim, with what I measured

I picked claims that are *checkable* and spread across the risk surfaces, plus the two the brief's
prior-gate suspicion list pointed at.

| # | claim (paraphrased) | verdict | what I measured |
|---|---|---|---|
| D2 | multer **disk** storage, 512 MB cap | **holds** | `routes/extract.ts:59` `UPLOAD_MAX_BYTES = 512*1024*1024`, `:162-195` `diskStorage` with a **callback** destination (no import-time disk touch) and a random-UUID filename |
| D9 | cancel on `res.on('close')`, **not** `req.on('close')`, guarded by `writableEnded` | **holds** | `routes/extract.ts:225-234` exactly that, with the measured reason in the comment; `ChildRegistry.add` SIGKILLs a child that arrives after the abort (`extraction.ts:210-218`) |
| D11 | runtime commits carry **no** watermark | **holds** | `git.ts:59-68` builds `spiraldb: {action} {type} {key}` + optional body; no trailer anywhere in the runtime path (the watermark rule is agent-authored commits *in this repo* only) |
| D14 | dirty-repo guard; never stash | **holds** | `git.ts:262-271` `assertClean` → `DirtyRepoError` with the porcelain lines; `savePipeline.ts:358` is the first write-adjacent step |
| D19 | content-keyed index, first file wins, updates write back to the original path | **holds** | `spiraldbIndex.ts:93-148` (name-ordered scan, `map.has(key)` → `duplicateKeys`, never a rename); `savePipeline.ts:319-332` (`indexedPath ?? conventionPath`); I re-measured 328 quest files / **328 distinct `m_questName`** → 0 duplicate keys for the flagship family, and the 2 known `ZoneTransfer` duplicates (D74h) |
| D20 | metadata pairs by content, updated in place | **holds, with S3's caveat** | `savePipeline.ts:283-291` + `spiraldbFiles.ts:446-459`; the 8 duplicate `Name`s are real and *surfaced* (D48d/D49f) |
| D22 | GlobalRegistry consolidate-and-replace in one commit, never deleting a file the merge did not account for | **holds** | `objects.ts:688-701` (the consolidation decision) + `:739-775` (delete list computed from the live directory; only files the merge **parsed and accounted for** are deletable; leftovers go to `warnings`) + `spiraldbFiles.ts`/`git.ts:329-331` `git rm --cached --ignore-unmatch` **after** the write, before the single commit |
| D31(b) | settings seeding is env-overridable; `NODE_ENV=test` → the D17 clone | **holds** | my rig: `SPIRALDB_PATH=/tmp/review-rig/spiraldb` was what `GET /api/settings` returned; `playwright.config.ts` sets `NODE_ENV=test` + its own `SPIRALDB_UI_DB` |
| D39 | nine vendored primitives, all consumed, no unused ones | **holds** (my first grep said otherwise — my pattern was wrong: `components/ui/x` misses `../ui/x`) | all nine have ≥1 non-`ui/` importer: badge 2, button 6, card 6, command 3, dialog 6, input 2, popover 3, skeleton 5, table 1 |
| D46(2) | the CLI wrapper restores `MSG_QUESTOFFER.Level` that the reader drops | **holds** | `tools/PacketReaderCli/Program.cs:164-210` `ReadOfferLevels`/`ApplyOfferLevels`, with the `Convert.ChangeType`/`default(int)` root cause in the comment |
| D48(d) / D49(f) | the 8 duplicate-`Name` metadata files are surfaced, not silently chosen | **holds** | measured 324 files / 316 names / 8 duplicates; `quests.ts:397-409` warns with the exact updated path; unit arm `quests-api.test.ts:760-786`; tier-1 arm `extraction.spec.ts:847-864` |
| D54/D79/D82/D83(b) | 322-era vs 328-quest corpus, "the search palette is what is affected" | **consistent** | the suite's own boot line printed `328 real + 322 clone files`; I measured **328** `QuestTemplates/*.json` (one non-JSON entry, the `droptables` subdirectory) and 324 metadata files, matching the re-baseline story |
| D58 | `json5` never reaches the client; client tsconfig has no `esModuleInterop`; `serializeDoc` is the single write rule and the server delegates | **holds** | `grep -rn json5 client/` → **0**; `client/tsconfig.json` has no `esModuleInterop` (only `server/` and `tests/` do); `shared/document.ts:123` is the only definition and `spiraldbFiles.ts:291-293` delegates |
| D61 | React Flow is lazily contained; `@xyflow/react` is a **runtime** dependency | **holds** | `client/src/pages/QuestDetailPage.tsx:41` `lazy(() => import(...))`; `package.json:42` puts `@xyflow/react` in `dependencies` — the contrast with `dagre` is S2 |
| D69(b) | the audit quartet is never stamped generically | **holds** | the only writers of `CreatedAt/By`+`ModifiedAt/By` are the quest **metadata** builder (`spiraldbFiles.ts:423-436`), which is the spec's metadata shape (L193-204), not an object document; no generic writer exists (`shared/objectTypes.ts:32-41` declares `audit` for rendering only) |
| D76(a) | one home for the save envelope; `key` on update, never on create | **holds** | `shared/objectSave.ts` `updateObjectBody` (carries `key` for keyed families) vs `createObjectBody` (never) |
| D86(a) | the desktop status column is a `StatusBadge`, widened to 104 px | **holds** | `client/src/lib/quests.ts:60` `widthPx: 104`; `ObjectTable.tsx:89` `STATUS_WIDTH_PX = 104` + `:139` renders `<StatusBadge>`; `STATUS_META` is the single colour home (5 importers) |
| D86(e) | the contrast defect: `text-zinc-500` in **133** places, `text-zinc-600` in 12 | **holds as a historical measurement; the tree is now clean** | current counts: `text-zinc-500` **0**, `text-zinc-600` **0**, `text-zinc-400` **266** — the fix landed, and `tests/unit/a11y-contrast.test.ts` guards the palette so the tokens cannot come back one label at a time. (Reading D86(e) as a description of *today's* tree would be wrong.) |
| D87 | `axe-core@4.13.0` exactly pinned, test-only, automated scan homed in `tests/ui/a11y.spec.ts` | **holds** | `package.json:77` `"axe-core": "4.13.0"` in **devDependencies** (and `@axe-core/playwright` 4.13.0); `tests/ui/a11y.spec.ts:2-3` imports `@axe-core/playwright` + `axe-core`; 33 tier-1 specs total |
| D1-disposition #9 | this drag arm's problem was the *poll budget* (13.7 s vs 10 s), **CLEAN — raise that poll** | **does not hold as the arm's defect** | measured: the drag arm is **1.0–1.1 s** idle in file order (13.7 s is plausible peak-load latency), and the arm's reproducible failure is a **clipboard** wait (`:224`, and `:558` reading a predecessor's document). See S1: the budget raise is correctly *scoped* but did not make the arm sound |

**Claims I deliberately did not sample** (and therefore do not endorse or dispute): the corpus census
constants in the shared validators (D56/D60–D65, D70–D74 — hundreds of numbers I did not re-sweep),
the sync/WAD pipeline (D33/D35/D21), and the reduced-motion/a11y surface beyond the two claims above.
They are covered by the suites, which I ran green; that is weaker evidence than re-measurement and I
am saying so.

---

## 3. THE THREE SECURITY SURFACES — explicit conclusions

### 3.1 Git automation — `server/src/services/git.ts`, `server/src/services/savePipeline.ts`

**Findings: M1 (the surrounding exposure) and M2 (mid-write failure).** Everything else I checked
holds, and the answers to the AC's own questions are:

- **Path traversal / a key escaping its directory — clean.** A new file's name comes from
  `shared/naming.ts:190-230`, which rejects blank keys, `/`, `\`, NUL and a trailing `.json`; the
  zone family's `/`→`_` happens *before* the separator check. `createTargetPath` joins a fixed
  directory, and `savePipeline.ts:336-348` resolves every `removePaths` entry and refuses anything
  not strictly under the resolved root, plus refuses to "replace" the file it is writing. A create
  refuses a convention path already occupied by another key (`:325-330`).
- **Wrong branch or wrong identity — no.** The branch is `settings.git_branch` or
  `content/{local date}` (`git.ts:211-213`, `:279-311`); creation is from `main`'s HEAD and fails
  with an explicit message when the repo has no `main`; identity is `GIT_AUTHOR_*`/`GIT_COMMITTER_*`
  from `settings.user_name` plus a synthetic `@spiraldb-ui.local` address, deliberately *not*
  `git config` (so the owner's later commits are not re-authored), and the child environment is an
  allow-list (`git.ts:104-134`) that drops `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` and `EDITOR`
  (the last one because `simple-git`'s unsafety plugin refuses it — D48(e)).
- **A caller influencing the message or the branch — yes, and that is by design *except* for
  `notes`.** The header is server-built; `notes` is caller text in the body (S4); the branch and the
  repo path are caller-settable through `PUT /api/settings` (M1) — which is where a settings knob
  becomes a security control.
- **A failure leaving a file written but uncommitted — yes (M2).** Committed-but-unreported: no —
  the commit sha and the paths are returned from `commitObject` and surfaced in every response
  envelope, and the D22 staging order guarantees a deletion can never be committed without its
  replacement file.

### 3.2 File writes — `savePipeline.ts`, `spiraldbFiles.ts`, `spiraldbIndex.ts`, `shared/naming.ts`, `shared/objectCreate.ts`

**Findings: S3 (metadata ambiguity) and N1/N3/N4.** Direct answers:

- **Traversal — clean** (see 3.1). **Symlinks — one theoretical gap:** `writeSpiraldbJson`
  (`spiraldbFiles.ts:301-310`) and `fs.rmSync` follow a symlinked object file, so a symlink placed in
  a family directory could redirect a write (or a D22 delete) outside the root. I found no symlink in
  any corpus family directory and did not hunt further; recorded as LOW confidence, no evidence of
  reachability.
- **Collision — measured safe, mechanism recorded (N1).** 1205 distinct zone keys, 0 filename
  collisions; a collision would fail closed at create time.
- **Overwrite without confirmation — no.** A create refuses an occupied convention path; an update
  overwrites the file the user opened (the intent), after the caller's own confirmation for the
  extraction flow (D50(h)). Note the D5 merge is one-directional by design: a key cannot be deleted
  by omitting it (`spiraldbFiles.ts:366-389`, documented).
- **Encoding — clean.** `fs.writeFileSync(filePath, string)` → UTF-8; the bytes are
  `serializeDoc` = `JSON.stringify(doc,null,2) + "\n"` (single home, `shared/document.ts:123`), and
  explicit `null`s and key order survive (I additionally probed the mutation primitives with a
  document carrying an own `__proto__` key — **fidelity held**: the key survived `setAtPath` and
  round-tripped, because object spread creates an own data property that the later assignment
  updates. Prototype pollution: not reachable here. That was a hypothesis I falsified, not a
  finding.)
- **The `Name`-field lookup — S3.** The hazard is real (8 names), the lookup is deterministic, and
  the *choice* is warned about with the exact path it wrote. Not a wrong-file write; a debatable
  tie-break plus an untested branch.
- **Create filenames from user names — clean.** `shared/objectCreate.ts:260-306` builds the document,
  the canonical key (`ULong.toKey`) and the filename through `fileNameFor`; the ulong families
  reject anything beyond `Number.MAX_SAFE_INTEGER` rather than writing a rounded key
  (`shared/ulong.ts:74-81`) — and I measured the corpus's four ulong families: max `TemplateID`
  **1,749,527**, 0 values above `2^53-1`, 0 stored as strings, so no precision hazard is live either.

### 3.3 Subprocess CLI — `server/src/services/extraction.ts`, `server/src/routes/extract.ts`, `tools/PacketReaderCli/Program.cs`

**No finding.** What I checked, specifically:

- **Injection — none.** `execFile` with an **array** of arguments (`extraction.ts:153-176`), never a
  shell: `['--input', capturePath]` (`:539`) and `['--input', capturePath, '--output', outFile]`
  (`:561`). The wrapper parses `--input`/`--output` with an explicit switch and rejects unknown
  arguments (`Program.cs:219-256`), so a path that looks like a flag cannot become one.
- **Upload size/type/path — validated.** `multer` disk storage with `fileSize: 512 MB`,
  `files: 1` (`routes/extract.ts:179-181`), an extension filter on `.json` (`:182-194`), a
  **random UUID** filename (`:174-176`) so a hostile `originalname` never becomes a path, and the
  destination is a fixed `data/uploads/` created lazily (`:162-172`). Rejections and over-limit
  uploads become `{error}` with 400/413 (`:104-140`, `:197-208`).
- **Timeout / cancellation — deliberate, and honest about it.** `DEFAULT_TIMEOUT_MS = 0` (no second
  clock; a capture may take minutes), cancellation via `res.on('close')` with the `writableEnded`
  guard (`:225-234`) and a per-request `ChildRegistry` so aborting one extraction cannot kill
  another's child. The uploaded capture is deleted in `finally` (`:251-260`), and the `--output`
  retry temp dir is removed with a warning on failure (`extraction.ts:568-577`).
- **Missing / hostile binary — fails closed and informs.** `fileExists(cliPath)` first → a 500 with
  `npm run build:cli` (`extraction.ts:462-467`, `:533-535`); a spawn `ENOENT` after the probe maps to
  the same message (`:509-512`); a non-JSON or truncated stdout can never take the server down
  (`parseQuestArray`, `:376-406`) — it becomes the spec's `Failed to parse packet capture: …`.
- **Is any of its output trusted as a path or a command? — no.** stdout is only `JSON.parse`d and
  shape-checked as an array, and the response is `{quests, count}`. The `--output` path is chosen by
  Node (a fresh temp dir), never by the CLI or the user.
- **Two residual observations, neither a defect:** `ValidateCapture` reads the upload fully
  (`Program.cs:117`) and `QuestBuilder` then reads it again — 2× up to 512 MB, a memory/latency cost
  on a local tool; and the child inherits the full `process.env` (`buildChildEnv`), unlike the git
  child's allow-list — no caller-controlled value enters it, so this is consistency, not exposure.

---

## 4. POSITIVE OBSERVATIONS (what the run got right, so it is not lost in the fix list)

- **The `git.ts` environment allow-list with its measured reason.** Dropping `GIT_DIR`/
  `GIT_WORK_TREE`/`GIT_INDEX_FILE` so every command stays anchored to `repoPath`, and dropping
  `EDITOR` for `simple-git`'s unsafety plugin **instead of disabling the plugin** — that is a security
  control chosen correctly under pressure, and the comment carries the measurement.
- **The D22 write-before-delete staging order**, with the same-commit guarantee and the "never delete
  a file the merge did not account for" rule implemented from the live directory. This is the
  document-preservation contract enforced where it is cheap.
- **`shared/document.ts` as a genuinely dependency-free model** with four asserted properties
  (absent ≠ null, key order, no in-place mutation, unknown keys survive) — and the falsification
  method (a key-sorting writer that still passes deep-equality) is recorded, which is how you make
  fidelity testable rather than asserted.
- **`tests/unit/api-error-envelope.test.ts`** enumerating the mounted router and probing *every* route
  rather than a hand-written list (`:443-461`), including "no stack trace, no source file, no
  filesystem path" and "never HTML" arms.
- **The honesty of the written record.** D82's own wording is narrowed by measurement, D83(b) corrects
  it, D84(b) records that 1,416 unit tests passed on broken code, D85(a) records the lead's own false
  reds and that a gate measured against an edited tree is not a measurement, D74(c) records the
  lead's own wrong `object_type` query. This is the behaviour that makes an independent review
  productive rather than adversarial.
- **`copyQuestJson` reports failure honestly** (`QuestJsonPanel.tsx:76-83`: success toast only after
  `await writeText`, error toast in the catch) — no false "copied" claim, which is precisely what made
  S1 diagnosable as a *test* defect rather than a product one.

---

## 5. VERDICT — REFUSAL (REQUEST CHANGES), with exactly what must change first

**REQUEST CHANGES.** Per the review contract, HIGH severity at HIGH confidence blocks, and **M1** is
that: an unauthenticated, all-interfaces, any-origin API that writes files and creates commits in a
git repository whose path and branch it also accepts from the caller. The failure would be silent,
attributable to the owner, and reachable from a web page in their own browser while the tool runs.

**What must change before re-review (the blocking set):**

1. **M1** — bind the API to loopback and drop the blanket CORS (or restrict it to the dev origin),
   with the re-probe evidence in §1 M1.
2. **S1** — make the pointer-drag arm's clipboard read sound (wipe before the read; ideally assert the
   edit under test), and confirm the same fix in `quests-goal-logic.spec.ts` and
   `quests-info-editor.spec.ts`. Not a product defect, but it is *this gate's* evidence for a Phase-3
   AC and the disposition that closed it (#9) named the wrong symptom.
3. **S2** — one line in `package.json`: `dagre` moves to `dependencies`.

**What does *not* block, in my judgement** (fix at leisure, or record the decision):
S3 (tie-break direction + the missing two-file test), S4 (`notes` sanitising), M2 (rollback on a
mid-save git failure — fail-closed today, and the honest minimum is naming the dirty paths), and
N1–N5.

**I am willing to re-review**, and a second pass that finds the blocking set fixed is a perfectly good
outcome for this gate. I have **not** softened anything to let the gate pass, and I have not padded the
list: two hypotheses I formed while reading were falsified by measurement and are reported as such
(the `__proto__` key through the mutation primitives, §3.2; a dependency-placement sweep that first
flagged five packages and cleared four of them), and I explicitly record where I did *not* sample.

---

## 6. HONEST LIMITS

- **Coverage is a sample, not a proof.** The three named security surfaces and the shared model were
  read in full; roughly a third of the authored surface (most client components/libs, most
  schema/validation modules, the sync pipeline, 30 of 33 tier-1 specs) was read by search and by the
  suites' own runs. Every finding above is anchored to code I read line by line.
- **One tier-1 file was run, not 33.** `npm test` (1,462 arms, rc=0), `typecheck:tests` (rc=0) and
  `typecheck client` (rc=0) were run in full; `tests/ui/quests-goals-editor.spec.ts` was run three
  ways because it was the family I could falsify. The remaining tier-1 specs are unverified by me.
- **My measurements are single-host, mostly single-run.** The three drag-arm runs are repeatable in my
  session but were taken with nothing else running; the "13.7 s at peak load" figure from the run's
  record may well be real and I did not reproduce peak load.
- **M1's reachability is proven on this host** (`*:5341` in `ss -ltnp`, a foreign-origin `200`, a
  cross-origin settings write). I did not test from a second machine or through a firewall, so the
  LAN half is inferred from the wildcard bind rather than observed.
- **Two isolation limits I imposed on myself:** the owner's SpiralDB fork was **read only** (python
  over `QuestTemplates/`, `QuestMetadatas/`, `ZoneTransfer/` — no writes, no git commands), and the
  owner's `[::1]:5173` was never touched; the official tier-1 config's own port (5181) was used for
  the Playwright runs.
- **The artifacts this review left behind** are all gitignored and were checked: `data/test-ui.db`,
  `playwright-report/`, `test-results/` (from the Playwright runs), `/tmp/review-*` (rig logs and
  probes, outside the repo). `git status --porcelain` is empty; nothing was committed; no port I
  bound is still listening (`5341`, `5343`, `5181` all free) and no process I started survives.