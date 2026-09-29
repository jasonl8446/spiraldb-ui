import { useQuery } from '@tanstack/react-query';
import type { ObjectTypeConfig } from '@shared/objectTypes';

import { getName, nameLookupQueryKey } from '../lib/api';
import { friendlyNameOf, NAMES_TYPES, type NameRow, type NamesType } from '../lib/display';

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
 * (DropTable and GlobalRegistry), for a key the names table does not hold (an
 * engine-object template, and — measured in task 6.9 — **every** corpus
 * `CreatureSpellbook.DeckName`, none of which equals a `DeckTemplate` name), and for a
 * failed/absent lookup — in every one of those cases the header renders the technical
 * value alone, which is exactly the documented fallback. `retry: false` because a 404 is
 * the *expected* answer for those keys, not a transient failure.
 *
 * **`decks` is asked of nobody** (task 6.9): D112 freezes `GET /api/names/:type` at its
 * seven types, so a `decks` lookup would be a guaranteed 404. It is skipped rather than
 * issued — and it costs nothing, because a `DeckTemplate`'s only name *is* the
 * `DeckName` the header already renders, so the pair would be `X (X)`.
 *
 * `staleTime: Infinity` mirrors the names cache: a sync invalidates the `['names']`
 * prefix (D8), and a header is a read-only label.
 */
export function useObjectFriendlyName(config: ObjectTypeConfig, objectKey: string): string | null {
  const source = config.friendlyNamesType;
  // A source the names API does not serve (`decks`, D112's frozen seven) is a deliberate miss,
  // never a request that can only 404. The vocabulary is `display.ts`'s `NAMES_TYPES` — the same
  // seven-type list the endpoint and `nameLookupQueryKey` are built from — rather than a second
  // list here (D105); the config's own type is what keeps `decks` from reaching the check at all.
  const type: NamesType | null =
    source !== null && (NAMES_TYPES as readonly string[]).includes(source)
      ? (source as NamesType)
      : null;
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
