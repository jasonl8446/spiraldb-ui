import type { DocPath } from '../document.js';

/**
 * The DropTable validation engine — plan task 4.2 (story p4-02), the four blocking rules of
 * docs/spec-domain-reference.md **L536-540**:
 *
 * | kind | severity | rule (spec line) | real corpus findings |
 * |---|---|---|---|
 * | `drop-table-name-missing` | error | `Name` must be non-empty (L537) | **0** — fixture-only |
 * | `drop-table-name-duplicate` | error | `Name` must be unique across all drop tables (L537) | **0** — fixture-only |
 * | `roll-chance-out-of-range` | error | `RollChance` must be 0.0–1.0 (L538) | **0** — fixture-only |
 * | `none-chance-out-of-range` | error | `NoneChance` must be 0.0–1.0 (L539) | **0** — fixture-only |
 * | `gold-range-inverted` | error | `MinGold ≤ MaxGold` (L540) | **0** — fixture-only |
 *
 * **All five kinds have zero corpus instances**, and the story says so plainly the way the
 * Phase-3 engine's header does. Measured 2026-09-26 across all **317** files: 317 distinct,
 * non-empty names; every `RollChance` and `NoneChance` inside 0.0–1.0; `MinGold ≤ MaxGold`
 * everywhere. So every one of these rules is proven by fixtures (unit) and by the direct
 * `POST` 400 — never by a real file. `tests/unit/drop-table-model.test.ts` re-runs the sweep
 * against the checkout whenever it is on disk, and would fail the day a real file violates
 * one of them (which is the moment the fixture-only label stops being true).
 *
 * Deliberately **not here**: the general warn-not-block rules of L542-546 ("Item/Spell/NPC
 * references should warn if ID not found"). An unresolved `ItemId` is a warning's shape, and
 * this editor's treatment of it is the miss-safe one (keep the raw id, never invent an
 * `ItemName`, never rewrite it) — exactly what the client does without a finding. Adding a
 * warning kind nobody renders would be copy without a surface.
 *
 * ## Purity and the absent-field rule
 *
 * Pure by contract: a document in, structured findings out. No React, no `json5`, no SQLite,
 * no `server/` import. The unseen corpus the duplicate rule needs is **injected**
 * ({@link DropTableValidationOptions.otherNames}) because `shared/` cannot reach the
 * filesystem — the server builds it from its own scan, the client from the list it already
 * has, and both funnel through `otherDropTableNames` so the exclusion is one implementation
 * (the story's "a client-only duplicate-Name check" is a listed failure mode; this is the
 * one engine both sides run).
 *
 * The engine **validates and never normalises** (D57): it reads, never writes, and a value
 * it rejects is kept verbatim in the finding. A field that is **absent** produces no finding
 * at all — the editor's contract is that an untouched, absent control produces no edit, and
 * a rule that blocked a document for a key it never had would force a padding write the
 * story explicitly forbids. An explicit `null` is a different thing from absent (D57) and is
 * treated as "present but not a usable number", except for `Name`, where `null` is the
 * missing-name case.
 */

/* --------------------------------------------------------------------- types */

/** How bad a finding is. Only `error` exists today — all four rules block. */
export type DropTableValidationSeverity = 'error';

/** Every finding kind this engine emits, one per rule. */
export type DropTableFindingKind =
  /** `Name` is absent, not a string, or empty/whitespace (L537). */
  | 'drop-table-name-missing'
  /** `Name` is also carried by another drop table of the injected corpus (L537). */
  | 'drop-table-name-duplicate'
  /** `RollChance` is present and not a finite number within 0.0–1.0 (L538). */
  | 'roll-chance-out-of-range'
  /** `NoneChance` is present and not a finite number within 0.0–1.0 (L539). */
  | 'none-chance-out-of-range'
  /** `MinGold` and `MaxGold` are both present numbers and `MinGold > MaxGold` (L540). */
  | 'gold-range-inverted';

/** One structured finding. Never a sentence, never a bare string. */
export interface DropTableFinding {
  kind: DropTableFindingKind;
  severity: DropTableValidationSeverity;
  /** The exact document path of the offending field (`Name`, `RollChance`, `MaxGold`). */
  path: DocPath;
  /** The offending value, verbatim (never a normalised copy). */
  value: unknown;
  /** The other endpoint of a two-field rule: `gold-range-inverted` only. */
  minGold?: number;
  maxGold?: number;
  /** A one-line machine-friendly detail. **Not** the UI's copy. */
  detail: string;
}

