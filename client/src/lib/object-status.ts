/**
 * The generic object families' status scope (story p4-08, plan task 4.10; decisions
 * D37, D51(e), D71(i), D75(j)).
 *
 * A transition moves two cached things: the entry's own status (the `StatusBadge`) and the
 * list it feeds — the row's colour dot and the filter-tab counts. For the seven tracked
 * object families that list is `GET /api/<type>` under {@link objectListQueryKey}, and this
 * module is the one place that knows how to rewrite it: the writer the shared mark-actions
 * unit hands to `useStatusTransition` (see `lib/status-transition.ts`'s
 * `StatusListScope`).
 *
 * **Why a separate module rather than a branch inside the hook or in `lib/objects.ts`:**
 * `lib/objects.ts` is the API client (paths, request bodies, response shapes) and
 * `lib/status-transition.ts` is the pure quest-era status logic; this file is the seam
 * between the two, and it is the only file that changes if a future family's list payload
 * stops looking like `ObjectListResponse`. It is deliberately **not** reachable from
 * `shared/objectTypes.ts`: `global_registry` has no row in the status table (Q1, D75(j)), so
 * nothing here may ever be mounted for it — the caller gates on
 * `config.routeType !== null`.
 *
 * **The optimistic write mirrors the server's own summary derivation** (D49(b):
 * `GET /api/<type>`'s summary counts the rows it returned, and only rows with a joined
 * status). Keeping the summary in step is what makes the filter tab that counts
 * `reviewed` agree with the dot that shows it, for the moment before the settle
 * invalidation's refetch lands.
 */

import type { QueryClient } from '@tanstack/react-query';

import type { ObjectTypeConfig } from '@shared/objectTypes';

import type { StatusValue } from './api';
import { objectListQueryKey, type ObjectListResponse } from './objects';
import type { StatusListScope } from './status-transition';

/**
 * Rewrites one entry's status in a cached `GET /api/<type>` payload **and** recomputes that
 * payload's `summary` from the rewritten rows — the server's own derivation
 * (`server/src/services/objects.ts`: `total` counts the rows whose status joined, one
 * bucket per lifecycle value).
 *
 * A no-op returning `false` when the list is not cached, or when the family's
 * `summary` is `null` (a lifecycle-free family has no tabs to count): the settle
 * invalidation then paints the truth, and the caller learns it had nothing to roll back.
 */
export function applyOptimisticObjectStatus(
  client: QueryClient,
  listQueryKey: readonly unknown[],
  objectKey: string,
  status: StatusValue,
): boolean {
  const data = client.getQueryData<ObjectListResponse>(listQueryKey);
  if (data === undefined || data.summary === null) {
    return false;
  }
  const objects = data.objects.map((row) => (row.key === objectKey ? { ...row, status } : row));
  const summary = { total: 0, extracted: 0, reviewed: 0, verified: 0 };
  for (const row of objects) {
    if (row.status !== null) {
      summary.total += 1;
      summary[row.status] += 1;
    }
  }
  client.setQueryData<ObjectListResponse>(listQueryKey, { ...data, objects, summary });
  return true;
}

/**
 * The status scope of one tracked family: its list query key ({@link objectListQueryKey},
 * the same key the list page fetches under, so one cached response serves both surfaces)
 * plus the writer above and the family's singular noun for the untracked copy.
 *
 * `noun` is caller-supplied because only the route knows its plural copy
 * (`nounPlural` in `App.tsx`); the default is the family id, which reads acceptably and
 * never invents a plural.
 */
export function objectStatusScope(config: ObjectTypeConfig, noun?: string): StatusListScope {
  const listQueryKey = objectListQueryKey(config);
  return {
    listQueryKey,
    applyOptimistic: (client, key, status) =>
      applyOptimisticObjectStatus(client, listQueryKey, key, status),
    noun: noun ?? config.label.toLowerCase(),
  };
}
