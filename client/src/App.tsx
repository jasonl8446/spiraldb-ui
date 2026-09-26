import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';

import { APP_NAME } from '@shared/index';

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
    </main>
  );
}

export default function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Future flags silence react-router v6's v7 deprecation warnings. */}
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/" element={<Placeholder page="Home" />} />
          <Route path="*" element={<Placeholder page="Not found" />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="bottom-right" theme="dark" />
    </QueryClientProvider>
  );
}
