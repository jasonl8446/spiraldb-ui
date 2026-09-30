/**
 * The NPC page's route (task 7.14, D144) — one home for the path that the search palette and the
 * Evidence panel's speaker names both link to. The id is either form `GET /api/npcs/:id`
 * accepts: a template id or an alias key (`WC-NPCs_00000003`).
 */
export function npcPagePath(id: string | number): string {
  return `/npcs/${encodeURIComponent(String(id))}`;
}
