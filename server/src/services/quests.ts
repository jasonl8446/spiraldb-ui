import path from 'node:path';

import {
  SaveQuestRequestSchema,
  describeSchemaIssues,
  schemaFieldErrorMap,
} from '../../../shared/quest/index.js';
import { validateQuest } from '../../../shared/quest/validation.js';
import { blockingSummary, fieldErrorMap } from '../../../shared/quest/validation-messages.js';
import type { Db } from '../db.js';
import {
  acceptSuggestions,
  assertAcceptableSuggestions,
  parseAcceptedSuggestions,
} from './drafts.js';
import {
  collectionSpec,
  objectKeyFromData,
  readSpiraldbJson,
  relativeTo,
  SpiraldbFileError,
} from './spiraldbFiles.js';
import type { SpiraldbIndex } from './spiraldbIndex.js';
import type { SaveObjectResult, SaveOutcome, SavePipeline } from './savePipeline.js';
import { questMetadataSaveTarget } from './savePipeline.js';
import { isStatusValue, listStatus, type StatusSummary, type StatusValue } from './status.js';
import { buildQuestRows } from './sync/corpus.js';
import { isPlainObject } from './sync/json.js';
import { loadValidationReferences } from './names.js';
import { createStringLookup } from './sync/lookup.js';

/**
 * Quests API data layer — task 2.5 (docs/plan-phase-2-quest-extraction.md §2.5,
 * docs/spec-api.md L164-180).
 *
 * Three operations, one per endpoint:
 *
 * - `listQuests` — the browse list. Per decision **D12** it reads on demand: one
 *   directory scan + JSON5 parse per request (322 files locally, measured tens of
 *   milliseconds), joined with `entry_status`. It returns the columns the table
 *   needs (docs/spec-ui-design.md L254-262) and the per-status tally the filter
 *   tabs show; searching/filtering itself is client-side over this payload (p2-08).
 * - `readQuest` — one quest, resolved through the **D19** content-keyed index
 *   (never by deriving the filename), read with the JSON5-tolerant reader so a
 *   legacy file with trailing commas parses.
 * - `saveQuest` — the task 2.4 pipeline with body `{ quest, notes?, source? }`
 *   (`source` is the capture file, recorded as the create's history note — gap B),
 *   plus the **D48(d)** ambiguity report: 8 of the 316 quest names in
 *   `QuestMetadatas/` have two metadata files, so a save of such a name proceeds
 *   deterministically (first file in name order, the index's own rule) and *says
 *   so* in `warnings`.
 *
 * No enum conversion happens anywhere here (decision D48(a): the CLI emits enum
 * names that already match the corpus).
 */

/**
 * A malformed `POST /api/quests` body — the route maps it to **400**. Covers the things a
 * caller can fix by resending: the narrow, hand-written checks (`quest` missing or keyless,
 * `notes` not a string, `source` not a string), the failure of the shared Zod schemas the
 * editor also uses (`shared/quest/request.ts`), and — since task 3.9 — the failure of the
 * shared **rule** engine (`shared/quest/validation.ts`). Pipeline problems are **not** this
 * error, so they still map to 500.
 *
 * {@link fields} is the per-field error map the 400 body carries (story p3-09's AC): path →
 * messages, keyed by the shared `formatDocPath` so a client can render each message under the
 * control that owns it. Both passes fill it — the schema pass from Zod's issue paths, the rule
 * pass from the engine's finding paths — and the hand-written checks leave it `undefined`,
 * exactly as the Phase-2 body contract behaved (`{error}` only).
 */
export class QuestRequestError extends Error {
  readonly fields?: Record<string, string[]>;

  constructor(message: string, fields?: Record<string, string[]>) {
    super(message);
    this.name = 'QuestRequestError';
    this.fields = fields;
  }
}

/* ------------------------------------------------------- capture source (gap B) */

