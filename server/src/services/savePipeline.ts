import fs from 'node:fs';

import type { ObjectFileType } from '../../../shared/naming.js';
import { readSettings, writeSetting, type Db } from '../db.js';
import { createGitService, type GitService } from './git.js';
import {
  buildQuestMetadata,
  collectionSpec,
  createTargetPath,
  mergePreservingAbsent,
  readSpiraldbJson,
  refreshQuestMetadata,
  resolveObjectKey,
  SpiraldbFileError,
  writeSpiraldbJson,
} from './spiraldbFiles.js';
import type { SpiraldbIndex } from './spiraldbIndex.js';
import {
  applyStatusChange,
  getStatusEntry,
  type StatusEntryRow,
  type StatusObjectType,
  type StatusValue,
} from './status.js';

/**
 * The generic save pipeline: dirty guard → write → companion metadata (quests
 * only) → git commit → status upsert + history.
 *
 * The sequence is docs/spec-api.md L200-204; the per-step rules are
 * docs/spec-data-model.md L171-253 (naming, clean JSON, metadata shape, branch and
 * commit format) with decisions D13 (one commit per object save), D14 (the dirty
 * guard), D19 (updates resolve and write through the content-keyed index — never
 * by deriving a filename), D20 (quest metadata pairs by content) and D45(1) (the
 * null/absent-key-preserving merge, so an update diff stays confined to the edit).
 *
 * It is deliberately **server-side and UI-free**: the quests API (`POST
 * /api/quests`) is task 2.5 and the Save All UI is task 2.6/2.7. This module owns
 * the server half of "confirm before overwriting an existing quest" — detecting
 * that the key already exists and reporting `outcome: 'updated'` with action
 * `update` — while the confirmation dialog itself belongs to the caller.
 *
 * Callers drive Save All by calling `saveObject` once per object: N objects are N
 * sequential commits (D13), never one commit per batch.
 */

/** The action a caller asks for when the key is new; an existing key always wins with `update`. */
export type SaveRequestedAction = 'extract' | 'create';

/** The action actually committed (docs/spec-data-model.md L223). */
export type SaveCommitAction = SaveRequestedAction | 'update';

export type SaveOutcome = 'created' | 'updated';

export interface SaveObjectRequest {
  /** Which family is being saved (`questtemplates`, `droptable`, …). */
  fileType: ObjectFileType;
  /** The object to write. For an update it is merged into the file on disk. */
  data: Record<string, unknown>;
  /** Explicit key; defaults to the family's key field inside `data`. */
  key?: string;
  /** Action for a *new* key (`extract` for extraction saves, `create` for editors). */
  action?: SaveRequestedAction;
  /** Optional commit-message body. */
  notes?: string;
  /** When set and different, a `status_history` transition row is appended. */
  status?: StatusValue;
  /**
   * `status_history.notes` for a transition of an **already-tracked** entry, and
   * the fallback initial-row note when {@link historyNotesOnCreate} is absent.
   */
  historyNotes?: string;
  /**
   * `status_history.notes` for the entry's **first row** — the note written when
   * this save inserts the `entry_status` row, i.e. the entry's first appearance in
   * tracking (gap B of story p2-07, `docs/plan-phase-2-quest-extraction.md` §2.4
   * with `docs/spec-api.md` L122). The extraction save records the capture file
   * name here.
   *
   * The trigger is the **row insert, not the file outcome**: an existing corpus file
   * saved for an untracked entry is `outcome: 'updated'` yet still gets this note.
   * An update of an already-tracked entry records nothing at all — no note, no
   * status change, no history row (D49(d)); {@link historyNotes} covers that path's
   * explicit transition only. Takes precedence over `historyNotes` on insert.
   */
  historyNotesOnCreate?: string;
  /** Overrides the quest metadata `Description` on a create. */
  metadataDescription?: string;
}

