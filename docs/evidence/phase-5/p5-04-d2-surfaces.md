# p5-04 D2 — the loading and error surfaces (AC3 + AC1)

Plan task 5.4; `docs/spec-ui-design.md` L523-537; decisions D37 (envelope), D44 (isolated DB),
D64/D65 (the 400 field map), D81 (a spec mocks what it asserts on).

| file | change |
|---|---|
| `client/src/lib/connection.ts` | **new** — the pure connection store (`online`/`suspect`/`offline`) |
| `client/src/hooks/useConnection.ts` | **new** — the health-probe loop + the recovery invalidation |
| `client/src/components/layout/OfflineBanner.tsx` | **new** — the persistent banner (the AC1 surface) |
| `client/src/components/layout/AppLayout.tsx` | +4 — mounts the banner at the top of the content column, one `useConnection()` call |
| `client/src/lib/api.ts` | `ApiError.fields` from the 400 body; every outcome reported to the store (4xx = **success**) |
| `client/src/lib/notify.ts` | +`notifyErrorWithRetry` (the shared error toast **with** the spec's retry action) |
| `client/src/hooks/useApiErrorToast.ts` | **new** — the retry toast, wired into the read surfaces |
| `client/src/lib/validation-message.ts` | +`fieldMapMessages`, `hasFieldMapMessages`, `SERVER_FINDING_KIND`, the summary copy |
| `client/src/components/shared/ValidationSummary.tsx` | **new** — the form-top summary of a multi-error payload |
| `client/src/hooks/useServerValidation.ts` | **new** — keeps the server's field map for one form |
| `client/src/pages/ObjectDetailPage.tsx`, `client/src/pages/QuestDetailPage.tsx` | +summary at the top of the form; +skeleton band |
| `client/src/pages/DashboardPage.tsx`, `client/src/pages/QuestsPage.tsx`, `client/src/components/objects/ObjectListPage.tsx`, `client/src/components/dashboard/ActivityFeed.tsx`, `client/src/pages/SettingsPage.tsx` | +the retry toast; +skeleton bands where the layout did not match |
| `tests/unit/connection.test.ts`, `tests/unit/validation-summary.test.ts`, `tests/unit/api-client.test.ts` | **new/new/+** — 39 tests over the new pure logic |
| `tests/ui/p5-04-error-surfaces.spec.ts` | **new** — 4 tier-1 arms (banner, the 400 negative, the retry, the summary) |

## AC3(a) — skeletons match the content, and nothing blocks the page

**Every loading state in the app was enumerated** (the five the lead measured plus the rest, since
the clause is an audit). Eight exist, and none is a full-page swap:

| surface | loaded shape | skeleton | verdict |
|---|---|---|---|
| `ObjectListPage` (7 families) | `ObjectTable`: header band + 40 px rows (desktop) / `ObjectCardList` (mobile) | 8 × `h-10` | rows matched (`h-10` = 40 px); **header band added** (desktop only) |
| `QuestsPage` | `QuestBrowseTable` / `QuestCardList` | 8 × `h-10` | same — **header band added** |
| `DashboardPage` | `StatCards` grid → `TypeProgressSection` → `ActivityFeed` | 4 × `h-32` + `h-64` | grid matched exactly (`grid-cols-1 md:grid-cols-2 xl:grid-cols-4`); **feed band added** |
| `ActivityFeed` | one `Card` (real chrome) with a timeline | 2 rows inside that Card | matched |
| `StatusHistoryPanel` | one panel with a timeline | 2 rows inside the panel | matched |
| `QuestDetailPage` | `QuestHeader` row + `QuestPreview` at `h-[70vh]` | one `h-[70vh]` block | **header band added** (the page used to jump by a header row) |
| `ObjectDetailPage` | header row + form card(s) + `StatusHistoryPanel` | `h-10` + `h-40` | **history band added** |
| `SettingsPage` | real Cards with `h-9` inputs, a sync card, a history table | 3 × `h-9`, `h-16`, 2 × `h-8`, inside those real Cards | matched |

`GlobalRegistryPage` renders no skeleton for its extra *list* query, deliberately: that query only
feeds the optional "which files merged" disclosure, and the page's own document read goes through
`ObjectDetailPage`'s skeleton.

**Inline spinners, never a full-page one — measured, all 8 of them:**

`FriendlyNameDropdown.tsx:173` (inside the popover list) · `Header.tsx:102` (the Sync button) ·
`SearchPalette.tsx:165` (inside the palette body) · `ObjectIdMultiSelect.tsx:195` (inside the
list) · `StatusNotesDialog.tsx:114` (the submit button) · `ExtractingCard.tsx:44` (inside the
extraction card) · `SettingsPage.tsx:233` and `:277` (the Save and Sync buttons).

Every one is `<Loader2 className="h-4 w-4 animate-spin">` — a 16 px icon inside the affected
control. There is no `animate-spin` outside those eight lines, and no page-level component
returning a spinner in place of content (checked with `grep -rn "animate-spin" client/src`).
No change was needed for this clause; it is asserted rather than assumed.

## AC3(b) — the API-error toast with a retry action

`lib/notify.ts` gains `notifyErrorWithRetry(message, onRetry)` — the **same** sonner path, the
same 10 s error duration and close button as `notifyError`, plus sonner's `action`. There is no
second toast system.

`hooks/useApiErrorToast.ts` is the single consumer, wired into the seven read surfaces that
already render an inline failure state (dashboard, activity feed, quests list, each object list,
each object detail, quest detail, settings + sync history). Its message comes from the existing
`serverMessage` helper, so the server's own sentence is what the user reads.

Two rules make it honest rather than noisy:

1. **The retry re-runs the failed request.** It calls that query's own `refetch` — same key, same
   query function — through a ref that is refreshed every render, so it can neither replay a
   captured response nor re-issue a stale body. Measured in
   `tests/ui/p5-04-error-surfaces.spec.ts`: after the click, `state.dashboardRequests` is strictly
   greater than before it and the page renders the data.
2. **A 4xx never toasts.** `isRetryableApiError` (`lib/api.ts`, unit-tested without React) offers
   a retry for a transport failure or a 5xx only; a 400/404/409 keeps the page's own inline state,
   because retrying would ask the same question and get the same answer. The 404 the detail pages
   render as "entry not found" therefore produces no toast at all.

Mutations keep their existing `notifyError`: a failed PUT/POST is not replayed by a button, the
user re-clicks Save. (The retry toast is about reads, where "try again" is exactly the fix.)

## AC3(c) — the validation summary atop multi-error forms

**The audit found a real gap, and it was on the server side of the wire.** The API answers a
rejected save with `400 { error, fields }` (D64/D65) — a genuine **multi-error payload**. The
client's `ApiError` carried `status` and `message` only, so every field sentence was dropped on
the floor and the user got one generic line with no idea which field was refused. That is exactly
the case the client-side engine **cannot** cover: the DropTable duplicate-name rule needs the
corpus, which only the server has.

What was added, reusing the existing vocabulary rather than inventing one:

- `ApiError.fields` — parsed from the same body read that produces the message (one parse, one
  error path), kept only when it has the documented shape;
- `fieldMapMessages(fields)` — the wire map expressed as the shared `FieldValidationMessage[]`
  (severity `error`, kind `server`, `field` = the server's own rendered key). A key like
  `m_startGoals[0].m_goalName` is carried as one whole segment precisely so
  `formatDocPath(...)` reproduces it byte-identically — an inline control asking for its own path
  finds the message without a second path grammar;
- `ValidationSummary` — `role="alert"`, `aria-label="Validation summary"`, the red alert
  vocabulary of the existing banners, one `field: sentence` line per finding, and a count headline
  (`3 validation errors must be fixed before saving.`). Renders **nothing** when there is nothing
  to say;
- `useServerValidation` — captures the map on a failed save, clears it on success, so a summary
  can never describe a request the user has moved past;
- mounted **above the form body** in `ObjectDetailPage` (all eight families) and
  `QuestDetailPage` (the save pipeline's own field map). The "atop" claim is asserted by geometry
  in the tier-1 spec: the summary's `y` is strictly less than the first field control's `y`.

**Already satisfied and left alone:** the quest editor, the DropTable form and the ZoneTransfer
form each render their own client-validation banner (`QuestValidationBanner`,
`dropTableBannerModel`, the ZoneTransfer error banner) with count + kinds, and every field's
sentence inline — those are the "summary if multiple errors" clause for findings the client itself
produces, and no second copy was added.

## AC1(d) — the offline banner: mechanism, place in the tree, and what is *not* an outage

**Detection: a health probe confirms a failed request.**

- `lib/api.ts` reports every request outcome to `lib/connection.ts`. A **rejected `fetch`** or a
  **5xx** marks the connection `suspect`; a **4xx is reported as a success**, because the server
  answering "no" is the transport working. A request that succeeds clears `suspect`.
- `hooks/useConnection.ts` (mounted **once**, in `AppLayout`, the shell every route renders
  through) reacts to the `suspect` transition by firing `GET /api/health` **immediately** — not on
  a polling tick — and repeats it every 2 s while the API has not answered.
- Only a **failing health probe** declares `offline` (the banner). `/api/health` is the app's one
  endpoint that touches nothing (no DB, no corpus), which is what makes the distinction real: the
  measured closed-database case 500s a page while health keeps answering 200, so the app stays
  `online`. And **one 400 or 404 can never raise the banner** — those are not even `suspect`.
- The first probe success after an outage sets the state back to `online`, hides the banner, and
  calls `queryClient.invalidateQueries()` — every stale page refreshes itself, with no reload and
  no click.

Everything above is asserted in `tests/ui/p5-04-error-surfaces.spec.ts`: the banner appears within
one failed cycle and without a reload (a document counter proves exactly one document load), it
clears when the mocked API returns and the dashboard's failed read is re-fetched
(`dashboardRequests > 1`), and the 400-only arm asserts `healthProbes === 0` — the negative is
measured, not assumed.

### The copy: a deliberate deviation from the spec (recorded)

The spec (L535) gives the banner copy as **"Connection lost. Changes will be saved locally."**
The first sentence is used verbatim. The second is **not used, and must not be**:

> `Connection lost.` — `Loaded data may be out of date, and saving will fail until the server is
> back.`

Reason: this application has **no local persistence**. Nothing is queued, buffered or replayed; a
save attempted while the API is unreachable fails outright (`POST` → the fetch rejects → an error
toast) and the edit is lost. Promising the user their changes are safe when they are not is a UI
claiming more than the system does. The replacement sentence states the two consequences a user
has to know before clicking Save. The tier-1 spec asserts the banner contains the first sentence
and does **not** contain `saved locally`, so the deviation cannot silently regress back to the
spec's wording.

## Commands and results (this deliverable)

| command | result |
|---|---|
| `npx tsc -p client/tsconfig.json --noEmit` | rc 0 |
| `npx tsc -p server/tsconfig.json --noEmit` | rc 0 |
| `npx tsc -p tests/tsconfig.json --noEmit` | rc 0 |
| `npx eslint .` | rc 0, no output |
| `npx prettier --check .` | "All matched files use Prettier code style!" |
| `npx vitest run tests/unit/{connection,validation-summary,api-client}.test.ts` | 39/39 pass |
| `npm run test:ui -- tests/ui/p5-04-error-surfaces.spec.ts` | **4 passed** (10.3 s) |

The full six-check gate plus the whole `test:ui` suite is D3's gate record.