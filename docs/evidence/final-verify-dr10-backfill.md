# DR-10 — D82(a)'s idempotent corpus backfill: implemented, falsified, and measured

**Story:** the owed task `DR-10` in `docs/evidence/architect-verification.md` (§"Withhold, and what
must happen first" item 2, and §7's Gaps). **Base:** `main` @ `0d901f0` ("DR-15: the security fix now
has a regression test that bites"). **Not committed** (D84(a)): the working tree carries the change and
this evidence; `HEAD` is unchanged. Raw transcripts ride beside this file:
`final-verify-dr10-falsification.txt`, `final-verify-dr10-rig.txt`, `final-verify-dr10-boot.txt`,
`final-verify-dr10-gates.txt`.

**The judgement this file defends, in one sentence.** `server/src/services/import.ts` no longer returns
early when `entry_status` has rows: a normal startup **reconciles** — it adopts an `extracted` row plus
one provenance `status_history` row for every corpus key that has no row, and it has **no statement that
can modify a row that already exists**, so a human's `reviewed` status, note, timestamps and history
survive it untouched; a second run adopts nothing and writes no byte.

---

## 1. The gap, as measured before the change (the verifier's DR-10, re-measured)

| fact | value | how |
|---|---|---|
| live DB | `data/spiraldb-ui.db`, sha256 `acf5b40e92784ac8d82f8a24b0b0be550d18aa0f1e3da42e75e234e6669a26eb`, 38,277,120 B, mtime `2026-09-28 00:57:55 -0400` | `sha256sum`, `stat` |
| `entry_status` | **2,277** rows: quest 327 `extracted` + **1 `reviewed`**, drop_table 317, npc_inventory 215, npc_spell_inventory 77, creature_spellbook 134, treasure_card_inventory 1, zone_transfer 1,205, npc_drop_table **0** | read through a `/tmp` **copy**, never the live file |
| `status_history` | **1** row — id 1, entry 6, `extracted→reviewed`, notes "final-verify P1-4: PATCH round trip", `changed_by` "final-verify" | same copy |
| corpus | 2,279 `.json` files: QuestTemplates 328, DropTables 317, NpcInventory 215, NpcSpellInventory 77, CreatureSpellbook 134, TreasureCardInventory 1, ZoneTransfer 1,207, **NpcDropTable absent** | `find -maxdepth 1 -name '*.json'` |
| the DB's mtime is **after** the corpus grew | so the 328th quest is visible because the database was **regenerated**, not because the code heals a growing corpus | verifier's DR-10, reproduced here |
| the code | `HEAD:server/src/services/import.ts:264` `shouldRun = COUNT(*) === 0`, `:268` `if (!shouldRun) return …` — a corpus file that arrives later is never adopted | `git show HEAD:…` |

Consequence (D83(b)'s narrowed wording, unchanged): the six (now zero) missing keys were invisible to the
**search palette** — which is built on `entry_status` — and a PATCH on one of them returned 404. The
quests list scans `QuestTemplates/` and was never affected.

**A correction to the brief's premise, recorded rather than quietly worked around.** The brief said to
write the history row "consistent with how the first-startup import writes history today (read that code
path and match it rather than inventing a shape)". Read: the first-startup import writes **no** history
row, and the committed test pinned that (`"writes no status_history rows (an import is not a transition)"`).
The repository has exactly two history writers — `applyStatusChange` (`status.ts:322`) and
`savePipeline`'s create path (`savePipeline.ts:340`) — and they write the same five-column shape with
`old_status = NULL` on creation. There is therefore no *import* shape to match, so this change matches the
repo's **creation-row shape** and its **provenance-note family** (`captureSourceNote` →
`Imported from packet capture <file>`), and D82(a) is what requires the row at all.

---

## 2. The design and every choice in it

**One path, two modes** (`runCorpusImport`, renamed from `runFirstStartupImport` — the old name would now
be a lie, since it runs at every startup):

