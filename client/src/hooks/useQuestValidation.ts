import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';

import { validateQuest, type QuestValidationReferences } from '@shared/quest/validation';
import type { QuestValidationResult } from '@shared/quest/validation';

import { getNames, namesQueryKey } from '../lib/api';
import { nameRowId, type NameRow, type NamesType } from '../lib/display';
import {
  bannerModel,
  messageIndex,
  toValidationMessages,
  type ValidationBannerModel,
  type ValidationMessage,
  type ValidationMessageIndex,
} from '../lib/quest-validation';

/**
 * `useQuestValidation(document)` — the live validation pass behind the inline messages, the
 * form-level banner and the Save gate (plan task 3.9, story p3-09).
 *
 * The engine is `shared/quest/validation.ts`, the same module the server runs, so a finding the
 * client renders inline and a finding the server returns in its `400` field map are the same
 * finding with the same path and the same sentence.
 *
 * **Where the reference tables come from.** The reference rules need the friendly-name tables
 * injected, and `shared/` cannot reach SQLite. The client already receives exactly these tables
 * through `GET /api/names/:type` — `useNames` bulk-loads `zones`, `npcs`, `spells`,
 * `drop_tables` (and `items`/`quests`) with `staleTime: Infinity` for `FriendlyNameDropdown`
 * (D8, D39 item 3) — so this hook reads the *same* TanStack Query cache (`namesQueryKey(type)`)
 * rather than adding an endpoint or a second contract. Consequence, stated rather than hidden:
 * the first quest-detail page of a session loads the five tables once (~43k rows: zones 1,241,
 * npcs 23,033, spells 18,173, drop_tables 317, quests 322) even if no dropdown is opened; every
 * later page and dropdown reuses the cache, and a sync invalidates the `['names']` prefix (D8).
 * A namespace whose query has not answered yet is **absent**, and the engine then skips that
 * rule instead of reporting every value as unknown — so a slow list can never invent warnings.
 * An **empty** list is treated the same way: a table with zero rows is not a reference set, and
 * the realistic case it covers is a database whose friendly names were never synced (the tier-1
 * harness boots exactly that database: D44's throwaway file plus `SPIRALDB_UI_SKIP_IMPORT=1`).
 * Without this, every zone path and every id in a real quest would be reported as unknown —
 * a wall of false warnings from an unimplemented sync, which is the opposite of the honesty the
 * rules exist for.
 */
const REFERENCE_TYPES = [
  'zones',
  'npcs',
  'spells',
  'drop_tables',
  'quests',
] as const satisfies readonly NamesType[];

/** The five injected tables, built from the cached names queries. */
export function useValidationReferences(): QuestValidationReferences {
  // `combine` is TanStack Query v5's memoized projection: the five Sets are rebuilt only when
  // one of the five lists actually changes, not on every render (the arrays themselves are
  // stable references in the cache).
  return useQueries({
    queries: REFERENCE_TYPES.map((type) => ({
      queryKey: namesQueryKey(type),
      queryFn: () => getNames(type),
      staleTime: Infinity,
      gcTime: Infinity,
    })),
    combine: (results) => {
      const sets: QuestValidationReferences = {};
      REFERENCE_TYPES.forEach((type, index) => {
        const rows = results[index].data as NameRow[] | undefined;
        if (rows === undefined || rows.length === 0) {
          return;
        }
        const values = new Set<string>();
        for (const row of rows) {
          values.add(String(nameRowId(type, row)));
        }
        sets[type] = values;
      });
      return sets;
    },
  });
}

/** Everything the presentation needs from one pass. */
export interface QuestValidationState {
  /** The engine's result: findings, the blocking/warning split and `blocked`. */
  result: QuestValidationResult;
  /** The messages, in engine order. */
  messages: readonly ValidationMessage[];
  /** The messages indexed by rendered path — what `FieldValidationProvider` consumes. */
  index: ValidationMessageIndex;
  /** The banner's two sentences. */
  banner: ValidationBannerModel;
  /** The Save gate: `true` when a blocking finding exists. */
  blocked: boolean;
}

/**
 * Runs the engine over the live document and prepares the presentation. `document` is the same
 * object the editors mutate (`useQuestDocument().doc`), so this is a pure read of the one
 * document state — no second copy, no refetch, and the messages update with every edit.
 */
export function useQuestValidation(document: unknown): QuestValidationState {
  const references = useValidationReferences();
  const result = useMemo(() => validateQuest(document, { references }), [document, references]);
  return useMemo(() => {
    const messages = toValidationMessages(result);
    return {
      result,
      messages,
      index: messageIndex(messages),
      banner: bannerModel(result),
      blocked: result.blocked,
    };
  }, [result]);
}
