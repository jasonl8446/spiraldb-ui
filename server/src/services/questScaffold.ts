import path from 'node:path';

import { buildQuestScaffold, type QuestScaffoldLinkKind } from '../../../shared/quest/scaffold.js';
import {
  describeSchemaIssues,
  SaveQuestRequestSchema,
  schemaFieldErrorMap,
} from '../../../shared/quest/request.js';
import { validateQuest } from '../../../shared/quest/validation.js';
import { blockingSummary, fieldErrorMap } from '../../../shared/quest/validation-messages.js';
import { NamingError } from '../../../shared/naming.js';
import type { Db } from '../db.js';
import {
  acceptSuggestions,
  assertAcceptableSuggestions,
  parseAcceptedSuggestions,
  type SuggestionDraft,
} from './drafts.js';
import { loadValidationReferences } from './names.js';
import { QuestRequestError } from './quests.js';
import { isPlainObject } from './sync/json.js';
import { collectionSpec, createTargetPath } from './spiraldbFiles.js';
import type { SavePipeline } from './savePipeline.js';
import type { SpiraldbIndex } from './spiraldbIndex.js';

/**
 * Scaffold-from-catalog — the write half of plan task 6.8 / story **p6-09**
 * (decisions D100 (a real file from the moment it is written, no draft lifecycle) and
 * D101 (a minimal skeleton; nothing inferred is ever written)).
 *
 * `POST /api/quests/scaffold` is the surface the Catalog view's **Create quest** button
 * (task 6.10, `docs/spec-ui-design.md` §10) will call; the CLI
 * (`npm run scaffold:quest`, `scripts/scaffold-quest.ts`) is the same path with a
 * command line, which is what task 6.11/p6-12 boots Imlight against.
 *
 * Five rules, each one measured rather than assumed:
 *
 * 1. **The target is validated before anything else happens**, and it must be inside the
 *    family's own directory (ac3). `createTargetPath` joins the family directory with
 *    `fileNameFor(...)`, which does **not** sanitise its key: a name carrying path
 *    segments (`x/../../evil`) normalises to a path *outside* `QuestTemplates/`. The
 *    guard is the writer's first statement, so no database row, no index scan and no
 *    pipeline call happens for a name that would write elsewhere.
 * 2. **The quest must be a catalog row that has no definition yet.** A name the catalog
 *    does not hold is `404`; a name that *does* have a file is refused `409`, because a
 *    scaffold is the minimal skeleton and the pipeline's update path merges an explicit
 *    `null` **over** the existing value (D45(1): "the incoming value wins, including an
 *    explicit null") — so scaffolding an authored quest would blank it.
 * 3. **The title is written only for a direct link** (ac2, P6-6/D106). The key comes from
 *    the world's own direct link, which the catalog persists in two places: the id tier's
 *    `quest_ids.title_key` when the linked id has text tables, and — when it does not —
 *    `quests.title`, the *text* the sync resolved from that key. The key is recovered
 *    from the text **only when exactly one `QuestTitle_*` key carries it**: an ambiguous
 *    text (10 of the clone's 285 direct links) writes no title, because picking one of two
 *    ids that share a string is a guess about which quest owns the text.
 * 4. **The metadata's `Description` records the provenance** (ac2). `Description` is the
 *    one free-text field of the frozen 7-key metadata contract
 *    (`docs/spec-data-model.md` L193-204, `QUEST_METADATA_KEYS`) and already carries the
 *    tool's own provenance for extraction saves (`Quest extracted from packet capture.`),
 *    so the scaffold follows that precedent instead of adding an eighth key. The wording
 *    names the link kind and whether a title was written — the two facts a later reader
 *    of the metadata file needs in order to know what this file is.
 * 5. **`has_definition` is not touched.** It is the sync's column and it flips to 1 on
 *    the next sync because the file now exists (ac3); the API response reports the value
 *    it read, and the editor is opened from the **file** (the save pipeline's result),
 *    never from a column this call would have to guess at.
 *
 * The document itself is `shared/quest/scaffold.ts`'s, and it is validated against the
 * save pipeline's own request schema here before the write, so a scaffold that could not
 * be saved back through `POST /api/quests` fails loudly rather than landing on disk.
 */