export interface DropTableValidationOptions {
  /**
   * The names of the **other** drop tables — the corpus minus the entry being saved
   * (`otherDropTableNames` in `./model.js`). Omitted means "this side cannot check the
   * corpus", and the duplicate rule then produces nothing rather than reporting every name
   * as a duplicate. The server and the client both inject it.
   */
  otherNames?: ReadonlySet<string>;
}

export interface DropTableValidationResult {
  /** Every finding, in rule order (name rules, then the Basic ranges, then the gold range). */
  findings: DropTableFinding[];
  /** The findings the Save gate follows. Same list as `findings` today; kept for symmetry. */
  blocking: DropTableFinding[];
  /** Always empty — no DropTable rule warns without blocking (see the header). */
  warnings: DropTableFinding[];
  /** `true` when at least one blocking finding exists — the Save gate's own boolean. */
  blocked: boolean;
}

/* ------------------------------------------------------------------ readers */

/** `true` for a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `container[key]`, or `undefined` for a non-object container. */
function member(container: unknown, key: string): unknown {
  return isPlainObject(container) ? container[key] : undefined;
}

/** `true` when the key is carried at all — an explicit `null` is present, not absent. */
function present(container: unknown, key: string): boolean {
  return isPlainObject(container) && Object.prototype.hasOwnProperty.call(container, key);
}

/** A finite number, or `undefined` — the only shape the two range rules compare. */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/* ------------------------------------------------------------------ the engine */

/** The bounds both chance fields share (L538/L539). */
export const CHANCE_MIN = 0;
export const CHANCE_MAX = 1;

/**
 * Validates one drop-table document. Never mutates it — every reader here is a read, and the
 * findings hold references to the original values (D57).
 *
 * Order: `Name` (missing, then duplicate), `RollChance`, `NoneChance`, the gold pair. A
 * blocked document produces at most one finding per rule, so a caller can count rules passed.
 */
export function validateDropTable(
  document: unknown,
  options: DropTableValidationOptions = {},
): DropTableValidationResult {
  const findings: DropTableFinding[] = [];
  const error = (finding: Omit<DropTableFinding, 'severity'>): void => {
    findings.push({ ...finding, severity: 'error' });
  };

  /* --- rule 1: Name must be non-empty (L537) ---------------------------------- */
  const name = member(document, 'Name');
  const nameUsable = typeof name === 'string' && name.trim() !== '';
  if (!nameUsable) {
    error({
      kind: 'drop-table-name-missing',
      path: ['Name'],
      value: name,
      detail: 'Name is missing, not a string, or empty',
    });
  }

  /* --- rule 2: Name must be unique across all drop tables (L537) -------------- */
  // Only a usable name can collide; a missing one already has its own finding, and
  // reporting it twice would double-count one problem in the banner.
  const otherNames = options.otherNames;
  if (nameUsable && otherNames !== undefined && otherNames.has(name)) {
    error({
      kind: 'drop-table-name-duplicate',
      path: ['Name'],
      value: name,
      detail: `Another drop table already carries the Name "${name}"`,
    });
  }

  /* --- rule 3/4: RollChance and NoneChance are 0.0–1.0 (L538/L539) ------------ */
  for (const key of ['RollChance', 'NoneChance'] as const) {
    // Absent is not a violation: the key the user never touched stays untouched (D57).
    if (!present(document, key)) {
      continue;
    }
    const value = member(document, key);
    const number = finiteNumber(value);
    if (number !== undefined && number >= CHANCE_MIN && number <= CHANCE_MAX) {
      continue;
    }
    error({
      kind: key === 'RollChance' ? 'roll-chance-out-of-range' : 'none-chance-out-of-range',
      path: [key],
      value,
      detail: `${key} must be a number between ${CHANCE_MIN} and ${CHANCE_MAX}`,
    });
  }

  /* --- rule 5: MinGold ≤ MaxGold (L540) --------------------------------------- */
  // The comparison needs two numbers; a non-numeric endpoint is left to the reader's own
  // type handling rather than being reported as an inverted range it cannot be.
  const minGold = finiteNumber(member(document, 'MinGold'));
  const maxGold = finiteNumber(member(document, 'MaxGold'));
  if (minGold !== undefined && maxGold !== undefined && minGold > maxGold) {
    // One finding, at MaxGold (the endpoint that must move): the client shows it under the
    // gold group and marks both controls, so one rule stays one finding.
    error({
      kind: 'gold-range-inverted',
      path: ['MaxGold'],
      value: maxGold,
      minGold,
      maxGold,
      detail: `MinGold (${minGold}) must not exceed MaxGold (${maxGold})`,
    });
  }

  return {
    findings,
    blocking: findings,
    warnings: [],
    blocked: findings.length > 0,
  };
}
