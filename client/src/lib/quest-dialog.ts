/**
 * The Dialog editor's model and every pure rule behind it (plan task 3.8, story p3-08;
 * docs/spec-ui-design.md L420-454, docs/spec-domain-reference.md L444-523).
 *
 * Data and rules, not JSX — the same split as `lib/quest-goals.ts`, `lib/quest-results.ts`
 * and `lib/requirement-tree.ts`: the 66-field inventory ({@link DIALOG_ENTRY_FIELD_SPECS}),
 * the 5 accordions mapped onto the domain reference's 7 field groups
 * ({@link DIALOG_ACCORDIONS}), the read helpers a section/card renderer walks, and the
 * path-addressed edit builders every control calls.
 *
 * ## Measured corpus facts this model is built on
 *
 * Re-measured against the real checkout
 * (`/home/jason/Documents/git-projects/spiraldb/QuestTemplates`) at the owner's `f9a1055`
 * baseline — **328** files, D79. The 322-file/2026-09-26 numbers are the parentheses where the
 * merge moved them; every count below was taken again from the 328-file corpus.
 *
 * - **The real shape is THREE levels**, not a flat entry list: `m_dialogList` is an
 *   `ActorDialogList` object (`{$type, m_dialogs}`, that order in **797/797**, was 767) whose
 *   `m_dialogs` is an array of **tag groups**, each with a uniform **6-key order**
 *   (`m_dialogTag, m_dialogEntries, m_madlibs, m_dialogEvents, m_noAggroWhileDialogIsUp,
 *   m_noAggroNoDelay`, 774/774, was 739). 797 lists = **328 quest-level** (present in 328/328
 *   files) + **469 goal-level** (327 goals carry an explicit `null`). 774 groups, **1884
 *   entries** (was 1706). Five of those groups carry a `$type` — they are the **typed
 *   `ActorDialog`** blocks nested in `ResActorDialog.m_dialog` (D79's corpus-only result
 *   class), not members of any list; the other 769 are the untagged form this editor mounts.
 * - **`m_dialogTag` is a free string**: `"Completion"` 442, `"Prep"` 322, **`""` 5** and
 *   **`"Hyperlink"` 5** (all five on the typed `ActorDialog` blocks). The empty tag is real
 *   content and is never "fixed", padded or re-labelled.
 * - **43 lists have an empty `m_dialogs` array** (7 quest-level, 36 goal-level — unchanged by
 *   the merge) and must render an empty state, never be padded. `m_dialogEntries` is never
 *   empty (0 of 774 groups), which is why a **new** tag group starts with one entry
 *   ({@link newDialogGroup}) — p3-06's same rule for a new requirement group — while an
 *   existing empty array is only ever rendered, never padded.
 * - **`m_dialogEvents` is `null` in 774/774** (the D17 clone's own rewritten files omit it, 10
 *   of its 739 groups) and `m_madlibs` is an array of `{m_madlibBlock, m_index}` in 742 groups
 *   / `null` in 32; `m_noAggroWhileDialogIsUp` and `m_noAggroNoDelay` are `false` in 774/774.
 *   The madlib chain bottoms out in `MadlibArgT_ByteString` children
 *   (`shared/quest/dialog.ts`).
 * - **Five entry key orders in the real checkout now, and the sparse ones must not be padded**
 *   (this story's primary risk; the p3-04 sparse-goal and p3-06 untyped-wrapper lesson): the
 *   shapes are data — {@link DIALOG_ENTRY_KEY_SHAPES}, one home for every key list, count and
 *   provenance address. Measured counts: **1868 × 66 keys** (full, `$type` first), **7 × 65
 *   keys** with the null-valued `m_dialogEvent` omitted (new — the `WC-COMMONS-MAIN-002-*`
 *   `m_dialogEntries[11]` entries, the brief's flagship among them), **6 × 45 keys** (stopping
 *   at `m_soundEffectFile`, all six in `WC-UNICORN-SIDE-001`), **2 × 58 keys** with `$type`,
 *   the six persona-prefix keys and `m_requirements` all absent (new —
 *   `WC-TRITON-MAIN-004[4]`, `WC-TRITON-MAIN-007[5]`) and **1 × 60 keys** (the six leading
 *   identity keys absent, `WC-TRITON-MAIN-002`). The 322-file corpus had three orders
 *   (1698 / 6 / 2), so **two are new and one lost a member** to the `58`-key shape. Measured
 *   correction carried forward from the brief: the sparse order omits **6** leading keys, not
 *   13 — 66 − 6 = 60, and `m_requirements … m_actorTemplateID` are present on those entries.
 *   The **D17 clone** adds a sixth shape, in the two files this tool itself wrote
 *   (`WC-CYCLOPS-MAIN-002`, `WC-UNICORN-MAIN-004`): **35 × 65 keys** with `m_requirements`
 *   omitted (the `NullValueHandling.Ignore` shape D57a names), whose 10 tag groups likewise
 *   omit the null-valued `m_dialogEvents` (5 keys instead of 6). The build is expected to
 *   preserve all six entry shapes and both group shapes, and the unit sweep does — over both
 *   corpora, byte-identically.
 * - **Field inventory = the corpus's own 66 keys** (65 value keys) **plus one synthetic
 *   field** — {@link DIALOG_ENTRY_FIELD_SPECS} is 66 fields, and the domain reference's
 *   grouping is checked against it: the corpus's 65 value keys are exactly the spec's 59 non-`$type`
 *   keys (the spec's `m_cameraOffsetX/Y/Z` and `m_pitch/yaw/roll` shorthand expands to six
 *   corpus keys) plus six camera-split keys the spec lists in shorthand. **The spec's
 *   `m_defaultDialogAnimation` never occurs on any corpus entry** (0 of 1884) and is modelled
 *   anyway, labelled synthetic ({@link DialogFieldSpec.synthetic}). **No field is new at this
 *   baseline** — the merge changed which keys nodes *omit*, never which keys exist.
 * - **Corpus-empty fields implemented but labelled synthetic**: entry `m_requirements` is
 *   `null` on **all 1882 entries that carry the key** (1882/1884 carry it — the two
 *   `sparse58NoType` entries do not; the plan's "→ the 3.6 tree" is fixture-only here, yet the
 *   shared tree is still mounted because an entry could carry one), `m_action` is `""` in
 *   **1884/1884**, and group `m_dialogEvents` is null in all 774. Two flags keep those two
 *   meanings apart ({@link DialogFieldSpec.synthetic} labels a field, `corpusAbsent` marks the
 *   one key **no** corpus entry carries, so only it is withheld from a new entry).
 * - **Zero unmodelled corpus keys.** All 66 distinct entry keys are modelled, so the
 *   raw-fields disclosure (AC2) is exercised by a *legacy* key of a name this model has never
 *   heard of — unlike p3-06's `ReqHasEntry`. The corpus's own oddities that AC2's clause rests
 *   on are the sparse shapes, the explicit `null`s and the empty tag, and those are proven by
 *   the byte-identical re-set sweep rather than by the disclosure.
 * - **Value domains and reference decisions** (every one miss-safe per D60(c)/D59(d); these
 *   were measured through the synced `data/spiraldb-ui.db` against the **322-file** corpus and
 *   are **not** re-measured at `f9a1055`: the database is the tool's own 322-row state and was
 *   deliberately not re-synced for this baseline — D79's "say so rather than doing it". The
 *   corpus-side counts below stay descriptive; the `/N` denominators are the old ones):
 *   `m_actorTemplateID` → npcs **115/115** distinct non-zero values resolve (**330 entries
 *   carry `0`**, which stays a value and is never turned into an empty lookup);
 *   `m_walkAwayNpcTemplateID` → npcs **30/30** non-zero, `0` is "none" (1675 entries);
 *   `m_dialog` → the `string_table.key` table (216,991 rows) **1099/1105** distinct keys
 *   resolve, 6 miss; `m_cameraZoneName` → `zones.zone_path` **73/87** (the 14 misses are
 *   interior variants); `m_nameSTKey` offers the two measured keys
 *   (`NPCFormats_First_Last`, `NPCFormats_First_Only` — both resolve in `string_table`) while
 *   `null` (92) and `""` are preserved; `m_personaName` has 149
 *   distinct values that resolve in **no** names table ⇒ free text; `m_maxTimeSeconds`
 *   is `-1` (unlimited) in the measured majority and `0` in 105 ⇒ a number field with the
 *   hint; `m_cameraHidePlayers`'s measured 322-file domain is **0 (667), 1 (104), 2 (934),
 *   3 (1)** while the spec says only "0=no, 2=yes" ⇒ a **numeric** select over the measured
 *   values ({@link DialogFieldKind} `number-select`) so an unlisted value stays displayed,
 *   selected and numeric.
 * - **Twelve fields are `null` in exactly 2 entries each** (`m_cameraShakeType`,
 *   `m_cameraFadeType`, `m_idleAnimation`, `m_dialogEvent`, `m_standInPlayerTag`,
 *   `m_secondaryCameraName`, `m_soundEffectFile`, `m_musicFile`, `m_cameraZoneName`,
 *   `m_npcStandInList`, `m_dialogAnimationList`, `m_dialogTurningList`) plus `m_nameOverride`
 *   in 6 and `m_nameSTKey` in 92 ⇒ `null` must survive an unrelated edit. (Unchanged by the
 *   merge: the same 12 fields, the same counts.)
 * - **The three "array" fields are arrays of ENCODED STRINGS**, not objects:
 *   `m_npcStandInList` = `["MB_MayorPimsbury instance", …]` (19 elements over 12 entries),
 *   `m_dialogAnimationList` = `["0|126322|Gen_Dial_01|5", …]` (527 elements),
 *   `m_dialogTurningList` = `["0|38119|50|1", …]` (26 elements); each is `[]` when unused and
 *   **no element is empty or contains a newline** (measured over all 572 elements), which is
 *   what makes the line-per-element control lossless. The pipe format is never decomposed,
 *   and no element is ever reordered or reformatted.
 * - **Per-field new-entry defaults are the measured mode** (e.g. `m_interpolationDuration` 1,
 *   `m_musicFadeTime` 3, `m_bypassCameraOnReview` true, `m_playSoundIfSpamming` true),
 *   because a *new* node has to write something and the corpus's majority value is the least
 *   surprising one — the same rule `lib/quest-results.ts` uses. An **existing** node is never
 *   rebuilt from this table (D57).
 *
 * ## The write rule (D57/D58d): edits, never rebuilds
 *
 * {@link readDialogList} returns a **render-only view**. Every builder returns
 * {@link DocEdit}s the caller applies with `applyEdits`, so untouched keys, their order,
 * explicit `null`s, absent keys and `$type` literals survive. Two consequences are recorded
 * rather than hidden:
 *
 * 1. **A key an existing node lacks is appended at the end** (`setAtPath`'s documented merge
 *    rule), so a first edit to the 6-key sparse order or the 45-key order cannot "restore"
 *    the missing keys — exactly the preservation AC2′s sibling clause requires.
 * 2. **`m_dialogTag` is the one text control whose empty state is written as `""` rather
 *    than deleted.** The five measured `""` tags are real content, and deleting the key would
 *    break the group's uniform 6-key order that 774/774 groups share. Every other text/number
 *    control follows D59(c): emptied ⇒ one `delete` when the key exists, **no edit** when it
 *    does not (so clearing an already-absent field can never create one, and `''` is never
 *    written into a numeric/boolean slot).
 *
 * {@link duplicateEntryEdits} deep-copies the entry verbatim (a JSON round trip preserves key
 * order exactly), so a duplicated sparse entry stays sparse and a duplicated `$type` is
 * unchanged. {@link moveEntryEdits} is deliberately **absent**: the UI spec's dialog section
 * (L420-454) has Duplicate and Delete but no reordering.
 */

