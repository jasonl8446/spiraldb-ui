import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';

import { objectTypeConfig } from '@shared/objectTypes';
import { otherDropTableNames } from '@shared/dropTable';
import { validateDropTable } from '@shared/dropTable/validation';

import DropTableForm from '../components/objects/DropTableForm';
import { toDropTableValidationMessages } from '../lib/drop-table-validation';
import { displayKeyFor, listObjects, objectListQueryKey } from '../lib/objects';
import type { FieldValidationMessage } from '../lib/validation-message';
import ObjectDetailPage from './ObjectDetailPage';

/**
 * The DropTable detail route — plan task 4.2's wiring of `/drop-tables/:name`.
 *
 * It exists as its own page rather than a `renderForm` inline in `App.tsx` because the
 * duplicate-name rule needs the **corpus** at validation time, and a hook cannot live inside a
 * render prop: this component fetches the family's list (the same `GET /api/drop-tables` the
 * list page uses, so the common list → detail flow reuses one cached response) and builds the
 * validator from it.
 *
 * ## The check is the shared engine, with the corpus and the entry's identity injected
 *
 * `validateDropTable` is `shared/dropTable/validation.ts` — the same function
 * `server/src/services/dropTables.ts` runs on `POST`. The only inputs this page supplies are:
 *
 * - **`otherNames`**, from `otherDropTableNames(rows.map(row => row.key), ownKey)` — the list's
 *   keys are the corpus names, and `ownKey` is this route's key, so the entry's own name is
 *   forgiven and an unmodified save never reports itself as a duplicate. `ownKey` is empty
 *   while the fetch is in flight; the exclusion then forgives nothing, which can only make the
 *   check *stricter* for a moment, never silent.
 * - the **live document**, so the check re-runs on every keystroke.
 *
 * A failed list request therefore degrades to "no corpus injected": the duplicate rule produces
 * nothing client-side (`validateDropTable`'s documented behaviour) while the other three rules
 * still fire, and the **server** still answers the direct POST with 400 and the field map. The
 * client check is a convenience; it is never the authority (the story's named failure mode is a
 * client-only duplicate check).
 *
 * ## The field-map keys are the shared rendered paths
 *
 * `toDropTableValidationMessages` keys every message by `formatDocPath` (`Name`, `RollChance`,
 * `NoneChance`, `MaxGold`). The form renders them under the control that owns the path through
 * the shared `FieldValidation` provider the page mounts — the same sentences the server's 400
 * body carries in its `fields` map.
 */
const DROP_TABLE = objectTypeConfig('droptable');

export default function DropTableDetailPage(): JSX.Element {
  const params = useParams<{ name?: string }>();
  const ownKey = displayKeyFor(DROP_TABLE, params.name ?? '');

  const list = useQuery({
    queryKey: objectListQueryKey(DROP_TABLE),
    queryFn: () => listObjects(DROP_TABLE),
    // The corpus changes under the tool only when a save (this page's own) lands, and the
    // save invalidates this key; a failure must not break the form, so no retry storm.
    staleTime: 30_000,
    retry: false,
  });

  const otherNames = useMemo(
    () =>
      otherDropTableNames(
        (list.data?.objects ?? []).map((row) => row.key),
        ownKey,
      ),
    [list.data, ownKey],
  );

  const validate = useMemo(
    () =>
      (document: Record<string, unknown>): readonly FieldValidationMessage[] =>
        // A failed/absent list injects nothing: the duplicate rule then skips rather than
        // flagging every name (documented on `DropTableValidationOptions.otherNames`).
        toDropTableValidationMessages(
          validateDropTable(document, list.isSuccess ? { otherNames } : {}),
        ),
    [list.isSuccess, otherNames],
  );

  return (
    <ObjectDetailPage
      config={DROP_TABLE}
      nounPlural="drop tables"
      backLabel="Back to Drop Tables"
      validate={validate}
      renderForm={({ document, mode, state, messages }) => (
        <DropTableForm document={document} mode={mode} state={state} messages={messages} />
      )}
    />
  );
}
