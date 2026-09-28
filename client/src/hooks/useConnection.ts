import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useSyncExternalStore } from 'react';

import {
  connectionState,
  reportProbeResult,
  subscribeConnection,
  type ConnectionState,
} from '../lib/connection';

/**
 * The offline detector (story p5-04, AC1; spec-ui-design L535).
 *
 * Reads the connection store and runs the **health probe** that turns a failed request into a
 * verdict:
 *
 * - the moment the store says `suspect` — one request just failed in a way an outage would
 *   explain — the probe fires **immediately**, so the banner appears within one failed request
 *   cycle and never needs a manual refresh;
 * - while it says anything other than `online`, the probe repeats every
 *   {@link PROBE_INTERVAL_MS} until it succeeds, which is what clears the banner after the
 *   server comes back;
 * - the first success after an outage **invalidates every query**, which is the AC's second
 *   half ("banner clears and data refreshes") without any page having to know about it.
 *
 * `/api/health` (`server/src/routes/index.ts`) is the probe's target because it is the app's
 * only endpoint that touches nothing: no database, no corpus, no filesystem. A closed database
 * connection therefore 500s a page while the probe keeps answering 200 — the app stays `online`
 * and the banner stays down, which is exactly the distinction the store's header documents.
 *
 * The probe is a plain `fetch`, deliberately not `apiFetch`: `apiFetch` reports outcomes into
 * the store, and a probe that fed itself back would keep the state churning.
 */

/** How often the probe repeats while the API has not answered. */
export const PROBE_INTERVAL_MS = 2000;

/** The liveness endpoint the probe calls — the server's own operational route. */
export const PROBE_PATH = '/api/health';

/** What the shell needs: whether the API is currently unreachable. */
export interface ConnectionStatus {
  /** `true` only for the `offline` state — the banner's condition. */
  offline: boolean;
  /** The state itself, for a caller that wants to distinguish "suspect" from "offline". */
  state: ConnectionState;
}

/** One probe. Resolves `true` when the API answered with a 2xx. */
async function probeOnce(signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(PROBE_PATH, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal,
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function useConnection(): ConnectionStatus {
  const queryClient = useQueryClient();
  const state = useSyncExternalStore(subscribeConnection, connectionState);
  /** Set while the banner is up; the recovery effect below is gated on it. */
  const wasOffline = useRef(false);
  /**
   * "There is something to probe" — deliberately a **boolean**, not the state itself: the
   * `suspect → offline` transition is the probe *succeeding at its job*, and re-running the
   * effect on it would fire a second, redundant probe and restart the interval. Measured on the
   * live rig before this: two probes 12 ms apart. Keyed on `active`, one failed request starts
   * exactly one immediate probe, and the 2 s interval survives the online/suspect distinction.
   */
  const active = state !== 'online';

  useEffect(() => {
    if (!active) {
      return;
    }
    const controller = new AbortController();
    const probe = (): void => {
      void probeOnce(controller.signal).then((reachable) => {
        if (!controller.signal.aborted) {
          reportProbeResult(reachable);
        }
      });
    };
    // Immediately: "within one failed request cycle" — the probe is the second half of the
    // cycle that already failed, not a poll that has to wait for its next tick.
    probe();
    const timer = window.setInterval(probe, PROBE_INTERVAL_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [active]);

  useEffect(() => {
    if (state === 'offline') {
      wasOffline.current = true;
      return;
    }
    if (state === 'online' && wasOffline.current) {
      wasOffline.current = false;
      // Everything that was loaded while the server was away is stale by definition.
      void queryClient.invalidateQueries();
    }
  }, [state, queryClient]);

  return { offline: state === 'offline', state };
}
