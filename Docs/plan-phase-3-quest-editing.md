# Phase 3 — Quest Editing

**Status:** pending approval
**Depends on:** Phase 2 (read-only quest detail, save pipeline, quests API)
**Spec reading order before starting:** [spec-domain-reference.md](./spec-domain-reference.md) **in full** (goal/result/requirement/dialog enumerations, validation rules) → [spec-ui-design.md](./spec-ui-design.md) L274–454 (detail page, flowchart, requirement tree, dialog editor)

## Requirements Summary

Turn the read-only quest detail page into a full editor: all 5 goal types, the goal-logic flowchart, the recursive requirement tree, all 14 result types, and the complete NPCDialogEntry editor (50+ fields) — with client + server validation and a proven zero-field-loss guarantee (decision D5). This is the highest-complexity phase; the fidelity harness (task 3.2) gates everything else.

**Authoritative enumeration boundaries** ([spec-domain-reference.md](./spec-domain-reference.md)):
- Goals: exactly 5 types — Waypoint, Persona, Bounty, Scavenge, AchieveRank (L316–334) + 24 shared base fields (L336–338).
- Results: exactly 14 types (L354–412), `$type` format `"Imcodec.ObjectProperty.TypeCache.{TypeName}, Imcodec.ObjectProperty"` (L412).
- Requirements: exactly 4 types — ReqHasQuest, ReqHasEntry, ReqSchoolOfFocus, ReqIsSchool (L416–438). **`ReqHasGoal` and `ReqEntryValue` must NOT be implemented** (L436).
- Dialog: NPCDialogEntry field groups per L444–523.

## Tasks

### 3.1 Domain types + Zod schemas — M
- `shared/quest/*.ts`: TypeScript types + Zod schemas for QuestTemplate (all ~36 top-level fields, [spec-domain-reference.md](./spec-domain-reference.md) L240–279), the 5-goal discriminated union (on `$type`), GoalLogicEntry (L340–351), the 14-result union (L354–412), the 4-requirement union + recursive `RequirementList` wrapper (`m_requirements` array enabling AND/OR trees, L440), ActorDialogList/NPCDialogEntry (L444–523).
- **Corpus-driven constants**: before writing `$type` enums, extract the distinct `$type` values, goal types, and result types actually present: `grep -rho '"\$type": *"[^"]*"' /home/jason/Documents/git-projects/spiraldb/QuestTemplates/ | sort -u` — encode results as the authoritative constant table; schemas must accept every corpus value (unknown-but-present values fail loudly in tests, not silently at runtime).
- Server reuses the same schemas for POST validation (single source of truth).
- Nullable/omitted fields follow `NullValueHandling.Ignore` semantics ([spec-domain-reference.md](./spec-domain-reference.md) L714–717): serializer omits null/undefined; schemas treat missing optional fields as absent, never inject defaults into saved JSON.

### 3.2 Round-trip fidelity harness — M (gates 3.3–3.10)
- Implement the D5 merge-not-replace document model: `loadDoc()` keeps the JSON5-parsed original; form edits are applied as targeted mutations/deep-merges; `serializeDoc()` writes the merged original.
- **Corpus test**: for every file in `QuestTemplates/` (322 today): `JSON5.parse` → `serializeDoc` (unedited) → `JSON.parse` → deep-equal against the first parse. Any failure blocks the phase.
- **Edit-simulation test**: mutate one known field per goal/result/requirement/dialog type on a sample quest; assert (a) the mutated field changed, (b) deep-equal holds for everything else.

### 3.3 Info tab editor — S
- Two-column form per [spec-ui-design.md](./spec-ui-design.md) L296–298: left — `m_questName` (read-only), `m_questTitle` (string-table lookup display via `/api/names/strings`, raw-key fallback per [spec-domain-reference.md](./spec-domain-reference.md) L693–694), `m_questLevel` (number), `m_mainline`/`m_isHidden` (checkbox), `m_questRepeat` (number), `m_activityType` (select); right — `m_onStartQuestScript`/`m_onEndQuestScript` (text), `m_clientTags` (tag input), timestamps read-only.
- Remaining top-level booleans/strings from the field table (`m_noQuestHelper`, `m_prepAlways`, `m_forceInteraction`, `m_skipQHAutoSelect`, `m_outdated`, …) live in a collapsible "Advanced" section — editable, not dropped.

