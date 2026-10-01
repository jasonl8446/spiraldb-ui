import path from 'node:path';

import {
  formatDocPath,
  getAtPath,
  hasAtPath,
  isEmptyValue,
  parseDocPath,
  type DocPath,
} from '../../../shared/document.js';
import { buildQuestScaffold } from '../../../shared/quest/scaffold.js';
import { SUGGESTION_SOURCES, type SuggestionSource } from '../../../shared/suggestions.js';
import { REQUIREMENT_LIST_TYPE, TYPE_STRINGS } from '../../../shared/quest/typeConstants.js';
import type { Db } from '../db.js';
import type { CaptureSuggestion } from './extraction.js';
import { questEvidenceByName, readEvidenceTables, type EvidenceTables } from './questEvidence.js';
import { QUEST_TEMPLATES_DIRECTORY, resolveLink } from './questScaffold.js';
import { readSpiraldbJson } from './spiraldbFiles.js';
import type { SpiraldbIndex } from './spiraldbIndex.js';
import { isPlainObject } from './sync/json.js';
import { parseQuestTitleKey, parseWizQstKey } from './sync/questRefs.js';

/**
 * The suggestion store and the draft builder — task 7.6 (story p7-07; D129, D130, D140, D143).
 *
 * Automatic quest data is staged in `quest_suggestions` (migration 0005) and never written into
 * a file: a value reaches SpiralDB only when a human accepts it in the editor and saves through
 * the unchanged pipeline (D129). This module owns the table's writes, the builder that fills it
 * from the Phase 6 evidence, and the reads the draft queue and the editor make.
 *
 * ## The builder
 *
 * `buildDrafts` runs over **every catalog id, named and unnamed** (D130): each `quests` row, plus
 * each `quest_ids` row with no `matched_quest_name`. For each draft it reads a **base document** —
 * the quest's file when it has one, else the D118 skeleton the editor would start from — and
 * proposes a value only for a path that is **empty** in that document (see {@link isEmptyValue}).
 * Five evidence sources, each reusing a Phase 6 surface rather than re-deriving it:
 *
 * | source | path | from |
 * |---|---|---|
 * | `evidence-title` | `m_questTitle` | the id's `quest_ids.title_key`; else the row's own `quests.title_key`; else a direct link's key recovered from `quests.title` |
 * | `evidence-dialogue` | `m_dialogList` | dialog blocks **other** corpus files record from this quest's own `WizQst` table, with the speakers the evidence ladder resolves |
 * | `evidence-goals` | `m_goals` | one goal per `goal_gates` name (the world's own gate on this quest) |
 * | `evidence-location` | `m_goals[i].m_locationName` | the `ZoneLocName_*` key corpus goals use most in the goal's `m_destinationZone` |
 * | `evidence-requirements` | `m_requirements` | a `ReqHasQuest` on the catalog quest that precedes this one in its name series |
 *
 * ## Idempotence (D140)
 *
 * Every write is `INSERT … ON CONFLICT DO NOTHING` against the identity index, so a rebuild never
 * duplicates a row and never resurrects a rejected one. A proposal is also skipped when a
 * **decided** row already covers it — the same draft, path and value accepted from any source, or
 * rejected from the same source — so an accepted value is never re-proposed and a rejection
 * survives a change of `catalog_id` (a sync that links a named quest to an id). A pending
 * `evidence-*` row this run no longer proposes (its field was filled since) is removed; a decided
 * row and every `capture-*` row are never touched by a rebuild.
 */

/* ------------------------------------------------------------------- vocabulary */

/** Every source a suggestion may carry (D140) — its one home is `shared/suggestions.ts` (9i). */
export { SUGGESTION_SOURCES, type SuggestionSource };

export const SUGGESTION_STATUSES = ['pending', 'accepted', 'rejected'] as const;

export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

/** One value to stage, before it has a row. */
export interface SuggestionProposal {
  quest_name: string | null;
  catalog_id: number | null;
  path: string;
  value: unknown;
  source: SuggestionSource;
  confidence: number | null;
  evidence_ref: string | null;
}

/** One stored suggestion, as the read endpoints answer it (`value` parsed). */
export interface SuggestionRow {
  id: number;
  quest_name: string | null;
  catalog_id: number | null;
  path: string;
  value: unknown;
  source: string;
  confidence: number | null;
  evidence_ref: string | null;
  status: SuggestionStatus;
  created_at: string | null;
  decided_at: string | null;
}

interface StoredSuggestionRow extends Omit<SuggestionRow, 'value'> {
  value_json: string;
}

/** The stored row with `value` parsed, in the documented key order (`value` after `path`). */
function parseRow(row: StoredSuggestionRow): SuggestionRow {
  return {
    id: row.id,
    quest_name: row.quest_name,
    catalog_id: row.catalog_id,
    path: row.path,
    value: JSON.parse(row.value_json) as unknown,
    source: row.source,
    confidence: row.confidence,
    evidence_ref: row.evidence_ref,
    status: row.status,
    created_at: row.created_at,
    decided_at: row.decided_at,
  };
}

/* ---------------------------------------------------------------- the empty rule */

/** The empty rule lives in `shared/document.ts` (the editor's Advanced disclosure reads it too). */
export { isEmptyValue };

