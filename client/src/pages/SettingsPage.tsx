import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, RefreshCw, Save, X } from 'lucide-react';
import { useState } from 'react';

import {
  getSettings,
  getSyncHistory,
  getSyncStatus,
  putSettings,
  SETTINGS_QUERY_KEY,
  SYNC_HISTORY_QUERY_KEY,
  SYNC_STATUS_QUERY_KEY,
  type SettingKey,
  type Settings,
} from '../lib/api';
import { notifyError, notifySuccess } from '../lib/notify';
import { formatHistoryCounts, formatLocalTimestamp, syncOutcome } from '../lib/sync-view';
import { settingsSaveErrorMessage, SETTINGS_SAVED_MESSAGE } from '../lib/toast';
import { useSync } from '../hooks/useSync';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';

/**
 * Sync Settings page — the one page this story actually builds
 * (docs/spec-ui-design.md L488-512, plan task 1.8, decision D39 item 9).
 *
 * Sections, in mockup order:
 *
 * 1. the three configured paths plus the user name, saved with one `PUT`;
 * 2. the Last Sync summary (timestamp, revision, counts) from
 *    `GET /api/sync/status` + the newest history row, with a graceful
 *    "Never synced" first-run state;
 * 3. Sync History (`GET /api/sync/history`) with local timestamps, a ✓/✗ status
 *    badge that carries text as well as colour, the counts, and the stored
 *    `error_message` for failed rows;
 * 4. **Sync Now** — the shared blocking `POST /api/sync` controller, spinner
 *    while it runs, then a success toast with the real returned counts.
 *
 * The mockup's `[Browse]` button is deliberately absent: a browser cannot pick a
 * server-side directory path, so faking one would be worse than omitting it
 * (recorded in the story report).
 */

/** The path/identity fields the page edits, in mockup order. */
const SETTINGS_FIELDS: ReadonlyArray<{ key: SettingKey; label: string; hint: string }> = [
  {
    key: 'aurorium_path',
    label: 'Aurorium Path',
    hint: 'Repository holding the WAD revisions under data/V_r*',
  },
  {
    key: 'imcodec_path',
    label: 'Imcodec Path',
    hint: 'The imcodec executable used to unpack and deserialize templates',
  },
  {
    key: 'spiraldb_path',
    label: 'SpiralDB Path',
    hint: 'Required by the settings API — the SpiralDB repository that sync writes into',
  },
];

