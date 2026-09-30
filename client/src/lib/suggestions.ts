import {
  formatDocPath,
  getAtPath,
  hasAtPath,
  parseDocPath,
  type DocEdit,
  type JsonDocument,
} from '@shared/document';

import { namePair, namePairDistinct } from './display';
import type { PreviewTab } from './extract';

/**
 * The draft queue and the inline suggestions — task 7.7 / story p7-08 (D129, D130, D137, D141,
 * D142, D144; docs/spec-ui-design.md §4 "Inline suggestions" and §12 "Draft Review Queue").
 *
 * Pure: every rule the two surfaces follow — which query a filter produces, where a draft opens,
 * what Accept writes into the in-memory document, when Accept is not offered and why — lives here
 * so the unit suite pins it without a browser, and the components only render its answers.
 *
 * **Accept is an edit, never a request** (spec-api "Accepting"). It returns one `DocEdit` for the
 * document state's own `edit` (`shared/document.ts`, D58) — the same channel the evidence panel's
 * insert uses — and the id travels with the next Save as `accepted_suggestions`, whose status flips
 * only after that save's commit.
 */

/* ------------------------------------------------------------------ the wire shapes */

/** One suggestion row as `GET /api/quests/:name/suggestions` answers it (D143). */
export interface Suggestion {
  id: number;
  path: string;
  value: unknown;
  source: string;
  confidence: number | null;
  evidence_ref: string | null;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string | null;
  decided_at: string | null;
}

/** The shared body of the two per-draft suggestion reads. */
export interface SuggestionsBody {
  quest_name: string | null;
  catalog_id: number | null;
  suggestions: Suggestion[];
}

/** One `GET /api/drafts` row (D143). */
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

export interface DraftList {
  drafts: DraftRow[];
  total: number;
  hidden_zero_evidence: number;
  filters: { named: boolean | null; has_file: boolean | null; source: string | null; all: boolean };
}

/** Every source the server stores, in its own order (D140). */
export const SUGGESTION_SOURCES = [
  'evidence-title',
  'evidence-dialogue',
  'evidence-goals',
  'evidence-location',
  'evidence-requirements',
  'capture-order',
  'capture-rewards',
] as const;

/* ------------------------------------------------------------------ the queue */

/** The queue's three server-side filters plus the D130 toggle. `null` = "any". */
export interface DraftFilter {
  named: boolean | null;
  hasFile: boolean | null;
  source: string | null;
  all: boolean;
}

export const DEFAULT_DRAFT_FILTER: DraftFilter = {
  named: null,
  hasFile: null,
  source: null,
  all: false,
};

/** `GET /api/drafts?…` for a filter — every filter is the server's (spec §12), never re-applied. */
export function draftsRequestPath(filter: DraftFilter): string {
  const params = new URLSearchParams();
  if (filter.named !== null) {
    params.set('named', filter.named ? '1' : '0');
  }
  if (filter.hasFile !== null) {
    params.set('has_file', filter.hasFile ? '1' : '0');
  }
  if (filter.source !== null) {
    params.set('source', filter.source);
  }
  if (filter.all) {
    params.set('all', '1');
  }
  const query = params.toString();
  return query === '' ? '/api/drafts' : `/api/drafts?${query}`;
}

/** The route a draft opens on: its file, the missing-file skeleton, or the unnamed id's editor. */
export function draftEditorPath(
  row: Pick<DraftRow, 'quest_name' | 'catalog_id' | 'has_definition'>,
): string {
  if (row.quest_name !== null) {
    const name = encodeURIComponent(row.quest_name);
    return row.has_definition === 1 ? `/quests/${name}` : `/drafts/quest/${name}`;
  }
  return `/drafts/id/${row.catalog_id ?? ''}`;
}

/** The unnamed tier's technical half: `#128004` (the id the spec's queue shows). */
export function unnamedDraftKey(catalogId: number | null): string {
  return `#${catalogId ?? '?'}`;
}

/** The row's name pair (§Names): `Title (NAME)`, or `Title (#id)` for the unnamed tier. */
export function draftDisplayName(
  row: Pick<DraftRow, 'quest_name' | 'catalog_id' | 'title'>,
): string {
  return row.quest_name === null
    ? namePair(row.title, unnamedDraftKey(row.catalog_id))
    : namePairDistinct(row.title, row.quest_name);
}