/** The scaffold refusals a caller can act on; the route maps `status` verbatim. */
export class QuestScaffoldError extends Error {
  /** HTTP status the route answers with. */
  readonly status: 400 | 404 | 409;

  constructor(message: string, status: 400 | 404 | 409) {
    super(message);
    this.name = 'QuestScaffoldError';
    this.status = status;
  }
}

/** The family directory a quest file must live in — `QuestTemplates` (docs/spec-data-model.md). */
export const QUEST_TEMPLATES_DIRECTORY = collectionSpec('questtemplates').directory;

/**
 * The path a scaffold writes — from the naming convention's single home
 * (`createTargetPath` → `fileNameFor`) — after both refusals.
 *
 * **Two layers refuse, and both are measured.** `fileNameFor` refuses a key that is blank,
 * carries a path separator (`/` or `\`), carries a NUL or already ends in `.json`
 * (`shared/naming.ts` L194-235), so the `x/../../evil` shape this story's ac3 names never
 * reaches a filesystem call; its `NamingError` is **converted here to the writer's own
 * `QuestScaffoldError`**, because a name the caller can fix must be a 400 with an
 * actionable message rather than the naming layer's 500. `assertQuestTemplateTarget` then
 * checks the resolved path itself, as the writer's last act before the write.
 *
 * @throws {QuestScaffoldError} with status 400 — an unusable name or an unsafe target.
 */
export function questTemplateTargetPath(root: string, name: string): string {
  let target: string;
  try {
    target = createTargetPath(root, collectionSpec('questtemplates'), name);
  } catch (error) {
    if (error instanceof NamingError) {
      throw new QuestScaffoldError(`Refusing to scaffold "${name}": ${error.message}`, 400);
    }
    throw error;
  }
  assertQuestTemplateTarget(root, name, target);
  return target;
}

/**
 * Refuses any target that is not **directly inside** `<root>/QuestTemplates/` (ac3).
 *
 * The check resolves first (`path.resolve` normalises the `..` segments a hostile name
 * introduces) and then requires the resolved path's parent to **be** the family
 * directory. Requiring the parent rather than a string prefix is what makes both escape
 * shapes refuse:
 *
 * - `x/../../evil` normalises to `<root>/evil.json` — outside the family tree entirely;
 * - `a/b` stays *under* `QuestTemplates/` but lands in a subdirectory
 *   (`QuestTemplates/questtemplates_a/b.json`), where the content-keyed index — which
 *   scans the family directory's own entries — would never find it, so the "created"
 *   entry would be unreachable.
 *
 * A refusal names the refused path, the directory it should have been in, and the name
 * that produced it — the message is actionable because the caller is a UI.
 *
 * @throws {QuestScaffoldError} with status 400.
 */
export function assertQuestTemplateTarget(root: string, name: string, target: string): void {
  const directory = path.resolve(root, QUEST_TEMPLATES_DIRECTORY);
  const resolved = path.resolve(target);
  if (path.dirname(resolved) !== directory) {
    throw new QuestScaffoldError(
      `Refusing to scaffold "${name}" at ${resolved}: a quest file is written directly inside ` +
        `${directory}, and nothing is ever written outside it. The name must not carry path ` +
        `segments ("/" or "..").`,
      400,
    );
  }
}

/**
 * The `Description` a scaffold writes into the companion metadata — the catalog
 * provenance (ac2). Stable prefix so a reader or a test can recognise the family, then
 * the two facts that distinguish one scaffold from another.
 */
export const SCAFFOLD_METADATA_DESCRIPTION_PREFIX = 'Scaffolded from the quest catalog';

export function scaffoldMetadataDescription(link: {
  kind: QuestScaffoldLinkKind;
  titleKey: string | null;
}): string {
  const title =
    link.titleKey === null
      ? link.kind === 'direct'
        ? 'no title: the direct link resolved to no single title key'
        : `no title: only a direct link writes one, and this link is ${link.kind}`
      : `title ${link.titleKey}`;
  return `${SCAFFOLD_METADATA_DESCRIPTION_PREFIX} (link_kind: ${link.kind}; ${title}).`;
}

/** The catalog row a scaffold is built from. */
export interface CatalogRow {
  quest_name: string;
  title: string;
  has_definition: number;
  link_kind: string | null;
}