import { formatDocPath, type DocEdit, type DocPath } from '@shared/document';
import { TYPE_STRINGS } from '@shared/quest/typeConstants';

import { formatNameValue, type NameRowMap, type NamesType } from './display';

/* ------------------------------------------------------------------ paths */

/** The quest/goal slot that holds an `ActorDialogList` (both levels use this key). */
export const DIALOG_LIST_KEY = 'm_dialogList';

/** The list's tag-group array — the corpus's own key, never tagged per group. */
export const DIALOGS_KEY = 'm_dialogs';

/** A group's tag — the section's own identity (free string; `""` occurs 5×). */
export const DIALOG_TAG_KEY = 'm_dialogTag';

/** A group's entry array. */
export const DIALOG_ENTRIES_KEY = 'm_dialogEntries';

/** A group's madlib templates (untouched by this editor, surfaced read-only). */
export const GROUP_MADLIBS_KEY = 'm_madlibs';

/** A group's dialog events (null in 774/774; surfaced read-only). */
export const GROUP_DIALOG_EVENTS_KEY = 'm_dialogEvents';

/** A group's first aggro flag (`false` in 774/774). */
export const NO_AGGRO_WHILE_DIALOG_IS_UP_KEY = 'm_noAggroWhileDialogIsUp';

/** A group's second aggro flag (`false` in 774/774). */
export const NO_AGGRO_NO_DELAY_KEY = 'm_noAggroNoDelay';

/** An entry's requirement slot — where the shared tree is mounted. */
export const REQUIREMENTS_KEY = 'm_requirements';

/** The `m_dialogs` array path of the list at {@link listPath}. */
export function dialogGroupsPath(listPath: DocPath): DocPath {
  return [...listPath, DIALOGS_KEY];
}

/** One tag group's path: `[…list, 'm_dialogs', index]`. */
export function dialogGroupPath(listPath: DocPath, groupIndex: number): DocPath {
  return [...dialogGroupsPath(listPath), groupIndex];
}

/** The group's tag path. */
export function dialogTagPath(listPath: DocPath, groupIndex: number): DocPath {
  return [...dialogGroupPath(listPath, groupIndex), DIALOG_TAG_KEY];
}

/** A group's entry-array path. */
export function dialogEntriesPath(listPath: DocPath, groupIndex: number): DocPath {
  return [...dialogGroupPath(listPath, groupIndex), DIALOG_ENTRIES_KEY];
}

/** One entry's path: `[…list, 'm_dialogs', g, 'm_dialogEntries', e]`. */
export function dialogEntryPath(
  listPath: DocPath,
  groupIndex: number,
  entryIndex: number,
): DocPath {
  return [...dialogEntriesPath(listPath, groupIndex), entryIndex];
}

/** One entry field's path: `[…entry, key]`. */
export function dialogEntryFieldPath(
  listPath: DocPath,
  groupIndex: number,
  entryIndex: number,
  key: string,
): DocPath {
  return [...dialogEntryPath(listPath, groupIndex, entryIndex), key];
}

/** An entry's `m_requirements` slot — what the shared tree is mounted at. */
export function dialogEntryRequirementsPath(
  listPath: DocPath,
  groupIndex: number,
  entryIndex: number,
): DocPath {
  return [...dialogEntryPath(listPath, groupIndex, entryIndex), REQUIREMENTS_KEY];
}

/* ------------------------------------------------------------------ UI copy */

/** The editor's default accessible name (a host overrides it per slot). */
export const DIALOG_LIST_EDITOR_LABEL = 'Dialog list editor';

/** The bottom "Add Dialog Tag" control. */
export const ADD_DIALOG_TAG_LABEL = 'Add Dialog Tag';

/** The per-tag "Add Dialog Entry" control. */
export const ADD_DIALOG_ENTRY_LABEL = 'Add Dialog Entry';

/** The per-entry duplicate control's label stem (`Duplicate <address>`). */
export const DUPLICATE_ENTRY_LABEL = 'Duplicate';

/** The per-entry delete control's label stem (`Delete <address>`). */
export const DELETE_ENTRY_LABEL = 'Delete';

/** The read-only disclosure of keys the model does not know. */
export const RAW_FIELDS_LABEL = 'Raw fields';

/** The absent/null list's sentence (Add is still offered). */
export const NO_DIALOG_LIST_TEXT = 'This dialog list is absent or null.';

/** The empty `m_dialogs` array's sentence (43 of the 797 measured lists, was 767). */
export const NO_DIALOG_TAGS_TEXT = 'This dialog list has no dialog tags.';

/** The empty `m_dialogEntries` array's sentence (never measured — 0 of 774 groups, was 739). */
export const NO_DIALOG_ENTRIES_TEXT = 'No dialog entries in this tag.';

/** A group whose value is not an object: kept visible instead of dropped. */
export const UNREADABLE_GROUP_TEXT = 'Unrecognised dialog tag value';

/** An entry whose value is not an object: kept visible instead of dropped. */
export const UNREADABLE_ENTRY_TEXT = 'Unrecognised dialog entry value';

/** The visible word for the 5 measured empty tags (never "fixed"). */
export const EMPTY_TAG_LABEL = '(empty tag)';

/** The visible word for a group whose `m_dialogTag` key is absent. */
export const ABSENT_TAG_LABEL = '(no tag key)';

/** The synthetic spec-listed field's own note. */
export const SYNTHETIC_FIELD_NOTE =
  'Spec-listed (docs/spec-domain-reference.md L517) but present on 0 of the 1884 corpus entries — shown read-only, never written.';

/** The fixture-only note on an entry's requirement slot. */
export const REQUIREMENTS_FIXTURE_NOTE =
  'm_requirements is null on all 1882 corpus entries that carry the key (of 1884) — the tree is fixture-only here; the first Add writes the shared tree’s own wrapper.';

/** The string-list control's own encoding note, verbatim from the corpus. */
export const STRING_LIST_NOTE =
  'One encoded element per line, written back verbatim — never decomposed, reordered or reformatted.';

