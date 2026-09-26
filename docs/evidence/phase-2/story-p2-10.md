# p2-10 — UI test suite: `tests/ui/extraction.spec.ts` (D23 tier 1, task AC#13)

Branch `phase-2-quest-extraction`, HEAD `8cdc795` at dispatch, left **uncommitted** for the lead. Test-only
story: no client or server source change, no workflow change, no new dependency.

**Changed**: [`tests/ui/extraction.spec.ts`](../../../tests/ui/extraction.spec.ts) (+347/−8; all 20 of
p2-07's granular specs are intact and untouched) plus this evidence.

| AC clause | Result | Evidence |
|---|---|---|
| Committed `tests/ui/extraction.spec.ts` passes headless in CI | **PASS** | `npm run test:ui` = **66 passed** (was 64; the two new specs are `extraction.spec.ts:1138` and `:1234`); the `ci` job already runs `test:ui:install` + `test:ui` on `ubuntu-24.04` and was **not** modified — headless comes from `playwright.config.ts` (gate file) |
| upload a D28-generated capture via the real dropzone input | **PASS** | The spec now reads the committed D28 capture from disk (`server/test/fixtures/captures/WC-UNICORN-MAIN-004.json`, 14 235 B asserted) and feeds the page's real hidden `input[type=file]`; the card shows the real file name and its formatted size, and the save body carries `source` = that file's base name (tier-2 §chain) |
| spinner | **PASS** | The existing indeterminate-spinner spec plus the chain spec's held `role="status"`; tier 2 drove it while the real CLI parsed for ~6 s |
| results list shows N quests | **PASS** | N=1 with the real artifact, N=2 in the second new spec; tier 2 measured the real extraction (`WC-UNICORN-MAIN-007 \| Level 0 \| 4 goals`) |
| Save All + confirm | **PASS** | The confirm dialog's exact copy, and **0 POSTs before confirming** — asserted at tier 1 and re-measured live at tier 2 |
| success toast | **PASS** | The per-quest toast; tier 2: "Quest WC-UNICORN-MAIN-007 saved and committed" |
| browse list grows by N | **PASS** | New: a **stateful** `/api/quests` mock (M rows → M+N after the save) plus the navigation to `/quests`, asserting the growth four ways — row count, pagination label, both tab badges and the grown row's identity. Tier 2 measured the real thing: **321 → 322** rows, "Showing 1-50 of 322", tabs `All 322 / Extracted 322`, and the new row with an amber extracted dot |

## Decisions (full list in D54)

- **N is structurally 1 for any committed artifact**: `fixturegen` takes one `--quest` per invocation, so
  no capture in this repo can yield more than one quest. The AC's "N quests" is therefore mapped by the
  real-artifact spec (N=1) and the general-N path is covered against the mock (N=2) — and the real
  N=1 growth was proven at tier 2.
- The stateful mock appends a row **only on the default 200 save path** (`browseRowFor` mirrors the
  server's `buildQuestRows`), so an `onSave` override (409/500) can never silently add a row.
- **Falsification was run, not assumed**: disabling the list append, or the post-save
  `invalidateQueries(QUESTS_QUERY_KEY)`, makes both new specs fail (`toHaveCount(3)`/`(4)` against the
  un-grown 2 rows). Both mutations were reverted byte-identically (md5 checked).
- The real capture's byte size and the card's "13.9 KB" are pinned to the committed fixture: a regenerated
  capture fails the spec loudly, which is the intended coupling.
- `source` is asserted on the wire at tier 1; the note `Imported from packet capture {source}` is
  server-side (D50(i)) and was re-measured live at tier 2.

## Lead verification

- Canonical gate, ports free ([`gate-p2-10-leadverify.txt`](./gate-p2-10-leadverify.txt)): **30 files /
  770 unit tests**, **66 UI specs**, eslint 0, prettier 0, `typecheck:tests` 0, server+client `tsc` 0,
  `npm run build` green.
- Tier-2 ([`story-p2-10-tier2.txt`](./story-p2-10-tier2.txt), 2 screenshots): the real CLI, the real
  server, a real git commit in the disposable clone, and the real 321 → 322 growth — including the
  supporting artefacts (clean JSON, metadata updated in place per D20, the `entry_status` row and the
  `null → extracted` history row with the capture note).
- **Hygiene**: the owner's fork stayed at `c55ccab` on `main` with an empty status; the clone was reset
  after the pass; the dev stack was stopped (ports free); 0 changes under `Imview`.

## Not claimed / flagged (D54)

- The tier-1 specs mock `/api/extract/quests` (the .NET CLI is unavailable to the hermetic harness by
  design, D40/D44), so "this capture parses to 1 quest" rests on `verify-captures.mjs` + the committed
  README's sha256, neither of which runs in CI. Only the lead's tier-2 pass exercises the real binary —
  which it now has.
- No CI run was directly observed (the workflow is unchanged and no job-level `name:` was added); the
  local `npm run test:ui` is exactly what the `ci` job runs.
- `browseRowFor` mirrors the server's row shaping rather than re-deriving it, so tier 1 cannot catch a
  real server whose post-save row differs — tier 2 checked the real row instead.
