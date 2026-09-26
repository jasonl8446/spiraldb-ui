import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';

import AppLayout from './components/layout/AppLayout';
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
 * `/quests` and `/quests/:questName` from p2-08) render for real, and every other
 * route renders the "Arrives in Phase N" stub with the phase recorded in the table
 * (decision D39 item 7).
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
