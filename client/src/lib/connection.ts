/**
 * The connection store (story p5-04, AC1; spec-ui-design L535).
 *
 * > Network offline: Persistent banner at top: "Connection lost. …"
 *
 * ## Why a store and not a component's state
 *
 * The evidence that the API has gone away arrives in `lib/api.ts` — every caller of
 * `apiFetch`, in every page — while the banner is rendered once, by the shell. A module-level
 * store is the one place both can meet without threading a context through every page (and
 * without a second fetch path that would miss the failures the feature exists to catch). React
 * reads it with `useSyncExternalStore`, so no render is lost between the two.
 *
 * ## The three states, and why "a request failed" is not one of them
 *
 * | state | meaning | what the banner does |
 * |---|---|---|
 * | `online` | the last evidence says the API answers | hidden |
 * | `suspect` | a request failed at the transport level or the server answered 5xx | hidden — a **health probe** is deciding |
 * | `offline` | the health probe itself failed: the API is not reachable | shown |
 *
 * The `suspect` step is the whole point. A failed request is **not** an outage: an ordinary
 * validation 400 is the request working correctly, a 404 is an answer, and even a genuine 500
 * from one endpoint means the server is talking to us (this app has exactly such a case — a
 * closed database connection 500s a read while `/api/health` keeps answering 200). Only a
 * failing `GET /api/health` proves the API is unreachable, so the banner can never appear
 * because of a validation error. `lib/api.ts` never reports a 4xx here for the same reason:
 * "the server said no" and "the server is gone" are different facts.
 *
 * Declared pure (no React, no DOM, no timers) so the state machine — including the "must not
 * flap on a single failure" rule — is unit-testable without rendering anything. The probe loop
 * that feeds {@link reportProbeResult} lives in `hooks/useConnection.ts`.
 */

/** What the app knows about the API connection. See the header table. */
export type ConnectionState = 'online' | 'suspect' | 'offline';

let state: ConnectionState = 'online';
const listeners = new Set<() => void>();

function setState(next: ConnectionState): void {
  if (next === state) {
    return;
  }
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

/** Reads the current state. Stable between changes — what `useSyncExternalStore` requires. */
export function connectionState(): ConnectionState {
  return state;
}

/** Subscribes to state changes; returns the unsubscribe. */
export function subscribeConnection(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * One request failed in a way an outage would explain: the `fetch` itself rejected
 * (connection refused/reset), or the server answered **5xx**.
 *
 * Must never be called for a 4xx — see the header. While already `offline` this keeps the
 * banner up rather than demoting the state back to `suspect`, so a repeated failure cannot
 * make the banner flicker off between probe cycles.
 */
export function reportRequestFailure(): void {
  setState(state === 'offline' ? 'offline' : 'suspect');
}

/**
 * One request received a usable HTTP answer (`< 500`): whatever else is wrong, the API is
 * reachable, so nothing is suspect any more. This is also the "a single 500 is not an outage"
 * half of the rule — the health probe normally gets there first, and a request that then
 * succeeds (or is rejected as a validation error) settles it the same way.
 */
export function reportRequestSuccess(): void {
  setState('online');
}

/**
 * The health probe's verdict — the only thing that may declare an outage.
 *
 * `true` (the probe answered) also **clears** the banner; the caller that observes that
 * transition is responsible for refreshing the data (`hooks/useConnection.ts` invalidates
 * every query), which is the AC's second half: "restart the server → banner clears and data
 * refreshes".
 */
export function reportProbeResult(reachable: boolean): void {
  setState(reachable ? 'online' : 'offline');
}

/** Resets the store — tests only (the module is a singleton for the app's whole life). */
export function resetConnectionForTests(): void {
  state = 'online';
  listeners.clear();
}