/**
 * Reads the row's link and the title key this scaffold is allowed to write.
 *
 * The direct link's key is resolved in the order the catalog persists it:
 * `quest_ids.title_key` for the linked id, else `quests.title_key` (migration 0006, the
 * link's own key, exact even when two keys share a text), else — for a database synced
 * before 0006 — a **unique** reverse lookup of `quests.title` in the `QuestTitle_*` keys.
 * Measured on the owner fork's sync before 0006: of 285 `link_kind = 'direct'` rows, 170
 * resolve through the id tier, 105 through a unique reverse lookup, and 10 were ambiguous
 * (two keys share the text) — those wrote no title; `quests.title_key` resolves all 285.
 *
 * The reverse lookup is a recovery, not an inference: the text in `quests.title` **is**
 * the value of the link's own key (the sync resolved it from `record.link.title_key`),
 * so a single candidate is that key. Two candidates are two different quest ids that
 * happen to carry the same string, and choosing one would be a guess about identity —
 * which is why the scaffold writes no title instead.
 */
export function resolveLink(
  db: Db,
  row: CatalogRow,
): { kind: QuestScaffoldLinkKind; titleKey: string | null } {
  const kind = (row.link_kind ?? 'none') as QuestScaffoldLinkKind;
  if (kind !== 'direct') {
    return { kind, titleKey: null };
  }

  const idRow = db
    .prepare<[string], { title_key: string | null }>(
      'SELECT title_key FROM quest_ids WHERE matched_quest_name = ? ORDER BY quest_id LIMIT 1',
    )
    .get(row.quest_name);
  if (idRow?.title_key) {
    return { kind, titleKey: idRow.title_key };
  }

  const ownKey = db
    .prepare<[string], { title_key: string | null }>(
      'SELECT title_key FROM quests WHERE quest_name = ?',
    )
    .get(row.quest_name);
  if (ownKey?.title_key) {
    return { kind, titleKey: ownKey.title_key };
  }

  const candidates = db
    .prepare<[string], { key: string }>(
      "SELECT key FROM string_table WHERE key LIKE 'QuestTitle\\_%' ESCAPE '\\' AND value = ? ORDER BY key",
    )
    .all(row.title);
  return { kind, titleKey: candidates.length === 1 ? candidates[0].key : null };
}

export { resolveScaffoldBranch, type ScaffoldBranchDecision } from './git.js';

export interface ScaffoldQuestOptions {
  db: Db;
  index: SpiraldbIndex;
  pipeline: SavePipeline;
  /** The catalog name to scaffold — `quests.quest_name`, or the name an unnamed draft is given. */
  name: string;
  /** Optional commit-message body. */
  notes?: string;
  /**
   * Task 7.7 (D142): the editor's in-memory document — the skeleton plus the fields the user
   * accepted — written in the scaffold's single commit instead of the bare skeleton.
   */
  quest?: Record<string, unknown>;
  /** Task 7.7 (D142): the draft's `quest_ids.quest_id`; an unlinked one is named by this save. */
  catalogId?: number;
  /** Task 7.7 (D141): the suggestion ids the document applies, flipped after the commit. */
  acceptedSuggestions?: readonly number[];
}

/** The `POST /api/quests/scaffold` body, reduced to what the service needs. */
export interface ScaffoldQuestRequest {
  name: string;
  notes: string | undefined;
  quest: Record<string, unknown> | undefined;
  catalogId: number | undefined;
  acceptedSuggestions: number[];
}

/**
 * Validates the scaffold request body — `{ quest_name, notes? }`.
 *
 * Kept here rather than in the route so the contract is unit-testable without a server,
 * and to follow the shape `saveQuest` established (a hand-written check with an
 * actionable message, then the work). `notes` behaves exactly as it does on
 * `POST /api/quests`: `null`/absent means "no commit body", anything else that is not a
 * string is a 400.
 *
 * @throws {QuestScaffoldError} with status 400.
 */