/** The tag control's own note (why its empty state is a value, not a deletion). */
export const TAG_NOTE =
  'A free string: "Prep" 322, "Completion" 442, "" 5 and "Hyperlink" 5 in the corpus — an empty tag is written as "" and the key is kept.';

/** The unset option label every dialog select leads with (a null/absent value). */
export const DIALOG_SELECT_UNSET_LABEL = '—';

/** The corpus’s two measured format keys, the `m_nameSTKey` control’s suggestions. */
export const NAME_ST_KEYS = ['NPCFormats_First_Last', 'NPCFormats_First_Only'] as const;

/* ------------------------------------------------------------- field specs */

/** How one entry field renders. */
export type DialogFieldKind =
  | 'text'
  | 'number'
  | 'number-select'
  | 'boolean'
  | 'friendly-name'
  | 'string-key'
  | 'string-list'
  | 'requirements'
  | 'raw-object';

/** The domain reference's own seven sub-sections (L444-523). */
export type DialogFieldGroup =
  | 'Basic'
  | 'Camera'
  | 'Duration & Timing'
  | 'Walk-Away'
  | 'Audio'
  | 'Animation & NPC'
  | 'UI Controls';

/** The five accordions the UI spec pins (L420-454); Basic is the open one. */
export type DialogAccordionId = 'Basic' | 'Camera' | 'Sound' | 'Animation' | 'Advanced';

/** One field of an entry. */
export interface DialogFieldSpec {
  /** The document key this field owns (also the control's visible label and accessible name). */
  key: string;
  kind: DialogFieldKind;
  /** The domain reference's sub-section this field belongs to (the 7-group axis). */
  group: DialogFieldGroup;
  /** The one-line explanation under the control — measured facts where the corpus has some. */
  help: string;
  /** For `friendly-name`: the names table the value belongs to. */
  nameSources?: readonly NamesType[];
  /** For `friendly-name`: the JSON type the raw id is written as. */
  idValueType?: 'string' | 'number';
  /**
   * For `string-key`: suggested keys (offered through a `datalist`, never a closed list).
   * For `number-select`: the measured numeric domain.
   */
  options?: readonly (string | number)[];
  /**
   * `true` when the field is corpus-empty or corpus-absent and the UI must say so: the
   * spec-listed `m_defaultDialogAnimation` (0 of 1884 entries) and the requirement slot
   * (`null` on all 1882 entries that carry the key). The flag labels the field; it does not
   * change how it is preserved.
   */
  synthetic?: boolean;
  /**
   * `true` when **no corpus entry carries the key at all** (only `m_defaultDialogAnimation`),
   * so a new entry must not write it — inventing it would be exactly the padding this story
   * forbids. A corpus-present synthetic field (`m_requirements`, always `null`) *is* written.
   */
  corpusAbsent?: boolean;
  /** What a **new** entry writes — the corpus's measured mode (see the module header). */
  defaultValue: unknown;
}

/** One accordion: the spec's 5 tabs mapped onto the domain reference's 7 groups. */
export interface DialogAccordionSpec {
  id: DialogAccordionId;
  /** The button's own visible word and accessible name (the spec's ASCII, L420-454). */
  label: string;
  /** The domain reference's groups rendered inside this accordion. */
  groups: readonly DialogFieldGroup[];
  /** `true` for Basic only: the spec's "Basic open by default, rest collapsed" (L554). */
  openByDefault: boolean;
}

/**
 * The five accordions, and **which of the seven field groups went where** — the mapping the
 * story must state:
 *
 * | accordion | domain group(s) | fields |
 * |---|---|---|
 * | Basic (open) | Basic | 13 |
 * | Camera | Camera | 22 |
 * | Sound | Audio | 10 |
 * | Animation | Animation & NPC | 7 (6 corpus + `m_defaultDialogAnimation`) |
 * | Advanced | Duration & Timing + Walk-Away + UI Controls | 6 + 5 + 3 = 14 |
 *
 * The spec's ASCII shows only five Basic fields (dialog text, portrait, actor template, max
 * time, invisible); the domain reference's Basic group is 13 fields including `m_soundFile`,
 * `m_action`, `m_dialogEvent` and `m_requirements`, and it is the domain reference's grouping
 * that is authoritative here — so `m_soundFile` stays in Basic (where the domain reference
 * puts it) while the *Audio* group's `m_soundEffectFile`/`m_musicFile` go to `Sound`.
 */
export const DIALOG_ACCORDIONS: readonly DialogAccordionSpec[] = [
  { id: 'Basic', label: 'Basic', groups: ['Basic'], openByDefault: true },
  { id: 'Camera', label: 'Camera', groups: ['Camera'], openByDefault: false },
  { id: 'Sound', label: 'Sound', groups: ['Audio'], openByDefault: false },
  { id: 'Animation', label: 'Animation', groups: ['Animation & NPC'], openByDefault: false },
  {
    id: 'Advanced',
    label: 'Advanced',
    groups: ['Duration & Timing', 'Walk-Away', 'UI Controls'],
    openByDefault: false,
  },
];

const BASIC: DialogFieldGroup = 'Basic';
const CAMERA: DialogFieldGroup = 'Camera';
const TIMING: DialogFieldGroup = 'Duration & Timing';
const WALK: DialogFieldGroup = 'Walk-Away';
const AUDIO: DialogFieldGroup = 'Audio';
const ANIM: DialogFieldGroup = 'Animation & NPC';
const UI: DialogFieldGroup = 'UI Controls';

/**
 * The 66 fields an entry's editor models, **in the corpus's own 66-key order minus `$type`**
 * (which is the entry tag, not an editable field). 65 of them are the corpus's own value keys;
 * the one synthetic addition is `m_defaultDialogAnimation`.
 *
 * The order is load-bearing twice over: it is the order a **new** entry is written in
 * ({@link newDialogEntry}) and the order the accordions' controls render in. Because the
 * corpus writes groups interleaved (e.g. `m_duration`/`m_delay`/`m_cameraHidePlayers` sit
 * inside the Camera run), each field carries its semantic {@link DialogFieldSpec.group}
 * separately — the two axes are deliberately not the same list.
 */
