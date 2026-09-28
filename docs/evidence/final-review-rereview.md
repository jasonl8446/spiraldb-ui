# final-review — second pass, independent re-review of the fix work (`b54f45b`)

**Role:** `omd-agent-code-reviewer`, fresh context. I did not author the change under review and I
did not author the artifact it answers. The loop must not approve itself, so every verdict below
rests on something I measured in this session, not on either artifact's prose.

**Tree:** `main` @ **`b54f45b`** ("final-review fixes: loopback bind, no wildcard CORS, and the
reviewer's tail"). `git status --porcelain` empty at launch; empty at the end (the one tracked file
a tier-1 run rewrites, §3 NF1, was restored byte-for-byte from HEAD). **Nothing committed; no git
write beyond reading** apart from that byte restore, which wrote a working-tree file from
`git show HEAD:…` without touching the index, refs or history.

**Inputs:** [`final-review-codereview-gate2.md`](./final-review-codereview-gate2.md) (the first
reviewer — treated as *claims*), [`final-review-fix-d1.md`](./final-review-fix-d1.md) (the fix
work), the diff `1bbbda3..b54f45b` (21 files, +694/−102), and the code those two touch.

**Verdict in one line:** **APPROVE.** The two findings that could have blocked (M1, S2) are closed
by measurement; the third (S1) is **partially resolved** — the defect it names is fixed and I
reproduced the defect before and its absence after, but the *acceptance proof the first reviewer
attached* ("alone goes green") is not achievable by the remedy they asked for and does not hold; the
residual is a pre-existing flake of that arm, unchanged in kind, and it cannot produce a false pass.

---

## 0. SCOPE — what I read, what I ran, what I skipped

**Read in full:** the whole diff (`server/src/app.ts`, `server/src/index.ts`, `savePipeline.ts`'s
new resolver/error/try-block, `git.ts`'s sanitiser + `physicalPath`, `quests.ts`'s warning,
`spiraldbFiles.ts`'s symlink guard, `shared/naming.ts`'s N1 sentence, `package.json` /
`package-lock.json`, README / `docs/spec-architecture.md` / `docs/plan-phase-1-foundation.md`, the
four touched unit suites, the three touched tier-1 specs, `playwright.config.ts`, `ci.yml`), plus
the pre-fix versions of the files whose *behaviour change* I had to establish.

**Ran, every rc captured on the command itself** (full commands in §5):

| what | result |
|---|---|
| `npm test` | **rc=0** — 67 files / **1472 tests** |
| `npm run test:ui` (official config, no `--config`) | **rc=0** — **393 passed**, 2.0 m |
| `npm run typecheck:tests` / `tsc -p server` / `tsc -p client` | **rc=0** / **rc=0** / **rc=0** |
| `npm run lint` | **rc=0** — Prettier clean |
| `npm run build` | **rc=0** — built in 2.88 s |
| isolated API rigs (ports 5361, 5364, 5365, 5366 — all mine, all killed by explicit PID) | bind / CORS / M2 / S3 / S4 probes |
| dev stack (API 3001 + `VITE_PORT=5192`) and production stack (API serving `client/dist` on 3001) | same-origin end-to-end |
| a `/tmp` copy of the **pre-fix tree** (`git archive 1bbbda3`) + three probe suites of my own | the "before" half of M2/S3/S4/N4/N5 |
| a `/tmp` copy of the **pre-fix specs**, run against the real dev stack | the "before" half of S1 |
| a real prod-only `npm ci --omit=dev` in `/tmp` | S2's install half |
| read-only `python3` over the owner's fork | N1/N3/N5/S3 corpus figures, re-measured |