/**
 * The longest capture name kept in a history note. `status_history.notes` is free
 * text, so this is hygiene rather than a schema limit: a body that carries a
 * megabyte of "filename" must not become the note.
 */
export const MAX_CAPTURE_SOURCE_LENGTH = 255;

/**
 * The `status_history` note an extraction save records on a **create** — plan
 * §2.4's save-sequence bullet, `Imported from packet capture {filename}`
 * (docs/spec-architecture.md L97, docs/spec-api.md L122).
 */
export function captureSourceNote(source: string): string {
  return `Imported from packet capture ${source}`;
}

/**
 * Reduces a request's `source` to a safe capture file **name**, or `undefined`
 * for "no note".
 *
 * Everything that is not a string, and every string that is blank after
 * trimming, maps to `undefined` — a request without `source` (or with `null`/`""`)
 * therefore behaves exactly as it did before this field existed. A real path is
 * reduced to its base name: the text is split on both separators (the client is a
 * browser, but the value is untrusted input) and only the last component is kept,
 * so `../../etc/passwd` is recorded as `passwd` and `/tmp/x/session_1.json` as
 * `session_1.json`. Control characters are stripped (a note stays one line) and
 * the result is capped at {@link MAX_CAPTURE_SOURCE_LENGTH} characters.
 */
export function sanitizeCaptureSource(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return undefined;
  }
  const base = trimmed.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (cleaned === '') {
    return undefined;
  }
  return cleaned.slice(0, MAX_CAPTURE_SOURCE_LENGTH);
}

/** One `quests[]` element of `GET /api/quests` — snake_case like the status entries. */
export interface QuestListRow {
  quest_name: string;
  /** String-table resolved title, raw `m_questTitle` key, or `m_questName`. */
  title: string;
  title_key: string | null;
  title_source: 'resolved' | 'rawKey' | 'missing';
  level: number | null;
  goal_count: number;
  is_mainline: boolean;
  /** The source file's mtime, ISO 8601; `null` when it vanished before the stat. */
  modified_at: string | null;
  /** `entry_status.status`, defaulting to `extracted` when the quest has no row. */
  status: StatusValue;
}

/** A corpus file that could not be read or parsed, reported rather than fatal. */
export interface QuestListSkipped {
  /** Path relative to the SpiralDB root (`QuestTemplates/…json`). */
  file: string;
  message: string;
}

export interface QuestListResult {
  quests: QuestListRow[];
  /**
   * Counts of the rows returned *by this call* (so the filter tabs count exactly
   * what the table holds). It equals `GET /api/status/quests`'s `summary` whenever
   * the database is in sync with the corpus — which the first-startup import and
   * every save guarantee; see the route header for the one divergence case.
   */
  summary: StatusSummary;
  skipped: QuestListSkipped[];
}

export interface ListQuestsOptions {
  db: Db;
  /** SpiralDB repository root (`settings.spiraldb_path`). */
  spiraldbPath: string;
}

/**
 * The browse list (ac1). One fresh scan per call (D12), the title through the
 * `string_table` lookup, the status through `entry_status` with the schema's
 * default for a quest that has no row.
 *
 * A file that fails to parse is skipped and reported in `skipped[]`; the request
 * still succeeds (the alternative — failing the whole table because one legacy
 * file is broken — is what the acceptance criterion forbids).
 */