export const DIALOG_ENTRY_FIELD_SPECS: readonly DialogFieldSpec[] = [
  {
    key: 'm_personaName',
    kind: 'text',
    group: BASIC,
    help: 'NPC persona identifier (149 distinct corpus values, resolving in no names table ⇒ free text)',
    defaultValue: '',
  },
  {
    key: 'm_nameOverride',
    kind: 'text',
    group: BASIC,
    help: 'Override display name',
    defaultValue: '',
  },
  {
    key: 'm_nameSTKey',
    kind: 'string-key',
    group: BASIC,
    help: 'String-table key for the name format (NPCFormats_First_Last 1449, NPCFormats_First_Only 325, null 92, "" 15)',
    options: NAME_ST_KEYS,
    defaultValue: 'NPCFormats_First_Last',
  },
  {
    key: 'm_guiDisplay',
    kind: 'text',
    group: BASIC,
    help: 'GUI display override',
    defaultValue: '',
  },
  {
    key: 'm_maxTimeSeconds',
    kind: 'number',
    group: BASIC,
    help: 'Max dialog display time — -1 = unlimited (measured: -1 in 1789 entries, 0 in 92)',
    defaultValue: -1,
  },
  {
    key: 'm_invisible',
    kind: 'boolean',
    group: BASIC,
    help: 'Hide dialog UI',
    defaultValue: false,
  },
  {
    key: 'm_requirements',
    kind: 'requirements',
    group: BASIC,
    help: 'Conditions to show this entry (null on all 1882 corpus entries that carry the key — fixture-only here)',
    synthetic: true,
    defaultValue: null,
  },
  {
    key: 'm_dialog',
    kind: 'string-key',
    group: BASIC,
    help: 'String-table key for the dialog text (1099 of 1105 distinct corpus keys resolve; the rest show the raw key)',
    defaultValue: '',
  },
  {
    key: 'm_picture',
    kind: 'text',
    group: BASIC,
    help: 'Portrait image path (e.g. GUI/NpcPortraits/…dds — 135 distinct paths)',
    defaultValue: '',
  },
  {
    key: 'm_soundFile',
    kind: 'text',
    group: BASIC,
    help: 'Voice-over audio path (|Sound_Dialogue…|WorldData|… .mp3/.ogg)',
    defaultValue: '',
  },
  {
    key: 'm_action',
    kind: 'text',
    group: BASIC,
    help: 'Action trigger ("" on all 1884 corpus entries)',
    defaultValue: '',
  },
  {
    key: 'm_dialogEvent',
    kind: 'text',
    group: BASIC,
    help: 'Event to fire ("" in 1679 entries, null in 2, 23 distinct names)',
    defaultValue: '',
  },
  {
    key: 'm_actorTemplateID',
    kind: 'friendly-name',
    group: BASIC,
    help: 'NPC actor template — npcs (115/115 distinct non-zero values resolve; 0 is a value on 330 entries)',
    nameSources: ['npcs'],
    idValueType: 'number',
    defaultValue: 0,
  },

  {
    key: 'm_cameraName',
    kind: 'text',
    group: CAMERA,
    help: 'Camera position name or "LOCATION" ("" in 779, "LOCATION" in 679, "DEFAULT" 17)',
    defaultValue: '',
  },
  {
    key: 'm_interpolationDuration',
    kind: 'number',
    group: CAMERA,
    help: 'Camera transition time in seconds',
    defaultValue: 1,
  },
  {
    key: 'm_cameraOffsetX',
    kind: 'number',
    group: CAMERA,
    help: 'Camera X offset',
    defaultValue: 0,
  },
  {
    key: 'm_cameraOffsetY',
    kind: 'number',
    group: CAMERA,
    help: 'Camera Y offset',
    defaultValue: 0,
  },
  {
    key: 'm_cameraOffsetZ',
    kind: 'number',
    group: CAMERA,
    help: 'Camera Z offset',
    defaultValue: 0,
  },
  { key: 'm_pitch', kind: 'number', group: CAMERA, help: 'Camera pitch', defaultValue: 0 },
  { key: 'm_yaw', kind: 'number', group: CAMERA, help: 'Camera yaw', defaultValue: 0 },
  { key: 'm_roll', kind: 'number', group: CAMERA, help: 'Camera roll', defaultValue: 0 },
  {
    key: 'm_cameraShakeType',
    kind: 'text',
    group: CAMERA,
    help: 'Shake effect type ("" in 1704 entries, null in 2)',
    defaultValue: '',
  },
  {
    key: 'm_cameraShakeDuration',
    kind: 'number',
    group: CAMERA,
    help: 'Shake duration',
    defaultValue: 0,
  },
  {
    key: 'm_cameraShakeAmplitude',
    kind: 'number',
    group: CAMERA,
    help: 'Shake intensity',
    defaultValue: 0,
  },
  {
    key: 'm_bypassCameraOnReview',
    kind: 'boolean',
    group: CAMERA,
    help: 'Skip camera on dialog review (true in 1671 entries)',
    defaultValue: true,
  },
  {
    key: 'm_cameraZoneName',
    kind: 'friendly-name',
    group: CAMERA,
    help: 'Zone for the camera position — zones (73 of 87 distinct paths resolve; an unlisted interior variant stays displayed)',
    nameSources: ['zones'],
    idValueType: 'string',
    defaultValue: '',
  },
  {
    key: 'm_duration',
    kind: 'number',
    group: TIMING,
    help: 'Dialog duration in seconds',
    defaultValue: 0,
  },
  { key: 'm_delay', kind: 'number', group: TIMING, help: 'Delay before showing', defaultValue: 0 },
  {
    key: 'm_cameraHidePlayers',
    kind: 'number-select',
    group: CAMERA,
    help: 'Hide players during dialog — measured domain 0 (667), 1 (104), 2 (934), 3 (1); the spec names only 0=no, 2=yes',
    options: [0, 1, 2, 3],
    defaultValue: 2,
  },
  {
    key: 'm_walkAwayNpcTemplateID',
    kind: 'friendly-name',
    group: WALK,
    help: 'NPC that walks away — npcs (30/30 distinct non-zero values resolve; 0 means none on 1675 entries)',
    nameSources: ['npcs'],
    idValueType: 'number',
    defaultValue: 0,
  },
  {
    key: 'm_walkAwayExitDirectionInDegrees',
    kind: 'number',
    group: WALK,
    help: 'Exit direction in degrees',
    defaultValue: 0,
  },
  {
    key: 'm_walkAwayFadeTime',
    kind: 'number',
    group: WALK,
    help: 'Fade time for the walk-away',
    defaultValue: 0,
  },
  {
    key: 'm_walkAwayUseCurrentFacing',
    kind: 'boolean',
    group: WALK,
    help: 'Walk away from the current facing (true in 38 entries)',
    defaultValue: false,
  },
  {
    key: 'm_standInPlayerTag',
    kind: 'text',
    group: WALK,
    help: 'Stand-in player tag ("" in 1676 entries, null in 2, 13 distinct tags)',
    defaultValue: '',
  },
  {
    key: 'm_fadeOutCamera',
    kind: 'boolean',
    group: CAMERA,
    help: 'Fade the camera out',
    defaultValue: false,
  },
  {
    key: 'm_snapCameraToPlayerAtExit',
    kind: 'boolean',
    group: CAMERA,
    help: 'Snap the camera back to the player at exit',
    defaultValue: false,
  },
  {
    key: 'm_secondaryCameraName',
    kind: 'text',
    group: CAMERA,
    help: 'Secondary camera ("" in 1704 entries, null in 2)',
    defaultValue: '',
  },
  {
    key: 'm_secondaryInterpolationDuration',
    kind: 'number',
    group: CAMERA,
    help: 'Secondary camera transition time',
    defaultValue: 0,
  },
  {
    key: 'm_npcStandInList',
    kind: 'string-list',
    group: ANIM,
    help: 'Encoded stand-in list, e.g. ["MB_MayorPimsbury instance", …] — [] on 1692 entries, null on 2',
    defaultValue: [],
  },
  {
    key: 'm_dialogAnimationList',
    kind: 'string-list',
    group: ANIM,
    help: 'Encoded animation list, e.g. ["0|126322|Gen_Dial_01|5", …] — [] on 1186, populated on 518',
    defaultValue: [],
  },
  {
    key: 'm_dialogTurningList',
    kind: 'string-list',
    group: ANIM,
    help: 'Encoded turning list, e.g. ["0|38119|50|1", …] — [] on 1683, populated on 21',
    defaultValue: [],
  },
  {
    key: 'm_npcYawOffsetInDegrees',
    kind: 'number',
    group: ANIM,
    help: 'NPC yaw offset in degrees',
    defaultValue: 0,
  },
  {
    key: 'm_allowPlayerToMove',
    kind: 'boolean',
    group: ANIM,
    help: 'Allow the player to move (true in 3 entries)',
    defaultValue: false,
  },
  {
    key: 'm_soundEffectFile',
    kind: 'text',
    group: AUDIO,
    help: 'Sound effect path ("" in 1695 entries, null in 2)',
    defaultValue: '',
  },
  {
    key: 'm_musicFile',
    kind: 'text',
    group: AUDIO,
    help: 'Music track path ("" in 1659 entries, null in 2)',
    defaultValue: '',
  },
  {
    key: 'm_nonStackableMusic',
    kind: 'boolean',
    group: AUDIO,
    help: 'Music does not stack (true in 18 entries)',
    defaultValue: false,
  },
  {
    key: 'm_nonRepeatableMusic',
    kind: 'boolean',
    group: AUDIO,
    help: 'Music does not repeat (true in 18 entries)',
    defaultValue: false,
  },
  {
    key: 'm_playMusicAtSFXVolume',
    kind: 'boolean',
    group: AUDIO,
    help: 'Play music at sound-effect volume',
    defaultValue: false,
  },
  {
    key: 'm_soundEffectDelay',
    kind: 'number',
    group: AUDIO,
    help: 'Sound-effect delay',
    defaultValue: 0,
  },
  { key: 'm_musicDelay', kind: 'number', group: AUDIO, help: 'Music delay', defaultValue: 0 },
  {
    key: 'm_musicFadeTime',
    kind: 'number',
    group: AUDIO,
    help: 'Music fade time (measured 3 in 1655 entries)',
    defaultValue: 3,
  },
  {
    key: 'm_dontReleaseCameraAtExit',
    kind: 'boolean',
    group: CAMERA,
    help: 'Do not release the camera at exit (true in 302 entries)',
    defaultValue: false,
  },
  {
    key: 'm_disableBackButton',
    kind: 'boolean',
    group: UI,
    help: 'Disable the back button',
    defaultValue: false,
  },
  {
    key: 'm_enableExitButton',
    kind: 'boolean',
    group: UI,
    help: 'Enable the exit button',
    defaultValue: false,
  },
  {
    key: 'm_cameraFadeType',
    kind: 'text',
    group: CAMERA,
    help: 'Fade effect type ("" in 1683, "In Out Black" 5, "In Out White" 4, null 2)',
    defaultValue: '',
  },
  {
    key: 'm_cameraFadeTime',
    kind: 'number',
    group: CAMERA,
    help: 'Fade duration (measured 0.5 in 1668)',
    defaultValue: 0.5,
  },
  {
    key: 'm_idleAnimation',
    kind: 'text',
    group: ANIM,
    help: 'Idle animation ("" in 1698 entries, null in 2)',
    defaultValue: '',
  },
  {
    key: 'm_spamTime',
    kind: 'number',
    group: TIMING,
    help: 'Spam prevention interval (measured 1)',
    defaultValue: 1,
  },
  {
    key: 'm_playSoundIfSpamming',
    kind: 'boolean',
    group: TIMING,
    help: 'Play the sound while spamming (true in 1664 entries)',
    defaultValue: true,
  },
  {
    key: 'm_playMusicIfSpamming',
    kind: 'boolean',
    group: TIMING,
    help: 'Play the music while spamming (true in 1652 entries)',
    defaultValue: true,
  },
  {
    key: 'm_stopMusicFadeTime',
    kind: 'number',
    group: AUDIO,
    help: 'Stop-music fade time',
    defaultValue: 0,
  },
  {
    key: 'm_restartMusicFadeTime',
    kind: 'number',
    group: AUDIO,
    help: 'Restart-music fade time',
    defaultValue: 0,
  },
  {
    key: 'm_meetsRequirements',
    kind: 'boolean',
    group: UI,
    help: 'Internal flag, usually true (true in 1670 entries)',
    defaultValue: true,
  },
  {
    key: 'm_secondaryCameraInitalDelay',
    kind: 'number',
    group: CAMERA,
    help: 'Secondary camera initial delay (the corpus’s own spelling is "Inital" — do not correct it)',
    defaultValue: 0,
  },
  {
    key: 'm_displayButtonsOnTimedDialog',
    kind: 'boolean',
    group: TIMING,
    help: 'Show buttons on a timed dialog',
    defaultValue: false,
  },
  {
    key: 'm_defaultDialogAnimation',
    kind: 'raw-object',
    group: ANIM,
    help: SYNTHETIC_FIELD_NOTE,
    synthetic: true,
    corpusAbsent: true,
    defaultValue: null,
  },
];

