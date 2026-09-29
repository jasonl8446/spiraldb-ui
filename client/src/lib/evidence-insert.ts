/**
 * The evidence panel's **insert reducer** — plan task 6.7 (story p6-08), the contract the panel's
 * one-click insert rests on.
 *
 * What it is: a **pure function** from `(row, target)` to the document mutation that row's insert
 * performs, plus the reason and the sentence the UI shows when it performs none. No DOM, no React,
 * no network, no document — the whole point is that "what a click writes" is decidable and testable
 * without a browser (`tests/unit/evidence-insert.test.ts`).
 *
 * ## The document stores **keys**, the panel shows **text**
 *
 * Every string this panel can insert is a **string-table key**, not the text a reader sees:
 * measured on `WC-CYCLOPS-MAIN-002` and across the 322-file D17 clone, `m_dialog` holds
 * `WizQst17318F_00000006` (27/27 non-empty), `m_locationName` holds `ZoneLocName_9140` (746 of 772
 * corpus goals) and `m_goalTitle` holds `WizardQuestGoals_TalkNPC`. `string_table` is what turns
 * each key into prose, and `m_goalName` shows the other convention — `1_WizardQuestGoals_TalkNPC`
 * is a **literal**, not a key, and is deliberately not an insert target.
 *
 * So an evidence row is a `(key, text)` pair: the panel renders `value`, the reducer writes `key`.
 * Writing the text would look plausible and resolve to nothing in every downstream reader.
 * {@link EvidenceInsertRow.key} is the only value the plan's edit ever carries.
 *
 * ## Which field a row belongs to
 *
 * The plan's own sentence is focus-driven — *"dialogue into the focused `m_dialog`, goal text into
 * the focused goal, location name into `m_locationName`"* (docs/spec-ui-design.md L437-438) — and
 * measured truth agrees: an **available** row carries `field: null` from the API, so the row cannot
 * know where it belongs. Three rungs, in order:
 *
 * | rung | when | target |
 * |---|---|---|
 * | 1. provenance | a **text** row whose `field`'s last segment is one of the three | that exact path |
 * | 2. focus | otherwise | the {@link EvidenceInsertTarget} the caller passes (the editor's focused field) |
 * | 3. refuse | no focus, or a row the focused field cannot hold | **no edit** + a sentence |
 *
 * Rung 1 is what makes "the field it belongs to" literal for a *used* row: the API already hands it
 * the path of the file value that references its key, and re-writing that path is the exact,
 * single-field edit the acceptance criterion measures. It is deliberately restricted to the three
 * field kinds this story owns — a used row whose provenance is `m_questTitle` is this file's title
 * material and the plan gives the panel no title insert, so it falls to rung 2 rather than writing
 * a field whose editor is the Info tab's.
 *
 * Rung 1 is **text rows only**. A dialogue row's provenance is its own entry's `m_dialog` — where
 * the line already is — so an insert there would be a no-op; dialogue rows therefore always follow
 * the focused entry, which is also the spec's wording.
 *
 * ## The compatibility rule
 *
 * A text row is the quest's own prose and may fill any of the three fields. A **dialogue** row is an
 * existing line of the file, and the plan maps it to `m_dialog` only. That is a convention this
 * story encodes from the plan, not a property of the key — the key is a bare string in every case —
 * and it is stated here rather than discovered from the data.
 *
 * ## Nothing inserts automatically
 *
 * {@link planEvidenceInsert} only *describes* an edit. The panel hands the `edit` to the page's
 * `useQuestDocument().edit`, which goes through `shared/document.ts`'s `applyEdits` — the editors'
 * single mutation contract (D58). The panel never writes to a file, and no save path is reachable
 * from this module (see `EvidencePanel.tsx`'s source-scan test).
 */

import {
  formatDocPath,
  hasAtPath,
  parseDocPath,
  type DocEdit,
  type DocPath,
} from '@shared/document';

/* ------------------------------------------------------------------- vocabulary */

/** The three fields the plan names as insert targets. */
export type EvidenceInsertFieldKind = 'm_dialog' | 'm_goalText' | 'm_locationName';

/** The three kinds, in the plan's own order — the panel's select and its tests share this list. */
export const EVIDENCE_INSERT_FIELD_KINDS: readonly EvidenceInsertFieldKind[] = [
  'm_dialog',
  'm_goalText',
  'm_locationName',
];

/**
 * How a row is offered: the quest's **own text material** (a row of its `WizQst<id>_*` table), or a
 * **dialogue line already in the file** (an `NPCDialogEntry` with an `m_dialog` key).
 */
