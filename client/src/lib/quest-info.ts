/**
 * The Info tab's field model and every pure rule behind it (plan task 3.3, story
 * p3-03; docs/spec-ui-design.md L296-298, docs/spec-domain-reference.md L240-279).
 *
 * The two-column form is **data, not JSX**: {@link QUEST_VISIBLE_FIELDS} is the
 * spec's own list (left column then right column) and {@link QUEST_ADVANCED_FIELDS}
 * is the collapsible section. Keeping the inventory here — next to
 * {@link QUEST_TOP_LEVEL_KEYS}, the corpus-measured list of all 36 top-level keys —
 * is what makes "none dropped" a checkable property instead of a promise: a unit
 * test walks both arrays and asserts their union plus {@link QUEST_OTHER_TAB_KEYS}
 * is exactly the 36 keys.
 *
 * Three rules here are decisions this story had to make, each recorded in the
 * story report:
 *
 * 1. **Emptying an editable field deletes its key** ({@link textFieldEdit},
 *    {@link numberFieldEdit}, {@link clientTagsEdit}) rather than writing `''` or
 *    `undefined`. D57b's contract is that validation never normalises, and D5's
 *    merge model expresses "this field is gone" with a delete — writing `''` into
 *    `m_questLevel` (an `int`) or `m_mainline` (a `bool`) would be type corruption,
 *    and writing `undefined` is not a value JSON can carry.
 * 2. **A miss leaves the raw key on screen** ({@link questTitleDisplay}), verbatim
 *    (docs/spec-domain-reference.md L693-694), and the empty string is **never
 *    looked up** ({@link shouldLookupStringKey}). The second half is not cosmetic:
 *    `GET /api/names/strings/` (an empty id) falls through to the LIST route and
 *    answers **24,077,358 bytes** — measured 2026-09-26 against a read-only copy of
 *    the live database.
 * 3. **A `m_activityType` outside the six known values stays selectable and
 *    selected** ({@link activityTypeOptions}). The specs document no enumeration at
 *    all; the six values are Imcodec's generated `ActivityType` enum, so a value the
 *    enum has never heard of is real content the form may not rewrite. The corpus
 *    today is `ACTIVITY_NotActivity` in 322/322 files, so this arm is speculative —
 *    but silently snapping it to a listed option would corrupt content, and the
 *    other direction (dropping it) would hide it.
 */

import type { DocEdit } from '@shared/document';

import { formatNameValue, type NameRowMap } from './display';

/* ------------------------------------------------------- the field inventory */

/** How one Info-tab field renders, and what an edit of it means. */
export type QuestFieldKind = 'readonly' | 'text' | 'number' | 'boolean' | 'select' | 'tags';

/** The two columns of `docs/spec-ui-design.md` L296-298. */
export type QuestFieldColumn = 'left' | 'right';

/** One editable (or read-only) top-level field of the Info tab. */
export interface QuestFieldSpec {
  /** The top-level document key this field owns. */
  key: string;
  kind: QuestFieldKind;
  column: QuestFieldColumn;
  /**
   * The one-line explanation under the control — `docs/spec-domain-reference.md`'s
   * own Description column (L240-279), or `''` where the table has none. Nothing
   * here is invented domain wording.
   */
  help: string;
}

/**
 * The spec's left-then-right list (L296-298), verbatim and in order.
 *
 * `m_questTitle` is a **text edit of the string-table key** with the resolved title
 * rendered beside it: the spec calls it "string table lookup display" without
 * calling it read-only (only `m_questName` is), and leaving the key uneditable
 * would make it the one field of the 36 no part of this phase could ever change.
 */
