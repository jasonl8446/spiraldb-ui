/**
 * The **single** ulong↔string conversion both halves of the tool use, for the
 * `TemplateID`-keyed families (`npcinventory`, `npcspellinventory`, `npcdroptable`,
 * `treasurecardinventory`).
 *
 * The two representations are both mandated by the specs and they are not the same
 * string as the value:
 *
 * - **In JSON** the key is a number — `{"TemplateID": 38226}`
 *   (docs/spec-domain-reference.md; measured: all 853 corpus `TemplateID` values at
 *   the top level are numbers).
 * - **In `entry_status.object_key`** it is text — the column is TEXT and the
 *   first-startup import writes `String(TemplateID)`
 *   (docs/spec-data-model.md L36, plan-overview D37: "extracts … `TemplateID` (as a
 *   **string**)").
 * - On a **route** (`GET /api/npc-inventories/:key`) it is the same text, because a
 *   URL segment is a string.
 *
 * Two independent conversions is a listed failure mode of task 4.1 (a wrong status
 * join, an orphaned history row, a lookup that misses an entry that exists), so this
 * module is the only place that converts, and both directions are one object.
 *
 * Deliberately **not** the same problem as `normalizeKeyValue` in
 * `server/src/services/spiraldbFiles.ts`: that is the generic, type-agnostic
 * "stringify a finite number, keep a non-empty string" normaliser every family's
 * index scan uses, and it must stay permissive (it also accepts `DeckName`,
 * `ZoneName`, `Name`, `m_questName`). This module is only ever applied to the four
 * ulong families, where both ends must be digits.
 */

/** Largest integer JSON and `Number` can both hold exactly. */
const MAX_SAFE_ULONG = BigInt(Number.MAX_SAFE_INTEGER);

/** Digits only, no sign, no decimal point, no exponent, no whitespace inside. */
const DIGITS_ONLY = /^[0-9]+$/;

/**
 * Canonical ulong text for `value` — the form `entry_status.object_key` and the
 * route segment use — or `undefined` when the value is not an unsigned integer.
 *
 * Accepts:
 * - a finite non-negative integer `number` — `38226` → `"38226"` (leading zeros
 *   cannot occur, so nothing is rewritten);
 * - a digits-only `string` — `"38226"` → `"38226"`, and `"0038226"` → `"38226"`.
 *   BigInt does the canonicalisation, so a value beyond `Number.MAX_SAFE_INTEGER`
 *   still round-trips as text instead of silently losing precision.
 *
 * Rejects everything else: a negative number, a fraction (`1.5`), `NaN`,
 * `Infinity`, `"1e5"`, `"0x1F"`, `"-1"`, `""`, `" 1 "`, and non-scalars.
 */
function toKey(value: unknown): string | undefined {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      return undefined;
    }
    return String(value);
  }
  if (typeof value === 'string') {
    return DIGITS_ONLY.test(value) ? BigInt(value).toString() : undefined;
  }
  return undefined;
}

/**
 * The JSON form of a ulong — the number a `TemplateID` field must carry — or
 * `undefined` when the value is not an unsigned integer, or is one this JSON
 * number type cannot hold exactly (beyond `Number.MAX_SAFE_INTEGER`).
 *
 * `"38226"` → `38226`, `38226` → `38226`, `"0038226"` → `38226`; `"-1"`, `"x"`,
 * `""` and `"18446744073709551615"` → `undefined` (the last one is a real ulong but
 * not an exactly-representable JSON number, so this rejects it rather than writing a
 * silently rounded key).
 */
function toJson(value: unknown): number | undefined {
  const key = toKey(value);
  if (key === undefined) {
    return undefined;
  }
  const exact = BigInt(key);
  return exact > MAX_SAFE_ULONG ? undefined : Number(exact);
}

/**
 * The one conversion helper. `ULong.toKey` is the text direction (scan/route/status)
 * and `ULong.toJson` the number direction (the document being written).
 */
export const ULong = { toKey, toJson } as const;