export type EvidenceRowKind = 'text' | 'dialogue';

/** One row the panel can insert. */
export interface EvidenceInsertRow {
  /** Stable id for React keys and test locators (`text:<key>` / `dialogue:<key>`). */
  id: string;
  kind: EvidenceRowKind;
  /** **The string-table key this insert writes** — never the resolved text. */
  key: string;
  /**
   * The path of the file value that already references {@link key} — the API's
   * `text_rows[].field` / `dialogue[].field`, parsed. `null` for every row nothing references.
   */
  field: DocPath | null;
}

/** The field the user has focused — the one rung 2 writes. */
export interface EvidenceInsertTarget {
  kind: EvidenceInsertFieldKind;
  /** The exact path the insert writes, e.g. `['m_goals', 2, 'm_goalText']`. */
  path: DocPath;
  /** {@link formatDocPath} of {@link path} — the attribution the panel shows before the click. */
  label: string;
}

/** The field kinds, or `null` when a path's last segment names none of them. */
export function insertFieldKindOf(path: DocPath): EvidenceInsertFieldKind | null {
  const last = path[path.length - 1];
  return typeof last === 'string' &&
    (EVIDENCE_INSERT_FIELD_KINDS as readonly string[]).includes(last)
    ? (last as EvidenceInsertFieldKind)
    : null;
}

/** Builds a target from a path, deriving its kind; `null` when the path names no insertable field. */
export function insertTargetAt(path: DocPath): EvidenceInsertTarget | null {
  const kind = insertFieldKindOf(path);
  return kind === null ? null : { kind, path, label: formatDocPath(path) };
}

/* --------------------------------------------------------------------- refusals */

/** Why an insert was refused. */
export type EvidenceInsertRefusal = 'no-key' | 'no-target' | 'incompatible';

/** Every refusal's sentence, so the panel and the tests quote one string. */
export const EVIDENCE_INSERT_REFUSAL_MESSAGES: Readonly<Record<EvidenceInsertRefusal, string>> = {
  'no-key': 'This row carries no string-table key, so there is nothing to insert.',
  'no-target':
    'Nothing is focused — click into a goal, a goal’s location name, or a dialog entry, then insert.',
  incompatible:
    'A dialogue line can only fill a dialog entry’s m_dialog; the focused field is a goal field.',
};

/** The sentence the panel shows for the view-mode case (no editable document is mounted at all). */
export const EVIDENCE_INSERT_VIEW_MODE_MESSAGE =
  'View mode shows a read-only document — switch to Edit to insert.';

/** A refused insert: nothing is written, and {@link message} is what the UI says. */
export interface EvidenceInsertRefused {
  ok: false;
  reason: EvidenceInsertRefusal;
  message: string;
}

/** An accepted insert: exactly one `set`, through the primitives every editor uses. */
export interface EvidenceInsertAccepted {
  ok: true;
  /**
   * The mutation. `op: 'set'` covers both an existing field and an **absent** one — measured: no
   * corpus goal carries `m_goalText`, so the plan's "goal text into the focused goal" *adds* the
   * key, and `setAtPath` appends it (D5: adding a field is a legitimate merge).
   */
  edit: DocEdit;
  path: DocPath;
  label: string;
  kind: EvidenceInsertFieldKind;
  /** Which rung answered: the row's own provenance, or the caller's focused field. */
  source: 'row' | 'focus';
  /** `true` when the target path already exists in the document — an overwrite, not an add. */
  overwrites: boolean;
}

/**
 * The plan for one row. `doc` is optional and used **only** to report `overwrites` (the honest
 * add-versus-overwrite label); the edit itself is identical either way, so the reducer stays
 * decidable from `(row, target)` alone.
 */
export type EvidenceInsertPlan = EvidenceInsertAccepted | EvidenceInsertRefused;

function refused(reason: EvidenceInsertRefusal, message?: string): EvidenceInsertRefused {
  return {
    ok: false,
    reason,
    message: message ?? EVIDENCE_INSERT_REFUSAL_MESSAGES[reason],
  };
}

/* ---------------------------------------------------------------------- reducer */

/**
 * `(row, target) → the document mutation`, or the reason there is none.
 *
 * `target` is the **focused field** and is `null` whenever nothing is focused — which is the honest
 * state of the view-mode panel (no editor is mounted to focus), of a fresh edit-mode page, and of
 * the panel when it is open beside a tab with no insertable field. {@link EVIDENCE_INSERT_REFUSAL_MESSAGES}
 * owns the sentences.
 */
