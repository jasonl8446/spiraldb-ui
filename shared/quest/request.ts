import { z } from 'zod';

import { QuestTemplateSchema } from './questTemplate.js';
import { passthroughObject } from './schemaKit.js';

/**
 * The `POST /api/quests` request body — task 3.1's server-reuse requirement.
 *
 * The service (`server/src/services/quests.ts`) has always accepted
 * `{ quest, notes?, source? }` (decision D49(a)/D50(i)) with the narrow, hand-written 400
 * checks for a missing/blank `quest` and non-string `notes`/`source`. Those checks stay
 * exactly as they are (they carry the actionable messages the Phase-2 tests pin); this
 * schema is the **second** pass that validates the *shape of the quest document itself* with
 * the same types the client editor will use — one source of truth, no second definition of
 * what a quest is.
 *
 * `notes`/`source` are `.nullish()` because the service has always treated `null` as "no
 * note" (D50(i)); they are never written anywhere.
 *
 * Unknown body keys pass through, so a future field cannot make an otherwise valid request
 * fail.
 */
export const SaveQuestRequestSchema = passthroughObject({
  quest: QuestTemplateSchema,
  notes: z.string().nullish(),
  source: z.string().nullish(),
});

/** A validated save request. */
export type SaveQuestRequest = z.infer<typeof SaveQuestRequestSchema>;

/** How many Zod issues the 400 message names before it summarises the rest. */
export const MAX_REPORTED_ISSUES = 6;

/**
 * Renders a Zod failure as one actionable line: up to {@link MAX_REPORTED_ISSUES}
 * `path: message` pairs, then "… and N more". The 400 envelope is still `{error}` only
 * (docs/spec-api.md L227) — the per-field error *map* belongs to the validation engine
 * (task 3.9), which will build on this same schema.
 */
export function describeSchemaIssues(error: z.ZodError): string {
  const issues = error.issues;
  const detail = issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue) => {
      const path = issue.path.length === 0 ? '(body)' : issue.path.join('.');
      return `${path}: ${issue.message}`;
    })
    .join('; ');
  const remaining = issues.length - MAX_REPORTED_ISSUES;
  return remaining > 0
    ? `Invalid quest payload: ${detail}; … and ${remaining} more.`
    : `Invalid quest payload: ${detail}.`;
}
