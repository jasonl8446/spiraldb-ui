import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';

import type { ObjectTypeConfig } from '@shared/objectTypes';

import ObjectDetailLayout from '../components/objects/ObjectDetailLayout';
import { FieldValidationProvider } from '../components/shared/FieldValidation';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { useQuestDocument, type QuestDocumentState } from '../hooks/useQuestDocument';
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
import { fieldHasError, type FieldValidationMessage } from '../lib/validation-message';

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
 * Four decisions worth knowing:
 *
 * - **The document model is the Phase-3 one** (`hooks/useQuestDocument.ts` over
 *   `lib/quest-edit.ts`: a loaded baseline, edits applied through `shared/document.ts`'s
 *   primitives, a **byte** dirty comparison — D58/D66). Nothing here re-implements "dirty";
 *   a new model would be the second document model D58 forbids. Story p4-02 replaced the
 *   p4-01 hand-rolled pair with the hook so the **shared editors' own mutation contract**
 *   (`has`/`value`/`edit`/`editAll`) reaches a form: `RequirementTreeEditor` needs it, and
 *   the DropTable form mounts that component inline.
 * - **The status defaults to `extracted`** when the family has no `entry_status` row
 *   (D49's rule, measured: `ZoneTransfer/` and `GlobalRegistry/` have none), so a
 *   detail page never renders a blank badge for an entry the list shows as extracted.
 * - **`displayKeyFor` canonicalises the route key** for the four `TemplateID`
 *   families through the one helper, so `/npc-inventories/01025` reads the same entry
 *   the list's `1025` links to.
 * - **`validate` is optional and additive**: a family with blocking rules (DropTable today)
 *   supplies one, and the page then publishes the messages through the shared
 *   `FieldValidationProvider` and disables Save while any of them is blocking. A family
 *   without one gets an empty message list and the p4-01 behaviour, unchanged.
 */
export interface ObjectFormProps {
  /** The live document (already narrowed to an object by the layout's model). */
  document: Record<string, unknown>;
  /** `view` renders the same fields read-only; `edit` renders the controls. */
  mode: 'view' | 'edit';
  /**
   * The live document state in the D58 shape the shared editors take
   * (`has`/`value`/`edit`/`editAll`) — what `RequirementTreeEditor` mounts on.
   */
  state: QuestDocumentState;
  /** The validation messages of the live document (`[]` when the family has no validator). */
  messages: readonly FieldValidationMessage[];
}

export interface ObjectDetailPageProps {
  config: ObjectTypeConfig;
  /** Plural noun used in copy (`NPC inventories`). */
  nounPlural: string;
  /** The Back link's text (`Back to NPC Inventories`). */
  backLabel: string;
  /** The type's form, rendered by `ObjectDetailLayout`. */
  renderForm: (props: ObjectFormProps) => ReactNode;
  /**
   * The family's blocking validation of the live document, run on every render of the
   * document (the shared engine, with the corpus injected by the page's own wrapper).
   * Omitted means the type has no rules and nothing is blocked.
   */
  validate?: (document: Record<string, unknown>) => readonly FieldValidationMessage[];
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
  validate,
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
      {...(validate === undefined ? {} : { validate })}
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
 * The loaded split: the document state, the mode toggle and the save mutation. It is
 * mounted only once the fetch has data, so the model's baseline is always a real
 * document (`loadDoc` throws on anything else, which is the contract that keeps "no
 * document yet" from becoming "an empty document").
 *
 * Story p4-02 replaced the local model with `useQuestDocument`, so the form receives the
 * D58 mutation contract itself (`has`/`value`/`edit`/`editAll`) rather than a `setAtPath`
 * shim — that is what lets a form mount `RequirementTreeEditor` inline with no adapter.
 */
function LoadedEntry({
  config,
  objectKey,
  source,
  status,
  backTo,
  backLabel,
  renderForm,
  validate,
}: {
  config: ObjectTypeConfig;
  objectKey: string;
  source: Record<string, unknown>;
  status: StatusValue | null;
  backTo: string;
  backLabel: string;
  renderForm: ObjectDetailPageProps['renderForm'];
  validate?: ObjectDetailPageProps['validate'];
}): JSX.Element {
  const client = useQueryClient();
  const state = useQuestDocument(source);
  const [mode, setMode] = useState<'view' | 'edit'>('view');

  const { dirty } = state;
  const document = state.doc as Record<string, unknown>;

  // The family's blocking rules, re-run whenever the document changes. `FieldValidation`'s
  // provider needs the findings for an unmounted valid path, so the whole message list is
  // memoized per document; `blocked` is the Save gate's own boolean.
  const messages = useMemo(
    () => (validate === undefined ? EMPTY_MESSAGES : validate(document)),
    [validate, document],
  );
  const blocked = useMemo(() => fieldHasError(messages), [messages]);

  const save = useMutation({
    mutationFn: () => saveObject(config, { object: document }),
    onSuccess: (result) => {
      state.markSaved();
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
      saveBlocked={blocked}
      blockReason={blockReason(messages)}
      document={document}
    >
      <FieldValidationProvider messages={messages}>
        {renderForm({ document, mode, state, messages })}
      </FieldValidationProvider>
    </ObjectDetailLayout>
  );
}

/** The one shared empty list — a stable reference so the memos above do not churn. */
const EMPTY_MESSAGES: readonly FieldValidationMessage[] = [];

/** The Save button's title while a blocking finding exists, or `undefined` when clean. */
function blockReason(messages: readonly FieldValidationMessage[]): string | undefined {
  const count = messages.filter((message) => message.severity === 'error').length;
  if (count === 0) {
    return undefined;
  }
  return `${count} validation ${count === 1 ? 'error blocks' : 'errors block'} saving — fix them first.`;
}