/** {@link isEmptyValue} at a path; a path the document does not have is empty. */
function isEmptyAt(document: unknown, path: DocPath): boolean {
  return !hasAtPath(document, path) || isEmptyValue(getAtPath(document, path));
}

/* ------------------------------------------------------------------ the writes */

/** How a batch of proposals landed. */
export interface InsertResult {
  inserted: number;
  /** Proposals the table already held (the identity index) or a decision already covers. */
  unchanged: number;
}

/**
 * Stages proposals. One transaction; each proposal either inserts or is `unchanged`.
 *
 * The `NOT EXISTS` guard is the decision rule in the module header: an accepted value (any
 * source) or a rejected one (same source) for the same draft, path and value blocks the insert.
 * The draft is its `quest_name` when it has one, else its `catalog_id`.
 */
export function insertSuggestions(db: Db, proposals: readonly SuggestionProposal[]): InsertResult {
  const insert = db.prepare(
    `INSERT INTO quest_suggestions
       (quest_name, catalog_id, path, value_json, source, confidence, evidence_ref)
     SELECT @quest_name, @catalog_id, @path, @value_json, @source, @confidence, @evidence_ref
      WHERE NOT EXISTS (
        SELECT 1 FROM quest_suggestions d
         WHERE d.status <> 'pending'
           AND d.path = @path
           AND d.value_json = @value_json
           AND (d.status = 'accepted' OR d.source = @source)
           AND CASE WHEN @quest_name IS NOT NULL THEN d.quest_name = @quest_name
                    ELSE d.quest_name IS NULL AND d.catalog_id = @catalog_id END)
     ON CONFLICT DO NOTHING`,
  );
  let inserted = 0;
  db.transaction(() => {
    for (const proposal of proposals) {
      inserted += insert.run({
        quest_name: proposal.quest_name,
        catalog_id: proposal.catalog_id,
        path: proposal.path,
        value_json: JSON.stringify(proposal.value),
        source: proposal.source,
        confidence: proposal.confidence,
        evidence_ref: proposal.evidence_ref,
      }).changes;
    }
  })();
  return { inserted, unchanged: proposals.length - inserted };
}

/**
 * Stores an extraction's capture suggestions (task 7.5's sidecar) as pending rows, keyed by the
 * extracted quest's name with no `catalog_id`, `evidence_ref = capture:<file name>`. Called when
 * the extraction answers (spec-api "POST /api/extract/quests"); re-uploading the same capture adds
 * nothing, and a rebuild never deletes these rows.
 */
export function storeCaptureSuggestions(
  db: Db,
  suggestions: readonly CaptureSuggestion[],
  captureName: string,
): CaptureStoreResult {
  // A row is keyed by name, and `quest_drafts` lists only catalog names: a suggestion for a quest
  // the catalog does not hold is stored but not in the queue until a sync lists it (PR #14
  // review 9d) — counted, so the extraction can say so instead of staging it out of sight.
  const known = db.prepare('SELECT 1 FROM quests WHERE quest_name = ?');
  const uncatalogued = suggestions.filter(
    (suggestion) => known.get(suggestion.questName) === undefined,
  ).length;
  const stored = insertSuggestions(
    db,
    suggestions.map((suggestion) => ({
      quest_name: suggestion.questName,
      catalog_id: null,
      path: suggestion.path,
      value: suggestion.value,
      source: suggestion.source,
      confidence: suggestion.confidence,
      evidence_ref: `capture:${captureName}`,
    })),
  );
  return { ...stored, uncatalogued };
}

/** What storing one extraction's capture suggestions did (the extract response's `suggestions_store`). */
export interface CaptureStoreResult extends InsertResult {
  /** Suggestions whose `questName` has no `quests` row, so `/drafts` does not list them yet. */
  uncatalogued: number;
}

/** A decision the caller can act on; the route maps `status` verbatim. */
export class SuggestionDecisionError extends Error {
  readonly status: 400 | 404 | 409;

  constructor(message: string, status: 400 | 404 | 409) {
    super(message);
    this.name = 'SuggestionDecisionError';
    this.status = status;
  }
}

const SELECT_ROW = `SELECT id, quest_name, catalog_id, path, value_json, source, confidence,
                           evidence_ref, status, created_at, decided_at
                      FROM quest_suggestions`;

/**
 * `POST /api/suggestions/:id/reject`: pending → rejected, immediately (D141). An unknown id is a
 * 404; a row that is not pending is a 409, because a decision is never silently overwritten.
 */
