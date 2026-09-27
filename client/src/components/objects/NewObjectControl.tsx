import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { ObjectTypeConfig } from '@shared/objectTypes';
import { ObjectCreateError, buildCreateDocument, objectCreateSpec } from '@shared/objectCreate';
import { createObjectBody } from '@shared/objectSave';

import { serverMessage } from '../../lib/extract';
import { notifyError, notifySuccess } from '../../lib/notify';
import { objectSingularNoun } from '../../lib/object-list';
import {
  objectDetailPath,
  objectListQueryKey,
  saveObject,
  type ObjectSaveResult,
} from '../../lib/objects';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';

/**
 * `NewObjectControl` — the **one** create affordance for the seven tracked object families
 * (plan task 4.11 / story p4-09, AC3; D71(i) "one widget, not seven", D76(a)).
 *
 * Mounted on every family's list page (`ObjectListPage`), it renders a labelled button
 * (`New drop table`, `New NPC inventory`, `New zone transfer`, …) that opens a minimal create
 * dialog: the family's **key control** plus a disclosure of the literal values the create writes
 * (`shared/objectCreate.ts` owns both). Submitting POSTs the document through the family's real
 * route — `saveObject`, the same `POST /api/<type>` the detail page's Save uses — so a create has
 * exactly one wire path.
 *
 * ## The accessible-name vocabulary (spelled out because the AC asks for it)
 *
 * | element | accessible name |
 * |---|---|
 * | the button | `New <singular>` — `New drop table`, `New NPC inventory`, `New NPC spell inventory`, `New creature spellbook`, `New NPC drop table`, `New treasure card inventory`, `New zone transfer` |
 * | the dialog | `role="dialog"`, labelled by its `DialogTitle`: the same `New <singular>` |
 * | the key input | the family's `keyLabel` from `shared/objectCreate.ts` (`Drop table name`, `NPC TemplateID`, `Deck name`, `Zone name`) |
 * | the file-name preview | `Will create <file name>` — the exact `fileNameFor` output |
 * | the defaults disclosure | `Written on create` with one `<li>` per key/value |
 * | the submit button | `Create` (and `Creating…` while in flight) |
 *
 * ## Only the key is asked for, and why that is honest
 *
 * The seven families' documents are a key plus one list, and a DropTable's non-key fields all have
 * spec defaults — so the create writes the key and the named defaults and the user fills a list on
 * the entry's own form. The defaults are **shown** in the dialog rather than written invisibly,
 * and the file-name preview comes from `fileNameFor`, so the D26 singular `droptable_` and the
 * zone `/`→`_` transform are what the user sees before committing.
 *
 * ## `key` is deliberately absent from the POST body
 *
 * `body.key` exists for the *update* path: it is the entry the user opened, which the DropTable
 * duplicate rule forgives (D70(b), D76(a)). A create has no such entry, so omitting it means the
 * server's duplicate rule fires on a name the corpus already holds — a 400 the dialog surfaces
 * inline — and the pipeline's index decides create-vs-update (a name that exists would be an
 * update, which this control refuses to pretend is a create).
 */
export interface NewObjectControlProps {
  /** One row of `shared/objectTypes.ts`. */
  config: ObjectTypeConfig;
  /** Plural noun used in copy (`NPC inventories`) — the singular is derived from it. */
  nounPlural: string;
}

export default function NewObjectControl({
  config,
  nounPlural,
}: NewObjectControlProps): JSX.Element {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [rawKey, setRawKey] = useState('');

  const noun = objectSingularNoun(nounPlural);
  const spec = useMemo(() => objectCreateSpec(config.fileType), [config.fileType]);

  // The preview and the inline error are one computation: a key that cannot become a file name
  // cannot be created, and the message is the same one the server-side builder would raise.
  const built = useMemo<
    { ok: true; fileName: string; document: Record<string, unknown> } | { ok: false; error: string }
  >(() => {
    if (rawKey === '') {
      return { ok: false, error: `${spec.keyLabel} is required.` };
    }
    try {
      const result = buildCreateDocument(config, rawKey);
      return { ok: true, fileName: result.fileName, document: result.document };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof ObjectCreateError ? error.message : String(error),
      };
    }
  }, [config, rawKey, spec.keyLabel]);

  const create = useMutation({
    mutationFn: () => {
      if (!built.ok) {
        throw new Error(built.error);
      }
      // The client's own body, from its one home (`shared/objectSave.ts`): `{ object }` and
      // nothing else — see the doc-comment on why a create carries no `key`.
      return saveObject(config, createObjectBody(built.document));
    },
    onSuccess: (result: ObjectSaveResult) => {
      setOpen(false);
      setRawKey('');
      notifySuccess(`Created ${result.key} — ${result.commit_message}`);
      void client.invalidateQueries({ queryKey: objectListQueryKey(config) });
      navigate(objectDetailPath(config, result.key));
    },
    onError: (error) => {
      notifyError(serverMessage(error, `Could not create this ${noun}.`));
    },
  });

  const submit = (): void => {
    if (built.ok && !create.isPending) {
      create.mutate();
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="default"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        New {noun}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setRawKey('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New {noun}</DialogTitle>
            <DialogDescription>
              The entry is created through {config.urlPath}, committed as{' '}
              <code className="font-mono text-xs">
                spiraldb: create {config.objectType ?? config.fileType} &lt;key&gt;
              </code>{' '}
              and tracked as <code className="font-mono text-xs">extracted</code> with the note{' '}
              <code className="font-mono text-xs">Created via UI</code>.
            </DialogDescription>
          </DialogHeader>

          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="flex flex-col gap-1">
              <label className="text-xs text-zinc-400" htmlFor={`${config.fileType}-new-key`}>
                {spec.keyLabel}
              </label>
              <Input
                id={`${config.fileType}-new-key`}
                aria-label={spec.keyLabel}
                className="font-mono"
                autoFocus
                value={rawKey}
                placeholder={spec.keyPlaceholder}
                onChange={(event) => setRawKey(event.target.value)}
                aria-invalid={!built.ok && rawKey !== ''}
                aria-describedby={`${config.fileType}-new-key-help`}
              />
              <p id={`${config.fileType}-new-key-help`} className="text-xs text-zinc-400">
                {spec.keyHelp}
              </p>
            </div>

            {built.ok ? (
              <p className="text-xs text-zinc-300">
                Will create <span className="font-mono">{built.fileName}</span>
              </p>
            ) : (
              <p role="alert" className="text-xs text-amber-500">
                {built.error}
              </p>
            )}

            <details className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2">
              <summary className="cursor-pointer text-xs text-zinc-400">Written on create</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {spec.defaults.map((field) => (
                  <li key={field.key} className="font-mono text-xs text-zinc-400">
                    {field.key}: {JSON.stringify(field.value)}
                    <span className="ml-2 font-sans text-zinc-400">{field.note}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-zinc-400">{spec.defaultsNote}</p>
            </details>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setOpen(false);
                  setRawKey('');
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!built.ok || create.isPending}>
                {create.isPending ? 'Creating…' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
