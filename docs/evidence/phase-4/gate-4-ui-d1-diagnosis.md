# gate-4 UI — D1: the eight "failing arms" are a harness artifact, and the claims they gate

Head: `f32623e` on `phase-4-object-editors`. Task: "the tier-1 UI specs still pin old corpus facts",
reported as `npm run test:ui` rc=1 with eight failing quest arms.

**D1's finding: those eight arms pass. All 299 tier-1 arms pass.** The rc=1 in
`gate-4-acceptance.txt` §B is not a test failure — it is every test failing to *launch a browser*,
because the gate script ran Playwright without `PLAYWRIGHT_BROWSERS_PATH`, and the script's `grep`
window turned that 299-line failure list into a believable list of eight corpus-shaped arms.

## 1. The reported list, and what it is

`gate-4-acceptance.txt` §B (13:06:56–13:09:44) shows eight `[chromium] › …` lines and `rc=1`. Its
producer is `/tmp/gate4.sh` (the lead's own gate runner, 13:06), whose `run()` captures each command's
log and then prints:

```bash
grep -E "Tests |Test Files |passed \(|failed|PASS|corpus:|quests:|verified:|field " "$log" | tail -8
```

Those eight lines are therefore **the last eight log lines containing the literal `field ` or
`failed`** — not a failure list. Six of the eight titles contain "field …", one contains "a failed
PATCH", and the eighth ends in "…on that field" (Playwright's failure-list lines carry a trailing
space, so the pattern matches at end of line). Nothing about the corpus is involved in the selection.

## 2. The falsification: the gate's own command, in the gate's own environment

```
$ env -u PLAYWRIGHT_BROWSERS_PATH npx playwright test --config tests/ui/p4-10-altport.config.ts
  ✘ 299 …
  299 failed
rc=1
    Error: browserType.launch: Executable doesn't exist at
      /home/jason/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell
```

Raw log: [`gate-4-ui-d1-noenv.txt`](./gate-4-ui-d1-noenv.txt) (the tail prints `299 failed`).

- `node_modules/playwright-core/browsers.json` requires **chromium 1243**; the vendored
  `tools/.playwright-browsers` has `chromium-1243`, the default `~/.cache/ms-playwright` has
  `chromium-1217` (playwright **1.63.0** in this checkout).
- So without the env var **no test can launch**: 299 failed, 0 passed, and every failure is the same
  launch error.
- Applying the gate script's own `grep … | tail -8` to this run reproduces the acceptance file's
  eight lines **byte-identically** (`diff` empty). The gate record's §B and this artifact are the
  same eight lines.

