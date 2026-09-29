import type { Db } from '@server/db';

/**
 * The two friendly-name seeds the Phase-6 suites share — one `string_table` row and one `npcs` row.
 *
 * Both bodies were byte-identical in `quest-evidence.test.ts` and `npc-names.test.ts`, and the
 * signatures are the ones those two files use (`seedString` with an explicit `category`, `seedNpc`
 * with a template id). The **variant** spellings elsewhere are deliberately not folded in: the
 * pre-existing `quests-api.test.ts` seed hard-codes `'QuestTitle'` as its category and
 * `search.test.ts` / `objects-api.test.ts` predate this phase, so each is a different shape its own
 * arms depend on — changing one to reuse this would be a silent scope expansion, not a cleanup.
 */

/** One `string_table` row, in the category the caller names. */
export function seedString(db: Db, key: string, value: string, category: string): void {
  db.prepare('INSERT INTO string_table (key, value, category) VALUES (?, ?, ?)').run(
    key,
    value,
    category,
  );
}

/** One `npcs` row — the friendly source the four `TemplateID` families share. */
export function seedNpc(db: Db, templateId: number, name: string): void {
  db.prepare('INSERT INTO npcs (template_id, name) VALUES (?, ?)').run(templateId, name);
}
