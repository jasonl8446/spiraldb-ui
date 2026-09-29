import { describe, expect, it } from 'vitest';

import {
  ApiError,
  SEARCH_DEFAULT_LIMIT,
  searchPath,
  type SearchResponse,
  type SearchResultRow,
} from '../../client/src/lib/api';
import { activityHref } from '../../client/src/lib/dashboard';
import {
  isSearchShortcut,
  searchEmptyMessage,
  searchErrorMessage,
  searchPaletteState,
  searchResultHref,
  searchResultKey,
  searchResultLabel,
  searchResultSecondary,
  SEARCH_IDLE_MESSAGE,
  SEARCH_LOADING_MESSAGE,
  SEARCH_NOT_LINKED_SUFFIX,
  SEARCH_TRIGGER_LABEL,
  truncatedSearchMessage,
  unresolvedSearchMessage,
} from '../../client/src/lib/search';

/**
 * Story p5-02 deliverable D2's pure half — `client/src/lib/search.ts`
 * (plan task 5.2; decisions D10, D51/D76).
 *
 * The palette's rules are here rather than inside the component so they are asserted in
 * plain node: the row identity cmdk needs, the click-through the AC names ("selecting a
 * result lands on its detail page"), the five-state ladder, and the three sentences. The
 * component's own rendering — the dots, the grouping and a real click — is the tier-1 spec
 * (`tests/ui/search-palette.spec.ts`, D40/D81).
 */

function row(overrides: Partial<SearchResultRow> = {}): SearchResultRow {
  return {
    object_type: 'quest',
    object_key: 'DS-ACAD-C01-001',
    label: 'DS-ACAD-C01-001',
    name: 'Wizard Tours',
    source_id: null,
    status: 'reviewed',
    matched_on: 'key',
    ...overrides,
  };
}

function response(overrides: Partial<SearchResponse> = {}): SearchResponse {
  return {
    query: 'ds-acad',
    limit: SEARCH_DEFAULT_LIMIT,
    total: 1,
    truncated: false,
    unresolved: 0,
    groups: [{ type: 'quest', label: 'Quests', results: [row()] }],
    ...overrides,
  };
}

describe('searchResultKey — the identity cmdk and React both need', () => {
  it('uses the type and the key for a navigable row', () => {
    expect(searchResultKey('quest', row())).toBe('object:quest:DS-ACAD-C01-001');
    expect(
      searchResultKey('zone_transfer', row({ object_type: 'zone_transfer', object_key: 'A/B' })),
    ).toBe('object:zone_transfer:A/B');
  });

  it('uses the group and the friendly id for a routeless row, because names are not unique', () => {
    const item = row({
      object_type: null,
      object_key: null,
      label: 'Obsidian Amulet',
      name: 'Obsidian Amulet',
      source_id: '4',
      status: null,
      matched_on: 'name',
    });

    expect(searchResultKey('item', item)).toBe('name:item:4');
    // Two rows with the same name and the same numeric id in *different* tables must not
    // collide: that is what the group prefix is for.
    expect(searchResultKey('spell', { ...item, source_id: '4' })).toBe('name:spell:4');
    // A row the server sent without an id still gets a stable key from its label.
    expect(searchResultKey('npc', { ...item, source_id: null })).toBe('name:npc:Obsidian Amulet');
  });
});

