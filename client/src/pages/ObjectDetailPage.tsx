import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';

import { setAtPath, type DocPath } from '@shared/document';
import type { ObjectTypeConfig } from '@shared/objectTypes';

import ObjectDetailLayout from '../components/objects/ObjectDetailLayout';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { getStatus, statusQueryKey, type StatusList, type StatusValue } from '../lib/api';
import { serverMessage } from '../lib/extract';
import { notifyError, notifySuccess, notifyWarning } from '../lib/notify';
import {
  displayKeyFor,
  getObject,
  objectDetailQueryKey,
  objectListQueryKey,
  objectListPath,
  saveObject,
  statusRouteTypeFor,
} from '../lib/objects';
import { isNotFoundError, questStatus } from '../lib/quests';
import {
  isQuestDocumentDirty,
  loadQuestDocument,
  markQuestDocumentSaved,
  type QuestDocumentModel,
} from '../lib/quest-edit';

/**
 * The generic object detail page — task 4.1.
 *
 * One implementation for the eight families: the document comes from
 * `GET /api/<type>/:key` (resolved server-side through the D19 content-keyed index,
 * so a legacy filename is reachable), the status from `GET /api/status/<route>` (the
 * Phase-1 endpoint that already covers all eight types, joined by the ulong text key
 * where the family has one), and the save goes through `POST /api/<type>` with the
 * layout's live document.
 *
 * Three decisions worth knowing:
 *
 * - **The document model is the Phase-3 one** (`lib/quest-edit.ts`: a loaded baseline,
 *   edits applied through `shared/document.ts`'s primitives, a **byte** dirty
 *   comparison — D58/D66). Nothing here re-implements "dirty"; a new model would be
 *   the second document model D58 forbids.
 * - **The status defaults to `extracted`** when the family has no `entry_status` row
 *   (D49's rule, measured: `ZoneTransfer/` and `GlobalRegistry/` have none), so a
 *   detail page never renders a blank badge for an entry the list shows as extracted.
 * - **`displayKeyFor` canonicalises the route key** for the four `TemplateID`
 *   families through the one helper, so `/npc-inventories/01025` reads the same entry
 *   the list's `1025` links to.
 */
export interface ObjectDetailPageProps {
  config: ObjectTypeConfig;
  /** Plural noun used in copy (`NPC inventories`). */
  nounPlural: string;
  /** The Back link's text (`Back to NPC Inventories`). */
  backLabel: string;
  /** The type's form, rendered by `ObjectDetailLayout`. */
  renderForm: (props: {
    document: Record<string, unknown>;
    mode: 'view' | 'edit';
    onSet: (path: DocPath, value: unknown) => void;
  }) => ReactNode;
}

/** The status joined to this entry, or `null` for a family with no lifecycle. */
function statusForEntry(
  entries: StatusList['entries'] | undefined,
  key: string,
  hasLifecycle: boolean,
): StatusValue | null {
  if (!hasLifecycle) {
    return null;
  }
  const row = entries?.find((entry) => entry.object_key === key);
  return questStatus(row === undefined ? undefined : { status: row.status });
}

