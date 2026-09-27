import { Check, Loader2, Plus, X } from 'lucide-react';
import { useState } from 'react';

import { addToList, numberIdFromRaw, removeAtIndex } from '@shared/simpleObjects';

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
 * removable chips (plan task 4.3 / story p4-03 AC1, docs/spec-ui-design.md L479-482).
 *
 * There is no multi-select primitive among the vendored Radix components (D39), so this composes
 * one from `popover` + `command` (cmdk) + `badge`, in the same shape `FriendlyNameDropdown`
 * already uses for a single value — the same `useNames` cache, the same 50-option cap and its
 * truncation hint, and the same "a miss shows the raw id" fallback. It is named **once** and used
 * once today (the NpcInventory `Inventory`); a second family that needs chips reuses this rather
 * than growing another (the story's named failure mode).
 *
 * ## The four things it deliberately keeps
 *
 * - **Search over item names *and* ids.** The query goes through `useNames` → `filterNameOptions`,
 *   which matches on `"<label> <id>"`, so typing `Black` finds the item and typing `1001` finds
 *   it too (the same behaviour the single-value dropdown has).
 * - **The raw-id add box**, delegated to the shared `RawIdAddControl`: the name search cannot
 *   reach the corpus's genuinely unresolved ids (42 of the 3,205 distinct `Inventory` values have
 *   no `items.gid` row) and p4-01's form could always type one, so the box stays — and it is the
 *   only way to put back a miss the user removed.
 * - **Index-addressed removal.** 14 corpus `NpcInventory` files carry a duplicate value; chips
 *   are keyed and removed by **index**, so clicking a chip removes that chip and the duplicates
 *   that already exist survive every unrelated edit.
 * - **A miss shows the raw id and invents nothing** (D60(c)/D63(c)): a chip whose id has no
 *   synced name renders the id, never a guessed or blank label.
 *
 * ## Multi-select semantics, and the read-only mode
 *
 * Adding keeps the popover **open** (that is what "multi" means here) and marks an
 * already-selected id with a check, disabled — so the picker cannot create a duplicate, and
 * `addToList` refuses one anyway (a no-op click never rewrites the array).
 *
 * In view mode the caller passes `disabled`: the chips still render (the same way p4-01's form
 * showed the inventory read-only) and the picker, the remove buttons and the raw-id box are not
 * mounted at all — so no control the user cannot use is left on screen.
 */
export interface ObjectIdMultiSelectProps {
  /** Which names table to search (`items`). */
  type: NamesType;
  /** The current list, in document order (duplicates preserved). */
  values: readonly number[];
  /** Receives the whole new list — the "replace the array whole" edit contract. */
  onChange: (next: number[]) => void;
  /** The noun the labels use (`item`): `Add item`, `Remove item (2)`, `item chips`. */
  noun: string;
  /** The empty-state sentence. */
  emptyText: string;
  /** The label of the raw-id box, e.g. `Add an item id`. */
  rawIdLabel: string;
  /** One line under the raw-id box — where the measured miss count belongs. */
  help?: string;
  /** A stable prefix for the controls' ids. */
  idPrefix: string;
  disabled?: boolean;
}

/** The chip's text: the synced name, or the raw id when there is none (miss-safe). */
function chipLabel(id: number, labelFromList: (id: string) => string | undefined): string {
  return labelFromList(String(id)) ?? String(id);
}

export default function ObjectIdMultiSelect({
  type,
  values,
  onChange,
  noun,
  emptyText,
  rawIdLabel,
  help,
  idPrefix,
  disabled = false,
}: ObjectIdMultiSelectProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const names = useNames(type, search);
  const selected = new Set(values.map((value) => String(value)));

  function addId(id: number): void {
    const next = addToList(values, id);
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
              placeholder={`Search ${type} by name or id…`}
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
                        const parsed = numberIdFromRaw(option.id);
                        if (parsed !== undefined) {
                          addId(parsed);
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

      <RawIdAddControl
        id={`${idPrefix}-raw-id`}
        label={rawIdLabel}
        {...(help === undefined ? {} : { help })}
        onAdd={addId}
      />
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
                      // same id twice (14 NpcInventory files do), which strict locators need.
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
