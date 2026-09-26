import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import UserNameDialog from '../components/UserNameDialog';
import { ApiError, getSettings, putSettings, SETTINGS_QUERY_KEY, type Settings } from '../lib/api';
import {
  resolveUserNameAction,
  UserNameCancelledError,
  type UserNameAction,
} from '../lib/user-name';

/**
 * The one-time identity gate (task 1.7, docs/spec-data-model.md L225-232).
 *
 * This is a GATE, not a page-load popup: nothing opens until an action needs a
 * name, and the action then continues by itself once the name is entered — the
 * user never has to click twice. Every decision is delegated to
 * `lib/user-name.ts`, so this file only moves promises and pixels.
 *
 * Usage, from anywhere under `<UserNameGateProvider>`:
 *
 * ```tsx
 * const { requireUserName } = useUserNameGate();
 * try {
 *   const name = await requireUserName();       // resolves immediately when set
 *   await patchStatus('quests', key, { status: 'reviewed', changed_by: name });
 * } catch (error) {
 *   if (error instanceof UserNameCancelledError) return;  // user dismissed it
 *   throw error;
 * }
 * ```
 */

/** The gate surface `useUserNameGate()` returns. */
export interface UserNameGate {
  /**
   * Resolves with a usable, trimmed name — from `settings.user_name` when it is
   * already set, otherwise after the dialog is submitted. Rejects with
   * {@link UserNameCancelledError} if the dialog is dismissed, so the caller can
   * abort without applying its action.
   */
  requireUserName: () => Promise<string>;
}

const UserNameGateContext = createContext<UserNameGate | null>(null);

interface Waiter {
  resolve: (name: string) => void;
  reject: (error: UserNameCancelledError) => void;
}

/**
 * `useUserNameGate()` — the only way to obtain a name. Throws when used outside
 * the provider, which is a wiring bug rather than a runtime condition.
 */
export function useUserNameGate(): UserNameGate {
  const gate = useContext(UserNameGateContext);
  if (gate === null) {
    throw new Error('useUserNameGate must be used inside <UserNameGateProvider>');
  }
  return gate;
}

/**
 * Provides `requireUserName` and owns the dialog.
 *
 * Must sit inside `QueryClientProvider`: the current name comes from — and the
 * saved name goes back into — the shared `['settings']` query cache, so the rest
 * of the app sees the new name without a refetch.
 */
export function UserNameGateProvider({ children }: { children: ReactNode }): JSX.Element {
  const queryClient = useQueryClient();
  const waitersRef = useRef<Waiter[]>([]);
  /** The `settings.user_name` the gate last read; the state machine's input. */
  const currentNameRef = useRef('');
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Answers every open promise at once; the dialog allows only one prompt. */
  const settle = useCallback((apply: (waiter: Waiter) => void): void => {
    const waiters = waitersRef.current;
    waitersRef.current = [];
    setOpen(false);
    setSubmitting(false);
    for (const waiter of waiters) {
      apply(waiter);
    }
  }, []);

  const requireUserName = useCallback(async (): Promise<string> => {
    const settings = await queryClient.ensureQueryData<Settings>({
      queryKey: SETTINGS_QUERY_KEY,
      queryFn: getSettings,
    });
    currentNameRef.current = settings.user_name;

    const decision = resolveUserNameAction(settings.user_name);
    if (decision.kind === 'resolved') {
      return decision.name;
    }

    return new Promise<string>((resolve, reject) => {
      waitersRef.current.push({ resolve, reject });
      setError(null);
      setOpen(true);
    });
  }, [queryClient]);

  const handleSubmit = useCallback(
    async (entered: string): Promise<void> => {
      const decision: UserNameAction = resolveUserNameAction(currentNameRef.current, entered);
      if (decision.kind === 'invalid') {
        setError(decision.error);
        return;
      }
      if (decision.kind !== 'resolved') {
        return; // `prompt`/`cancelled` cannot come out of the dialog's submit path.
      }

      setSubmitting(true);
      setError(null);
      try {
        const updated = await putSettings({ user_name: decision.name });
        queryClient.setQueryData(SETTINGS_QUERY_KEY, updated);
        currentNameRef.current = updated.user_name;
        settle((waiter) => waiter.resolve(decision.name));
      } catch (caught) {
        // Keep the dialog open with the typed value so the user can retry.
        setSubmitting(false);
        setError(
          caught instanceof ApiError ? caught.message : 'Could not save your name. Try again.',
        );
      }
    },
    [queryClient, settle],
  );

  const handleCancel = useCallback((): void => {
    setError(null);
    settle((waiter) => waiter.reject(new UserNameCancelledError()));
  }, [settle]);

  const gate = useMemo<UserNameGate>(() => ({ requireUserName }), [requireUserName]);

  return (
    <UserNameGateContext.Provider value={gate}>
      {children}
      <UserNameDialog
        open={open}
        error={error}
        submitting={submitting}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    </UserNameGateContext.Provider>
  );
}
