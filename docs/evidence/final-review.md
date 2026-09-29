# final-review — the independent code review (Ultragoal final gate 2/3)

**Reviewer:** an `omd-agent-code-reviewer` subagent in a **fresh context**, hard-routed at the `high` tier,
which reviewed the cumulative diff (`git diff cd33c85..HEAD`, 187 files / +34,326 −776, i.e. the whole of
Phase 6 plus the anti-slop pass), the decision record D96–D124, every `docs/evidence/phase-6/*` artifact,
the deslop disposition/proof docs, the PRD ledger and the run log — and re-derived the load-bearing numbers
itself (`npm test` 89/1816 green, full tier-1 418/418 green, three typechecks green, a fresh-DB migration
probe, a WAD-index re-run, a class-census re-run, a corpus key-order census, pin checks before and after).

## The verdict, recorded raw

> **CHANGES REQUIRED — 1 blocking finding**

## The findings and their resolution

| # | severity | finding | resolution |
|---|---|---|---|
| 1 | **blocking** | **`p6-07` had no committed evidence artifact**, while its ledger row cited "the executor's raw report" — a report not in the repo. `docs/evidence/phase-6/` held p6-01…p6-06 and p6-08…p6-12 and **nothing for p6-07**; the run knew (the round-14 note listed it) and then dropped it from the doc half's enumeration. Violates **D92** ("the raw transcript always wins; a ledger never sets status from a summary") and it was the **only** `p6-*` story resting on prose. The reviewer verified the numbers **reproduce** from the lead's live captures | **resolved** — the captures are committed as [`p6-07.md`](./phase-6/p6-07.md) with each quote pinned by **sha256 + byte size** (22/8 text rows, 27 dialog entries 13 composed / 14 template, `goal_gates` 0, 28 references, the 9/2 override rung, and the pre-D116 wrong-corpus `26/4`), with the round-7 log record as the secondary source and the locking tests named. A pointer was added to `p6-08.md`. The reviewer's probe of the raw JSON was the reason no capture had to be re-taken |
| 2 | should-fix | the documented `exit 6` was **unreachable** — the proof *throws*, so the deslop pass's `exit 6` guard was dead and a count failure still exited 5; and `final-deslop-d2-cleanups.md` claimed the "before" behaviour "printed `verdict FAIL` and exited 0", which does not reproduce | **resolved** — the contract moved to one home (`HarnessErrorCode`, `HARNESS_EXIT_CODES` as a `Record` so a new code without an exit code is a compile error, `harnessExitCode`), the CLI routes through it, the dead guard is gone, and `d2`'s clause is corrected to "exited **5**"; **negative control**: the old ternary → exit 5, `harnessExitCode('count')` → exit 6, every other code unchanged |
| 3 | should-fix | the harness could **write a corpus and commit into a repo it neither verifies nor restores** (`SPIRALDB_PATH`/`--spiraldb` may name anything while the snapshot/restore use `config.clone` only, with no comparison or warning) — D116's rule one level up | **resolved** — `describeWriteRootDivergence` names both paths and the CLI refuses (exit 2) before anything starts, so the restore always targets `config.clone` by construction; **control**: a diverging root refuses and starts nothing, an agreeing root passes the guard |
| 4 | should-fix | the post-boot cleanup **killed whatever pid answered** on the Director's ports, without the ownership check every other stop path has (D114/D122) | **resolved** — `leftoverIsOwned` (Director by pid + `/proc` starttime, or a descendant by ancestry **or** RavenDB's durable `--Embedded.ParentProcessId` marker, which survives the reparenting a dead Director causes); a stranger or an unattributable pid is **reported and the run fails `port-foreign` (rc 3)**. **Controls on real processes**: a real stranger → `false` even with a recycled pid; a real marked child → `true`. **Reachability stated honestly**: the loop itself was not exercised end-to-end (the full chain plus a race is needed), and the window is narrow because the pre-flight refuses a non-free port |
| 5 | should-fix | `restoreClone` ran `checkout -f` + `reset --hard` **before** checking whether the clone was clean — the comparison that would complain expects `(empty)`, i.e. it reports after the dirt is gone | **resolved** — the snapshot and its refusal now run **before** Aurorium starts and before the scaffold writes, so a dirty clone refuses (exit 2) naming the files; **control** against a **scratch** clone: dirty → refused naming `?? QuestTemplates/SOMEONE-ELSES-WORK.json`, cleaned → not refused (`data/test-spiraldb` was never touched) |
| 6 | note | two comments still described CreatureSpellbook's unpaired state as temporary **"until task 6.9 populates `decks`"**, which **D121 falsified** — the pass fixed that class elsewhere and missed these | **resolved** (plus a third instance and a wrong `null` bucket the writer found) — both now state the measured reason: **0 of the clone's 134 distinct `DeckName` values is a `decks` row** |
| 7 | note | `db.ts` said "14 tables, 1 view and 7 indexes" while its own cited test asserts 16/1/8 | **resolved** — 16 tables / 1 view / 8 indexes, with 0004 named |
| 8 | note | the census tool printed a **sum of per-shape class counts** as "142 classes"; there are **141 distinct** | **resolved** — union + "shape-class rows" kept as a second reading, JSON gains `shapeClassRows`, and the writer **rebuilt and re-ran the real census over the 19 GB tree**: `183676 in 141 distinct classes (142 shape-class rows)`; the only class in both shapes is `WizZoneData`. The docs that quote 142 are **annotated** (the historical transcripts are quotes of the tool's old stdout, so a note is the right disposition, not a rewrite) |
| 9 | note | `breadth.ts`'s label ladder used `??` while its comment promised the key is used "rather than an empty string" (`humanizeZonePath` returns `''`) | **resolved** — `||` for that rung only; defensive, no measured row changes |
| 10 | note | D99 listed `quest_catalog_refs`'s key with an extra `required_status` | **resolved** — D99 corrected to the migration's `UNIQUE(quest_name, wad, entry, class, goal_name)`, with `required_status` named as a recorded column |
| 11 | note | the diff's only shell-string exec, in a test helper | **resolved** — `readdirSync`, no subprocess at all |
| 12 | note | an adapted tier-1 arm could no longer distinguish the header's pair lookup from a dropdown regression to a per-id lookup | **resolved (strengthened, not weakened** — the original assertion is kept verbatim) with **two controls**: poisoning the bulk list makes the trigger render the bare key (so no per-id fallback exists), and injecting a per-id fetch at dropdown time makes the added assertion fail (so the instrument is not blind) |

## The security pass (the reviewer's own section, summarised — it is the part of this review that the phase could not write for itself)

- **git automation** — the phase's own surface is `resolveScaffoldBranch` (correct, unit-locked) plus the
  harness; `--branch -D` argv is safe (no shell) and the checked-out branch is never planned for deletion.
  **Findings 4–5** are the harness residuals. It **could not rule out** the pre-existing `settings.git_branch`
  hazard on non-CLI write paths (a save commits to the setting's branch and creates it from `main` if it
  differs from the tree — the D119 guard exists only in the CLI) and recorded it rather than scoring it.
- **file writes** — the target-path guard has **two independent layers** (separator/NUL/`.json` rejection, then
  `dirname(resolved) === <root>/QuestTemplates`); the scaffold CLI refuses an implicit database; the
  catalog-verify CLI only ever **copies** the live DB and opens it read-only (bytes verified unchanged); the
  breadth stage writes only inside `mkdtemp` and removes it in `finally`.
- **subprocess/CLI** — every call site is `execFile`/`spawn` with an **argv array**; no user input reaches a
  shell (the one exception was finding 11, now gone); `wadscan` has a typed ENOENT `skipped` path and a
  timeout; ownership correct at the probe and for Aurorium, and **was** incorrect in the leftover cleanup
  (finding 4, now fixed).
- **network/serving** — no CORS, loopback bind, validated params (`parseMissingOnly` 400s, ids gated on
  `/^\d+$/`), every key a bound SQL parameter or through the content-keyed index, and no
  `innerHTML`/`eval` anywhere in `client/`, `server/` or `shared/`.
- **data safety** — the live DB byte-identical after every command; `data/` gitignored; the clone clean at
  `content/2026-09-27` / 42 / 322; D114–D119 implemented as described.

## What the reviewer re-derived and found sound (kept because it bounds the review's coverage)

The sync transaction's shape (one `DELETE`-then-insert transaction, `zones` reconciled not replaced, the
history count taken from the rebuilt table); the migration runner applied to a fresh DB (16/8/1, `quests` 9
columns, the coverage view reading `count(*)` on its own tables); the WAD index `3,589`/`550,616`/0 errors/
`6,733`; the census `183,676` with `QuestTemplate` **absent**; the corpus key order `320 × 36 / 2 × 18`;
p6-12's boot proof (`2274 … 322` → `2275 … 323`, seven families equal, three readings identical, the clone
restored on all seven rows); p6-07's numbers **from the raw JSON**; the coverage path having **no hard-coded
constant**; the clone-mutating suites asserting all five axes **after** the mutation (D90(b)); the
"panel never writes" arm's two-way negative control; and the two known tier-1 conditions — **it agreed with
both classifications and neither reproduced** (`quests-goals-editor.spec.ts:519` passed 13/13 in isolation
and in the full run; the D69(h)/D77(d) family did not fire), which is independent evidence that the
gate-6 fix (D123) is effective.

**What it could not verify**: the string-table/owner-fork-derived counts (1,447 / 4,830 / 2,602-1,303 /
280-of-288) without a full 19 GB sync; the live Imlight chain end-to-end (it read every raw artifact and
traced every decision, but did not boot it); the D35 manifest repair's on-disk keys (the unpack tree is
deleted in the sync's `finally`); the five tier-2 PNGs; and the two CI runs (it re-ran the equivalent local
suites instead, all green).

**Re-review**: the reviewer required changes rather than asking for a re-review of them, so the criterion's
condition ("re-reviewed if the reviewer asks") was not triggered. Every finding was instead resolved with a
**negative control a writer would have to be dishonest to fake** — real process exit statuses for finding 2,
real `/proc` identities for finding 4, a real dirty scratch clone for finding 5, a real diverging root for
finding 3, and two controls for finding 12 — and the closing `omd-agent-verifier` (final gate 3/3's
successor) re-runs the evidence independently.
