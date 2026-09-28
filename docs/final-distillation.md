# Final distillation — the SpiralDB UI unattended run (D29)

One session, 120 rounds of budget, an unattended loop. **63/63 PRD stories pass; 41 carry
`architectVerified: true`; 22 are withheld with named actions.** Five phase branches were cut from
`main`, each merged through a GitHub PR only after the required `ci` check went green.

## What exists now

A web tool (React + Vite client, Express + SQLite server) that extracts quests from packet captures
through a .NET CLI wrapper, edits all nine SpiralDB object types, tracks verification status, and
writes JSON into a sibling SpiralDB checkout with an auto-commit per save. Roughly a year of
hand-written project would be these 1,486 unit tests and 393 UI specs.

## The gate structure, and what it actually caught

| Gate | What it produced |
|---|---|
| Phase gates 1–4 | Boundary re-runs; **gate-3 caught a CI-only crash** (a guard doing eager work at collection time); **gate-4 caught a second CI-only defect** (a spec reading the corpus that CI does not have) |
| Phase 5 PR | `ci` green in **5m14s** on the first run, merged as `1bac35c6` |
| final-deslop | Swept 311 authored files; filed a disposition list; proved its own gate with a negative control on the PNG churn |
| final-review | A fresh-context reviewer **refused to approve** and found a **HIGH** defect: the API bound every interface and answered any origin while writing files and auto-committing into git. It **reproduced the exploit**. A second fresh-context pass approved the fix — after correcting the first reviewer twice |
| final-verify | Re-ran **all 33 phase Verification Steps** fresh; found a **real FAIL** (a 375px overflow hidden by a mock narrower than reality) and fixed it red→green on the same assertion |
| omd-agent-verifier | Audited the **63-story evidence corpus** — the gap the sweep named — and returned **PASS WITH CONDITIONS**, falsifying the AC's own assumption that every story would be signed |

## The findings that mattered most

1. **The API answered any origin while writing files and committing to git** — reachable from any
   page the owner visited, or any LAN host. Fixed by binding loopback and *removing* CORS (a narrow
   allow-list would have been narrower than the harness's own origin). A later audit found the fix
   had **no regression test**; it now has one that fails when the wildcard is re-added.
2. **A mock must be as demanding as reality.** The responsive suite passed a 375px assertion because
   its fixture used an 18-character key where the corpus has a 93-character path — same route, same
   assertion, **false pass**. D90(a).
3. **A mutating fixture must be checked after the suite, not before.** `npm test` itself writes and
   self-restores the frozen clone, so "the clone is untouched" can be true after a run and false
   during one. D90(b).
4. **An instrument's insensitivity must be proven by a negative control.** The tracked-evidence fix
   was verified by mtime and hash because a scratch spec proved `git status` and `git diff` were
   **blind** to exactly that defect while reporting clean. D90(c).
5. **The summaries drifted, not the bodies.** Three stories reported stronger outcomes than their own
   raw files — a "7× rc=0" against a cited `rc=1`, an "overall rc=0" against two failures, a PRD
   evidence field omitting the seventh check's `rc=1`. The raw evidence was honest throughout; what
   the ledger trusted was the summary. That is the systemic lesson of the audit.
6. **A growing corpus became untrackable** because the import ran once, on an empty table — six real
   quests invisible to search and every list. Now the import **reconciles** additively and
   idempotently at every startup, proven with a sha256 of the database file itself. D91.

## What is knowingly unfinished

- The **22 withheld stories** need their AC tables read against their gate records; the artifact
  names what each needs. Withheld is not failed — it is *not yet audited*, and saying so is the point.
- **`criterionAmendments` is empty for all 63** while at least five criteria were superseded by
  measurement, so an overturned claim and a standing one currently read identically.
- **Recorded debt with owners**: the import toast re-announces once per document load; `StatusBadge`
  carries a prohibited `aria-label` (inert, axe *incomplete*) that nine specs locate through; five
  byte-identical duplications whose one-home fix needs a new module; a commit-note cap that could
  split a surrogate pair was fixed, others recorded; 266 unconsumed client exports counted, not
  churned.
- **Two of my own claims were corrected by the audits**: the reduced-motion accounting, and D90(a)'s
  numbers — a decision about measurement discipline that contained two unmeasured numbers.

## The method, stated so it transfers

- **Evidence over assertion, always with the raw output.** Every verdict in every gate cites a file,
  a command and a number. No "looks done".
- **Falsify your own instrument.** Four deliberate breaks caught four real weaknesses, including one
  in a checker that reported zero offenders on a deliberately broken file.
- **Read the tree's state before measuring it.** A gate run against a tree a worker is editing is not
  a measurement — it produced six phantom failures and, in the other direction, once committed a
  deliberate falsification break.
- **Independence is not a formality.** The two most valuable results of the run came from reviewers
  with no memory of its reasoning: the HIGH security finding, and an audit that refused to sign off.
- **State the limits.** Every artifact says what it did not read, which instrument it did not trust,
  and which step it could not reproduce. That habit is what made the drift above findable rather than
  invisible.

**Result:** a working tool, 63/63 stories with evidence, 41 independently verified, 22 awaiting a read
of their own acceptance criteria, and a record that names its own gaps instead of rounding them off.