export async function listQuests(options: ListQuestsOptions): Promise<QuestListResult> {
  const { db, spiraldbPath } = options;
  const built = await buildQuestRows({
    questTemplatesDir: path.join(spiraldbPath, collectionSpec('questtemplates').directory),
    lookupTitle: createStringLookup(db),
    collectDetails: true,
  });

  const statusByKey = new Map<string, string>();
  for (const entry of listStatus(db, ['quest']).entries) {
    statusByKey.set(entry.object_key, entry.status);
  }

  const summary: StatusSummary = { total: 0, extracted: 0, reviewed: 0, verified: 0 };
  const quests = built.rows.map((row): QuestListRow => {
    // No row ⇒ `extracted`: the schema default and the first-startup import value
    // (docs/spec-data-model.md L32-37). A non-lifecycle value can only come from a
    // hand-edited database; it is treated as the default rather than surfaced.
    const stored = statusByKey.get(row.quest_name);
    const status: StatusValue = isStatusValue(stored) ? stored : 'extracted';

    summary.total += 1;
    summary[status] += 1;

    return {
      quest_name: row.quest_name,
      title: row.title,
      title_key: row.titleKey,
      title_source: row.titleSource,
      level: row.level,
      goal_count: row.goalCount ?? 0,
      is_mainline: row.is_mainline,
      modified_at: row.modifiedAt ?? null,
      status,
    };
  });

  return {
    quests,
    summary,
    skipped: built.parseErrors.map((error) => ({
      file: relativeTo(spiraldbPath, error.file),
      message: error.message,
    })),
  };
}

export interface QuestDetail {
  /** Absolute path of the file the index resolved the name to. */
  path: string;
  name: string;
  quest: Record<string, unknown>;
}

export interface ReadQuestOptions {
  index: SpiraldbIndex;
  name: string;
}

/**
 * One quest's full JSON (`undefined` ⇒ 404).
 *
 * D19: the name resolves through the index, so an off-convention legacy filename
 * is found. The reader is `readSpiraldbJson`, whose JSON5 recovery is what makes a
 * legacy file with trailing commas parse (ac2).
 *
 * @throws {SpiraldbFileError} when the file exists but is not a JSON object, or
 * cannot be read — the route answers 500 with the message, which names the file.
 */
export function readQuest(options: ReadQuestOptions): QuestDetail | undefined {
  const file = options.index.pathFor('questtemplates', options.name);
  if (file === undefined) {
    return undefined;
  }

  const parsed = readSpiraldbJson(file);
  if (!isPlainObject(parsed)) {
    throw new SpiraldbFileError(
      `SpiralDB file ${file} is not a JSON object — it cannot be served as quest "${options.name}".`,
    );
  }

  return { path: file, name: options.name, quest: parsed };
}

/** The `POST /api/quests` response — the pipeline outcome plus any D48(d) warning. */
export interface SaveQuestResult {
  quest_name: string;
  outcome: SaveOutcome;
  action: 'extract' | 'update';
  /** The save's single commit sha (D13). */
  commit: string;
  branch: string;
  commit_message: string;
  /** Committed path relative to the SpiralDB root. */
  file: string;
  metadata: string | null;
  metadata_outcome: SaveOutcome | null;
  status: SaveObjectResult['status'];
  warnings: string[];
  /** The suggestion ids this save flipped to `accepted` after its commit (D141); `[]` when none. */
  accepted_suggestions: number[];
}

export interface SaveQuestOptions {
  db: Db;
  /** The shared D19 index (the router's per-root instance). */
  index: SpiraldbIndex;
  pipeline: SavePipeline;
  /** The raw request body, validated here: `{ quest, notes?, source?, accepted_suggestions? }`. */
  body: unknown;
}

/** `QuestMetadatas/<name>` — the index's duplicate-key spelling for a metadata family. */
function metadataDuplicateKey(name: string): string {
  const spec = collectionSpec('questmetadata');
  return `${spec.directory}/${name}`;
}