export function parseScaffoldRequest(body: unknown): ScaffoldQuestRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new QuestScaffoldError(
      'The request body must be a JSON object carrying the catalog name in "quest_name".',
      400,
    );
  }
  const record = body as Record<string, unknown>;
  const name = record.quest_name;
  if (typeof name !== 'string' || name.trim() === '') {
    throw new QuestScaffoldError(
      'Missing quest_name: the request body must carry the catalog quest name to scaffold.',
      400,
    );
  }
  if (record.notes !== undefined && record.notes !== null && typeof record.notes !== 'string') {
    throw new QuestScaffoldError(
      `Invalid notes: expected a string but received ${
        record.notes === null ? 'null' : typeof record.notes
      }.`,
      400,
    );
  }
  if (record.quest !== undefined && !isPlainObject(record.quest)) {
    throw new QuestScaffoldError(
      'Invalid quest: expected the in-memory quest document as a JSON object.',
      400,
    );
  }
  const catalogId = record.catalog_id;
  if (
    catalogId !== undefined &&
    catalogId !== null &&
    !(typeof catalogId === 'number' && Number.isSafeInteger(catalogId) && catalogId > 0)
  ) {
    throw new QuestScaffoldError(
      `Invalid catalog_id: expected a quest id (a positive integer) but received ${JSON.stringify(
        catalogId,
      )}.`,
      400,
    );
  }
  return {
    name: name.trim(),
    notes: typeof record.notes === 'string' ? record.notes : undefined,
    quest: record.quest as Record<string, unknown> | undefined,
    catalogId: typeof catalogId === 'number' ? catalogId : undefined,
    acceptedSuggestions: parseAcceptedSuggestions(record.accepted_suggestions),
  };
}

export interface ScaffoldQuestResult {
  quest_name: string;
  /** The catalog link the skeleton was built from (`quests.link_kind`). */
  link_kind: QuestScaffoldLinkKind;
  /** The `QuestTitle_*` key written into `m_questTitle`, or `null` when none was. */
  title_key: string | null;
  /** `has_definition` **as read before the write** — the sync flips it on its next run. */
  has_definition_before: 0 | 1;
  outcome: 'created';
  action: string;
  /** Committed paths relative to the SpiralDB root. */
  file: string;
  metadata: string | null;
  commit: string;
  branch: string;
  commit_message: string;
  /** The document that was written — what the editor is opened on. */
  quest: Record<string, unknown>;
  /** The draft's `quest_ids.quest_id`, when the request named one (task 7.7); else `null`. */
  catalog_id: number | null;
  /** `true` when this save named an unnamed-tier draft and created its catalog row (D137/D142). */
  named: boolean;
  /** The suggestion ids flipped to `accepted` after the commit (D141); `[]` when none. */
  accepted_suggestions: number[];
}

/** An unnamed-tier id a draft save names, as the catalog holds it. */
interface CatalogIdRow {
  quest_id: number;
  title_key: string | null;
  title: string | null;
  matched_quest_name: string | null;
}

/**
 * Validates a caller-supplied draft document (task 7.7) exactly as `POST /api/quests` validates
 * its body: the name must be the one being saved, then the shared schema, then the blocking rules
 * of the engine the editor runs. Every refusal happens before the pipeline is called.
 *
 * @throws {QuestScaffoldError} 400 when `m_questName` is not the save's name.
 * @throws {QuestRequestError} 400 (with the per-field map) on a schema or blocking-rule failure.
 */
function assertDraftDocument(db: Db, name: string, quest: Record<string, unknown>): void {
  if (quest.m_questName !== name) {
    throw new QuestScaffoldError(
      `The draft's m_questName (${JSON.stringify(quest.m_questName)}) must equal quest_name ` +
        `"${name}": the file is keyed by it.`,
      400,
    );
  }
  const schema = SaveQuestRequestSchema.safeParse({ quest });
  if (!schema.success) {
    throw new QuestRequestError(
      describeSchemaIssues(schema.error),
      schemaFieldErrorMap(schema.error),
    );
  }
  const rules = validateQuest(quest, { references: loadValidationReferences(db) });
  if (rules.blocked) {
    throw new QuestRequestError(blockingSummary(rules.blocking), fieldErrorMap(rules.blocking));
  }
}

/**
 * Scaffolds one catalog quest into a real `QuestTemplates/<name>.json` through the
 * existing save pipeline (template + companion metadata + commit, D100).
 *
 * @throws {QuestScaffoldError} a refusal the caller can act on (bad name/path, unknown
 * quest, or a quest that already has a definition).
 * @throws {DirtyRepoError} the SpiralDB working tree is dirty (D14) — the pipeline's own
 * refusal, unchanged.
 */