export function rejectSuggestion(db: Db, id: number): SuggestionRow {
  const row = db.prepare<[number], StoredSuggestionRow>(`${SELECT_ROW} WHERE id = ?`).get(id);
  if (row === undefined) {
    throw new SuggestionDecisionError(`Unknown suggestion ${id}`, 404);
  }
  if (row.status !== 'pending') {
    throw new SuggestionDecisionError(`Suggestion ${id} is already ${row.status}`, 409);
  }
  db.prepare(
    "UPDATE quest_suggestions SET status = 'rejected', decided_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).run(id);
  return parseRow(
    db
      .prepare<[number], StoredSuggestionRow>(`${SELECT_ROW} WHERE id = ?`)
      .get(id) as StoredSuggestionRow,
  );
}

/** The draft a save's accepted ids must belong to: its name, or its id while it is unnamed. */
export interface SuggestionDraft {
  quest_name: string | null;
  catalog_id: number | null;
}

/**
 * `accepted_suggestions` of a save body (D141): absent or `null` → `[]`; otherwise an array of
 * positive integer ids, de-duplicated in order. Anything else is a 400 before any write.
 */
export function parseAcceptedSuggestions(value: unknown): number[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (
    !Array.isArray(value) ||
    !value.every((id) => typeof id === 'number' && Number.isSafeInteger(id) && id > 0)
  ) {
    throw new SuggestionDecisionError(
      `accepted_suggestions must be an array of suggestion ids; got ${JSON.stringify(value)}`,
      400,
    );
  }
  return [...new Set(value as number[])];
}

/**
 * The save routes' pre-write check (D141): every id must exist, be pending and belong to the
 * draft being saved, or the request is a 400 naming the first bad id. Called **before** the
 * pipeline writes anything, so a refused id never leaves a file behind.
 */
export function assertAcceptableSuggestions(
  db: Db,
  ids: readonly number[],
  draft: SuggestionDraft,
): void {
  const read = db.prepare<[number], StoredSuggestionRow>(`${SELECT_ROW} WHERE id = ?`);
  for (const id of ids) {
    const row = read.get(id);
    const belongs =
      row !== undefined &&
      ((draft.quest_name !== null && row.quest_name === draft.quest_name) ||
        (draft.catalog_id !== null && row.catalog_id === draft.catalog_id));
    if (row === undefined || row.status !== 'pending' || !belongs) {
      throw new SuggestionDecisionError(
        `Suggestion ${id} is not a pending suggestion of this quest`,
        400,
      );
    }
  }
}

/**
 * The save routes' accept step (D141), called after the pipeline's commit exists: the ids are
 * re-checked and all flip together in one transaction, or none does. Safe to call inside an outer
 * transaction (better-sqlite3 nests it as a savepoint), which is how the naming save (D142) flips
 * them together with the catalog rows it creates.
 */
export function acceptSuggestions(db: Db, ids: readonly number[], draft: SuggestionDraft): number {
  const flip = db.prepare(
    "UPDATE quest_suggestions SET status = 'accepted', decided_at = CURRENT_TIMESTAMP WHERE id = ?",
  );
  return db.transaction(() => {
    assertAcceptableSuggestions(db, ids, draft);
    for (const id of ids) {
      flip.run(id);
    }
    return ids.length;
  })();
}

/**
 * {@link acceptSuggestions} for a save whose commit **already exists** (final-review round 1, m2).
 *
 * A decision failure here cannot mean "nothing was written": a rebuild that ran while the save
 * awaited git (its `removeStale` deletes the pending row of a field the new file now fills) or a
 * reject of the same id (D168) leaves an id no longer pending. The ids stay all-or-none (D141), so
 * every one of them is left undecided, and the save answers success with a warning that names them
 * instead of a `400` claiming the request was refused before the write.
 */
export function acceptCommittedSuggestions(
  db: Db,
  ids: readonly number[],
  draft: SuggestionDraft,
): { accepted: number[]; warnings: string[] } {
  try {
    acceptSuggestions(db, ids, draft);
    return { accepted: [...ids], warnings: [] };
  } catch (error) {
    if (!(error instanceof SuggestionDecisionError)) {
      throw error;
    }
    return {
      accepted: [],
      warnings: [
        `The save was committed, but suggestion${ids.length === 1 ? '' : 's'} ${ids.join(', ')} ` +
          `${ids.length === 1 ? 'was' : 'were'} left undecided: ${error.message} (decided or ` +
          `removed while the save ran).`,
      ],
    };
  }
}

/* ------------------------------------------------------------------- the reads */

/** `?status=` of the suggestion reads: one status, or `all`. */
export type SuggestionStatusFilter = SuggestionStatus | 'all';

/**
 * One draft's suggestions, ordered `path, source, id` so a re-read never reorders the inline list
 * (D143). A named draft is addressed by name, an unnamed one by its id.
 */
export function listSuggestions(
  db: Db,
  draft: { quest_name: string } | { catalog_id: number },
  status: SuggestionStatusFilter,
): SuggestionRow[] {
  const where =
    'quest_name' in draft ? 'quest_name = @key' : 'quest_name IS NULL AND catalog_id = @key';
  const key = 'quest_name' in draft ? draft.quest_name : draft.catalog_id;
  const rows = db
    .prepare<{ key: string | number; status: string }, StoredSuggestionRow>(
      `${SELECT_ROW} WHERE ${where} AND (@status = 'all' OR status = @status) ORDER BY path, source, id`,
    )
    .all({ key, status });
  return rows.map(parseRow);
}

/** One `quest_drafts` row as the queue answers it (`sources` split and sorted). */
export interface DraftRow {
  quest_name: string | null;
  catalog_id: number | null;
  title: string | null;
  has_definition: number;
  reference_count: number;
  pending: number;
  accepted: number;
  rejected: number;
  evidence_richness: number;
  sources: string[];
}

export interface DraftFilters {
  named: boolean | null;
  has_file: boolean | null;
  source: SuggestionSource | null;
  all: boolean;
  limit: number;
  offset: number;
}

export interface DraftList {
  drafts: DraftRow[];
  total: number;
  hidden_zero_evidence: number;
  filters: Pick<DraftFilters, 'named' | 'has_file' | 'source' | 'all'>;
}

/** `GET /api/drafts` (D143): the filtered, ranked queue plus the D130 toggle's count. */
export function listDrafts(db: Db, filters: DraftFilters): DraftList {
  const clauses: string[] = [];
  if (filters.named !== null) {
    clauses.push(filters.named ? 'quest_name IS NOT NULL' : 'quest_name IS NULL');
  }
  if (filters.has_file !== null) {
    clauses.push(`has_definition = ${filters.has_file ? 1 : 0}`);
  }
  if (filters.source !== null) {
    clauses.push("(',' || coalesce(sources, '') || ',') LIKE '%,' || @source || ',%'");
  }
  const scoped = clauses.length === 0 ? '1' : clauses.join(' AND ');
  const shown = filters.all ? scoped : `${scoped} AND evidence_richness > 0`;
  const params = { source: filters.source ?? '' };

  const count = (where: string): number =>
    (
      db
        .prepare<typeof params, { c: number }>(
          `SELECT count(*) AS c FROM quest_drafts WHERE ${where}`,
        )
        .get(params) as { c: number }
    ).c;

  const rows = db
    .prepare<
      typeof params & { limit: number; offset: number },
      Omit<DraftRow, 'sources'> & { sources: string | null }
    >(
      `SELECT * FROM quest_drafts WHERE ${shown}
        ORDER BY evidence_richness DESC, reference_count DESC, quest_name, catalog_id
        LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: filters.limit, offset: filters.offset });

  return {
    drafts: rows.map((row) => ({
      ...row,
      sources: row.sources === null ? [] : row.sources.split(',').sort(),
    })),
    total: count(shown),
    hidden_zero_evidence: filters.all ? 0 : count(`${scoped} AND evidence_richness = 0`),
    filters: {
      named: filters.named,
      has_file: filters.has_file,
      source: filters.source,
      all: filters.all,
    },
  };
}

/** The draft set's three tiers plus how many carry no pending evidence (D130's hidden count). */
export interface DraftCounts {
  named_missing: number;
  named_defined: number;
  unnamed: number;
  zero_evidence: number;
}

export function readDraftCounts(db: Db): DraftCounts {
  return db
    .prepare<[], DraftCounts>(
      `SELECT coalesce(sum(quest_name IS NOT NULL AND has_definition = 0), 0) AS named_missing,
              coalesce(sum(quest_name IS NOT NULL AND has_definition = 1), 0) AS named_defined,
              coalesce(sum(quest_name IS NULL), 0)                            AS unnamed,
              coalesce(sum(evidence_richness = 0), 0)                         AS zero_evidence
         FROM quest_drafts`,
    )
    .get() as DraftCounts;
}

/* ------------------------------------------------------------------ the builder */

/** D106's measured accuracy of an inferred name → id link (131 of 168 hold-out cases). */
export const INFERRED_LINK_CONFIDENCE = 0.78;

interface CatalogQuest {
  quest_name: string;
  title: string;
  has_definition: number;
  link_kind: string | null;
  title_source: string | null;
  title_key: string | null;
}

interface CatalogId {
  quest_id: number;
  title_key: string | null;
  matched_quest_name: string | null;
  link_kind: string | null;
}

/** What the builder reads from the corpus once per run. */
interface CorpusFacts {
  /** name → the quest's file document. */
  documents: Map<string, Record<string, unknown>>;
  /** zone path → (`ZoneLocName_*` key → corpus goals using it). */
  locationsByZone: Map<string, Map<string, number>>;
  /** target quest id → dialog blocks other files record from its own text table. */
  foreignDialogue: Map<number, ForeignDialog[]>;
}

interface ForeignDialog {
  /** `questtemplates:<source>#<dialog path>` — where the block was copied from. */
  ref: string;
  /** The `ActorDialog` block, its entries narrowed to the ones naming the target's table. */
  dialog: Record<string, unknown>;
  speakers: string[];
}

/** `m_goalName`/zone of one gate, from `quest_catalog_refs`. */
interface GateFacts {
  zones: Set<string>;
}

/** The quest's id from its own title key (`QuestTitle_1ED8D` → 0x1ED8D). */
function titleIdOf(document: Record<string, unknown> | undefined): number | null {
  const key = document?.m_questTitle;
  return typeof key === 'string' && key !== '' ? parseQuestTitleKey(key) : null;
}

/** `Aquila-Interiors-AQ_Z03_CavOfNyx.wad` → `Aquila/Interiors/AQ_Z03_CavOfNyx`. */
export function zonePathOfWad(wad: string): string {
  return wad
    .replace(/\.wad$/i, '')
    .split('-')
    .join('/');
}

/** The previous quest of a name series (`DS-LIB2-C03-002` → `DS-LIB2-C03-001`), or `null`. */
export function namePredecessor(name: string): string | null {
  const match = /^(.*-)(\d+)$/.exec(name);
  if (match === null) {
    return null;
  }
  const digits = match[2] ?? '';
  const previous = Number(digits) - 1;
  if (previous < 1) {
    return null;
  }
  return `${match[1]}${String(previous).padStart(digits.length, '0')}`;
}

/** Every `m_questName` a `ReqHasQuest` under the value names. */
function requiredQuests(value: unknown): string[] {
  const found: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isPlainObject(node)) {
      return;
    }
    if (node.$type === TYPE_STRINGS.ReqHasQuest && typeof node.m_questName === 'string') {
      found.push(node.m_questName);
    }
    Object.values(node).forEach(visit);
  };
  visit(value);
  return found;
}

