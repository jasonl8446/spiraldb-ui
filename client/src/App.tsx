import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';

import AppLayout from './components/layout/AppLayout';
import NotFoundPage from './pages/NotFoundPage';
import SettingsPage from './pages/SettingsPage';
import StubPage from './pages/StubPage';
import { UserNameGateProvider } from './hooks/useUserNameGate';
import { APP_ROUTES } from './lib/routes';
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
 * exists, `/settings` renders the real page, and every other route renders the
 * "Arrives in Phase N" stub with the phase recorded in the table (decision D39
 * item 7).
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

export default function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <UserNameGateProvider>
        {/* Future flags silence react-router v6's v7 deprecation warnings. */}
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route element={<AppLayout />}>
              {APP_ROUTES.map((route) => (
                <Route
                  key={route.path}
                  path={route.path}
                  element={
                    route.path === '/settings' ? <SettingsPage /> : <StubPage route={route} />
                  }
                />
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
