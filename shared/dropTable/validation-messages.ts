import { formatDocPath } from '../document.js';
import type { DropTableFinding, DropTableFindingKind } from './validation.js';

/**
 * The DropTable validation copy table — the **one home of the words** for a drop-table
 * finding (story p4-02, mirroring `shared/quest/validation-messages.ts`'s role for quests).
 *
 * `shared/dropTable/validation.ts` returns typed findings and never a sentence; this module
 * is where a finding becomes the text a user reads. It lives in `shared/` because *both*
 * sides must say the same thing: the client renders the inline error under the control, and
 * the server's `400` body carries a per-field error map built from the same sentence (D65's
 * "the client renders it identically"). One table is the only way that cannot drift.
 *
 * The split `shared/quest/validation-messages.ts` pins is preserved: the **engine** returns
 * data only, and `kind` — never a message string — is what a caller branches on. The message
 * deliberately does not contain the document path: the per-field map's *key* is the path
 * (`formatDocPath`), so a path inside the sentence would duplicate it.
 *
 * The sentences name the offending value, because the inline message sits under the field it
 * belongs to and the form-level banner lists the same lines.
 */

/** The human name of each finding kind — the banner's summary vocabulary. */
export function dropTableKindLabel(kind: DropTableFindingKind): string {
  switch (kind) {
    case 'drop-table-name-missing':
      return 'Missing name';
    case 'drop-table-name-duplicate':
      return 'Duplicate name';
    case 'roll-chance-out-of-range':
      return 'Roll chance out of range';
    case 'none-chance-out-of-range':
      return 'None chance out of range';
    case 'gold-range-inverted':
      return 'Inverted gold range';
  }
}

/** A value rendered inside a sentence: `"X"` for strings, `1.5` for numbers, `absent`/`null`. */
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

/**
 * The one sentence for a finding. Total over every kind (no `default`, so a new kind is a
 * type error here rather than a blank message at runtime).
 */
export function dropTableFindingMessage(finding: DropTableFinding): string {
  switch (finding.kind) {
    case 'drop-table-name-missing':
      return 'A drop table needs a non-empty Name before it can be saved. The Name is also the file’s key and what NpcDropTable and ResDropTable reference.';
    case 'drop-table-name-duplicate':
      return `The name ${quoted(finding.value)} is already used by another drop table. Names must be unique across all drop tables, because other files reference a table by name.`;
    case 'roll-chance-out-of-range':
      return `Roll chance ${quoted(finding.value)} must be a number between 0 and 1.`;
    case 'none-chance-out-of-range':
      return `None chance ${quoted(finding.value)} must be a number between 0 and 1.`;
    case 'gold-range-inverted':
      return `Minimum gold (${quoted(finding.minGold)}) must not be greater than maximum gold (${quoted(finding.maxGold)}).`;
  }
}

/**
 * A finding's rendered path — what places it inline and what keys the server's per-field
 * error map. The path formatter is the shared one, so a message the client renders under the
 * `MaxGold` control and the same message in the 400 body cannot be about different fields.
 */
export function dropTableFindingField(finding: DropTableFinding): string {
  return formatDocPath(finding.path);
}

/**
 * The per-field error map: path key → messages, in finding order. A field with several
 * findings gets several messages, never a joined string.
 */
export function dropTableFieldErrorMap(
  findings: readonly DropTableFinding[],
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const finding of findings) {
    const field = dropTableFindingField(finding);
    const messages = map[field];
    if (messages === undefined) {
      map[field] = [dropTableFindingMessage(finding)];
    } else {
      messages.push(dropTableFindingMessage(finding));
    }
  }
  return map;
}

/** The `error` sentence for a blocking-findings set — the 400 body's `error` line. */
export function dropTableBlockingSummary(findings: readonly DropTableFinding[]): string {
  const kinds = new Set(findings.map((finding) => dropTableKindLabel(finding.kind)));
  const noun = findings.length === 1 ? 'validation error' : 'validation errors';
  return `DropTable validation failed with ${findings.length} ${noun} (${[...kinds].join(', ')}).`;
}