/** The header sentence: both numbers as text (D85), the hidden one only while it is hidden. */
export function draftsSummary(
  list: Pick<DraftList, 'total' | 'hidden_zero_evidence'>,
  all: boolean,
): string {
  const shown = `${list.total.toLocaleString('en-US')} draft${list.total === 1 ? '' : 's'}`;
  return all
    ? `${shown}, zero-evidence drafts included`
    : `${shown} with evidence · ${list.hidden_zero_evidence.toLocaleString('en-US')} with none hidden`;
}

/* ------------------------------------------------------------------ accepting */

/** The capture rewards path: accepting appends the value's `result` to this list (D159). */
export const REWARDS_PATH = 'm_endResults.m_results';

/**
 * Why a gold/XP/item reward cannot be accepted (D159: no `Res*` type exists for them, so the
 * suggestion's `result` is `null` and accepting would write nothing). It stays visible as an
 * observation, and Reject still records the decision.
 */
export const REWARD_OBSERVATION_REASON =
  'Observed in a capture only: SpiralDB has no result type for gold, XP or items, so accepting would write nothing.';

export type SuggestionAcceptPlan =
  { kind: 'accept'; edit: DocEdit } | { kind: 'disabled'; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * What Accept does to the in-memory document, or why it is not offered.
 *
 * - A reward (`m_endResults.m_results`) appends its `result`: an `insert` at the list's end, the
 *   list created when the document has none. A `null` result is D159's observation — disabled.
 * - Any other path is one `set` of the value. `setAtPath` never invents structure (D5/D57), so a
 *   path under a container the document does not have yet (a goal's location before the goals are
 *   accepted) is disabled with the container to accept first, rather than failing on click.
 */
export function planSuggestionAccept(
  doc: JsonDocument,
  suggestion: Suggestion,
): SuggestionAcceptPlan {
  if (suggestion.path === REWARDS_PATH) {
    const result = isRecord(suggestion.value) ? suggestion.value.result : undefined;
    if (result === null || result === undefined) {
      return { kind: 'disabled', reason: REWARD_OBSERVATION_REASON };
    }
    const endResults = hasAtPath(doc, ['m_endResults']) ? getAtPath(doc, ['m_endResults']) : null;
    if (isRecord(endResults) && Array.isArray(endResults.m_results)) {
      return {
        kind: 'accept',
        edit: {
          op: 'insert',
          path: ['m_endResults', 'm_results'],
          index: endResults.m_results.length,
          value: result,
        },
      };
    }
    if (isRecord(endResults)) {
      return {
        kind: 'accept',
        edit: { op: 'set', path: ['m_endResults', 'm_results'], value: [result] },
      };
    }
    return {
      kind: 'accept',
      edit: { op: 'set', path: ['m_endResults'], value: { m_results: [result] } },
    };
  }

  const path = parseDocPath(suggestion.path);
  if (path === null || path.length === 0) {
    return { kind: 'disabled', reason: `The path ${suggestion.path} is not a document path.` };
  }
  const parent = path.slice(0, -1);
  if (parent.length > 0 && !hasAtPath(doc, parent)) {
    return {
      kind: 'disabled',
      reason: `Accept ${formatDocPath(parent.slice(0, 1))} first: this value fills a field inside it.`,
    };
  }
  return { kind: 'accept', edit: { op: 'set', path, value: suggestion.value } };
}

/** The editor tab holding a suggestion's field — where it renders inline (D165). */
export function suggestionTab(path: string): PreviewTab {
  const root = parseDocPath(path)?.[0];
  switch (root) {
    case 'm_goals':
      return 'Goals';
    case 'm_goalLogic':
    case 'm_startGoals':
      return 'Goal Logic';
    case 'm_requirements':
    case 'm_prepRequirements':
    case 'm_pruneRequirements':
      return 'Requirements';
    case 'm_startResults':
    case 'm_endResults':
      return 'Results';
    case 'm_dialogList':
      return 'Dialog';
    default:
      return 'Info';
  }
}

/* ------------------------------------------------------------------ rendering */

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function requiredQuestNames(value: unknown): string[] {
  const names: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (isRecord(node)) {
      if (typeof node.m_questName === 'string') {
        names.push(node.m_questName);
      }
      Object.values(node).forEach(visit);
    }
  };
  visit(value);
  return names;
}