/** The corpus goal nodes of a document. */
function goalsOf(document: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(document.m_goals) ? document.m_goals.filter(isPlainObject) : [];
}

function readCorpus(
  db: Db,
  index: SpiraldbIndex,
  tables: EvidenceTables,
  linkedId: ReadonlyMap<string, number>,
): CorpusFacts {
  const documents = new Map<string, Record<string, unknown>>();
  const locationsByZone = new Map<string, Map<string, number>>();
  const foreignDialogue = new Map<number, ForeignDialog[]>();

  for (const name of index.keys('questtemplates')) {
    const file = index.pathFor('questtemplates', name);
    if (file === undefined) {
      continue;
    }
    const parsed = readSpiraldbJson(file);
    if (!isPlainObject(parsed)) {
      continue;
    }
    documents.set(name, parsed);

    for (const goal of goalsOf(parsed)) {
      const zone = goal.m_destinationZone;
      const key = goal.m_locationName;
      if (
        typeof zone === 'string' &&
        zone !== '' &&
        typeof key === 'string' &&
        key.startsWith('ZoneLocName_')
      ) {
        const tally = locationsByZone.get(zone) ?? new Map<string, number>();
        tally.set(key, (tally.get(key) ?? 0) + 1);
        locationsByZone.set(zone, tally);
      }
    }

    // Dialogue this file records from ANOTHER quest's table — the Phase 6 evidence's
    // `own_table: false` rows, with the speaker its ladder resolved.
    const evidence = questEvidenceByName({ db, index, tables }, name);
    if (evidence.kind !== 'found') {
      continue;
    }
    const ownId = linkedId.get(name) ?? titleIdOf(parsed);
    const blocks = new Map<string, { target: number; entries: unknown[]; speakers: Set<string> }>();
    for (const line of evidence.evidence.dialogue) {
      const target = line.dialog_key === null ? null : parseWizQstKey(line.dialog_key);
      const entryPath = parseDocPath(line.field);
      if (target === null || target === ownId || entryPath === null || entryPath.length < 2) {
        continue;
      }
      const dialogPath = formatDocPath(entryPath.slice(0, -2));
      const blockKey = `${target}\u0000${dialogPath}`;
      const block = blocks.get(blockKey) ?? { target, entries: [], speakers: new Set<string>() };
      block.entries.push(getAtPath(parsed, entryPath));
      if (line.speaker.name !== '') {
        block.speakers.add(line.speaker.name);
      }
      blocks.set(blockKey, block);
    }
    for (const [blockKey, block] of blocks) {
      const dialogPath = blockKey.slice(blockKey.indexOf('\u0000') + 1);
      const source = getAtPath(parsed, parseDocPath(dialogPath) as DocPath);
      if (!isPlainObject(source)) {
        continue;
      }
      const list = foreignDialogue.get(block.target) ?? [];
      list.push({
        ref: `questtemplates:${name}#${dialogPath}`,
        dialog: { ...source, m_dialogEntries: block.entries },
        speakers: [...block.speakers].sort(),
      });
      foreignDialogue.set(block.target, list);
    }
  }
  return { documents, locationsByZone, foreignDialogue };
}

