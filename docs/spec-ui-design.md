# SpiralDB UI - Visual Design Specification

## Overview

This document defines the visual design, layout, component patterns, and interaction models for SpiralDB UI. It complements the [architecture spec](./spec-architecture.md) which covers system design and data flow.

## Design System

### Technology
- **Component Library**: shadcn/ui (unstyled primitives, customized via Tailwind)
- **Styling**: Tailwind CSS
- **Icons**: Lucide React (shadcn/ui default)
- **Flowchart**: React Flow
- **Toast Notifications**: sonner (shadcn/ui recommended)
- **Forms**: React Hook Form + Zod validation
- **Tables**: TanStack Table

### Theme
- **Mode**: Dark only (no light mode toggle)
- **Base Palette**: Slate/zinc neutrals with blue accents
- **Status Colors**:
  - Extracted: `amber-500` / `#f59e0b`
  - Reviewed: `blue-500` / `#3b82f6`
  - Verified: `emerald-500` / `#10b981`
- **Surfaces**: `zinc-950` background, `zinc-900` cards/panels, `zinc-800` elevated elements
- **Text**: `zinc-50` primary, `zinc-400` secondary, `zinc-500` muted
- **Borders**: `zinc-800` default, `zinc-700` focused
- **Accent**: `blue-600` primary actions, `blue-500` hover

### Typography
- **Font**: Inter (system fallback stack)
- **Scale**: Tailwind defaults (text-xs through text-3xl)
- **Headings**: semibold weight
- **Body**: regular weight, text-sm for dense UI areas
- **Monospace**: JetBrains Mono for JSON preview, IDs, code snippets

### Spacing
- **Sidebar width**: 260px fixed
- **Content padding**: 24px (p-6)
- **Card padding**: 20px (p-5)
- **Section gaps**: 24px (gap-6)
- **Element gaps**: 12px (gap-3) within forms
- **Border radius**: rounded-lg (8px) for cards, rounded-md (6px) for inputs/buttons

### Names: the friendly/technical pair (D105 / P6-16)

**One rule, one home.** Every row, header, picker option and search result that shows a name renders
it through `formatNameRow` (`client/src/lib/display.ts`), which already owns "how a row renders" for
the dropdown, the spell-name hook, the quest dialog/info readers and the zone-transfer shape. Phase 6
extends it; it does **not** add a second formatter. The convention is the one already in the file —
`Name (ID)`, as `npcDisplayName` writes it.

