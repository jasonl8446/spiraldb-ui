# final-review fix work — the gate-2 blocking set plus the remainder

**Role:** `omd-agent-executor`, doing the fix work the independent review demanded rather than
re-arguing it. **Tree:** `main` @ `1bbbda3` + this working tree. **Nothing committed** (D84(a):
the lead commits) and no git write beyond reading. Scratch lived in `/tmp`; the owner's
`[::1]:5173` (a sibling project's Vite — `card-gatcha-1`) and the owner's SpiralDB fork were
never touched, and every rig I started was on a port I own and was killed by explicit PID.

**Input:** [`final-review-codereview-gate2.md`](./final-review-codereview-gate2.md) (482 lines,
VERDICT: REQUEST CHANGES). Its numbering is kept below so the reviewer can check each item
against its own wording. Where I use a different label in code comments, it is the reviewer's
letter (`M1`, `M2`, `S1`–`S4`, `N1`–`N5`).

---

## 0. WHAT CHANGED, IN ONE SCREEN

| reviewer finding | disposition | proof |
|---|---|---|
| **M1** [HIGH] wildcard bind + blanket CORS | bind `127.0.0.1`, `cors()` **removed** (not narrowed), dependency + lockfile dropped, test mirror + docs corrected | §1: `ss` before/after, LAN address refused, 0 `Access-Control-*` headers, a **real browser** foreign-origin write allowed before / blocked after |
| **M2** [MEDIUM] commit failure leaves bytes written and uncommitted | chosen: **name the paths** (reviewer's honest minimum), not rollback | §2: injected rejecting `commitObject`; the message names exactly the paths the tree holds, and the guard refuses the next save |
| **S1** [MEDIUM] clipboard read can pass on another test's document | clipboard **wiped before Copy** in all three specs the review named; `quests-info-editor` also gained the missing poll; the 30 s budget **reverted** to the global 10 s | §3: before-reproduction (reads a predecessor's document, `Received +6`), after green alone and in file order, plus the falsification |
| **S2** [MEDIUM] `dagre` runtime import in `devDependencies` | moved to `dependencies` (`"dagre": "0.8.5"`, pin unchanged), lockfile re-projected | §4: production-only install pair — pre-fix tree has no dagre, fixed tree resolves it from its own copy |
| **S3** [MEDIUM] metadata tie-break prefers the legacy UUID file | deliberate tie-break: the tool's convention file wins **when a save is ambiguous**; the warning names the same file and says which rule chose it | §5: two-file unit arm + the API warning arm; the one-file case is pinned unchanged |
| **S4** [LOW→MEDIUM] `notes` reach the commit body unsanitised | one home: `buildCommitMessage` collapses caller notes to one line and caps them | §6: unit arm + a real commit read back from the repository |
| **N1** zone `/`→`_` create collision | recorded in `shared/naming.ts` (one measured sentence) | §7 |
| **N2** 500 bodies may name absolute paths | the **claim** was narrowed, the code kept (the path is deliberate actionability) | §7 |
| **N3** `express.json()` 100 KB default | recorded, unchanged (no dependency, and the largest real document has ~27 KB headroom) | §7 |
| **N4** symlinked `spiraldb_path` refused with a misleading message | fixed: the root comparison is on physical paths, so a symlink to a real root is accepted; the subdirectory refusal is unchanged | §7 |
| **N5** a symlinked object file is written through | fixed: `writeSpiraldbJson` fails closed on a symlinked target; the delete side needs no guard (`fs.rmSync` unlinks the link) | §7 |

**The seven checks, every rc captured on its own command** (`/tmp/gate-seven.txt`):

| check | rc |
|---|---|
| `npm test` | **0** — 67 files, **1472 tests passed** |
| `npm run lint` | **0** — `All matched files use Prettier code style!` |
| `npm run typecheck:tests` | **0** |
| `npx tsc -p server/tsconfig.json --noEmit` | **0** |
| `npx tsc -p client/tsconfig.json --noEmit` | **0** |
| `npm run build` | **0** — `✓ built in 4.74s` |
| `npm run test:ui` (NO `--config`) | **0** — 393 passed; the full-run pattern is below |

The full suite was run five times (each rc captured on the command itself; runs 1–2 on the tree
before the doc-only edits, runs 3–5 after, which is the same code):

| run | rc | result |
|---|---|---|
| 1 | **1** | 392 passed, 1 failed — **the 60 s filechooser wait** (carried family): `tests/ui/a11y-keyboard.spec.ts:298`, `page.waitForEvent('filechooser')` timing out |
| 2 | **0** | **393 passed**, 0 failed |
| 3 | 0 (wrapper rc, not captured on the command — hence runs 4–5) | 393 passed, 0 failed |
| 4 | **1** | 392 passed, 1 failed — **the extraction toast/pointer overlap** (carried family): `tests/ui/extraction.spec.ts:1024`, a sonner `<li data-sonner-toast>` intercepts pointer events over "Save All to SpiralDB" until the 60 s test timeout |
| 5 | **0** | **393 passed**, 0 failed, drag arm 2.5 s |

Both failures are two of the four families the brief names, both on surfaces this change does not
touch (a11y-keyboard's file chooser; the extraction save button), and both arms passed in the other
runs — including run 5 (`extraction.spec.ts:1014` at 1.9 s). They are carried by name and not
patched away. The other two families are the drag/spec family (**S1**'s subject — it passed in all
five runs, 1.2–2.7 s, with its backend clipboard residual measured in §3) and a dev-stack death
(discarded and re-run).

`test:ui` ran with the official configuration only (`playwright.config.ts`, its own ports 5181 +
3001, its own throwaway database). Both ports were verified free before the run and the harness's
own stack is what answered.

---

## 1. M1 — loopback bind, and CORS removed rather than narrowed

**Code.**
- `server/src/index.ts`: `const HOST = '127.0.0.1';` and `app.listen(PORT, HOST, …)`; the boot line
  now prints the bound address and `(loopback only)`.
- `server/src/app.ts`: `app.use(cors())` deleted, import deleted, and the reason written into the
  `createApp` doc-comment.
- `package.json` / `package-lock.json`: `cors` and `@types/cors` removed too (an unused dependency
  is the same slop the finding is about); `tests/unit/extract-api.test.ts`'s mirror app lost its own
  `cors()` so it stays a faithful mirror.
- Docs that assumed the middleware: `docs/plan-phase-1-foundation.md` (its task list named `cors`),
  `docs/spec-architecture.md` (the port line and the illustrative dependency block),
  `README.md` (the two mode-table cells + the two `:3001` lines now say loopback only).

**Four decisions, each deliberate.**
1. **Removed, not narrowed.** The reviewer's "or `cors({ origin: 'http://localhost:5173' })`" is
   the belt-and-braces option; there is nothing to wear it for. The client is same-origin in both
   modes — dev goes through Vite's `/api` proxy (`client/vite.config.ts`), production is served by
   this same Express process — and `client/src/lib/api.ts` only ever calls `/api/...`. Verified:
   no spec asserts the header, no test asserts the header, no script fetches from another origin,
   and `greps` for `cors` now return only the doc-comments and the removal note.
2. **`127.0.0.1`, not `'localhost'` and not `'::1'` alone.** `localhost` resolves to `::1` first on
   this host (Node's default `verbatim` order, measured: `lookup localhost → [::1, 127.0.0.1]`) and
   to `127.0.0.1` first on others, so the bound interface would depend on the machine; `'::1'` alone
   fails on a host without IPv6. Clients that ask for the name still reach it — errno-free
   measurement below, and `npm run dev` through the proxy is the end-to-end case.
3. **No Host/Origin check.** The review calls it a defence-in-depth companion, "not required for the
   finding to be closed", and it has a functional cost (any hostname other than `localhost`/
   `127.0.0.1` would stop working). Recorded as a residual in §8 instead.
4. **The `.omd/prd/spiraldb-ui.json` transcripts that quote `access-control-allow-origin: *` were
   left alone** — they are the historical record of what was measured when task 1.1 shipped, and
   rewriting a past measurement to match today's code would be the dishonest option.

**Proof — measured on an isolated rig, both halves.** The rig: a throwaway `git init` repo and a
throwaway SQLite file under `/tmp`, `SPIRALDB_UI_SKIP_IMPORT=1`, ports `5351` (fixed tree) and
`5353` (HEAD's tree, extracted with `git archive HEAD` into `/tmp`), plus a static page server on
`5352` to act as the *foreign origin* for a real browser. Identity asserted first: `192.168.8.186`
is this host's LAN address (`ip -4 addr show scope global`).

BEFORE (HEAD's code, port 5353):

```
LISTEN 0      511                *:5353             *:*            # the wildcard address
HTTP/1.1 200 OK
Access-Control-Allow-Origin: *                                        # every response
HTTP/1.1 204 No Content                                               # foreign-origin preflight
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET,HEAD,PUT,PATCH,POST,DELETE
Access-Control-Allow-Headers: content-type
```

and a **browser** at `http://127.0.0.1:5352` (a different port is a different origin):

```json
{ "jsonPut": "RESOLVED status=200 acao=null",
  "get":     "RESOLVED status=200 acao=null body={\"aurorium_path\":…" }
```

after which `GET /api/settings` read `user_name` back as `CSRF-DEMO-WRITE (pre-fix HEAD)` — a
durable write from a page on another origin, exactly the reviewer's measurement. (The `acao=null`
is the browser's own header filter — `Access-Control-Allow-Origin` is not a CORS-safelisted
*response* header, so JS cannot read it even when the request resolved; the wire measurement is the
`curl` above.)

AFTER (this tree, port 5351):

```
LISTEN 0      511        127.0.0.1:5351       0.0.0.0:*
$ curl -sS -m 5 -i http://192.168.8.186:5351/api/health
curl: (7) Failed to connect to 192.168.8.186:5351 after 0 ms: Could not connect to server
```

| probe | result |
|---|---|
| `GET /api/health` with `Origin: https://evil.example` | 200, **no** `Access-Control-*` header |
| `GET /api/settings` with the same foreign origin | 200, **no** `Access-Control-*` header |
| `OPTIONS` preflight for `PUT` with `Access-Control-Request-Method: PUT` | 200 `Allow: GET,HEAD,PUT` (Express's own OPTIONS), **no** `Access-Control-Allow-Origin`, **no** `Access-Control-Allow-Methods` |
| real `Access-Control-*` response headers across the whole probe set | **0** (counted as `^Access-Control-[A-Za-z-]+: `; the one earlier "1" was my own summary line, which is why the tally is written this way) |

and the same browser at `http://127.0.0.1:5352`:

```
jsonPut:    "REJECTED: TypeError: Failed to fetch"
textPlainPut: "REJECTED: TypeError: Failed to fetch"
get:        "REJECTED: TypeError: Failed to fetch"
```

with the browser's own diagnostic in the console:

```
Access to fetch at 'http://127.0.0.1:5351/api/settings' from origin 'http://127.0.0.1:5352' has
been blocked by CORS policy: Response to preflight request doesn't pass access control check:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
Access to fetch at 'http://127.0.0.1:5351/api/settings' from origin 'http://127.0.0.1:5352' has
been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested
resource.
```

`user_name` after the blocked attempts: `''` (unchanged). So the preflighted JSON write is never
sent, and the CORS-simple attempts neither resolve nor change state.

**No functional cost, measured end to end.** `npm run dev` with a throwaway database and
`VITE_PORT=5192` (my port; `5173` belongs to a sibling project):

```
[server] [spiraldb-ui] API listening on http://127.0.0.1:3001 (loopback only)
[client]   ➜  Local:   http://localhost:5192/
$ curl -s -m 2 -o /dev/null -w '%{http_code}' http://localhost:5192/api/status/_import   → 200
   (Vite's proxy target is still `http://localhost:3001`; the readiness route answered in 2 s,
    which is only possible if Vite → proxy → loopback Express all worked)
$ curl -s -o /tmp/m1dev/index.html -w '%{http_code} %{content_type}' http://localhost:5192/ → 200 text/html
   (grep -c 'id="root"' → 1)
```

---

## 2. M2 — a commit failure after the bytes moved

**Chosen: name the paths (the reviewer's honest minimum), not rollback.** Reason, in the code and
here: a faithful rollback has to restore the object, each D22 deletion and the companion metadata
**and** unstage everything this save staged — a failed `commit` leaves the index staged, so
restoring bytes alone leaves `git status` at `MM` and D14 still refuses — while the `pre-commit`
hook that failed may itself own the index. A half-rollback that the guard still rejects is worse
than an honest error the operator can act on, and nothing is lost: the bytes are the user's own
edit.

**Code.** `savePipeline.ts`: the write/deletions/metadata/commit run inside one `try` (the status
upsert, deliberately, stays outside it — a DB failure there must not claim the commit never
happened); on failure with bytes moved it throws `UncommittedSaveError`, whose message names every
written and deleted path (root-relative), says the tree is dirty, says the clean-tree guard will
refuse later saves, and carries the git failure's own message. A failure **before** any bytes moved
is rethrown unchanged.

**Proof** (`tests/unit/save-pipeline.test.ts`, three arms; the git layer is injected, so the
failure is forced rather than simulated in prose):

| arm | asserts |
|---|---|
| `names the written-but-uncommitted paths, and the tree really holds exactly those` | before: clean tree, 1 seed commit; the error is an `UncommittedSaveError`, mentions `written but not committed`, both paths, the D14 guard and the injected git message; after: `git status --porcelain` has **exactly** those 2 lines, both files exist, `commitCount` is still 1, and the **next** save rejects with `DirtyRepoError` |
| `names the D22 deletions it applied, not only the files it wrote` | the message contains `Deleted: QuestMetadatas/069f430e-…json`, the file is gone and its deletion is in the porcelain |
| `does not claim uncommitted bytes when the failure happened before the write` | an outside-`root` replacement is refused as `SpiraldbFileError` (not relabelled), nothing is written, no commit |

---

## 3. S1 — the pointer-drag arm's clipboard read

**Code.** The three specs the review named now wipe the clipboard before the `Copy` click, as ten
sibling specs already did:
- `tests/ui/quests-goals-editor.spec.ts` (the drag arm's helper);
- `tests/ui/quests-goal-logic.spec.ts` (two arms read the document twice in one test);
- `tests/ui/quests-info-editor.spec.ts` — wipe **and** the poll it never had: it read the clipboard
  once, immediately after the click, which can catch the async `writeText` empty.

**The budget: reverted, and why.** Final-deslop's disposition #9 raised this arm's
`expect.poll(() => cardOrder(page))` to 30 s on the reading *"the dnd-kit pointer drag measures
13.7 s"*. The run's own record contradicts that reading: `docs/evidence/phase-5/p5-07-d3-proof.md`
says of this arm — "**not the drag**: the arm calls `copyPanelDocument`, whose `expect.poll` waits
only 10 s … — 13.7 s when it fails, 3.8 s when it passes". 13.7 s was the *failing test's* wall
time with the 10 s clipboard wait **inside** it. The drag itself measures ~1–2.4 s here. So the
raise rested on a symptom that belonged to the helper, and it is reverted to the global 10 s: a
30 s budget on the *render* poll would let a genuinely stalled drag pass. The corrected
justification is written where the raise used to be.

**Proof (all `npm run test:ui`, no `--config`; rc on each command).**

| run | command | result |
|---|---|---|
| reproduce the defect | wipe removed, `--grep "5 types\|pointer drag"` | **rc=1** at the document assertion, `Received +6`: the arm read the **predecessor's** 8-goal document — the reviewer's measurement #3, reproduced |
| the arm alone | wipe restored, `--grep "pointer drag"` | **rc=0**, 1 test, 2.4 s (was rc=1 / `Timeout 10000ms` alone before) |
| the arm alone ×3 (plain helper) | `--repeat-each=3` | **rc=1** — 2 passed, 1 failed on the clipboard poll (the residual, below) |
| the arm alone ×8 (instrumented helper) | `--repeat-each=8` | **rc=0**, 8 passed |
| the three touched files | `npm run test:ui -- <the three specs>` | **rc=0**, **37 passed** (14.6 s), drag arm 1.2 s |
| the whole suite, twice | `npm run test:ui` | run 1: **rc=1**, 392 passed + the carried filechooser flake, drag arm 2.0 s; run 2: **rc=0, 393 passed**, drag arm 2.7 s |

**Falsification of the arm's subject.** The assertion at the end of the drag test is a claim about
the document the panel just serialized, so it has to move when what `Copy` writes moves. Diagnostic
run: with the panel's `copyQuestJson` patched to write a *fixed* document
(`{"m_questName": "FALSIFIED", "m_goals": []}`), a read-back probe printed exactly that fixed
document as the clipboard's content and the helper returned it — i.e. the helper reports what `Copy`
writes, which is the property the wipe makes sound. (Two attempts at making the *assertion* itself
the failure site instead redded at the clipboard poll, one of the two being the load-sensitive
residual measured below; I am reporting that rather than the cleaner sentence I wanted.)

The falsification of the *fix* is the before/after pair above: remove the wipe and the arm goes red
again, reading a neighbour's document.

**Residual, carried by name and measured** (the drag/spec family the brief lists): with the wipe in
place the arm alone failed **1 of 3** runs during a loaded period and **8/8 + 4/4** when the machine
was idle. A probe of the write itself (`document.title = 'COPY-OK'` inside the panel's copy path)
recorded `COPY-OK` with the live document on the clipboard (len 3292) in **3/3** sampled
reproductions — so the residual is load-sensitive clipboard latency, not stale content, and not a
write rejection. I did **not** widen a budget or add a retry for it: the brief's forbidden fix is
"adding a wait or a timeout rather than isolating the clipboard", and a retry would mask a genuine
clipboard failure if one ever happens. The arm is content-sound and falsifiable today; the residual
is the same load sensitivity the run already carries for this family.

---

## 4. S2 — `dagre` moved to `dependencies`

**Code.** `package.json`: `"dagre": "0.8.5"` moved from `devDependencies` to `dependencies`
(alphabetical position; the exact pin is unchanged, matching its `@xyflow/react` neighbour);
`@types/dagre` stays dev. `package-lock.json` re-projected mechanically — probed in a `/tmp` copy
first (`npm install --package-lock-only`, 43-line diff) — and the lockfile now records the *runtime*
semantics: `node_modules/dagre`, `node_modules/graphlib` and `node_modules/lodash` all lose
`"dev": true`, and `cors`/`@types/cors` disappear (M1).

**Proof — a production-only install, before and after.** Two `/tmp` trees with the same command:

| | BEFORE (`git archive HEAD`'s manifest) | AFTER (this tree's manifest) |
|---|---|---|
| `npm ci --omit=dev` | rc=0 | rc=0 |
| tree's own `node_modules/dagre` | **absent** | **present** |
| `npm ls --omit=dev dagre` | `└── (empty)` | `└── dagre@0.8.5` |
| bare `require.resolve('dagre')` from the tree | the *workspace's* copy (`/home/jason/.../node_modules/dagre/index.js`) — see the limit | **`/tmp/s2build-after/node_modules/dagre/index.js`** (its own production copy; nearest wins) |
| `import('<tree>/node_modules/dagre/index.js')` | `ERR_MODULE_NOT_FOUND` | loads, `layout` is a function |

**Limit, named.** The full `npm ci --omit=dev && npm run build` arm cannot be made clean on this
host, for two reasons that are both worth stating: (i) this repo's build toolchain (`vite`,
`typescript`) is itself in `devDependencies`, so a prod-only tree cannot invoke the build
regardless of `dagre` — a property of the toolchain split, not of this finding; and (ii) an earlier
session left `/tmp/node_modules` → this workspace's full install, which sits in every `/tmp` tree's
resolver ancestor chain — visible in the BEFORE row above, where the bare resolve found the
workspace copy. `/var/tmp`, `/dev/shm` and `/run/user` are denied by the sandbox and unprivileged
user namespaces are unavailable (`unshare -rm` → `cannot open /proc/self/uid_map: Permission
denied`), so no writable scratch root free of that symlink exists.

**Closest honest equivalent, and it does build.** In both trees, `npm ci --omit=dev` plus *only the
compiler* (`npm i --omit=dev --no-save vite@5.4.21 @vitejs/plugin-react@4.3.4 typescript@5.7.2`)
then `npx vite build --config client/vite.config.ts`: rc=0 in both, and the lazily-loaded chunk that
imports dagre contains dagre's code — `client/dist/assets/QuestGoalLogicEditor-*.js` matches
`rankdir`, `graphlib` and `acyclic` in **both** trees, with the same hashes, i.e. the move is
manifest-only. The AFTER tree's bare resolve proves the chunk's `dagre` came from its *own*
production install; the BEFORE tree's rc=0 is explained by (ii) and is reported as inconclusive
rather than as a pre-fix pass. In this workspace, `npm run build` is rc=0 and the emitted chunk again
matches those three tokens, so the build demonstrably consumes `dagre`.

---

## 5. S3 — which metadata file an ambiguous `Name` updates

**Code.** `savePipeline.ts` gains one exported resolver, `questMetadataSaveTarget(index, root,
name)`, used by both callers that must agree: the pipeline writes its `path`, and the quests API's
duplicate warning (`services/quests.ts`) names the same file and says which rule chose it
(`tieBreak`). The rule is D19/D20's — the index's answer, first-in-file-name-order — **plus one
deliberate exception**: when this tool's own convention file
(`QuestMetadatas/questmetadata_<name>.json`) *also* holds this `Name`, the convention file wins.
The exception is narrow by construction: a name held by a *single* off-convention file keeps
updating that file (never a new create), so the 316−8 one-file names are unchanged, and the
`indexed` arm is pinned by a test.

Why the convention file wins: it is what this tool's create path writes (`shared/naming.ts`) and
what the owner's own builder writes, so it is the file the tool owns; the other candidate in every
measured pair is an opaque capture UUID. Measured corpus shape (reviewer, re-stated because it is
the rationale): 324 files / 316 names / 8 duplicates, every pair being UUID + convention, and
`'0' < 'q'` meant first-in-name-order refreshed the legacy file and left the newer one stale.

**The warning.** It still warns with the exact file and the count — the parenthetical now matches
the rule that actually ran ("this tool's own convention file, preferred when a save is ambiguous"
vs "first in file-name order"), because a warning that named the wrong file (or the wrong reason)
would be worse than the defect. `tests/unit/quests-api.test.ts`'s existing arm — two *legacy* files,
no convention file — still passes unchanged, which is the evidence that the fallback is intact.

**Proof.** `tests/unit/save-pipeline.test.ts`: `updates the tool convention file, and reports which
rule chose it` (both files committed; the index still resolves to the UUID file — asserted, so the
ambiguity is proven real — then the save updates the convention file, `metadataPath` proves which,
the UUID file keeps its bytes and its `ModifiedBy: makima`); `leaves the ordinary (single-file)
resolution alone` (the tie-break does not fire). `tests/unit/quests-api.test.ts`:
`prefers the tool convention file when both it and a legacy file hold the Name (S3)` — the API's
`warnings[]` names `QuestMetadatas/questmetadata_DUP-2.json`, contains "this tool's own convention
file", and the legacy file is untouched.

---

## 6. S4 — caller `notes` in the commit body

**Code.** One home: `buildCommitMessage` (`server/src/services/git.ts`) now routes `notes` through
`sanitizeCommitNotes`, which collapses every control character (newlines included) and every run of
whitespace to a single space, trims, drops an empty result, and caps the length
(`MAX_COMMIT_NOTES_LENGTH = 255`, the same order as the capture-note cap). Both write paths
(`services/quests.ts` and `routes/objects.ts`) reach a commit through it, so neither has to
remember. It is deliberately *not* `sanitizeCaptureSource` — that one also reduces a path to its
base name, which is meaningless for a typed note.

**Proof.** `tests/unit/git-service.test.ts`: the trailer payload
`'normal\n\nCo-authored-by: evil <evil@example.com>\nSigned-off-by: evil'` becomes one body line,
tabs/CR/NUL/DEL collapse the same way, and an over-long note is exactly
`MAX_COMMIT_NOTES_LENGTH` characters. `tests/unit/save-pipeline.test.ts`:
`collapses newlines and trailers to one line, in the real commit` — saves through the real pipeline
and reads the body back with `git log -1 --pretty=%B`, asserting exactly three lines (header, blank,
one body line) and that no line starts with `Co-authored-by:`. The header was never at risk: it is
built server-side from the validated type/key.

---

## 7. The notes

- **N1 — the zone `/`→`_` create collision: recorded, not worked around.** `shared/naming.ts`'s
  lossy-transform section now says what it costs a create: `A_B` next to `A/B` is uncreatable
  because the create path refuses an occupied convention path and says so, with the measurement
  (1205 distinct `ZoneName`s, 0 such collisions) and a pointer to D74(h)'s duplicate *key*. Nothing
  overwrites anything, so the residue is one uncreatable name shape.
- **N2 — absolute paths in 500 messages: the claim changed, the code did not.** The path is
  deliberate actionability (D37/D38 — the operator has to find the file), and the review itself
  calls it "no action required". So the test that read as broader than it is got its scope written
  in: `tests/unit/api-error-envelope.test.ts`'s arm is renamed to "…in the 400s it probes" and its
  comment states that every probe is a malformed request and that a 5xx may legitimately name a
  path. Fixing the *claim* rather than the code is the honest direction here.
- **N3 — `express.json()`'s 100 KB default: recorded.** No limit added: a size bump is a
  behavioural change with no measured victim (the largest real quest is ~119 KB pretty / ~73 KB
  minified, so ~27 KB of headroom), and the review lists it as a risk to know, not a defect. The
  residual (a future >100 KB-minified document would be unsaveable with a terse 413) is carried
  here rather than silently fixed.
- **N4 — symlinked `spiraldb_path`: fixed.** `git.ts`'s `isWorkingTreeRoot` now compares **physical**
  paths (`physicalPath` = `realpathSync` with a resolve fallback), so a symlink to a real
  working-tree root is accepted while a *subdirectory* of a repository is still refused (that rule
  is what the check exists for). New arm: `accepts a symlink to a working-tree root, which git
  reports by its physical path (N4)` — self-cleaning and idempotent (a stale link from an
  interrupted run would otherwise fail on `EEXIST`); the existing subdirectory-refusal arm is
  unchanged and still green.
- **N5 — a symlinked object file: fails closed now.** `writeSpiraldbJson` refuses when the target is
  a symbolic link (`lstatSync`), with a message that says what to do; `fs.writeFileSync` would
  otherwise follow the link and write outside the root. The delete side needs no guard: `fs.rmSync`
  unlinks the link itself, never its target. New arm: `refuses to write through a symbolic link,
  leaving the target untouched (N5)` — the link's target bytes are byte-identical afterwards, the
  link is still a link, and an ordinary file beside it is still written (positive partner).
- **N5-bis — the shared scratch root: recorded.** `/tmp/node_modules` is a symlink another session
  left pointing at this workspace's `node_modules`; it made the pre-fix build arm inconclusive (§4)
  and it is why the two resolution proofs above are written as *path-explicit* checks. It was not
  mine to delete, so I left it and stated its effect instead.

---

## 8. Honest limits and residuals of this fix work

- **M1's LAN half is inferred from the wildcard/literal bind**, not observed from a second machine:
  what I measured is `curl` from the host to its own LAN address (rc=7, connection refused) and
  `ss` naming `127.0.0.1` — the review's own limit, unchanged.
- **No Origin/Host check was added** (M1's defence-in-depth companion). Residual, stated plainly: a
  DNS-rebinding page could still *send* a CORS-simple request to loopback. The preflighted ones
  (`application/json`, which every write route needs) are blocked by the missing preflight
  approval — measured in the browser above — and a simple request's body is not parsed, because
  `express.json()` only accepts `application/json`. That is a mitigation, not a proof; a Host check
  is the review's `not required` item and is the right next move if the owner wants rebinding
  closed.
- **S1's residual** is the load-sensitive clipboard latency quantified in §3. The arm is
  content-sound and green when run alone and in file order; on a loaded machine it can still exceed
  the 10 s poll. I did not paper over it with a budget or a retry.
- **S2's build arm** is inconclusive in the pre-fix direction on this host — the reason and the
  substitute evidence are in §4.
- **The unit arms were written by me**, so they are evidence of the behaviour I intended and not an
  independent check of it. They live in the existing suites (67 files, 1472 tests) and every one of
  them carries a positive partner (the single-file metadata case, the ordinary write, the
  before-the-write failure, the subdirectory refusal).
- **Two decisions in this fix work are the kind the run records as D-items and the lead owns**: the
  loopback/no-CORS posture (with the removed dependency) and the metadata tie-break direction. I did
  not add D-entries to `docs/plan-overview.md`; the reviewer's findings plus §1 and §5 are what a
  D-entry would cite.
- **Artefacts**: `playwright-report/`, `test-results/`, `data/` contents and `client/dist` are the
  run's own gitignored output; `/tmp` holds the probe rigs and logs. Nothing is committed.