export default function ObjectDetailPage({
  config,
  nounPlural,
  backLabel,
  renderForm,
}: ObjectDetailPageProps): JSX.Element {
  const params = useParams<{ id?: string; name?: string }>();
  const key = displayKeyFor(config, params.id ?? params.name ?? '');
  const routeType = statusRouteTypeFor(config);
  const backTo = objectListPath(config);

  const object = useQuery({
    queryKey: objectDetailQueryKey(config, key),
    queryFn: () => getObject(config, key),
    // A missing entry is not a transient failure (D49's 404 handling).
    retry: false,
    enabled: key !== '',
  });

  // Hooks are unconditional; the query is disabled for GlobalRegistry, which has no
  // lifecycle at all (Q1). The `'none'` key is never fetched.
  const status = useQuery({
    queryKey: routeType === undefined ? (['status', 'none'] as const) : statusQueryKey(routeType),
    queryFn: () => getStatus(routeType as NonNullable<typeof routeType>),
    enabled: routeType !== undefined,
    retry: false,
  });

  const loadError = `Could not load this ${nounPlural.replace(/s$/, '')}.`;

  if (key === '') {
    return (
      <NotFound
        backTo={backTo}
        backLabel={backLabel}
        title={`${config.label} entry not found`}
        detail="The route carried no key."
      />
    );
  }

  if (object.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-3">
        <span className="sr-only">Loading entry…</span>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (object.isError) {
    // `ApiError.status === 404` is the one failure that means "no such entry"; every
    // other failure keeps the server's own message and a retry (the quest detail's
    // three-state pattern, through the same shared predicate).
    if (isNotFoundError(object.error)) {
      return (
        <NotFound
          backTo={backTo}
          backLabel={backLabel}
          title={`${config.label} entry not found`}
          detail={serverMessage(object.error, `Unknown ${config.label} entry "${key}"`)}
        />
      );
    }
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertTriangle className="h-10 w-10 text-amber-500" aria-hidden="true" />
          <p role="alert" className="text-sm text-zinc-200">
            {loadError}
          </p>
          <p className="text-sm text-zinc-500">{serverMessage(object.error, loadError)}</p>
          <Button
            variant="outline"
            onClick={() => {
              void object.refetch();
            }}
          >
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <LoadedEntry
      // A different entry must remount: the document model's baseline is per document.
      key={key}
      config={config}
      objectKey={key}
      source={object.data}
      status={statusForEntry(status.data?.entries, key, routeType !== undefined)}
      backTo={backTo}
      backLabel={backLabel}
      renderForm={renderForm}
    />
  );
}

function NotFound({
  backTo,
  backLabel,
  title,
  detail,
}: {
  backTo: string;
  backLabel: string;
  title: string;
  detail: string;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <Link
        to={backTo}
        className="inline-flex items-center gap-1 text-sm text-zinc-400 transition-colors hover:text-zinc-100"
      >
        ← {backLabel}
      </Link>
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <h2 className="text-base font-medium text-zinc-100">{title}</h2>
          <p role="alert" className="text-sm text-zinc-400">
            {detail}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The loaded split: the document model, the mode toggle and the save mutation. It is
 * mounted only once the fetch has data, so the model's baseline is always a real
 * document (`loadQuestDocument` throws on anything else, which is the contract that
 * keeps "no document yet" from becoming "an empty document").
 */
function LoadedEntry({
  config,
  objectKey,
  source,
  status,
  backTo,
  backLabel,
  renderForm,
}: {
  config: ObjectTypeConfig;
  objectKey: string;
  source: Record<string, unknown>;
  status: StatusValue | null;
  backTo: string;
  backLabel: string;
  renderForm: ObjectDetailPageProps['renderForm'];
}): JSX.Element {
  const client = useQueryClient();
  const [model, setModel] = useState<QuestDocumentModel>(() => loadQuestDocument(source));
  const [mode, setMode] = useState<'view' | 'edit'>('view');

  const dirty = isQuestDocumentDirty(model);
  const document = model.doc as Record<string, unknown>;

  const save = useMutation({
    mutationFn: () => saveObject(config, { object: document }),
    onSuccess: (result) => {
      setModel((current) => markQuestDocumentSaved(current));
      setMode('view');
      notifySuccess(`Saved ${result.key} (${result.outcome}) — ${result.commit_message}`);
      void client.invalidateQueries({ queryKey: objectListQueryKey(config) });
      void client.invalidateQueries({ queryKey: objectDetailQueryKey(config, objectKey) });
      const route = statusRouteTypeFor(config);
      if (route !== undefined) {
        void client.invalidateQueries({ queryKey: statusQueryKey(route) });
      }
      for (const warning of result.warnings) {
        notifyWarning(warning);
      }
    },
    onError: (error) => {
      notifyError(serverMessage(error, `Could not save ${objectKey}.`));
    },
  });

  const onSet = useMemo(
    () =>
      (path: DocPath, value: unknown): void => {
        setModel((current) => ({
          baseline: current.baseline,
          doc: setAtPath(current.doc, path, value),
        }));
      },
    [],
  );

  return (
    <ObjectDetailLayout
      config={config}
      objectKey={objectKey}
      status={status}
      backTo={backTo}
      backLabel={backLabel}
      mode={mode}
      onEdit={() => setMode('edit')}
      onSave={() => save.mutate()}
      saving={save.isPending}
      dirty={dirty}
      document={document}
    >
      {renderForm({ document, mode, onSet })}
    </ObjectDetailLayout>
  );
}