**Friendly + technical are shown paired** wherever a friendly source exists, and **every search
matches either** value (spec-api.md's widened `?q=`). Per family:

| Family | Technical | Friendly source | Pair |
|---|---|---|---|
| QuestTemplate | `m_questName` | `quests.title` (title key) | yes |
| NpcInventory, NpcSpellInventory, NpcDropTable, TreasureCardInventory | `TemplateID` | `npcs.name` | **only when the template is an NPC** |
| ZoneTransfer | `ZoneName` | `zones.display_name` / humanizer | yes |
| CreatureSpellbook | `DeckName` | `decks.name` (task 6.9) | **not yet** — technical value alone until task 6.9 populates `decks` |
| DropTable | `Name` | none — `description` is NULL in 316 of 317 rows; the key *is* the name | **no** |
| GlobalRegistry | dictionary key | none | **no** |

**A family with no friendly source renders the technical value alone and says why** — it never gets a
humaniser, because a humanised key reads as a name that does not exist. **Three families are in that
state today** (p6-06-ac1): DropTable and GlobalRegistry permanently, and **CreatureSpellbook until
task 6.9 populates `decks`** — so a pair assertion for CreatureSpellbook must not be written before
then, and its row must say which of the two states it is in rather than rendering a blank label.

**`npcs` is not a roster.** Its 23,033 rows are client *object templates* with no type classification
(D33): the low ids are engine objects (`Player Object`, `PetObject`, `GenericCinematicActor`,
`AcousticsTemplate`) and the NPC ids hold real names (`Merle Ambrose`, `Zarek Pickmaster`). So the
four TemplateID families pair **only when the template is an NPC**; a row whose template is an engine
object renders the technical value alone. The server emits data and never formats: `ObjectListRow`
gains `friendly_name: string | null`, resolved per family from `npcs`/`zones`/`decks`, and the client
does the pairing.

**Where the pair appears**: the key cell of `ObjectTable`, every detail header, `FriendlyNameDropdown`'s
trigger and options, the `SearchPalette` rows, `NewObjectControl`, and **every section of the quest
editor** — Info, Goals, Requirements, Results, Dialog — wherever a value is a reference.

**The UI spec files this contract touches (story p6-06).** The list is named here because a display
change that only shows up in a red CI run is a change nobody reviewed. Twelve files assert a value
produced by this rule; the greps that find them are `Name (ID)`-shaped literals, a
`FriendlyNameDropdown` trigger/option assertion, a list row's key cell, or a detail header's own
text.

*Updated deliberately — the six whose expected bytes the widening changes:*

| File | What changed, and why |
|---|---|
| `quests-browse.spec.ts` | The Quest Name cell of the fixture's one `resolved`-title row is now the pair (`Title DS-ACAD1-C01-001 (DS-ACAD1-C01-001)`, one named constant); every other row is `rawKey`, so its cell is unchanged. |
| `quests-status.spec.ts` | The row's identity is read from its own `Change status: <quest_name>` label instead of the Quest Name cell, which now renders the pair. |
| `quests-requirements-editor.spec.ts` | The quest condition's dropdown option is the pair. |
| `drop-table-editor.spec.ts` | The inline requirement tree's quest option is the pair. |
| `zone-transfer-editor.spec.ts` | The trigger and the option are the pair; the per-id lookup assertion now names the **detail header's** lookup (which 404s in the mock and falls back to the key), because the dropdown still reads the bulk list. |
| `responsive.spec.ts` | The single-lookup mock answers the **bare row or 404** (`GET /api/names/:type/:id`), not the seven-table envelope — an envelope is not a row, and the ZoneTransfer detail page white-screened on it; the §1 sweep also names the route it is waiting on. |

*Reviewed and left byte-identical — the six whose pairs the change does not alter:*

| File | Why no edit |
|---|---|
| `npc-drop-table-editor.spec.ts`, `simple-object-editors.spec.ts`, `treasure-card-inventory-editor.spec.ts` | They assert the NPC pair outright (`Bob the Vendor (87112)`), which `formatNameRow('npcs')` still renders byte for byte — the rule gained a shared implementation, not a new output. |
| `quests-dialog-editor.spec.ts`, `quests-results-editor.spec.ts` | Same: an NPC pair in a quest-editor reference (`Zarek Pickmaster (126322)`, `Draconian (35528)`). |
| `extraction.spec.ts` | The grown quest's title is a raw key (`title_source: 'rawKey'`), which is not a name, so the new `questFriendlyTitle` gate correctly renders the quest name alone — the assertion is unchanged *because* the rule is right, not because it was relaxed. |

The other display-shaped candidates (`object-list`, `search-palette`,
`object-create-and-counts`, `quests-goals-editor`, `object-mobile`) assert rows whose mocks carry no
`friendly_name`/`name`, so they render the technical value alone and need no edit; `object-editors`
and `p5-04-error-surfaces` match a `Name (ID)` grep only through `Remove <name> (<index>)` action
labels, which are not pairs (`tests/unit/display-single-home.test.ts` allowlists them with reasons).

---

## Global Layout

### Structure

```
┌──────────┬─────────────────────────────────────────┐
│          │  Header Bar                              │
│          │  [Page Title]              [Sync] [User] │
│  Sidebar ├─────────────────────────────────────────┤
│  (260px) │                                          │
│          │  Main Content Area                       │
│  Fixed   │  (scrollable independently)              │
│  nav     │                                          │
│  links   │                                          │
│          │                                          │
│          │                                          │
│          │                                          │
└──────────┴─────────────────────────────────────────┘
```

### Sidebar

Fixed left panel, full viewport height, `zinc-900` background, `zinc-800` right border.

**Navigation Groups** (collapsible):

```
📊 OVERVIEW
   Dashboard

⚔️ QUESTS
   Extract Quests
   Browse Quests
   Catalog

📦 DATA
   Drop Tables
   NPC Inventories
   NPC Spell Inventories
   Creature Spellbooks
   NPC Drop Tables
   Treasure Card Inventory
   Zone Transfers
   Global Registry

⚙️ SETTINGS
   Sync Friendly Names
```

Each group header is clickable to collapse/expand. Active item has `blue-600/10` background and `blue-400` text. Hover state: `zinc-800` background. Icons from Lucide, 18px, left-aligned with 12px gap to label.

**Mobile behavior**: Sidebar collapses to hamburger menu. Overlay on open. Swipe-to-close gesture.

### Header Bar

Height: 56px. `zinc-900` background, bottom border `zinc-800`. Sticky at top of content area.

```
[Page Title (h2, semibold)]                    [Sync Button] [User Avatar/Name]
```

- **Page Title**: Updates based on current route
- **Sync Button**: Secondary button style, triggers friendly name sync. Shows spinner during sync, checkmark on success.
- **User**: Right-aligned. Avatar circle + username. Dropdown for settings/logout (future).

### Toast Notifications

Position: bottom-right corner. Stack upward. Max 3 visible.

- **Success**: Green left border, check icon. Auto-dismiss 5s.
- **Error**: Red left border, alert icon. Auto-dismiss 10s. Click to dismiss.
- **Info**: Blue left border, info icon. Auto-dismiss 5s.

Examples:
- ✅ "Quest DS-ACAD1-C01-001 saved and committed"
- ✅ "Sync complete: 15,234 items, 8,456 spells synced"
- ❌ "Failed to parse packet capture: invalid file format"
- ℹ️ "Extracting quests... this may take a moment"

---

## Pages

### 1. Dashboard

Landing page. Three sections stacked vertically.

#### Stats Cards Row

Four cards in a horizontal row (grid-cols-4 on desktop, grid-cols-2 on tablet, stack on mobile).

```
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ Total       │ │ Extracted   │ │ Reviewed    │ │ Verified    │
│ 597         │ │ 85          │ │ 240         │ │ 272         │
│             │ │ ▰▰▰░░░░░░░  │ │ ▰▰▰▰▰░░░░░  │ │ ▰▰▰▰▰▰░░░░  │
│ all objects │ │ 14.2%       │ │ 40.2%       │ │ 45.6%       │
└─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
```

Each card: `zinc-900` background, `zinc-800` border. Large number in `text-3xl font-bold`. Label in `text-sm text-zinc-400`. Progress bar below using status color. Percentage in `text-xs text-zinc-500`.

#### Per-Type Progress Section

Title: "Verification Progress by Type". Vertical list of progress bars.

```
Quests              ▰▰▰▰▰▰▰▰░░░░░░░░  157/322 (48.8%)
Drop Tables         ▰▰▰▰▰▰▰░░░░░░░░░  70/180 (38.9%)
NPC Inventories     ▰▰▰▰▰▰▰▰▰░░░░░░░  45/95 (47.4%)
Creature Spellbooks ▰▰▰▰▰▰░░░░░░░░░░  12/48 (25.0%)
...
```

Each row: type label (left), segmented progress bar (extracted/reviewed/verified in amber/blue/green), fraction + percentage (right). Bars are 8px tall, rounded-full.

#### Recent Activity Feed

Title: "Recent Activity". Last 10 status changes as a timeline.

```
● DS-ACAD1-C01-001 marked verified        2 hours ago
  "Tested on r806919, all goals trigger correctly"

● WC-UNICORN-MAIN-004 marked reviewed     5 hours ago
  "Goal logic chain verified against live game"

● DropTable KT-SPH3-C02-003 extracted     1 day ago
  Imported from packet capture session_2026-09-24.json
```

Each entry: colored dot (status color), object key in monospace, action text, relative timestamp. Notes in italic `text-zinc-400` below if present. Click entry to navigate to that object.

**Empty state**: Illustration of a shield/checkmark icon + "No activity yet. Extract some quests to get started." + "Extract Quests" button.

---

### 2. Quest Extraction Page

Two-phase layout: upload phase → results phase.

#### Upload Phase

Centered content area (max-width 640px).

```
┌─────────────────────────────────────────────┐
│                                             │
│         📦 [Large drop zone icon]           │
│                                             │
│    Drag & drop packet capture file here     │
│              or click to browse             │
│                                             │
│    Supported format: JSON packet capture (.json)   <!-- the authoritative wording is the task-2.6 acceptance criterion and spec-domain-reference.md L625: "Supported format: JSON packet capture files (.json)" (D50a) --> │
│                                             │
└─────────────────────────────────────────────┘
```

Drop zone: dashed `zinc-700` border, `zinc-900/50` background, rounded-xl. On drag-over: `blue-600/20` background, `blue-500` border. Icon: 48px, `zinc-500`. Text: `text-lg` primary, `text-sm` secondary.

After file selected:
```
┌─────────────────────────────────────────────┐
│  📄 session_2026-09-24.json    12.4 MB     │
│  ⠋ Extracting quests...                     │
│                                             │
│                                    [Cancel] │
└─────────────────────────────────────────────┘
```

Indeterminate spinner (no progress bar or live count — the CLI wrapper is a blocking subprocess). Cancel button: destructive variant.

On complete: transition to results phase.

#### Results Phase

Split layout: quest list (left, 320px) + quest preview (right, fills remaining).

**Left panel**: Scrollable list of extracted quests. Each row: quest name, level badge, goal count, status badge ("new"). Click to select. Selected row: `blue-600/10` background.

**Right panel**: Read-only structured preview of selected quest. Tabbed sections (same tabs as edit view but non-editable). Bottom action bar:

```
[Save All to SpiralDB]  [Save Selected]  [Discard]
```

"Save All": saves every extracted quest, auto-commits, sets status to "extracted". Shows confirmation dialog first: "Save 14 quests to SpiralDB? This will create files and auto-commit."

**Mobile behavior**: List takes full width. Tap quest opens preview as overlay/modal.

---

### 3. Quest Browse / List Page

Full-width data table with status filter tabs above.

#### Filter Tabs

```
[All (322)]  [Extracted (45)]  [Reviewed (120)]  [Verified (157)]
```

Tab bar with count badges. Active tab: `blue-500` underline + white text. Inactive: `zinc-400` text. Search input right-aligned: "Search quests..." with magnifying glass icon.

#### Data Table

Columns:

| Column | Width | Sortable | Notes |
|--------|-------|----------|-------|
| Status | 40px | Yes | Color dot only |
| Quest Name | flex | Yes | Monospace, truncated with tooltip |
| Level | 60px | Yes | Badge style |
| Goals | 60px | Yes | Count |
| Mainline | 40px | Yes | Checkmark or empty |
| Modified | 120px | Yes | Relative time |
| Actions | 80px | No | Edit button, status menu |

Row hover: `zinc-800/50` background. Click row navigates to detail page. Striped rows: alternating `zinc-900` / `zinc-900/50`.

Pagination: bottom-right. "Showing 1-50 of 322". Previous/Next buttons.

**Empty state per filter**: "No {status} quests found." + suggestion to change filter or extract more.

**Mobile behavior**: Table becomes card list. Each card shows name, level, status badge, modified date.

---

### 4. Quest Detail / Edit Page

Header + tabbed content + optional JSON side panel.

#### Header

```
← Back to Quests    DS-ACAD1-C01-001    [StatusBadge: verified]    [Edit] [Save]
```

Back arrow + link. Quest name in `text-xl font-mono font-semibold`. Status badge. Edit/Save toggle button (switches between view and edit mode).

#### Tabbed Sections

Horizontal tab bar below header:

```
[Info] [Goals] [Goal Logic] [Requirements] [Results] [Dialog]
```

Active tab: `blue-500` bottom border + white text. Content area below with 24px top padding.

**Info Tab**: Two-column form layout.
- Left column: m_questName (read-only), m_questTitle (string table lookup display), m_questLevel (number input), m_mainline (checkbox), m_isHidden (checkbox), m_questRepeat (number input), m_activityType (select)
- Right column: m_onStartQuestScript (text input), m_onEndQuestScript (text input), m_clientTags (tag input), timestamps (read-only)

**Goals Tab**: List of goal cards. Each card:
```
┌─────────────────────────────────────────────────────────────┐
│ ☰ 1_WizardQuestGoals_00000058          [Waypoint] [Start]  │
│                                                             │
│ Zone: DragonSpire/DS_A3_Kings/DS_A3Z1_CrystalGrove         │
│ Entry: ✓   Exit: ✗   Proximity Tag: (empty)               │
│                                                             │
│ Client Tags: CollectCrystal3, Ddl_CollectCrystal_Grove1     │
│ Display Image: GUI/QuestButtons/Use_crystal_sample.dds     │
│                                              [Edit] [Delete]│
└─────────────────────────────────────────────────────────────┘
```

Drag handle (☰) for reordering. Goal type badge (colored by type). "Start" badge if in m_startGoals array. Edit opens inline expansion or modal with type-specific fields. Add Goal button at bottom with type selector dropdown.

**Goal Logic Tab**: React Flow canvas. See §Goal Logic Flowchart below.

**Requirements Tab**: Tree editor. Nested AND/OR nodes with requirement type selectors. See §Requirement Tree Editor below.

**Results Tab**: Two sections: Start Results and End Results. Each shows a list of result cards. Add Result button with type selector (ResDropTable, ResModifyEntry, ResAddDynaMod, etc.). Each result type has its own form fields.

**Dialog Tab**: Full dialog editor. List of dialog tags (Prep, Completion, etc.). Each tag expands to show NPCDialogEntry list. Each entry has 50+ fields organized in collapsible sub-sections: Basic, Camera, Sound, Animation, Walk-Away, Advanced. See §Dialog Editor below.

#### JSON Side Panel

Toggleable right panel (400px wide). Syntax-highlighted JSON using `@monaco-editor/react` or `react-json-view-lite`. Live-updates as user edits form. Toggle button in header bar: `{ }` icon.

```
┌──────────────────────────────┬──────────────┐
│  Form Content                │ {            │
│                              │   "m_quest.. │
│                              │   "m_goals": │
│                              │     ...      │
│                              │ }            │
│                              │              │
│                              │ [Copy] [Wrap]│
└──────────────────────────────┴──────────────┘
```

Panel slides in/out with transition. On mobile: full-screen overlay instead of side panel.

#### Evidence Panel (Phase 6 — P6-7…P6-10, D102–D105)

The per-quest evidence surface, **beside the editor in the same view** (P6-7) — not a separate tool,
report or dialog. It appears in **both view and edit modes**, and is reachable from a catalog entry.

**One right rail, two tabs.** The JSON side panel above already owns the 400px right rail, and the
form plus two rails does not fit at the 1280px desktop breakpoint, so the rail carries **two tabs —
`Evidence` and `JSON`** — rather than two panels competing for the same space. The header's `{ }`
toggle opens the rail on the JSON tab; the evidence affordance opens it on the `Evidence` tab. On
mobile the rail is a full-screen overlay, as the JSON panel already is.

```
┌  Form / Tabbed Content          ┬  Evidence │ JSON   ┐
│                                 │  Title: DM-HOWL-MAIN-001 (…)  │
│                                 │  ── Used by this file ──      │
│                                 │   ✓ WizQst…_Goal1Text  [insert]│
│                                 │  ── Available ──              │
│                                 │   ○ WizQst…_Goal2Text  [insert]│
│                                 │  ── Dialogue ──               │
│                                 │   Cyrus Drake: "…"   [insert]  │
│                                 │  ── World gates ──            │
│                                 │   …_Complete · Completed      │
└─────────────────────────────────┴────────────────────────────────┘
```

- **Grouped by field.** Every row belongs to the field it would fill — dialogue into the focused
  `m_dialog`, goal text into the focused goal, location name into `m_locationName`.
- **Own text, split.** Every row of the quest's own table, partitioned **"Used by this file"** /
  **"Available"** (P6-8). Available rows are the authoring material; the split is computed, not
  guessed.
- **One-click insert per row, into the field it belongs to** (P6-9). **Nothing is applied
  automatically**: an insert sets exactly one field, so the saved file's `git diff` shows only that
  field. The panel itself **never writes to the file** — the save pipeline is still the only writer.
- **Friendly names** for every field `REFERENCE_FIELDS` (`shared/quest/validation.ts`) declares as a
  reference (P6-10), resolved through the synced tables and rendered through the single display rule
  above. That table stays the single home for "which field references what" — no second list.
- **An inferred title is visibly marked inferred.** `title_source: 'inferred'` renders a labelled badge
  (D106): inference is shown, never silently trusted, and nothing inferred is ever written into a
  loadable file (P6-6).
- **A warning that cannot block Save applies exactly as elsewhere** (D72): the panel may raise one, and
  Save stays enabled.
- Missing personas/dialogue resolve to the raw string and are **counted, never dropped**; an empty
  section states it is empty rather than disappearing.

#### The header pair

The detail header renders the friendly/technical pair (see §Names): the quest name in
`text-xl font-mono font-semibold` with its title beside it, and — for the four TemplateID families —
the template's NPC name when the template is an NPC.

---

### 5. Goal Logic Flowchart

React Flow canvas taking full tab content area.

#### Node Design

Each goal is a node:
```
┌──────────────────────────┐
│ ● 1_WizardQuestGoals_..  │  ← colored left border by goal type
│ Waypoint                 │
│ Zone: DS_A3Z1_Crystal..  │  ← truncated subtitle
│ [Start]                  │  ← badge if start goal
└──────────────────────────┘
```

Node colors by goal type:
- Waypoint: `blue-500`
- Persona: `purple-500`
- Bounty: `red-500`
- Scavenge: `amber-500`
- AchieveRank: `emerald-500`

#### Edge Design

Directed arrows showing goal progression. Labeled with condition type:
- Solid arrow: AND dependency
- Dashed arrow: OR dependency
- Arrow to special "✓ Complete" node when `m_completeQuest: true`

#### Controls

Bottom-left floating toolbar:
- Zoom in/out buttons
- Fit-to-view button
- Auto-layout button (dagre layout)
- Add GoalLogicEntry button

Right-click node: context menu with "Edit Goal", "Delete", "Set as Start Goal".

**Validation**: If graph has disconnected nodes or cycles, show warning banner above canvas: "⚠️ Goal logic has disconnected nodes. All goals must be reachable from start goals."

---

### 6. Requirement Tree Editor

Recursive tree structure for nested AND/OR requirements.

```
┌─ AND ─────────────────────────────────────────────────────┐
│                                                            │
│  ┌─ ReqHasQuest ─────────────────────────────────────────┐ │
│  │  Quest: DS-ACAD-C01-005  [dropdown]   NOT: ☐         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                            │
│  ┌─ OR ──────────────────────────────────────────────────┐ │
│  │                                                        │ │
│  │  ┌─ ReqSchoolOfFocus ───────────────────────────────┐ │ │
│  │  │  School: Fire  [dropdown]                         │ │ │
│  │  └───────────────────────────────────────────────────┘ │ │
│  │                                                        │ │
│  │  ┌─ ReqHasEntry ─────────────────────────────────────┐ │ │
│  │  │  Quest: [...]   Entry: [...]                      │ │ │
│  │  └───────────────────────────────────────────────────┘ │ │
│  │                                      [+ Add Condition] │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                            │
│                                        [+ Add Condition]   │
│                                        [+ Add Group]       │
└────────────────────────────────────────────────────────────┘
```

Each node: card with colored left border (AND=blue, OR=purple, leaf=green). Operator toggle (AND/OR) on group nodes. Type selector dropdown on leaf nodes. Dynamic fields based on requirement type. Delete button (×) top-right of each card. Nesting indicated by indentation + connecting lines.

---

### 7. Dialog Editor

Within the Dialog tab, organized by dialog tag.

```
┌─ Prep ────────────────────────────────────────────────────┐
│                                                            │
│  ┌─ Entry 1: DS-ACAD1-NPC01_Persona ────────────────────┐ │
│  │  [Basic] [Camera] [Sound] [Animation] [Advanced]     │ │
│  │                                                       │ │
│  │  Basic:                                               │ │
│  │    Dialog Text: WizQst1ED8D_00000005  [lookup]       │ │
│  │    Portrait: Art_Portrait_Miner_Ghost.dds  [picker]  │ │
│  │    Actor Template: Zarek Pickmaster (126322) [dd]    │ │
│  │    Max Time: -1 (unlimited)                          │ │
│  │    Invisible: ☐                                       │ │
│  │                                                       │ │
│  │  Camera: (collapsed)                                  │ │
│  │  Sound: (collapsed)                                   │ │
│  │  Animation: (collapsed)                               │ │
│  │  Advanced: (collapsed)                                │ │
│  │                                    [Duplicate][Delete]│ │
│  └───────────────────────────────────────────────────────┘ │
│                                                            │
│  ┌─ Entry 2: DS-ACAD1-NPC01_Persona ────────────────────┐ │
│  │  ...                                                  │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                            │
│  [+ Add Dialog Entry]                                      │
└────────────────────────────────────────────────────────────┘

[+ Add Dialog Tag]
```

Sub-sections within each entry are collapsible accordions. Most users only need Basic; camera/sound/animation are advanced. Each field uses appropriate input type: text, number, checkbox, dropdown (with friendly names where applicable), file path picker.

---

### 8. Non-Quest Object Editors

Simpler pages sharing common patterns.

#### Common Layout

```
Header: ← Back    {Object Type}    [StatusBadge]    [Edit] [Save]

Content: Single form (no tabs needed for simple types)
         Optional JSON side panel (same toggle as quests)
```

#### DropTable Editor

Form sections:
- **Basic**: Name (text), Description (textarea), RollChance (slider 0-1), Weight (number), NoneChance (slider 0-1)
- **Rewards**: MinGold/MaxGold (number range), ExperienceAmount (number), TrainingPoints (number), GrantsPotionSlot (checkbox)
- **Items**: Repeater list. Each row: ItemId (friendly name dropdown), ItemName (auto-filled, read-only), Notes (text). Add/remove rows.
- **Audit**: CreatedAt, ModifiedAt, CreatedBy, ModifiedBy (read-only or editable)

#### NpcInventory Editor

- **NPC**: TemplateID (friendly name dropdown)
- **Inventory**: Multi-select with friendly name dropdown. Searchable. Shows selected items as removable chips/tags.

#### Other Simple Types

Follow same pattern: key field dropdown + value fields appropriate to type. All use friendly name dropdowns where applicable.

---

### 9. Sync Settings Page

```
┌─ Friendly Name Sync ─────────────────────────────────────┐
│                                                           │
│  Aurorium Path:  /home/jason/.../Aurorium/data/  [Browse]│
│  Imcodec Path:   /run/current-system/sw/bin/imcodec      │
│                                                           │
│  Last Sync: Sep 25, 2026 at 3:30 PM                      │
│  Revision: V_r806919.Wizard_1_610                        │
│  Results: 15,234 items · 8,456 spells · 3,210 NPCs      │
│                                                           │
│  [Sync Now]                                               │
│                                                           │
│  Sync History                                             │
│  ─────────────────────────────────────────────────────    │
│  Sep 25, 3:30 PM  ✓ Success  15,234 items                │
│  Sep 20, 11:15 AM ✓ Success  15,230 items                │
│  Sep 18, 9:00 AM  ✗ Failed   Aurorium path not found     │
└───────────────────────────────────────────────────────────┘
```

Sync button shows loading state during sync. Success/error toast on completion.

---

### 10. Quest Catalog (Phase 6 — P6-15, D99/D110)

Route **`/quests/catalog`** (nav: QUESTS → Catalog). The worklist view over the quest catalog: what
the world names, what has been built, and what is missing.

```
┌─ Quest Catalog ─────────────────────────────────────────────────────────────┐
│  12 defined of 1,447 nameable of ~4,830 quests the client holds text for     │
│  ▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  0.8%                                   │
│                                                                    [ ] missing only │
├─────────────────────────┬──────────────────┬──────────┬────────┬────────────┤
│ Name                    │ Title            │ Defined  │ Refs   │            │
├─────────────────────────┼──────────────────┼──────────┼────────┼────────────┤
│ DM-HOWL-MAIN-001        │ Howling…         │ ✓        │ 6      │ [Evidence] │
│ WC-CYCLOPS-MAIN-002     │ (inferred)       │ ✗        │ 3      │ [Scaffold] │
└─────────────────────────┴──────────────────┴──────────┴────────┴────────────┘
```

- **Coverage header.** Reads the `coverage` view through `GET /api/quests/coverage` — never a
  hard-coded 1,447. The same header also appears on the Quests list page. **The numbers are text, not
  colour-only** (D85, WCAG 1.4.1).
- **One row per catalog quest**, the name paired with its title through §Names, an inferred title
  carrying the labelled badge (D106), `has_definition` as a check/cross **with text**, and the
  reference count.
- **Missing-only filter** narrows to `has_definition = 0`.
- **Each row links into the evidence panel or the scaffold action** — this is the entry point that
  makes the catalog a worklist rather than a report.
- **Scaffold** (P6-5/P6-6, D100/D101): for a `has_definition = 0` row, **Create quest** writes a real
  `QuestTemplates/` file through the existing save pipeline (template + companion metadata + commit,
  status `extracted`) containing the 36 keys in corpus order with explicit nulls, the name, the linked
  title **only when the link is direct**, and empty goals/results/dialog. Nothing inferred is ever
  written. It then opens the existing editor on the new file with the evidence panel beside it. There
  is **no draft lifecycle** — a scaffold is a real quest file from the moment it is written.
- **Empty state**: when the catalog tier is empty (no sync yet), the page says the catalog needs a
  sync and offers the same Sync action as the settings page — never a bare zero.

---

### 11. NPC View (Phase 6 — D112 / P6-17)

Route **`/npcs/:npcId`**. Reached from a paired name in any list row, from a `SearchPalette` result, or
from a dialog speaker. There is **no nav item**: an NPC is a detail surface, not a roster.

```
┌─ Gretta Darkkettle (WC-NPCs_00000003) ──────────────────────────────────────┐
│  Aliases: Gretta Darkkettle · Gretta                                        │
├─ Personas ──────────────┬─ Dialogs ──────────────┬─ Quests ────────────────┤
│  Gretta / Darkkettle    │  WC-CYCLOPS-MAIN-002   │  WC-CYCLOPS-MAIN-002    │
├─ Inventories ───────────────────────────────────────────────────────────────┤
│  NPC Inventories (0) · Spell Inventories (0) · Drop Tables (0)              │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **The header shows the pair**: the friendly name with its technical key, following §Names.
- **Aliases are listed as aliases.** One NPC legitimately carries several name strings at different
  granularities (`Gretta Darkkettle`, `Gretta`) and they are **one NPC**, not four rows; searching
  either finds this one entry.
- **Personas, dialogs, quests and NPC-keyed inventories** are each a section, and each section's
  **count equals a direct query** for that NPC — the counts are shown as text so the claim is visible.
- A family with no rows renders its heading with a `(0)`, so an empty section is visibly empty rather
  than missing.
- **Speaker names in dialog** render through the client's own precedence (override → composed →
  template name) and a composed entry shows the **composition** rather than a raw string-table key.

---

## Responsive Breakpoints

| Breakpoint | Width | Behavior |
|-----------|-------|----------|
| Mobile | < 768px | Sidebar → hamburger. Tables → card lists. JSON panel → full overlay. Stats cards stack. |
| Tablet | 768-1279px | Sidebar visible but narrower (200px). Tables scroll horizontally. JSON panel 300px. |
| Desktop | ≥ 1280px | Full layout. Sidebar 260px. JSON panel 400px. All features available. |

## Loading States

- **Page load**: Skeleton screens matching content layout
- **API calls**: Inline spinners in affected area, not full-page blocking
- **Packet parsing**: Progress bar with live count (see §Extraction)
- **Sync**: Spinner on sync button, disabled state
- **Saving**: Button shows spinner, disabled. Toast on completion.

## Error States

- **API error**: Toast notification + retry option in toast
- **Parse failure**: Inline error message with details + suggestion
- **Network offline**: Persistent banner at top: "Connection lost. Changes will be saved locally."
- **Validation error**: Inline red text below field. Field border turns red. Summary at top of form if multiple errors.

## Accessibility

- All interactive elements keyboard-navigable
- Focus rings: `ring-2 ring-blue-500 ring-offset-2 ring-offset-zinc-950`
- ARIA labels on icon-only buttons
- Color contrast: WCAG AA minimum (4.5:1 for text, 3:1 for large text)
- Status conveyed by both color AND text/icon (not color alone)
- Reduced motion: respect `prefers-reduced-motion` for transitions/animations

## Related Documentation

- [Architecture](./spec-architecture.md) — System overview, tech stack, data flow
- [API Reference](./spec-api.md) — All REST endpoints
- [Data Model](./spec-data-model.md) — SQLite schemas, verification lifecycle, file naming
- [Domain Reference](./spec-domain-reference.md) — SpiralDB JSON schemas, type enumerations, validation rules