export default function SettingsPage(): JSX.Element {
  const client = useQueryClient();
  const [edits, setEdits] = useState<Partial<Record<SettingKey, string>>>({});

  const settings = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: getSettings,
    staleTime: Infinity,
  });
  const syncStatus = useQuery({
    queryKey: SYNC_STATUS_QUERY_KEY,
    queryFn: getSyncStatus,
    staleTime: Infinity,
  });
  const history = useQuery({
    queryKey: SYNC_HISTORY_QUERY_KEY,
    queryFn: getSyncHistory,
    staleTime: Infinity,
  });

  const save = useMutation<Settings, Error, Partial<Settings>>({
    mutationFn: (patch) => putSettings(patch),
    onSuccess: (updated) => {
      client.setQueryData(SETTINGS_QUERY_KEY, updated);
      setEdits({});
      notifySuccess(SETTINGS_SAVED_MESSAGE);
    },
    onError: (error) => {
      notifyError(settingsSaveErrorMessage(error));
    },
  });

  const { sync, isPending: syncing, justSucceeded } = useSync();

  /** Current value for a field: the pending edit wins over the server value. */
  function valueFor(key: SettingKey): string {
    return edits[key] ?? settings.data?.[key] ?? '';
  }

  const dirty = Object.keys(edits).length > 0;
  const latest = history.data?.[0];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Friendly Name Sync</CardTitle>
          <CardDescription>
            Where the sync reads WAD data from and which repository it writes into. Paths are
            validated by the server before they are stored.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-4">
          {settings.isPending ? (
            <>
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </>
          ) : (
            SETTINGS_FIELDS.map((field) => (
              <div key={field.key} className="flex flex-col gap-1.5">
                <label htmlFor={field.key} className="text-sm font-medium text-zinc-300">
                  {field.label}
                </label>
                <Input
                  id={field.key}
                  name={field.key}
                  value={valueFor(field.key)}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={save.isPending}
                  onChange={(event) =>
                    setEdits((previous) => ({ ...previous, [field.key]: event.target.value }))
                  }
                />
                <p className="text-xs text-zinc-500">{field.hint}</p>
              </div>
            ))
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="user_name" className="text-sm font-medium text-zinc-300">
              User Name
            </label>
            <Input
              id="user_name"
              name="user_name"
              value={valueFor('user_name')}
              spellCheck={false}
              autoComplete="off"
              disabled={save.isPending}
              onChange={(event) =>
                setEdits((previous) => ({ ...previous, user_name: event.target.value }))
              }
            />
            <p className="text-xs text-zinc-500">
              Used to attribute status changes, metadata and commits.
            </p>
          </div>

          {settings.isError ? (
            <p role="alert" className="text-sm text-red-400">
              Could not load settings: {settings.error.message}
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button
              type="button"
              disabled={!dirty || save.isPending || settings.isPending}
              onClick={() => save.mutate(edits)}
            >
              {save.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Last Sync</CardTitle>
          <CardDescription>Friendly names are replaced wholesale by every sync.</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {syncStatus.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <dl className="grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-wide text-zinc-500">Last Sync</dt>
                <dd className="mt-1 text-sm text-zinc-200">
                  {formatLocalTimestamp(syncStatus.data?.last_sync ?? latest?.sync_timestamp)}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-zinc-500">Revision</dt>
                <dd className="mt-1 truncate font-mono text-sm text-zinc-200">
                  {syncStatus.data?.revision ?? latest?.revision ?? '—'}
                </dd>
              </div>
              <div className="sm:col-span-3">
                <dt className="text-xs uppercase tracking-wide text-zinc-500">Results</dt>
                <dd className="mt-1 text-sm text-zinc-200">
                  {latest === undefined ? 'Never synced' : formatHistoryCounts(latest)}
                </dd>
              </div>
            </dl>
          )}

          <div className="mt-5 flex items-center gap-3">
            <Button type="button" onClick={sync} disabled={syncing}>
              {syncing ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : justSucceeded ? (
                <Check className="h-4 w-4 text-emerald-400" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              )}
              {syncing ? 'Syncing…' : 'Sync Now'}
            </Button>
            <span className="text-xs text-zinc-500">
              A full sync unpacks the WAD and takes about 20 seconds.
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sync History</CardTitle>
          <CardDescription>
            Every run, newest first. Failures keep the server&apos;s message.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {history.isPending ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : history.isError ? (
            <p role="alert" className="text-sm text-red-400">
              Could not load sync history: {history.error.message}
            </p>
          ) : (history.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-zinc-400">
              Never synced — press <span className="text-zinc-200">Sync Now</span> to populate
              friendly names.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Counts</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(history.data ?? []).map((row) => {
                  const outcome = syncOutcome(row.status);
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap">
                        {formatLocalTimestamp(row.sync_timestamp)}
                        {row.revision === null ? null : (
                          <span className="mt-0.5 block font-mono text-xs text-zinc-500">
                            {row.revision}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={outcome.ok ? 'success' : 'destructive'}>
                          {outcome.ok ? (
                            <Check className="h-3 w-3" aria-hidden="true" />
                          ) : (
                            <X className="h-3 w-3" aria-hidden="true" />
                          )}
                          {outcome.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-zinc-300">{formatHistoryCounts(row)}</TableCell>
                      <TableCell className="text-zinc-400">{row.error_message ?? '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
