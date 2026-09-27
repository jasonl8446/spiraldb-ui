import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { objectTypeConfig } from '@shared/objectTypes';

import { applyOptimisticObjectStatus, objectStatusScope } from '../../client/src/lib/object-status';
import { objectSingularNoun } from '../../client/src/lib/object-list';
import {
  historyErrorMessage,
  transitionErrorMessage,
  UNTRACKED_ENTRY_MESSAGE,
  UNTRACKED_HISTORY_MESSAGE,
  untrackedEntryMessage,
  untrackedHistoryMessage,
} from '../../client/src/lib/status-transition';
import { ApiError } from '../../client/src/lib/api';
import type { ObjectListResponse } from '../../client/src/lib/objects';

/**
 * Story p4-08's pure-node half (decision D10): the generic-family status scope and the
 * per-family copy it feeds. Everything that decides what a user sees is asserted here, in
 * plain node, rather than inferred from a rendered page.
 *
 * The three rules this pins:
 *
 * 1. **The optimistic write mirrors the server's summary derivation** — rewriting one row and
 *    recomputing the four counts is what keeps the filter tab that counts `reviewed` in step
 *    with the dot that shows it, before the settle refetch lands.
 * 2. **A family with no lifecycle has no tabs to keep in step** → a `summary: null` payload is
 *    a no-op, and the caller is told so it has nothing to roll back.
 * 3. **The untracked copy names the family** — the generalisation of p2-09's quest constants
 *    (`lib/status-transition.ts`), whose quest wording is unchanged and asserted too.
 */

const DROP_TABLE = objectTypeConfig('droptable');
const NPC_INVENTORY = objectTypeConfig('npcinventory');
const GLOBAL_REGISTRY = objectTypeConfig('globalregistry');

function listBody(): ObjectListResponse {
  return {
    objects: [
      {
        key: 'DS-ACAD1-C01-001',
        title: 'DS-ACAD1-C01-001',
        modified_at: null,
        status: 'extracted',
      },
      {
        key: 'DS-ACAD1-C01-002',
        title: 'DS-ACAD1-C01-002',
        modified_at: null,
        status: 'extracted',
      },
      { key: 'DS-ACAD1-C01-003', title: 'DS-ACAD1-C01-003', modified_at: null, status: 'verified' },
    ],
    summary: { total: 3, extracted: 2, reviewed: 0, verified: 1 },
    skipped: [],
    missing_directory: false,
    duplicate_keys: [],
  };
}

function seeded(): { client: QueryClient; key: readonly unknown[] } {
  const client = new QueryClient();
  const key = objectStatusScope(DROP_TABLE).listQueryKey;
  client.setQueryData(key, listBody());
  return { client, key };
}

describe('applyOptimisticObjectStatus: the dot and the tab counts move together', () => {
  it('rewrites the one row and recomputes the summary from the rows (D49(b))', () => {
    const { client, key } = seeded();

    expect(applyOptimisticObjectStatus(client, key, 'DS-ACAD1-C01-001', 'reviewed')).toBe(true);

    const data = client.getQueryData<ObjectListResponse>(key);
    expect(data?.objects.map((row) => row.status)).toEqual(['reviewed', 'extracted', 'verified']);
    expect(data?.summary).toEqual({ total: 3, extracted: 1, reviewed: 1, verified: 1 });
  });

  it('leaves the payload identical for an unknown key', () => {
    const { client, key } = seeded();
    const before = client.getQueryData<ObjectListResponse>(key);

    expect(applyOptimisticObjectStatus(client, key, 'NOPE', 'verified')).toBe(true);

    expect(client.getQueryData<ObjectListResponse>(key)).toEqual(before);
  });

  it('is a no-op that reports so when the list is not cached (nothing to roll back)', () => {
    const client = new QueryClient();
    expect(
      applyOptimisticObjectStatus(
        client,
        objectStatusScope(DROP_TABLE).listQueryKey,
        'X',
        'verified',
      ),
    ).toBe(false);
  });

  it('is a no-op for a family whose summary is null (no tabs to count — Q1)', () => {
    const client = new QueryClient();
    const key = objectStatusScope(GLOBAL_REGISTRY).listQueryKey;
    client.setQueryData<ObjectListResponse>(key, {
      objects: [
        { key: 'globalregistry', title: 'globalregistry', modified_at: null, status: null },
      ],
      summary: null,
      skipped: [],
      missing_directory: false,
      duplicate_keys: [],
    });

    expect(applyOptimisticObjectStatus(client, key, 'globalregistry', 'reviewed')).toBe(false);
    expect(client.getQueryData<ObjectListResponse>(key)?.objects[0]?.status).toBeNull();
  });
});

