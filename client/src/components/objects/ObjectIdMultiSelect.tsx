import { Check, Loader2, Plus, X } from 'lucide-react';
import { useState } from 'react';

import {
  addToList,
  numberIdFromRaw,
  removeAtIndex,
  textIdFromRaw,
  type SimpleListIdKind,
} from '@shared/simpleObjects';

import { useNames } from '../../hooks/useNames';
import type { NamesType } from '../../lib/display';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import RawIdAddControl from './RawIdAddControl';

/**
 * `ObjectIdMultiSelect` — **the one** searchable multi-select over a names table, rendered as
 * removable chips (plan task 4.3 / story p4-03 AC1, docs/spec-ui-design.md L479-482; carried to
 * task 4.6's text-keyed `DropTableNames`).
 *
 * There is no multi-select primitive among the vendored Radix components (D39), so this composes
 * one from `popover` + `command` (cmdk) + `badge`, in the same shape `FriendlyNameDropdown`
 * already uses for a single value — the same `useNames` cache, the same 50-option cap and its
 * truncation hint, and the same "a miss shows the raw value" fallback.
 *
 * ## One component, two id kinds (D71(i)) — what the generalisation cost
 *
 * It was born numeric (`items`, over a `readonly number[]`); task 4.6 needs the same UX over
 * **text** (`drop_tables` **names**). Rather than a second chips implementation, the value kind
 * is now a prop, `idKind`:
 *
 * - **`values`/`onChange` are generic** over `string | number`, so a numeric caller still gets
 *   `readonly number[]` in and `number[]` out — no `unknown` leaks into a form;
 * - **the picker's parse** is the kind's own conversion (`numberIdFromRaw` → the `ULong` helper,
 *   or `textIdFromRaw`), the one place the two kinds differ in what an option *means*;
 * - **the raw-id box** is the same shared `RawIdAddControl`, now kind-aware (a numeric id, or a
 *   name). It stays mounted for **both** kinds: the spec's own NpcDropTable example carries
 *   `WC-UNICORN-BONUS-001`, a name with no `drop_tables` row, and a removed name like it would
 *   otherwise be unreachable by search.
 * - **the search placeholder** reads `by name or id…` for the numeric kind and `by name…` for
 *   the text kind, where the value *is* the name.
 *
 * What did **not** change: membership semantics (an already-selected option is checked and
 * disabled, and `addToList` refuses a duplicate anyway), whole-array replacement, index-addressed
 * removal, the miss-safe chip label, and the read-only mode.
 *
 * ## The four things it deliberately keeps
 *
 * - **Search over names *and* ids.** The query goes through `useNames` → `filterNameOptions`,
 *   which matches on `"<label> <id>"`, so typing `Black` finds the item and typing `1001` finds
 *   it too (the same behaviour the single-value dropdown has). For a text-keyed table the label
 *   and the id are the same string, so one typed name is the only search there is.
 * - **The raw-value add box**, delegated to the shared `RawIdAddControl`: the name search cannot
 *   reach the corpus's genuinely unresolved values (42 of the 3,205 distinct `Inventory` ids have
 *   no `items.gid` row; the spec's `WC-UNICORN-BONUS-001` has no `drop_tables` row), so the box
 *   stays — and it is the only way to put back a miss the user removed.
 * - **Index-addressed removal.** 14 corpus `NpcInventory` files carry a duplicate value and
 *   `DropTableNames` may repeat a name; chips are keyed and removed by **index**, so clicking a
 *   chip removes that chip and the duplicates that already exist survive every unrelated edit.
 * - **A miss shows the raw value and invents nothing** (D60(c)/D63(c)): a chip whose value has no
 *   synced row renders the value itself, never a guessed or blank label. For a text list this is
 *   the normal path for a value outside the table.
 *
 * ## Multi-select semantics, and the read-only mode
 *
 * Adding keeps the popover **open** (that is what "multi" means here) and marks an
 * already-selected value with a check, disabled — so the picker cannot create a duplicate, and
 * `addToList` refuses one anyway (a no-op click never rewrites the array).
 *
 * In view mode the caller passes `disabled`: the chips still render (the same way p4-01's form
 * showed the inventory read-only) and the picker, the remove buttons and the raw-value box are
 * not mounted at all — so no control the user cannot use is left on screen.
 */
export interface ObjectIdMultiSelectProps<T extends string | number> {
  /** Which names table to search (`items`, `drop_tables`). */
  type: NamesType;
  /** The kind of value the list holds — see the module doc-comment. */
  idKind: SimpleListIdKind;
  /** The current list, in document order (duplicates preserved). */
  values: readonly T[];
  /** Receives the whole new list — the "replace the array whole" edit contract. */
  onChange: (next: T[]) => void;
  /** The noun the labels use (`item`, `drop table`): `Add drop table`, `drop table chips`. */
  noun: string;
  /** The empty-state sentence. */
  emptyText: string;
  /** The label of the raw-value box, e.g. `Add an item id` or `Add a drop table name`. */
  rawIdLabel: string;
  /** One line under the raw-value box — where a measured miss count belongs. */
  help?: string;
  /** A stable prefix for the controls' ids. */
  idPrefix: string;
  disabled?: boolean;
}