export async function scaffoldQuest(options: ScaffoldQuestOptions): Promise<ScaffoldQuestResult> {
  const { db, index, pipeline, name } = options;
  const accepted = [...(options.acceptedSuggestions ?? [])];

  // 1. ac3 — the guard is the writer's first statement. Nothing is read or written for a
  //    name that would land outside QuestTemplates/. Called for its refusal only: the pipeline
  //    below resolves the target again from `(fileType, key)`, and `questTemplateTargetPath`
  //    asserts the path itself as its last act before returning, so asserting its result here
  //    could only re-run a check the call already made.
  questTemplateTargetPath(index.root, name);

  // 2. Task 7.7 (D137/D142): a `catalog_id` whose row is not linked to any name makes this save
  //    the one that **names** it. The name is the user's, so it must be new — to the catalog and
  //    to the corpus — and a refusal here writes nothing at all.
  let naming: CatalogIdRow | undefined;
  if (options.catalogId !== undefined) {
    const idRow = db
      .prepare<[number], CatalogIdRow>(
        'SELECT quest_id, title_key, title, matched_quest_name FROM quest_ids WHERE quest_id = ?',
      )
      .get(options.catalogId);
    if (idRow === undefined) {
      throw new QuestScaffoldError(
        `Unknown quest id ${options.catalogId}: the catalog's id tier holds no such row.`,
        404,
      );
    }
    if (idRow.matched_quest_name === null) {
      naming = idRow;
    } else if (idRow.matched_quest_name !== name) {
      throw new QuestScaffoldError(
        `Quest id ${options.catalogId} already belongs to "${idRow.matched_quest_name}", not "${name}".`,
        400,
      );
    }
  }

  let row: CatalogRow;
  if (naming !== undefined) {
    const taken =
      db.prepare('SELECT 1 FROM quests WHERE quest_name = ?').get(name) !== undefined ||
      index.pathFor('questtemplates', name) !== undefined;
    if (taken) {
      throw new QuestScaffoldError(
        `"${name}" is already a quest name. Choose a name no catalog row or quest file uses: a ` +
          `quest file is keyed by its name, so two quests cannot share one.`,
        409,
      );
    }
    row = { quest_name: name, title: naming.title ?? name, has_definition: 0, link_kind: 'none' };
  } else {
    // 2b. The catalog row decides whether there is anything to scaffold at all.
    const catalogRow = db
      .prepare<[string], CatalogRow>(
        'SELECT quest_name, title, has_definition, link_kind FROM quests WHERE quest_name = ?',
      )
      .get(name);
    if (catalogRow === undefined) {
      throw new QuestScaffoldError(
        `Unknown quest "${name}": the catalog holds no such row. Run a sync before scaffolding a ` +
          `quest — the catalog is built from the game files (P6-4).`,
        404,
      );
    }
    if (catalogRow.has_definition === 1) {
      throw new QuestScaffoldError(
        `"${name}" already has a definition in ${QUEST_TEMPLATES_DIRECTORY}/. Open it in the editor ` +
          `instead: a scaffold writes the minimal skeleton, and saving it over an authored quest ` +
          `would clear every field it does not carry (D45(1)).`,
        409,
      );
    }
    row = catalogRow;
  }

  // 3. The linked title — direct only (ac2/D101/D106). A named-by-this-save id has no link yet.
  const link =
    naming === undefined ? resolveLink(db, row) : { kind: 'none' as const, titleKey: null };
  let quest: Record<string, unknown>;
  if (options.quest === undefined) {
    quest = buildQuestScaffold({ name, link });

    // 4. Validate with the save pipeline's own request schema before the write: a document
    //    the POST /api/quests contract would reject must never reach disk.
    const validation = SaveQuestRequestSchema.safeParse({ quest });
    if (!validation.success) {
      const issues = validation.error.issues
        .map((issue) => `${issue.path.join('.') || '(body)'}: ${issue.message}`)
        .join('; ');
      throw new QuestScaffoldError(
        `The scaffold for "${name}" does not validate against the quest schema: ${issues}`,
        400,
      );
    }
  } else {
    // 4'. Task 7.7: the editor's document (the skeleton plus accepted fields), validated as
    //     POST /api/quests validates a save — and written as sent, never rebuilt (D57).
    quest = options.quest;
    assertDraftDocument(db, name, quest);
  }

  // D141: the accepted ids are checked before the write. An unnamed draft's rows are keyed by
  // its id (their `quest_name` is NULL until the naming transaction below sets it).
  const draft: SuggestionDraft =
    naming === undefined
      ? { quest_name: name, catalog_id: null }
      : { quest_name: null, catalog_id: naming.quest_id };
  assertAcceptableSuggestions(db, accepted, draft);

  // 5. The real pipeline: file + companion metadata + one commit (D13/D100).
  const result = await pipeline.saveObject({
    fileType: 'questtemplates',
    data: quest,
    key: name,
    action: 'create',
    notes: options.notes,
    metadataDescription:
      options.quest === undefined
        ? scaffoldMetadataDescription({ kind: link.kind, titleKey: link.titleKey })
        : draftMetadataDescription({
            kind: link.kind,
            accepted: accepted.length,
            namedFromId: naming?.quest_id ?? null,
          }),
  });

  // 6. After the commit, in one transaction (D141/D142): the catalog row an unnamed draft gains,
  //    its id's link, its suggestions' name — then the accepted flips. A save that failed above
  //    reached none of this, so every id stays pending and no catalog row is invented.
  db.transaction(() => {
    if (naming !== undefined) {
      nameUnnamedDraft(db, naming, name);
    }
    acceptSuggestions(
      db,
      accepted,
      naming === undefined ? draft : { quest_name: name, catalog_id: naming.quest_id },
    );
  })();

  return {
    quest_name: result.key,
    link_kind: link.kind,
    title_key: link.titleKey,
    has_definition_before: row.has_definition === 1 ? 1 : 0,
    outcome: 'created',
    action: result.action,
    file: result.relativePath,
    metadata: result.metadataRelativePath,
    commit: result.commit,
    branch: result.branch,
    commit_message: result.commitMessage,
    quest,
    catalog_id: naming?.quest_id ?? options.catalogId ?? null,
    named: naming !== undefined,
    accepted_suggestions: accepted,
  };
}

