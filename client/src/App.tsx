import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';

import { objectTypeConfig } from '@shared/objectTypes';

import AppLayout from './components/layout/AppLayout';
import CreatureSpellbookForm from './components/objects/CreatureSpellbookForm';
import NpcDropTableForm from './components/objects/NpcDropTableForm';
import NpcInventoryForm from './components/objects/NpcInventoryForm';
import NpcSpellInventoryForm from './components/objects/NpcSpellInventoryForm';
import ZoneTransferForm from './components/objects/ZoneTransferForm';
import DropTableDetailPage from './pages/DropTableDetailPage';
import DashboardPage from './pages/DashboardPage';
import ObjectDetailPage from './pages/ObjectDetailPage';
import ObjectListPage from './components/objects/ObjectListPage';
import NotFoundPage from './pages/NotFoundPage';
import ExtractionPage from './pages/ExtractionPage';
import GlobalRegistryPage from './pages/GlobalRegistryPage';
import QuestDetailPage from './pages/QuestDetailPage';
import QuestCatalogPage from './pages/QuestCatalogPage';
import DraftsPage from './pages/DraftsPage';
import GlossaryPage from './pages/GlossaryPage';
import NpcPage from './pages/NpcPage';
import DraftEditorPage from './pages/DraftEditorPage';
import QuestsPage from './pages/QuestsPage';
import SettingsPage from './pages/SettingsPage';
import TreasureCardInventoryDetailPage from './pages/TreasureCardInventoryDetailPage';
import { UserNameGateProvider } from './hooks/useUserNameGate';
import { APP_ROUTES, type AppRoute } from './lib/routes';
import { validateZoneTransferDocument } from './lib/zone-transfer-validation';
import {
  TOASTER_CLASS_NAMES,
  TOASTER_CLOSE_BUTTON,
  TOASTER_POSITION,
  TOASTER_THEME,
  TOASTER_VISIBLE_TOASTS,
} from './lib/toast';

/**
 * The application shell (task 1.8 — this file replaces the task-1.1 placeholder
 * and removes its temporary diagnostic surface, keeping the pieces task 1.7 made
 * durable: `UserNameGateProvider`, `UserNameDialog` and `lib/api.ts`).
 *
 * Routing is generated from the `APP_ROUTES` table, so the spec-api route list has
 * exactly one home and cannot drift from the sidebar: **every one of its 20 routes
 * renders a real page** (the last stub fell in story p5-01), and story p5-08 deleted
 * `StubPage` and pointed the table's unreachable `default:` arm at the real 404 page
 * (see `elementFor` below).
 *
 * Task 4.1 wired **one** of the eight object families end to end (NpcInventory) so
 * the generic scaffolding is provably used; story p4-02 added the second
 * (DropTable, whose form mounts the shared requirement tree inline and whose route
 * is driven by its own page so the duplicate-name rule can inject the corpus); story
 * p4-03 added the third and fourth (NpcSpellInventory and CreatureSpellbook, both
 * plain `ObjectDetailPage` + form pairs); story p4-04 added the fifth (NpcDropTable,
 * whose list page is the family with a genuinely absent directory); story p4-05 added
 * the sixth (TreasureCardInventory, whose detail route is its own page so the
 * warn-not-block rule can inject the synced `spells` names); story p4-06 added the
 * seventh (ZoneTransfer, whose one rule consults no synced table and so renders inline
 * through the generic page); story p4-07 added the **eighth and last** (GlobalRegistry,
 * whose single route *is* the editor — docs/spec-api.md L474, no list and no detail
 * route — because the family is one merged dictionary; it is also the only page that
 * passes `editable`, since the registry has no `entry_status` row yet its document is
 * exactly what the editor edits). All
 * eight Phase-4 families are now built; both
 * route paths and the config rows come from `shared/objectTypes.ts`, so a page and
 * the API path the server mounts cannot disagree.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A local single-user tool: refetching on every window focus is noise, and
      // a failed request is retried once so a stale error toast still appears fast.
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/**
 * The page a route renders.
 *
 * Built pages are listed explicitly by path — the `phase` in `APP_ROUTES` is the
 * phase that *owns* the page, not a switch — and every path in the table has its own
 * branch, so the `default:` arm is unreachable in practice and exists only because a
 * `switch` on a `string` cannot be proved exhaustive to the type checker. It renders
 * the shell's real **not-found** page and nothing else: story p5-08 deleted the
 * "Arrives in Phase N" stub (and the `SharedComponentsPreview` panel it mounted), since
 * with all 20 routes real it was reachable from no route at all — a stale stub is a
 * false affordance. `tests/unit/ui-shell.test.ts` still pins the route table, and
 * `tests/ui/shell.spec.ts` asserts the absence of the stub's text on every page.
 *
 * `/quests/extract` is listed before `/quests/:questName` in `APP_ROUTES` and the
 * router ranks the static path higher regardless, so the detail route can never
 * shadow the extraction page.
 */
