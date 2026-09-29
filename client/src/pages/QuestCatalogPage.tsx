import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import CoverageHeader from '../components/quest/CoverageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { useIsMobile } from '../hooks/useIsMobile';
import {
  getQuestCoverage,
  listQuestCatalog,
  QUEST_COVERAGE_QUERY_KEY,
  questCatalogQueryKey,
  scaffoldQuest,
} from '../lib/api';
import {
  CATALOG_DEFINED_HEADER,
  CATALOG_EMPTY,
  CATALOG_EMPTY_ACTION,
  CATALOG_INFERRED_BADGE,
  CATALOG_LOADING,
  CATALOG_LOAD_ERROR,
  CATALOG_MISSING_ONLY_LABEL,
  CATALOG_NAME_HEADER,
  CATALOG_NO_MISSING,
  CATALOG_REFS_HEADER,
  CATALOG_SCAFFOLDING_LABEL,
  CATALOG_TITLE_HEADER,
  catalogRowAction,
  catalogTitleIsInferred,
  catalogTitleText,
  definedCellText,
  questEvidencePath,
  type CatalogFilter,
  type QuestCatalogRow,
} from '../lib/quest-catalog';
import { serverMessage } from '../lib/extract';

/**
 * Quest Catalog — `/quests/catalog` (task 6.10 / story **p6-11**;
 * [spec-ui-design.md](../../../docs/spec-ui-design.md) L639-679).
 *
 * The worklist over the catalog: the coverage header (the same component the Quests list page
 * mounts), the missing-only filter, one row per catalog quest, and the row's action.
 *
 * ## What is server-side and what is not
 *
 * - **The rows come from `GET /api/quests/catalog`**, and the missing-only filter is applied
 *   **in that request's SQL** (`has_definition = 0`). The page never filters the rows itself and
 *   never derives the numbers: `missing` is a column of the `coverage` view and the filter is a
 *   predicate over the catalog, so a second derivation could only disagree with them.
 * - The filter state is local because this page owns no other state; the **query** it produces
 *   comes from `catalogQuery` in `lib/quest-catalog.ts`, the pure builder the unit suite pins.
 *
 * ## The row's action (the spec's "entry point that makes the catalog a worklist")
 *
 * A quest with a file links into the **evidence panel** beside its editor
 * (`/quests/<name>?panel=evidence`, p6-08's entry point); a quest without one carries the
 * **scaffold** action (p6-09), which writes the real file and then opens that same editor. Both
 * are built by `catalogRowAction`, so a row's action and its `has_definition` cannot drift apart.
 *
 * ## The numbers are text (D85)
 *
 * The `Defined` cell renders the word from `definedCellText` (`defined` / `missing`) and the glyph
 * only decorates it (`aria-hidden`), the header sentence is a text node, and the filter is a
 * labelled checkbox — nothing on this page means something by colour alone.
 *
 * ## No pagination, deliberately
 *
 * The spec's Catalog view names no pager, and the worklist is meant to be read top-down
 * (most-gated first, the order the API returns). A pager would hide the thing the page exists to
 * show; the list is one page of rows by design.
 */
