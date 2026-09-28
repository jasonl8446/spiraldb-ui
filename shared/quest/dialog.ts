import { z } from 'zod';

import { RequirementListFieldSchema } from './requirements.js';
import { opaqueArray, opaqueObject, passthroughObject } from './schemaKit.js';
import { TYPE_STRINGS } from './typeConstants.js';

/**
 * Dialog types — [spec-domain-reference.md] L444-523, task 3.1.
 *
 * `ActorDialogList` (`{$type, m_dialogs}`, 797 occurrences on the owner's `f9a1055` baseline,
 * was 767) wraps untagged dialog *blocks* tagged `Prep` / `Completion` / `Hyperlink` / `""`
 * (measured 322 / 442 / 5 / 5 — the tag is a free string, never an enum), each block holding
 * `NPCDialogEntry` nodes, madlib templates and dialog events.
 *
 * `ActorDialog` is the **typed** form of that block, absent from the 322-file corpus and
 * measured **5 times** at this baseline: always `ResActorDialog.m_dialog`, carrying `$type`
 * plus the same six value keys the untagged blocks carry. Both spellings are modelled (they
 * are the same shape with and without the annotation), so a save preserves whichever the
 * document used — {@link ActorDialogBlockSchema} for `m_dialogs[]`, {@link ActorDialogSchema}
 * for the tagged node.
 *
 * `NPCDialogEntry` is the widest type in the corpus: **66 distinct fields** across 1,884 nodes
 * (was 1,706), 14+ of which carry an explicit `null` somewhere (`m_requirements` is `null` on
 * all 1,882 nodes that carry the key, `m_nameSTKey` 92×, and a dozen more 2× each). Every field
 * here is therefore `.nullish()` — absent *and* explicit `null` are both "no value" per
 * `NullValueHandling.Ignore`, and neither is rewritten (D5: an absent key is never
 * injected, an explicit `null` is never deleted).
 *
 * `$type` is **optional on an entry** at this baseline: 2 of the 1,884 corpus entries carry no
 * `$type` at all (`questtemplates_WC-TRITON-MAIN-004.json`'s quest-level
 * `m_dialogList.m_dialogs[0].m_dialogEntries[4]` and `-007.json`'s `[5]`, each the 58-key
 * `sparse58NoType` shape the p3-08 dialog model records). Every one of the 1,882 that *do*
 * carry one carries the `NPCDialogEntry` literal, so the literal is kept and only its presence
 * is relaxed — a **wrong** `$type` still fails loudly, and the editor's `$type` reader already
 * returns `null` for a typeless entry instead of inventing one (D64).
 *
 * The madlib chain (`m_dialogs[].m_madlibs[]` → `m_madlibBlock` → `m_madlibs[]`) bottoms out
 * in `MadlibArgT_ByteString`: the **commonest** `$type` in the corpus (4,175 occurrences, was
 * 3,685) and one that no spec or plan list mentions. It is also the most deeply nested type in
 * the document, which is why it is modelled explicitly — a save cannot quietly lose it.
 */

/** `m_madlibs[].m_madlibBlock.m_madlibs[]` ([spec-domain-reference.md] L509). */
export const MadlibArgSchema = passthroughObject({
  $type: z.literal(TYPE_STRINGS.MadlibArgT_ByteString),
  m_madlibArgument: z.string().nullish(),
  m_madlibToken: z.string().nullish(),
});

/** `m_dialogs[].m_madlibs[].m_madlibBlock`. */
export const MadlibBlockSchema = passthroughObject({
  m_blockToken: z.string().nullish(),
  m_madlibs: z.array(MadlibArgSchema).nullish(),
});

/** `m_dialogs[].m_madlibs[]` — `{m_index, m_madlibBlock}`. */
export const MadlibSchema = passthroughObject({
  m_index: z.number().nullish(),
  m_madlibBlock: MadlibBlockSchema.nullish(),
});

/**
 * One dialog entry. Field list per [spec-domain-reference.md] L444-523 (Basic / Camera /
 * Duration & Timing / Walk-Away / Audio / Animation & NPC / UI Controls); every one is
 * optional, and any field the corpus has that is not listed here passes through untouched.
 */
