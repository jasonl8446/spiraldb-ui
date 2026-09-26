import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  apiFetch,
  getQuest,
  getSettings,
  getStatus,
  getStatusHistory,
  patchStatus,
  putSettings,
  questDetailQueryKey,
  SETTINGS_QUERY_KEY,
  STATUS_HISTORY_QUERY_KEY,
  statusHistoryQueryKey,
  statusQueryKey,
} from '../../client/src/lib/api';

/**
 * Task 1.7 acceptance: the client data layer is a thin typed fetch helper plus
 * wrappers for settings and status. Everything here runs in plain node — `fetch`
 * is mocked, no jsdom and no testing-library (decision D10: `@playwright/test`
 * does not exist until p1-13), and the real API is never contacted.
 */

const fetchMock = vi.fn<typeof fetch>();

/** A real `Response`, so `ok`/`status`/`statusText`/`text()` behave as in a browser. */
function respond(body: string, init: ResponseInit = {}): Response {
  return new Response(body, init);
}

function mockJson(body: unknown, init: ResponseInit = {}): void {
  // A fresh Response per call: a Response body can only be read once.
  fetchMock.mockImplementation(() => Promise.resolve(json(body, init)));
}

function mockBody(body: string, init: ResponseInit = {}): void {
  fetchMock.mockImplementation(() => Promise.resolve(respond(body, init)));
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

/** The `(url, init)` pair of the nth call, with its headers normalised. */
function call(index = 0): {
  url: string;
  method: string | undefined;
  headers: Headers;
  body: unknown;
} {
  const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  return {
    url,
    method: init.method,
    headers: new Headers(init.headers),
    body: init.body === undefined || init.body === null ? undefined : JSON.parse(String(init.body)),
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('GETs a relative /api path, sends Accept, and parses the JSON body', async () => {
    mockJson({ user_name: 'jason' });

    await expect(apiFetch('/api/settings')).resolves.toEqual({ user_name: 'jason' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = call();
    expect(sent.url).toBe('/api/settings');
    expect(sent.headers.get('accept')).toBe('application/json');
    // No body → no content type invented.
    expect(sent.headers.get('content-type')).toBeNull();
  });

  it('sends a JSON body with content-type when one is given, keeping the caller`s method', async () => {
    mockJson({ ok: true });

    await apiFetch('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ user_name: 'jason' }),
    });

    const sent = call();
    expect(sent.method).toBe('PUT');
    expect(sent.headers.get('content-type')).toBe('application/json');
    expect(sent.body).toEqual({ user_name: 'jason' });
  });

  it('resolves undefined for an empty success body (204)', async () => {
    // 204 may not carry a body, which is exactly the empty-success case.
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));

    await expect(apiFetch('/api/anything', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('throws ApiError carrying the status and the server`s {error} message', async () => {
    mockJson({ error: 'user_name must be a string' }, { status: 400 });

    const error = await apiFetch('/api/settings', { method: 'PUT', body: '{}' }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toBeInstanceOf(Error);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).message).toBe('user_name must be a string');
  });

  it('falls back to the raw body, then the status text, when the failure is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(respond('<html>nope</html>', { status: 502 }));
    const plain = await apiFetch('/api/settings').catch((caught: unknown) => caught);
    expect((plain as ApiError).status).toBe(502);
    expect((plain as ApiError).message).toBe('<html>nope</html>');

    fetchMock.mockResolvedValueOnce(
      respond('', { status: 503, statusText: 'Service Unavailable' }),
    );
    const empty = await apiFetch('/api/settings').catch((caught: unknown) => caught);
    expect((empty as ApiError).status).toBe(503);
    expect((empty as ApiError).message).toBe('Service Unavailable');
  });

  it('rejects a 2xx body that is not valid JSON instead of resolving with garbage', async () => {
    mockBody('not json', { status: 200 });

    await expect(apiFetch('/api/settings')).rejects.toThrow(
      '/api/settings returned a body that is not valid JSON',
    );
  });

  it('propagates a network failure unchanged', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'));

    await expect(apiFetch('/api/settings')).rejects.toThrow('fetch failed');
  });
});

describe('settings wrappers', () => {
  it('getSettings GETs /api/settings', async () => {
    mockJson({ user_name: '' });

    await expect(getSettings()).resolves.toEqual({ user_name: '' });
    expect(call().url).toBe('/api/settings');
    expect(call().method).toBeUndefined();
  });

  it('putSettings PUTs a partial patch as JSON and answers with the full map', async () => {
    const updated = { user_name: 'jason', git_branch: 'content/2026-09-26' };
    mockJson(updated);

    await expect(putSettings({ user_name: 'jason' })).resolves.toEqual(updated);
    const sent = call();
    expect(sent.url).toBe('/api/settings');
    expect(sent.method).toBe('PUT');
    expect(sent.body).toEqual({ user_name: 'jason' });
  });
});

describe('status wrappers', () => {
  it('getStatus GETs the type route, adding ?status= only when filtered', async () => {
    mockJson({ entries: [], summary: {} });

    await getStatus('quests');
    expect(call(0).url).toBe('/api/status/quests');

    await getStatus('zone_transfers', { status: 'reviewed' });
    expect(call(1).url).toBe('/api/status/zone_transfers?status=reviewed');
    expect(call(1).method).toBeUndefined();
  });

  it('patchStatus PATCHes one key, URL-encoding it, with the body verbatim', async () => {
    mockJson({ object_key: 'DS-ACAD-C01-001', status: 'reviewed' });

    await patchStatus('quests', 'DS ACAD/C01 001', {
      status: 'reviewed',
      notes: 'looks right',
      changed_by: 'jason',
    });

    const sent = call();
    expect(sent.url).toBe('/api/status/quests/DS%20ACAD%2FC01%20001');
    expect(sent.method).toBe('PATCH');
    expect(sent.body).toEqual({
      status: 'reviewed',
      notes: 'looks right',
      changed_by: 'jason',
    });
  });

  it('exposes stable query keys the gate and the shell share', () => {
    expect(SETTINGS_QUERY_KEY).toEqual(['settings']);
    expect(statusQueryKey('quests')).toEqual(['status', 'quests']);
  });
});

describe('status history reader (p2-09)', () => {
  it('getStatusHistory GETs the history route, URL-encoding the key, and unwraps it', async () => {
    const rows = [
      {
        old_status: null,
        new_status: 'extracted',
        notes: 'Imported from packet capture pcap.json',
        changed_by: 'jason',
        changed_at: '2026-09-26T12:00:00.000Z',
      },
    ];
    mockJson({ history: rows });

    await expect(getStatusHistory('quests', 'DS ACAD/C01 001')).resolves.toEqual(rows);

    const sent = call();
    expect(sent.url).toBe('/api/status/quests/DS%20ACAD%2FC01%20001/history');
    expect(sent.method).toBeUndefined();
    expect(sent.body).toBeUndefined();
  });

  it('throws the ApiError 404 the untracked state is keyed on (D51(f))', async () => {
    mockJson({ error: 'Unknown quests entry "NOPE"' }, { status: 404 });

    const error = await getStatusHistory('quests', 'NOPE').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
    expect((error as ApiError).message).toBe('Unknown quests entry "NOPE"');
  });

  it('exposes the history query key prefix and one key per entry', () => {
    expect(STATUS_HISTORY_QUERY_KEY).toEqual(['status-history']);
    // The per-entry key starts with the prefix, so one invalidation reaches them all.
    expect(statusHistoryQueryKey('quests', 'DS-ACAD1-C01-001')).toEqual([
      'status-history',
      'quests',
      'DS-ACAD1-C01-001',
    ]);
  });
});

describe('quest readers (p2-08)', () => {
  it('getQuest GETs the bare quest object, URL-encoding the name', async () => {
    mockJson({ m_questName: 'DS-ACAD1-C01-001', m_questLevel: 1 });

    await expect(getQuest('DS ACAD/1')).resolves.toEqual({
      m_questName: 'DS-ACAD1-C01-001',
      m_questLevel: 1,
    });

    const sent = call();
    expect(sent.url).toBe('/api/quests/DS%20ACAD%2F1');
    expect(sent.method).toBeUndefined();
    expect(sent.body).toBeUndefined();
  });

  it('getQuest rethrows the 404 envelope the detail page renders as not-found', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unknown quest "NOPE"' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const failure = await getQuest('NOPE').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(404);
    expect((failure as ApiError).message).toBe('Unknown quest "NOPE"');
  });

  it('keys one detail read per quest name', () => {
    expect(questDetailQueryKey('DS-ACAD1-C01-001')).toEqual(['quest-detail', 'DS-ACAD1-C01-001']);
    expect(questDetailQueryKey('A')).not.toEqual(questDetailQueryKey('B'));
  });
});