### 3.4 Goals tab editor — L
- Goal cards per [spec-ui-design.md](./spec-ui-design.md) L300–314: drag handle (☰) reordering (use `@dnd-kit/sortable`, approved D25), goal-name mono header, type badge colored per L360–365 (Waypoint blue-500, Persona purple-500, Bounty red-500, Scavenge amber-500, AchieveRank emerald-500), "Start" badge when in `m_startGoals`, summary lines (zone / entry / exit / proximity tag / client tags / display image), Edit + Delete actions.
- Edit = inline expansion or modal with type-specific fields ([spec-domain-reference.md](./spec-domain-reference.md) L316–334): Waypoint (`m_zoneEntry`, `m_zoneTag` zone dropdown, `m_proximityTag`, `m_zoneExit`), Persona (`m_personaName` NPC dropdown, `m_usePatron`, `m_dialogList` → reuses 3.8 dialog editor), Bounty (`m_npcAdjectives`, `m_bountyTotal`, `m_bountyType`, `m_tallyCounter`), Scavenge (`m_itemAdjectives`, `m_itemTotal`, `m_tallyCounter`), AchieveRank (`m_rank`) — plus the shared base fields (L336–338) in a collapsible section.
- "Add Goal" with type-selector dropdown; new goals get a unique default `m_goalName`; correct `$type` written on serialize (3.1 constant table).
- Start-goal management: "Set as Start Goal" toggles membership in `m_startGoals`.

### 3.5 Goal Logic flowchart — L
- React Flow canvas per [spec-ui-design.md](./spec-ui-design.md) L344–385. Nodes = goals (colored left border by type, truncated subtitle, Start badge). Edges from `m_goalLogic`: solid = AND (`m_goalsAND`), dashed = OR (`m_goalsOR`), arrow into a special "✓ Complete" node when `m_completeQuest: true` (L367–372).
- Controls (bottom-left floating toolbar): zoom in/out, fit-to-view, auto-layout (dagre, approved D25), "Add GoalLogicEntry" (L374–380). Right-click node context menu: Edit Goal / Delete / Set as Start Goal (L382).
- **Bidirectional editing**: canvas operations mutate `m_goalLogic` / `m_startGoals` in the form state; entry fields `m_goalsToAdd`, `m_requiredORCount`, `m_completeQuest` editable via an entry inspector panel.
- Validation banner above canvas when the graph has disconnected nodes or cycles: "⚠️ Goal logic has disconnected nodes. All goals must be reachable from start goals." (L384; rule from [spec-domain-reference.md](./spec-domain-reference.md) L532–533).
- **Timebox fallback**: if React Flow bidirectional editing overruns, ship a structured `m_goalLogic` table editor first (same data model, same validation) and keep the flowchart read-only until it lands — record the decision.

### 3.6 RequirementTreeEditor — M (shared component)
- Recursive tree per [spec-ui-design.md](./spec-ui-design.md) L388–416 and [spec-domain-reference.md](./spec-domain-reference.md) L416–440: group nodes (AND=blue / OR=purple left border, operator toggle) and leaf nodes (green border, type selector across the 4 allowed types, dynamic per-type fields, `m_applyNOT` checkbox, `m_operator` ROP_AND/ROP_OR). Add Condition / Add Group / Delete (×) per node; nesting shown by indentation + connecting lines.
- Leaf fields: ReqHasQuest (`m_questName` quest dropdown), ReqHasEntry (`m_questName`, `m_entryName`), ReqSchoolOfFocus (`m_magicSchool` enum Fire/Ice/Storm/Balance/Life/Death/Myth), ReqIsSchool (`m_magicSchoolName`, `m_targetType` enum e.g. RT_Caster).
- Lives in `client/src/components/shared/` — **Phase 4 reuses it inline in DropTable item rows** ([spec-domain-reference.md](./spec-domain-reference.md) L708–709).
- Serializes to/from the polymorphic `$type` + `m_requirements` wrapper format exactly as found in the corpus (3.1 constants).