/**
 * Saves one quest through the task 2.4 pipeline.
 *
 * Request contract (spec-silent, so fixed and documented here): the body is
 * `{ quest: {...}, notes?: string, source?: string }`; `quest` must be a JSON
 * object carrying a usable `m_questName`. The commit action is `extract` for a key
 * that does not exist yet and `update` for one that does — the pipeline decides,
 * from the index.
 *
 * **Gap B (plan §2.4's save sequence).** `source` is the capture file the quest
 * came from (the extraction page knows it; the CLI output does not carry it). It is
 * sanitised by {@link sanitizeCaptureSource} and, when the save **creates** the
 * `entry_status` row, becomes that first `status_history` note —
 * `Imported from packet capture {source}`, `old_status: null`, `new_status:
 * 'extracted'`, `changed_by` = the resolved user name. An **update** gets no note
 * and no status reset (D49(d): no user-facing transition on an update), so
 * re-saving a `verified` quest never rewrites its history. A request without
 * `source` behaves exactly as it did before the field existed — a new entry is
 * inserted as `extracted` with a `null` note.
 *
 * Before the write, the `questtemplates` **and** `questmetadata` families are
 * re-scanned through the injected index. That is what makes the create/update
 * decision and the metadata pairing reflect the files on disk right now (a
 * hand-added file must not be duplicated), and it is what surfaces D48(d)'s
 * duplicate `Name`s: the index keeps the first file in name order, and the
 * response says which one that was instead of choosing silently.
 *
 * @throws {QuestRequestError} malformed body → 400.
 * @throws {DirtyRepoError} uncommitted work in the SpiralDB tree (D14) → 409.
 */