/**
 * A new goal in the corpus's base shape (the 24 base fields, as the editor's new goal), named by a
 * gate and placed in the gate's zone.
 *
 * The type is a proposal like the rest of the goal. Measured on the owner fork (330 files): of the
 * 65 gates on defined quests, the 7 whose name matches a goal of the file all match a
 * `PersonaGoalTemplate`, and no other type occurs.
 */
function gateGoal(name: string, zone: string | null): Record<string, unknown> {
  return {
    $type: TYPE_STRINGS.PersonaGoalTemplate,
    m_goalName: name,
    m_goalNameID: 0,
    m_goalTitle: '',
    m_goalUnderway: null,
    m_hyperlink: null,
    m_completeText: null,
    m_completeResults: { m_results: [] },
    m_goalRequirements: null,
    m_tallyCounter: null,
    m_locationName: '',
    m_displayImage1: '',
    m_displayImage2: null,
    m_clientTags: [],
    m_genericEvents: [],
    m_autoQualify: false,
    m_autoComplete: false,
    m_destinationZone: zone ?? '',
    m_dialogList: null,
    m_goalType: 'GOAL_TYPE_PERSONA',
    m_noQuestHelper: false,
    m_petOnlyQuest: false,
    m_activateResults: { m_results: [] },
    m_hideGoalFloatyText: false,
    m_behaviors: null,
    m_personaName: '',
    m_usePatron: false,
  };
}

