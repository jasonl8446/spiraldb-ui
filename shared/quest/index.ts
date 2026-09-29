/**
 * The quest domain — TypeScript types + Zod schemas (task 3.1 / p3-01).
 *
 * One module per concern, all re-exported here so both halves of the app import the same
 * definitions:
 *
 * | module | contents |
 * |---|---|
 * | `./typeConstants.js` | the corpus-driven `$type` constant table (29 measured at the owner's `f9a1055` baseline, 0 spec-only), goal/result/requirement sub-tables, `m_goalType` / magic-school / operator enums |
 * | `./schemaKit.js` | `passthroughObject` (D5 unknown-key policy) and the null-tolerant field helpers |
 * | `./requirements.js` | the 4 requirement leaves + the recursive `RequirementList` wrapper |
 * | `./results.js` | the 15-member result union (the spec's 14 + the corpus-only `ResActorDialog`), `ResultList`, `SoundRouter`, `TallyCounter` |
 * | `./dialog.js` | `ActorDialogList`, the untagged dialog block, the typed `ActorDialog`, `NPCDialogEntry`, the madlib chain |
 * | `./goals.js` | the 5-goal discriminated union on `$type` + the 24 shared base fields |
 * | `./questTemplate.js` | `QuestTemplate` (36 top-level fields) + `GoalLogicEntry` |
 * | `./request.js` | the `POST /api/quests` body schema + issue formatting |
 * | `./scaffold.js` | the corpus's 36-key order + the minimal scaffold document (task 6.8) |
 *
 * Usage is the same on the server and in the client:
 *
 * ```ts
 * import { QuestTemplateSchema, TYPE_STRINGS } from '@shared/quest/index';
 * ```
 *
 * The server imports the compiled relative path (`shared/quest/index.js`) because its
 * `tsconfig.json` uses `NodeNext`; the client and the tests use the `@shared/*` alias.
 * `shared/index.ts` deliberately does **not** re-export this directory: that file is
 * imported by the client bundle as `@shared/index`, and keeping quest schemas off that
 * barrel keeps `zod` out of any import graph that does not need it.
 */

export * from './typeConstants.js';
export * from './schemaKit.js';
export * from './requirements.js';
export * from './results.js';
export * from './dialog.js';
export * from './goals.js';
export * from './questTemplate.js';
export * from './request.js';
export * from './scaffold.js';
