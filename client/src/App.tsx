import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';

import { objectTypeConfig } from '@shared/objectTypes';

import AppLayout from './components/layout/AppLayout';
import CreatureSpellbookForm from './components/objects/CreatureSpellbookForm';
import NpcDropTableForm from './components/objects/NpcDropTableForm';
import NpcInventoryForm from './components/objects/NpcInventoryForm';
import NpcSpellInventoryForm from './components/objects/NpcSpellInventoryForm';
import DropTableDetailPage from './pages/DropTableDetailPage';
import ObjectDetailPage from './pages/ObjectDetailPage';
import ObjectListPage from './components/objects/ObjectListPage';
import NotFoundPage from './pages/NotFoundPage';
import ExtractionPage from './pages/ExtractionPage';
import QuestDetailPage from './pages/QuestDetailPage';
import QuestsPage from './pages/QuestsPage';
import SettingsPage from './pages/SettingsPage';
import StubPage from './pages/StubPage';
import { UserNameGateProvider } from './hooks/useUserNameGate';
import { APP_ROUTES, type AppRoute } from './lib/routes';
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
 * Routing is generated from the `APP_ROUTES` table, so the spec-api L325-350
 * route list has exactly one home and cannot drift from the sidebar: every route
 * exists, the built pages (`/settings` from p1-08, `/quests/extract` from p2-07,
 * `/quests` and `/quests/:questName` from p2-08, `/npc-inventories` and its detail
 * route from p4-01, `/drop-tables` and `/drop-tables/:name` from p4-02) render for
 * real, and every other route renders the "Arrives in Phase N" stub with the phase
 * recorded in the table (decision D39 item 7).
 *
 * Task 4.1 wired **one** of the eight object families end to end (NpcInventory) so
 * the generic scaffolding is provably used; story p4-02 added the second
 * (DropTable, whose form mounts the shared requirement tree inline and whose route
 * is driven by its own page so the duplicate-name rule can inject the corpus); story
 * p4-03 added the third and fourth (NpcSpellInventory and CreatureSpellbook, both
 * plain `ObjectDetailPage` + form pairs); story p4-06 added the fifth (NpcDropTable,
 * whose list page is the family with a genuinely absent directory). The remaining
 * three keep their Phase-4 stub until their own tasks (4.7-4.9) supply a form. Both
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
 * phase that *owns* the page, not a switch, so a built page is wired here once
 * (`/settings` in p1-08, `/quests/extract` in p2-07, the browse list and its
 * detail page in p2-08) and everything else keeps the "Arrives in Phase N" stub.
 *
 * `/quests/extract` is listed before `/quests/:questName` in `APP_ROUTES` and the
 * router ranks the static path higher regardless, so the detail route can never
 * shadow the extraction page.
 */
const NPC_INVENTORY = objectTypeConfig('npcinventory');
const NPC_SPELL_INVENTORY = objectTypeConfig('npcspellinventory');
const CREATURE_SPELLBOOK = objectTypeConfig('creaturespellbook');
const NPC_DROP_TABLE = objectTypeConfig('npcdroptable');
const DROP_TABLE = objectTypeConfig('droptable');

function elementFor(route: AppRoute): JSX.Element {
  switch (route.path) {
    case '/settings':
      return <SettingsPage />;
    case '/quests/extract':
      return <ExtractionPage />;
    case '/quests':
      return <QuestsPage />;
    case '/quests/:questName':
      return <QuestDetailPage />;
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
    default:
      return <StubPage route={route} />;
  }
}

export default function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <UserNameGateProvider>
        {/* Future flags silence react-router v6's v7 deprecation warnings. */}
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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