**Skipped, and why:** the 300-odd other authored files (nothing in this commit touches them; the
first reviewer read them and my mandate is this diff), the .NET CLI wrapper and the sync/WAD
pipeline (untouched by the change and not on any finding's path), and 30 of the 33 tier-1 specs as
*individual* runs — the whole suite ran green instead, which is the stronger and cheaper signal for
this change. I did **not** re-run the D-item sweep beyond the three claims §2 samples.

---

## 1. FINDINGS — one verdict each, with my own evidence

### M1 [HIGH] wildcard bind + blanket CORS while the API writes files and commits — **RESOLVED**

*Rig:* throwaway `git init` repo at `/tmp/rr2/repo`, `SPIRALDB_UI_DB=/tmp/rr2/db.sqlite`,
`SPIRALDB_PATH=/tmp/rr2/repo`, `SPIRALDB_UI_SKIP_IMPORT=1`, `PORT=5361`,
`node --import tsx server/src/index.ts`. Identity asserted **before** probing: `ip -4 addr show
scope global` → `192.168.8.186`.

**The bind is genuinely loopback.**

```
$ ss -ltnp | grep 5361
LISTEN 0  511  127.0.0.1:5361  0.0.0.0:*   users:(("MainThread",pid=4192651,fd=24))
$ curl -sS -m 4 -o /dev/null -w 'http=%{http_code}\n' http://192.168.8.186:5361/api/health
curl: (7) Failed to connect to 192.168.8.186:5361 after 0 ms: Could not connect to server
rc=7
```

The `127.0.0.1` literal — not the wildcard the first reviewer measured (`*:5341`). The LAN half is
still same-host (the first reviewer's own limit, unchanged), but the address is a *different*
address from the one it bound, and it is refused.

**No `Access-Control-*` header for a foreign origin, and the preflight is no longer approved.**

| probe | result |
|---|---|
| `GET /api/health` + `Origin: https://evil.example` | 200, no `Access-Control-*` |
| `GET /api/settings` + same origin | 200, no `Access-Control-*` |
| `OPTIONS /api/settings`, `Access-Control-Request-Method: PUT` | 200, `Allow: GET,HEAD,PUT` (Express's own handler), **no** `Access-Control-Allow-Origin`, **no** `Access-Control-Allow-Methods` |
| `grep -hciE '^Access-Control-[A-Za-z-]+: '` over every probe file | **0** |

**A foreign-origin write no longer succeeds — measured in a real browser.** A static page served
from `http://127.0.0.1:5362/probe.html` (a different port is a different origin) attempted
`GET`, a JSON `PUT /api/settings` and a `text/plain` `PUT`:

```json
{"get":"REJECTED: TypeError: Failed to fetch",
 "jsonPut":"REJECTED: TypeError: Failed to fetch",
 "textPlainPut":"REJECTED: TypeError: Failed to fetch"}
```

with the browser's own diagnostics — *"blocked by CORS policy: Response to preflight request doesn't
pass access control check: No 'Access-Control-Allow-Origin' header is present"* — and
`user_name` read back as `''` afterwards (unchanged). `curl` still gets a 200 on the same `PUT`,
which is correct and not a gap in the fix: CORS is browser-enforced, and the loopback bind is what
removes the remote half. What remains reachable is a *local* process, which no CORS policy could
have stopped either.

**Both same-origin paths still work** (the "no functional cost" claim, re-measured):

- **dev**: API on 3001 + `VITE_PORT=5192 npx vite --config client/vite.config.ts`.
  `curl http://localhost:5192/api/health` → **200** (`rc=0`), `/` → 200 `text/html` with one
  `id="root"`, and the app in a browser made all four of its calls same-origin:
  `/api/settings`, `/api/dashboard`, `/api/status/_import`, `/api/activity?limit=10` → **200** each.
- **production**: the API serving `client/dist` on 3001 — app at `http://127.0.0.1:3001/`, the same
  four calls → **200** each.
- **The literal choice is safe where it could have hurt.** Vite binds `[::1]:5192` and its proxy
  target is `http://localhost:3001`, and `dns.lookup('localhost')` on this host returns
  `[::1, 127.0.0.1]` — i.e. `::1` first. Measured: `curl http://[::1]:3001/api/health` → **rc=7**,
  `curl http://127.0.0.1:3001/api/health` → **200**, and the proxied request **succeeds**. The
  cross-family fallback is real, so binding the IPv4 literal does not strand the dev proxy.

**Nothing else in the tree assumed the wildcard.** `grep -rniI cors` outside
`node_modules`/`dist`/`docs/evidence`/`.omd` returns only the new `app.ts` doc-comment, the three
corrected docs, and the test-mirror comment; there is no `from 'cors'` import anywhere;
`cors`/`@types/cors` are gone from `package.json` **and** `package-lock.json`; `Access-Control`
appears nowhere but the comment; no script or spec fetches another origin; `ci.yml` makes no direct
API call. The historical `.omd/prd/spiraldb-ui.json` transcript that quotes
`access-control-allow-origin: *` was deliberately left as a past measurement — I agree with that
call.

**Remove vs narrow — I judge removing the better of the two.** The client is same-origin in both
modes, verified: `client/src/lib/api.ts` documents and uses only relative `/api/...` paths, and my
dev + production runs above show both boot and work. A narrow
`cors({ origin: 'http://localhost:5173' })` would not just be dead code: the official tier-1 harness
runs the dev client on `VITE_PORT=5181` (`playwright.config.ts`), a *different* origin, so a
5173-only allow-list would be strictly narrower than the client's real needs. Deleting is the
smaller, more honest change.

*Residual (unchanged from the first reviewer, and correctly not claimed as fixed):* no Host/Origin
check, so DNS-rebinding remains the theoretical browser path; the fix states it in §8 and the first
reviewer scoped it as "defence-in-depth, not required".

### M2 [MEDIUM] a git failure mid-save leaves bytes written and uncommitted — **RESOLVED** (at the bar the finding itself set), one new LOW note

*End-to-end probe:* a fresh repo with a `pre-commit` hook that exits 1, then
`POST /api/quests` through the real API:

```json
{"error":"The save was written but not committed: the SpiralDB working tree at /tmp/rr2/repo2 is
now dirty. Written: QuestTemplates/questtemplates_RR2-CFAIL-001.json,
QuestMetadatas/questmetadata_RR2-CFAIL-001.json. Every later save is refused by the clean-tree
guard (D14) until you resolve this: commit or restore these paths by hand.
The commit failed with: hook: refusing\n"}
```

- The claim is exactly true, no more: `git status --porcelain` in that repo shows **those two paths
  and nothing else**, `git log` still has one commit, both files exist.
- The message's claim "every later save is refused" is **measured**: the next POST answers **409**
  with `DirtyRepoError`, naming the same two paths.
- **The rollback reasoning is confirmed by measurement, not assertion.** The porcelain lines are
  `A  QuestTemplates/…` and `A  QuestMetadatas/…` — a failed `commit` leaves the index **staged**,
  so the fix's argument that "restoring bytes alone still reads `MM` and D14 refuses" describes the
  actual state a rollback would have had to unpick. That is the strongest part of the disposition.
- *Before,* measured in the pre-fix tree (`git archive 1bbbda3` in `/tmp`, my own probe suite): a
  rejecting `commitObject` produced `Error: pre-commit hook rejected` — no path named, no
  dirty-tree warning, file on disk. The finding's premise was real and the fix addresses it.
- **A database failure cannot claim the commit never happened:** the status upsert sits *outside*
  the `try` (read: `savePipeline.ts`, step 7, after the `catch`). Code-verified; I did not force a
  DB failure at that point and I am labelling that as inferred rather than executed.

**Was "name it" adequate, or was rollback required?** Adequate, and I would have chosen it too. The
finding's own text says the honest minimum is naming the paths; the failure is recoverable by the
operator; and the measured index state shows a rollback is *not* the cheap two-liner it sounds like
(it must be pathspec-scoped: `git restore --staged --`, then restore tracked bytes, then unlink
created files, while a hook may still hold the index). I record one improvement as a *suggestion*,
not a requirement: a pathspec-scoped unstage of exactly the named paths would make the tool
self-recovering rather than requiring git surgery. Not blocking, and not a regression.

**New finding NF2 (see §3) is the one gap I found in the new error path** — it can only under-report,
never over-report.

### S1 [MEDIUM] the drag spec's document assertion could pass on another test's clipboard — **PARTIALLY RESOLVED**

This is the finding with the most measurement behind it, because it is the one where I could
falsify both directions.

**(a) The defect is real, and I reproduced it myself.** I extracted the pre-fix spec
(`git show 1bbbda3:tests/ui/quests-goals-editor.spec.ts` → `/tmp/rr2/tests/ui/`) and ran the first
reviewer's discriminating command against the same dev stack:

```
npx playwright test --config /tmp/rr2/pw-prefix.config.ts --tsconfig=$PWD/tests/tsconfig.json \
  tests/ui/quests-goals-editor.spec.ts --grep "5 types|pointer drag" --repeat-each=3
rc=1   2 failed, 4 passed
at /tmp/rr2/tests/ui/quests-goals-editor.spec.ts:558
diff: + "4_WizardQuestGoals_00000000", + "5_…", + "6_…", + "7_…", + "8_…"
```

That is the first reviewer's `Received + 6` signature: the drag arm's assertion read the
**predecessor's** 8-goal document. The finding was right.

**(b) The fix closes that path.** The same command on the fixed spec, `--repeat-each=3`: `rc=1`,
2 failed / 4 passed — and both failures are at `copyPanelDocument`
(`tests/ui/quests-goals-editor.spec.ts:232`), i.e. `Received: false` / `Timeout 10000ms`, **never at
the assertion**, and no predecessor document appears. The only writer of the clipboard in that test
is now that test's own click. The three named specs all carry the wipe, and the third
(`quests-info-editor.spec.ts`) also gained the poll it lacked.

**(c) But the acceptance proof the first reviewer attached is not met — and I judge the criterion
itself misconceived.**

```
fixed tree, --grep "pointer drag" (alone):
  run 1 (cold stack)          rc=1   Timeout 10000ms at :232
  runs 2, 3                   rc=0   1 passed (3.6s)
  --repeat-each=4             rc=1   3 passed, 1 failed (same poll)
  --repeat-each=6 (MCP browser closed) rc=1  4 passed, 2 failed (same poll)
pre-fix spec, alone, --repeat-each=4:  rc=1  1 passed, 3 failed (same poll)
```

So the arm is red alone roughly a third of the time **with the wipe in place**, and at least as
often without it. Two independent measurements explain why the wipe could not have changed that:

- **In alone mode the clipboard is already empty**, so the wipe is a no-op there. Measured with a
  standalone chromium (clipboard-read/write granted, secure origin `http://127.0.0.1:5362`):
  *fresh-context clipboard before any interaction: `""`*. The wipe's only possible effect is in the
  multi-test case — which is exactly the case the finding diagnosed, and where the fix does work.
- **It is not latency.** With `expect.timeout` raised to **60 s** on that poll, the arm alone still
  failed **3 of 4** runs (`Timeout 60000ms exceeded`, `Received: false`). A longer budget does not
  make the clipboard produce JSON; the content never arrives. The fix work's recorded residual —
  "load-sensitive clipboard latency, not stale content, and not a write rejection" — is therefore
  **refuted by measurement**, and the first reviewer's "13.7 s is the failing wait" reading is also
  not the whole story.

What I *can* bound: the failure is `Received: false`, i.e. the predicate **returned** false — so
`readText` resolved and the clipboard was empty at every read, rather than the read throwing. I
could not determine whether the panel's `writeText` rejected (sonner's error toast lives 10 s per
D39, so an empty `region "Notifications alt+T"` in the failure snapshot taken at ~10 s is
inconclusive), and my fail-fast attempt to catch it with a 3 s budget ran 4/4 and 10/10 green. That
limit is why this is *partial* rather than either closed or refused.

**(d) The budget revert: right decision, right poll, wrong reason for the one that remains.**
Reverting the **card-order** poll from 30 s to the global 10 s is correct: p5-07's own record
(`docs/evidence/phase-5/p5-07-d3-proof.md:144`) says the failing wait was the *helper's* clipboard
poll, and a 30 s budget on the render poll would let a stalled drag pass. But the fix work then
applied its "no bigger budget" rule to the **clipboard** poll as well, reasoning that a raise "would
let a genuinely stalled drag pass" — and that reasoning does not transfer: the drag is guarded by
the preceding `cardOrder` poll at 10 s, and a *rejected* clipboard write leaves the clipboard empty
forever, so no budget can mask a broken copy. The clipboard poll is the one place a patient waiter
buys something, which is what p5-07 recommended in the first place.

**(e) The third spec's added poll** — the pre-fix helper did `const text = await readText()`
immediately after an async `writeText`, so the poll closes a real race *in code*; but I could not
make the pre-fix shape fail: 42 tests green across 1 + 2 iterations (whole file). Its necessity is
argued from the code, not measured, and I am labelling it that way.

**What must change** (non-blocking follow-up, and it does not require a third review pass because it
does not change what this commit does): make the read depend on a signal the panel emits rather than
on polling for `{`. `client/src/components/quest/QuestJsonPanel.tsx:76-83` calls
`notifySuccess(JSON_COPIED_MESSAGE)` only **after** `await navigator.clipboard.writeText(...)`, so
waiting on that toast (and failing fast if `JSON_COPY_ERROR` appears) converts a 10-second silence
into a named cause; asserting that the copied text contains the edit under test removes the last
content-agnostic predicate, which is the first reviewer's own "strengthening option".

**Why this does not block:** the change removed the only path that could produce *wrong evidence*
(a false pass on a neighbour's document — reproduced before, absent after). What remains is a false
**red** path that exists in the pre-fix shape too, is carried by name in the run's ledger
(D77(d)), and cannot make the gate's claim untrue. My own full-suite run passed all 393 arms
including this one (2.3 s, `quests-goals-editor.spec.ts:519`).

### S2 [MEDIUM] `dagre` was a runtime import in `devDependencies` — **RESOLVED**

- `package.json`: `"dagre": "0.8.5"` now in `dependencies` (pin unchanged, alphabetical position
  next to `@xyflow/react`); `@types/dagre` stays dev.
- **Manifest/lockfile consistency, measured two ways.** `npm ls --omit=dev dagre` →
  `spiraldb-ui@0.1.0 └── dagre@0.8.5` (**rc=0**) — the phantom the finding described is gone. In a
  `/tmp` copy of `package.json` + `package-lock.json`: `npm ci --dry-run --omit=dev` **rc=0** with
  the install plan containing `dagre 0.8.5`, `graphlib 2.1.8`, `lodash 4.18.1` and **no `cors`**;
  and a **real** `npm ci --omit=dev --cache /tmp/rr2/npmcache` **rc=0** whose
  `node_modules/dagre` exists and whose `require.resolve('dagre')` (run from that tree) resolves to
  **its own** `/tmp/rr2/sync2/node_modules/dagre/index.js`.
- **The stated inability to run a clean production build is genuine.** `/tmp/node_modules` really is
  a symlink to this workspace's `node_modules` (verified), and in the prod-only tree `vite`,
  `typescript` and `@vitejs/plugin-react` are **absent** while `dagre` is present — so
  `npm ci --omit=dev && npm run build` is impossible **by the toolchain split**, not by the fix.
  One correction in the fix's favour: with a cache under `/tmp`, the prod-only **install** does
  succeed, which is a stronger result than §4 of the fix record claims (it reports the install half
  as inconclusive for the pre-fix tree). I ran it on the fixed manifest only.
- The client really consumes it at runtime: `client/src/lib/quest-goal-logic.ts:56`
  (`import * as dagre from 'dagre'`), and the emitted chunk
  `client/dist/assets/QuestGoalLogicEditor-DCmGuEjo.js` matches `rankdir`, `graphlib` and `acyclic`
  in my own `npm run build` (rc=0, 2.88 s).

### S3 [MEDIUM] the metadata tie-break preferred the legacy file — **RESOLVED**

**Before, measured in the pre-fix tree** (my probe, two files holding one `Name`):
`metadataPath = …/QuestMetadatas/a_legacy.json`, `legacyRefreshed: true`,
`conventionRefreshed: false` — the reviewer's direction claim, confirmed by my own run.

**After, measured through the real API** (repo with `QuestMetadatas/a_legacy.json` and
`QuestMetadatas/questmetadata_RR2-DUP.json`, both `Name: "RR2-DUP"`; `POST /api/quests`):

```
metadata_outcome = updated
metadata         = QuestMetadatas/questmetadata_RR2-DUP.json
warnings[0]      = QuestMetadatas/ holds 2 files whose "Name" is "RR2-DUP". The save updated
                   QuestMetadatas/questmetadata_RR2-DUP.json (this tool's own convention file,
                   preferred when a save is ambiguous) and left the other untouched —
                   resolve the duplicate metadata by hand.
```

and on disk: the legacy file keeps its exact bytes and `ModifiedBy: makima`; the convention file
gets `ModifiedBy: RR2 Reviewer` with a fresh `ModifiedAt`; the commit body is the header alone; the
tree is clean after. So the warning **names the file that was actually written**, with the rule that
chose it, which is what the finding asked for. The warning and the write come from one function
(`questMetadataSaveTarget`) called with the same index and the same normalised key
(`objectKeyFromData` in the API equals `resolveObjectKey` in the pipeline for this family), so they
cannot disagree within a request.

**Direction is defensible, and I re-measured the corpus it rests on:** 324 `QuestMetadatas/` files /
316 distinct `Name`s / **8 duplicates**, and every duplicate is `<uuid>.json` +
`questmetadata_<name>.json` (all eight listed: `WC-UNICORN-MAIN-001/002/003/004/006/007/008`,
`WC-COMMONS-MAIN-001`). The convention file is the one this tool's create path and the owner's own
builder write; preferring it when the name is ambiguous is the right call and is narrow by
construction.

**Single-file path unchanged:** the resolver returns `index.pathFor(...)` whenever the convention
candidate is not itself a match, which is every measured name except those 8; the repo's own arm
(`leaves the ordinary (single-file) resolution alone`) pins it and is part of my 143-green run of
the four touched unit files.

*LOW note (pre-existing, not this commit):* the warning is computed **before** `pipeline.saveObject`,
so on a save that then fails the line still says "The save updated …". Identical in the pre-fix
code; recorded, not counted against the fix.

### S4 [LOW→MEDIUM] `notes` reached the commit body unsanitised — **RESOLVED**

**My own end-to-end probe** — `POST /api/drop-tables` with
`notes = {"normal\n\nCo-authored-by: evil <evil@example.com>\nSigned-off-by: evil\nspiraldb: create quest FAKE"}`:

```
commit_message = "spiraldb: create drop_table RR2-NOTES-1\n\nnormal Co-authored-by: evil
                  <evil@example.com> Signed-off-by: evil spiraldb: create quest FAKE"
```

and read back out of the repository with `git log -1 --pretty=%B | cat -A`:

```
spiraldb: create drop_table RR2-NOTES-1$
$
normal Co-authored-by: evil <evil@example.com> Signed-off-by: evil spiraldb: create quest FAKE$
$
```

`grep -nE '^(Co-authored-by|Signed-off-by|spiraldb):'` matches **only line 1** — the real,
server-built header. No caller text can start a line, so no trailer block and no fake
`spiraldb:` line can form.

*Before,* measured in the pre-fix tree: the same note produced a **6-line** body with a real
`Co-authored-by: evil <…>` line — the defect existed and the new arm would have failed on the old
code. **One home:** `server/src/services/git.ts:379` is the only `buildCommitMessage` call site, and
`spiraldb:` appears elsewhere only in comments — so both write paths reach the sanitiser.

### The notes N1–N5 — check the dispositions

| note | disposition I judge | my evidence |
|---|---|---|
| **N1** zone `/`→`_` create collision | **recorded — adequate** | `shared/naming.ts`'s new paragraph is accurate: I re-measured the fork → 1207 `ZoneTransfer` files, **1205 distinct `ZoneName`s, 0 collisions between distinct keys**. Nothing overwrites; the residue is one uncreatable name shape. |
| **N2** 500 bodies may name absolute paths | **claim narrowed — adequate** | the arm is renamed ("…in the 400s it probes") and the comment states every probe is malformed and that a 5xx may name a path. Fixing the claim rather than the code is the right direction; I read the code (`errorHandler` returns `err.message`, no stack) and the arm passes in my green unit run. |
| **N3** `express.json()` 100 KB default | **recorded — adequate**, one figure restated | I re-measured the largest quest: **119,335 bytes pretty** (matches) and **71,597 minified** (the record says ~73 KB, restating the first reviewer's 72,599) → headroom ≈ **30.9 KB**, not ~27 KB. Immaterial to the disposition; noted as NF5. |
| **N4** symlinked `spiraldb_path` refused with a misleading message | **fixed — verified both ways** | *before* (pre-fix probe): `assertClean()` on a symlink to a working-tree root rejects with *"…is not the root of a git working tree — check settings.spiraldb_path"*. *after*: I set `spiraldb_path` to a symlink of the rig repo and the next `POST /api/quests` → **200**, `outcome: created`, commit made. The rule it exists for is preserved (a subdirectory's `realpath` still differs, and that arm is unchanged and green). |
| **N5** (first reviewer) rig hygiene: a wrapper makes two processes; kill the PID from `ss`, not `$!` | **no code change needed — but the fix record's "N5" is a different item** | I hit the reviewer's N5 myself: `$!` was **4192649** while the listener was **4192651**, and only the `ss` PID freed the port. The fix record's §7 "N5" is in fact the *unnumbered* symlink gap from the reviewer's §3.2 — which it did fix (*before*: my probe wrote **through** the link, target bytes replaced, `threw:false`; *after*: refuses, repo arm green; and 0 symlinks exist in any corpus family dir, so nothing legitimate breaks). Both items are fine in substance; only the label maps to the wrong row. Flagged as NF5 because a reader cross-checking the two artifacts will be misled. |

---

## 2. THE TWO CLAIMS THAT NEEDED AN OUTSIDE JUDGE

### 2.1 Are the "carried flake families" unrelated to this change?

**Tested as far as one host allows: I have no evidence they are related, and the one flake I could
reproduce on a surface this commit touches is not caused by it.**

- My full official run: `npm run test:ui` → **rc=0, 393 passed (2.0 m)**. Neither carried family
  fired (no `a11y-keyboard` filechooser timeout, no extraction toast/pointer overlap), so I cannot
  contradict the fix's record from this run either.
- The one flake I *can* reproduce is the drag arm's clipboard poll — and it fires **more often in the
  pre-fix spec shape than in the fixed one** in my windows (pre-fix alone 3/4 failed; fixed alone 3
  of 8 failed). A flake that is at least as bad before the change is not caused by the change. The
  fix work's claim stands for this family; its *explanation* of the residual does not (§1 S1).
- The change touches no file that the two carried families exercise (`a11y-keyboard.spec.ts`'s file
  chooser, `extraction.spec.ts`'s Save All button), and the commit's 21 files contain no client
  runtime source at all — `client/src` is untouched, so no product surface can have changed. That
  is the structural half of the argument, and it is sound.

### 2.2 Two self-claims, verified by measurement

| claim the fix work makes about itself | verdict | my measurement |
|---|---|---|
| *"the CORS removal is behaviour-neutral for the same-origin client"* | **holds** | dev through the Vite proxy → 200 on `/api/health` and all four app calls; production served by the same process → 200 on all four; full tier-1 suite 393/393 green on the same tree; `client/src/lib/api.ts` uses only relative paths. Nothing needed a CORS header, and nothing broke without one. |
| *"the two-file metadata case is now tested"* | **holds, and the test discriminates** | the two arms exist (`tests/unit/save-pipeline.test.ts`'s `updates the tool convention file…` + `leaves the ordinary (single-file) resolution alone`; `tests/unit/quests-api.test.ts`'s API warning arm) and pass in my 143-green run; and against the pre-fix implementation my own probe shows the *old* answer (`a_legacy.json` refreshed, convention untouched), i.e. the new arms could not pass on the old code. |
| *"loopback literal, so clients that ask for the name still reach it"* | **holds** | Vite binds `[::1]`, the proxy targets `localhost:3001` (`::1`-first here), the API answers only on `127.0.0.1` — and the proxied call returns 200, with `[::1]:3001` refused and `127.0.0.1:3001` 200 pinning the fallback. |

---

## 3. NEW FINDINGS FROM THE CHANGED CODE (and from running it)

**NF1 — [MEDIUM, confidence HIGH] the official tier-1 run rewrites a tracked evidence file, so a
gate run cannot end with a clean tree.**
`tests/ui/a11y-reduced-motion.spec.ts:339` and `:341` write screenshots into
`docs/evidence/phase-5/`, which is **tracked**. Measured: `git status --porcelain` was empty before
my `npm run test:ui`, and afterwards showed
` M docs/evidence/phase-5/p5-05-reduced-motion-flowchart-after.png`. (I restored the exact bytes from
HEAD with `git show HEAD:<path> > <path>`; `git status` is empty again.) This is pre-existing — the
commit does not touch that spec — but it directly qualifies the first reviewer's §5 sentence that
"the artifacts this review left behind are all gitignored and were checked": this one is not, and
D83(a) (a falsification break committed by `git add -A`) shows the cost of a gate run leaving a
modified tracked file behind. **Fix:** redirect those two `page.screenshot` paths to a test-results
directory, or add the generated names to `.gitignore` and keep the curated images under a different
name.

**NF2 — [LOW, confidence MEDIUM] the new "written" ledger can under-report after a write-side
failure.** `server/src/services/savePipeline.ts` appends to `written` **after**
`writeSpiraldbJson(...)` returns, so a failure *inside* that call after truncation (e.g. `ENOSPC`)
leaves `written.length === 0` and the `catch` rethrows the bare `SpiraldbFileError` — no dirty-tree
warning, although the tracked file may now be truncated and uncommitted. The class the finding is
about survives in that narrow path. **Fix:** push the path before the attempt (or track "attempted"
separately from "completed"). I could not stage a mid-write failure without privileges, so this is
code-derived; labelled MEDIUM confidence for that reason.

**NF3 — [LOW, confidence HIGH] `sanitizeCommitNotes` can split a surrogate pair.**
`server/src/services/git.ts` `MAX_COMMIT_NOTES_LENGTH = 255` with `cleaned.slice(0, 255)` slices by
UTF-16 code unit, so a note of 254 characters followed by an emoji leaves a lone surrogate in the
commit body. Cosmetic, one-line fix: slice on code points, or drop a trailing lone surrogate.

**NF4 — [LOW, confidence HIGH] the record's residual diagnosis for S1 is wrong, which matters
because it is the disposition that will be cited later.** `final-review-fix-d1.md` §3 and §8 call
the drag arm's residual "load-sensitive clipboard latency … not a write rejection". My 60 s-budget
run (3 of 4 failed, `Received: false`) refutes the latency reading: no budget produces the content.
This is a record-accuracy finding, not a code finding — but a future reader would use it to justify
a budget raise that cannot work.

**NF5 — [LOW, confidence HIGH] two record-accuracy slips.** (a) The fix record's §7 "N5" maps to the
reviewer's §3.2 symlink observation, not the reviewer's N5 (process hygiene), and the reviewer's N5
is consequently not named anywhere in the record; (b) the N3 minified figure (~73 KB) is the first
reviewer's number restated rather than re-measured — I measure 71,597 bytes (headroom ≈31 KB, not
~27 KB). Neither changes a disposition.

**NF6 — [LOW, confidence MEDIUM, pre-existing] the metadata duplicate warning is emitted before the
save**, so a save that then fails still leaves "The save updated X" in the response's `warnings[]`
and the server log (`server/src/services/quests.ts`, the `duplicates > 0` branch). Unchanged by this
commit; noted because S3 touched exactly that line.

**Local residue, not a finding:** `npm ls cors` in this workspace still reports
`cors@2.8.6 extraneous` — the working `node_modules` was never pruned after the lockfile edit. Source
and manifest are clean and `npm ci` would not install it; stated so a reader who runs the same
command is not misled.

---

## 4. WHERE THE FIRST REVIEWER WAS RIGHT — AND WHERE IT WAS WRONG

**Right, and I verified it independently:** M1's exposure and its minimum fix (my own bind, header
and browser probes); M2's premise and its "honest minimum" (my own failing-hook rig, plus the
pre-fix baseline probe); S1's stale-clipboard defect (my own reproduction of `Received + 6` on the
pre-fix spec, 2 of 3 runs); S2's dependency misplacement; S3's tie-break direction and the untested
two-file case (my own pre-fix baseline shows the legacy file winning); S4's trailer injection (my
own pre-fix baseline shows a 6-line body with a real `Co-authored-by:` line). It also falsified two
of its own hypotheses and said where it did not sample, which is what made this second pass cheap.

**Wrong, plainly — two things, both in S1, and both matter for the disposition:**

1. **The alone-mode failure was not the helper's stale-content bug.** The first reviewer's
   measurement #2 ("the arm alone → `Timeout 10000ms` … i.e. with no predecessor the clipboard never
   yields JSON") is a real observation, but it cannot be evidence for *stale content*: with no
   predecessor the clipboard is empty, and I measured that a fresh context's clipboard is `""`
   before any interaction. The same is true after the wipe, which is why **the remedy the reviewer
   demanded cannot satisfy the proof the reviewer demanded**. The stale-content defect is real and
   the wipe fixes it — but the reviewer bundled a second, unexplained failure into the same finding
   and then made its absence a condition of closure.
2. **The reviewer's §5 claim that its run left no tracked artefact is wrong** (NF1): the official
   tier-1 suite rewrites `docs/evidence/phase-5/p5-05-reduced-motion-flowchart-after.png`, which is
   tracked. Any full-suite gate run — theirs, the fix work's, or mine — modifies it.

The first reviewer's blocking set was M1, S1, S2, and it explicitly declined to block M2, S3 and S4.
On my measurements M1 and S2 are fully closed and S1's *substance* is closed; the part of S1 that
remains is the part the reviewer's criterion got wrong.

---

## 5. THE GATES, AS I RAN THEM (each rc on its own command)

```
npm test                                  rc=0   67 files, 1472 tests passed
npm run typecheck:tests                   rc=0
npx tsc -p server/tsconfig.json --noEmit  rc=0
npx tsc -p client/tsconfig.json --noEmit  rc=0
npm run lint                              rc=0   "All matched files use Prettier code style!"
npm run build                             rc=0   built in 2.88s
npm run test:ui                           rc=0   393 passed (2.0m)   [drag arm: 2.3s]
```

These match the fix work's own seven-check table item for item (67 files / 1472 tests; 393 UI tests;
four typechecks/lints green; a green build) — including the numbers, which is the cheapest possible
check that the record was not written from a different tree.

