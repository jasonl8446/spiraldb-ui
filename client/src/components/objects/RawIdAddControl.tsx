import { Plus } from 'lucide-react';
import { useState } from 'react';

import { numberIdFromRaw, textIdFromRaw } from '@shared/simpleObjects';

import { Button } from '../ui/button';
import { Input } from '../ui/input';

/**
 * `RawIdAddControl` — the "type a value the name search cannot reach" box, named once.
 *
 * A names table is the only source of searchable labels, and a document may hold values it does
 * not carry. Two measured instances of that gap:
 *
 * - **numeric**: 42 of NpcInventory's 3,205 distinct item ids, 1 of CreatureSpellbook's 369 spell
 *   ids and 4 of the 215 NpcInventory keys have no synced row. A *removed* one cannot be found by
 *   name again, so every editor whose list can hold a miss needs a way to type the number back.
 *   p4-01's NpcInventory form had such a box; story p4-03 kept the capability and put it in one
 *   component so the editors that need it cannot drift in what they accept.
 * - **text**: `NpcDropTable.DropTableNames` holds DropTable **names**, and the spec's own example
 *   carries `WC-UNICORN-BONUS-001`, which has no `DropTables/*.json` file and no `drop_tables`
 *   row (measured: 0 of the 317 names contain `BONUS`). The names search cannot reach such a
 *   value either, so the box carries the id **kind** rather than forking into a second control —
 *   D71(i) names exactly one raw-add box, and a `4.7`-style numeric sibling keeps using this one.
 *
 * ## The parse is the shared conversion, per kind
 *
 * `numberIdFromRaw` (`ULong.toJson`, the one conversion) refuses `''`, `abc`, `-1`, `1.5` and a
 * value beyond `Number.MAX_SAFE_INTEGER`, and canonicalises `01001` to the JSON number `1001`;
 * the box trims the box's own padding before it, because `ULong.toJson` rejects `" 1 "` by
 * contract. `textIdFromRaw` refuses a blank string and otherwise hands back **exactly what was
 * typed** — no trim, no case folding (validate, never normalise: a name is the document's value
 * and the editor must not invent one). Both are no-ops on a refused value: no edit, no clearing.
 */
export interface RawIdAddControlCommonProps {
  /** The input's id, so a visible `<label htmlFor>` can point at it. */
  id: string;
  /** The visible label above the box (`Add an item id`, `Add a drop table name`). */
  label: string;
  /** The button's text; `Add id` by default. */
  buttonLabel?: string;
  /** One line under the box, where a measured miss count belongs. */
  help?: string;
  /** Placeholder text; `id` by default (`number`) or `name` (`text`). */
  placeholder?: string;
}

/**
 * The props, discriminated by `idKind` so a caller's `onAdd` is typed to the value it will
 * actually receive — the numeric arm gets a `number`, the text arm a `string`.
 */
export type RawIdAddControlProps = RawIdAddControlCommonProps &
  (
    | { idKind: 'number'; onAdd: (id: number) => void }
    | { idKind: 'text'; onAdd: (id: string) => void }
  );

export default function RawIdAddControl(props: RawIdAddControlProps): JSX.Element {
  const { id, label, buttonLabel = 'Add id', help, placeholder } = props;
  const [pending, setPending] = useState('');

  function commit(): void {
    // `props` (not a destructured `onAdd`) so the discriminated union narrows the callback.
    if (props.idKind === 'number') {
      const parsed = numberIdFromRaw(pending.trim());
      if (parsed === undefined) {
        return;
      }
      props.onAdd(parsed);
    } else {
      const parsed = textIdFromRaw(pending);
      if (parsed === undefined) {
        return;
      }
      props.onAdd(parsed);
    }
    setPending('');
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-400" htmlFor={id}>
            {label}
          </label>
          <Input
            id={id}
            value={pending}
            {...(props.idKind === 'number' ? { inputMode: 'numeric' as const } : {})}
            placeholder={placeholder ?? (props.idKind === 'number' ? 'id' : 'name')}
            onChange={(event) => setPending(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commit();
              }
            }}
            className="w-40"
          />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={commit}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          {buttonLabel}
        </Button>
      </div>

      {help === undefined ? null : <p className="text-xs text-zinc-500">{help}</p>}
    </div>
  );
}
