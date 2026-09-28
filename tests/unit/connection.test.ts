import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, isRetryableApiError } from '../../client/src/lib/api';
import {
  connectionState,
  reportProbeResult,
  reportRequestFailure,
  reportRequestSuccess,
  resetConnectionForTests,
  subscribeConnection,
} from '../../client/src/lib/connection';

/**
 * Story p5-04 (AC1) — the connection store, in plain node.
 *
 * The store is deliberately React-free (`lib/connection.ts`'s header), so the whole state
 * machine is asserted here: what a failed request does, what a **4xx** must *not* do, and the
 * rule that only the health probe may declare (and clear) an outage. The banner's own DOM
 * behaviour is covered by `tests/ui/offline-banner.spec.ts`, and the live kill/restart sequence
 * by `docs/evidence/phase-5/p5-04-d3-proof.md`.
 */

afterEach(() => {
  resetConnectionForTests();
});

describe('connection store', () => {
  it('starts online', () => {
    expect(connectionState()).toBe('online');
  });

  it('a failed request is only suspect — the health probe decides', () => {
    reportRequestFailure();
    expect(connectionState()).toBe('suspect');
  });

  it('a failing probe on top of a failed request is the outage', () => {
    reportRequestFailure();
    reportProbeResult(false);
    expect(connectionState()).toBe('offline');
  });

  it('a succeeding probe clears the outage', () => {
    reportRequestFailure();
    reportProbeResult(false);
    reportProbeResult(true);
    expect(connectionState()).toBe('online');
  });

  it('a repeated failure while offline keeps the banner up rather than demoting to suspect', () => {
    reportRequestFailure();
    reportProbeResult(false);
    reportRequestFailure();
    reportRequestFailure();
    // 'suspect' here would hide the banner between probe cycles.
    expect(connectionState()).toBe('offline');
  });

  it('a usable HTTP answer settles the connection even after a 5xx', () => {
    // The closed-database case: one endpoint 500s while /api/health keeps answering. The probe
    // never runs because a later request answers, and the state returns to online.
    reportRequestFailure();
    reportRequestSuccess();
    expect(connectionState()).toBe('online');
  });

  it('notifies subscribers once per actual change', () => {
    const seen: string[] = [];
    const unsubscribe = subscribeConnection(() => {
      seen.push(connectionState());
    });

    reportRequestFailure();
    reportRequestFailure(); // no change — no notification
    reportProbeResult(false);
    reportProbeResult(false); // no change
    reportProbeResult(true);
    unsubscribe();
    reportRequestFailure(); // unsubscribed — not seen

    expect(seen).toEqual(['suspect', 'offline', 'online']);
  });

  it('lets a subscriber unsubscribe without disturbing the others', () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = subscribeConnection(first);
    subscribeConnection(second);

    stopFirst();
    reportRequestFailure();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('isRetryableApiError (the toast retry action’s gate)', () => {
  it('offers a retry for a 5xx', () => {
    expect(isRetryableApiError(new ApiError(500, 'Internal server error'))).toBe(true);
    expect(isRetryableApiError(new ApiError(503, 'Unavailable'))).toBe(true);
  });

  it('declines a retry for a 4xx — a validation error is not an outage and not transient', () => {
    expect(isRetryableApiError(new ApiError(400, 'Missing object'))).toBe(false);
    expect(isRetryableApiError(new ApiError(404, 'Unknown quest "x"'))).toBe(false);
    expect(isRetryableApiError(new ApiError(409, 'Dirty working tree'))).toBe(false);
  });

  it('offers a retry for a transport failure and an unparsable body', () => {
    // A rejected `fetch` has no HTTP status at all.
    expect(isRetryableApiError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isRetryableApiError(new Error('/api/x returned a body that is not valid JSON'))).toBe(
      true,
    );
  });
});
