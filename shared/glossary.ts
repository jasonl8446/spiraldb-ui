/**
 * The one label home — task 7.8 (p7-09), D131.
 *
 * Every field key, class, enum literal and dialog group name the quest editor shows has ONE
 * entry here: a friendly `label`, a `help` sentence, a `tier` (`basic` or `advanced`) and a
 * `source` that cites where the meaning comes from. The editor renders `Friendly (technical)`
 * from these entries (`<TermLabel />`, D131); no other module may hold a second label table
 * (`tests/unit/glossary-single-home.test.ts`).
 *
 * Like `shared/document.ts` (D58) this file has **no imports**, so the client, the server and
 * the tests can all use it without pulling anything in.
 *
 * ## Shape and keys (D171)
 *
 * - `fields` is keyed by **document key** (`m_questLevel`, `$type`). One key has one entry even
 *   when several classes carry it: `m_questName` on a quest, a requirement and a result is the
 *   same term, and its `help` covers each use.
 * - `classes` is keyed by the **short class name** (`PersonaGoalTemplate`), which is the last
 *   segment of the assembly-qualified `$type` (`Imcodec.ObjectProperty.TypeCache.<Name>,
 *   Imcodec.ObjectProperty`). {@link classTerm} accepts either form.
 * - `enums` is keyed by **enum name**, then by **literal** (`enums.GoalType.GOAL_TYPE_PERSONA`).
 *   {@link ENUM_OF_FIELD} says which enum a field's values belong to.
 * - `groups` holds the dialog editor's section names (`Basic`, `Camera`, `Walk-Away`, ...). The
 *   section names are the domain reference's own group headings, so they are not technical
 *   strings, but they were a scattered label table and belong here too.
 *
 * ## The tier rule (D172)
 *
 * `basic` is what a quest author sets on a routine quest: identity and player-facing text, the
 * goals, the operands of a requirement or result, and a dialog entry's speaker, text, portrait,
 * voice-over, event and duration limit. `advanced` is engine plumbing and rarely-set detail:
 * hashed ids, flags, camera, audio, animation, timing, scripts, teleporter internals and objects
 * the editor does not model. On the Info tab the tier follows the visible/Advanced split the tab
 * already had. Task 7.11 renders the tiers; a form's `basic` set is pinned by a unit test there.
 *
 * ## `source`
 *
 * `file:line` of the line the meaning comes from: `docs/spec-domain-reference.md:N`, another repo
 * file, or a sibling tree (`Imlight/...`, resolved beside this repository). Where the spec does
 * not define a term, its `help` says so.
 */

export type GlossaryTier = 'basic' | 'advanced';

export interface GlossaryEntry {
  /** The friendly half of the `Friendly (technical)` pair. */
  label: string;
  /** What the term means, in one or two sentences. Never empty. */
  help: string;
  tier: GlossaryTier;
  /** `file:line` the meaning comes from. */
  source: string;
}

function e(label: string, tier: GlossaryTier, source: string, help: string): GlossaryEntry {
  return { label, help, tier, source };
}