/** The entry's own tag — the one key that is not an editable field. */
export const ENTRY_TYPE_KEY = '$type';

/** `true` when {@link key} is the entry tag. */
export function isEntryTypeKey(key: string): boolean {
  return key === ENTRY_TYPE_KEY;
}

/** The 65 corpus value keys, in corpus order (declaration order is insertion order). */
export function dialogEntryValueKeys(): string[] {
  return DIALOG_ENTRY_FIELD_SPECS.filter((field) => field.corpusAbsent !== true).map(
    (field) => field.key,
  );
}

/** The value fields of one domain group, in the corpus's own order. */
export function dialogFieldsInGroup(group: DialogFieldGroup): DialogFieldSpec[] {
  return DIALOG_ENTRY_FIELD_SPECS.filter((field) => field.group === group);
}

/** The value fields of one accordion, in the corpus's own order (its groups concatenated). */
export function dialogFieldsInAccordion(accordion: DialogAccordionSpec): DialogFieldSpec[] {
  return DIALOG_ENTRY_FIELD_SPECS.filter((field) => accordion.groups.includes(field.group));
}

/** The field spec for {@link key}, or `undefined`. */
export function dialogFieldSpec(key: string): DialogFieldSpec | undefined {
  return DIALOG_ENTRY_FIELD_SPECS.find((field) => field.key === key);
}

/**
 * Every key this model knows: the entry tag plus the 65 corpus value keys plus the one
 * spec-listed synthetic field. A key outside this set is a legacy key and is disclosed
 * read-only (AC2).
 */
export const KNOWN_ENTRY_KEYS: readonly string[] = [
  ENTRY_TYPE_KEY,
  ...DIALOG_ENTRY_FIELD_SPECS.map((field) => field.key),
];

/* -------------------------------------------------- the measured entry shapes */

/**
 * A new entry's own key order — `$type` first, then every field the corpus carries, skipping
 * the synthetic ones. Derived from the same spec list {@link newDialogEntry} builds from, so
 * "the canonical order" and "the order a new node is written in" cannot drift apart (the unit
 * test asserts the two are equal).
 */
export const DIALOG_ENTRY_KEY_ORDER: readonly string[] = [
  ENTRY_TYPE_KEY,
  ...DIALOG_ENTRY_FIELD_SPECS.filter((field) => field.corpusAbsent !== true).map(
    (field) => field.key,
  ),
];

/**
 * One measured entry key shape: the ordered key list, its measured occurrence count and where
 * the count came from. **The key lists are measurements, not derivations** — the four key sets
 * below are the corpus's own, transcribed rather than computed, because a shape that is
 * *derived* from the full order is a shape that silently follows the full order when the corpus
 * changes.
 */
export interface DialogEntryKeyShape {
  /** Stable name, used in the sweep's counters and in a failure message. */
  name: string;
  /** The keys, in the document's own order. */
  keys: readonly string[];
  /** Occurrences measured at the owner's `f9a1055` baseline (`QuestTemplates/`, 328 files). */
  measuredCount: number;
  /** One provenance example: the file and absolute address the count was taken from. */
  example: string;
  /** What the shape is, in one sentence. */
  note: string;
}

/** The 6 persona-prefix keys the sparse shapes omit. */
const PERSONA_PREFIX_KEYS = [
  'm_personaName',
  'm_nameOverride',
  'm_nameSTKey',
  'm_guiDisplay',
  'm_maxTimeSeconds',
  'm_invisible',
];

/** The 21-key tail the 45-key shape omits (everything after `m_soundEffectFile`). */
const TRUNCATED_TAIL_KEYS = [
  'm_musicFile',
  'm_nonStackableMusic',
  'm_nonRepeatableMusic',
  'm_playMusicAtSFXVolume',
  'm_soundEffectDelay',
  'm_musicDelay',
  'm_musicFadeTime',
  'm_dontReleaseCameraAtExit',
  'm_disableBackButton',
  'm_enableExitButton',
  'm_cameraFadeType',
  'm_cameraFadeTime',
  'm_idleAnimation',
  'm_spamTime',
  'm_playSoundIfSpamming',
  'm_playMusicIfSpamming',
  'm_stopMusicFadeTime',
  'm_restartMusicFadeTime',
  'm_meetsRequirements',
  'm_secondaryCameraInitalDelay',
  'm_displayButtonsOnTimedDialog',
];

/** `order` minus `drop`, preserving `order`. */
function withoutKeys(order: readonly string[], drop: readonly string[]): readonly string[] {
  return order.filter((key) => !drop.includes(key));
}

/**
 * The entry key shapes the p3-08 sweep recognises, measured at the owner's `f9a1055` baseline
 * (1,884 corpus entries) plus the one shape this tool itself writes (the D17 clone).
 *
 * | name | keys | measured |
 * |---|---|---|
 * | `full66` | `$type` + all 65 value keys | 1,868 corpus (was 1,698) |
 * | `noDialogEvent65` | `full66` minus `m_dialogEvent` | 7 corpus — `WC-COMMONS-MAIN-002-*`' `m_goals[0].m_dialogList.m_dialogs[0].m_dialogEntries[11]` |
 * | `sparse60` | `full66` minus the 6 persona-prefix keys | 1 corpus (`WC-TRITON-MAIN-002`), was 2 |
 * | `truncated45` | `full66` minus the 21-key audio/animation tail (persona prefix kept) | 6 corpus (unchanged) |
 * | `sparse58NoType` | `sparse60` minus `$type` and `m_requirements` | 2 corpus — `WC-TRITON-MAIN-004[4]`, `WC-TRITON-MAIN-007[5]`, both added at the merge |
 * | `nullOmitted65` | `full66` minus `m_requirements` | 2 files of the D17 clone (`WC-CYCLOPS-MAIN-002`, `WC-UNICORN-MAIN-004`) — this tool's own `NullValueHandling.Ignore` write, D57(a) |
 *
 * `noDialogEvent65` and `sparse58NoType` are the two shapes the owner's merge introduced (the
 * 322-file baseline had `full66` / `sparse60` / `truncated45` only, 1,706 entries). Both are
 * *subsets* of the keys the field inventory already models — no field is new — which is why the
 * editor needed no new control: what changed is which keys a node omits, and the module's write
 * rule (edit one key, never rebuild) already preserves that.
 */