describe('searchResultHref — the existing D4 mapping, not a second one', () => {
  it('is literally activityHref, for every type it accepts', () => {
    const rows: SearchResultRow[] = [
      row(),
      row({ object_type: 'drop_table', object_key: 'KT-SPH3-C02-003', name: null }),
      row({ object_type: 'zone_transfer', object_key: 'WizardCity/WC_Hub', name: null }),
      row({ object_type: 'npc_inventory', object_key: '87112', name: null }),
      row({ object_type: null, object_key: null, label: 'Obsidian Amulet', source_id: '4' }),
      row({ object_type: null, object_key: 'DS-ACAD-C01-001' }),
      row({ object_type: 'quest', object_key: '' }),
      row({ object_type: 'global_registry', object_key: 'GlobalRegistryValues' }),
    ];

    for (const r of rows) {
      expect(searchResultHref(r)).toBe(activityHref(r));
    }
  });

  it('answers the detail route the AC names, and null where no route exists', () => {
    expect(searchResultHref(row())).toBe('/quests/DS-ACAD-C01-001');
    expect(
      searchResultHref(row({ object_type: 'drop_table', object_key: 'KT-SPH3-C02-003' })),
    ).toBe('/drop-tables/KT-SPH3-C02-003');
    // A slash-bearing key is percent-encoded by the shared mapping.
    expect(
      searchResultHref(row({ object_type: 'zone_transfer', object_key: 'WizardCity/WC_Hub' })),
    ).toBe('/zone-transfers/WizardCity%2FWC_Hub');

    // No `/items/:gid` page: a friendly-name hit claims no route rather than inventing one.
    expect(searchResultHref(row({ object_type: null, object_key: null }))).toBeNull();
    expect(searchResultHref(row({ object_type: null, object_key: 'anything' }))).toBeNull();
    expect(searchResultHref(row({ object_type: 'quest', object_key: '' }))).toBeNull();
    // The registry has no detail route (Q1), so it is unlinkable too.
    expect(
      searchResultHref(row({ object_type: 'global_registry', object_key: 'GlobalRegistryValues' })),
    ).toBeNull();
  });
});

describe('searchResultLabel — the pair, through the one display rule', () => {
  it('pairs the row’s name with its key, and collapses the identity case', () => {
    // A navigable row: the friendly name and the key it belongs to (D105/P6-16).
    expect(searchResultLabel(row())).toBe('Wizard Tours (DS-ACAD-C01-001)');
    // A TemplateID-family row matched on its NPC's name: the key is the template id.
    expect(
      searchResultLabel(
        row({
          object_type: 'npc_inventory',
          object_key: '38168',
          label: '38168',
          name: 'Merle Ambrose',
        }),
      ),
    ).toBe('Merle Ambrose (38168)');
    // No name: the label alone, never `X ()`.
    expect(searchResultLabel(row({ name: null }))).toBe('DS-ACAD-C01-001');
    // A routeless name row whose label *is* its name: no `Obsidian Amulet (Obsidian Amulet)`.
    expect(nameEqualsLabel()).toBe('Obsidian Amulet');
  });
});

describe('searchResultSecondary', () => {
  it('carries an NPC row’s other name strings, and nothing for a single-name row', () => {
    // One NPC, two measured granularities (P6-17/D112): `Gretta` and `Gretta Darkkettle`.
    expect(
      searchResultSecondary(
        row({
          object_type: null,
          object_key: null,
          label: 'Gretta Darkkettle',
          name: 'Gretta Darkkettle',
          aliases: ['Gretta', 'Gretta Darkkettle'],
        }),
      ),
    ).toBe('Gretta');
    // The alias that *is* the label is not repeated.
    expect(
      searchResultSecondary(
        row({
          object_type: null,
          object_key: null,
          label: 'Merle Ambrose',
          name: 'Merle Ambrose',
          aliases: ['Merle Ambrose'],
        }),
      ),
    ).toBeNull();
    // Every other group carries its one name in the pair itself.
    expect(searchResultSecondary(row())).toBeNull();
  });
});

/** The routeless-name case, written as its own function so the assertion reads plainly. */
function nameEqualsLabel(): string {
  return searchResultLabel(
    row({ object_type: null, object_key: null, label: 'Obsidian Amulet', name: 'Obsidian Amulet' }),
  );
}

