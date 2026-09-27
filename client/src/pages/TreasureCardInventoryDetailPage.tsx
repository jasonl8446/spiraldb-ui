import { useMemo } from 'react';

import { objectTypeConfig } from '@shared/objectTypes';
import { validateTreasureCardInventory } from '@shared/simpleObjects';

import TreasureCardInventoryForm from '../components/objects/TreasureCardInventoryForm';
import { useSpellNames } from '../hooks/useSpellNames';
import { toTreasureCardValidationMessages } from '../lib/treasure-card-validation';
import type { FieldValidationMessage } from '../lib/validation-message';
import ObjectDetailPage from './ObjectDetailPage';

/**
 * The TreasureCardInventory detail route — plan task 4.7's wiring of
 * `/treasure-card-inventories/:id` (story p4-05 AC1).
 *
 * It exists as its own page rather than a `renderForm` inline in `App.tsx` because the
 * warn-not-block rule needs the synced `spells` names at validation time and a hook cannot live
 * inside a render prop (the reason `DropTableDetailPage` exists for the DropTable rules).
 *
 * ## The check is the shared engine, with the reference table injected
 *
 * `validateTreasureCardInventory` is `shared/simpleObjects/treasureCardInventory.ts`. The only
 * input this page supplies is the name set from {@link useSpellNames}, which reads the same
 * cached `GET /api/names/spells` query the dropdowns use — no new endpoint, no second contract.
 * The engine's verdict becomes the inline messages the shared `FieldValidation` provider places
 * under each row.
 *
 * ## What the page deliberately does **not** do: block
 *
 * The result has no blocking finding, and the Save gate is `ObjectDetailPage`'s own
 * `fieldHasError(messages)` — `severity === 'error'`, which this family never emits. So a
 * document whose every name fails the match renders its warnings and **saves** (AC1's two arms),
 * and the server's POST path for this family has no validator to reject it with. That split is
 * stated in the model's header; nothing here re-derives a disabled state.
 *
 * ## When the table is absent, the rule is skipped and the form says so
 *
 * `useSpellNames()` answers `undefined` while the query is in flight, on failure, or for an
 * empty table, and `{}` is then passed to the engine — which produces no findings and reports
 * `referenceUsed: false` (D65(c): an unimported table must not flood a real file with false
 * warnings). The form renders that as a one-line note instead of a clean summary it did not earn.
 */
const TREASURE_CARD_INVENTORY = objectTypeConfig('treasurecardinventory');

export default function TreasureCardInventoryDetailPage(): JSX.Element {
  const spellNames = useSpellNames();
  const referenceUsed = spellNames !== undefined;

  const validate = useMemo(
    () =>
      (document: Record<string, unknown>): readonly FieldValidationMessage[] =>
        toTreasureCardValidationMessages(
          // The engine's own absent-reference rule: `{}` means "this side cannot check".
          validateTreasureCardInventory(document, referenceUsed ? { spellNames } : {}),
        ),
    [referenceUsed, spellNames],
  );

  return (
    <ObjectDetailPage
      config={TREASURE_CARD_INVENTORY}
      nounPlural="treasure card inventories"
      backLabel="Back to Treasure Card Inventories"
      validate={validate}
      renderForm={({ document, mode, state, messages }) => (
        <TreasureCardInventoryForm
          document={document}
          mode={mode}
          state={state}
          messages={messages}
          referenceUsed={referenceUsed}
        />
      )}
    />
  );
}