export const DIALOG_ENTRY_KEY_SHAPES: readonly DialogEntryKeyShape[] = [
  {
    name: 'full66',
    keys: DIALOG_ENTRY_KEY_ORDER,
    measuredCount: 1868,
    example: 'questtemplates_DS-ACAD-C01-001.json m_dialogList.m_dialogs[0].m_dialogEntries[0]',
    note: 'the canonical 66-key order a new entry is written in',
  },
  {
    name: 'noDialogEvent65',
    keys: withoutKeys(DIALOG_ENTRY_KEY_ORDER, ['m_dialogEvent']),
    measuredCount: 7,
    example:
      'questtemplates_WC-COMMONS-MAIN-002-BALANCE.json m_goals[0].m_dialogList.m_dialogs[0].m_dialogEntries[11]',
    note: 'a null-valued m_dialogEvent omitted (the flag the brief names)',
  },
  {
    name: 'sparse60',
    keys: withoutKeys(DIALOG_ENTRY_KEY_ORDER, PERSONA_PREFIX_KEYS),
    measuredCount: 1,
    example: 'questtemplates_WC-TRITON-MAIN-002.json m_dialogList.m_dialogs[0].m_dialogEntries[4]',
    note: 'the persona prefix omitted (was 2 entries on the 322-file corpus)',
  },
  {
    name: 'truncated45',
    keys: withoutKeys(DIALOG_ENTRY_KEY_ORDER, TRUNCATED_TAIL_KEYS),
    measuredCount: 6,
    example: 'questtemplates_WC-UNICORN-SIDE-001.json m_dialogList.m_dialogs[0].m_dialogEntries[0]',
    note: 'the whole audio/animation tail omitted, stopping at m_soundEffectFile (the persona prefix is kept)',
  },
  {
    name: 'sparse58NoType',
    keys: withoutKeys(DIALOG_ENTRY_KEY_ORDER, [
      ...PERSONA_PREFIX_KEYS,
      ENTRY_TYPE_KEY,
      REQUIREMENTS_KEY,
    ]),
    measuredCount: 2,
    example: 'questtemplates_WC-TRITON-MAIN-007.json m_dialogList.m_dialogs[0].m_dialogEntries[5]',
    note: 'the sparse shape with no $type at all and no m_requirements (new at f9a1055)',
  },
  {
    name: 'nullOmitted65',
    keys: withoutKeys(DIALOG_ENTRY_KEY_ORDER, [REQUIREMENTS_KEY]),
    measuredCount: 35,
    example: 'data/test-spiraldb questtemplates_WC-UNICORN-MAIN-004.json (the D17 clone)',
    note: 'this tool’s own null-stripped write (D57a), 35 entries in 2 clone files; never produced by a corpus checkout',
  },
];

/* ------------------------------------------------------------ new nodes */

/** The `$type` literal a new entry carries — from the 3.1 constant table, never re-typed. */
export const ENTRY_TYPE_STRING = TYPE_STRINGS.NPCDialogEntry;

/** The `$type` literal a new list carries. */
export const LIST_TYPE_STRING = TYPE_STRINGS.ActorDialogList;

/** The tag a new group is created with — the corpus's commonest Prep/Completion pair. */
export const DEFAULT_DIALOG_TAG = 'Prep';

/**
 * A brand-new entry in the corpus's canonical 66-key order: `$type` first, then the 65 corpus
 * value fields at their measured defaults. **Synthetic fields are not written** — the corpus
 * carries neither, so adding one would invent a key the corpus's own new-entry shape lacks
 * (and `m_defaultDialogAnimation` is preserved-only anyway). A **new** node gets this order; an
 * existing node is never rebuilt from it (the module header's write rule).
 */
export function newDialogEntry(): Record<string, unknown> {
  const entry: Record<string, unknown> = { [ENTRY_TYPE_KEY]: ENTRY_TYPE_STRING };
  for (const field of DIALOG_ENTRY_FIELD_SPECS) {
    if (field.corpusAbsent === true) {
      continue;
    }
    entry[field.key] = newDialogFieldValue(field);
  }
  return entry;
}

/** The value a new entry gives one field (arrays and objects are fresh per entry). */
function newDialogFieldValue(field: DialogFieldSpec): unknown {
  return Array.isArray(field.defaultValue) ? [...field.defaultValue] : field.defaultValue;
}

/**
 * A brand-new tag group in the corpus's own 6-key order: the tag the caller passes, **one
 * default entry**, and the measured null/false values of the four remaining keys. **No
 * `$type`** — no corpus group carries one (0 of 774).
 *
 * The group starts with one entry rather than an empty `m_dialogEntries` because **0 of the
 * 774 corpus tag groups has an empty entry array** (every group carries at least one), so an
 * empty default would invent a shape the corpus has never had. That is p3-06's recorded rule
 * for the same situation (`addGroupEdits` starts a new group with a child because the corpus
 * never carries an empty `m_requirements`) and D57's fidelity emphasis points the same way: a
 * user who presses *Add Dialog Tag* and saves should not produce a document shape the corpus
 * does not contain. **An existing empty array is never padded** — the reader renders the empty
 * state and only a user action writes.
 */
export function newDialogGroup(tag: string = DEFAULT_DIALOG_TAG): Record<string, unknown> {
  return {
    [DIALOG_TAG_KEY]: tag,
    [DIALOG_ENTRIES_KEY]: [newDialogEntry()],
    [GROUP_MADLIBS_KEY]: null,
    [GROUP_DIALOG_EVENTS_KEY]: null,
    [NO_AGGRO_WHILE_DIALOG_IS_UP_KEY]: false,
    [NO_AGGRO_NO_DELAY_KEY]: false,
  };
}

/** A brand-new `ActorDialogList`: `$type` first, then its one key — the corpus's own order. */
export function newDialogList(groups: readonly unknown[] = []): Record<string, unknown> {
  return { [ENTRY_TYPE_KEY]: LIST_TYPE_STRING, [DIALOGS_KEY]: [...groups] };
}

/* ------------------------------------------------------------ read helpers */

/** `true` for a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `container[key]` — `undefined` for a non-object container. */
export function dialogField(container: unknown, key: string): unknown {
  return isPlainObject(container) ? container[key] : undefined;
}

/** The `$type` of a list/entry value as it stands, or `null` when absent/wrongly typed. */
export function dialogTypeString(value: unknown): string | null {
  const typeString = dialogField(value, ENTRY_TYPE_KEY);
  return typeof typeString === 'string' ? typeString : null;
}

/** The keys present on an entry that this model does not know (AC2). */
export function unmodelledEntryKeys(entry: unknown): string[] {
  if (!isPlainObject(entry)) {
    return [];
  }
  return Object.keys(entry).filter((key) => !KNOWN_ENTRY_KEYS.includes(key));
}

/** The unmodelled keys' values, in the entry's own key order (never invented). */
export function rawEntryFields(entry: unknown): Record<string, unknown> {
  if (!isPlainObject(entry)) {
    return {};
  }
  const wanted = new Set(unmodelledEntryKeys(entry));
  const raw: Record<string, unknown> = {};
  for (const key of Object.keys(entry)) {
    if (wanted.has(key)) {
      raw[key] = entry[key];
    }
  }
  return raw;
}

/** The list's `m_dialogs` array, or `[]` for an absent/wrongly-typed value. */
export function dialogGroups(wrapperValue: unknown): readonly unknown[] {
  const dialogs = dialogField(wrapperValue, DIALOGS_KEY);
  return Array.isArray(dialogs) ? dialogs : [];
}

/** The group's `m_dialogEntries` array, or `[]` for an absent/wrongly-typed value. */
export function dialogGroupEntries(groupValue: unknown): readonly unknown[] {
  const entries = dialogField(groupValue, DIALOG_ENTRIES_KEY);
  return Array.isArray(entries) ? entries : [];
}

/**
 * A group's visible tag word: the tag itself, {@link EMPTY_TAG_LABEL} for the measured `""`,
 * or {@link ABSENT_TAG_LABEL} when the key is absent. Never rewritten — only displayed.
 */
export function dialogTagLabel(value: unknown): string {
  if (!isPlainObject(value) || !Object.prototype.hasOwnProperty.call(value, DIALOG_TAG_KEY)) {
    return ABSENT_TAG_LABEL;
  }
  const tag = value[DIALOG_TAG_KEY];
  if (typeof tag !== 'string') {
    return ABSENT_TAG_LABEL;
  }
  return tag === '' ? EMPTY_TAG_LABEL : tag;
}

/** One field of one entry, addressed by its absolute path. */
export interface DialogEntryFieldView {
  spec: DialogFieldSpec;
  path: DocPath;
  value: unknown;
  /** `true` when the key exists in the document (absent ≠ `null`). */
  present: boolean;
}

/** One entry card: its own document value, its key order and its fields. */
export interface DialogEntryView {
  groupIndex: number;
  /** The card's index inside its own `m_dialogEntries` array. */
  index: number;
  listPath: DocPath;
  path: DocPath;
  /** The **absolute path** used for display and accessible names (unique per card). */
  address: string;
  /** The card's own ordinal word (`Entry 1`) — independent of any editable field. */
  ordinal: string;
  value: unknown;
  /** `false` when the value is not a plain object (the card shows it verbatim). */
  readable: boolean;
  /** The raw `$type` string exactly as the document carries it (never rewritten). */
  typeString: string | null;
  /** The corpus-shaped persona name, when the entry has one, else `null`. */
  personaName: string | null;
  /** Every key the entry actually carries, in its own order — `$type` included. */
  keys: readonly string[];
  /** The model's 65 value fields at this entry's paths, in the corpus's own order. */
  fields: readonly DialogEntryFieldView[];
  /** The keys the model does not know (the raw-fields disclosure's content). */
  unmodelledKeys: readonly string[];
}