/** `m_requirements` holding one `ReqHasQuest`, in the corpus's own node shape. */
function requiresQuest(name: string): Record<string, unknown> {
  return {
    $type: REQUIREMENT_LIST_TYPE,
    m_applyNOT: false,
    m_operator: 'ROP_AND',
    m_requirements: [
      {
        $type: TYPE_STRINGS.ReqHasQuest,
        m_applyNOT: false,
        m_operator: 'ROP_AND',
        m_questName: name,
      },
    ],
  };
}

const naturalOrder = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });

/** Every proposal of one run, plus the two precisions it measured on the corpus. */
export interface DraftProposals {
  proposals: SuggestionProposal[];
  /** Gates on defined quests whose name matches a goal of the file / all such gates. */
  gate_precision: { matched: number; gates: number };
  /** Corpus files whose ReqHasQuest names their name predecessor / files with a catalog predecessor. */
  predecessor_precision: { matched: number; files: number };
}

/**
 * Proposes every evidence value for every draft. Pure over the database and the corpus: nothing
 * is written here, so a test can inspect a run without staging it.
 */
export function proposeDrafts(db: Db, index: SpiraldbIndex): DraftProposals {
  const tables = readEvidenceTables(db);
  const quests = db
    .prepare<[], CatalogQuest>(
      'SELECT quest_name, title, has_definition, link_kind, title_source, title_key FROM quests ORDER BY quest_name',
    )
    .all();
  const ids = db
    .prepare<[], CatalogId>(
      'SELECT quest_id, title_key, matched_quest_name, link_kind FROM quest_ids ORDER BY quest_id',
    )
    .all();
  const catalogNames = new Set(quests.map((quest) => quest.quest_name));

  const idsByName = new Map<string, CatalogId[]>();
  for (const id of ids) {
    if (id.matched_quest_name !== null) {
      const list = idsByName.get(id.matched_quest_name) ?? [];
      list.push(id);
      idsByName.set(id.matched_quest_name, list);
    }
  }
  const linkedId = new Map<string, number>();
  for (const [name, list] of idsByName) {
    linkedId.set(name, Math.min(...list.map((id) => id.quest_id)));
  }

  const titleKeysByText = new Map<string, string[]>();
  for (const [key, value] of tables.strings) {
    if (key.startsWith('QuestTitle_') && value !== '') {
      const keys = titleKeysByText.get(value) ?? [];
      keys.push(key);
      titleKeysByText.set(value, keys);
    }
  }

  const zones = new Set(
    db
      .prepare<[], { zone_path: string }>('SELECT zone_path FROM zones')
      .all()
      .map((row) => row.zone_path),
  );
  const gatesByQuest = new Map<string, Map<string, GateFacts>>();
  for (const ref of db
    .prepare<[], { quest_name: string; wad: string; goal_name: string }>(
      'SELECT quest_name, wad, goal_name FROM quest_catalog_refs WHERE goal_name IS NOT NULL ORDER BY quest_name, goal_name, wad',
    )
    .all()) {
    const gates = gatesByQuest.get(ref.quest_name) ?? new Map<string, GateFacts>();
    const gate = gates.get(ref.goal_name) ?? { zones: new Set<string>() };
    const zone = zonePathOfWad(ref.wad);
    if (zones.has(zone)) {
      gate.zones.add(zone);
    }
    gates.set(ref.goal_name, gate);
    gatesByQuest.set(ref.quest_name, gates);
  }

  const corpus = readCorpus(db, index, tables, linkedId);

  // --- the two precisions, re-measured on this corpus every run (D106's rule: never stale) ---
  const gatePrecision = { matched: 0, gates: 0 };
  const predecessorPrecision = { matched: 0, files: 0 };
  for (const [name, document] of corpus.documents) {
    const goalNames = new Set(goalsOf(document).map((goal) => goal.m_goalName));
    for (const gateName of gatesByQuest.get(name)?.keys() ?? []) {
      gatePrecision.gates += 1;
      if (goalNames.has(gateName)) {
        gatePrecision.matched += 1;
      }
    }
    const previous = namePredecessor(name);
    if (previous !== null && catalogNames.has(previous)) {
      predecessorPrecision.files += 1;
      if (requiredQuests(document.m_requirements).includes(previous)) {
        predecessorPrecision.matched += 1;
      }
    }
  }
  const ratio = (part: number, whole: number): number | null =>
    whole === 0 ? null : Math.round((part / whole) * 1000) / 1000;
  const gateConfidence = ratio(gatePrecision.matched, gatePrecision.gates);
  const predecessorConfidence = ratio(predecessorPrecision.matched, predecessorPrecision.files);

  const proposals: SuggestionProposal[] = [];

  /** The proposals every draft can receive, given its base document and its ids. */
  const proposeFor = (draft: {
    quest_name: string | null;
    catalog_id: number | null;
    base: Record<string, unknown>;
    textIds: number[];
    titles: Array<{ key: string; confidence: number; ref: string }>;
  }): void => {
    const push = (
      path: string,
      value: unknown,
      source: SuggestionSource,
      confidence: number | null,
      ref: string,
    ): void => {
      proposals.push({
        quest_name: draft.quest_name,
        catalog_id: draft.catalog_id,
        path,
        value,
        source,
        confidence,
        evidence_ref: ref,
      });
    };
    const { base } = draft;

    if (isEmptyAt(base, ['m_questTitle'])) {
      for (const title of draft.titles) {
        push('m_questTitle', title.key, 'evidence-title', title.confidence, title.ref);
      }
    }

    if (isEmptyAt(base, ['m_dialogList'])) {
      const blocks = draft.textIds.flatMap((id) => corpus.foreignDialogue.get(id) ?? []);
      if (blocks.length > 0) {
        push(
          'm_dialogList',
          { $type: TYPE_STRINGS.ActorDialogList, m_dialogs: blocks.map((block) => block.dialog) },
          'evidence-dialogue',
          null,
          blocks
            .map(
              (block) => `${block.ref} (speakers: ${block.speakers.join(', ') || 'none resolved'})`,
            )
            .join('; '),
        );
      }
    }

    if (draft.quest_name === null) {
      return; // gates, series and goals are keyed by a catalog name
    }
    const name = draft.quest_name;

    // Goals: the base document's own, or — when it has none — the ones evidence-goals proposes,
    // so a location can be proposed for a goal the author has not accepted yet (its path is valid
    // once the goals are applied, and `m_goals` sorts before `m_goals[i]…` in every listing).
    let goals = goalsOf(base);
    let goalsRef = '';
    const gates = gatesByQuest.get(name);
    if (gates !== undefined && gates.size > 0 && isEmptyAt(base, ['m_goals'])) {
      const gateNames = [...gates.keys()].sort(naturalOrder);
      goals = gateNames.map((gateName) =>
        gateGoal(gateName, [...(gates.get(gateName)?.zones ?? [])].sort()[0] ?? null),
      );
      goalsRef = ' (a goal evidence-goals proposes)';
      push(
        'm_goals',
        goals,
        'evidence-goals',
        gateConfidence,
        `goal_gates:${name} (${gateNames.join(', ')})`,
      );
    }

    goals.forEach((goal, goalIndex) => {
      const zone = goal.m_destinationZone;
      if (typeof zone !== 'string' || zone === '' || !isEmptyValue(goal.m_locationName)) {
        return;
      }
      const tally = corpus.locationsByZone.get(zone);
      if (tally === undefined) {
        return;
      }
      const total = [...tally.values()].reduce((sum, count) => sum + count, 0);
      const [key, count] = [...tally.entries()].sort(
        (a, b) => b[1] - a[1] || naturalOrder(a[0], b[0]),
      )[0] as [string, number];
      push(
        formatDocPath(['m_goals', goalIndex, 'm_locationName']),
        key,
        'evidence-location',
        ratio(count, total),
        `corpus m_destinationZone ${zone}: ${count} of ${total} goals use ${key}${goalsRef}`,
      );
    });

    const previous = namePredecessor(name);
    if (previous !== null && catalogNames.has(previous) && isEmptyAt(base, ['m_requirements'])) {
      push(
        'm_requirements',
        requiresQuest(previous),
        'evidence-requirements',
        predecessorConfidence,
        `name series: ${previous} precedes ${name}`,
      );
    }
  };

  for (const quest of quests) {
    const name = quest.quest_name;
    const file = corpus.documents.get(name);
    const base = file ?? buildQuestScaffold({ name, link: resolveLink(db, quest) });
    const linked = idsByName.get(name) ?? [];
    const titles: Array<{ key: string; confidence: number; ref: string }> = [];
    for (const id of linked) {
      if (id.title_key !== null) {
        titles.push({
          key: id.title_key,
          confidence: id.link_kind === 'direct' ? 1 : INFERRED_LINK_CONFIDENCE,
          ref: `quest_ids:${id.quest_id} (${id.link_kind ?? 'none'})`,
        });
      }
    }
    if (
      titles.length === 0 &&
      quest.title_key !== null &&
      (quest.title_source === 'direct' || quest.title_source === 'inferred')
    ) {
      // The row's own key (migration 0006): exact, so the two-keys-one-text ambiguity below never
      // arises for it. An inferred link carries D106's measured accuracy, a direct one 1.
      titles.push({
        key: quest.title_key,
        confidence: quest.title_source === 'direct' ? 1 : INFERRED_LINK_CONFIDENCE,
        ref: `quests.title_key (${quest.title_source})`,
      });
    }
    if (titles.length === 0 && quest.title_source === 'direct' && quest.title !== '') {
      const keys = titleKeysByText.get(quest.title) ?? [];
      for (const key of keys) {
        titles.push({
          key,
          confidence: Math.round((1 / keys.length) * 1000) / 1000,
          ref: `quests.title "${quest.title}" (${keys.length} key${keys.length === 1 ? '' : 's'} carry it)`,
        });
      }
    }
    const textIds = linked.map((id) => id.quest_id);
    const fileId = titleIdOf(file);
    if (textIds.length === 0 && fileId !== null) {
      textIds.push(fileId);
    }
    proposeFor({
      quest_name: name,
      catalog_id: linkedId.get(name) ?? null,
      base,
      textIds,
      titles,
    });
  }

  for (const id of ids) {
    if (id.matched_quest_name !== null) {
      continue;
    }
    proposeFor({
      quest_name: null,
      catalog_id: id.quest_id,
      // The unnamed tier has no name until the user gives it one (D137); the skeleton is built
      // only to read which paths are empty, and its placeholder name is never proposed.
      base: buildQuestScaffold({ name: `#${id.quest_id}`, link: { kind: 'none' } }),
      textIds: [id.quest_id],
      titles:
        id.title_key === null
          ? []
          : [{ key: id.title_key, confidence: 1, ref: `quest_ids:${id.quest_id}` }],
    });
  }

  return {
    proposals,
    gate_precision: gatePrecision,
    predecessor_precision: predecessorPrecision,
  };
}