export const QUEST_VISIBLE_FIELDS: readonly QuestFieldSpec[] = [
  {
    key: 'm_questName',
    kind: 'readonly',
    column: 'left',
    help: 'Unique quest identifier',
  },
  {
    key: 'm_questTitle',
    kind: 'text',
    column: 'left',
    help: 'String table key for quest title',
  },
  {
    key: 'm_questLevel',
    kind: 'number',
    column: 'left',
    help: 'Suggested level',
  },
  {
    key: 'm_mainline',
    kind: 'boolean',
    column: 'left',
    help: 'Mainline story quest',
  },
  {
    key: 'm_isHidden',
    kind: 'boolean',
    column: 'left',
    help: 'Hidden from quest log',
  },
  {
    key: 'm_questRepeat',
    kind: 'number',
    column: 'left',
    help: 'Repeatability flag (0 = not repeatable)',
  },
  {
    key: 'm_activityType',
    kind: 'select',
    column: 'left',
    help: 'Activity classification',
  },
  {
    key: 'm_onStartQuestScript',
    kind: 'text',
    column: 'right',
    help: '',
  },
  {
    key: 'm_onEndQuestScript',
    kind: 'text',
    column: 'right',
    help: '',
  },
  {
    key: 'm_clientTags',
    kind: 'tags',
    column: 'right',
    help: 'Tags for client UI filtering',
  },
];

/**
 * The collapsible "Advanced" section: every remaining top-level **scalar** the
 * spec's field table names and the Info tab's two columns do not already show
 * (plan §3.3). Twelve keys — 7 booleans, 4 optional strings and one uint.
 *
 * Everything here is editable. A key the document does not carry renders empty and
 * is only written when the user actually edits it, so opening the section can never
 * inject a field (D57).
 */
export const QUEST_ADVANCED_FIELDS: readonly QuestFieldSpec[] = [
  { key: 'm_questNameID', kind: 'number', column: 'left', help: 'Hashed quest name ID (can be 0)' },
  {
    key: 'm_questInfo',
    kind: 'text',
    column: 'left',
    help: 'String table key for quest info text',
  },
  { key: 'm_questPrep', kind: 'text', column: 'left', help: 'Pre-acceptance description' },
  { key: 'm_questUnderway', kind: 'text', column: 'left', help: 'In-progress description' },
  { key: 'm_questComplete', kind: 'text', column: 'left', help: 'Completion text' },
  { key: 'm_noQuestHelper', kind: 'boolean', column: 'left', help: 'Disables quest helper arrow' },
  { key: 'm_prepAlways', kind: 'boolean', column: 'left', help: 'Always show prep dialog' },
  { key: 'm_forceInteraction', kind: 'boolean', column: 'left', help: 'Forces interaction prompt' },
  {
    key: 'm_checkInventoryForCrafting',
    kind: 'boolean',
    column: 'right',
    help: 'Checks inventory for crafting goals',
  },
  { key: 'm_playAsYourPetNPC', kind: 'boolean', column: 'right', help: 'Pet-play mode flag' },
  { key: 'm_outdated', kind: 'boolean', column: 'right', help: 'Marks quest as deprecated' },
  {
    key: 'm_skipQHAutoSelect',
    kind: 'boolean',
    column: 'right',
    help: 'Skips auto quest helper selection',
  },
];

/**
 * The non-scalar top-level keys this tab deliberately does **not** touch: each is a
 * goal/result/requirement/dialog structure owned by another tab's editor (plan
 * §3.4-§3.8). They are listed so the "none dropped" property is checkable and so a
 * reader can see, in one place, what the Info tab is *not* claiming.
 *
 * `owner` is the tab whose task names the key; `null` means **no Phase-3 task names
 * an editor for it** — those five object-typed fields survive every mutation through
 * D5's merge model but are not editable anywhere in this phase (recorded in the
 * story report as a plan gap, not as a property of this story).
 */
export interface QuestOtherTabField {
  key: string;
  owner: 'Goals' | 'Goal Logic' | 'Requirements' | 'Results' | 'Dialog' | null;
}

export const QUEST_OTHER_TAB_FIELDS: readonly QuestOtherTabField[] = [
  { key: 'm_startGoals', owner: 'Goals' },
  { key: 'm_goals', owner: 'Goals' },
  { key: 'm_startResults', owner: 'Results' },
  { key: 'm_endResults', owner: 'Results' },
  { key: 'm_requirements', owner: 'Requirements' },
  { key: 'm_prepRequirements', owner: 'Requirements' },
  { key: 'm_pruneRequirements', owner: 'Requirements' },
  { key: 'm_goalLogic', owner: 'Goal Logic' },
  { key: 'm_dialogList', owner: 'Dialog' },
  { key: 'm_missionDoors', owner: null },
  { key: 'm_dynaMods', owner: null },
  { key: 'm_defaultDialogAnimation', owner: null },
  { key: 'm_questEffectInfoList', owner: null },
  { key: 'm_behaviors', owner: null },
];