/**
 * The metadata `Description` of a draft save (task 7.7): the scaffold's stable prefix, so the
 * family stays recognisable, then what distinguishes a draft from a bare skeleton — how many
 * accepted suggestions it carries and, for a named unnamed-tier draft, the id it was named from.
 */
export function draftMetadataDescription(draft: {
  kind: QuestScaffoldLinkKind;
  accepted: number;
  namedFromId: number | null;
}): string {
  const named = draft.namedFromId === null ? '' : `; named from quest id ${draft.namedFromId}`;
  return (
    `${SCAFFOLD_METADATA_DESCRIPTION_PREFIX} (link_kind: ${draft.kind}; draft: the skeleton plus ` +
    `${draft.accepted} accepted suggestion${draft.accepted === 1 ? '' : 's'}${named}).`
  );
}

/**
 * D137/D142's catalog writes for an unnamed draft the user just named: the `quests` row, the
 * id's link to it, and the name on that id's suggestion rows.
 *
 * The row is written the way the next sync writes it for a corpus file (`has_definition = 1`,
 * `execute.ts`'s corpus insert), because the file now exists. Both link columns say `direct`:
 * the id is this quest's own by the user's act, and its title key — when it has one — is the
 * quest's own title key.
 */
function nameUnnamedDraft(db: Db, id: CatalogIdRow, name: string): void {
  db.prepare(
    `INSERT INTO quests
       (quest_name, title, level, is_mainline, has_definition, link_kind, title_source, reference_count, title_key)
     VALUES (?, ?, NULL, NULL, 1, 'direct', ?, 0, ?)`,
  ).run(name, id.title ?? name, id.title_key === null ? 'none' : 'direct', id.title_key);
  db.prepare(
    "UPDATE quest_ids SET matched_quest_name = ?, link_kind = 'direct' WHERE quest_id = ?",
  ).run(name, id.quest_id);
  db.prepare(
    'UPDATE quest_suggestions SET quest_name = ? WHERE quest_name IS NULL AND catalog_id = ?',
  ).run(name, id.quest_id);
}