export async function saveQuest(options: SaveQuestOptions): Promise<SaveQuestResult> {
  const { index, pipeline } = options;
  const body = options.body;

  if (!isPlainObject(body)) {
    throw new QuestRequestError(
      'Request body must be a JSON object with a "quest" field carrying the quest object ' +
        'and optional "notes" and "source" strings.',
    );
  }
  if (!isPlainObject(body.quest)) {
    throw new QuestRequestError(
      'Missing quest: the request body must carry the quest object in the "quest" field.',
    );
  }
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') {
    throw new QuestRequestError(
      `Invalid notes: expected a string but received ${body.notes === null ? 'null' : typeof body.notes}.`,
    );
  }
  if (body.source !== undefined && body.source !== null && typeof body.source !== 'string') {
    throw new QuestRequestError(
      `Invalid source: expected the capture file name as a string but received ${
        body.source === null ? 'null' : typeof body.source
      }.`,
    );
  }

  // Task 3.1 / p3-01: the **same** Zod schemas the editor uses validate the document's
  // shape here (the goal/result/requirement unions on the assembly-qualified `$type`, the
  // dialog tree, the 36 top-level fields) — one source of truth, no second definition of a
  // quest. The checks above keep their exact, actionable messages and still run first.
  //
  // This pass **validates only**. `pipeline.saveObject` is handed `body.quest` (the original
  // object), never the parse output: Zod reorders keys, and D5's merge-not-replace rule
  // writes the loaded document, not one rebuilt from a schema. Two consequences worth
  // knowing: (a) an unknown-but-present *field* passes through untouched — nothing here
  // strips it; (b) `m_questName` is now required to be a non-empty **string** (the spec's
  // type), where `objectKeyFromData` would also have accepted a finite number.
  const validation = SaveQuestRequestSchema.safeParse(body);
  if (!validation.success) {
    throw new QuestRequestError(
      describeSchemaIssues(validation.error),
      schemaFieldErrorMap(validation.error),
    );
  }

  // Task 3.9: the **same rule engine the client runs** (`shared/quest/validation.ts`) with the
  // friendly-name tables injected (`loadValidationReferences`, the same `NAMES_TYPE_SPECS`
  // mapping the names API serves). Only **blocking** findings reject the request; the general
  // rules' warnings (an unlisted zone path, an id no table holds) are deliberately not a 400 —
  // the AC's "unknown item ID → Save still enabled" is this code path, and the corpus itself
  // carries 94 zone warnings and 5 reachability failures the game ships. Nothing is written to
  // the document here: the engine validates, and `pipeline.saveObject` still receives the
  // original `body.quest` (D57).
  const rules = validateQuest(body.quest, { references: loadValidationReferences(options.db) });
  if (rules.blocked) {
    throw new QuestRequestError(blockingSummary(rules.blocking), fieldErrorMap(rules.blocking));
  }

  const quest = body.quest;
  const name = objectKeyFromData(quest, 'm_questName');
  if (name === undefined) {
    throw new QuestRequestError(
      'Cannot save a quest: the object has no usable "m_questName" value ' +
        '(expected a non-empty string or a finite number).',
    );
  }

  // Task 7.7 (D141): the suggestions this save applies are checked **before** anything is
  // written — each must exist, be pending and be this quest's — and flipped only once the
  // pipeline's commit exists, so a save that fails anywhere leaves every one of them pending.
  const accepted = parseAcceptedSuggestions(body.accepted_suggestions);
  assertAcceptableSuggestions(options.db, accepted, { quest_name: name, catalog_id: null });

  // `undefined` for an absent/blank/unsafe value — i.e. no note at all.
  const source = sanitizeCaptureSource(body.source);

  // Refresh both families this save touches, and keep the metadata stats: they are
  // the only place a duplicate `Name` (D48(d)) is visible.
  const metadataStats = index.rebuildType('questmetadata');
  index.rebuildType('questtemplates');

  const warnings: string[] = [];
  const duplicates = metadataStats.duplicateKeys.filter(
    (key) => key === metadataDuplicateKey(name),
  ).length;
  // Resolve the ambiguous target **before** the save, because this is the resolver the pipeline
  // itself calls (`questMetadataSaveTarget`) and its tie-break reason is not part of the result —
  // the warning and the write can never disagree about which file won.
  //
  // The message is built and emitted only **after** the save succeeds (NF6, unattended review):
  // previously it was pushed and `console.warn`ed first, so a save the pipeline then refused (a
  // dirty tree under D14, a rejected write, a failed commit) had already logged "The save
  // updated …" for a write that never happened.
  const duplicateTarget =
    duplicates > 0 ? questMetadataSaveTarget(index, index.root, name) : undefined;

  const result = await pipeline.saveObject({
    fileType: 'questtemplates',
    data: quest,
    action: 'extract',
    notes: typeof body.notes === 'string' ? body.notes : undefined,
    // Gap B: the entry's first appearance in tracking. The pipeline writes this note
    // whenever it inserts the `entry_status` row — an existing corpus file saved as
    // `outcome: 'updated'` still gets it. An already-tracked entry gets no note, no
    // status change and no history row (D49(d)).
    historyNotesOnCreate: source === undefined ? undefined : captureSourceNote(source),
  });

  acceptSuggestions(options.db, accepted, { quest_name: name, catalog_id: null });

  if (duplicateTarget !== undefined) {
    // `metadataRelativePath` is the file the pipeline actually wrote; the resolver's path is the
    // fallback for a result shape that omits it. Either way the sentence is only ever uttered
    // once the write and its commit have succeeded.
    const written = result.metadataRelativePath ?? relativeTo(index.root, duplicateTarget.path);
    const message =
      `QuestMetadatas/ holds ${duplicates + 1} files whose "Name" is "${name}". ` +
      `The save updated ${written}` +
      `${
        duplicateTarget.tieBreak === 'convention'
          ? " (this tool's own convention file, preferred when a save is ambiguous)"
          : ' (first in file-name order)'
      } and left the other untouched — resolve the duplicate metadata by hand.`;
    warnings.push(message);
    console.warn(`[spiraldb-ui] ${message}`);
  }

  return {
    quest_name: result.key,
    outcome: result.outcome,
    action: result.action === 'update' ? 'update' : 'extract',
    commit: result.commit,
    branch: result.branch,
    commit_message: result.commitMessage,
    file: result.relativePath,
    metadata: result.metadataRelativePath,
    metadata_outcome: result.metadataOutcome,
    status: result.status,
    warnings,
    accepted_suggestions: accepted,
  };
}
