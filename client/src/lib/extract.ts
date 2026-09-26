/**
 * Extraction UI — the pure half (plan task 2.6, story p2-07).
 *
 * Every string the extraction page shows, the confirm-dialog copy, the
 * human-readable file size and the readers that pull a quest's name / level /
 * goal count out of an untrusted CLI object live here. The React plumbing
 * (`hooks/useExtraction.ts`, `pages/ExtractionPage.tsx`) only moves state and
 * pixels, so the copy and the fallbacks are asserted in plain node with no jsdom
 * (decision D10).
 *
 * The copy below is a contract, not a preference: the drop-zone format line is
 * mandated verbatim by `docs/spec-domain-reference.md` L625 (the UI mockup's
 * shortened "JSON packet capture (.json)" at `docs/spec-ui-design.md` L199 is
 * **not** the contract — the acceptance criterion says so), the spinner text is
 * `docs/spec-ui-design.md` L210, the confirm sentence is L232 and the toast texts
 * are L119-123.
 */

/* ------------------------------------------------------------------- upload */

/**
 * The drop zone's format line — character for character
 * `docs/spec-domain-reference.md` L625.
 *
 * The server's own copy of this string is `UPLOAD_FORMAT_HINT` in
 * `server/src/routes/extract.ts`; the client cannot import server modules (its
 * tsconfig sees only `src` + `shared`), so the literal is repeated here and the
 * two are kept honest by the specs that assert each side.
 */
export const UPLOAD_FORMAT_HINT = 'Supported format: JSON packet capture files (.json)';

/** Drop zone primary line (`docs/spec-ui-design.md` L196). */
export const DROPZONE_PRIMARY = 'Drag & drop packet capture file here';

/** Drop zone secondary line (`docs/spec-ui-design.md` L197). */
export const DROPZONE_SECONDARY = 'or click to browse';

/** Only `.json` captures are accepted (`docs/spec-domain-reference.md` L624). */
export const ACCEPTED_EXTENSION = '.json';

/** In-card spinner text while the blocking CLI subprocess runs (spec L210). */
export const EXTRACTING_MESSAGE = 'Extracting quests...';

/** The info toast shown when extraction starts (spec L123). */
export const EXTRACTING_TOAST_MESSAGE = 'Extracting quests... this may take a moment';

/** Cancel button label — aborts the in-flight upload (spec L212, decision D9). */
export const CANCEL_LABEL = 'Cancel';

/* ------------------------------------------------------------------ results */

/** The three bottom-bar labels, exactly as `docs/spec-ui-design.md` L229 writes them. */
export const SAVE_ALL_LABEL = 'Save All to SpiralDB';
export const SAVE_SELECTED_LABEL = 'Save Selected';
export const DISCARD_LABEL = 'Discard';

/** The `new` status badge every freshly extracted quest carries (spec L224). */
export const NEW_BADGE_LABEL = 'new';

/** The read-only preview's tabs — the Phase 3 edit view's own six (spec L226). */
export const PREVIEW_TABS = [
  'Info',
  'Goals',
  'Goal Logic',
  'Requirements',
  'Results',
  'Dialog',
] as const;

export type PreviewTab = (typeof PREVIEW_TABS)[number];

/**
 * The Save All confirmation sentence (`docs/spec-ui-design.md` L232), with the
 * quest count interpolated. N is the number of quests in the results list.
 *
 * The overwrite information (gap A) is deliberately **not** in this sentence: the
 * AC's copy is fixed verbatim, so it is rendered next to it by
 * {@link OVERWRITE_HEADING} + the name list.
 */
export function saveAllConfirmMessage(count: number): string {
  return `Save ${count} quests to SpiralDB? This will create files and auto-commit.`;
}

/* ----------------------------------------------------------- overwrite check */

/**
 * Heading of the existing-name list in the Save All confirm (plan §2.4's last
 * bullet: "UI confirms before overwriting an existing quest (small confirm dialog
 * listing the name)").
 */
export const OVERWRITE_HEADING = 'These quests already exist in SpiralDB and will be overwritten:';

/** Progress line while the overwrite check's `GET /api/quests` is in flight. */
export const CHECKING_EXISTING_MESSAGE = 'Checking SpiralDB for existing quests…';

/** Title of the Save Selected overwrite confirm. */
export const OVERWRITE_TITLE = 'Overwrite quest';

/** The Save Selected overwrite sentence, naming the one quest (plan §2.4). */
export function overwriteConfirmMessage(name: string): string {
  return (
    `Quest ${name} already exists in SpiralDB. ` +
    `Saving will overwrite that file, refresh its metadata and auto-commit.`
  );
}

/** Fallback reason when the list request failed without a usable message. */
export const EXISTING_CHECK_FALLBACK = 'Could not check which quests already exist in SpiralDB.';

/** The server's own message for a failed overwrite check, or {@link EXISTING_CHECK_FALLBACK}. */
export function existingCheckErrorMessage(error: unknown): string {
  return serverMessage(error, EXISTING_CHECK_FALLBACK);
}

/**
 * The **fail-safe** decision for a failed overwrite check, in one sentence plus the
 * consequence (gap A).
 *
 * The check cannot be skipped: without the list the page cannot know whether a
 * save would overwrite an existing quest, so it refuses to save at all rather than
 * degrade to an unconfirmed overwrite. The user is told exactly that and that a
 * retry is the way forward.
 */