- **table empty → first adoption**: unchanged from the spec (docs/spec-data-model.md L257–262): every
  corpus key adopted as `status='extracted'` in one transaction, one `extracted_at`, **no** history row.
- **table non-empty → reconcile**: one `SELECT object_type, object_key FROM entry_status`, the same scan,
  and an insert **only** for keys that have no row (the guard is `server/src/services/import.ts:403`).

**ADDITIVE ONLY, structurally rather than carefully.** The file's complete SQL surface is:

| line | statement |
|---|---|
| `:348` | `SELECT object_type, object_key FROM entry_status` |
| `:430` | `INSERT OR IGNORE INTO entry_status (object_type, object_key, status, extracted_at)` |
| `:434` | `INSERT INTO status_history (entry_status_id, old_status, new_status, notes, changed_by, changed_at)` — for the row this call just inserted |
| (no line) | there is no fourth statement |

No `UPDATE`, no `DELETE`, no `INSERT OR REPLACE`, no `DROP`/`ALTER` anywhere in the file — proven by the
comment-stripped grep in `final-verify-dr10-rig.txt`, **with a negative control**: the same instrument on
`server/src/services/status.ts` finds its three `UPDATE entry_status` statements, so the clean result is
not an instrument that cannot see an UPDATE (D90(c)). A tracked key is filtered out *before* the insert is
attempted, so the `INSERT OR IGNORE` no-op path is not even reached for a row that exists.

**The history row** (D82(a) — "insert an `extracted` row **and its history**"):

```
old_status = NULL, new_status = 'extracted',
notes      = 'Imported from SpiralDB corpus QuestTemplates/<file>.json',
changed_by = 'corpus import',                  -- CORPUS_IMPORT_ACTOR, a literal
changed_at = the same timestamp as the row's extracted_at
```

- `changed_by` is a **literal, not `settings.user_name`**: nobody asked for this write at the moment it
  happens, and the live database's `user_name` is `""` anyway, so attributing an automatic adoption to the
  configured human would be a false audit trail (D69(b)'s invisible-second-writer failure, applied to the
  history table). The two user-driven paths still pass the resolved user.
- The note names the **specific file**, because "saying where it came from" is the requirement and
  `captureSourceNote` sets that precedent by naming the capture file. The path is composed with `/` so a
  note written on one platform reads the same on another.
- **Only the reconcile writes it.** The first adoption writes none: the spec defines that import without a
  history row, the committed test pins it, and a fresh install would otherwise open its activity feed with
  2,277 synthetic rows. A file that arrives later *is* a change to a dataset that already existed, which is
  why it gets the provenance row. **The lead can flip this in one line** (drop the `if (!firstAdoption)`
  at `:451`) if uniformity is preferred to the spec's letter.

**`ran` and the toast (no wire change).** `GET /api/status/_import` still answers
`{ran, imported, imported_at}`. `ran` is true for a first adoption (even of an empty corpus, as before) and
for a reconcile that adopted ≥1 row — so the client's once-only announcement (D37,
`shouldAnnounceImport` = `ran && imported > 0 && !announced`) now fires with the true sentence
"Imported 1 existing entries from SpiralDB" for exactly the case the UI could not previously see. When
nothing is missing: `ran:false, imported:0, imported_at:null` and **zero INSERT statements executed**.

**Where it is triggered, and why not a command.** `server/src/index.ts`'s boot path (the same call site as
before), because a growing corpus is the owner's normal workflow (D82(a)): a separate command or a UI
button would have to be *remembered*, and the failure mode it fixes is precisely that the tool cannot see
what it does not track. `SPIRALDB_UI_SKIP_IMPORT=1` still disables everything.

**Rejected: a "last scanned" marker (a `settings` key or a migration) to make the complete case free.** It
would make the steady state ~0 ms instead of ~0.18 s — and it would reintroduce the failure class this run
keeps finding (D82(b)): a cached staleness that says "already done" when the world moved (database copied,
corpus restored from a backup with older mtimes, clock skew), silently disabling the backfill with no
signal. The measured cost is bought deliberately in exchange for "the answer is always derived from the
corpus you actually have". No new dependency, no schema change, no migration, no new settings key.