const NPC_INVENTORY = objectTypeConfig('npcinventory');
const NPC_SPELL_INVENTORY = objectTypeConfig('npcspellinventory');
const CREATURE_SPELLBOOK = objectTypeConfig('creaturespellbook');
const NPC_DROP_TABLE = objectTypeConfig('npcdroptable');
const TREASURE_CARD_INVENTORY = objectTypeConfig('treasurecardinventory');
const ZONE_TRANSFER = objectTypeConfig('zonetransfer');
const DROP_TABLE = objectTypeConfig('droptable');

function elementFor(route: AppRoute): JSX.Element {
  switch (route.path) {
    case '/':
      // Story p5-01 replaced the `/` stub with the real dashboard (plan task 5.1): the
      // four stat cards, the per-type progress and the activity feed, from
      // `GET /api/dashboard` + `GET /api/activity`.
      return <DashboardPage />;
    case '/settings':
      return <SettingsPage />;
    case '/quests/extract':
      return <ExtractionPage />;
    case '/quests':
      return <QuestsPage />;
    case '/quests/catalog':
      // Task 6.10 / story p6-11: the worklist over the catalog. Its own route — matched
      // before `/quests/:questName` by the static-before-dynamic rule in `lib/routes.ts`.
      return <QuestCatalogPage />;
    case '/quests/:questName':
      return <QuestDetailPage />;
    case '/drafts':
      // Task 7.7 / story p7-08: the draft review queue.
      return <DraftsPage />;
    case '/glossary':
      // Task 7.12 / story p7-13: every glossary term, searchable by either half.
      return <GlossaryPage />;
    case '/npcs/:npcId':
      // Task 7.14 / story p7-15: one NPC's aliases, personas, dialogs, quests and inventories.
      return <NpcPage />;
    case '/drafts/quest/:questName':
    case '/drafts/id/:questId':
      return <DraftEditorPage />;
    case '/drop-tables':
      return <ObjectListPage config={DROP_TABLE} nounPlural="drop tables" keyHeader="Drop table" />;
    case '/drop-tables/:name':
      // Story p4-02: the form is `DropTableForm`, but the route is driven by its own page so
      // the duplicate-name rule can inject the corpus (a hook cannot live in a render prop).
      return <DropTableDetailPage />;
    case '/npc-inventories':
      return <ObjectListPage config={NPC_INVENTORY} nounPlural="NPC inventories" keyHeader="NPC" />;
    case '/npc-inventories/:id':
      return (
        <ObjectDetailPage
          config={NPC_INVENTORY}
          nounPlural="NPC inventories"
          backLabel="Back to NPC Inventories"
          renderForm={({ document, mode, state }) => (
            <NpcInventoryForm document={document} mode={mode} state={state} />
          )}
        />
      );
    case '/npc-spell-inventories':
      return (
        <ObjectListPage
          config={NPC_SPELL_INVENTORY}
          nounPlural="NPC spell inventories"
          keyHeader="NPC"
        />
      );
    case '/npc-spell-inventories/:id':
      return (
        <ObjectDetailPage
          config={NPC_SPELL_INVENTORY}
          nounPlural="NPC spell inventories"
          backLabel="Back to NPC Spell Inventories"
          renderForm={({ document, mode, state }) => (
            <NpcSpellInventoryForm document={document} mode={mode} state={state} />
          )}
        />
      );
    case '/creature-spellbooks':
      return (
        <ObjectListPage
          config={CREATURE_SPELLBOOK}
          nounPlural="creature spellbooks"
          keyHeader="Deck name"
        />
      );
    case '/creature-spellbooks/:name':
      return (
        <ObjectDetailPage
          config={CREATURE_SPELLBOOK}
          nounPlural="creature spellbooks"
          backLabel="Back to Creature Spellbooks"
          renderForm={({ document, mode, state }) => (
            <CreatureSpellbookForm document={document} mode={mode} state={state} />
          )}
        />
      );
    case '/npc-drop-tables':
      // Story p4-06: this family's directory does not exist in the fork, so `GET` answers an
      // empty list with `missing_directory: true` and the page renders its own empty state plus
      // the "the first save creates it" notice (`ObjectListPage`'s `CorpusNotices`).
      return (
        <ObjectListPage config={NPC_DROP_TABLE} nounPlural="NPC drop tables" keyHeader="NPC" />
      );
    case '/npc-drop-tables/:id':
      return (
        <ObjectDetailPage
          config={NPC_DROP_TABLE}
          nounPlural="NPC drop tables"
          backLabel="Back to NPC Drop Tables"
          renderForm={({ document, mode, state }) => (
            <NpcDropTableForm document={document} mode={mode} state={state} />
          )}
        />
      );
    case '/treasure-card-inventories':
      return (
        <ObjectListPage
          config={TREASURE_CARD_INVENTORY}
          nounPlural="treasure card inventories"
          keyHeader="NPC"
        />
      );
    case '/treasure-card-inventories/:id':
      // Story p4-05: the detail route is its own page rather than a `renderForm` inline here,
      // because the warn-not-block name rule needs the synced `spells` names at validation time
      // and a hook cannot live in a render prop (the DropTable detail page's own reason).
      return <TreasureCardInventoryDetailPage />;
    case '/zone-transfers':
      // Story p4-06: the seventh family's list branch (D73(g) — the real branch, not the stub).
      return <ObjectListPage config={ZONE_TRANSFER} nounPlural="zone transfers" keyHeader="Zone" />;
    case '/zone-transfers/:name':
      // Story p4-06: the eighth and last Phase-4 form. It needs no page of its own — the one
      // validation rule (`m_destinationLoc`'s format) consults no synced table, so the shared
      // engine runs from a module-level function and the form is rendered inline, like p4-03's.
      return (
        <ObjectDetailPage
          config={ZONE_TRANSFER}
          nounPlural="zone transfers"
          backLabel="Back to Zone Transfers"
          validate={validateZoneTransferDocument}
          renderForm={({ document, mode, state, messages }) => (
            <ZoneTransferForm document={document} mode={mode} state={state} messages={messages} />
          )}
        />
      );
    case '/global-registry':
      // Story p4-07: the eighth and last family. docs/spec-api.md L474 says exactly what this
      // route is — "GlobalRegistry editor" — with **no list and no detail route**, because the
      // family is one merged dictionary, not a collection: the page below is the editor itself,
      // and `tests/unit/ui-shell.test.ts` pins the spec's route table (which lists no
      // `/global-registry/:key`). Its disclosure needs the family's list query all the same, so
      // the page owns that hook rather than a render prop.
      return <GlobalRegistryPage />;
    default:
      // Unreachable: every path in `APP_ROUTES` is cased above (story p5-08 deleted the
      // last stub). It stays because TypeScript cannot prove a `switch` on a `string`
      // exhaustive, and it renders the real 404 page rather than a stub.
      return <NotFoundPage />;
  }
}