export interface SaveObjectResult {
  fileType: ObjectFileType;
  key: string;
  /** `updated` when the key already existed (D19/ac5), else `created`. */
  outcome: SaveOutcome;
  action: SaveCommitAction;
  /** Absolute path written. An update writes the file's *original* path. */
  filePath: string;
  /** The same path relative to the SpiralDB root (what was committed). */
  relativePath: string;
  /** Absolute path of the paired quest metadata file (`null` for non-quests). */
  metadataPath: string | null;
  metadataRelativePath: string | null;
  metadataOutcome: SaveOutcome | null;
  /** Commit sha, branch and message of this save's single commit. */
  commit: string;
  branch: string;
  commitMessage: string;
  /** The `entry_status` row after the upsert; `null` for untracked families. */
  status: StatusEntryRow | null;
  /**
   * Whether this save inserted the `entry_status` row — the entry's first
   * appearance in tracking. Independent of {@link outcome}: saving a quest whose
   * file already exists is `outcome: 'updated'` with `statusCreated: true`. Always
   * `false` for a family with no lifecycle.
   */
  statusCreated: boolean;
}

export interface SavePipelineOptions {
  /** Connection used for the status upsert and for `user_name`/`git_branch`. */
  db: Db;
  /** SpiralDB repository root — must be the root the injected index was built on. */
  spiraldbPath: string;
  /**
   * The shared content-keyed index (D19). The pipeline resolves updates through it
   * and rebuilds the saved family's directory afterwards, so the caller's index —
   * the same one `GET /:key` will use in task 2.5 — always reflects disk.
   */
  index: SpiraldbIndex;
  /** Git layer override; defaults to `simple-git` against `spiraldbPath`. */
  git?: GitService;
  /** Clock, injectable so tests get deterministic timestamps. */
  now?: () => Date;
}

export interface SavePipeline {
  readonly root: string;
  saveObject(request: SaveObjectRequest): Promise<SaveObjectResult>;
  /** Sequential, fail-fast: N objects are N commits (D13). */
  saveAll(requests: SaveObjectRequest[]): Promise<SaveObjectResult[]>;
}

interface StatusUpsertInput {
  objectType: StatusObjectType;
  objectKey: string;
  /** Absent means "do not change an existing entry's status". */
  status?: StatusValue;
  /** Note for a transition of an entry that already exists. */
  notes?: string | null;
  /** Note for the initial row; used only when this call inserts the entry. */
  notesOnCreate?: string | null;
  changedBy: string;
  now: string;
}

/**
 * Ensures the `entry_status` row exists and appends history the way the spec's
 * own example does (docs/spec-api.md L122: `old_status: null` for a first
 * `extracted`).
 *
 * Three cases:
 *
 * - **New entry** — inserted with `status` (default `extracted`) and
 *   `extracted_at = now`, then one history row `null → status` carrying
 *   `notesOnCreate`. The insert is reported as `created: true` so the caller can
 *   tell the entry's first appearance in tracking apart from a file update.
 *   `extracted_at` is set here on purpose: `applyStatusChange` deliberately leaves
 *   it alone for `extracted`, because that column records when the milestone was
 *   *first* reached (server/src/services/status.ts L288-295). The schema has no
 *   `extracted_by` column (verified: `server/migrations/0001_init.sql` L17-36), so
 *   there is nothing to set for the actor beyond the history row's `changed_by`.
 * - **Existing entry, different status** — delegated to `applyStatusChange`, which
 *   updates the status and appends the transition row (`created: false`; the entry
 *   row is known to exist, so its `undefined`-for-unknown-key contract is never hit
 *   — D31(d)).
 * - **Existing entry, same or absent status** — nothing to record; re-saving a
 *   quest must not append a duplicate "extracted" row, and an editor save must
 *   never reset a `verified` entry back to `extracted`.
 */