**Absent or empty family = zero work, never an error.** `scanType`'s existing `catch` sets
`directoryMissing` and returns `[]`; `NpcDropTable/` is genuinely absent in the owner's fork and stays
green (asserted in `tests/unit/import.test.ts`, and measured on the real corpus: `directoryMissing:true`,
`imported:0`, no throw).

---

## 3. Falsification (`final-verify-dr10-falsification.txt`)

Three runs of the **same test file**, only the source varying, with the working file's md5 re-checked
after each restore (the previous task's standard: `case=baseline rc=0`, `case=broken rc=1`,
md5-verified restores):

| case | source of `server/src/services/import.ts` | result |
|---|---|---|
| `baseline` | the new file, md5 `7040d3d257eec58808b24273e13516aa` | `41 passed`, **rc=0** |
| `broken-1` (primary) | the new file **plus the pre-D82(a) early return re-introduced verbatim in effect** inside it (`if (!firstAdoption) return {ran:false, imported:0, skipped:0, failed:0}` before the scan) | **10 failed / 31 passed, rc=1** |
| `broken-2` (secondary, weaker) | HEAD's file restored byte-for-byte, md5 `22eded19728de0a92b6f0dcad05dff6f` | 30 failures, `TypeError: runCorpusImport is not a function`, **rc=1** |

`broken-1` is the case that matters, and it is not an import error: the tests compile against the same API
and fail on **assertions about the behaviour under test**. The ten:

```
× idempotency > adopts nothing and re-writes nothing on the second run (row-by-row, not by count)
× idempotency > adopts the corpus keys alongside rows the scan does not know about
× the idempotent backfill (D82(a)) > adopts a file that arrives later, with the provenance history row the tool writes
× the idempotent backfill (D82(a)) > leaves a reviewed row — status, note, timestamps, attribution and history — untouched
× the idempotent backfill (D82(a)) > changes nothing at all on a second backfill (whole-row comparison, twice)
× the idempotent backfill (D82(a)) > adopts a whole family that appears later, and keeps a missing one as zero work
× the idempotent backfill (D82(a)) > is not an error when the corpus root does not exist and the table has rows
× the idempotent backfill (D82(a)) > rolls the adoption AND its history row back together when a later insert fails
× the idempotent backfill (D82(a)) > counts a key that races in between the read and the insert as skipped, not twice
× the idempotent backfill (D82(a)) > records the adoption for the status endpoint the palette reads
   → e.g. "expected false to be true" (the adopted row is not there), "expected +0 to be 1"
     (the history row is not there), "expected {ran:false, imported:0} to deeply equal {ran:true, imported:1}"
```

`broken-2` is reported as the weak form it is: it shows the pre-change code cannot satisfy the new API at
all, not that the pre-change *behaviour* fails an assertion. Both restores were verified by md5.

