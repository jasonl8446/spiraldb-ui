import { TYPE_STRINGS } from './typeConstants.js';

/**
 * Scaffold-from-catalog — the minimal valid `QuestTemplate` skeleton (plan task 6.8 /
 * story **p6-09**; decisions **D100** (a scaffold is a real file, no draft lifecycle)
 * and **D101** (a minimal skeleton, nothing inferred ever written), criterion p6-09-ac2).
 *
 * This module is the **single home of the corpus key order** and of the skeleton's
 * values. It is deliberately pure and dependency-free beyond the schemas: the server's
 * scaffold service writes what it returns, the CLI and the tests read it, and nothing
 * here touches a database or a filesystem.
 *
 * ## The key order is the corpus's own, and it is NOT the schema's declaration order
 *
 * The corpus (the frozen D17 clone, 322 `QuestTemplates/*.json`) carries **two** key
 * orders. **320 files share the canonical 36-key order** below; the other two
 * (`WC-CYCLOPS-MAIN-002`, `WC-UNICORN-MAIN-004`) carry **18 keys** and are the
 * extractor's own sparse output rather than the corpus's shape — they are the reason
 * ac2 says "all 36 keys ... with explicit nulls", and a scaffold validated against one
 * of them would be validated against the wrong thing.
 *
 * The order is reproducible with `node scripts/quest-corpus-census.mjs`, which prints
 * the census, the per-key value profile and the two deviating files.
 *
 * **Why a constant here and not `QUEST_TEMPLATE_FIELDS`:** that export is
 * `Object.keys(QuestTemplateSchema.shape)` — the *spec field table's* order, which the
 * Client's `QUEST_TOP_LEVEL_KEYS` (`client/src/lib/quest-info.ts`) also follows. The two
 * genuinely differ: the spec puts `m_goalLogic`/`m_questLevel`/… straight after
 * `m_pruneRequirements` and `m_activityType` near the end, while the corpus puts
 * `m_prepAlways`, `m_clientTags` and then `m_goalLogic`, and closes with
 * `m_activityType, m_behaviors`. Serialization follows insertion order, so writing the
 * spec's order would give every scaffolded file a key order no corpus file has.
 * `tests/unit/quest-scaffold.test.ts` asserts both facts — the order below is the
 * corpus's, and it is **not** equal to `QUEST_TEMPLATE_FIELDS` — so the two can never
 * silently converge.
 */
export const QUEST_TEMPLATE_CORPUS_ORDER: readonly string[] = [
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
  'm_prepAlways',
  'm_clientTags',
  'm_goalLogic',
  'm_questLevel',
  'm_questRepeat',
  'm_onStartQuestScript',
  'm_onEndQuestScript',
  'm_dialogList',
  'm_missionDoors',
  'm_dynaMods',
  'm_isHidden',
  'm_outdated',
  'm_noQuestHelper',
  'm_mainline',
  'm_defaultDialogAnimation',
  'm_skipQHAutoSelect',
  'm_questEffectInfoList',
  'm_forceInteraction',
  'm_checkInventoryForCrafting',
  'm_playAsYourPetNPC',
  'm_activityType',
  'm_behaviors',
];

/**
 * The catalog link a scaffold was created from — `quests.link_kind`'s own enum, plus the
 * string-table key that link resolved to when there is one.
 */
export type QuestScaffoldLinkKind = 'direct' | 'inferred' | 'none';

export interface QuestScaffoldLink {
  kind: QuestScaffoldLinkKind;
  /**
   * The `QuestTitle_*` string-table key the direct link resolved to, when the catalog
   * could resolve exactly one. Ignored for `inferred`/`none` — **an inferred title is
   * never written** (D106/P6-6), and neither is a key the catalog could not pin down.
   */
  titleKey?: string | null;
}

export interface QuestScaffoldInput {
  /** The catalog quest name — the file's `m_questName` and its key. */
  name: string;
  link: QuestScaffoldLink;
}

/**
 * The skeleton's value for the two `m_*QuestScript` slots. `""`, not `null`: the corpus
 * fills both with the empty string in **320 of 320** canonical files, and the three
 * files the corpus itself contains for "a quest with nothing authored yet"
 * (`WC-TUT-C03-002`, `-C09-014`, `-C09-016`) carry `""` too.
 */
const EMPTY_SCRIPT = '';

/**
 * The empty `ActorDialogList` wrapper.
 *
 * The nested `$type` is **not** decoration and this is measured, not inferred: the
 * generated `QuestTemplate.m_dialogList` property is typed `ActorDialogListBase`, and
 * Imlight deserializes with `TypeNameHandling.Auto`. A probe against the real
 * `Imcodec.ObjectProperty` assembly (`data/__test-scratch__/p6-09-loadprobe`) shows that
 * without the annotation Json.NET binds the wrapper to `ActorDialogListBase`, **which
 * has no `m_dialogs` member** — a non-empty list then loads with its dialogs silently
 * dropped. All 320 canonical corpus files carry the annotation, so the scaffold does.
 *
 * The **top-level** document has no `$type`: 322 of 322 corpus quest files carry none,
 * and the schema declares none. The two rules are deliberately separate — a nested
 * polymorphic member needs its annotation, the root object does not.
 */
function emptyDialogList(): Record<string, unknown> {
  return {
    $type: TYPE_STRINGS.ActorDialogList,
    m_dialogs: [],
  };
}