function upsertEntryStatus(
  db: Db,
  input: StatusUpsertInput,
): { entry: StatusEntryRow; created: boolean } {
  const existing = getStatusEntry(db, input.objectType, input.objectKey);

  if (existing !== undefined) {
    if (input.status === undefined || input.status === existing.status) {
      return { entry: existing, created: false };
    }
    return {
      entry:
        applyStatusChange(db, {
          objectType: input.objectType,
          objectKey: input.objectKey,
          status: input.status,
          notes: input.notes ?? null,
          changedBy: input.changedBy,
          now: input.now,
        }) ?? existing,
      created: false,
    };
  }

  const status = input.status ?? 'extracted';
  const note = input.notesOnCreate ?? input.notes ?? null;
  const insertInitial = db.transaction((): number => {
    const inserted = db
      .prepare(
        `INSERT INTO entry_status (object_type, object_key, status, extracted_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(input.objectType, input.objectKey, status, input.now);
    db.prepare(
      `INSERT INTO status_history (entry_status_id, old_status, new_status, notes, changed_by, changed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(inserted.lastInsertRowid, null, status, note, input.changedBy, input.now);
    return Number(inserted.lastInsertRowid);
  });
  insertInitial();

  const created = getStatusEntry(db, input.objectType, input.objectKey);
  if (created === undefined) {
    throw new Error(
      `entry_status row for ${input.objectType}/${input.objectKey} disappeared right after insert`,
    );
  }
  return { entry: created, created: true };
}

/**
 * Builds the pipeline for one SpiralDB root.
 *
 * `spiraldbPath` and the injected index's root must agree — a mismatch would write
 * files into one repository and commit them in another, so it fails here instead.
 * `user_name` and `git_branch` are read per save (the owner can change either
 * between saves without rebuilding the pipeline).
 */
export function createSavePipeline(options: SavePipelineOptions): SavePipeline {
  const root = options.index.root;
  if (root !== options.spiraldbPath) {
    throw new Error(
      `Save pipeline root mismatch: index root ${root} but spiraldbPath ${options.spiraldbPath}. ` +
        `Build the index from settings.spiraldb_path.`,
    );
  }

  const db = options.db;
  const index = options.index;
  const now = options.now ?? ((): Date => new Date());

  const git =
    options.git ??
    createGitService({
      repoPath: root,
      settingsBranch: () => readSettings(db).git_branch,
      persistBranch: (branch) => {
        writeSetting(db, 'git_branch', branch);
      },
    });

  /** Writes the paired quest metadata file, updating the existing one in place (D20). */
  function writeQuestMetadata(
    name: string,
    input: { now: string; user: string; description?: string },
  ): { path: string; outcome: SaveOutcome } {
    const paired = index.pathFor('questmetadata', name);
    if (paired !== undefined) {
      writeSpiraldbJson(paired, refreshQuestMetadata(readSpiraldbJson(paired), input));
      return { path: paired, outcome: 'updated' };
    }
    const target = createTargetPath(root, collectionSpec('questmetadata'), name);
    writeSpiraldbJson(target, buildQuestMetadata(name, input));
    return { path: target, outcome: 'created' };
  }

  async function saveObject(request: SaveObjectRequest): Promise<SaveObjectResult> {
    const spec = collectionSpec(request.fileType);
    if (!spec.saveable) {
      throw new SpiraldbFileError(
        `${spec.fileType} is not a saveable SpiralDB object type — it is written together ` +
          `with the object it belongs to.`,
      );
    }

    // D38: the name is the commit author and the metadata CreatedBy/ModifiedBy, so
    // a save without one is refused with an actionable message rather than
    // committing as nobody.
    const user = (readSettings(db).user_name ?? '').trim();
    if (user === '') {
      throw new SpiraldbFileError(
        'Cannot save to SpiralDB: settings.user_name is empty. Set your name in Settings ' +
          'first — it becomes the git commit author and the metadata CreatedBy/ModifiedBy.',
      );
    }

    const timestamp = now();
    const nowIso = timestamp.toISOString();
    const key = resolveObjectKey(spec, request.data, request.key);

    // D19: an existing key resolves to the path the file actually lives at; only a
    // new key uses the naming convention.
    const indexedPath = spec.keyField === null ? undefined : index.pathFor(spec.fileType, key);
    const conventionPath = createTargetPath(root, spec, key);
    const unkeyedExisting = spec.keyField === null && fs.existsSync(conventionPath);
    const outcome: SaveOutcome =
      indexedPath !== undefined || unkeyedExisting ? 'updated' : 'created';

    if (outcome === 'created' && fs.existsSync(conventionPath)) {
      throw new SpiraldbFileError(
        `Cannot create ${conventionPath}: a different entry already occupies the naming ` +
          `convention's path for key "${key}". Rename or remove that file first.`,
      );
    }

    const filePath = indexedPath ?? conventionPath;
    const action: SaveCommitAction =
      outcome === 'updated' ? 'update' : (request.action ?? 'create');

    // 1. D14 — fail closed before anything is written or checked out.
    await git.assertClean();

    // 2. Branch strategy (docs/spec-data-model.md L206-214).
    const session = await git.ensureSessionBranch({ date: timestamp });

    // 3. The payload. An update merges into the file on disk so omitted nulls
    //    survive (D45(1)); a create writes the object as given.
    let payload: unknown;
    if (outcome === 'updated') {
      const existing = readSpiraldbJson(filePath);
      payload = mergePreservingAbsent(existing, request.data);
    } else {
      payload = request.data;
    }

    // 4. Write the file (clean JSON) and refresh the index for this family.
    writeSpiraldbJson(filePath, payload);
    index.rebuildType(spec.fileType);

    // 5. Companion metadata — quests only (docs/spec-data-model.md L191).
    let metadata: { path: string; outcome: SaveOutcome } | null = null;
    if (spec.fileType === 'questtemplates') {
      metadata = writeQuestMetadata(key, {
        now: nowIso,
        user,
        description: request.metadataDescription,
      });
      index.rebuildType('questmetadata');
    }

    // 6. One commit for the object and its metadata (D13).
    const committed = await git.commitObject({
      action,
      objectType: spec.commitType,
      objectKey: key,
      notes: request.notes,
      author: user,
      paths: [filePath, ...(metadata === null ? [] : [metadata.path])],
    });

    // 7. Verification status (skipped for families with no lifecycle).
    //
    // The first-row note (gap B) belongs to the *entry*, so the upsert — not
    // `outcome` — decides it: it is written whenever the row is inserted, including
    // an existing corpus file saved as `outcome: 'updated'`. An update of an
    // already-tracked entry keeps its own history and its status is never touched
    // (D49(d)).
    const statusUpsert =
      spec.objectType === null
        ? null
        : upsertEntryStatus(db, {
            objectType: spec.objectType,
            objectKey: key,
            status: request.status,
            notes: request.historyNotes,
            notesOnCreate: request.historyNotesOnCreate ?? request.historyNotes,
            changedBy: user,
            now: nowIso,
          });

    return {
      fileType: spec.fileType,
      key,
      outcome,
      action,
      filePath,
      relativePath: committed.paths[0],
      metadataPath: metadata?.path ?? null,
      metadataRelativePath: metadata === null ? null : (committed.paths[1] ?? null),
      metadataOutcome: metadata?.outcome ?? null,
      commit: committed.sha,
      branch: session.branch,
      commitMessage: committed.message,
      status: statusUpsert?.entry ?? null,
      statusCreated: statusUpsert?.created ?? false,
    };
  }

  async function saveAll(requests: SaveObjectRequest[]): Promise<SaveObjectResult[]> {
    const results: SaveObjectResult[] = [];
    for (const request of requests) {
      results.push(await saveObject(request));
    }
    return results;
  }

  return { root, saveObject, saveAll };
}
