import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { objectTypeConfig, type ObjectTypeConfig } from '@shared/objectTypes';

import { useObjectFriendlyName } from '../../client/src/hooks/useObjectFriendlyName';
import { nameLookupQueryKey } from '../../client/src/lib/api';
import type { NameRow } from '../../client/src/lib/display';

/**
 * `useObjectFriendlyName` — the detail header's one lookup (D105/P6-16, final-deslop T5).
 *
 * The hook had **zero** test references while two pages depend on it, and one of its branches is
 * load-bearing: `decks` must be asked of nobody (D112 freezes the names endpoint at seven types, so
 * a `decks` lookup is a guaranteed 404), which is why the config's own `friendlyNamesType` type is
 * the narrower one.
 *
 * Rendered with `renderToStaticMarkup` in plain node — no jsdom, the same technique
 * `evidence-panel.test.ts` uses. The query cache is **primed** instead of mocked: the hook's
 * `staleTime: Infinity` means a primed entry is served on the first render, so the arm observes the
 * hook's own selection (which type, which key) rather than a fake's answer, and nothing reaches the
 * network or the dev stack (D40).
 */

const NPC_INVENTORY = objectTypeConfig('npcinventory');
const ZONE_TRANSFER = objectTypeConfig('zonetransfer');
const CREATURE_SPELLBOOK = objectTypeConfig('creaturespellbook');
const DROP_TABLE = objectTypeConfig('droptable');

const NPC_ID = '38168';
const ZONE_KEY = 'WizardCity/WC_Hub';
const NPC_ROW: NameRow = { template_id: 38168, name: 'Merle Ambrose' };
const ZONE_ROW: NameRow = {
  zone_path: ZONE_KEY,
  display_name: 'Wizard City / WC Hub',
  world: 'WizardCity',
};

/**
 * Renders the hook once and returns its answer, plus the query keys the cache ended up holding so
 * the arm can assert *which* type was asked for (not only what came back).
 */
function renderName(
  config: ObjectTypeConfig,
  objectKey: string,
  prime: Array<[string, NameRow]> = [],
): { name: string | null; keys: string[] } {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const [type, row] of prime) {
    queryClient.setQueryData(nameLookupQueryKey(type as 'npcs', objectKey), row);
  }
  let seen: string | null = null;
  function Probe(): JSX.Element {
    seen = useObjectFriendlyName(config, objectKey);
    return createElement('span');
  }
  renderToStaticMarkup(
    createElement(QueryClientProvider, { client: queryClient }, createElement(Probe)),
  );
  return {
    name: seen,
    keys: queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey.map((part) => String(part)).join('/')),
  };
}

describe('the object detail header’s friendly name (T5)', () => {
  it('asks the names API for an `npcs` family and keeps only the friendly half', () => {
    const { name, keys } = renderName(NPC_INVENTORY, NPC_ID, [['npcs', NPC_ROW]]);
    expect(name).toBe('Merle Ambrose');
    // The type travelled as the endpoint's own vocabulary, and the key is the object key.
    expect(keys).toContain('name-lookup/npcs/38168');
  });

  it('asks for a `zones` family the same way', () => {
    const { name, keys } = renderName(ZONE_TRANSFER, ZONE_KEY, [['zones', ZONE_ROW]]);
    expect(name).toBe('Wizard City / WC Hub');
    expect(keys).toContain(`name-lookup/zones/${ZONE_KEY}`);
  });

  it('asks nobody for `decks` — the D112 miss is deliberate, not a request that can only 404', () => {
    const { name, keys } = renderName(CREATURE_SPELLBOOK, 'Wizard_Deck_01');
    expect(name).toBeNull();
    // `enabled: false`, so no query ever leaves in a fetching state for this render.
    expect(keys).not.toContain('name-lookup/decks/Wizard_Deck_01');
  });

  it('returns null for a family with no friendly source at all', () => {
    const { name } = renderName(DROP_TABLE, 'DS-ACAD1-C01-001', [['npcs', NPC_ROW]]);
    expect(name).toBeNull();
  });
});
