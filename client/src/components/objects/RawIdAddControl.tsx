import { Plus } from 'lucide-react';
import { useState } from 'react';

import { numberIdFromRaw } from '@shared/simpleObjects';

import { Button } from '../ui/button';
import { Input } from '../ui/input';

/**
 * `RawIdAddControl` — the "type an id that has no synced name" box, named once.
 *
 * The names tables are the only source of searchable labels, and the corpus really contains ids
 * they do not hold (42 of the NpcInventory's 3,205 distinct item ids, 1 of the CreatureSpellbook's
 * 369 spell ids, 4 of the 215 NpcInventory keys). A *removed* one of those cannot be found by name
 * again, so every editor whose list can hold a miss needs a way to type the number back. p4-01's
 * NpcInventory form had such a box; story p4-03 keeps the capability and puts it in one component
 * so the two editors that need it (the multi-select and the spellbook's reorderable list) cannot
 * drift in what they accept.
 *
 * The parse is `numberIdFromRaw` — `ULong.toJson`, the one conversion — so
 * `''`, `abc`, `-1`, `1.5` and a value beyond `Number.MAX_SAFE_INTEGER` are all refused with no
 * edit, and `01001` becomes the JSON number `1001`.
 */
export interface RawIdAddControlProps {
  /** The input's id, so a visible `<label htmlFor>` can point at it. */
  id: string;
  /** The visible label above the box (`Add an item id`). */
  label: string;
  /** The button's text; `Add id` by default. */
  buttonLabel?: string;
  /** Receives the parsed non-negative integer. */
  onAdd: (id: number) => void;
  /** One line under the box, where a measured miss count belongs. */
  help?: string;
}

export default function RawIdAddControl({
  id,
  label,
  buttonLabel = 'Add id',
  onAdd,
  help,
}: RawIdAddControlProps): JSX.Element {
  const [pending, setPending] = useState('');

  function commit(): void {
    const parsed = numberIdFromRaw(pending.trim());
    if (parsed === undefined) {
      return;
    }
    onAdd(parsed);
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
            inputMode="numeric"
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