describe('objectStatusScope: the list a transition feeds, per family', () => {
  it('targets the family`s own list query key (one cached response, two surfaces)', () => {
    expect(objectStatusScope(DROP_TABLE).listQueryKey).toEqual(['objects', 'droptable']);
    expect(objectStatusScope(NPC_INVENTORY).listQueryKey).toEqual(['objects', 'npcinventory']);
  });

  it('defaults the noun to the family label and takes an explicit one', () => {
    expect(objectStatusScope(DROP_TABLE).noun).toBe('drop tables');
    expect(objectStatusScope(DROP_TABLE, 'drop table').noun).toBe('drop table');
  });

  it('writes through the list key it reports (the closure is not a second key)', () => {
    const client = new QueryClient();
    const scope = objectStatusScope(NPC_INVENTORY, 'NPC inventory');
    client.setQueryData(scope.listQueryKey, listBody());

    expect(scope.applyOptimistic(client, 'DS-ACAD1-C01-003', 'reviewed')).toBe(true);

    const data = client.getQueryData<ObjectListResponse>(scope.listQueryKey);
    expect(data?.objects[2]?.status).toBe('reviewed');
    expect(data?.summary).toEqual({ total: 3, extracted: 2, reviewed: 1, verified: 0 });
  });
});

describe('the per-family untracked copy', () => {
  it('names the family in both messages', () => {
    expect(untrackedEntryMessage('drop table')).toBe(
      'This drop table is not tracked yet — save or import it first, then mark its status.',
    );
    expect(untrackedHistoryMessage('NPC inventory')).toBe(
      'This NPC inventory is not tracked yet. Its history appears once it has been saved or imported.',
    );
  });

  it('keeps the quest wording of the Phase-2 constants exactly (p2-09 regression)', () => {
    expect(UNTRACKED_ENTRY_MESSAGE).toBe(untrackedEntryMessage('quest'));
    expect(UNTRACKED_HISTORY_MESSAGE).toBe(untrackedHistoryMessage('quest'));
  });

  it('routes a 404 to the family wording and everything else to the server`s own text', () => {
    const untracked = new ApiError(404, 'Unknown drop_tables entry "NOPE"');

    expect(transitionErrorMessage(untracked, 'drop table')).toBe(
      untrackedEntryMessage('drop table'),
    );
    expect(historyErrorMessage(untracked, 'drop table')).toBe(
      untrackedHistoryMessage('drop table'),
    );
    // The default is the quest wording, so every p2-09 call site is unchanged.
    expect(transitionErrorMessage(untracked)).toBe(UNTRACKED_ENTRY_MESSAGE);
    expect(transitionErrorMessage(new ApiError(400, 'Invalid status "nope"'))).toBe(
      'Invalid status "nope"',
    );
  });
});

describe('objectSingularNoun: one rule, the strings that really exist', () => {
  it('handles the two …ies plurals that the naive rule turned into "inventor"', () => {
    expect(objectSingularNoun('NPC inventories')).toBe('NPC inventory');
    expect(objectSingularNoun('treasure card inventories')).toBe('treasure card inventory');
    expect(objectSingularNoun('NPC spell inventories')).toBe('NPC spell inventory');
  });

  it('strips a trailing s for the regular ones and leaves a singular alone', () => {
    expect(objectSingularNoun('drop tables')).toBe('drop table');
    expect(objectSingularNoun('creature spellbooks')).toBe('creature spellbook');
    expect(objectSingularNoun('zone transfers')).toBe('zone transfer');
    expect(objectSingularNoun('global registry')).toBe('global registry');
  });
});
