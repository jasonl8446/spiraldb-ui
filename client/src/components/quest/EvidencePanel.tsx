import {
  EVIDENCE_AVAILABLE_EMPTY,
  EVIDENCE_AVAILABLE_HEADING,
  EVIDENCE_DIALOGUE_EMPTY,
  EVIDENCE_DIALOGUE_HEADING,
  EVIDENCE_GATES_EMPTY,
  EVIDENCE_GATES_HEADING,
  EVIDENCE_INSERT_LABEL,
  EVIDENCE_LOAD_ERROR,
  EVIDENCE_LOADING,
  EVIDENCE_NO_TITLE,
  EVIDENCE_REFERENCES_EMPTY,
  EVIDENCE_REFERENCES_HEADING,
  EVIDENCE_TARGET_LABEL,
  EVIDENCE_TARGET_NONE,
  EVIDENCE_TITLE_LABEL,
  EVIDENCE_USED_EMPTY,
  EVIDENCE_USED_HEADING,
  EVIDENCE_WARNINGS_EMPTY,
  EVIDENCE_WARNINGS_HEADING,
} from '../../lib/quests';
import type {
  QuestEvidence,
  QuestEvidenceDialogue,
  QuestEvidenceReference,
  QuestEvidenceTextRow,
} from '../../lib/api';
import type { ReactNode } from 'react';
import {
  dialogueInsertRow,
  inferredTitleBadge,
  planEvidenceInsert,
  sectionRefusalMessage,
  textInsertRow,
  type EvidenceInsertAccepted,
  type EvidenceInsertPlan,
  type EvidenceInsertRow,
  type EvidenceInsertTarget,
} from '../../lib/evidence-insert';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

/**
 * `EvidencePanel` — the quest evidence surface in the right rail (plan task 6.7, story p6-08;
 * docs/spec-ui-design.md L412-454, D102–D105).
 *
 * It renders task 6.6's answer (`GET /api/quests/:name/evidence`) grouped by field, with one insert
 * action per row, and it **never writes to the file**: the only mutation it can cause is the
 * `DocEdit` an accepted {@link planEvidenceInsert} describes, handed to the `onInsert` prop — which
 * the page wires to `useQuestDocument().edit` (the `shared/document.ts` primitives, D58). This
 * module imports no save path, no API client and no server module, and
 * `tests/unit/evidence-panel.test.ts` asserts that at the source level **and** proves the assertion
 * bites, by running it over a deliberately mutated copy of this file.
 *
 * Five behaviours the spec asks for, and where each lives:
 *
 * 1. **Grouped by field.** `Used by this file` groups its rows by the field each one already fills
 *    (the API's `text_rows[].field`) and every row prints `→ <target>`: the field the click will
 *    write, computed by the same reducer the click runs. `Available` rows have no provenance, so
 *    their `→` is the focused field (the panel header shows it too).
 * 2. **Own text, split.** `Used by this file` / `Available` are the API's own
 *    `used_by_this_file` partition — computed per row, never guessed here.
 * 3. **Nothing inserts automatically.** Every row renders a button, or — when the reducer refuses —
 *    **no button and the reason as text**. There is no click-free path and no silent no-op.
 * 4. **The inferred title is visibly marked.** `title_source: 'inferred'` renders the badge
 *    (`lib/evidence-insert.ts`'s `inferredTitleBadge`, D106), and `direct`/`none` render none. A
 *    value from the quests list endpoint's *different* `title_source` vocabulary produces no badge.
 * 5. **Missing material is counted, never dropped.** Empty sections say they are empty, and the
 *    API's `warnings` are listed.
 *
 * The panel is presentational: it holds no state, fetches nothing and mutates nothing. Loading and
 * error are the page's query states, passed in.
 */
export interface EvidencePanelProps {
  /** The API's answer, or `undefined` while it is loading / after a failure. */
  evidence: QuestEvidence | undefined;
  isLoading: boolean;
  isError: boolean;
  /** The focused field the editor reported — `null` when nothing is focused. */
  target: EvidenceInsertTarget | null;
  /** `true` in edit mode: the view-mode explanation is the honest reason there. */
  editable: boolean;
  /**
   * The live document, read **only** to label an insert "add" or "overwrite" — never written to.
   * Optional so a render without a document is still valid.
   */
  doc?: unknown;
  /** Applies one accepted plan's edit (the page wires this to the document state's `edit`). */
  onInsert: (plan: EvidenceInsertAccepted) => void;
  className?: string;
}

