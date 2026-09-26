import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster, toast } from 'sonner';

import { APP_NAME } from '@shared/index';

import { UserNameGateProvider, useUserNameGate } from './hooks/useUserNameGate';
import {
  ApiError,
  getSettings,
  getStatus,
  patchStatus,
  SETTINGS_QUERY_KEY,
  statusQueryKey,
} from './lib/api';
import { UserNameCancelledError } from './lib/user-name';

/**
 * Placeholder shell. Task 1.8 owns the real app shell (260px sidebar, sticky
 * header, nav groups, route table, sync button). This file exists only so the
 * stack — React Router, TanStack Query, sonner, lucide, Tailwind and the
 * `@shared/*` alias — is provably wired end to end.
 */
const queryClient = new QueryClient();

function Placeholder({ page }: { page: string }): JSX.Element {
  return (
    <main className="min-h-screen bg-zinc-950 p-8 text-zinc-100">
      <h1 className="flex items-center gap-2 text-2xl font-semibold">
        <Sparkles size={18} className="text-blue-400" aria-hidden />
        {APP_NAME}
      </h1>
      <p className="mt-3 text-zinc-400">{page}</p>
      <p className="mt-1 text-sm text-zinc-500">The app shell arrives in task 1.8.</p>
      <DiagnosticPanel />
    </main>
  );
}

/**
 * TEMPORARY DIAGNOSTIC SURFACE — task 1.8 replaces this file.
 *
 * It exercises the one-time name gate and the status PATCH for real: the first
 * click opens the dialog, the name is persisted, and the very same click then
 * completes once the dialog is submitted (or aborts when it is cancelled).
 */
function DiagnosticPanel(): JSX.Element {
  const client = useQueryClient();
  const { requireUserName } = useUserNameGate();
  const [notes, setNotes] = useState('');
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);

  const settings = useQuery({ queryKey: SETTINGS_QUERY_KEY, queryFn: getSettings });
  const quests = useQuery({
    queryKey: statusQueryKey('quests'),
    queryFn: () => getStatus('quests'),
  });

  const keys = (quests.data?.entries ?? []).slice(0, 5).map((entry) => entry.object_key);
  const selected = picked !== '' && keys.includes(picked) ? picked : (keys[0] ?? '');

  async function markReviewed(): Promise<void> {
    setBusy(true);
    try {
      const name = await requireUserName();
      await patchStatus('quests', selected, { status: 'reviewed', notes, changed_by: name });
      toast.success(`Marked ${selected} reviewed as ${name}`);
      await client.invalidateQueries({ queryKey: statusQueryKey('quests') });
    } catch (caught) {
      if (caught instanceof UserNameCancelledError) {
        toast.info('Name needed — the status change was cancelled.');
      } else {
        toast.error(caught instanceof ApiError ? caught.message : 'Status change failed.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Diagnostic: status change and identity gate"
      className="mt-6 max-w-xl rounded-xl border border-zinc-800 bg-zinc-900 p-4"
    >
      <h2 className="text-sm font-semibold text-zinc-50">Diagnostic surface (temporary)</h2>
      <p className="mt-1 text-sm text-zinc-400">
        User name: {settings.data?.user_name ? settings.data.user_name : 'not set'}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          aria-label="Quest"
          value={selected}
          onChange={(event) => setPicked(event.target.value)}
          className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
        >
          {keys.length === 0 ? <option value="">Loading quests…</option> : null}
          {keys.map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
        <input
          aria-label="Notes"
          value={notes}
          placeholder="Notes (optional)"
          onChange={(event) => setNotes(event.target.value)}
          className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600"
        />
        <button
          type="button"
          onClick={() => void markReviewed()}
          disabled={selected === '' || busy}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-zinc-50 hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Mark reviewed'}
        </button>
      </div>
    </section>
  );
}

export default function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <UserNameGateProvider>
        {/* Future flags silence react-router v6's v7 deprecation warnings. */}
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path="/" element={<Placeholder page="Home" />} />
            <Route path="*" element={<Placeholder page="Not found" />} />
          </Routes>
        </BrowserRouter>
      </UserNameGateProvider>
      <Toaster position="bottom-right" theme="dark" />
    </QueryClientProvider>
  );
}
