import { useQuery } from '@tanstack/react-query';
import type { ObjectTypeConfig } from '@shared/objectTypes';

import { getName, nameLookupQueryKey } from '../lib/api';
import { friendlyNameOf, type NameRow, type NamesType } from '../lib/display';

/**
 * The friendly name of one object entry, for the **detail header** (D105/P6-16).
 *
 * The list's pair comes from the server's `ObjectListRow.friendly_name`; a detail page
 * does not receive a list row, so it asks the **same** resolution the dropdown uses —
 * `GET /api/names/:type/:id`, the single lookup the server already serves from the
 * table `config.friendlyNamesType` names — and keeps only the friendly half through
 * `display.ts`'s `friendlyNameOf`. The page then pairs it with the object key through
 * the same `namePair` rule, so the header, the list row and the dropdown cannot
 * disagree about what "the friendly name" of a key is.
 *
 * **A miss is not an error.** `null` is returned for a family with no friendly source
 * (DropTable, GlobalRegistry, CreatureSpellbook until task 6.9), for a key the names
 * table does not hold (an engine-object template) and for a failed/absent lookup — in
 * every one of those cases the header renders the technical value alone, which is
 * exactly the documented fallback. `retry: false` because a 404 is the *expected*
 * answer for those keys, not a transient failure.
 *
 * `staleTime: Infinity` mirrors the names cache: a sync invalidates the `['names']`
 * prefix (D8), and a header is a read-only label.
 */
export function useObjectFriendlyName(config: ObjectTypeConfig, objectKey: string): string | null {
  const type: NamesType | null = config.friendlyNamesType;
  const query = useQuery({
    queryKey: nameLookupQueryKey(type ?? 'strings', objectKey),
    queryFn: () => getName(type as NamesType, objectKey),
    enabled: type !== null && objectKey !== '',
    staleTime: Infinity,
    retry: false,
  });

  if (type === null || query.data === undefined) {
    return null;
  }
  return friendlyNameOf(type, query.data as NameRow);
}