The same command **with** the env var (the config's documented invocation) passes:

```
$ PLAYWRIGHT_BROWSERS_PATH=$PWD/tools/.playwright-browsers \
    npx playwright test --config tests/ui/p4-10-altport.config.ts
  299 passed (51.4s)
rc=0
```

Four independent passing runs at this head: the four specs alone **48 passed** (20.7 s before the
claim edits; 21.4 s after) and the whole suite **299 passed** before the claim edits, then 298/1 and
**299 passed** after them (§6 attributes the single failure to the recorded extraction toast flake).
`p4-79-gate-ui-altport.txt` had already recorded 299 passed at 12:53 — so the gate's §B is
**not a property of this tree**.

**Do not conclude the gate is meaningless**: §A (`npm test`) and §C–E in the same file are real
runs with real rc values. What is unusable is §B's *rc and its eight lines* — the section needs
re-running with the env var (`gate-4-acceptance-d1b-*.txt`), and the `run()` helper needs the error
text kept, not grepped away.

Note for the lead: `gate-4.md` (§1 table) already states "299 passed" for group B while
`gate-4-acceptance.txt` §B says `rc=1` — the two records disagree; §2 above says the md is right and
the txt's rc is the env-var artifact.

## 3. The eight arms, re-measured against the owner's corpus (328 quests, `f9a1055`)

Instruments (all re-runnable, output quoted): `/tmp/p4-ui-d1-measure.mjs` (JSON5-tolerant walk of the
328 `QuestTemplates/*.json`: strict 307, trailing-comma repair 21, unparsed 0) and
`/tmp/p4-ui-d1-measure2.mjs` (the fork + the tool's own re-synced `data/spiraldb-ui.db`). Command:
`node /tmp/p4-ui-d1-measure.mjs` / `node /tmp/p4-ui-d1-measure2.mjs`.

| # | arm | its claim | measurement at 328 | verdict |
|---|---|---|---|---|
| 1 | `quests-info-editor.spec.ts:81` | "renders every field of spec L296-298 with its kind"; comment: `m_clientTags: null` "as all **322** corpus files do" | **328/328** files carry `m_clientTags: null` (0 absent, 0 other) | arm passes; **comment's count stale → 328** |
| 2 | `quests-info-editor.spec.ts:311` | clearing an existing string key deletes it; clearing an absent one is a no-op (D59(c)) | fixture/contract claim — no corpus number; D59(b)'s partition (10 + 12 + 14 = the measured **36** top-level keys) unmoved by the merge (D80(e): no field is new) | passes; nothing stale |
| 3 | `quests-results-editor.spec.ts:455` | describe: "AC1 — every one of the **14 types**"; header: "offers exactly the 14 **corpus** classes"; "the corpus exercises **7 of the 14** forms exactly once" | corpus **15** classes / **421** nodes: ResDropTable 323, ResAddDynaMod 34, ResLearnSpell 21, ResGiveSpell 10, ResTeleport **8**, ResDrawHand 8, **ResActorDialog 5**, ResPostEvent 3, ResPlaySound **2**, ResAddSpell 2, ResAddHealth 1, ResAddMana 1, ResModifyEntry 1, ResDespawn 1, ResWait 1 → exactly-once forms = **5**, not 7 | arm passes; **three sentences stale → renamed** (below) |
| 4 | `quests-results-editor.spec.ts:526` | an existing corpus node keeps its order / empty reference / unknown keys when a field is edited | shape rule (D57/D58); no corpus count in the arm | passes; nothing stale |
| 5 | `quests-results-editor.spec.ts:675` | a corpus router keeps its own 6-key order when a sub-field is edited | `m_router` sample = the corpus's single node (6 keys) | passes; nothing stale |
| 6 | `quests-status.spec.ts:184` | a blank notes field omits `notes` (and `changed_by`) from the PATCH body | wire-contract claim; its row fixture is `quests-mocks.ts`'s **spec-ui-design L245 example** (322 rows / 45·120·157), *not* a corpus measurement | passes; mock clarified (below) |
| 7 | `quests-status.spec.ts:257` | a failed PATCH rolls the badge back and shows the server message in the dialog | same — contract claim | passes; nothing stale |
| 8 | `quests-validation.spec.ts:238` | duplicate `m_goalName` surfaces inline; comment: "**Fixture-only** — no corpus quest has one" | **328 quests / 796 goals / 0 duplicate `m_goalName`** | passes and still true; **claim now carries its measurement** |

Two further claims in the results spec were re-measured and are **still exactly true**, so they are
left alone (D80(b) renames claims whose meaning moved; it does not churn true ones):

- `ResDrawHand`: 8 nodes, **6 in `spells` / 2 in `npcs` / 0 unresolved** (`data/spiraldb-ui.db`:
  spells 18,173 / npcs 23,033 rows) — the header's "6 of 8 … 2 in npcs" holds.
- `m_questTitle === ""` in **7** files; **315** distinct non-empty title keys (`+ ""` = D59(d)'s 316)
  — D59(d) holds.

## 4. The deliberate 14/15 decision (the task's named question)

**Decision: the arm's subject is the 14 *offered* types; the file states "15 known, 14 offered".**

- The corpus knows **15** result classes (above), of which `ResActorDialog` occurs **5×**, every node
  `{$type, m_dialog}` — measured by `/tmp/p4-ui-d1-actor.mjs`; `m_dialog` is a typed `ActorDialog`
  block (7 keys, `m_dialogEvents: null`, tag `Hyperlink` in 5/5).
- `ResActorDialog` is **corpus-only** on purpose (`client/src/lib/quest-results.ts`: `corpusOnly`,
  `fields: []`): this module owns no control for `m_dialog`, so a create would write `{$type}` alone —
  a shape the corpus has never had. That is D80's spirit and D79's recorded decision; it is what
  `resultTypeSelectOptions()` implements (the filter at `quest-results.ts`).
- The class still **resolves and renders** (title + read-only raw disclosure) — pinned at the unit
  tier: `tests/unit/quest-results.test.ts` "the 15 result classes" and "resolves the corpus-only
  ResActorDialog and discloses its nested dialog read-only", plus the census pin (`ResActorDialog 5`).
- So the tier-1 arm is renamed to the **offered** vocabulary and says *why* the 15th is absent,
  rather than being left as "the 14 corpus classes" (now false) or weakened by dropping the class
  from the table (forbidden). The remaining half of the claim — "known and renderable" — is asserted
  where it already is, in the unit suite; duplicating it here would need a 4.2 KB verbatim corpus
  node as a fixture to re-prove a pure-model property this file cannot reach through the Add
  selector. Stated as a decision, not an omission.

## 5. Files touched (D1) — claims corrected, no assertion weakened

| file | change | why |
|---|---|---|
| `tests/ui/quests-results-editor.spec.ts` | header bullet: "the 14 **corpus** classes" → "the 14 **creatable** classes", + the 15-known paragraph; "the corpus exercises **7** of the 14 forms exactly once" → "**5** of the 14 offered forms" with the 322→328 explanation; `/** The 14 classes … */` and the ARIA-role comment → "offered"; arm `'offers exactly the 14 corpus classes'` → `'offers exactly the 14 creatable classes, and never the corpus-only ResActorDialog'` + `expect(options).not.toContain('ResActorDialog')` + its comment; `AC1 — every one of the 14 types` → `… of the 14 offered types` | three sentences were measurably false at 328; the deep-equality assertion was right all along, and the new explicit line keeps the D79/D80 decision legible where the option list is read |
| `tests/ui/quests-info-editor.spec.ts` | comment "as all **322** corpus files do" → "all **328** … (328 null, 0 absent, 0 other)" | the count moved |
| `tests/ui/quests-validation.spec.ts` | comment "Fixture-only — no corpus quest has one" → the same claim with its measurement (328 quests / 796 goals / 0 duplicates) | claim still true; now falsifiable by the next reader |
| `tests/ui/quests-mocks.ts` | one paragraph: the 322 rows are the **UI-design spec's example**, *not* a corpus measurement (the fork held 328 at `f9a1055`), so a corpus move must never be "fixed" by editing these rows | the two 322s mean different things; this is the trap the brief named |

No assertion's *meaning* was changed, no fixture was hand-edited, and nothing was dropped from
`TYPES`. The two stale claims that measurement *confirmed* (`ResDrawHand` 6+2; `m_questTitle: ""` in
7 files, 315 distinct) were left alone.

Falsification of the edits themselves: the four specs pass **48/48** after them
([`gate-4-ui-uish-d1-d2-arms.txt`](./gate-4-ui-uish-d1-d2-arms.txt)); the added
`not.toContain('ResActorDialog')` is a real assertion over the rendered option list, not a tautology
(it is the negative half of the D80 decision this file's subject can reach).

## 6. D2 — the whole tier-1 suite, and the one failure in a file this task did not touch

`PLAYWRIGHT_BROWSERS_PATH=$PWD/tools/.playwright-browsers npx playwright test --config
tests/ui/p4-10-altport.config.ts`, three runs ([`gate-4-ui-uish-full-d2.txt`](./gate-4-ui-uish-full-d2.txt)):

| run | result |
|---|---|
| before the edits | **299 passed** (51.4 s), rc=0 |
| after the edits | **298 passed / 1 failed**, rc=1 |
| after the edits, re-run | **299 passed** (57.9 s), rc=0 |

The one failure is **`tests/ui/extraction.spec.ts:774` "Save All asks for confirmation with the exact
copy, and only then POSTs — one toast per quest"** — a file this task never touched. Its error is a
60 s timeout, not an assertion: a sonner `<li data-sonner-toast data-type="info">` **"subtree
intercepts pointer events"** over `Save All to SpiralDB`, retried 113+ times. It is the **already
recorded** `extraction.spec.ts` toast family (D69(h); carried by name in D77(d) and in `gate-4.md`
§5, which lists the same arm's line `:774` among `:774/:807/:825/:880`). It **passes in isolation in
7.4 s** (same file, above), and the re-run is clean — so it is carried, not fixed here, and it is not
attributable to a spec this task edited. `status-integration.spec.ts` was green in all three runs
(the previous round's flake fix held).

## 7. D3 — the six checks, every rc

`npm test`, `npm run lint`, `npm run typecheck:tests`, `npx tsc -p server/tsconfig.json --noEmit`,
`npx tsc -p client/tsconfig.json --noEmit`, `npm run build` — **all rc=0**; raw tails in
[`gate-4-ui-d3-checks.txt`](./gate-4-ui-d3-checks.txt). `npx prettier --write` was run on every
touched file first (it reported `unchanged` — the edits were already formatted).

Discrepancy worth the lead's eye, unrelated to this task: `p4-79-d2-remeasured-pins.md` records
`npm test` as "58 passed / 1,314 tests", while every run at `f32623e` (this task's, the gate's own
§A, and `p4-79-gate.txt`) reads **57 files / 1,311 tests**. Three tests and one file are missing from
that md's number, or it was recorded at a different tree.

## 8. Environment honesty

- **The owner's fork moved under the run**: `f9a1055` → **`300a5e0`** ("docs: how to create each
  content type") during this session. `git diff --stat f9a1055..300a5e0 -- QuestTemplates` is
  **empty**, so every corpus number here holds at both commits; the change is 12 docs files. The fork
  was read only (`git status` clean; I wrote nothing there).
- The **D17 clone stays the frozen 322-era fixture** (`data/test-spiraldb/QuestTemplates` = 322
  files, clean) — untouched, and not the instrument for any number above.
- The tool's own `data/spiraldb-ui.db` (328 quest rows) was opened **read-only** for the
  `ResDrawHand`/title measurements; it was not re-synced (nothing was stale: the six quest rows the
  D80(b) re-sync added are already there).
- `tests/ui/p4-10-altport.config.ts` only changes the client port (5181); `[::1]:5173` belongs to the
  sibling `card-gatcha-1` and was never touched or killed (D78(b)). No rig was started.
- The unit suite's numbers are from this tree; the 24-core host was at load ≈9 during D2, which is
  the condition the carried toast flake needs.