/**
 * All **36** top-level keys of a QuestTemplate, in the spec field table's own order
 * (docs/spec-domain-reference.md L240-279), corpus-measured: all 322 files carry
 * exactly these 36 and no others (2026-09-26).
 *
 * The union of {@link QUEST_VISIBLE_FIELDS}, {@link QUEST_ADVANCED_FIELDS} and
 * {@link QUEST_OTHER_TAB_FIELDS} is asserted to be exactly this set — no key missing,
 * none duplicated, none invented — by `tests/unit/quest-info.test.ts`; that is the
 * "none dropped" proof. The three groups are ordered as the *view* reads (the spec's
 * two columns, then Advanced, then the other tabs), so their concatenation is
 * deliberately **not** this corpus order.
 */
export const QUEST_TOP_LEVEL_KEYS: readonly string[] = [
  'm_questName',
  'm_questNameID',
  'm_questTitle',
  'm_questInfo',
  'm_questPrep',
  'm_questUnderway',
  'm_questComplete',
  'm_startGoals',
  'm_goals',
  'm_startResults',
  'm_endResults',
  'm_requirements',
  'm_prepRequirements',
  'm_pruneRequirements',
  'm_goalLogic',
  'm_questLevel',
  'm_questRepeat',
  'm_onStartQuestScript',
  'm_onEndQuestScript',
  'm_dialogList',
  'm_isHidden',
  'm_mainline',
  'm_noQuestHelper',
  'm_clientTags',
  'm_activityType',
  'm_prepAlways',
  'm_forceInteraction',
  'm_checkInventoryForCrafting',
  'm_playAsYourPetNPC',
  'm_missionDoors',
  'm_dynaMods',
  'm_outdated',
  'm_defaultDialogAnimation',
  'm_skipQHAutoSelect',
  'm_questEffectInfoList',
  'm_behaviors',
];

/* --------------------------------------------------------------- the fields */

/** The read-only timestamp label — the spec's "timestamps (read-only)", L298. */
export const QUEST_TIMESTAMP_LABEL = 'Modified';

/* ------------------------------------------------------------- string tables */

/**
 * `true` when a key is worth one `GET /api/names/strings/:key` read.
 *
 * The guard is load-bearing, not defensive: the empty string URL
 * (`/api/names/strings/`) falls through Express's `/:type/:id` match to the LIST
 * route and answers the whole 216,991-row table — measured 24,077,358 bytes,
 * 2026-09-26. A quest with `m_questTitle: ""` (7 corpus files today, e.g.
 * `Tutorial_Intro`) must therefore render an empty title with **no request at all**,
 * and the raw-key fallback must cover it without inventing `undefined`/`null`.
 */
export function shouldLookupStringKey(key: unknown): key is string {
  return typeof key === 'string' && key !== '';
}

/**
 * What the title display shows: the resolved string on a hit, the raw key verbatim
 * on a miss (docs/spec-domain-reference.md L693-694), and nothing at all for an
 * absent key or the empty string.
 *
 * `formatNameValue` already implements the miss rule — it falls back to the raw id
 * when the row is `undefined` — so this is the same lookup shape
 * `FriendlyNameDropdown` uses, not a second one.
 */
export function questTitleDisplay(key: unknown, row: NameRowMap['strings'] | undefined): string {
  if (!shouldLookupStringKey(key)) {
    return '';
  }
  return formatNameValue('strings', key, row);
}

/* ------------------------------------------------------------ activity types */

/**
 * Imcodec's generated `ActivityType` enum, in ordinal order
 * (`Imlight/.../ActivityType.g.cs`, read-only sibling). The specs document no
 * enumeration — `docs/spec-domain-reference.md` L264 says only "string" — so this
 * is the authoritative source.
 */
export const ACTIVITY_TYPES = [
  'ACTIVITY_NotActivity',
  'ACTIVITY_Spell',
  'ACTIVITY_Crafting',
  'ACTIVITY_Fishing',
  'ACTIVITY_Gardening',
  'ACTIVITY_Pet',
] as const;

