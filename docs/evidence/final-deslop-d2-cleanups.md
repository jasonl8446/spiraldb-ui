# final-deslop D2 — the cleanups

Story: **final-deslop / Ultragoal final gate 1/3**, AC1. Tree: `main` @ `1bac35c` + this story's
working-tree edits. **Nothing is committed** (the lead commits — D84(a)); no git write was made.
D1's disposition table is `docs/evidence/final-deslop-d1-disposition.md`.

**Diff shape: 23 modified files + 2 new files, `+122 / −119`.** Net +3 lines: 18 deletions of
unreachable code, and the three additions that replace the two duplications and the module flag.
No `data/`, no `docs/` prose, no `client/src/components/ui/`, no `package-lock.json`, **no new
dependency** (`package.json` is untouched), and no behaviour any AC depends on.

---

## 1. F1 — the location-dependent CLI build (the one mandated code fix)

**Pattern:** boundary — a build that only works in one checkout. **Lead's ruling:** make the
Imview root an overridable MSBuild property defaulting to today's path.

**Before** — both CLI projects hardcoded the owner's sibling layout:

```xml
<!-- tools/PacketReaderCli/PacketReaderCli.csproj  (and tools/FixtureGen/FixtureGen.csproj) -->
<ProjectReference Include="../../../Imview/src/Imview.PacketReader/Imview.PacketReader.csproj" />
```

**After** — the reference goes through a property, and the default has one home:

```xml
<!-- tools/PacketReaderCli/PacketReaderCli.csproj (FixtureGen likewise) -->
<ProjectReference Include="$(ImviewRoot)/src/Imview.PacketReader/Imview.PacketReader.csproj" />
```

```xml
<!-- new: tools/Directory.Build.props -->
<PropertyGroup>
  <ImviewRoot Condition="'$(ImviewRoot)' == ''">$(MSBuildThisFileDirectory)../../Imview</ImviewRoot>
</PropertyGroup>
```

Three deliberate choices:

- **`tools/Directory.Build.props`, not the repo root.** My first attempt put it at the repo root;
  `npm run lint` (`prettier --check .`) then failed with *"No parser could be inferred for file
  Directory.Build.props"*, and the honest fix was not to add an ignore rule for a file I had just
  invented. `tools/` is already prettier-ignored, both consumers live there, and MSBuild resolves
  `Directory.Build.props` by walking **up** from each project — so the file is found, and no
  MSBuild props file is imposed on the rest of the repository.
- **`$(MSBuildThisFileDirectory)` is `tools/`, so `../../Imview` is the sibling checkout** — the
  default path is byte-for-byte today's target, which is why the owner's layout keeps working
  (proven, §3a).
- **One home for the default** (D51/D76): both csproj files read the same property, so the
  sibling path is written once. `ImviewRoot` can also be supplied as an environment variable,
  because MSBuild imports environment variables as properties and the `Condition` only fills an
  empty value.

**Risk / behaviour:** the owner's layout is unchanged by default; nothing under `Imview/` is
written (the reference is a *reader* of that tree, exactly as before — the D18 isolation story is
untouched).

## 2. F2 — the module-level flag becomes query-layer state

**Pattern:** slop — module-scope mutable standing in for state the query layer owns.

**Before** (`client/src/components/layout/AppLayout.tsx`):

```ts
let importToastShown = false;                       // module scope, per-document
…
useEffect(() => {
  const report = importReport.data;
  if (importToastShown || report === undefined || !report.ran || report.imported <= 0) return;
  importToastShown = true;                          // never re-announces anything, ever
  notifySuccess(importSummaryMessage(report.imported));
}, [importReport.data]);
```

**After** — the decision is a pure predicate beside the report it is about
(`client/src/lib/api.ts`), and the mark rides on the **cached report**:

```ts
// client/src/lib/api.ts
export interface ImportReport {
  ran: boolean; imported: number; imported_at: string | null;
  /** Client-side only — the server never sends this. */
  announced?: boolean;
}
export function shouldAnnounceImport(report: ImportReport | undefined): boolean {
  return report !== undefined && report.ran && report.imported > 0 && report.announced !== true;
}
```

```ts
// AppLayout.tsx — the `let` is gone; useQueryClient() supplies the owner
const report = importReport.data;
if (report === undefined || !shouldAnnounceImport(report)) return;
queryClient.setQueryData<ImportReport>(IMPORT_REPORT_QUERY_KEY, { ...report, announced: true });
notifySuccess(importSummaryMessage(report.imported));
```

**What this buys, stated honestly:**

- The module-level mutable is **gone**. "Has this report been announced?" is now state in the
  query cache, keyed to the report itself.