export default function EvidencePanel({
  evidence,
  isLoading,
  isError,
  target,
  editable,
  doc,
  onInsert,
  className,
}: EvidencePanelProps): JSX.Element {
  if (isLoading) {
    return (
      <p role="status" className={cn('p-3 text-sm text-zinc-400', className)}>
        {EVIDENCE_LOADING}
      </p>
    );
  }
  if (isError || evidence === undefined) {
    return (
      <p role="alert" className={cn('p-3 text-sm text-rose-300', className)}>
        {EVIDENCE_LOAD_ERROR}
      </p>
    );
  }

  const used = evidence.text_rows.filter((row) => row.used_by_this_file);
  const available = evidence.text_rows.filter((row) => !row.used_by_this_file);
  const badge = inferredTitleBadge(evidence.quest.title_source);

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-3', className)}>
      <header className="flex flex-col gap-1">
        <p className="text-sm text-zinc-100">
          <span className="text-zinc-400">{EVIDENCE_TITLE_LABEL}: </span>
          {evidence.quest.title ?? EVIDENCE_NO_TITLE}
          {badge === null ? null : (
            <Badge variant="outline" className="ml-2 border-amber-500/60 text-amber-300">
              {badge}
            </Badge>
          )}
        </p>
        <p className="font-mono text-xs text-zinc-400">
          {evidence.quest.quest_name ?? `id ${String(evidence.quest.quest_id)}`}
          {evidence.quest.has_definition ? null : ' · no definition in the corpus'}
        </p>
        {/*
          The basis travels with an inferred link (spec-api L486-489): an inference is shown, never
          silently trusted.
        */}
        {evidence.quest.inference_basis === null ? null : (
          <p className="text-xs text-amber-300/90">{evidence.quest.inference_basis}</p>
        )}
        <p className="text-xs text-zinc-400" data-testid="evidence-target">
          {`${EVIDENCE_TARGET_LABEL}: `}
          <span className="font-mono text-zinc-300">{target?.label ?? EVIDENCE_TARGET_NONE}</span>
        </p>
      </header>

      <TextSection
        heading={EVIDENCE_USED_HEADING}
        empty={EVIDENCE_USED_EMPTY}
        rows={used}
        grouped
        {...{ target, editable, doc, onInsert }}
      />
      <TextSection
        heading={EVIDENCE_AVAILABLE_HEADING}
        empty={EVIDENCE_AVAILABLE_EMPTY}
        rows={available}
        {...{ target, editable, doc, onInsert }}
      />
      <DialogueSection rows={evidence.dialogue} {...{ target, editable, doc, onInsert }} />
      <GatesSection gates={evidence.goal_gates} />
      <ReferencesSection references={evidence.references} />
      <WarningsSection warnings={evidence.warnings} />
    </div>
  );
}

/* --------------------------------------------------------------------- actions */

/**
 * One row's insert action: a labelled button, or nothing at all (with the reason shown nearby).
 *
 * The button is the only thing on the row's first line — the field it writes is a **second,
 * truncated line** ({@link InsertTarget}) rather than a sibling of the key. Measured on the real
 * stack: a dialog path (`m_goals[0].m_dialogList.m_dialogs[0].m_dialogEntries[0].m_dialog`) is
 * wider than the 400px rail, and as a flex sibling of the key it squeezed the key to one character
 * per line.
 */
function InsertAction({
  plan,
  row,
  onInsert,
}: {
  plan: EvidenceInsertPlan;
  row: EvidenceInsertRow;
  onInsert: (plan: EvidenceInsertAccepted) => void;
}): JSX.Element | null {
  if (!plan.ok) {
    return null;
  }
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="shrink-0"
      aria-label={`${EVIDENCE_INSERT_LABEL} ${row.key}`}
      title={
        plan.overwrites
          ? `Overwrite ${plan.label} with this key`
          : `Add ${plan.label} with this key`
      }
      onClick={() => onInsert(plan)}
    >
      {EVIDENCE_INSERT_LABEL}
    </Button>
  );
}

/** The field an accepted insert writes, on its own truncated line with the full path in `title`. */
function InsertTarget({ plan }: { plan: EvidenceInsertPlan }): JSX.Element | null {
  if (!plan.ok) {
    return null;
  }
  return (
    <span className="min-w-0 truncate font-mono text-[10px] text-zinc-400" title={plan.label}>
      {`→ ${plan.label}`}
    </span>
  );
}

/* --------------------------------------------------------------------- sections */