---

## 6. VERDICT

### APPROVE — the blocking set is closed; one finding is partially resolved with a non-blocking follow-up

- **M1 [HIGH → closed]:** loopback bind measured (`127.0.0.1:5361`, LAN refused rc=7), zero
  `Access-Control-*` headers on every foreign-origin probe, a real browser at another origin blocked
  by CORS policy with `user_name` unchanged, both same-origin paths green, no residue assuming the
  wildcard, and removing rather than narrowing is the better judgement (a 5173-only allow-list would
  be narrower than the harness's own `VITE_PORT` origin).
- **M2, S3, S4:** resolved at the level each finding demanded, each verified against a measured
  pre-fix baseline that I built myself.
- **S2:** resolved, and I went further than the fix record could — a real prod-only `npm ci` succeeds
  and resolves dagre from its own tree.
- **S1 [partially resolved]:** the defect is fixed (reproduced before, absent after), but the
  arm still fails alone at the clipboard read in roughly a third of runs, is not latency-bound
  (60 s → still `Received: false`), and the reviewer's closure criterion was misconceived. This does
  **not** block approval because the remaining failure is a false **red**, present in the pre-fix
  shape too, carried by name in the run's ledger, and incapable of making the gate's evidence
  wrong — the change removed the only false-**pass** path, which is what the finding was about.
- **N1–N5:** all four actionable notes dispositioned correctly (N1/N2/N3 recorded or claim-narrowed,
  N4/N5-class symlink items fixed and verified in both directions); the record's N5 *label* points at
  the wrong row and is flagged as NF5.

**What I would want fixed next, in order, none of it blocking this gate:**
1. NF1 — stop the tier-1 run writing into a tracked `docs/evidence/` path (it makes every gate run
   end dirty, and D83(a) already bit this run once).
2. S1's follow-up — wait on the panel's own success toast (`QuestJsonPanel.tsx:76-83`) before reading
   the clipboard, and assert the copied text contains the edit under test. Do **not** raise the
   card-order poll; the clipboard poll is the one with a real waiter problem.
3. NF2/NF3 — the `written`-ledger ordering and the surrogate split; both one-line.

**I would not refuse on S1.** Refusing would mean the reviewer's literal criterion outranks its
purpose: the purpose was "the arm becomes falsifiable in isolation", and it now is — a no-op drag
yields the wrong order in the copied document, and no neighbouring test can satisfy that read any
more. What is left is an honest flake, not a wrong claim.

---

## 7. HONEST LIMITS

- **M1's LAN half is same-host.** `curl` from this host to its own LAN address (rc=7) plus the
  literal bind is strong but not a second machine.
- **I did not force a database failure** at the status upsert; that claim (M2) is code-verified.
- **The clipboard failure's mechanism is unattributed.** I established that the read returns (not
  throws) and that the clipboard holds no JSON for 10 s and for 60 s, with and without the wipe,
  with and without a second browser, under light and heavy load; I did not establish whether the
  panel's `writeText` rejected. My fail-fast attempts to catch the toast (3 s budget) ran green
  4/4 and 10/10.