### 3.7 Results editor — M
- Start Results (`m_startResults`) and End Results (`m_endResults`) sections; result cards; "Add Result" with the 14-type selector ([spec-ui-design.md](./spec-ui-design.md) L320).
- Per-type forms with exactly the fields in [spec-domain-reference.md](./spec-domain-reference.md) L358–410 (ResDropTable `m_tableName` drop-table dropdown + `m_maxRolls`; ResLearnSpell `m_templateID` spell dropdown + optional requirements → reuses 3.6; ResTeleport zone dropdown + loc string + teleport-type enum; ResPlaySound router object; ResWait seconds; ResAddHealth/ResAddMana no fields; etc.).
- Every ID-referencing field uses FriendlyNameDropdown (L412: "All fields with ID references use friendly name dropdowns"); `$type` written from the constant table.

### 3.8 Dialog editor — L
- Per [spec-ui-design.md](./spec-ui-design.md) L420–454: dialog tags (Prep, Completion, …) → list of NPCDialogEntry cards per tag → collapsible accordion sub-sections **Basic / Camera / Sound / Animation / Advanced**, covering all seven field groups from [spec-domain-reference.md](./spec-domain-reference.md) L444–523 (Basic, Camera, Duration & Timing, Walk-Away, Audio, Animation & NPC, UI Controls — map the spec's 5 accordion tabs onto these groups; Basic open by default, rest collapsed, L554).
- Field widgets: `m_dialog` string-key with lookup display, `m_actorTemplateID` NPC dropdown, `m_picture`/`m_soundFile`/`m_musicFile` text (path picker optional), numeric camera/shake/timing fields, checkboxes, `m_requirements` → 3.6 tree, `m_maxTimeSeconds` (-1 = unlimited hint).
- Entry actions: Duplicate, Delete, Add Dialog Entry, Add Dialog Tag (L441–451).
- Unknown/extra fields present in legacy entries are preserved untouched (D5) and shown in a read-only "raw fields" disclosure so nothing is silently hidden.

### 3.9 Validation engine — M
- Quest rules ([spec-domain-reference.md](./spec-domain-reference.md) L528–534): `m_questName` non-empty; `m_startGoals` reference existing goal names; unique `m_goalName` per quest; goal-logic reachability from start goals (no disconnected nodes); final goal-logic entry has `m_completeQuest: true`; all `$type` values valid per the 3.1 constant table.
- General rules (L542–546): TemplateID fields positive integers; zone paths must match synced zones; item/spell/NPC references **warn but do not block** when the ID is unknown in the friendly-names DB.
- Presentation (L547): inline red border + message below field; form-level banner summarizing multiple errors; **Save disabled while blocking errors exist**.
- Server: `POST /api/quests` re-runs the same Zod + rule validation → 400 with per-field error map (client renders it identically).

### 3.10 Edit-mode wiring — S
- Header Edit/Save toggle ([spec-ui-design.md](./spec-ui-design.md) L280–284); view mode = Phase 2 read-only rendering; edit mode swaps in 3.3–3.8 editors per tab.
- Dirty-state guard: navigation/close with unsaved changes → confirm dialog.
- JSON side panel live-updates from current form state on every edit (L324–340); Copy + Wrap controls; mobile full-screen overlay.
- Save → `POST /api/quests` (Phase 2 pipeline: file + metadata `ModifiedAt/ModifiedBy` + commit `spiraldb: update quest {name}`) → toast "Quest {name} saved and committed" (L120). Editing does not change verification status (status only moves via explicit Mark actions).

## Acceptance Criteria

- [ ] `$type` audit: the constant table in `shared/` contains every distinct `$type` string found by the corpus grep; a unit test asserts the grep output ⊆ constants (test re-runs the grep against the real SpiralDB path).
- [ ] Corpus round-trip: **322/322** QuestTemplates pass parse → serialize(unedited) → re-parse deep-equal (`npm test` output shows the count).
- [ ] Edit-simulation tests pass for ≥1 mutation per goal type, per requirement type, and per result type present in the corpus.
- [ ] Real-quest edit isolation: pick a corpus quest containing ≥3 goals and a dialog list; edit one goal field + one dialog field in the UI; save; `git diff` in the SpiralDB repo shows **only** those fields changed (plus trailing-comma/formatting normalization on first rewrite).
- [ ] Goals tab: add each of the 5 goal types → serialized JSON carries the correct `$type` and type-specific fields; reorder via drag → `m_goals` array order changes on save; Start badge toggles `m_startGoals`.
- [ ] Flowchart renders a multi-goal quest (e.g., one with a GoalLogicEntry chain) with solid AND / dashed OR edges and the ✓ Complete node; auto-layout produces a readable DAG; adding a GoalLogicEntry via toolbar appears in saved `m_goalLogic`; disconnecting a goal shows the warning banner.
- [ ] Requirement tree: build `AND(ReqHasQuest{NOT}, OR(ReqSchoolOfFocus, ReqHasEntry))` → saved JSON matches the corpus polymorphic shape (verified by loading the saved file in the tree editor and by diffing against a hand-written expectation); only the 4 allowed types are offered — ReqHasGoal/ReqEntryValue absent from the selector.
- [ ] Results: every one of the 14 types can be added with its exact field set; ID fields render friendly-name dropdowns; saved `$type` strings match the corpus format character-for-character.
- [ ] Dialog: open a corpus quest with `m_dialogList` — all entries render, all 7 field groups reachable via accordions; duplicate + delete entry work; a legacy entry containing a field the editor doesn't model still saves with that field intact (D5 raw-fields disclosure shows it).
- [ ] Validation: `m_startGoals` entry referencing a deleted goal → inline error + banner + Save disabled; direct `curl POST` with the same payload → 400 with field error map; unknown item ID → warning icon, Save still enabled.
- [ ] JSON side panel reflects a form edit without manual refresh; toggle + mobile overlay work.
- [ ] Unsaved-changes guard fires on navigation; discarding restores the loaded document exactly.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Field loss on polymorphic types (highest risk) | Corrupts real game data | D5 merge-not-replace + task 3.2 harness gates the phase; edit-isolation acceptance via git diff |
| `$type` strings drift from corpus reality | Server-side deserialization fails in Imlight | 3.1 corpus grep makes constants evidence-based; subset test re-runs against the live repo |
| React Flow + dagre bidirectional complexity | Schedule overrun | 3.5 timebox fallback (table editor first, flowchart read-only) |
| Dialog 50+ fields × legacy variance | Editor misses fields | Raw-fields disclosure (3.8) surfaces everything unmodeled; round-trip test covers preservation regardless of UI |
| Legacy files with unusual encodings/formatting | Parse failures | JSON5 tolerance (Phase 2) + round-trip harness catches per-file; failures listed, fixed case-by-case |
| Scope creep (per-tab polish) | Phase drags | Acceptance criteria are the contract; polish belongs to Phase 5 |

## Verification Steps

1. `grep -rho '"\$type": *"[^"]*"' /home/jason/Documents/git-projects/spiraldb/QuestTemplates/ | sort | uniq -c | sort -rn` → compare against `shared/quest/typeConstants.ts`.
2. `npm test` → round-trip suite reports `322 passed` (count matches `ls QuestTemplates/*.json | wc -l`).
3. Manual: edit → save → `cd /home/jason/Documents/git-projects/spiraldb && git diff HEAD~1 -- QuestTemplates/{file}` → only intended fields.
4. Manual: load the saved quest back (`GET /api/quests/{name}`) → form state identical to pre-save editing state.
5. Validation negatives via UI and curl (criteria above).
6. Flowchart/requirement/dialog walkthrough on 2–3 diverse real quests (one mainline multi-goal, one dialog-heavy) — driven and evidenced via Playwright MCP (D23): DOM assertions + screenshots into `Docs/evidence/phase-3/`.

**Done when:** all acceptance criteria checked with evidence in the PR; any 3.5 fallback decision recorded in [plan-overview.md](./plan-overview.md).