- A **second import in the same process is no longer swallowed.** The old `let` was permanent, so
  a later import's toast could never fire; a new payload carries no mark, so it announces again.
- StrictMode's double-mount and any remount read the mark back and do not re-announce.

**What it does NOT fix (recorded as debt, D1 item 16):** the toast still re-announces on a full
**page load**. A module flag was per-document and so is the query cache — fixing that needs a
*durable* fact, and this app has **no client-side persistence at all** (`grep
localStorage\|sessionStorage client/src` → 0 hits; identity/settings live server-side, D38).
Choosing where that fact lives is a design decision, so the story fixes the shape and says so
rather than inventing a persistence mechanism inside a deslop pass.

**Behaviour lock:** `tests/unit/ui-shell.test.ts` gained one test (5 arms) pinning
`shouldAnnounceImport` — the announce arm, the already-announced arm, `ran:false`/`imported:0`, and
the **new-report** arm the old flag could not satisfy.

**No AC evidence changes:** `IMPORT_REPORT_QUERY_KEY`'s only consumer is `AppLayout` (`grep`
confirms), and `tests/ui/shell.spec.ts` deliberately leaves `GET /api/status/_import` un-mocked but
asserts only that it answers **200** (`shell.spec.ts:904-914`) — never the toast. Checked before
editing.

## 3. Duplication — two helpers get one home each

### 3a. `joinKinds` (client)

**Before:** the same 7 lines, body *and* doc comment, in two files —
`client/src/lib/drop-table-validation.ts:63-69` and `client/src/lib/quest-validation.ts:117-123`:

```ts
/** `A, B and C` — an English list of the distinct kinds, in finding order. */
function joinKinds(kinds: readonly string[]): string { … }
```

**After:** one exported home in `client/src/lib/validation-message.ts`, which **both** files
already import and whose own header already declares itself *"the structural validation-message
contract shared by every host's findings — `lib/quest-validation.ts` maps quest findings to them,
and `lib/drop-table-validation.ts` maps DropTable findings to them"*. Both files now call it.

**Reason:** a formatting rule used by two banner models is exactly the "one shared unit" shape;
the home already existed and was already documented for these two callers. No new file.

### 3b. `relativeTo` (server)

**Before:** the same 4 lines, body *and* doc comment, in `server/src/services/objects.ts:136-140`
and `server/src/services/quests.ts:163-167`.

**After:** one exported home in `server/src/services/spiraldbFiles.ts`, next to
`createTargetPath` — which is already *"the path a new entry is written to"*, i.e. the same
root-relative-path concern. Both consumers already import that module, so this is a zero-new-file
consolidation with no import-graph change.

**Deliberately NOT folded in:** `server/src/services/objects.ts:783`'s inline
`(candidate) => path.relative(root, candidate)`. It is a *different rule* — no
`=== '' ? file : relative` fallback — so merging it would change behaviour.

## 4. Dead code — 15 exported symbols deleted (18 edits)

**Pattern:** dead code + needless abstraction (speculative indirection, an exported surface with
no consumer). Method: repo-wide reference count over **code** files only (`.ts/.tsx/.mjs/.cs`,
excluding `docs/`, `.omd/`, JSON fixtures and generated `.artifacts`) — every symbol below has
reference count **1**, i.e. its own declaration, and its name appears in no other code file.

Deleted (each with the shape that made it dead):