export const NPCDialogEntrySchema = passthroughObject({
  // Optional: 2 of the 1,884 corpus entries carry no `$type` (see the module header). A
  // present-but-wrong `$type` still fails, and nothing here ever invents one.
  $type: z.literal(TYPE_STRINGS.NPCDialogEntry).nullish(),

  // Basic
  m_personaName: z.string().nullish(),
  m_nameOverride: z.string().nullish(),
  m_nameSTKey: z.string().nullish(),
  m_guiDisplay: z.string().nullish(),
  m_maxTimeSeconds: z.number().nullish(),
  m_invisible: z.boolean().nullish(),
  m_requirements: RequirementListFieldSchema,
  m_dialog: z.string().nullish(),
  m_picture: z.string().nullish(),
  m_soundFile: z.string().nullish(),
  m_action: z.string().nullish(),
  m_dialogEvent: z.string().nullish(),
  m_actorTemplateID: z.number().nullish(),

  // Camera
  m_cameraName: z.string().nullish(),
  m_interpolationDuration: z.number().nullish(),
  m_cameraOffsetX: z.number().nullish(),
  m_cameraOffsetY: z.number().nullish(),
  m_cameraOffsetZ: z.number().nullish(),
  m_pitch: z.number().nullish(),
  m_yaw: z.number().nullish(),
  m_roll: z.number().nullish(),
  m_cameraShakeType: z.string().nullish(),
  m_cameraShakeDuration: z.number().nullish(),
  m_cameraShakeAmplitude: z.number().nullish(),
  m_bypassCameraOnReview: z.boolean().nullish(),
  m_cameraZoneName: z.string().nullish(),
  m_cameraHidePlayers: z.number().nullish(),
  m_cameraFadeType: z.string().nullish(),
  m_cameraFadeTime: z.number().nullish(),
  m_secondaryCameraName: z.string().nullish(),
  m_secondaryInterpolationDuration: z.number().nullish(),
  /** The corpus's own spelling is "Inital" (sic) — do not correct it. */
  m_secondaryCameraInitalDelay: z.number().nullish(),
  m_dontReleaseCameraAtExit: z.boolean().nullish(),
  m_fadeOutCamera: z.boolean().nullish(),
  m_snapCameraToPlayerAtExit: z.boolean().nullish(),

  // Duration & Timing
  m_duration: z.number().nullish(),
  m_delay: z.number().nullish(),
  m_spamTime: z.number().nullish(),
  m_playSoundIfSpamming: z.boolean().nullish(),
  m_playMusicIfSpamming: z.boolean().nullish(),
  m_displayButtonsOnTimedDialog: z.boolean().nullish(),

  // Walk-Away
  m_walkAwayNpcTemplateID: z.number().nullish(),
  m_walkAwayExitDirectionInDegrees: z.number().nullish(),
  m_walkAwayFadeTime: z.number().nullish(),
  m_walkAwayUseCurrentFacing: z.boolean().nullish(),
  m_standInPlayerTag: z.string().nullish(),

  // Audio
  m_soundEffectFile: z.string().nullish(),
  m_musicFile: z.string().nullish(),
  m_nonStackableMusic: z.boolean().nullish(),
  m_nonRepeatableMusic: z.boolean().nullish(),
  m_playMusicAtSFXVolume: z.boolean().nullish(),
  m_soundEffectDelay: z.number().nullish(),
  m_musicDelay: z.number().nullish(),
  m_musicFadeTime: z.number().nullish(),
  m_stopMusicFadeTime: z.number().nullish(),
  m_restartMusicFadeTime: z.number().nullish(),

  // Animation & NPC
  m_idleAnimation: z.string().nullish(),
  m_npcStandInList: opaqueArray.nullish(),
  m_dialogAnimationList: opaqueArray.nullish(),
  m_dialogTurningList: opaqueArray.nullish(),
  m_npcYawOffsetInDegrees: z.number().nullish(),
  m_allowPlayerToMove: z.boolean().nullish(),
  /** Spec-listed here (L517) but never present on a corpus entry; reserved verbatim. */
  m_defaultDialogAnimation: opaqueObject.nullish(),

  // UI Controls
  m_disableBackButton: z.boolean().nullish(),
  m_enableExitButton: z.boolean().nullish(),
  m_meetsRequirements: z.boolean().nullish(),
});

/** A dialog entry. */
export type NPCDialogEntry = z.infer<typeof NPCDialogEntrySchema>;

/**
 * `m_dialogs[]` — one tagged dialog block. The six keys are exact in all 739 measured
 * blocks; `m_dialogTag` stays a free string (empty tags occur).
 */
export const ActorDialogBlockSchema = passthroughObject({
  m_dialogTag: z.string().nullish(),
  m_dialogEntries: z.array(NPCDialogEntrySchema).nullish(),
  m_madlibs: z.array(MadlibSchema).nullish(),
  m_dialogEvents: opaqueArray.nullish(),
  m_noAggroWhileDialogIsUp: z.boolean().nullish(),
  m_noAggroNoDelay: z.boolean().nullish(),
});

/**
 * The **typed** dialog block — `ResActorDialog.m_dialog` on the owner's `f9a1055` baseline
 * (5 occurrences, 3 quests).
 *
 * Same six value keys as {@link ActorDialogBlockSchema} plus the `$type` annotation, in the
 * corpus's own order: `$type, m_dialogTag, m_dialogEntries, m_madlibs, m_dialogEvents,
 * m_noAggroWhileDialogIsUp, m_noAggroNoDelay`. `extend` keeps the passthrough policy, so the
 * unknown keys of either spelling still survive (D5).
 */
export const ActorDialogSchema = ActorDialogBlockSchema.extend({
  $type: z.literal(TYPE_STRINGS.ActorDialog),
});

/** A typed dialog block (`ResActorDialog.m_dialog`). */
export type ActorDialog = z.infer<typeof ActorDialogSchema>;

/** `ActorDialogList` — `{$type, m_dialogs}` ([spec-domain-reference.md] L263). */
export const ActorDialogListSchema = passthroughObject({
  $type: z.literal(TYPE_STRINGS.ActorDialogList),
  m_dialogs: z.array(ActorDialogBlockSchema).nullish(),
});

/** A dialog list (`m_dialogList` on the quest or on a Persona goal). */
export type ActorDialogList = z.infer<typeof ActorDialogListSchema>;

/** `m_dialogList` slot: a list, an explicit `null` (327 corpus goals), or absent. */
export const ActorDialogListFieldSchema = ActorDialogListSchema.nullish();
