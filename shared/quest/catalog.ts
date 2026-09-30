/**
 * Quest coverage + catalog — the wire contract of task 6.10 / story **p6-11**
 * ([spec-api.md](../../../docs/spec-api.md) L442-464, [spec-ui-design.md](../../../docs/spec-ui-design.md) L639-679).
 *
 * This module is the **single home of the two endpoint paths and of the one query parameter**
 * the catalog read accepts. It is deliberately pure and dependency-free: the server's route
 * imports it to build the read, the client's query builder imports it to build the request, and
 * neither can drift into a second spelling of `missing_only` without failing a test that reads
 * this file.
 *
 * The `/\* types *\/` half of the old duplication is deliberately **not** here. The server owns
 * its own result interfaces (`server/src/services/questCoverage.ts`) and the client owns the wire
 * types it parses (`client/src/lib/quest-catalog.ts`), which is the same split every other
 * endpoint in this project uses (the client's `api.ts` documents the shapes it consumes, and the
 * spec-api table fixes no shapes). What must not be duplicated is the **literal strings** both
 * halves put on the wire, and that is what lives here.
 */

/** `GET /api/quests/coverage` — the `coverage` view, both denominators plus the corpus. */
export const QUEST_COVERAGE_PATH = '/api/quests/coverage';

/** `GET /api/quests/catalog` — the catalog worklist. */
export const QUEST_CATALOG_PATH = '/api/quests/catalog';

/**
 * The catalog read's first parameter, `?missing_only=` — `1`/`true` narrows to
 * `has_definition = 0`, `0`/`false`/absent means no filter, anything else is a `400`
 * (a malformed query parameter is refused, never silently clamped).
 */
export const MISSING_ONLY_PARAM = 'missing_only';

/**
 * The catalog read's second parameter, `?q=` (D186) — a case-insensitive literal substring
 * matched against the quest name **or** the title, applied in the read's SQL and combined (AND)
 * with `missing_only`. Absent/blank means no search; a repeated or over-long value is a `400`.
 */
export const CATALOG_Q_PARAM = 'q';

/** The longest `?q=` the catalog accepts (a quest name is under 40 characters). */
export const CATALOG_Q_MAX_LENGTH = 200;

/*
 * Ordering note, kept beside the paths it constrains: both static routes are registered
 * **before** `/api/quests/:name`, which would otherwise capture `coverage` (stated as part of
 * the contract in spec-api.md L444-445) and, for `catalog`, shadow a quest a catalog happens
 * to name `catalog` — the same trade the frontend route table already accepts
 * (spec-api.md L1023-1027). `server/src/routes/quests.ts` is the one place that order lives.
 */