/** Field entries, keyed by document key. */
export const fields: Readonly<Record<string, GlossaryEntry>> = {
  m_questName: e(
    'Quest',
    'basic',
    'docs/spec-domain-reference.md:244',
    "The quest's unique identifier. Inside a requirement or a result it names the quest being referred to instead.",
  ),
  m_questNameID: e(
    'Quest name ID',
    'advanced',
    'docs/spec-domain-reference.md:245',
    'The hashed form of the quest name; the spec notes it can be 0, and every quest in the corpus stores 0.',
  ),
  m_questTitle: e(
    'Quest title',
    'basic',
    'docs/spec-domain-reference.md:246',
    "String-table key for the quest's title. The editor shows the resolved title beside the key; an unresolved key stays visible as it is.",
  ),
  m_questInfo: e(
    'Quest info',
    'advanced',
    'docs/spec-domain-reference.md:247',
    "String-table key for the quest's info text (optional).",
  ),
  m_questPrep: e(
    'Quest prep text',
    'advanced',
    'docs/spec-domain-reference.md:248',
    'The pre-acceptance description (optional).',
  ),
  m_questUnderway: e(
    'Quest underway text',
    'advanced',
    'docs/spec-domain-reference.md:249',
    'The in-progress description (optional).',
  ),
  m_questComplete: e(
    'Quest complete text',
    'advanced',
    'docs/spec-domain-reference.md:250',
    'The completion text (optional).',
  ),
  m_startGoals: e(
    'Start goals',
    'basic',
    'docs/spec-domain-reference.md:251',
    "Names of the goals that become active when the player accepts the quest. Each name must match a goal in the quest's goal list.",
  ),
  m_goals: e(
    'Goals',
    'basic',
    'docs/spec-domain-reference.md:252',
    "The quest's goal definitions. Each goal is one of five classes (talk to an NPC, reach a zone, kill mobs, collect items, reach a rank).",
  ),
  m_startResults: e(
    'Start results',
    'basic',
    'docs/spec-domain-reference.md:253',
    'Results applied when the player accepts the quest.',
  ),
  m_endResults: e(
    'End results',
    'basic',
    'docs/spec-domain-reference.md:254',
    'Results applied when the quest is completed, typically the rewards.',
  ),
  m_requirements: e(
    'Requirements',
    'basic',
    'docs/spec-domain-reference.md:255',
    'A list of conditions. On a quest it holds the requirements to accept it; nested in a requirement group it holds the child conditions; on a dialog entry it holds the conditions to show that entry.',
  ),
  m_prepRequirements: e(
    'Prep requirements',
    'basic',
    'docs/spec-domain-reference.md:256',
    'Requirements a player must meet to see the quest offer.',
  ),
  m_pruneRequirements: e(
    'Prune requirements',
    'basic',
    'docs/spec-domain-reference.md:257',
    'Requirements that, once met, remove the quest from the player.',
  ),
  m_goalLogic: e(
    'Goal logic',
    'basic',
    'docs/spec-domain-reference.md:258',
    'The progression rules that decide which goals activate as other goals complete, and which entry finishes the quest.',
  ),
  m_questLevel: e(
    'Quest level',
    'basic',
    'docs/spec-domain-reference.md:259',
    'The suggested level for the quest.',
  ),
  m_questRepeat: e(
    'Repeatability',
    'basic',
    'docs/spec-domain-reference.md:260',
    'Repeatability flag; 0 means the quest is not repeatable. The spec documents no other values.',
  ),
  m_onStartQuestScript: e(
    'Start script',
    'basic',
    'docs/spec-domain-reference.md:261',
    'Name of a script run when the quest starts.',
  ),
  m_onEndQuestScript: e(
    'End script',
    'basic',
    'docs/spec-domain-reference.md:262',
    'Name of a script run when the quest ends.',
  ),
  m_dialogList: e(
    'Dialog list',
    'basic',
    'docs/spec-domain-reference.md:263',
    "The quest-giver's dialog tree: tagged blocks (Prep, Completion, and so on) of dialog entries. Goals carry their own dialog list under the same key.",
  ),
  m_isHidden: e(
    'Hidden',
    'basic',
    'docs/spec-domain-reference.md:264',
    'Hides the quest from the quest log.',
  ),
  m_mainline: e(
    'Mainline',
    'basic',
    'docs/spec-domain-reference.md:265',
    'Marks the quest as a mainline story quest.',
  ),
  m_noQuestHelper: e(
    'No Quest Helper',
    'advanced',
    'docs/spec-domain-reference.md:266',
    'Disables the quest helper arrow. Exists on the quest and on each goal.',
  ),
  m_clientTags: e(
    'Client Tags',
    'basic',
    'docs/spec-domain-reference.md:267',
    'Tags the game client uses to filter the quest in its interface. Exists on the quest and on each goal.',
  ),
  m_activityType: e(
    'Activity type',
    'basic',
    'docs/spec-domain-reference.md:268',
    "Classification of the activity the quest belongs to (an ActivityType value). The spec says only 'activity classification'; every quest in the corpus uses ACTIVITY_NotActivity.",
  ),
  m_prepAlways: e(
    'Always show prep',
    'advanced',
    'docs/spec-domain-reference.md:269',
    'Always shows the prep dialog.',
  ),
  m_forceInteraction: e(
    'Force interaction',
    'advanced',
    'docs/spec-domain-reference.md:270',
    'Forces the interaction prompt.',
  ),
  m_checkInventoryForCrafting: e(
    'Check inventory for crafting',
    'advanced',
    'docs/spec-domain-reference.md:271',
    "Checks the player's inventory for crafting goals.",
  ),
  m_playAsYourPetNPC: e(
    'Play as your pet',
    'advanced',
    'docs/spec-domain-reference.md:272',
    'Pet-play mode flag.',
  ),
  m_missionDoors: e(
    'Mission doors',
    'advanced',
    'docs/spec-domain-reference.md:273',
    'Mission door configuration (an object). The editor does not model it; it is shown as raw JSON.',
  ),
  m_dynaMods: e(
    'Dynamic modifiers',
    'advanced',
    'docs/spec-domain-reference.md:274',
    'Dynamic modifier configuration (an object). The editor does not model it; it is shown as raw JSON.',
  ),
  m_outdated: e(
    'Outdated',
    'advanced',
    'docs/spec-domain-reference.md:275',
    'Marks the quest as deprecated.',
  ),
  m_defaultDialogAnimation: e(
    'Default dialog animation',
    'advanced',
    'docs/spec-domain-reference.md:276',
    "The default animation for the quest's dialog (an object). The editor shows it read-only.",
  ),
  m_skipQHAutoSelect: e(
    'Skip quest helper auto-select',
    'advanced',
    'docs/spec-domain-reference.md:277',
    'Skips the automatic quest helper selection.',
  ),
  m_questEffectInfoList: e(
    'Quest effects',
    'advanced',
    'docs/spec-domain-reference.md:278',
    'Visual and audio effects attached to the quest (an object). The editor does not model it; it is shown as raw JSON.',
  ),
  m_behaviors: e(
    'Behaviors',
    'advanced',
    'docs/spec-domain-reference.md:279',
    'Server-side behaviors (an object). The editor does not model it; it is shown as raw JSON. Goals carry their own copy.',
  ),
  $type: e(
    'Type',
    'basic',
    'docs/spec-domain-reference.md:100',
    "The Imcodec class of an object. The full assembly-qualified string is written into the document and must match a known type exactly; the editor's type selector chooses it.",
  ),
  m_zoneTag: e(
    'Zone',
    'basic',
    'docs/spec-domain-reference.md:318',
    'The zone the player must reach (a zone path, chosen from the synced zone names).',
  ),
  m_zoneEntry: e(
    'Entry',
    'basic',
    'docs/spec-domain-reference.md:318',
    'When on, entering the zone counts toward the goal.',
  ),
  m_zoneExit: e(
    'Exit',
    'basic',
    'docs/spec-domain-reference.md:318',
    'When on, leaving the zone counts toward the goal.',
  ),
  m_proximityTag: e(
    'Proximity Tag',
    'basic',
    'docs/spec-domain-reference.md:318',
    'The tag of the proximity trigger the player must reach. The spec gives no more detail.',
  ),
  m_personaName: e(
    'Persona',
    'basic',
    'docs/spec-domain-reference.md:322',
    "The NPC's persona name. On a goal it names the NPC to talk to (a name, not a template id); on a dialog entry it names the speaker. The spec describes it as an NPC persona identifier.",
  ),
  m_usePatron: e(
    'Use Patron',
    'basic',
    'docs/spec-domain-reference.md:322',
    'Requires the patron interaction. The spec lists the flag without further description.',
  ),
  m_npcAdjectives: e(
    'NPC Adjectives',
    'basic',
    'docs/spec-domain-reference.md:326',
    'Tags naming the mobs a bounty counts.',
  ),
  m_bountyTotal: e(
    'Bounty Total',
    'basic',
    'docs/spec-domain-reference.md:326',
    'How many mobs must be killed.',
  ),
  m_bountyType: e(
    'Bounty Type',
    'basic',
    'docs/spec-domain-reference.md:326',
    "The bounty classification, a BountyType value. The spec's example is BT_MOB_KILL.",
  ),
  m_itemAdjectives: e(
    'Item Adjectives',
    'basic',
    'docs/spec-domain-reference.md:330',
    'Tags naming the items a scavenge goal counts.',
  ),
  m_itemTotal: e(
    'Item Total',
    'basic',
    'docs/spec-domain-reference.md:330',
    'How many items must be collected.',
  ),
  m_rank: e(
    'Rank',
    'basic',
    'docs/spec-domain-reference.md:334',
    'The rank or level the player must reach.',
  ),
  m_goalName: e(
    'Goal Name',
    'basic',
    'docs/spec-domain-reference.md:338',
    "The goal's name, unique within the quest. Start goals and goal logic refer to goals by this name. The spec names this field but gives no description of it; this wording is the editor’s reading.",
  ),
  m_goalNameID: e(
    'Goal Name ID',
    'advanced',
    'docs/spec-domain-reference.md:338',
    'The hashed form of the goal name; the spec lists it without more detail and it can be 0.',
  ),
  m_goalTitle: e(
    'Goal Title',
    'basic',
    'docs/spec-domain-reference.md:338',
    "String-table key for the goal's title. The spec names this field but gives no description of it; this wording is the editor’s reading.",
  ),
  m_goalText: e(
    'Goal text',
    'basic',
    'docs/spec-api.md:528',
    "String-table key for the goal's own text, the field the evidence panel inserts goal text into. Not described in the spec beyond that insert target, and no corpus goal carries it yet; this wording is the editor’s reading.",
  ),
  m_goalUnderway: e(
    'Underway',
    'advanced',
    'docs/spec-domain-reference.md:338',
    'The in-progress description shown while the goal is active. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_hyperlink: e(
    'Hyperlink',
    'advanced',
    'docs/spec-domain-reference.md:338',
    'A help link shown in the quest log. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_completeText: e(
    'Complete Text',
    'basic',
    'docs/spec-domain-reference.md:338',
    'The text shown when the goal completes. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_completeResults: e(
    'Complete results',
    'basic',
    'docs/spec-domain-reference.md:338',
    'Results granted when the goal completes. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_goalRequirements: e(
    'Goal requirements',
    'basic',
    'docs/spec-domain-reference.md:338',
    'The requirement tree that gates the goal. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_tallyCounter: e(
    'Tally counter',
    'advanced',
    'docs/spec-domain-reference.md:338',
    'Tally counter state (an object). The spec lists it on goals without describing it; the editor does not model it.',
  ),
  m_locationName: e(
    'Location Name',
    'basic',
    'docs/spec-domain-reference.md:338',
    'String-table key for the location shown for the goal. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_displayImage1: e(
    'Display Image 1',
    'advanced',
    'docs/spec-domain-reference.md:338',
    'Path of the first quest helper image. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_displayImage2: e(
    'Display Image 2',
    'advanced',
    'docs/spec-domain-reference.md:338',
    'Path of the second quest helper image. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_genericEvents: e(
    'Generic events',
    'advanced',
    'docs/spec-domain-reference.md:338',
    'A list of generic events on the goal. The spec lists the key without describing it; the editor does not model it.',
  ),
  m_autoQualify: e(
    'Auto Qualify',
    'advanced',
    'docs/spec-domain-reference.md:338',
    'Qualifies the goal automatically. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_autoComplete: e(
    'Auto Complete',
    'advanced',
    'docs/spec-domain-reference.md:338',
    'Completes the goal automatically. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_destinationZone: e(
    'Destination Zone',
    'basic',
    'docs/spec-domain-reference.md:338',
    'A zone path: on a goal, the zone the goal points the player to; on a teleport result, the zone the player arrives in. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_goalType: e(
    'Goal Type',
    'basic',
    'docs/spec-domain-reference.md:338',
    "The quest-log classification of the goal, a GoalType value. It is a separate axis from the goal's class, and a value the editor does not know is kept. The spec names this field but gives no description of it; this wording is the editor’s reading.",
  ),
  m_petOnlyQuest: e(
    'Pet Only Quest',
    'advanced',
    'docs/spec-domain-reference.md:338',
    'Pet-play mode flag. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_activateResults: e(
    'Activate results',
    'basic',
    'docs/spec-domain-reference.md:338',
    'Results granted when the goal activates. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_hideGoalFloatyText: e(
    'Hide Goal Floaty Text',
    'advanced',
    'docs/spec-domain-reference.md:338',
    'Hides the on-screen goal text. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_goalsAND: e(
    'Goals that must all complete',
    'basic',
    'docs/spec-domain-reference.md:346',
    'Names of the goals that must ALL be complete for this entry to fire.',
  ),
  m_goalsOR: e(
    'Goals where any counts',
    'basic',
    'docs/spec-domain-reference.md:347',
    'Names of goals where any completion counts, up to the required OR count.',
  ),
  m_goalsToAdd: e(
    'Goals to activate',
    'basic',
    'docs/spec-domain-reference.md:348',
    "Names of the goals that activate when this entry's conditions are met.",
  ),
  m_completeQuest: e(
    'Completes the quest',
    'basic',
    'docs/spec-domain-reference.md:349',
    'When on, satisfying this entry finishes the quest.',
  ),
  m_requiredORCount: e(
    'Required OR count',
    'basic',
    'docs/spec-domain-reference.md:350',
    "How many of the 'any counts' goals must be complete.",
  ),
  m_applyNOT: e(
    'NOT',
    'basic',
    'docs/spec-domain-reference.md:422',
    'Inverts the condition: the requirement is met when the check fails.',
  ),
  m_operator: e(
    'Operator',
    'basic',
    'docs/spec-domain-reference.md:422',
    'How a requirement combines with its siblings, an operator value (AND or OR).',
  ),
  m_entryName: e(
    'Entry',
    'basic',
    'docs/spec-domain-reference.md:426',
    "The name of a quest registry entry (the corpus uses 'Complete'). Used by the has-entry requirement and the modify-entry result.",
  ),
  m_displayName: e(
    'Display Name',
    'advanced',
    'client/src/lib/requirement-tree.ts:43',
    'Not documented in the spec; the corpus writes it on has-entry requirements as null in every measured node.',
  ),
  m_isQuestRegistry: e(
    'Quest Registry',
    'advanced',
    'docs/spec-domain-reference.md:364',
    'Whether the entry lives in the quest registry. The spec lists it on the modify-entry result; the corpus also writes it on has-entry requirements.',
  ),
  m_magicSchool: e(
    'School',
    'basic',
    'docs/spec-domain-reference.md:430',
    "The player's own magic school: Fire, Ice, Storm, Balance, Life, Death or Myth.",
  ),
  m_magicSchoolName: e(
    'School Name',
    'basic',
    'docs/spec-domain-reference.md:434',
    'The school the target entity must belong to (a MagicSchool value).',
  ),
  m_targetType: e(
    'Target Type',
    'basic',
    'docs/spec-domain-reference.md:434',
    "Which entity the school check applies to, a TargetType value (the spec's example is RT_Caster).",
  ),
  m_results: e(
    'Results',
    'basic',
    'shared/quest/results.ts:25',
    'The list of results inside a result list. The spec does not name this key; it is the one key of every result-list wrapper the corpus holds.',
  ),
  m_tallyResults: e(
    'Tally results',
    'advanced',
    'shared/quest/results.ts:174',
    "The results list inside a goal's tally counter. Not described in the spec; recorded from the corpus.",
  ),
  m_tableName: e(
    'Drop table',
    'basic',
    'docs/spec-domain-reference.md:360',
    'The drop table the reward rolls on.',
  ),
  m_maxRolls: e(
    'Max rolls',
    'basic',
    'docs/spec-domain-reference.md:360',
    'How many times the table is rolled. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_value: e(
    'Value',
    'basic',
    'docs/spec-domain-reference.md:364',
    'The integer value written to the registry entry.',
  ),
  m_dynaModClientTag: e(
    'Modifier client tag',
    'advanced',
    'docs/spec-domain-reference.md:368',
    'The client tag of the dynamic modifier to add or remove. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_dynaModRemove: e(
    'Remove modifier',
    'advanced',
    'docs/spec-domain-reference.md:368',
    'When on, removes the modifier instead of adding it. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_useQuestAsOriginator: e(
    'Quest is the originator',
    'advanced',
    'docs/spec-domain-reference.md:368',
    'Uses the quest as the originator of the modifier. The spec lists the flag without more detail.',
  ),
  m_dynaModState: e(
    'Modifier state',
    'advanced',
    'docs/spec-domain-reference.md:368',
    'The state to put the dynamic modifier in. The spec lists it without an enumeration.',
  ),
  m_zoneName: e(
    'Zone name',
    'advanced',
    'docs/spec-domain-reference.md:368',
    'The zone a dynamic modifier applies to. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_templateID: e(
    'Template ID',
    'basic',
    'docs/spec-domain-reference.md:372',
    'The template id of the spell or NPC a result acts on; which one depends on the result class. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_eventName: e(
    'Event name',
    'basic',
    'docs/spec-domain-reference.md:376',
    'The game event to post.',
  ),
  m_spawnID: e(
    'Spawn ID',
    'advanced',
    'docs/spec-domain-reference.md:390',
    'The spawn id to despawn. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_despawnEffect: e(
    'Despawn effect',
    'advanced',
    'docs/spec-domain-reference.md:390',
    'Plays the despawn effect. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_spellID: e(
    'Spell',
    'basic',
    'docs/spec-domain-reference.md:398',
    'The spell to give, by template id.',
  ),
  m_router: e(
    'Sound router',
    'advanced',
    'docs/spec-domain-reference.md:402',
    'The spatial routing settings for a sound: a location, a routing type and two location flags. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_soundName: e('Sound', 'basic', 'docs/spec-domain-reference.md:402', 'The sound file to play.'),
  m_blocking: e(
    'Blocking',
    'advanced',
    'docs/spec-domain-reference.md:402',
    'Whether the sound blocks until it finishes. The spec lists the flag without more detail.',
  ),
  m_reinteractTime: e(
    'Re-interact time',
    'advanced',
    'docs/spec-domain-reference.md:402',
    'Seconds before the sound can be triggered again. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_locX: e(
    'Location X',
    'advanced',
    'docs/spec-domain-reference.md:402',
    'X coordinate used for spatial sound routing. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_locY: e(
    'Location Y',
    'advanced',
    'docs/spec-domain-reference.md:402',
    'Y coordinate used for spatial sound routing. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_locZ: e(
    'Location Z',
    'advanced',
    'docs/spec-domain-reference.md:402',
    'Z coordinate used for spatial sound routing. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_routingType: e(
    'Routing type',
    'advanced',
    'docs/spec-domain-reference.md:402',
    'The spatial routing mode, a RoutingType value. The spec calls it a string.',
  ),
  m_useLocation: e(
    'Use router location',
    'advanced',
    'client/src/lib/quest-results.ts:49',
    'Not documented in the spec beyond its name; the editor reads it as routing from the router location instead of the actor.',
  ),
  m_useTriggerLocation: e(
    'Use trigger location',
    'advanced',
    'client/src/lib/quest-results.ts:49',
    "Not documented in the spec beyond its name; the editor reads it as routing from the trigger's location.",
  ),
  m_destinationLoc: e(
    'Destination location',
    'advanced',
    'docs/spec-domain-reference.md:406',
    'The destination location of a teleport, as the corpus writes it (a location name or coordinates string). The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_exitTeleporter: e(
    'Exit teleporter',
    'advanced',
    'docs/spec-domain-reference.md:406',
    'The exit teleporter number of a teleport. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_teleporterTag: e(
    'Teleporter tag',
    'advanced',
    'docs/spec-domain-reference.md:406',
    'The teleporter tag of a teleport. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_teleportType: e(
    'Teleport type',
    'advanced',
    'docs/spec-domain-reference.md:406',
    'The teleport mode, a TeleportType value. The spec calls it a string enum.',
  ),
  m_transitionID: e(
    'Transition ID',
    'advanced',
    'docs/spec-domain-reference.md:406',
    'The transition id of a teleport. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_secondsToWait: e(
    'Seconds to wait',
    'basic',
    'docs/spec-domain-reference.md:410',
    'How many seconds the wait result pauses.',
  ),
  m_dialogs: e(
    'Dialog blocks',
    'basic',
    'shared/quest/dialog.ts:10',
    'The tagged dialog blocks of a dialog list. Not described in the spec; the block shape is recorded from the corpus.',
  ),
  m_dialogTag: e(
    'Dialog tag',
    'basic',
    'shared/quest/dialog.ts:160',
    'The tag naming a dialog block (Prep and Completion are the common ones). Not described in the spec; recorded from the corpus.',
  ),
  m_dialogEntries: e(
    'Dialog entries',
    'basic',
    'shared/quest/dialog.ts:31',
    'The entries (lines of dialog) inside a dialog block.',
  ),
  m_madlibs: e(
    'Madlibs',
    'advanced',
    'shared/quest/dialog.ts:37',
    'Template arguments substituted into dialog text. Not described in the spec beyond its type; the editor shows them read-only.',
  ),
  m_dialogEvents: e(
    'Dialog events',
    'advanced',
    'shared/quest/dialog.ts:166',
    'Events attached to a dialog block. Not described in the spec; the editor shows them read-only.',
  ),
  m_noAggroWhileDialogIsUp: e(
    'No aggro while dialog is up',
    'advanced',
    'shared/quest/dialog.ts:167',
    'Not documented in the spec; recorded from the corpus. By its name, it stops mobs aggroing while the dialog is open.',
  ),
  m_noAggroNoDelay: e(
    'No aggro, no delay',
    'advanced',
    'shared/quest/dialog.ts:168',
    'Not documented in the spec; recorded from the corpus as a boolean on a dialog block.',
  ),
  m_nameOverride: e(
    'Name override',
    'basic',
    'docs/spec-domain-reference.md:450',
    "Overrides the speaker's display name.",
  ),
  m_nameSTKey: e(
    'Name format key',
    'advanced',
    'docs/spec-domain-reference.md:451',
    'String-table key for the name format.',
  ),
  m_guiDisplay: e(
    'GUI display',
    'advanced',
    'docs/spec-domain-reference.md:452',
    'A GUI display override.',
  ),
  m_maxTimeSeconds: e(
    'Max display time',
    'basic',
    'docs/spec-domain-reference.md:453',
    'The longest the dialog is shown, in seconds; -1 means unlimited.',
  ),
  m_invisible: e('Invisible', 'basic', 'docs/spec-domain-reference.md:454', 'Hides the dialog UI.'),
  m_dialog: e(
    'Dialog text',
    'basic',
    'docs/spec-domain-reference.md:456',
    'String-table key for the dialog text. The editor shows the resolved text where the key resolves.',
  ),
  m_picture: e(
    'Portrait',
    'basic',
    'docs/spec-domain-reference.md:457',
    'Path of the portrait image.',
  ),
  m_soundFile: e(
    'Voice-over',
    'basic',
    'docs/spec-domain-reference.md:458',
    'Path of the voice-over audio file.',
  ),
  m_action: e(
    'Action',
    'advanced',
    'docs/spec-domain-reference.md:459',
    'An action trigger. The spec lists it without more detail.',
  ),
  m_dialogEvent: e(
    'Dialog event',
    'basic',
    'docs/spec-domain-reference.md:460',
    'The name of an event to fire when the entry plays.',
  ),
  m_actorTemplateID: e(
    'Actor template',
    'basic',
    'docs/spec-domain-reference.md:461',
    'The NPC actor template speaking the entry, chosen from the synced NPC names.',
  ),
  m_cameraName: e(
    'Camera name',
    'advanced',
    'docs/spec-domain-reference.md:464',
    'The camera position name, or LOCATION.',
  ),
  m_interpolationDuration: e(
    'Camera transition time',
    'advanced',
    'docs/spec-domain-reference.md:465',
    'How long the camera takes to move, in seconds.',
  ),
  m_cameraOffsetX: e(
    'Camera offset X',
    'advanced',
    'docs/spec-domain-reference.md:466',
    'X offset of the camera position.',
  ),
  m_cameraOffsetY: e(
    'Camera offset Y',
    'advanced',
    'docs/spec-domain-reference.md:466',
    'Y offset of the camera position.',
  ),
  m_cameraOffsetZ: e(
    'Camera offset Z',
    'advanced',
    'docs/spec-domain-reference.md:466',
    'Z offset of the camera position.',
  ),
  m_pitch: e(
    'Camera pitch',
    'advanced',
    'docs/spec-domain-reference.md:467',
    'Camera rotation: pitch.',
  ),
  m_yaw: e('Camera yaw', 'advanced', 'docs/spec-domain-reference.md:467', 'Camera rotation: yaw.'),
  m_roll: e(
    'Camera roll',
    'advanced',
    'docs/spec-domain-reference.md:467',
    'Camera rotation: roll.',
  ),
  m_cameraShakeType: e(
    'Camera shake type',
    'advanced',
    'docs/spec-domain-reference.md:468',
    'The shake effect type.',
  ),
  m_cameraShakeDuration: e(
    'Camera shake duration',
    'advanced',
    'docs/spec-domain-reference.md:469',
    'How long the camera shakes.',
  ),
  m_cameraShakeAmplitude: e(
    'Camera shake intensity',
    'advanced',
    'docs/spec-domain-reference.md:470',
    'How strongly the camera shakes.',
  ),
  m_bypassCameraOnReview: e(
    'Skip camera on review',
    'advanced',
    'docs/spec-domain-reference.md:471',
    'Skips the camera when the dialog is reviewed.',
  ),
  m_cameraZoneName: e(
    'Camera zone',
    'advanced',
    'docs/spec-domain-reference.md:472',
    'The zone whose camera position is used.',
  ),
  m_cameraHidePlayers: e(
    'Hide players',
    'advanced',
    'docs/spec-domain-reference.md:473',
    'Whether players are hidden during the dialog. The spec names 0 as no and 2 as yes; the corpus also holds 1 and 3.',
  ),
  m_cameraFadeType: e(
    'Camera fade type',
    'advanced',
    'docs/spec-domain-reference.md:474',
    'The fade effect type.',
  ),
  m_cameraFadeTime: e(
    'Camera fade time',
    'advanced',
    'docs/spec-domain-reference.md:475',
    'How long the camera fade lasts.',
  ),
  m_secondaryCameraName: e(
    'Secondary camera',
    'advanced',
    'docs/spec-domain-reference.md:476',
    'The name of a secondary camera.',
  ),
  m_secondaryInterpolationDuration: e(
    'Secondary camera transition time',
    'advanced',
    'docs/spec-domain-reference.md:477',
    'Transition time of the secondary camera. The spec lists it without a description.',
  ),
  m_secondaryCameraInitalDelay: e(
    'Secondary camera initial delay',
    'advanced',
    'docs/spec-domain-reference.md:478',
    "Initial delay of the secondary camera. The key's own spelling ('Inital') is the corpus's and must not be corrected. The spec names this field but gives no description of it; this wording is the editor’s reading.",
  ),
  m_dontReleaseCameraAtExit: e(
    'Keep camera at exit',
    'advanced',
    'docs/spec-domain-reference.md:479',
    'Does not release the camera when the dialog exits. The spec lists the flag without a description.',
  ),
  m_fadeOutCamera: e(
    'Fade out camera',
    'advanced',
    'docs/spec-domain-reference.md:480',
    'Fades the camera out. The spec lists the flag without a description.',
  ),
  m_snapCameraToPlayerAtExit: e(
    'Snap camera to player at exit',
    'advanced',
    'docs/spec-domain-reference.md:481',
    'Snaps the camera back to the player when the dialog exits. The spec lists the flag without a description.',
  ),
  m_duration: e(
    'Duration',
    'advanced',
    'docs/spec-domain-reference.md:484',
    'How long the dialog lasts, in seconds.',
  ),
  m_delay: e(
    'Delay',
    'advanced',
    'docs/spec-domain-reference.md:485',
    'Delay before the dialog shows.',
  ),
  m_spamTime: e(
    'Spam prevention interval',
    'advanced',
    'docs/spec-domain-reference.md:486',
    'The spam prevention interval.',
  ),
  m_playSoundIfSpamming: e(
    'Play sound while spamming',
    'advanced',
    'docs/spec-domain-reference.md:487',
    'Plays the sound even while the spam interval is active. The spec lists the flag without a description.',
  ),
  m_playMusicIfSpamming: e(
    'Play music while spamming',
    'advanced',
    'docs/spec-domain-reference.md:488',
    'Plays the music even while the spam interval is active. The spec lists the flag without a description.',
  ),
  m_displayButtonsOnTimedDialog: e(
    'Show buttons on timed dialog',
    'advanced',
    'docs/spec-domain-reference.md:489',
    'Shows the buttons on a timed dialog. The spec lists the flag without a description.',
  ),
  m_walkAwayNpcTemplateID: e(
    'Walk-away NPC',
    'advanced',
    'docs/spec-domain-reference.md:492',
    'The NPC that walks away, chosen from the synced NPC names; 0 means none.',
  ),
  m_walkAwayExitDirectionInDegrees: e(
    'Walk-away exit direction',
    'advanced',
    'docs/spec-domain-reference.md:493',
    'The direction the NPC exits in, in degrees. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_walkAwayFadeTime: e(
    'Walk-away fade time',
    'advanced',
    'docs/spec-domain-reference.md:494',
    'The fade time of the walk-away. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_walkAwayUseCurrentFacing: e(
    'Walk away from current facing',
    'advanced',
    'docs/spec-domain-reference.md:495',
    'The NPC walks away along its current facing. The spec lists the flag without a description.',
  ),
  m_standInPlayerTag: e(
    'Stand-in player tag',
    'advanced',
    'docs/spec-domain-reference.md:496',
    'The tag of the stand-in player. The spec lists it without a description.',
  ),
  m_soundEffectFile: e(
    'Sound effect file',
    'advanced',
    'docs/spec-domain-reference.md:499',
    'Path of the sound effect.',
  ),
  m_musicFile: e(
    'Music file',
    'advanced',
    'docs/spec-domain-reference.md:500',
    'Path of the music track.',
  ),
  m_nonStackableMusic: e(
    'Music does not stack',
    'advanced',
    'docs/spec-domain-reference.md:501',
    'The music does not stack with other music. The spec lists the flag without a description.',
  ),
  m_nonRepeatableMusic: e(
    'Music does not repeat',
    'advanced',
    'docs/spec-domain-reference.md:502',
    'The music does not repeat. The spec lists the flag without a description.',
  ),
  m_playMusicAtSFXVolume: e(
    'Play music at effects volume',
    'advanced',
    'docs/spec-domain-reference.md:503',
    'Plays the music at the sound-effect volume. The spec lists the flag without a description.',
  ),
  m_soundEffectDelay: e(
    'Sound effect delay',
    'advanced',
    'docs/spec-domain-reference.md:504',
    'Delay before the sound effect plays. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_musicDelay: e(
    'Music delay',
    'advanced',
    'docs/spec-domain-reference.md:505',
    'Delay before the music plays. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_musicFadeTime: e(
    'Music fade time',
    'advanced',
    'docs/spec-domain-reference.md:506',
    'Fade time of the music. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_stopMusicFadeTime: e(
    'Stop-music fade time',
    'advanced',
    'docs/spec-domain-reference.md:507',
    'Fade time when the music stops. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_restartMusicFadeTime: e(
    'Restart-music fade time',
    'advanced',
    'docs/spec-domain-reference.md:508',
    'Fade time when the music restarts. The spec names this field but gives no description of it; this wording is the editor’s reading.',
  ),
  m_idleAnimation: e(
    'Idle animation',
    'advanced',
    'docs/spec-domain-reference.md:511',
    "The NPC's idle animation. The spec names this field but gives no description of it; this wording is the editor’s reading.",
  ),
  m_npcStandInList: e(
    'NPC stand-ins',
    'advanced',
    'docs/spec-domain-reference.md:512',
    'The list of NPC stand-ins. The spec types it as an array without a description.',
  ),
  m_dialogAnimationList: e(
    'Dialog animations',
    'advanced',
    'docs/spec-domain-reference.md:513',
    'The list of animations played during the dialog, encoded as strings. The spec types it as an array without a description.',
  ),
  m_dialogTurningList: e(
    'Dialog turning',
    'advanced',
    'docs/spec-domain-reference.md:514',
    'The list of turns made during the dialog, encoded as strings. The spec types it as an array without a description.',
  ),
  m_npcYawOffsetInDegrees: e(
    'NPC yaw offset',
    'advanced',
    'docs/spec-domain-reference.md:515',
    "The NPC's yaw offset, in degrees. The spec names this field but gives no description of it; this wording is the editor’s reading.",
  ),
  m_allowPlayerToMove: e(
    'Allow player to move',
    'advanced',
    'docs/spec-domain-reference.md:516',
    'Lets the player move during the dialog. The spec lists the flag without a description.',
  ),
  m_disableBackButton: e(
    'Disable back button',
    'advanced',
    'docs/spec-domain-reference.md:520',
    "Disables the dialog's back button. The spec lists the flag without a description.",
  ),
  m_enableExitButton: e(
    'Enable exit button',
    'advanced',
    'docs/spec-domain-reference.md:521',
    "Enables the dialog's exit button. The spec lists the flag without a description.",
  ),
  m_meetsRequirements: e(
    'Meets requirements',
    'advanced',
    'docs/spec-domain-reference.md:522',
    "An internal flag, usually true (the spec's words).",
  ),
};

/** Class entries, keyed by short class name. */
export const classes: Readonly<Record<string, GlossaryEntry>> = {
  WaypointGoalTemplate: e(
    'Reach a zone (Waypoint goal)',
    'basic',
    'docs/spec-domain-reference.md:316',
    'Navigate to a zone or trigger.',
  ),
  PersonaGoalTemplate: e(
    'Talk to an NPC (Persona goal)',
    'basic',
    'docs/spec-domain-reference.md:320',
    'Talk to an NPC.',
  ),
  BountyGoalTemplate: e(
    'Kill mobs (Bounty goal)',
    'basic',
    'docs/spec-domain-reference.md:324',
    'Kill mobs until the bounty total is reached.',
  ),
  ScavengeGoalTemplate: e(
    'Collect items (Scavenge goal)',
    'basic',
    'docs/spec-domain-reference.md:328',
    'Collect items from the world.',
  ),
  AchieveRankGoalTemplate: e(
    'Reach a rank (Achieve Rank goal)',
    'basic',
    'docs/spec-domain-reference.md:332',
    'Reach a rank or level.',
  ),
  ResDropTable: e(
    'Reward: drop table',
    'basic',
    'docs/spec-domain-reference.md:358',
    'Grants loot from a named drop table. The most common result.',
  ),
  ResModifyEntry: e(
    'Modify quest registry entry',
    'basic',
    'docs/spec-domain-reference.md:362',
    'Modifies a quest registry entry value.',
  ),
  ResAddDynaMod: e(
    'Add or remove dynamic modifier',
    'advanced',
    'docs/spec-domain-reference.md:366',
    'Adds or removes a dynamic modifier.',
  ),
  ResLearnSpell: e(
    'Teach spell',
    'basic',
    'docs/spec-domain-reference.md:370',
    'Teaches the player a spell.',
  ),
  ResPostEvent: e(
    'Post game event',
    'basic',
    'docs/spec-domain-reference.md:374',
    'Posts a game event.',
  ),
  ResAddHealth: e(
    'Restore health',
    'advanced',
    'docs/spec-domain-reference.md:378',
    'Restores health; it has no fields and defaults to a full heal.',
  ),
  ResAddMana: e(
    'Restore mana',
    'advanced',
    'docs/spec-domain-reference.md:381',
    'Restores mana; it has no fields and defaults to a full restore.',
  ),
  ResAddSpell: e(
    'Add spell to spellbook',
    'advanced',
    'docs/spec-domain-reference.md:384',
    'Adds a spell to the spellbook without permanent learning.',
  ),
  ResDespawn: e(
    'Despawn NPC or object',
    'advanced',
    'docs/spec-domain-reference.md:388',
    'Despawns an NPC or object.',
  ),
  ResDrawHand: e(
    'Draw hand',
    'advanced',
    'docs/spec-domain-reference.md:392',
    'Draws or plays a hand animation on an NPC.',
  ),
  ResGiveSpell: e(
    'Give spell to NPC',
    'advanced',
    'docs/spec-domain-reference.md:396',
    'Gives a specific spell to an NPC.',
  ),
  ResPlaySound: e(
    'Play sound',
    'advanced',
    'docs/spec-domain-reference.md:400',
    'Plays a sound effect with optional spatial routing.',
  ),
  ResTeleport: e(
    'Teleport player',
    'basic',
    'docs/spec-domain-reference.md:404',
    'Teleports the player.',
  ),
  ResWait: e('Wait', 'advanced', 'docs/spec-domain-reference.md:408', 'Pauses execution.'),
  ResActorDialog: e(
    'Actor dialog result',
    'advanced',
    'shared/quest/typeConstants.ts:96',
    "Not in the spec's list of result types; the corpus carries it with a nested dialog block, which the editor shows read-only.",
  ),
  ReqHasQuest: e(
    'Requires quest',
    'basic',
    'docs/spec-domain-reference.md:420',
    'The player must have (or, with NOT, must not have) a specific quest.',
  ),
  ReqHasEntry: e(
    'Requires quest registry entry',
    'basic',
    'docs/spec-domain-reference.md:424',
    'The player must have a specific quest registry entry.',
  ),
  ReqSchoolOfFocus: e(
    'Requires school of focus',
    'basic',
    'docs/spec-domain-reference.md:428',
    "The player must be a specific magic school (the player's own school).",
  ),
  ReqIsSchool: e(
    'Requires target school',
    'advanced',
    'docs/spec-domain-reference.md:432',
    'Checks whether a target entity is a specific school.',
  ),
  RequirementList: e(
    'Requirement group',
    'basic',
    'docs/spec-domain-reference.md:440',
    'The wrapper that holds nested requirements, enabling recursive AND/OR trees.',
  ),
  ActorDialogList: e(
    'Dialog list',
    'basic',
    'docs/spec-domain-reference.md:263',
    'The dialog tree of a quest or goal: tagged dialog blocks.',
  ),
  NPCDialogEntry: e(
    'Dialog entry',
    'basic',
    'docs/spec-domain-reference.md:444',
    'One line of dialog with its speaker, camera, audio and timing settings.',
  ),
  ActorDialog: e(
    'Actor dialog block',
    'advanced',
    'shared/quest/typeConstants.ts:120',
    'The typed form of a dialog block, found inside an actor dialog result.',
  ),
  MadlibArgT_ByteString: e(
    'Madlib argument (byte string)',
    'advanced',
    'shared/quest/typeConstants.ts:121',
    'A madlib argument holding a byte string; it fills a placeholder in dialog text.',
  ),
};

/** Dialog section names, keyed by the name the editor uses. */
export const groups: Readonly<Record<string, GlossaryEntry>> = {
  Basic: e(
    'Basic',
    'basic',
    'docs/spec-ui-design.md:498',
    'The fields most dialog entries set: speaker, text, portrait, voice-over, event and duration limit.',
  ),
  Camera: e(
    'Camera',
    'advanced',
    'docs/spec-ui-design.md:498',
    'Camera position, rotation, shake and fade settings for the entry.',
  ),
  Sound: e(
    'Sound',
    'advanced',
    'docs/spec-ui-design.md:498',
    "The Sound section: the sound-effect and music settings (the spec's Audio group).",
  ),
  Animation: e(
    'Animation',
    'advanced',
    'docs/spec-ui-design.md:498',
    "The Animation section: NPC animation, stand-in, turning and yaw settings (the spec's Animation & NPC group).",
  ),
  Advanced: e(
    'Advanced',
    'advanced',
    'docs/spec-ui-design.md:498',
    'The Advanced section: duration and timing, walk-away and UI control settings.',
  ),
  'Duration & Timing': e(
    'Duration & Timing',
    'advanced',
    'docs/spec-domain-reference.md:483',
    'How long the dialog lasts, when it shows and how spam is handled.',
  ),
  'Walk-Away': e(
    'Walk-Away',
    'advanced',
    'docs/spec-domain-reference.md:491',
    'Settings for an NPC that walks away during the dialog.',
  ),
  Audio: e(
    'Audio',
    'advanced',
    'docs/spec-domain-reference.md:498',
    'Sound-effect and music settings.',
  ),
  'Animation & NPC': e(
    'Animation & NPC',
    'advanced',
    'docs/spec-domain-reference.md:510',
    'NPC animation, stand-in, turning and yaw settings.',
  ),
  'UI Controls': e(
    'UI Controls',
    'advanced',
    'docs/spec-domain-reference.md:519',
    'Dialog button and internal-flag settings.',
  ),
};

/** Enum entries, keyed by enum name and then by literal. */
export const enums: Readonly<Record<string, Readonly<Record<string, GlossaryEntry>>>> = {
  ActivityType: {
    ACTIVITY_NotActivity: e(
      'Not an activity',
      'basic',
      'docs/spec-domain-reference.md:236',
      'The quest is not tied to an activity; the default, used by every quest in the corpus.',
    ),
    ACTIVITY_Spell: e(
      'Spell activity',
      'advanced',
      'Imlight/submodule/Imcodec/src/Imcodec.ObjectProperty/obj/Debug/net10.0/generated/Imcodec.ObjectProperty.CodeGen/Imcodec.ObjectProperty.CodeGen.ClientPropertyClassSourceGenerator/ActivityType.g.cs:32',
      "An Imcodec ActivityType value. The spec gives no meaning beyond 'activity classification'; by its name, the spell activity.",
    ),
    ACTIVITY_Crafting: e(
      'Crafting activity',
      'advanced',
      'Imlight/submodule/Imcodec/src/Imcodec.ObjectProperty/obj/Debug/net10.0/generated/Imcodec.ObjectProperty.CodeGen/Imcodec.ObjectProperty.CodeGen.ClientPropertyClassSourceGenerator/ActivityType.g.cs:28',
      "An Imcodec ActivityType value. The spec gives no meaning beyond 'activity classification'; by its name, the crafting activity.",
    ),
    ACTIVITY_Fishing: e(
      'Fishing activity',
      'advanced',
      'Imlight/submodule/Imcodec/src/Imcodec.ObjectProperty/obj/Debug/net10.0/generated/Imcodec.ObjectProperty.CodeGen/Imcodec.ObjectProperty.CodeGen.ClientPropertyClassSourceGenerator/ActivityType.g.cs:29',
      "An Imcodec ActivityType value. The spec gives no meaning beyond 'activity classification'; by its name, the fishing activity.",
    ),
    ACTIVITY_Gardening: e(
      'Gardening activity',
      'advanced',
      'Imlight/submodule/Imcodec/src/Imcodec.ObjectProperty/obj/Debug/net10.0/generated/Imcodec.ObjectProperty.CodeGen/Imcodec.ObjectProperty.CodeGen.ClientPropertyClassSourceGenerator/ActivityType.g.cs:30',
      "An Imcodec ActivityType value. The spec gives no meaning beyond 'activity classification'; by its name, the gardening activity.",
    ),
    ACTIVITY_Pet: e(
      'Pet activity',
      'advanced',
      'Imlight/submodule/Imcodec/src/Imcodec.ObjectProperty/obj/Debug/net10.0/generated/Imcodec.ObjectProperty.CodeGen/Imcodec.ObjectProperty.CodeGen.ClientPropertyClassSourceGenerator/ActivityType.g.cs:31',
      "An Imcodec ActivityType value. The spec gives no meaning beyond 'activity classification'; by its name, the pet activity.",
    ),
  },
  GoalType: {
    GOAL_TYPE_PERSONA: e(
      'Persona',
      'basic',
      'Imlight/src/Imlight.CoreLib/Game/Services/QuestService.cs:167',
      'A talk-to-NPC goal. Imlight only accepts a persona-goal completion for goals of this type.',
    ),
    GOAL_TYPE_WAYPOINT: e(
      'Waypoint',
      'basic',
      'Imlight/src/Imlight.CoreLib/Game/Services/QuestService.cs:282',
      'A reach-a-zone goal. Imlight only accepts a proximity completion for goals of this type.',
    ),
    GOAL_TYPE_BOUNTYCOLLECT: e(
      'Bounty collect',
      'basic',
      'Imlight/src/Imlight.CoreLib/Game/Services/QuestService.cs:346',
      'A kill-count goal. Imlight counts it, with GOAL_TYPE_BOUNTY, as a combat goal.',
    ),
    GOAL_TYPE_SCAVENGE: e(
      'Scavenge',
      'basic',
      'Imlight/submodule/Imcodec/test/CodeGen/Inputs/r756936_WizardDev.json:93073',
      'A collect-items goal.',
    ),
    GOAL_TYPE_ACHIEVERANK: e(
      'Achieve rank',
      'basic',
      'Imlight/submodule/Imcodec/test/CodeGen/Inputs/r756936_WizardDev.json:93077',
      'A reach-a-rank goal.',
    ),
    GOAL_TYPE_BOUNTY: e(
      'Bounty',
      'advanced',
      'Imlight/src/Imlight.CoreLib/Game/Services/QuestService.cs:345',
      'A kill-count goal. Imlight counts it, with GOAL_TYPE_BOUNTYCOLLECT, as a combat goal.',
    ),
    GOAL_TYPE_USAGE: e(
      'Usage',
      'advanced',
      'Imlight/src/Imlight.CoreLib/Game/Services/QuestService.cs:221',
      'A usage goal. Imlight only accepts a usage completion for goals of this type; no goal class in the corpus matches it.',
    ),
  },
  BountyType: {
    BT_MOB_KILL: e(
      'Kill mobs',
      'basic',
      'docs/spec-domain-reference.md:326',
      "The bounty counts mob kills; the spec's own example value.",
    ),
  },
  RequirementOperator: {
    ROP_AND: e(
      'AND',
      'basic',
      'docs/spec-domain-reference.md:422',
      'Every sibling condition must hold.',
    ),
    ROP_OR: e(
      'OR',
      'basic',
      'docs/spec-domain-reference.md:422',
      'At least one sibling condition must hold.',
    ),
  },
  RoutingType: {
    ROUTING_ACTOR: e(
      'Route from the actor',
      'advanced',
      'client/src/lib/quest-results.ts:51',
      'The routing mode every measured sound router uses. Not defined in the spec; recorded from the corpus sample.',
    ),
  },
  TeleportType: {
    TELEPORT_STATIC: e(
      'Static teleport',
      'basic',
      'docs/spec-domain-reference.md:297',
      'The only teleport type in the corpus: a teleport to a fixed destination.',
    ),
  },
  TargetType: {
    RT_Caster: e(
      'Caster',
      'basic',
      'docs/spec-domain-reference.md:434',
      "The entity the school check applies to is the caster; the spec's own example value.",
    ),
  },
  MagicSchool: {
    Fire: e('Fire', 'basic', 'docs/spec-domain-reference.md:430', 'The Fire magic school.'),
    Ice: e('Ice', 'basic', 'docs/spec-domain-reference.md:430', 'The Ice magic school.'),
    Storm: e('Storm', 'basic', 'docs/spec-domain-reference.md:430', 'The Storm magic school.'),
    Balance: e(
      'Balance',
      'basic',
      'docs/spec-domain-reference.md:430',
      'The Balance magic school.',
    ),
    Life: e('Life', 'basic', 'docs/spec-domain-reference.md:430', 'The Life magic school.'),
    Death: e('Death', 'basic', 'docs/spec-domain-reference.md:430', 'The Death magic school.'),
    Myth: e('Myth', 'basic', 'docs/spec-domain-reference.md:430', 'The Myth magic school.'),
  },
};

/** Which enum the values of a field belong to. */
export const ENUM_OF_FIELD: Readonly<Record<string, string>> = {
  m_activityType: 'ActivityType',
  m_goalType: 'GoalType',
  m_bountyType: 'BountyType',
  m_operator: 'RequirementOperator',
  m_routingType: 'RoutingType',
  m_teleportType: 'TeleportType',
  m_targetType: 'TargetType',
  m_magicSchool: 'MagicSchool',
  m_magicSchoolName: 'MagicSchool',
};

export const GLOSSARY = { fields, classes, enums, groups } as const;

/** The entry of a document key, or `undefined`. */
export function fieldTerm(key: string): GlossaryEntry | undefined {
  return Object.prototype.hasOwnProperty.call(fields, key) ? fields[key] : undefined;
}

const TYPE_STRING = /^Imcodec\.ObjectProperty\.TypeCache\.([^,]+), Imcodec\.ObjectProperty$/;

/** The short class name of a short name or an assembly-qualified `$type` string. */
export function shortClassName(typeOrShort: string): string {
  const match = TYPE_STRING.exec(typeOrShort);
  return match === null ? typeOrShort : match[1];
}

/** The entry of a class, from its short name or its assembly-qualified `$type`. */
export function classTerm(typeOrShort: string): GlossaryEntry | undefined {
  const name = shortClassName(typeOrShort);
  return Object.prototype.hasOwnProperty.call(classes, name) ? classes[name] : undefined;
}

/** The entry of one enum literal. */
export function enumTerm(enumName: string, literal: string): GlossaryEntry | undefined {
  const table = Object.prototype.hasOwnProperty.call(enums, enumName) ? enums[enumName] : undefined;
  return table !== undefined && Object.prototype.hasOwnProperty.call(table, literal)
    ? table[literal]
    : undefined;
}

/** The entry of a value of a field whose values are an enum (`m_goalType` -> `GoalType`). */
export function fieldValueTerm(fieldKey: string, literal: string): GlossaryEntry | undefined {
  const enumName = Object.prototype.hasOwnProperty.call(ENUM_OF_FIELD, fieldKey)
    ? ENUM_OF_FIELD[fieldKey]
    : undefined;
  return enumName === undefined ? undefined : enumTerm(enumName, literal);
}

/** The entry of a dialog section name. */
export function groupTerm(name: string): GlossaryEntry | undefined {
  return Object.prototype.hasOwnProperty.call(groups, name) ? groups[name] : undefined;
}

/** The friendly label of a document key, or the key itself when it has no entry (never a guess). */
export function fieldLabel(key: string): string {
  return fieldTerm(key)?.label ?? key;
}

/**
 * A document key's tier (D172): `advanced` only when the glossary says so. A key with no entry is
 * `basic`, so the editor never hides a field the glossary has not classified.
 */
export function fieldTier(key: string): GlossaryTier {
  return fieldTerm(key)?.tier ?? 'basic';
}

/** The label of a dialog section name, or the name itself. */
export function groupLabel(name: string): string {
  return groupTerm(name)?.label ?? name;
}

/** What a `<TermLabel />` names. */
export type TermRef =
  { field: string } | { type: string } | { enum: string; value: string } | { group: string };

/** The entry and the technical half of a term. The technical half of a group is its own name. */
export function resolveTerm(ref: TermRef): { entry: GlossaryEntry | undefined; technical: string } {
  if ('field' in ref) {
    return { entry: fieldTerm(ref.field), technical: ref.field };
  }
  if ('type' in ref) {
    return { entry: classTerm(ref.type), technical: shortClassName(ref.type) };
  }
  if ('enum' in ref) {
    return { entry: enumTerm(ref.enum, ref.value), technical: ref.value };
  }
  return { entry: groupTerm(ref.group), technical: ref.group };
}