describe('searchPaletteState — the five-state ladder', () => {
  it('is idle when nothing is typed, whatever the request is doing', () => {
    expect(searchPaletteState({ q: '', isPending: true, isError: false, data: undefined })).toBe(
      'idle',
    );
    expect(searchPaletteState({ q: '', isPending: false, isError: false, data: response() })).toBe(
      'idle',
    );
  });

  it('walks loading → error → empty → ready in that order', () => {
    expect(searchPaletteState({ q: 'x', isPending: true, isError: false, data: undefined })).toBe(
      'loading',
    );
    expect(searchPaletteState({ q: 'x', isPending: false, isError: true, data: undefined })).toBe(
      'error',
    );
    // A read that produced nothing at all is a failure, not "no results" — the criterion's
    // own failure mode (an empty state rendered over a broken request).
    expect(searchPaletteState({ q: 'x', isPending: false, isError: false, data: undefined })).toBe(
      'error',
    );
    expect(
      searchPaletteState({
        q: 'x',
        isPending: false,
        isError: false,
        data: response({ groups: [], total: 0 }),
      }),
    ).toBe('empty');
    expect(searchPaletteState({ q: 'x', isPending: false, isError: false, data: response() })).toBe(
      'ready',
    );
  });
});

describe('searchPath — the request the palette sends', () => {
  it('percent-encodes the query, so a key with & or ? cannot reshape the request', () => {
    expect(searchPath('DS-ACAD-C01-001')).toBe('/api/search?q=DS-ACAD-C01-001&limit=20');
    expect(searchPath('A&B?C/D')).toBe('/api/search?q=A%26B%3FC%2FD&limit=20');
    expect(searchPath('  spaced  ')).toBe('/api/search?q=%20%20spaced%20%20&limit=20');
  });

  it('carries the per-group cap it was given, and defaults to 20', () => {
    expect(searchPath('x', 5)).toBe('/api/search?q=x&limit=5');
    expect(searchPath('x')).toContain(`limit=${String(SEARCH_DEFAULT_LIMIT)}`);
  });
});

describe('the palette’s sentences', () => {
  it('names the query it found nothing for', () => {
    expect(searchEmptyMessage('zzzz')).toContain('zzzz');
    expect(searchEmptyMessage('zzzz')).toContain('No results');
  });

  it('writes the unlinked notice in both numbers', () => {
    expect(unresolvedSearchMessage(1)).toContain('1 result has no page to open');
    expect(unresolvedSearchMessage(3)).toContain('3 results have no page to open');
    expect(unresolvedSearchMessage(3)).not.toContain('1 results');
  });

  it('says the cap is per type, because the endpoint’s limit is', () => {
    expect(truncatedSearchMessage(20)).toBe('Showing the first 20 matches of each type.');
    expect(truncatedSearchMessage(20)).toContain(String(SEARCH_DEFAULT_LIMIT));
  });

  it('prefers the server’s message and falls back to its own', () => {
    expect(searchErrorMessage(new ApiError(400, 'Invalid limit "51"'))).toBe('Invalid limit "51"');
    expect(searchErrorMessage(new Error('boom'))).toBe('boom');
    expect(searchErrorMessage('not an error')).toBe('Could not search.');
  });

  it('exposes one name for the trigger, and one for each non-results state', () => {
    expect(SEARCH_TRIGGER_LABEL).toBe('Search all objects');
    expect(SEARCH_IDLE_MESSAGE).not.toBe('');
    expect(SEARCH_LOADING_MESSAGE).not.toBe('');
    expect(SEARCH_NOT_LINKED_SUFFIX).toBe('— not linked');
  });
});

describe('isSearchShortcut — ⌘K / Ctrl+K and nothing else', () => {
  const base = { key: 'k', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };

  it('accepts the plan’s two combinations in either letter case', () => {
    expect(isSearchShortcut({ ...base, metaKey: true })).toBe(true);
    expect(isSearchShortcut({ ...base, ctrlKey: true })).toBe(true);
    expect(isSearchShortcut({ ...base, metaKey: true, key: 'K' })).toBe(true);
  });

  it('leaves the browser’s own combinations alone', () => {
    expect(isSearchShortcut(base)).toBe(false);
    expect(isSearchShortcut({ ...base, metaKey: true, shiftKey: true })).toBe(false);
    expect(isSearchShortcut({ ...base, ctrlKey: true, altKey: true })).toBe(false);
    expect(isSearchShortcut({ ...base, metaKey: true, key: 'j' })).toBe(false);
    // ctrl+n / ctrl+p / ctrl+j belong to cmdk's vim bindings; they are not this shortcut.
    expect(isSearchShortcut({ ...base, ctrlKey: true, key: 'n' })).toBe(false);
  });
});