/** Label of the no-value option (the document carries no usable activity type). */
export const ACTIVITY_TYPE_UNSET_LABEL = '—';

/** `ACTIVITY_NotActivity` → `Not Activity`: the enum's own name, spaced. */
export function activityTypeLabel(value: string): string {
  return value
    .replace(/^ACTIVITY_/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
}

/** One `<option>` of the activity select. */
export interface ActivityTypeOption {
  value: string;
  label: string;
  /** `true` for the document's own value when the six known values do not include it. */
  unlisted: boolean;
}

/**
 * The select's value for a document value: the value itself whenever it is a
 * non-empty string, `''` otherwise — never a rewrite.
 */
export function activityTypeSelectValue(current: unknown): string {
  return typeof current === 'string' && current !== '' ? current : '';
}

/**
 * The options the select offers: the six enum values, plus (a) the document's own
 * value when it is not among them, so real content stays visible and selected, or
 * (b) a leading unset option when the document has no usable value.
 */
export function activityTypeOptions(current: unknown): ActivityTypeOption[] {
  const listed: ActivityTypeOption[] = ACTIVITY_TYPES.map((value) => ({
    value,
    label: activityTypeLabel(value),
    unlisted: false,
  }));
  const raw = activityTypeSelectValue(current);
  if (raw === '') {
    return [{ value: '', label: ACTIVITY_TYPE_UNSET_LABEL, unlisted: false }, ...listed];
  }
  if (!(ACTIVITY_TYPES as readonly string[]).includes(raw)) {
    return [...listed, { value: raw, label: raw, unlisted: true }];
  }
  return listed;
}

/* ------------------------------------------------------------- client tags */

/**
 * A `m_clientTags` value as the tag input's text: `null`/absent render empty, an
 * array joins with `", "`. Never invents a tag (the corpus carries `m_clientTags:
 * null` in all 322 files, so a quest with no tags shows an empty input).
 */
export function clientTagsToText(value: unknown): string {
  if (!Array.isArray(value)) {
    return '';
  }
  return value.map((tag) => String(tag)).join(', ');
}

/**
 * The tag input's text as tags: comma-separated, trimmed, empty pieces dropped, in
 * order and **without** deduplicating or sorting (that would be normalisation).
 */
export function parseClientTags(text: string): string[] {
  return text
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
}

/**
 * The edit an emptied or filled tag input produces (see the module header's rule 1):
 * a delete when the text is empty and the key is there, `null` when the text is
 * empty and the key is not (nothing to do), otherwise a set of the parsed array.
 */
export function clientTagsEdit(path: string, present: boolean, text: string): DocEdit | null {
  if (text.trim() === '') {
    return present ? { op: 'delete', path: [path] } : null;
  }
  return { op: 'set', path: [path], value: parseClientTags(text) };
}

/* ------------------------------------------------------------- scalar edits */

/**
 * The edit a text-like control produces (text input, or the activity select — both
 * carry a raw string). Emptying the control deletes the key when it exists.
 */
export function textFieldEdit(path: string, present: boolean, raw: string): DocEdit | null {
  if (raw === '') {
    return present ? { op: 'delete', path: [path] } : null;
  }
  return { op: 'set', path: [path], value: raw };
}

/**
 * The edit a number input produces. `''` behaves like {@link textFieldEdit};
 * a value that is not a finite number (the browser hands through things like `1e`
 * and `-` while typing) produces **no** edit rather than a `NaN` in the document.
 * The parsed number is written exactly as parsed — no rounding, no truncation
 * (D57: validate, never normalise).
 */
export function numberFieldEdit(path: string, present: boolean, raw: string): DocEdit | null {
  if (raw.trim() === '') {
    return present ? { op: 'delete', path: [path] } : null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return null;
  }
  return { op: 'set', path: [path], value };
}

/**
 * The edit a checkbox produces. A checkbox can only express `true`/`false`, and it
 * only calls this when the user actually toggles it — an absent or `null` value
 * renders unchecked and stays untouched until then (never an injected default).
 */
export function booleanFieldEdit(path: string, checked: boolean): DocEdit {
  return { op: 'set', path: [path], value: checked };
}