/** One tag section: its own value, its tag and its entry cards. */
export interface DialogGroupView {
  index: number;
  listPath: DocPath;
  path: DocPath;
  address: string;
  value: unknown;
  readable: boolean;
  /** The tag as the document holds it (`null` for absent/non-string). */
  tag: string | null;
  /** `true` when the `m_dialogTag` key exists (774/774 corpus groups). */
  tagPresent: boolean;
  /** The displayed tag word ({@link dialogTagLabel}). */
  tagLabel: string;
  /** `true` when `m_dialogEntries` is an array (never empty in the corpus). */
  entriesPresent: boolean;
  /** The group's untouched sibling keys, surfaced read-only by the section. */
  madlibsPresent: boolean;
  madlibs: unknown;
  dialogEvents: unknown;
  entries: readonly DialogEntryView[];
  /** The keys the model does not know (a legacy group key, disclosed). */
  unmodelledKeys: readonly string[];
}

/** A whole list: its `$type`, its tag groups and its empty states. */
export interface DialogListView {
  listPath: DocPath;
  value: unknown;
  /** `false` when the value is not an object (absent or `null`). */
  readable: boolean;
  /** The raw list `$type` exactly as the document carries it (never rewritten). */
  typeString: string | null;
  /** `true` when `m_dialogs` is an array. */
  dialogsPresent: boolean;
  groups: readonly DialogGroupView[];
}

/** The keys a dialog group may carry; anything else is disclosed as unmodelled. */
export const KNOWN_GROUP_KEYS: readonly string[] = [
  DIALOG_TAG_KEY,
  DIALOG_ENTRIES_KEY,
  GROUP_MADLIBS_KEY,
  GROUP_DIALOG_EVENTS_KEY,
  NO_AGGRO_WHILE_DIALOG_IS_UP_KEY,
  NO_AGGRO_NO_DELAY_KEY,
];

/** The keys present on a group that this model does not know. */
export function unmodelledGroupKeys(group: unknown): string[] {
  if (!isPlainObject(group)) {
    return [];
  }
  return Object.keys(group).filter((key) => !KNOWN_GROUP_KEYS.includes(key));
}

/** The 65 value-field views of one entry value at {@link entryPath}. */
export function readEntryFields(entryPath: DocPath, entry: unknown): DialogEntryFieldView[] {
  const readable = isPlainObject(entry);
  return DIALOG_ENTRY_FIELD_SPECS.map((spec) => ({
    spec,
    path: [...entryPath, spec.key],
    value: dialogField(entry, spec.key),
    present: readable && Object.prototype.hasOwnProperty.call(entry, spec.key),
  }));
}

/**
 * The entry card views of one group. Children that are not objects are **kept** in the view
 * ({@link DialogEntryView.readable} is `false`) so nothing is hidden by the renderer.
 */
export function readDialogEntries(
  listPath: DocPath,
  groupIndex: number,
  groupValue: unknown,
): DialogEntryView[] {
  return dialogGroupEntries(groupValue).map((value, entryIndex) => {
    const path = dialogEntryPath(listPath, groupIndex, entryIndex);
    const readable = isPlainObject(value);
    const persona = dialogField(value, 'm_personaName');
    return {
      groupIndex,
      index: entryIndex,
      listPath,
      path,
      address: formatDocPath(path),
      ordinal: `Entry ${entryIndex + 1}`,
      value,
      readable,
      typeString: dialogTypeString(value),
      personaName: typeof persona === 'string' && persona !== '' ? persona : null,
      keys: readable ? Object.keys(value) : [],
      fields: readEntryFields(path, value),
      unmodelledKeys: unmodelledEntryKeys(value),
    };
  });
}

/** The tag-group views of an existing list value. */
export function readDialogGroups(listPath: DocPath, wrapperValue: unknown): DialogGroupView[] {
  return dialogGroups(wrapperValue).map((value, index) => {
    const path = dialogGroupPath(listPath, index);
    const tag = dialogField(value, DIALOG_TAG_KEY);
    const entries = dialogField(value, DIALOG_ENTRIES_KEY);
    return {
      index,
      listPath,
      path,
      address: formatDocPath(path),
      value,
      readable: isPlainObject(value),
      tag: typeof tag === 'string' ? tag : null,
      tagPresent:
        isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, DIALOG_TAG_KEY),
      tagLabel: dialogTagLabel(value),
      entriesPresent: Array.isArray(entries),
      madlibsPresent: Array.isArray(dialogField(value, GROUP_MADLIBS_KEY)),
      madlibs: dialogField(value, GROUP_MADLIBS_KEY),
      dialogEvents: dialogField(value, GROUP_DIALOG_EVENTS_KEY),
      entries: readDialogEntries(listPath, index, value),
      unmodelledKeys: unmodelledGroupKeys(value),
    };
  });
}

/** The whole list view (render-only; see the module header). */
export function readDialogList(listPath: DocPath, wrapperValue: unknown): DialogListView {
  return {
    listPath,
    value: wrapperValue,
    readable: isPlainObject(wrapperValue),
    typeString: dialogTypeString(wrapperValue),
    dialogsPresent: Array.isArray(dialogField(wrapperValue, DIALOGS_KEY)),
    groups: readDialogGroups(listPath, wrapperValue),
  };
}

/* --------------------------------------------------------------- selects */

/** The select's value for a document value: the string itself, `''` otherwise. */
export function dialogSelectValue(current: unknown): string {
  return typeof current === 'string' ? current : '';
}

/** One `<option>` of a dialog select. */
export interface DialogSelectOption {
  value: string;
  label: string;
  /** `true` for the document's own value when the listed values do not include it. */
  unlisted: boolean;
}

/**
 * The options a **string** select offers, mirroring `resultSelectOptions`: the listed values,
 * plus a leading unset option when the document has no usable value, or the document's own
 * value appended when the list has never heard of it.
 */
export function dialogSelectOptions(
  current: unknown,
  listed: readonly string[],
): DialogSelectOption[] {
  const options = listed.map((value) => ({ value, label: value, unlisted: false }));
  const raw = dialogSelectValue(current);
  if (raw === '') {
    return [{ value: '', label: DIALOG_SELECT_UNSET_LABEL, unlisted: false }, ...options];
  }
  if (!listed.includes(raw)) {
    return [...options, { value: raw, label: raw, unlisted: true }];
  }
  return options;
}

/** One `<option>` of the numeric select (`m_cameraHidePlayers`). */
export interface DialogNumberOption {
  /** The option's own value; `''` is the unset arm (a `null`/absent value). */
  value: number | '';
  label: string;
  /** `true` for the document's own value when the measured domain does not include it. */
  unlisted: boolean;
}

/**
 * The options a **numeric** select offers (`m_cameraHidePlayers`'s measured four values).
 *
 * A numeric select rather than a text-number input because the spec's own domain ("0=no,
 * 2=yes") is narrower than the corpus's, so the four measured values are offered — and an
 * unlisted numeric value (or `null`) is **appended and stays selected**, never rewritten and
 * never converted to a string. A leading unset option (`''`) represents an absent/`null` value
 * and choosing it deletes the key when it exists (D59(c)).
 */
export function dialogNumberOptions(
  current: unknown,
  listed: readonly number[],
): DialogNumberOption[] {
  const options: DialogNumberOption[] = listed.map((value) => ({
    value,
    label: String(value),
    unlisted: false,
  }));
  if (typeof current !== 'number' || !Number.isFinite(current)) {
    return [{ value: '', label: DIALOG_SELECT_UNSET_LABEL, unlisted: false }, ...options];
  }
  if (!listed.includes(current)) {
    return [...options, { value: current, label: String(current), unlisted: true }];
  }
  return options;
}

/** The numeric select's raw string value for a document value (`''` for an absent one). */
export function dialogNumberSelectValue(current: unknown): string {
  return typeof current === 'number' && Number.isFinite(current) ? String(current) : '';
}

/* ----------------------------------------------------- string-list text */

/**
 * The string-list control's text: one element per line, **verbatim**. A non-array value
 * renders as the scalar text (so a wrong type is visible rather than lost), and `null`/absent
 * render empty.
 */
export function stringListToText(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((element) => (typeof element === 'string' ? element : JSON.stringify(element)))
      .join('\n');
  }
  return dialogScalarText(value);
}

/**
 * {@link stringListToText} inverted: one line per element, keeping the order and the exact
 * spelling. A single trailing newline (the textarea's own habit) adds no element; an entirely
 * empty text yields `[]` — the corpus's measured "unused" value — and never an empty-string
 * element (measured: 0 of 572 corpus elements is empty and 0 contains a newline, so this is
 * lossless for every corpus value).
 */