| symbol | file | why it was dead |
|---|---|---|
| `useFieldValidation` | `client/src/components/shared/FieldValidation.tsx` | hooks for a hypothetical host; its siblings `useFieldMessages`/`useFieldMessagesUnder` have 25/4 refs |
| `objectTypeConfigForUrlPath` + `BY_URL_PATH` | `shared/objectTypes.ts` | an unused URL→config lookup and the map only it read (`BY_FILE_TYPE`/`objectTypeConfigForFileType` stay — they are used) |
| `severityLabel` (+ its now-unused `ValidationSeverity` import) | `shared/quest/validation-messages.ts` | unused formatter |
| `resetDbForTests` | `server/src/db.ts` | a "test escape hatch" no test uses (`closeDb` has 3 code files) |
| `SEARCH_QUERY_KEY` | `client/src/lib/api.ts` | a query-key prefix superseded by `searchQueryKey` (the used one) |
| `isEntryTypeKey` | `client/src/lib/quest-dialog.ts` | unused predicate (`ENTRY_TYPE_KEY` itself has 8 refs, stays) |
| `dialogEntryRequirementsPath` | `client/src/lib/quest-dialog.ts` | unused path builder (`REQUIREMENTS_KEY` has 3 code files, stays) |
| `goalLogicEntryHasKey` | `client/src/lib/quest-goal-logic.ts` | unused predicate |
| `UNREADABLE_RESULT_TEXT` | `client/src/lib/quest-results.ts` | copy string whose text `'Unrecognised result value'` appears **nowhere** in the repo, tests included |
| `SPELL_NAMES_TYPE` (+ import cleanup) | `shared/simpleObjects/npcSpellInventory.ts` | "re-exported so a form names it once" — no form reads it; every caller passes the `'spells'` literal |
| `SAVEABLE_COLLECTIONS` | `server/src/services/spiraldbFiles.ts` | derived contract constant; the save pipeline filters inline (`saveable` has 4 code files, the field stays) |
| `MagicSchool` | `shared/quest/typeConstants.ts` | type alias for the measured enum; `MAGIC_SCHOOLS` (which carries the measurement and is used by `requirement-tree.ts`/`requirements.ts`/tests) stays |
| `ULongInput` | `shared/ulong.ts` | type alias not used in any signature, its own file included |
| `ActorDialogBlock` | `shared/quest/dialog.ts` | type alias; `ActorDialogBlockSchema` stays |
| `assemblyQualifiedType` + `TYPE_CACHE_PREFIX` + `TYPE_ASSEMBLY_SUFFIX` | `shared/quest/typeConstants.ts` | one unused `$type`-grammar group — the function was the two constants' only consumer, so they went together rather than leaving two newly-dead constants behind |

**Risk statement.** Deleting an exported symbol is the one place this pass could damage something
the corpus, a spec or an AC depends on — so each of the 15 was checked three ways: (i) reference
count 1 over code files; (ii) the **value**-bearing ones grepped repo-wide — `'Unrecognised result
value'` has **zero** occurrences, `'spells'` is used as a literal everywhere independently, and the
kept `'droptables'` skip constant is untouched; (iii) the four typecheck gates plus the full unit
and tier-1 suites (§D3) prove no compile or runtime dependence. Nothing under `data/`, no vendored
primitive, and no test fixture was touched.

## 5. `quests-goals-editor.spec.ts` — a load-sensitive budget raised (D77(a))

**Before** (`tests/ui/quests-goals-editor.spec.ts`, the pointer-drag test starting at line 511):

```ts
await expect.poll(() => cardOrder(page)).toStrictEqual([ … ]);
```

governed by the global `expect: { timeout: 10_000 }` — while the real 20-step dnd-kit pointer drag
is measured at **13.7 s** at peak load (the carried family: *"a 10 s poll for a 13.7 s operation"*).

**After:**

```ts
await expect.poll(() => cardOrder(page), { timeout: 30_000 }).toStrictEqual([ … ]);
```

**Reason and bounds:** this is patience, not a weaker claim — the assertion is **unchanged**. The
budget is raised **on that poll only**, not on the global `expect.timeout`, because a global raise
would hide real failures across all 33 specs. The measurement and the reasoning sit inline above
the line. This was explicitly authorised by the story (D77(a)'s shape); the other three carried
intermittent families were *not* patched and are reported as carried in D3.

**Proof:** in isolation on the settled tree this test passed in **1.1 s** — the budget matters at
peak load, not here, which is why the fix is justified by the recorded measurement rather than by
a failure reproduced this round.

## 6. What was deliberately NOT changed

- **Vendored primitives** — `client/src/components/ui/` (9 files, D39). Not read for findings, not
  edited, not counted as slop.
- **`StatusBadge`'s `aria-label`** — D1 item 10: kept, because flipping it means editing ≥9
  locators across 7 specs to satisfy an axe **incomplete** whose name is inert.
- **The 266-symbol unconsumed `export` surface** in `client/src` — D1 item 13: counted and named,
  not churned; deleting `export` keywords repo-wide is a rewrite of module surfaces, not a bounded
  cleanup.
- **`shared/document.ts`'s `quoted`/`describeValue`/`describeError`/`isJsonFile`/`shortTypeName`** —
  D1 items 11, 17, 18, 19: real duplication, but each one-home fix needs a new module (or a
  misplaced home), so each is named debt instead of forced.
- **The run's recorded corpus ledgers** — `KNOWN_DIALOG_TAGS`, `GOAL_LOGIC_ENTRY_KEYS`,
  `IMPORT_SKIPPED_SUBDIRECTORY`: unused, and kept *explicitly* as the run's measurements (D78).
  D1 item 20 records the choice rather than hiding it.
- **Any AC's evidence** — nothing this story changed alters what an AC measured; where a change
  could have (F2's toast), the affected spec was read first and the limit stated (§2).