**The tests themselves** (`tests/unit/import.test.ts`, +14 cases, repo conventions: `:memory:` databases,
a `data/__test-scratch__/` fixture tree, the owner's fork never read):

1. a file added after the first adoption gets a row (`status='extracted'`, `extracted_at` = the backfill's
   timestamp) **and** its five-column provenance history row, and the counts move by exactly one;
2. a quest marked `reviewed` **with a note** through the real `applyStatusChange` keeps its whole row
   (status/`extracted_at`/`reviewed_at`/`reviewed_by`/nulls) and its whole history row byte-for-byte;
3. a second backfill changes nothing — compared **row-by-row** through a full-row snapshot of both tables,
   with a **negative control** that mutates one row and proves the snapshot instrument sees it (D90(c)),
   plus a positive partner counting the file reads the reconcile really made;
4. a whole family arriving later (directory + file) is adopted; the absent `NpcDropTable/` family is
   flagged `directoryMissing` and is zero work; a non-existent corpus root with a populated table is a
   no-op, not an error;
5. rollback: a failing insert late in the batch rolls back the adopted rows **and** their history rows;
6. the UNIQUE-race path: a key adopted by another writer between the read and the insert is counted
   `skipped`/`duplicates`, its row and history are left alone, and no second history row is written;
7. the wire contract: `importStatusBody` reports `{ran:true, imported:1, imported_at:<the backfill>}`.

---

## 4. The scratch rig — a scratch corpus, a scratch database (`final-verify-dr10-rig.txt`)

`/tmp/dr10/rig/corpus` (rebuilt from scratch on every run, so "the backfill worked" cannot be confused
with "the file was already there") + `/tmp/dr10/rig/rig.db`. Import → mark one row `reviewed` **with a
note** → add a file → run again → run a third time. **12/12 checks PASS**; the load-bearing lines:

```
run 1 (empty table): imported 4, status_history 0
human review       : RIG-A extracted→reviewed, notes "rig: human review note", changed_by jason
corpus grows       : QuestTemplates/q-c.json added
run 2 (backfill)   : ran=true imported=1 importedAt=2026-09-28T11:00:00.000Z
new key            : {status: extracted, extracted_at: T2}
new history        : {old_status: null, new_status: extracted,
                      notes: "Imported from SpiralDB corpus QuestTemplates/q-c.json",
                      changed_by: "corpus import", changed_at: T2}
reviewed row       : byte-identical (status reviewed, reviewed_at 10:30, reviewed_by jason)
reviewed history   : byte-identical (notes "rig: human review note", changed_by jason)
counts             : 4→5 entry_status (+1), 1→2 status_history (+1)
run 3              : ran=false imported=0, whole-row digest IDENTICAL, DB file sha256 IDENTICAL
absent family      : byType.npc_drop_table {directoryMissing: true, imported: 0} — no throw
```

### Steady-state cost, measured rather than asserted

| steady state | cost |
|---|---|
| old code (20 × `SELECT COUNT(*)`) | min 0.00 / median 0.00 / max 0.13 ms, **no filesystem access** |
| new code (6 consecutive reconciles, live copy + real corpus) | min **100.49** / median **177.00** / max **290.43** ms per startup, **0 rows adopted, no writes** |

So the price of always deriving the answer from the corpus is ~0.1–0.3 s at startup on a loaded machine
(the raw scan alone measured 76–133 ms across three passes when the box was quieter), paid whether or not
anything is missing. That is the honest answer to "what is the added cost when the table is already
complete"; §2 records why a cache was refused instead of hidden here.

### The real corpus, against a **copy** of the live database

`/tmp/dr10/live-copy-backfill.db` (a byte copy of the live file) + the owner's 2,279-file corpus, twice:

```
result run 1: ran=false imported=0 skipped=3 failed=0 importedAt=null   144.6 ms
result run 2: ran=false imported=0 skipped=3 failed=0 importedAt=null    85.2 ms
skipped=3    : the QuestTemplates/droptables/ subdirectory + 2 real duplicate ZoneName pairs
               (WizardCity/Tutorial_Exterior, WizardCity/Tutorial_Interior) — the same 3 the first-ever
               import reported, which is an independent cross-check of the scan
digest before: a92f7c4c92d3c89cb0807867ee2bc2feb0263a2c27f9dee5d56496d2da92c48f
digest after : a92f7c4c92d3c89cb0807867ee2bc2feb0263a2c27f9dee5d56496d2da92c48f   (identical)
rig-marker rows in entry_status / status_history: 0 / 0
copy sha256  : acf5b40e… BEFORE and AFTER — the copy did not change one byte
LIVE sha256  : acf5b40e… BEFORE and AFTER — the live database was never opened (mtime 00:57:55 unchanged)
```

This is the strongest single fact in the file: **2,277 real rows and 2,279 real files, 0 adopted, 0 bytes
changed, digest identical** — the additive claim at full scale, on the owner's own data, without touching
the owner's database.

### The boot rig — a normal startup heals the gap (`final-verify-dr10-boot.txt`)

Three real boots on three ports this rig owns (5471/5472/5473 — verified free before, 0 listeners after;
the owner's `:5173` listener is visible in every residue check and was never touched). Identity is asserted
from the boot log **before** any probe; each server is killed as a **process group** found from the
listening PID.

```
BOOT 1 : database ready at /tmp/dr10/boot/boot.db ; "Imported 3 existing entries from SpiralDB"
         GET /api/status/_import → {ran:true, imported:3}
         GET /api/status/quests  → BOOT-A, BOOT-B (2 entries)
… the corpus grows: QuestTemplates/c.json appears …
BOOT 2 : "Imported 1 existing entries from SpiralDB"          ← the normal startup heals the gap
         GET /api/status/quests        → BOOT-C is now IN THE LIST
         GET /api/status/quests/BOOT-C/history
              → [{old_status:null, new_status:extracted,
                  notes:"Imported from SpiralDB corpus QuestTemplates/c.json",
                  changed_by:"corpus import"}]
         PATCH /api/status/quests/BOOT-C {"status":"reviewed"} → HTTP 200   ← the arm that used to 404
              history → 2 rows (the adoption, then the human's transition)
         PATCH /api/status/quests/BOOT-ZZZ → HTTP 404 "Unknown quests entry"  ← control: the probe means something
BOOT 3 : "corpus already tracked (entry_status covers every corpus key)"
         GET /api/status/_import → {ran:false, imported:0, imported_at:null}
         db sha256 BEFORE = AFTER (no byte written) ; 0 "Imported" lines in the log
residue: listeners on 5471/5472/5473 = 0/0/0 ; rig processes left = 0
live db sha256 after the whole rig = acf5b40e… (unchanged)
```

**Disclosure, because the first version of this rig got it wrong:** v1 killed the launching subshell's
PID, which left **3 listeners and 6 processes** alive — the residue check caught it, the processes were
killed by explicit PID and the ports verified free, and v2 kills the process group derived from the
listening PID. The failing v1 residue output is in `final-verify-dr10-boot.txt`'s history only as this
sentence; v2's transcript shows `TOTAL rig residue: 0`.

---

## 5. Gates (`final-verify-dr10-gates.txt`)

Each rc captured **on its own command**, no pipeline tails, run sequence-wise (the suites are
load-sensitive, D77(a)):

| check | result |
|---|---|
| `npm test` | **68 files / 1,486 tests passed, rc=0** |
| `npm run lint` | rc=0 |
| `npm run typecheck:tests` | rc=0 |
| `npx tsc -p server/tsconfig.json --noEmit` | rc=0 |
| `npx tsc -p client/tsconfig.json --noEmit` | rc=0 |
| `npm run build` | rc=0 |

`rc` is the binding fact and is quoted from the transcript's own `--- <check> rc=` lines; per-check wall
times vary by run (this box is load-sensitive on the hour) and are therefore left in
`final-verify-dr10-gates.txt` rather than hard-coded here. The transcript is a run on the **final** tree
(`server/src/services/import.ts` md5 `7040d3d257eec58808b24273e13516aa`): an earlier gate pass was
discarded after a comment-only edit to `tests/unit/quests-api.test.ts`, and all six checks were re-run on
the frozen tree.

After the suite (D90(b) — the mutating fixture is checked *after*, not before): `data/test-spiraldb`
porcelain **0** lines, HEAD `18dc924`, branch `content/2026-09-27`, 322 quest `.json` files, 0 diff lines
vs its base — the clone self-restored. The live database's sha256 and mtime are unchanged after every gate
and every rig. `git status --porcelain` lists exactly the five intended modified files (below) and `HEAD`
is still `0d901f0` — **nothing was committed**.

---

## 6. Files changed

| file | change |
|---|---|
| `server/src/services/import.ts` | `runFirstStartupImport` → `runCorpusImport`; the early return replaced by the reconcile; `readTrackedKeys`; `ScannedCorpusEntry` (key + corpus-relative file); `CORPUS_IMPORT_ACTOR`/`corpusImportNote`; the history insert; field docs for `ran`/`importedAt`/`skipped` |
| `server/src/index.ts` | the call site + boot lines: same import sentence for an adoption, a distinct line for "already tracked", and an unparsable-file warning even when nothing was adopted |
| `tests/unit/import.test.ts` | the idempotency suite re-specified ("adopts nothing and re-writes nothing", row-by-row with a negative control) + the 9-case `the idempotent backfill (D82(a))` suite |
| `tests/unit/quests-api.test.ts` | the renamed symbol; one comment corrected (the list/status divergence is now within-one-process, healed at the next startup) |
| `docs/spec-data-model.md` | L262's "This runs once only; subsequent startups skip if table has rows" annotated with the D82(a) reconcile (the original sentence kept, the amendment appended in the house style) |

---

## 7. Honest limits — what this does not prove

- **No test imports `server/src/index.ts`** (DR-15's own finding), so the *trigger* is proven by the boot
  rig's three real boots, not by an automated test. The unit suite pins the service contract; a
  regression that removed the `runCorpusImport` call from the entrypoint would keep every suite green.
- **The steady-state cost is a startup cost paid forever** (~0.10–0.29 s, median 0.18 s, measured under
  peak-hour load on this host with the 38 MB live database copied to `/tmp`). It is not hidden: §2 states
  the cache that would remove it and the failure class that cache would reintroduce.
- **A key that changes inside an existing file** is adopted as a *new* key; the old key's row stays
  (additive-only). Nothing here deletes or renames a row, by design — a deleted corpus file's row also
  stays, and that is a deliberate non-goal, not an oversight.
- **Mid-scan arrivals.** A file written after its directory has been read in this pass is missed by that
  pass. The next startup adopts it; there is no watcher.
- **The reconcile is not concurrency-proof against another *process* writing the same key**: it reads the
  tracked keys and inserts under `INSERT OR IGNORE`, so a race is counted (`skipped` + `duplicates`) and
  the other writer's row — and history — is left alone. That path is unit-tested; it is not exercised with
  two real servers.
- **The unit-test fixture is not the owner's corpus.** The real-data facts in §4 come from the
  `/tmp` copy run and the boot rig, not from `npm test`.
- **`importSummaryMessage`/toast behaviour was not re-verified in a browser.** The wire contract it reads
  (`{ran, imported, imported_at}`) is asserted; the known F2 debt (a full page load re-announces a
  per-process report — `docs/evidence/final-deslop-d1-disposition.md` item 16) is unchanged by this story.
  A backfill makes that toast fire for a *narrower*, more accurate event, not a new one.
- **No docs `D91` was added.** The design decisions live in §2 and in the D82(a) annotation; numbering a
  new durable decision is the lead's call.
- **Only the six named gates ran.** `npm run test:ui` was deliberately not run (it is not in the brief's
  gate list, it is load-heavy, and a full run rewrites 15 committed phase-4 PNGs per D83(d)).

## 8. How to falsify this document

- Re-run the two falsification cases from `final-verify-dr10-falsification.txt` and check the rc values.
- Run the rigs again: `npx tsx /tmp/dr10/rig.ts`, `/tmp/dr10/live-reconcile.ts`, `/tmp/dr10/cost.ts`,
  `/tmp/dr10/boot-rig2.sh` (v1's residue bug is recorded in §4; v2 is the script that produced the
  transcript) — the scratch rig prints 12/12 checks.
- `grep -nE '\b(UPDATE|DELETE|INSERT OR REPLACE)\b' server/src/services/import.ts` after stripping
  comments, with `status.ts` as the control (§2).
- sha256 the live database before and after anything here and compare with `acf5b40e…`.