/** The props every insertable section shares. */
interface InsertSectionProps {
  target: EvidenceInsertTarget | null;
  editable: boolean;
  doc: unknown;
  onInsert: (plan: EvidenceInsertAccepted) => void;
}

/**
 * The one section shell: the accessible `<section>`, the `── heading ──` rule, the optional
 * refusal sentence and the empty-state paragraph.
 *
 * All five sections open with exactly these elements, differing only in the constant they name, and
 * the tier-1 arms find them by role and text — so the shell lives here once (including the
 * `evidence-refusal-${heading}` testid spelling) rather than five times, where a later edit to one
 * copy could change the DOM of one section alone.
 */
function EvidenceSection({
  heading,
  empty,
  isEmpty,
  refusal,
  children,
}: {
  heading: string;
  empty: string;
  isEmpty: boolean;
  /** A sentence explaining why the whole section refuses, or `null`/absent when it does not. */
  refusal?: string | null;
  children: ReactNode;
}): JSX.Element {
  return (
    <section aria-label={heading} className="flex flex-col gap-2">
      <h3 className="font-mono text-xs text-zinc-400">{`── ${heading} ──`}</h3>
      {refusal === undefined || refusal === null ? null : (
        <p className="text-xs text-zinc-400" data-testid={`evidence-refusal-${heading}`}>
          {refusal}
        </p>
      )}
      {isEmpty ? <p className="text-sm text-zinc-400">{empty}</p> : children}
    </section>
  );
}

/**
 * One `Used by this file` / `Available` section: each row's key and text, its insert action, and
 * the sentence explaining a refusal — once, when the whole section refuses for one reason.
 */