/**
 * A suggestion's value as one line of text. A key or scalar is shown as itself; a container is
 * summarised by what it holds (goal names, dialog count, the quest a requirement names, a reward's
 * kind) because a whole goal list inline would bury the field it sits beside.
 */
export function suggestionValueText(suggestion: Pick<Suggestion, 'path' | 'value'>): string {
  const { value } = suggestion;
  if (suggestion.path === REWARDS_PATH && isRecord(value)) {
    const kind = typeof value.kind === 'string' ? value.kind : 'reward';
    const detail = Object.entries(value)
      .filter(([key]) => key !== 'kind' && key !== 'result')
      .map(([key, member]) => `${key} ${JSON.stringify(member)}`)
      .join(', ');
    return detail === '' ? kind : `${kind}: ${detail}`;
  }
  if (typeof value === 'string') {
    return value === '' ? '""' : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  if (suggestion.path === 'm_goals' && Array.isArray(value)) {
    const names = value.map((goal) => (isRecord(goal) ? String(goal.m_goalName ?? '?') : '?'));
    return `${value.length} goal${value.length === 1 ? '' : 's'}: ${truncate(names.join(', '), 120)}`;
  }
  if (suggestion.path === 'm_dialogList' && isRecord(value) && Array.isArray(value.m_dialogs)) {
    const count = value.m_dialogs.length;
    return `${count} dialog block${count === 1 ? '' : 's'}`;
  }
  const quests = requiredQuestNames(value);
  if (suggestion.path.endsWith('equirements') && quests.length > 0) {
    return `requires quest ${quests.join(', ')}`;
  }
  return truncate(JSON.stringify(value), 120);
}

/** `confidence 0.78`, or the words when the source states none (text, never colour — D85). */
export function confidenceText(confidence: number | null): string {
  return confidence === null ? 'no stated confidence' : `confidence ${confidence}`;
}

/** Pending suggestions grouped by source, in the server's source order (for "Accept all"). */
export function pendingBySource(suggestions: readonly Suggestion[]): Array<[string, Suggestion[]]> {
  const groups = new Map<string, Suggestion[]>();
  for (const suggestion of suggestions) {
    if (suggestion.status !== 'pending') {
      continue;
    }
    const list = groups.get(suggestion.source) ?? [];
    list.push(suggestion);
    groups.set(suggestion.source, list);
  }
  const order = (source: string): number => {
    const index = (SUGGESTION_SOURCES as readonly string[]).indexOf(source);
    return index === -1 ? SUGGESTION_SOURCES.length : index;
  };
  return [...groups.entries()].sort(
    (a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]),
  );
}

/**
 * The unnamed draft's name pre-fill (D137): the title key where one exists — the accepted
 * `m_questTitle` first, else the id's title suggestion — and never applied without the user.
 */
export function namingPrefill(doc: JsonDocument, suggestions: readonly Suggestion[]): string {
  const accepted = hasAtPath(doc, ['m_questTitle']) ? getAtPath(doc, ['m_questTitle']) : null;
  if (typeof accepted === 'string' && accepted !== '') {
    return accepted;
  }
  const title = suggestions.find(
    (suggestion) => suggestion.path === 'm_questTitle' && typeof suggestion.value === 'string',
  );
  return typeof title?.value === 'string' ? title.value : '';
}

/** Labels the tier-1 specs and the components share. */
export const DRAFTS_EMPTY_NO_CATALOG =
  'The quest catalog is empty. Run a sync to build it before reviewing drafts.';
export const DRAFTS_EMPTY_NO_SUGGESTIONS =
  'No draft has evidence yet. Rebuild drafts to stage suggestions.';
export const DRAFTS_SHOW_ALL_LABEL = 'Show zero-evidence drafts';
export const SUGGESTION_ACCEPT_LABEL = 'Accept';
export const SUGGESTION_REJECT_LABEL = 'Reject';
export const SUGGESTION_APPLIED_LABEL = 'Applied — saved with the next Save';
export const NAME_DIALOG_TITLE = 'Name this quest';