/**
 * The picker's option id as the stored value, in the list's own kind.
 *
 * The one place the two kinds differ in what an option *means*: a numeric option's id is an id
 * string that must become a JSON number through `ULong.toJson` (the one conversion), a text
 * option's id is already the value. `undefined` means "this option cannot be stored" and produces
 * no edit.
 */
function valueFromOptionId(
  idKind: SimpleListIdKind,
  optionId: string,
): string | number | undefined {
  return idKind === 'number' ? numberIdFromRaw(optionId) : textIdFromRaw(optionId);
}

/** The chip's text: the synced label, or the raw value when there is none (miss-safe). */
function chipLabel(
  value: string | number,
  labelFromList: (id: string) => string | undefined,
): string {
  return labelFromList(String(value)) ?? String(value);
}

export default function ObjectIdMultiSelect<T extends string | number>({
  type,
  idKind,
  values,
  onChange,
  noun,
  emptyText,
  rawIdLabel,
  help,
  idPrefix,
  disabled = false,
}: ObjectIdMultiSelectProps<T>): JSX.Element {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const names = useNames(type, search);
  const selected = new Set(values.map((value) => String(value)));

  function addValue(value: string | number): void {
    // The one assertion: `idKind` decided which parser ran, so `value` is a `T` — a fact the
    // generic signature holds on the outside and TypeScript cannot re-derive on the inside.
    const next = addToList(values, value as T);
    if (next.length !== values.length) {
      onChange(next);
    }
  }

  const picker = disabled ? null : (
    <div className="flex flex-col gap-2">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setSearch('');
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={open}
            aria-label={`Add ${noun}`}
            className="w-fit"
          >
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Add {noun}
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-[min(28rem,var(--radix-popover-trigger-width))] p-0">
          <Command shouldFilter={false}>
            <CommandInput
              autoFocus
              value={search}
              onValueChange={setSearch}
              placeholder={`Search ${type} by ${idKind === 'number' ? 'name or id' : 'name'}…`}
              aria-label={`Search ${type}`}
            />
            <CommandList>
              {names.isLoading ? (
                <div className="flex items-center gap-2 p-4 text-sm text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Loading {type}…
                </div>
              ) : null}

              {names.error === null ? null : (
                <div role="alert" className="p-4 text-sm text-red-400">
                  Could not load {type}: {names.error.message}
                </div>
              )}

              <CommandEmpty>No matches.</CommandEmpty>

              <CommandGroup>
                {names.options.map((option) => {
                  const already = selected.has(option.id);
                  return (
                    <CommandItem
                      key={option.id}
                      value={option.id}
                      disabled={already}
                      onSelect={() => {
                        const parsed = valueFromOptionId(idKind, option.id);
                        if (parsed !== undefined) {
                          addValue(parsed);
                        }
                      }}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4 shrink-0',
                          already ? 'opacity-100' : 'opacity-0',
                        )}
                        aria-hidden="true"
                      />
                      <span className="truncate">{option.label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>

            {names.hint === null ? null : (
              <div className="border-t border-zinc-800 px-3 py-2 text-xs text-zinc-400">
                {names.hint}
              </div>
            )}
          </Command>
        </PopoverContent>
      </Popover>

      {idKind === 'number' ? (
        <RawIdAddControl
          id={`${idPrefix}-raw-id`}
          idKind="number"
          label={rawIdLabel}
          {...(help === undefined ? {} : { help })}
          onAdd={addValue}
        />
      ) : (
        <RawIdAddControl
          id={`${idPrefix}-raw-id`}
          idKind="text"
          label={rawIdLabel}
          buttonLabel="Add name"
          {...(help === undefined ? {} : { help })}
          onAdd={addValue}
        />
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {values.length === 0 ? (
        <p className="text-xs text-zinc-500">{emptyText}</p>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label={`${noun} chips`}>
          {values.map((value, index) => {
            const label = chipLabel(value, names.labelFromList);
            return (
              <li key={`${String(value)}-${index}`}>
                <Badge variant="secondary" className="gap-1 font-normal" title={String(value)}>
                  {label}
                  {disabled ? null : (
                    <button
                      type="button"
                      // The position keeps the accessible name unique when a file carries the
                      // same value twice (14 NpcInventory files do), which strict locators need.
                      aria-label={`Remove ${label} (${index + 1})`}
                      className="rounded-sm text-zinc-400 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      onClick={() => onChange(removeAtIndex(values, index))}
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  )}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}

      {picker}
    </div>
  );
}