function TextSection({
  heading,
  empty,
  rows,
  grouped = false,
  target,
  editable,
  doc,
  onInsert,
}: InsertSectionProps & {
  heading: string;
  empty: string;
  rows: QuestEvidenceTextRow[];
  /** `Used by this file` groups its rows under the field each already fills. */
  grouped?: boolean;
}): JSX.Element {
  const entries = rows.map((row) => {
    const insertRow = textInsertRow(row);
    return { row: insertRow, plan: planEvidenceInsert(insertRow, target, doc) };
  });
  const sectionMessage = sectionRefusalMessage(
    entries.map((entry) => entry.plan),
    { editable },
  );
  return (
    <EvidenceSection
      heading={heading}
      empty={empty}
      isEmpty={rows.length === 0}
      refusal={sectionMessage}
    >
      {grouped ? (
        <ul className="flex flex-col gap-3">
          {groupedByField(rows, entries).map(([field, group]) => (
            <li key={field} className="flex flex-col gap-1">
              <p className="font-mono text-[11px] text-emerald-300/90">{field}</p>
              <ul className="flex flex-col gap-2">
                {group.map((entry) => (
                  <TextRow
                    key={entry.row.id}
                    entry={entry}
                    showMessage={sectionMessage === null}
                    onInsert={onInsert}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <TextRow
              key={entry.row.id}
              entry={entry}
              showMessage={sectionMessage === null}
              onInsert={onInsert}
            />
          ))}
        </ul>
      )}
    </EvidenceSection>
  );
}

/** One row and the plan its insert button runs — computed once per render. */
interface PlannedRow {
  row: EvidenceInsertRow;
  plan: EvidenceInsertPlan;
}

/** `text_rows` grouped by their `field`, preserving the API's key order inside each group. */
function groupedByField(
  rows: readonly QuestEvidenceTextRow[],
  entries: readonly PlannedRow[],
): Array<[string, PlannedRow[]]> {
  const groups = new Map<string, PlannedRow[]>();
  rows.forEach((row, index) => {
    const entry = entries[index];
    if (entry === undefined) {
      return;
    }
    const list = groups.get(row.field ?? '—');
    if (list === undefined) {
      groups.set(row.field ?? '—', [entry]);
    } else {
      list.push(entry);
    }
  });
  return [...groups.entries()];
}

/** One text row: its key, its text, its insert action and — when the section does not say it — why not. */
function TextRow({
  entry,
  showMessage,
  onInsert,
}: {
  entry: PlannedRow;
  showMessage: boolean;
  onInsert: (plan: EvidenceInsertAccepted) => void;
}): JSX.Element {
  const { row, plan } = entry;
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-xs text-zinc-200" title={row.key}>
          {row.key}
        </span>
        <InsertAction plan={plan} row={row} onInsert={onInsert} />
      </div>
      <InsertTarget plan={plan} />
      {plan.ok || !showMessage ? null : (
        <p className="text-xs text-zinc-400" data-testid={`evidence-row-refusal-${row.key}`}>
          {plan.message}
        </p>
      )}
    </li>
  );
}

/** The `Dialogue` section: the file's own entries, with the speaker the ladder resolved. */
function DialogueSection({
  rows,
  target,
  editable,
  doc,
  onInsert,
}: InsertSectionProps & { rows: QuestEvidenceDialogue[] }): JSX.Element {
  const entries = rows.map((row) => {
    const insertRow = dialogueInsertRow(row);
    return { row: insertRow, plan: planEvidenceInsert(insertRow, target, doc), entry: row };
  });
  const sectionMessage = sectionRefusalMessage(
    entries.map((item) => item.plan),
    { editable },
  );
  return (
    <EvidenceSection
      heading={EVIDENCE_DIALOGUE_HEADING}
      empty={EVIDENCE_DIALOGUE_EMPTY}
      isEmpty={rows.length === 0}
      refusal={sectionMessage}
    >
      <ul className="flex flex-col gap-3">
        {entries.map(({ row, plan, entry }) => (
          <li key={row.id} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-xs text-zinc-200" title={entry.speaker.name}>
                {entry.speaker.name}
                {entry.own_table ? null : (
                  <span className="ml-1 text-zinc-400">(sibling table)</span>
                )}
              </span>
              <InsertAction plan={plan} row={row} onInsert={onInsert} />
            </div>
            <p className="text-xs text-zinc-300">{`“${entry.text ?? ''}”`}</p>
            <p
              className="min-w-0 truncate font-mono text-[10px] text-zinc-400"
              title={entry.dialog_key ?? ''}
            >
              {entry.dialog_key ?? '—'}
            </p>
            <InsertTarget plan={plan} />
            {plan.ok || sectionMessage !== null ? null : (
              <p className="text-xs text-zinc-400">{plan.message}</p>
            )}
          </li>
        ))}
      </ul>
    </EvidenceSection>
  );
}

/** The `World gates` section: each gate with its required status and the objects that reference it. */
function GatesSection({ gates }: { gates: QuestEvidence['goal_gates'] }): JSX.Element {
  return (
    <EvidenceSection
      heading={EVIDENCE_GATES_HEADING}
      empty={EVIDENCE_GATES_EMPTY}
      isEmpty={gates.length === 0}
    >
      <ul className="flex flex-col gap-2">
        {gates.map((gate) => (
          <li key={`${gate.goal_name}:${gate.required_status ?? ''}`} className="flex flex-col">
            <span className="break-all font-mono text-xs text-zinc-200">{gate.goal_name}</span>
            <span className="text-xs text-zinc-400">
              {`${gate.required_status ?? 'no required status'} · ${String(gate.refs.length)} reference(s)`}
            </span>
          </li>
        ))}
      </ul>
    </EvidenceSection>
  );
}

/** The `References` section: every `REFERENCE_FIELDS` field, through the one display rule. */
function ReferencesSection({ references }: { references: QuestEvidenceReference[] }): JSX.Element {
  return (
    <EvidenceSection
      heading={EVIDENCE_REFERENCES_HEADING}
      empty={EVIDENCE_REFERENCES_EMPTY}
      isEmpty={references.length === 0}
    >
      <ul className="flex flex-col gap-2">
        {references.map((reference) => (
          <li key={reference.field} className="flex flex-col">
            <span className="break-all font-mono text-[11px] text-zinc-400">{reference.field}</span>
            <span className="text-xs text-zinc-200">
              {reference.resolved === null
                ? `unresolved (${reference.kind ?? 'no namespace'}) ${String(reference.value)}`
                : reference.resolved.display}
            </span>
          </li>
        ))}
      </ul>
    </EvidenceSection>
  );
}

/** The `Warnings` section: the API's own misses, counted rather than dropped. */
function WarningsSection({ warnings }: { warnings: string[] }): JSX.Element {
  return (
    <EvidenceSection
      heading={EVIDENCE_WARNINGS_HEADING}
      empty={EVIDENCE_WARNINGS_EMPTY}
      isEmpty={warnings.length === 0}
    >
      <ul className="flex flex-col gap-1">
        {warnings.map((warning) => (
          <li key={warning} className="text-xs text-amber-300/90">
            {warning}
          </li>
        ))}
      </ul>
    </EvidenceSection>
  );
}