export default function QuestCatalogPage(): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [missingOnly, setMissingOnly] = useState(false);

  const filter: CatalogFilter = useMemo(() => ({ missingOnly }), [missingOnly]);

  const catalog = useQuery({
    queryKey: questCatalogQueryKey(missingOnly),
    queryFn: () => listQuestCatalog(filter),
  });

  /**
   * The same coverage read the header mounts (one query key, so this is a cache read, not a
   * second request). The page needs exactly one number from it — `nameable` — to tell the two
   * empty states apart: an **empty tier** needs a sync, while an empty *filtered* read means every
   * quest is already defined. Without it the filtered empty state would claim "nothing is missing"
   * about a catalog that has not been built at all.
   */
  const coverage = useQuery({
    queryKey: QUEST_COVERAGE_QUERY_KEY,
    queryFn: getQuestCoverage,
  });

  const scaffold = useMutation({
    mutationFn: (questName: string) => scaffoldQuest(questName),
    onSuccess: (result) => {
      // The new file changes both halves: `defined` moves when the sync flips `has_definition`,
      // and the row set changes as soon as the catalog is re-read. Invalidating both keeps the
      // header honest without the page recomputing anything (spec-api.md L438-441).
      void queryClient.invalidateQueries({ queryKey: QUEST_COVERAGE_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['quest-catalog'] });
      void queryClient.invalidateQueries({ queryKey: ['quests'] });
      // p6-09 wrote the file; this page opens the existing editor on it, evidence panel beside.
      navigate(questEvidencePath(result.quest_name));
    },
  });

  const rows = catalog.data?.quests ?? [];
  /**
   * An **empty tier** (no catalog rows at all: no sync yet) is a different page from a
   * **filter that matched nothing** — the first needs a sync, the second means every quest is
   * already defined. Only the coverage read can tell them apart, and it is the same cached value
   * the header shows, so the two surfaces cannot disagree in the same render.
   */
  const emptyTier = (coverage.data?.nameable ?? 0) === 0;
  const emptyMessage = emptyTier ? CATALOG_EMPTY : CATALOG_NO_MISSING;

  return (
    <div className="flex flex-col gap-4">
      <CoverageHeader />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label
          htmlFor="catalog-missing-only"
          className="inline-flex cursor-pointer items-center gap-2 text-sm text-zinc-200"
        >
          <input
            id="catalog-missing-only"
            type="checkbox"
            checked={missingOnly}
            onChange={(event) => setMissingOnly(event.target.checked)}
            className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 accent-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          />
          {CATALOG_MISSING_ONLY_LABEL}
        </label>
        <span className="text-xs text-zinc-400" data-testid="catalog-count">
          {catalog.data === undefined
            ? ''
            : `${catalog.data.total} ${missingOnly ? 'missing' : 'catalog rows'}`}
        </span>
      </div>

      {scaffold.isError ? (
        <p role="alert" className="text-sm text-red-400">
          {serverMessage(scaffold.error, CATALOG_LOAD_ERROR)}
        </p>
      ) : null}

      {catalog.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">{CATALOG_LOADING}</span>
          <Skeleton className="h-9 w-full" />
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : catalog.isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertTriangle className="h-10 w-10 text-amber-500" aria-hidden="true" />
            <p role="alert" className="text-sm text-zinc-200">
              {CATALOG_LOAD_ERROR}
            </p>
            <p className="text-sm text-zinc-400">
              {serverMessage(catalog.error, CATALOG_LOAD_ERROR)}
            </p>
            <Button variant="outline" onClick={() => void catalog.refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-zinc-200">{emptyMessage}</p>
            {/* The spec's empty state offers the same Sync action the settings page has — never a
                bare zero, and never a dead end. It belongs to the *tier* being empty, not to a
                filter that matched nothing. */}
            {emptyTier ? (
              <Button asChild variant="outline">
                <Link to="/settings">{CATALOG_EMPTY_ACTION}</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : isMobile ? (
        <ul aria-label="Quest catalog" className="flex flex-col gap-2" data-testid="catalog-cards">
          {rows.map((row) => (
            <li
              key={row.quest_name}
              className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3"
            >
              <span className="truncate font-mono text-sm text-zinc-100">{row.quest_name}</span>
              <span className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <span>{catalogTitleText(row)}</span>
                {catalogTitleIsInferred(row) ? (
                  <Badge variant="secondary">{CATALOG_INFERRED_BADGE}</Badge>
                ) : null}
                <DefinedCell row={row} />
                <span>
                  {CATALOG_REFS_HEADER} {row.reference_count}
                </span>
              </span>
              <RowAction
                row={row}
                pending={scaffold.isPending && scaffold.variables === row.quest_name}
                onScaffold={(name) => scaffold.mutate(name)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{CATALOG_NAME_HEADER}</TableHead>
                <TableHead>{CATALOG_TITLE_HEADER}</TableHead>
                <TableHead>{CATALOG_DEFINED_HEADER}</TableHead>
                <TableHead>{CATALOG_REFS_HEADER}</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.quest_name} data-testid={`catalog-row-${row.quest_name}`}>
                  <TableCell className="font-mono text-zinc-100">{row.quest_name}</TableCell>
                  <TableCell className="text-zinc-300">
                    <span className="inline-flex items-center gap-2">
                      {catalogTitleText(row)}
                      {catalogTitleIsInferred(row) ? (
                        <Badge variant="secondary">{CATALOG_INFERRED_BADGE}</Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell>
                    <DefinedCell row={row} />
                  </TableCell>
                  <TableCell className="text-zinc-300">{row.reference_count}</TableCell>
                  <TableCell className="text-right">
                    <RowAction
                      row={row}
                      pending={scaffold.isPending && scaffold.variables === row.quest_name}
                      onScaffold={(name) => scaffold.mutate(name)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/**
 * The `Defined` cell: a word, with the glyph as decoration (D85 — never colour-only, never a bare
 * tick). `Check`/`X` are `aria-hidden`, so a screen reader reads the text and not "check".
 *
 * Both glyphs use measured **text** colours (`emerald-400`, `zinc-400`) rather than a muted
 * `zinc-500`: the contrast audit treats every `text-*` token as text, and zinc-500 is documented
 * as failing the 4.5:1 floor on the dark surfaces. The glyph is decoration, but making it dodge
 * the audit instead of measuring it would be exactly the kind of unmeasured token D85 refuses.
 */
function DefinedCell({ row }: { row: QuestCatalogRow }): JSX.Element {
  const defined = row.has_definition === 1;
  const Icon = defined ? Check : X;
  return (
    <span
      className="inline-flex items-center gap-1 text-sm text-zinc-200"
      data-testid={`catalog-defined-${row.quest_name}`}
    >
      <Icon
        aria-hidden="true"
        className={defined ? 'h-4 w-4 text-emerald-400' : 'h-4 w-4 text-zinc-400'}
      />
      {definedCellText(row)}
    </span>
  );
}

/**
 * The row's action, from `catalogRowAction`: the evidence link for a defined quest, the scaffold
 * button for a missing one. The accessible name carries the quest's name (WCAG 2.5.3: it contains
 * the visible label), so a screen-reader user hears which row the action belongs to.
 */
function RowAction({
  row,
  pending,
  onScaffold,
}: {
  row: QuestCatalogRow;
  pending: boolean;
  onScaffold: (questName: string) => void;
}): JSX.Element {
  const action = catalogRowAction(row);
  if (action.kind === 'evidence') {
    return (
      <Button asChild variant="outline" size="sm">
        <Link to={action.to} aria-label={`${action.label} ${row.quest_name}`}>
          {action.label}
        </Link>
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      aria-label={`${action.label} ${row.quest_name}`}
      onClick={() => onScaffold(row.quest_name)}
    >
      {pending ? CATALOG_SCAFFOLDING_LABEL : action.label}
    </Button>
  );
}