export function parseStringListText(raw: string): string[] {
  if (raw === '') {
    return [];
  }
  const lines = raw.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/* ---------------------------------------------------------- edit builders */

/**
 * Adding a tag group to the list at {@link listPath}, in the list's `$type`-preserving shape.
 *
 * Three shapes, mirroring `addResultEdits`: the `m_dialogs` array exists → one `insert` (the
 * corpus's own case, 797/797, was 767); the wrapper exists without an array → one `set` of `m_dialogs`;
 * the wrapper is absent **or `null`** (327 corpus goals) → one `set` of the whole list, and
 * because the parent of `m_dialogList` is the goal object that `set` is legal — it writes the
 * corpus's own `{$type, m_dialogs}` shape and never invents a `$type`.
 */
export function addDialogTagEdits(
  listPath: DocPath,
  index: number,
  presence: { list: boolean; dialogs: boolean },
  tag: string = DEFAULT_DIALOG_TAG,
): DocEdit[] {
  const group = newDialogGroup(tag);
  if (presence.dialogs) {
    return [{ op: 'insert', path: dialogGroupsPath(listPath), index, value: group }];
  }
  if (presence.list) {
    return [{ op: 'set', path: dialogGroupsPath(listPath), value: [group] }];
  }
  return [{ op: 'set', path: listPath, value: newDialogList([group]) }];
}

/**
 * Adding an entry to the tag group at {@link groupIndex}.
 *
 * The group always exists (its own key is the anchor), so there are two shapes: `m_dialogEntries`
 * is an array → one `insert`; it is absent or `null` → one `set` of that one key. Either way
 * exactly one group key is written and no `$type` is invented.
 */
export function addDialogEntryEdits(
  listPath: DocPath,
  groupIndex: number,
  index: number,
  presence: { entries: boolean },
): DocEdit[] {
  const entry = newDialogEntry();
  if (presence.entries) {
    return [{ op: 'insert', path: dialogEntriesPath(listPath, groupIndex), index, value: entry }];
  }
  return [{ op: 'set', path: dialogEntriesPath(listPath, groupIndex), value: [entry] }];
}

/**
 * Duplicating the entry at {@link entryIndex} immediately after itself: one `insert` of a
 * **deep copy**, so the copy keeps the original's `$type`, key order, explicit `null`s,
 * unmodelled keys **and its missing keys** (a duplicated sparse entry is still sparse) while
 * being an independent value afterwards. A value that is not a plain object has nothing to
 * duplicate and produces no edit.
 */
export function duplicateEntryEdits(
  listPath: DocPath,
  groupIndex: number,
  entryIndex: number,
  entry: unknown,
): DocEdit[] {
  if (!isPlainObject(entry)) {
    return [];
  }
  return [
    {
      op: 'insert',
      path: dialogEntriesPath(listPath, groupIndex),
      index: entryIndex + 1,
      value: JSON.parse(JSON.stringify(entry)) as unknown,
    },
  ];
}

/**
 * Deleting the entry at {@link entryIndex}: one `delete` of exactly that array element.
 * Because a delete shifts the later indices of its own array, the caller applies it on its own.
 */
export function deleteEntryEdits(
  listPath: DocPath,
  groupIndex: number,
  entryIndex: number,
): DocEdit[] {
  return [{ op: 'delete', path: dialogEntryPath(listPath, groupIndex, entryIndex) }];
}

/**
 * The tag edit. This is the **one text control that writes an empty string instead of
 * deleting the key** (see the module header): the tag is a required key of the uniform 6-key
 * group order (774/774), the corpus carries 5 explicit `""` tags, and deleting the key would
 * both drop it from that order and destroy real content. The value is written verbatim — never
 * trimmed, never matched against a list.
 */
export function setDialogTagEdit(listPath: DocPath, groupIndex: number, tag: string): DocEdit {
  return { op: 'set', path: dialogTagPath(listPath, groupIndex), value: tag };
}

/**
 * The edit a text-like control (text input, string-key input) produces on `key` of the entry
 * at `(groupIndex, entryIndex)`. Emptying the control deletes the key when it exists and
 * produces **no** edit when it does not (D59(c)) — so clearing an already-absent field can
 * never create one.
 */
export function setEntryTextFieldEdit(
  listPath: DocPath,
  groupIndex: number,
  entryIndex: number,
  key: string,
  present: boolean,
  raw: string,
): DocEdit | null {
  if (raw === '') {
    return present
      ? { op: 'delete', path: dialogEntryFieldPath(listPath, groupIndex, entryIndex, key) }
      : null;
  }
  return {
    op: 'set',
    path: dialogEntryFieldPath(listPath, groupIndex, entryIndex, key),
    value: raw,
  };
}

/**
 * The edit a number input produces. `''` behaves like {@link setEntryTextFieldEdit}; a
 * non-finite intermediate (`1e`, `-`) produces no edit rather than a `NaN` in the document,
 * and the parsed number is written exactly as parsed — no rounding (D57: validate, never
 * normalise).
 */
export function setEntryNumberFieldEdit(
  listPath: DocPath,
  groupIndex: number,
  entryIndex: number,
  key: string,
  present: boolean,
  raw: string,
): DocEdit | null {
  if (raw.trim() === '') {
    return present
      ? { op: 'delete', path: dialogEntryFieldPath(listPath, groupIndex, entryIndex, key) }
      : null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return null;
  }
  return { op: 'set', path: dialogEntryFieldPath(listPath, groupIndex, entryIndex, key), value };
}

/**
 * The edit a checkbox produces. A checkbox can only express `true`/`false`, and the caller
 * invokes this only when the user toggles it — an absent or `null` value renders unchecked and
 * stays untouched until then (never written as `''`).
 */
export function setEntryBooleanFieldEdit(
  listPath: DocPath,
  groupIndex: number,
  entryIndex: number,
  key: string,
  checked: boolean,
): DocEdit {
  return {
    op: 'set',
    path: dialogEntryFieldPath(listPath, groupIndex, entryIndex, key),
    value: checked,
  };
}

/**
 * The edit the numeric select produces (`m_cameraHidePlayers`): the chosen value as a
 * **number**. The unset arm deletes the key when it exists and does nothing when it does not
 * (D59(c)) — `null` is never converted to a `0`, and an unlisted value is never rewritten by
 * merely rendering.
 */
export function setEntryNumberSelectEdit(
  listPath: DocPath,
  groupIndex: number,
  entryIndex: number,
  key: string,
  present: boolean,
  raw: string,
): DocEdit | null {
  const path = dialogEntryFieldPath(listPath, groupIndex, entryIndex, key);
  if (raw === '') {
    return present ? { op: 'delete', path } : null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return null;
  }
  return { op: 'set', path, value };
}

/**
 * The edit a friendly-name dropdown produces on an entry's ID field: the **raw id**
 * (AGENTS.md rule 5) written as the field's own JSON type — a number for a template id
 * (`m_actorTemplateID`, `m_walkAwayNpcTemplateID`), the string itself for a zone path.
 *
 * Clearing the control (`''`, the dropdown's "None") deletes the key when it exists and
 * produces no edit when it does not; a numeric id that is not finite produces no edit rather
 * than a `NaN`. An unresolved id is never rewritten: `0` (330 corpus entries), an unlisted
 * zone path (14 of 87) and a value no table knows all round-trip unchanged.
 */
export function setEntryIdFieldEdit(
  listPath: DocPath,
  groupIndex: number,
  entryIndex: number,
  field: DialogFieldSpec,
  present: boolean,
  rawId: string,
): DocEdit | null {
  const path = dialogEntryFieldPath(listPath, groupIndex, entryIndex, field.key);
  if (rawId === '') {
    return present ? { op: 'delete', path } : null;
  }
  if (field.idValueType === 'number') {
    const value = Number(rawId);
    if (!Number.isFinite(value)) {
      return null;
    }
    return { op: 'set', path, value };
  }
  return { op: 'set', path, value: rawId };
}

/**
 * The edit the string-list control produces. The text is parsed line-per-element (verbatim)
 * and written as an **array**, never as a scalar; `[]` is a legitimate value and is written
 * rather than deleted when the key exists, while an emptied control on an **absent** key
 * produces no edit (the D59(c) rule: no key is created by clearing).
 */
export function setEntryStringListEdit(
  listPath: DocPath,
  groupIndex: number,
  entryIndex: number,
  key: string,
  present: boolean,
  raw: string,
): DocEdit | null {
  if (raw === '' && !present) {
    return null;
  }
  return {
    op: 'set',
    path: dialogEntryFieldPath(listPath, groupIndex, entryIndex, key),
    value: parseStringListText(raw),
  };
}

/* -------------------------------------------------------------- display */

/** A scalar document value as text — `null`/absent render empty (p3-03's rule). */
export function dialogScalarText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * What a string-key field's resolved-text line shows: the string table's value on a hit, the
 * raw key verbatim on a miss (docs/spec-domain-reference.md L693-694), and nothing at all for
 * an absent key or the empty string. `formatNameValue` already implements the miss rule, so
 * this is the same lookup shape the Info tab's title uses — not a second one.
 */
export function stringKeyDisplay(key: unknown, row: NameRowMap['strings'] | undefined): string {
  if (typeof key !== 'string' || key === '') {
    return '';
  }
  return formatNameValue('strings', key, row);
}