/** `POST /api/drafts/rebuild`'s body and `npm run drafts`'s summary (D143). */
export interface DraftBuildResult {
  proposed: number;
  inserted: number;
  unchanged: number;
  /** Pending `evidence-*` rows this run no longer proposes (their field was filled since). */
  removed: number;
  /** Rows per source in the table after the run, every status. */
  by_source: Record<SuggestionSource, number>;
  drafts: DraftCounts;
  gate_precision: DraftProposals['gate_precision'];
  predecessor_precision: DraftProposals['predecessor_precision'];
  duration_ms: number;
}

/** Removes pending evidence rows whose identity the run did not propose. */
function removeStale(db: Db, proposals: readonly SuggestionProposal[]): number {
  return db.transaction(() => {
    db.exec(
      'CREATE TEMP TABLE IF NOT EXISTS draft_run (quest_name TEXT, catalog_id INTEGER, path TEXT, source TEXT, value_json TEXT)',
    );
    db.exec('DELETE FROM temp.draft_run');
    db.exec(
      "CREATE INDEX IF NOT EXISTS temp.idx_draft_run ON draft_run(coalesce(quest_name, ''), coalesce(catalog_id, -1), path, source, value_json)",
    );
    const remember = db.prepare(
      'INSERT INTO temp.draft_run (quest_name, catalog_id, path, source, value_json) VALUES (?, ?, ?, ?, ?)',
    );
    for (const proposal of proposals) {
      remember.run(
        proposal.quest_name,
        proposal.catalog_id,
        proposal.path,
        proposal.source,
        JSON.stringify(proposal.value),
      );
    }
    const removed = db
      .prepare(
        `DELETE FROM quest_suggestions
          WHERE status = 'pending' AND source LIKE 'evidence-%'
            AND NOT EXISTS (
              SELECT 1 FROM temp.draft_run r
               WHERE coalesce(r.quest_name, '') = coalesce(quest_suggestions.quest_name, '')
                 AND coalesce(r.catalog_id, -1) = coalesce(quest_suggestions.catalog_id, -1)
                 AND r.path = quest_suggestions.path
                 AND r.source = quest_suggestions.source
                 AND r.value_json = quest_suggestions.value_json)`,
      )
      .run().changes;
    db.exec('DELETE FROM temp.draft_run');
    return removed;
  })();
}

