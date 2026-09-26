import { langKeyCategory, langKeyForm } from './lang.js';
import type { Db } from '../../db.js';

/**
 * `string_table` lookup helper — lead decision 2 for story p1-06, consumed by
 * the names API (1.5) and every later editor.
 *
 * Resolution order is **exact primary key first**, then a bounded ladder of
 * alternate *spellings of the same lexical form*:
 *
 * ```
 * lookupString(db, 'Items_00022716')  // exact hit — the corpus spelling
 * lookupString(db, 'Items_22716')     // → 'Items_00022716' (decimal, 8-padded)
 * lookupString(db, 'QuestTitle_1ed8a')// → 'QuestTitle_1ED8A' (hex, upper-cased)
 * lookupString(db, 'QuestTitle_1ED8A')// exact hit — "Forged in Fire"
 * ```
 *
 * The ladder **never normalises the token to a number**, because that would
 * cross the two lexical forms: decimal `126346` ("Letters of Light") and hex
 * `1ED8A` ("Forged in Fire") share the numeric index 126346 and are two distinct
 * rows (D33(e)). A digit-only token therefore only ever produces other
 * *decimal* spellings (zero-padding variants), and a token containing `A–F` only
 * ever other *hex* spellings (case/padding variants). A miss returns `undefined`
 * so the caller shows the raw key ([spec-domain-reference.md] L693-694) — it
 * never returns the value of the other form.
 *
 * A row whose value is the empty string is still a **hit** (`''`); the column is
 * `NOT NULL`, and "absent" is `undefined`.
 */

/**
 * The candidate keys for `key`, in lookup order. Exported for tests — the
 * ladder's bound and its form-preserving property are both part of the contract.
 *
 * Bounded to at most 4 candidates (exact + 3 spellings), all sharing the input's
 * category and lexical form.
 */
export function lookupCandidates(key: string): string[] {
  const candidates = [key];
  const category = langKeyCategory(key);
  if (category === undefined) {
    return candidates;
  }
  const token = key.slice(category.length + 1);
  const form = langKeyForm(token);
  if (form === undefined) {
    // Named key (`ChooseFriendTitle`, `CLASS_ANSWER_1_A_1`) — no alternate
    // spelling exists; the token is written verbatim on both sides.
    return candidates;
  }

  if (form === 'decimal') {
    const canonical = String(Number(token));
    if (canonical !== '0' || token === '0') {
      candidates.push(`${category}_${canonical.padStart(8, '0')}`);
      candidates.push(`${category}_${canonical}`);
    }
    return dedupe(candidates);
  }

  // Hex form: the same index, spelled with another case or zero-width padding.
  // Never the decimal spelling of that index (that would be the other form).
  candidates.push(`${category}_${token.toLowerCase()}`);
  candidates.push(`${category}_${token.toUpperCase()}`);
  candidates.push(`${category}_${token.toUpperCase().padStart(8, '0')}`);
  return dedupe(candidates);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/** Cached `SELECT value FROM string_table WHERE key = ?`, one per connection. */
const statementCache = new WeakMap<Db, ReturnType<Db['prepare']>>();

function valueStatement(db: Db): ReturnType<Db['prepare']> {
  let statement = statementCache.get(db);
  if (!statement) {
    statement = db.prepare('SELECT value FROM string_table WHERE key = ?');
    statementCache.set(db, statement);
  }
  return statement;
}

/**
 * Resolves `key` against `string_table`. Exact key first, then the bounded
 * spelling ladder; `undefined` when no row exists in the key's own form.
 */
export function lookupString(db: Db, key: string): string | undefined {
  const statement = valueStatement(db);
  for (const candidate of lookupCandidates(key)) {
    const row = statement.get(candidate) as { value: string } | undefined;
    if (row !== undefined) {
      return row.value;
    }
  }
  return undefined;
}

/** Binds `lookupString` to one connection — the shape routers/hooks want. */
export function createStringLookup(db: Db): (key: string) => string | undefined {
  return (key) => lookupString(db, key);
}