/** `{ m_results: [] }` — the corpus's empty result list (no `$type`; see `results.ts`). */
function emptyResultList(): Record<string, unknown> {
  return { m_results: [] };
}

/**
 * Builds the scaffold document: **36 keys in corpus order**, the name, the linked title
 * only for a direct link, and empty goals/results/dialog (D101).
 *
 * The value profile is the corpus's own minimal-file profile, measured from
 * `WC-TUT-C03-002` (the corpus's own "nothing authored yet" file) and the 320-file
 * canonical census:
 *
 * | group | keys | value | why |
 * |---|---|---|---|
 * | the name | `m_questName` | the catalog name | the file's identity |
 * | the ticked title | `m_questTitle` | the linked key, **only** for a direct link; else `null` | ac2 / D101 / D106 |
 * | the id | `m_questNameID` | `0` | corpus 322/322; see below |
 * | value types the corpus never nulls | `m_questLevel`, `m_questRepeat`, the 9 flags, `m_activityType` | `0` / `false` / `"ACTIVITY_NotActivity"` | corpus unanimity |
 * | the two scripts | `m_onStartQuestScript`, `m_onEndQuestScript` | `""` | corpus 320/320 |
 * | the empty containers | `m_startGoals`, `m_goals`, `m_goalLogic` | `[]` | every zero-goal corpus file |
 * | | `m_startResults`, `m_endResults` | `{m_results: []}` | 319/320 and the 6 empty ones |
 * | | `m_dialogList` | `{$type, m_dialogs: []}` | the 7 empty corpus lists, 7/7 annotated |
 * | every key the corpus carries as null | the remaining 13 | `null` (explicit, never absent) | corpus 320/320 (12 of them) |
 *
 * **`m_questNameID: 0`, stated plainly because the criterion names it.** The corpus is
 * unanimous: **322 of 322** quest files carry `0`, never the quest's numeric id — the id
 * lives in the `m_questTitle` key (`QuestTitle_1ED8D` → 0x1ED8D), which is how Imlight's
 * own loader reaches the quest's text. The catalog *does* know the linked id
 * (`quest_ids.quest_id`), and writing it here would produce the only file in the corpus
 * with a non-zero value — a scaffold-only artefact of the same class as a top-level
 * `$type`. Nothing inferred is written anywhere in this document, and the id side is not
 * written at all: the file's own title key carries it.
 *
 * **"Explicit nulls" (ac2) is satisfied, and the nulls are exactly the corpus's own.**
 * The 13 keys above plus `m_questTitle` on a non-direct link are `null` — never absent
 * (D57; the two sparse corpus files are the counterexample ac2 is written against). The
 * other keys are **not** null because the corpus never leaves one null in 322 files; a
 * literal null in, say, `m_questNameID` would still *load* — Imlight deserializes with
 * `NullValueHandling.Ignore`, so a null is skipped and the CLR default (`0`, `false`,
 * `ACTIVITY_NotActivity`) is kept, which the probe above measures on the real assembly —
 * but it would be a byte shape no corpus file has, and byte fidelity to the corpus is
 * what keeps every future diff and round-trip audit meaningful. The plan's phrase "all
 * 36 keys ... with explicit nulls" is therefore read as "all 36 keys present, with an
 * explicit `null` wherever the corpus has one" and that reading is reported to the lead.
 *
 * @throws {RangeError} when the name is empty — a scaffold without a name is not a file.
 */
export function buildQuestScaffold(input: QuestScaffoldInput): Record<string, unknown> {
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    throw new RangeError('Cannot scaffold a quest without a name.');
  }

  // The title: the linked key for a direct link, else an explicit null. An inferred link
  // never writes one (D106/P6-6), and neither does a direct link the catalog could not
  // resolve to exactly one key — a guess between two keys that share the same text is
  // still a guess about which quest owns the text.
  const titleKey =
    input.link.kind === 'direct' &&
    typeof input.link.titleKey === 'string' &&
    input.link.titleKey !== ''
      ? input.link.titleKey
      : null;

  return {
    m_questName: name,
    m_questNameID: 0,
    m_questTitle: titleKey,
    m_questInfo: null,
    m_questPrep: null,
    m_questUnderway: null,
    m_questComplete: null,
    m_startGoals: [],
    m_goals: [],
    m_startResults: emptyResultList(),
    m_endResults: emptyResultList(),
    m_requirements: null,
    m_prepRequirements: null,
    m_pruneRequirements: null,
    m_prepAlways: false,
    m_clientTags: null,
    m_goalLogic: [],
    m_questLevel: 0,
    m_questRepeat: 0,
    m_onStartQuestScript: EMPTY_SCRIPT,
    m_onEndQuestScript: EMPTY_SCRIPT,
    m_dialogList: emptyDialogList(),
    m_missionDoors: null,
    m_dynaMods: null,
    m_isHidden: false,
    m_outdated: false,
    m_noQuestHelper: false,
    m_mainline: false,
    m_defaultDialogAnimation: null,
    m_skipQHAutoSelect: false,
    m_questEffectInfoList: null,
    m_forceInteraction: false,
    m_checkInventoryForCrafting: false,
    m_playAsYourPetNPC: false,
    m_activityType: 'ACTIVITY_NotActivity',
    m_behaviors: null,
  };
}