export default function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <UserNameGateProvider>
        {/*
          `v7_relativeSplatPath` is set to silence its v6 deprecation warning;
          `v7_startTransition` is deliberately **not** set (story p5-03), and that is a
          behaviour choice rather than an oversight. Setting it makes this plain
          `<BrowserRouter>` commit **every** location change inside `React.startTransition`
          (`react-router-dom/dist/index.js`: `v7_startTransition && startTransitionImpl ?
          startTransitionImpl(() => setStateImpl(newState)) : setStateImpl(newState)`), so a
          `?filter=` write by `useStatusFilter` lands one render behind the click: the URL
          changes at once while the row set still shows the old filter. That transient
          URL/DOM disagreement is what broke `tests/ui/quests-status.spec.ts:95` — measured:
          it passes 13/13 with the flag unset and fails one arm with it set, on the identical
          hook. (`navigate`'s `flushSync` option cannot help; it is consumed by the data
          router's `setState`, a path `<BrowserRouter>` never takes.) Leaving it unset keeps a
          URL-driven control consistent with its URL within the same event, at the cost of one
          `warnOnce` deprecation notice per page load — the trade is recorded in
          `docs/evidence/phase-5/p5-03-d3-proof.md`. Flip it back if a heavier route
          transition ever needs the concurrent path; nothing else in the app depends on it.
        */}
        <BrowserRouter future={{ v7_relativeSplatPath: true }}>
          <Routes>
            <Route element={<AppLayout />}>
              {APP_ROUTES.map((route) => (
                <Route key={route.path} path={route.path} element={elementFor(route)} />
              ))}
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </UserNameGateProvider>
      {/* Toasts: bottom-right, at most 3 visible, dark, per-type left border
          accent (spec-ui-design L111-123). */}
      <Toaster
        position={TOASTER_POSITION}
        visibleToasts={TOASTER_VISIBLE_TOASTS}
        closeButton={TOASTER_CLOSE_BUTTON}
        theme={TOASTER_THEME}
        toastOptions={{ classNames: TOASTER_CLASS_NAMES }}
      />
    </QueryClientProvider>
  );
}