- **NF2 is code-derived**, not reproduced (a mid-write `ENOSPC` needs privileges I do not have).
- **My corpus figures are read-only re-measurements** on the owner's fork at the state it is today
  (328 quest templates, 324 metadata files, 1207 zone files); I wrote nothing there and ran no git
  command in it.
- **The pre-fix baselines ran in a `/tmp` `git archive` of `1bbbda3`** with this workspace's
  `node_modules` symlinked in — the same technique the fix work used, and stated so the reader can
  discount it.
- **One tracked file was rewritten by my own full-suite run** (NF1) and restored byte-for-byte from
  HEAD; nothing else in the repo changed, and `git status --porcelain` is empty as I finish.
- **Rig hygiene:** every server I started (ports 5361, 5362, 5364, 5365, 5366, 3001, 5192) was
  killed by explicit PID — taken from `ss`/`/proc`, never from `$!`, because `$!` pointed at a
  wrapper whose child held the socket (the first reviewer's N5, hit again: `$!`=4192649,
  listener=4192651) — and all of those ports are confirmed free. The owner's `[::1]:5173` and
  `127.0.0.1:3080` were never touched, and the owner's SpiralDB fork was read-only throughout. The
  official tier-1 config's own ports (5181/3001) were used for every Playwright run, and both are
  free now.