/**
 * The validation copy table — the **one home of the words** for a quest finding (story p3-09).
 *
 * `shared/quest/validation.ts` returns typed findings and never a sentence; this module is
 * where a finding becomes the text a user reads, and it lives in `shared/` because *both* sides
 * must say the same thing: the client renders the inline error / warning and the form-level
 * banner from it, and the server's `400` body carries a per-field error map built from it
 * ("the client renders it identically", plan §3.9). One table is the only way that cannot
 * drift — the alternative, a server copy and a client copy, is the two-implementation defect
 * the story's rules module exists to avoid.
 *
 * The split D61(d) pins is preserved: the **engine** returns data only, and `kind` — never a
 * message string — is what a caller branches on. A reword here changes nothing in the engine
 * or in the server's status mapping.
 *
 * Messages are one line each and name the offending value or goal, because the inline message
 * sits under the field it belongs to and the banner lists the same lines. They deliberately do
 * **not** contain the document path: the per-field map's *key* is the path
 * (`shared/document.ts`'s `formatDocPath`), so a path inside the sentence would duplicate it.
 */

import { formatDocPath } from '../document.js';
import type { QuestFinding, QuestFindingKind, ValidationSeverity } from './validation.js';

/** How a severity reads in the UI's own vocabulary. */
export function severityLabel(severity: ValidationSeverity): 'Error' | 'Warning' {
  return severity === 'error' ? 'Error' : 'Warning';
}

/** The human name of each finding kind — the banner's summary vocabulary. */
export function kindLabel(kind: QuestFindingKind): string {
  switch (kind) {
    case 'quest-name-missing':
      return 'Missing quest name';
    case 'start-goal-unknown':
      return 'Unknown start goal';
    case 'duplicate-goal-name':
      return 'Duplicate goal name';
    case 'goal-logic-not-completing':
      return 'Goal logic does not complete the quest';
    case 'unknown-type':
      return 'Unknown $type';
    case 'template-id-not-positive':
      return 'Invalid template id';
    case 'goal-unreachable':
      return 'Unreachable goal';
    case 'zone-not-known':
      return 'Unknown zone';
    case 'reference-not-known':
      return 'Unknown reference';
  }
}

/** A value rendered inside a sentence: `"1_Start"` for strings, `3` for numbers, `null`/`absent`. */
function quoted(value: unknown): string {
  if (typeof value === 'string') {
    return `"${value}"`;
  }
  if (value === undefined) {
    return 'absent';
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value) ?? String(value);
}

/** The namespaces a reference search covered, as text: `spells`, `spells or npcs`. */
function namespaceText(finding: QuestFinding): string {
  const list =
    finding.searchedNamespaces ?? (finding.namespace === undefined ? [] : [finding.namespace]);
  return list.join(' or ');
}

/**
 * The one sentence for a finding. Total over every kind (the switch has no fall-through and no
 * `default`), so a new kind is a type error here rather than a blank message at runtime.
 */
export function findingMessage(finding: QuestFinding): string {
  switch (finding.kind) {
    case 'quest-name-missing':
      return 'A quest needs a non-empty m_questName before it can be saved.';
    case 'start-goal-unknown':
      return `The start goal ${quoted(finding.value)} is not defined in m_goals. Set another start goal or restore the deleted goal.`;
    case 'duplicate-goal-name':
      return finding.goalName === undefined
        ? 'This goal has no m_goalName. Every goal needs a unique name, because goal logic and start goals reference goals by name.'
        : `The goal name ${quoted(finding.goalName)} is also used by another goal. Goal names must be unique within a quest.`;
    case 'goal-logic-not-completing':
      return 'The final goal-logic entry must set m_completeQuest to true, otherwise the quest can never be completed.';
    case 'unknown-type':
      return `The $type ${quoted(finding.value)} is not one of the type names SpiralDB knows. Imlight deserializes on this string, so a save would produce a quest it cannot load.`;
    case 'template-id-not-positive':
      return finding.minimum === 0
        ? `The value ${quoted(finding.value)} must be a whole number of 0 or more (0 means "none" for this field).`
        : `The TemplateID ${quoted(finding.value)} must be a positive whole number.`;
    case 'goal-unreachable':
      return `The goal ${quoted(finding.goalName)} cannot be reached from m_startGoals, so nothing in the quest activates it.`;
    case 'zone-not-known':
      return `The zone path ${quoted(finding.value)} is not in the synced zones table. It is kept verbatim; check it against the game if it looks wrong.`;
    case 'reference-not-known':
      return `No ${namespaceText(finding)} entry matches ${quoted(finding.value)}. The raw id is kept as it is.`;
  }
}

/**
 * A finding as a `{ path: message }` pair — what the server's per-field error map is built
 * from, and what the client uses to place a message under a control. The path key is the
 * engine's own `DocPath` rendered by the shared formatter, so a nested field keeps its full
 * path (`m_startGoals[0]`, `m_goals[2].m_goalName`) and no caller has to re-derive it.
 */
export function findingField(finding: QuestFinding): string {
  return formatDocPath(finding.path);
}

/**
 * The per-field error map: path key → messages, in finding order. A field with several findings
 * gets several messages, never a joined string (the map's value is a list on purpose).
 */
export function fieldErrorMap(findings: readonly QuestFinding[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const finding of findings) {
    const field = findingField(finding);
    const messages = map[field];
    if (messages === undefined) {
      map[field] = [findingMessage(finding)];
    } else {
      messages.push(findingMessage(finding));
    }
  }
  return map;
}

/** The `error` sentence for a blocking-findings set — the 400 body's `error` line. */
export function blockingSummary(findings: readonly QuestFinding[]): string {
  const kinds = new Set(findings.map((finding) => kindLabel(finding.kind)));
  const noun = findings.length === 1 ? 'validation error' : 'validation errors';
  return `Quest validation failed with ${findings.length} ${noun} (${[...kinds].join(', ')}).`;
}