/**
 * A rebuild refused because its quest-file read found nothing while evidence rows are pending
 * (PR #14 review 1, D195): `removeStale` would read "no file proposed it" as "its field was
 * filled since" and delete the whole pending evidence queue. Nothing is written; a `409`.
 */
export class DraftCorpusError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = 'DraftCorpusError';
  }
}

/**
 * The draft builder: `npm run drafts` and `POST /api/drafts/rebuild` run exactly this.
 * Writes only `quest_suggestions`; never SpiralDB.
 *
 * @throws {DraftCorpusError} when the index holds no quest file and pending `evidence-*` rows
 *   exist — a root that is an existing directory but not the SpiralDB root (a typo, the parent,
 *   `QuestTemplates/` itself) reads as an empty corpus, and the run must not erase the queue.
 */
export function buildDrafts(options: { db: Db; index: SpiraldbIndex }): DraftBuildResult {
  const started = performance.now();
  const { db, index } = options;
  if (index.keys('questtemplates').length === 0) {
    const pending = db
      .prepare<[], { c: number }>(
        "SELECT count(*) AS c FROM quest_suggestions WHERE status = 'pending' AND source LIKE 'evidence-%'",
      )
      .get()?.c;
    if (pending !== undefined && pending > 0) {
      throw new DraftCorpusError(
        `The rebuild read no quest file from ${path.join(index.root, QUEST_TEMPLATES_DIRECTORY)} ` +
          `(missing or empty), and ${pending} pending evidence suggestions would be deleted as ` +
          `"no longer proposed". Nothing was changed. Check spiraldb_path in Settings: it must ` +
          `be the SpiralDB repository root, the directory holding QuestTemplates/.`,
      );
    }
  }
  const run = proposeDrafts(db, index);
  const { inserted, unchanged } = insertSuggestions(db, run.proposals);
  const removed = removeStale(db, run.proposals);

  const by_source = Object.fromEntries(SUGGESTION_SOURCES.map((source) => [source, 0])) as Record<
    SuggestionSource,
    number
  >;
  for (const row of db
    .prepare<[], { source: SuggestionSource; c: number }>(
      'SELECT source, count(*) AS c FROM quest_suggestions GROUP BY source',
    )
    .all()) {
    by_source[row.source] = row.c;
  }

  return {
    proposed: run.proposals.length,
    inserted,
    unchanged,
    removed,
    by_source,
    drafts: readDraftCounts(db),
    gate_precision: run.gate_precision,
    predecessor_precision: run.predecessor_precision,
    duration_ms: Math.round(performance.now() - started),
  };
}