export function existingCheckFailedMessage(reason: string): string {
  return (
    `${reason} Nothing was saved: the check has to succeed before a save, so an existing ` +
    `quest is never overwritten without warning. Try again.`
  );
}

/**
 * The names among `names` that already exist in SpiralDB — the overwrite list the
 * Save All dialog renders, in extraction order and deduplicated.
 */
export function overwriteTargets(
  names: readonly string[],
  existing: ReadonlySet<string>,
): string[] {
  const targets: string[] = [];
  for (const name of names) {
    if (existing.has(name) && !targets.includes(name)) {
      targets.push(name);
    }
  }
  return targets;
}

/* ------------------------------------------------------------------- toasts */

/** The success toast for one saved quest (spec L120). */
export function savedMessage(name: string): string {
  return `Quest ${name} saved and committed`;
}

/**
 * The error toast body for a failed extraction or save — **the server's own
 * message**, unprefixed, because that is the spec's example (L122:
 * `Failed to parse packet capture: invalid file format`) and because the
 * actionable text (the 413 cap, the 500 "CLI not found … npm run build:cli", the
 * D14 dirty-repo message) only exists in that string.
 */
export function serverMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message !== '') {
      return message;
    }
  }
  return fallback;
}

/** Extraction failure, e.g. the D47 `{error}` envelope. */
export function extractErrorMessage(error: unknown): string {
  return serverMessage(error, 'Extraction failed');
}

/** Save failure, e.g. the D14 dirty-repo 409 or an empty `user_name` 500. */
export function saveErrorMessage(error: unknown): string {
  return serverMessage(error, 'The save failed');
}

/**
 * `true` when a rejected fetch was aborted rather than failing.
 *
 * `fetch` rejects with a `DOMException` named `AbortError`; the check is by name
 * (not `instanceof DOMException`) so it also holds for the plain `Error` a test
 * double may throw.
 */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

/* --------------------------------------------------------------- file display */

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;

/**
 * `12345678` → `11.8 MB` — the human-readable size on the selected-file card
 * (docs/spec-ui-design.md L209, "12.4 MB").
 *
 * One decimal for KB/MB (the mock's own precision) and two for GB, which is
 * beyond the 512 MB upload cap but must still render if it ever appears.
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '—';
  }
  if (bytes < KIB) {
    return `${Math.round(bytes)} B`;
  }
  if (bytes < MIB) {
    return `${(bytes / KIB).toFixed(1)} KB`;
  }
  if (bytes < GIB) {
    return `${(bytes / MIB).toFixed(1)} MB`;
  }
  return `${(bytes / GIB).toFixed(2)} GB`;
}

/* ------------------------------------------------------ untrusted quest data */

/** A non-empty string value, or `null`. */
function text(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/** `m_questName`, or a stable placeholder for an object that has none. */
export function questName(quest: QuestObjectLike, index: number): string {
  return text(quest.m_questName) ?? `Unnamed quest ${index + 1}`;
}

/** `m_questLevel` as a number, or `null` when absent/unusable. */
export function questLevel(quest: QuestObjectLike): number | null {
  const level = quest.m_questLevel;
  return typeof level === 'number' && Number.isFinite(level) ? level : null;
}

/** How many goals the quest defines — `m_goals.length`, `0` when absent. */
export function goalCount(quest: QuestObjectLike): number {
  return Array.isArray(quest.m_goals) ? quest.m_goals.length : 0;
}

/** The minimal shape these readers need; keeps them decoupled from `api.ts`. */
export interface QuestObjectLike {
  m_questName?: unknown;
  m_questLevel?: unknown;
  m_goals?: unknown;
  [key: string]: unknown;
}

/**
 * `"Imcodec.ObjectProperty.TypeCache.ResDropTable, Imcodec.ObjectProperty"` →
 * `"ResDropTable"` — the C# `$type` tail, which is what a reader recognizes.
 * Returns `null` for anything that is not a `$type`-looking string.
 */
export function shortTypeName(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  // The assembly-qualified name is `Namespace.Type, Assembly`; take the last
  // dotted segment of the type part.
  const [typePart] = value.split(',');
  const segments = (typePart ?? '').split('.');
  const last = segments[segments.length - 1]?.trim() ?? '';
  return last === '' ? null : last;
}

/**
 * The primitive fields of an untrusted object, in insertion order, as
 * `[label, displayValue]` pairs — the body of the Info/Goals/Goal Logic
 * read-only views.
 *
 * Only primitives (and arrays of primitives, joined) are returned: nested
 * objects/arrays are surfaced by the JSON blocks, so a goal cannot render
 * `[object Object]`.
 */
export function primitiveFields(value: unknown): Array<[string, string]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [];
  }
  const entries: Array<[string, string]> = [];
  for (const [key, raw] of Object.entries(value)) {
    if (raw === null || raw === undefined) {
      continue;
    }
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      entries.push([key, String(raw)]);
      continue;
    }
    if (Array.isArray(raw) && raw.every((item) => typeof item === 'string')) {
      entries.push([key, (raw as string[]).join(', ')]);
    }
  }
  return entries;
}