export function planEvidenceInsert(
  row: EvidenceInsertRow,
  target: EvidenceInsertTarget | null,
  doc?: unknown,
): EvidenceInsertPlan {
  if (row.key === '') {
    return refused('no-key');
  }
  const provenance = row.kind === 'text' ? row.field : null;
  const fromRow = provenance === null ? null : insertTargetAt(provenance);
  const resolved = fromRow ?? target;
  if (resolved === null) {
    return refused('no-target');
  }
  if (row.kind === 'dialogue' && resolved.kind !== 'm_dialog') {
    return refused('incompatible');
  }
  return {
    ok: true,
    edit: { op: 'set', path: resolved.path, value: row.key },
    path: resolved.path,
    label: resolved.label,
    kind: resolved.kind,
    source: fromRow === null ? 'focus' : 'row',
    overwrites: doc === undefined ? false : hasAtPath(doc, resolved.path),
  };
}

/**
 * The **one** sentence a whole section can show, when every row in it refused for the same reason.
 *
 * A section with nothing focused refuses on every row, and repeating one sentence per row is noise
 * rather than information; the panel prints it once above the list. Rows that refuse *individually*
 * (`no-key`) keep their own sentence — this helper only fires when the reason is unanimous, and in
 * view mode it reports {@link EVIDENCE_INSERT_VIEW_MODE_MESSAGE}, which is the real reason there.
 */
export function sectionRefusalMessage(
  plans: readonly EvidenceInsertPlan[],
  options: { editable: boolean } = { editable: true },
): string | null {
  if (plans.length === 0 || plans.some((plan) => plan.ok)) {
    return null;
  }
  const first = plans[0];
  if (first === undefined || first.ok) {
    return null;
  }
  if (plans.some((plan) => !plan.ok && plan.reason !== first.reason)) {
    return null;
  }
  if (!options.editable && first.reason === 'no-target') {
    return EVIDENCE_INSERT_VIEW_MODE_MESSAGE;
  }
  return first.message;
}

/* ------------------------------------------------------------------------- rows */

/**
 * The part of the wire payload the row builders read — declared structurally so this module keeps
 * its single import (`@shared/document`) and accepts the API's answer without depending on it.
 */
export interface EvidenceTextRowSource {
  key: string;
  field: string | null;
}

export interface EvidenceDialogueRowSource {
  index: number;
  field: string;
  dialog_key: string | null;
}

/** A text row as the reducer sees it. `field` is parsed; an unparsable one becomes `null`. */
export function textInsertRow(row: EvidenceTextRowSource): EvidenceInsertRow {
  return {
    id: `text:${row.key}`,
    kind: 'text',
    key: row.key,
    field: row.field === null ? null : parseDocPath(row.field),
  };
}

/**
 * A dialogue row as the reducer sees it. `field` is the entry's own `m_dialog` path — the field the
 * line **already fills** — while the reducer ignores it for dialogue rows by design (an insert
 * there would be a no-op); the panel uses it to say where the line currently is.
 *
 * A dialogue row with no `dialog_key` is the "no key" case: the entry names no `WizQst…` row, so the
 * row carries an empty key and every plan for it refuses with {@link EVIDENCE_INSERT_REFUSAL_MESSAGES}.
 */
export function dialogueInsertRow(row: EvidenceDialogueRowSource): EvidenceInsertRow {
  const entry = parseDocPath(row.field);
  const field = entry === null ? null : [...entry, 'm_dialog'];
  const key = row.dialog_key ?? '';
  return { id: `dialogue:${row.index}`, kind: 'dialogue', key, field };
}

/* ------------------------------------------------------------------------- badge */

/** The `title_source: 'inferred'` badge's visible text (D106 — inference is shown, never trusted). */
export const INFERRED_TITLE_BADGE_LABEL = 'Title inferred';

/**
 * The badge text for a catalog link's provenance, or `null` when there is none to show.
 *
 * Deliberately keyed on the **evidence** enum (`direct | inferred | none`, `quests.title_source`)
 * and never on the quests *list* endpoint's per-file vocabulary (`resolved | rawKey | missing`,
 * spec-data-model L209-214). The two share the word "title_source" and mean different things, so a
 * value from the wrong enum — `'resolved'`, `'rawKey'`, `'missing'` — produces **no badge** rather
 * than a guess; `tests/unit/evidence-insert.test.ts` falsifies exactly that confusion.
 */
export function inferredTitleBadge(source: string | null | undefined): string | null {
  return source === 'inferred' ? INFERRED_TITLE_BADGE_LABEL : null;
}
