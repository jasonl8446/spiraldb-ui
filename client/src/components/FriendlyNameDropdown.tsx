import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { getName, nameLookupQueryKey } from '../lib/api';
import { formatNameValue, stringKeyPair, type NameRowMap, type NamesType } from '../lib/display';
import { selectedId, useNames } from '../hooks/useNames';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './ui/command';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

/**
 * `FriendlyNameDropdown` — every ID field in every editor renders through this
 * (AGENTS.md rule 5, plan task 1.8 / decision D8, formats per lead decision 5).
 *
 * Behaviour:
 *
 * - options come from `useNames(type)` (TanStack Query, `staleTime: Infinity`);
 *   the six small tables are filtered client-side in a cmdk combobox, capped at
 *   50 rendered options with an explicit "keep typing" hint;
 * - the **raw id** — never the label — goes to `onChange`, and is stored in a real
 *   `<input type="hidden" name={name}>` so plain HTML forms submit the id;
 * - the selected value's label is resolved from the cached list when possible and
 *   otherwise with one `GET /api/names/:type/:id` lookup; a miss (unknown id, or a
 *   `strings` key with no entry) renders the raw id and never an error
 *   (docs/spec-domain-reference.md L693-695);
 * - the trigger is a labelled button (`aria-expanded`, focus ring), so keyboard
 *   and screen-reader users get the same control (docs/spec-ui-design.md L540-550).
 */
export interface FriendlyNameDropdownProps {
  /** Which names table to search (`items`, `spells`, `npcs`, …). */
  type: NamesType;
  /** The selected raw id, or `''`/`null` when nothing is selected. */
  value: string | number | null;
  /** Receives the raw id string (or `''` when cleared). */
  onChange: (rawId: string) => void;
  /** Hidden input name — the form field carrying the raw id. */
  name: string;
  /**
   * Offer an explicit "None" entry that clears the selection (`onChange('')`).
   *
   * The option's text is {@link emptyLabel}, so a caller whose domain spells the empty value
   * differently can say so — story p4-03's `NPCSpellEntry.RequiredSpellID` is the case that
   * needed it: its `0` means "no prerequisite" and the AC requires the option to read
   * **`none (0)`** while the stored value stays `0`, so that form passes `emptyLabel` and maps
   * `''` back to `0` itself.
   */
  allowEmpty?: boolean;
  /** The clear option's text; `'None'` by default (unchanged for every existing caller). */
  emptyLabel?: string;
  disabled?: boolean;
  /** Accessible label for the combobox trigger. Defaults to `Select <type>`. */
  'aria-label'?: string;
  /** Shown on the trigger while nothing is selected. */
  placeholder?: string;
  /**
   * Marks the control invalid for validation (story p3-09): a red trigger border and
   * `aria-invalid`, so an unlisted id the validation engine warned about is visible on the
   * control itself ([spec-domain-reference.md] L547's red border). Purely presentational —
   * the editor still writes and keeps the raw id.
   */
  invalid?: boolean;
  /**
   * Restrict a `strings` picker to one string-table category (D186) — `QuestTitle` for the quest
   * title. Switches the list to server-side search with no minimum query.
   */
  category?: string;
  /** Plural friendly noun for the popover's own text (`quest titles`); defaults to the type name. */
  noun?: string;
  /** Lets a `<label htmlFor>` name and focus the combobox trigger. */
  id?: string;
  'aria-describedby'?: string;
  className?: string;
}

export default function FriendlyNameDropdown({
  type,
  value,
  onChange,
  name,
  allowEmpty = false,
  emptyLabel = 'None',
  disabled = false,
  'aria-label': ariaLabel,
  placeholder,
  invalid = false,
  category,
  noun,
  id: triggerId,
  'aria-describedby': describedBy,
  className,
}: FriendlyNameDropdownProps): JSX.Element {
  const what = noun ?? type;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const id = selectedId(value);
  const names = useNames(type, search, { category, enabled: open });
  const fromList = id === '' ? undefined : names.labelFromList(id);

  // One lookup only when the id is genuinely not in the cached list (or the list
  // is a `strings` search that has not run yet). 404 → `retry: false` → the raw id.
  const lookup = useQuery({
    queryKey: nameLookupQueryKey(type, id),
    queryFn: () => getName(type, id),
    enabled:
      id !== '' && fromList === undefined && (names.isBulk ? !names.isLoading : !names.needsQuery),
    staleTime: Infinity,
    retry: false,
  });

  const label = useMemo(() => {
    if (id === '') {
      return '';
    }
    if (fromList !== undefined) {
      return fromList;
    }
    if (lookup.data !== undefined) {
      return category !== undefined && type === 'strings'
        ? stringKeyPair(lookup.data as NameRowMap['strings'])
        : formatNameValue(type, id, lookup.data);
    }
    return id;
  }, [category, fromList, id, lookup.data, type]);

  const shown = label === '' ? (placeholder ?? `Select ${what}…`) : label;
  const isPlaceholder = label === '';

  function select(rawId: string): void {
    onChange(rawId);
    setOpen(false);
    setSearch('');
  }

  return (
    <div className={cn('w-full', className)}>
      {/* AGENTS.md rule 5: the raw ID lives in a real form field. */}
      <input type="hidden" name={name} value={id} readOnly />

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
            id={triggerId}
            role="combobox"
            aria-expanded={open}
            aria-describedby={describedBy}
            aria-label={ariaLabel ?? `Select ${what}`}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            className={cn(
              'w-full justify-between font-normal',
              isPlaceholder && 'text-zinc-400',
              invalid && 'border-red-500',
            )}
          >
            <span className="truncate">{shown}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-[min(28rem,var(--radix-popover-trigger-width))] p-0">
          <Command shouldFilter={false}>
            <CommandInput
              autoFocus
              value={search}
              onValueChange={setSearch}
              placeholder={`Search ${what}…`}
              aria-label={`Search ${what}`}
            />
            <CommandList>
              {names.isLoading ? (
                <div className="flex items-center gap-2 p-4 text-sm text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Loading {what}…
                </div>
              ) : null}

              {names.error !== null ? (
                <div role="alert" className="p-4 text-sm text-red-400">
                  Could not load {what}: {names.error.message}
                </div>
              ) : null}

              {names.needsQuery ? (
                <div className="p-4 text-sm text-zinc-400">
                  Type at least 2 characters to search {what}.
                </div>
              ) : null}

              <CommandEmpty>No matches.</CommandEmpty>

              <CommandGroup>
                {allowEmpty ? (
                  <CommandItem value="__none__" onSelect={() => select('')}>
                    <Check
                      className={cn('mr-2 h-4 w-4', id === '' ? 'opacity-100' : 'opacity-0')}
                      aria-hidden="true"
                    />
                    {emptyLabel}
                  </CommandItem>
                ) : null}
                {names.options.map((option) => (
                  <CommandItem key={option.id} value={option.id} onSelect={() => select(option.id)}>
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4 shrink-0',
                        option.id === id ? 'opacity-100' : 'opacity-0',
                      )}
                      aria-hidden="true"
                    />
                    <span className="truncate">{option.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>

            {names.hint !== null ? (
              <div className="border-t border-zinc-800 px-3 py-2 text-xs text-zinc-400">
                {names.hint}
              </div>
            ) : null}
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
