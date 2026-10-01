import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import type { ObjectFileType } from '@shared/naming';
import { objectTypeConfig } from '@shared/objectTypes';

import TermHelp from '../components/TermHelp';
import TermLabel from '../components/TermLabel';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { getNpc, npcQueryKey, type NpcView, type NpcViewInventoryRow } from '../lib/api';
import { serverMessage } from '../lib/extract';
import { objectDetailPath } from '../lib/objects';

/**
 * `/npcs/:npcId` (task 7.14, D112/D144) — one NPC over the existing `GET /api/npcs/:id`, with no
 * new API: its aliases, personas, dialogs, quests and inventories, each section headed by the
 * `counts` the endpoint computed from the arms it returned. The id is either form the endpoint
 * accepts, and the header echoes both the alias key and the template id.
 *
 * The page reached from a search row (`searchResultHref`) or from a resolved speaker name in the
 * Evidence panel; it has no nav item. An arm the server could not populate is explained by the
 * endpoint's `notes` and shown, never rendered as a bare "none".
 */

const INVENTORY_FAMILIES = [
  {
    arm: 'npc_inventories',
    fileType: 'npcinventory',
    label: 'NPC Inventories',
    testId: 'npc-inventory-list',
  },
  {
    arm: 'npc_spell_inventories',
    fileType: 'npcspellinventory',
    label: 'Spell Inventories',
    testId: 'npc-spell-inventory-list',
  },
  {
    arm: 'npc_drop_tables',
    fileType: 'npcdroptable',
    label: 'Drop Tables',
    testId: 'npc-drop-table-list',
  },
] as const satisfies ReadonlyArray<{
  arm: keyof NpcView['inventories'];
  fileType: ObjectFileType;
  label: string;
  testId: string;
}>;

export default function NpcPage(): JSX.Element {
  const { npcId = '' } = useParams<{ npcId: string }>();
  const npc = useQuery({ queryKey: npcQueryKey(npcId), queryFn: () => getNpc(npcId) });

  if (npc.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-3">
        <span className="sr-only">Loading NPC…</span>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (npc.isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertTriangle className="h-10 w-10 text-amber-500" aria-hidden="true" />
          <p role="alert" className="text-sm text-zinc-200" data-testid="npc-error">
            {serverMessage(npc.error, 'Could not load this NPC.')}
          </p>
          <Button variant="outline" onClick={() => void npc.refetch()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }
  return <NpcBody view={npc.data} />;
}

function NpcBody({ view }: { view: NpcView }): JSX.Element {
  const inventoryTotal = INVENTORY_FAMILIES.reduce(
    (sum, family) => sum + view.inventories[family.arm].length,
    0,
  );
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="npc-page">
      <header className="flex min-w-0 flex-col gap-1">
        <h2 className="break-words text-xl font-semibold text-zinc-50" data-testid="npc-name">
          {view.display_name}
        </h2>
        <p className="text-xs text-zinc-400">
          <span className="select-text break-all font-mono">{view.npc_key}</span>
          {view.template_id === null ? null : (
            <>
              {' · template id '}
              <span className="select-text font-mono">{view.template_id}</span>
            </>
          )}
        </p>
      </header>

      <Section title="Aliases" count={view.counts.aliases} testId="npc-aliases">
        {view.aliases.length === 0 ? (
          <Empty>No other names are recorded for this NPC.</Empty>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {view.aliases.map((alias) => (
              <li
                key={alias}
                data-testid="npc-alias"
                className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-zinc-100"
              >
                {alias}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid min-w-0 gap-4 md:grid-cols-3">
        <Section
          title={
            <span className="inline-flex items-center gap-1">
              Personas
              <TermHelp term={{ field: 'm_personaName' }} />
            </span>
          }
          count={view.counts.personas}
          testId="npc-personas"
        >
          {view.personas.length === 0 ? (
            <Empty>No persona resolves to this NPC.</Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {view.personas.map((persona) => (
                <li key={persona.persona_key} data-testid="npc-persona" className="min-w-0">
                  <p className="text-sm text-zinc-100">
                    {[persona.first, persona.last].filter(Boolean).join(' ') || 'No name parts'}
                  </p>
                  <p className="text-xs text-zinc-400">
                    <TermLabel term={{ field: 'm_personaName' }} />:{' '}
                    <span className="select-text break-all font-mono">{persona.persona_key}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Dialogs" count={view.counts.dialogs} testId="npc-dialogs">
          {view.dialogs.length === 0 ? (
            <Empty>This NPC speaks no dialogue in the corpus.</Empty>
          ) : (
            <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto">
              {view.dialogs.map((dialog) => (
                <li
                  key={`${dialog.quest_name}#${dialog.index}`}
                  data-testid="npc-dialog"
                  className="min-w-0"
                >
                  <Link
                    to={`/quests/${encodeURIComponent(dialog.quest_name)}`}
                    className={LINK_CLASS}
                  >
                    {dialog.quest_name}
                  </Link>
                  <span className="text-xs text-zinc-400"> · line {dialog.index + 1}</span>
                  <p className="break-words text-sm text-zinc-200">
                    {dialog.text === null ? 'No text resolves for this line.' : dialog.text}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Quests" count={view.counts.quests} testId="npc-quests">
          {view.quests.length === 0 ? (
            <Empty>No quest file mentions this NPC.</Empty>
          ) : (
            <ul className="flex flex-col gap-1">
              {view.quests.map((quest) => (
                <li key={quest} data-testid="npc-quest" className="min-w-0">
                  <Link to={`/quests/${encodeURIComponent(quest)}`} className={LINK_CLASS}>
                    {quest}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="Inventories" count={inventoryTotal} testId="npc-inventories">
        <div className="grid min-w-0 gap-4 md:grid-cols-3">
          {INVENTORY_FAMILIES.map((family) => (
            <InventoryList
              key={family.arm}
              label={family.label}
              testId={family.testId}
              fileType={family.fileType}
              rows={view.inventories[family.arm]}
            />
          ))}
        </div>
      </Section>

      {view.notes.length === 0 ? null : (
        <ul className="flex flex-col gap-1 text-xs text-zinc-400" data-testid="npc-notes">
          {view.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const LINK_CLASS =
  'select-text break-all font-mono text-sm text-zinc-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

function Section({
  title,
  count,
  testId,
  children,
}: {
  title: React.ReactNode;
  count: number;
  testId: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section
      aria-labelledby={`${testId}-heading`}
      data-testid={testId}
      className="flex min-w-0 flex-col gap-2 rounded-md border border-zinc-800 bg-zinc-900 p-3"
    >
      <h3 id={`${testId}-heading`} className="text-sm font-medium text-zinc-50">
        {title} (<span data-testid={`${testId}-count`}>{count}</span>)
      </h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }): JSX.Element {
  return <p className="text-sm text-zinc-300">{children}</p>;
}

function InventoryList({
  label,
  testId,
  fileType,
  rows,
}: {
  label: string;
  testId: string;
  fileType: ObjectFileType;
  rows: NpcViewInventoryRow[];
}): JSX.Element {
  const config = objectTypeConfig(fileType);
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid={testId}>
      <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-300">
        {label} (<span data-testid={`${testId}-count`}>{rows.length}</span>)
      </h4>
      {rows.length === 0 ? (
        <Empty>None for this NPC.</Empty>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li key={row.key} data-testid={`${testId}-row`} className="min-w-0">
              <Link to={objectDetailPath(config, row.key)} className={LINK_CLASS}>
                {row.key}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
