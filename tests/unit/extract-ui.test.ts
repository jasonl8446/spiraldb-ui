import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EXTRACT_FILE_FIELD,
  EXTRACT_QUESTS_PATH,
  extractQuests,
  listQuests,
  QUESTS_QUERY_KEY,
  saveQuest,
} from '../../client/src/lib/api';
import {
  CHECKING_EXISTING_MESSAGE,
  DISCARD_LABEL,
  DROPZONE_PRIMARY,
  DROPZONE_SECONDARY,
  EXISTING_CHECK_FALLBACK,
  EXTRACTING_MESSAGE,
  EXTRACTING_TOAST_MESSAGE,
  existingCheckErrorMessage,
  existingCheckFailedMessage,
  extractErrorMessage,
  formatFileSize,
  goalCount,
  isAbortError,
  NEW_BADGE_LABEL,
  OVERWRITE_HEADING,
  OVERWRITE_TITLE,
  overwriteConfirmMessage,
  overwriteTargets,
  primitiveFields,
  questLevel,
  questName,
  saveAllConfirmMessage,
  saveErrorMessage,
  savedMessage,
  SAVE_ALL_LABEL,
  SAVE_SELECTED_LABEL,
  PREVIEW_TABS,
  shortTypeName,
  UPLOAD_FORMAT_HINT,
} from '../../client/src/lib/extract';

/**
 * Story p2-07 acceptance, the node half: the extraction UI's fixed copy, its
 * untrusted-input readers, and the two new data-layer helpers.
 *
 * Everything here is pure or a mocked `fetch` — no jsdom, no browser and no real
 * API (decision D10). The page's behaviour itself is driven in
 * `tests/ui/extraction.spec.ts` (decision D23 tier 1).
 */

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A `Response` whose body is the given JSON. */
function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sentInit(index = 0): RequestInit {
  const call = fetchMock.mock.calls[index];
  if (call === undefined) {
    throw new Error(`fetch was not called ${index + 1} time(s)`);
  }
  return call[1] as RequestInit;
}

function sentUrl(index = 0): string {
  const call = fetchMock.mock.calls[index];
  if (call === undefined) {
    throw new Error(`fetch was not called ${index + 1} time(s)`);
  }
  return call[0] as string;
}

describe('the extraction page copy is the spec copy', () => {
  it('states the format line verbatim (domain reference L625, not the mockup)', () => {
    expect(UPLOAD_FORMAT_HINT).toBe('Supported format: JSON packet capture files (.json)');
    expect(UPLOAD_FORMAT_HINT).not.toBe('Supported format: JSON packet capture (.json)');
  });

  it('carries the drop-zone, spinner, action-bar and badge copy', () => {
    expect(DROPZONE_PRIMARY).toBe('Drag & drop packet capture file here');
    expect(DROPZONE_SECONDARY).toBe('or click to browse');
    expect(EXTRACTING_MESSAGE).toBe('Extracting quests...');
    expect(EXTRACTING_TOAST_MESSAGE).toBe('Extracting quests... this may take a moment');
    expect([SAVE_ALL_LABEL, SAVE_SELECTED_LABEL, DISCARD_LABEL]).toEqual([
      'Save All to SpiralDB',
      'Save Selected',
      'Discard',
    ]);
    expect(NEW_BADGE_LABEL).toBe('new');
  });

  it('has the six preview tabs of the Phase 3 edit view', () => {
    expect(PREVIEW_TABS).toEqual([
      'Info',
      'Goals',
      'Goal Logic',
      'Requirements',
      'Results',
      'Dialog',
    ]);
  });

  it('builds the Save All confirmation with the count (spec L232)', () => {
    expect(saveAllConfirmMessage(14)).toBe(
      'Save 14 quests to SpiralDB? This will create files and auto-commit.',
    );
    expect(saveAllConfirmMessage(1)).toBe(
      'Save 1 quests to SpiralDB? This will create files and auto-commit.',
    );
  });

  it('builds the per-quest success toast (spec L120)', () => {
    expect(savedMessage('DS-ACAD1-C01-001')).toBe('Quest DS-ACAD1-C01-001 saved and committed');
  });
});

describe('the overwrite check copy (gap A, plan §2.4)', () => {
  it('adds the overwrite information without touching the AC sentence', () => {
    // The AC's sentence is fixed — the warning is added next to it, never inside.
    expect(saveAllConfirmMessage(2)).toBe(
      'Save 2 quests to SpiralDB? This will create files and auto-commit.',
    );
    expect(OVERWRITE_HEADING).toBe(
      'These quests already exist in SpiralDB and will be overwritten:',
    );
    expect(CHECKING_EXISTING_MESSAGE).toBe('Checking SpiralDB for existing quests…');
  });

  it('names the one quest in the Save Selected confirm', () => {
    expect(OVERWRITE_TITLE).toBe('Overwrite quest');
    expect(overwriteConfirmMessage('WC-UNICORN-MAIN-004')).toBe(
      'Quest WC-UNICORN-MAIN-004 already exists in SpiralDB. ' +
        'Saving will overwrite that file, refresh its metadata and auto-commit.',
    );
  });

  it('lists only the names that exist, in extraction order and without duplicates', () => {
    const existing = new Set(['B', 'D']);
    expect(overwriteTargets(['A', 'B', 'C', 'B'], existing)).toEqual(['B']);
    expect(overwriteTargets(['D', 'B'], existing)).toEqual(['D', 'B']);
    expect(overwriteTargets(['A', 'C'], existing)).toEqual([]);
    expect(overwriteTargets([], existing)).toEqual([]);
  });

  it('states the fail-safe decision: nothing is saved when the check cannot run', () => {
    // The server's own message leads; the refusal and its reason follow.
    const message = existingCheckFailedMessage(
      existingCheckErrorMessage(new Error('SpiralDB path is not configured.')),
    );
    expect(message).toContain('SpiralDB path is not configured.');
    expect(message).toContain('Nothing was saved');
    expect(message).toContain('never overwritten without warning');
    expect(message).toContain('Try again.');

    // No message ⇒ the named fallback, never an empty sentence.
    expect(existingCheckErrorMessage(new Error(''))).toBe(EXISTING_CHECK_FALLBACK);
    expect(existingCheckFailedMessage(EXISTING_CHECK_FALLBACK)).toContain(EXISTING_CHECK_FALLBACK);
  });
});

describe('toast error bodies surface the server message', () => {
  it('passes the server envelope through unprefixed', () => {
    expect(
      extractErrorMessage(new Error('Failed to parse packet capture: invalid file format')),
    ).toBe('Failed to parse packet capture: invalid file format');
    expect(
      saveErrorMessage(
        new Error('SpiralDB working tree has uncommitted changes — commit or stash'),
      ),
    ).toBe('SpiralDB working tree has uncommitted changes — commit or stash');
  });

  it('falls back only when there is no message', () => {
    expect(extractErrorMessage(new Error('   '))).toBe('Extraction failed');
    expect(extractErrorMessage(undefined)).toBe('Extraction failed');
    expect(saveErrorMessage('nope')).toBe('The save failed');
  });

  it('recognises an aborted fetch by name', () => {
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true);
    expect(isAbortError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(true);
    expect(isAbortError(new Error('boom'))).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });
});

describe('formatFileSize', () => {
  it('renders the spec mockup precision', () => {
    expect(formatFileSize(12.4 * 1024 * 1024)).toBe('12.4 MB');
    expect(formatFileSize(12345678)).toBe('11.8 MB');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.00 GB');
  });

  it('never throws on a nonsense size', () => {
    expect(formatFileSize(Number.NaN)).toBe('—');
    expect(formatFileSize(-1)).toBe('—');
  });
});

describe('untrusted quest readers', () => {
  it('reads the name, level and goal count the list renders', () => {
    const quest = { m_questName: 'DS-ACAD1-C01-001', m_questLevel: 1, m_goals: [{}, {}] };
    expect(questName(quest, 0)).toBe('DS-ACAD1-C01-001');
    expect(questLevel(quest)).toBe(1);
    expect(goalCount(quest)).toBe(2);
  });

  it('falls back instead of throwing on a malformed object', () => {
    expect(questName({}, 2)).toBe('Unnamed quest 3');
    expect(questName({ m_questName: '   ' }, 0)).toBe('Unnamed quest 1');
    expect(questLevel({ m_questLevel: 'high' })).toBeNull();
    expect(questLevel({})).toBeNull();
    expect(goalCount({ m_goals: 'nope' })).toBe(0);
  });

  it('shortens an assembly-qualified $type to its last name', () => {
    expect(
      shortTypeName('Imcodec.ObjectProperty.TypeCache.ResDropTable, Imcodec.ObjectProperty'),
    ).toBe('ResDropTable');
    expect(shortTypeName('ResWait')).toBe('ResWait');
    expect(shortTypeName('')).toBeNull();
    expect(shortTypeName(42)).toBeNull();
  });

  it('lists primitive fields only, joining string arrays', () => {
    expect(
      primitiveFields({
        m_goalName: 'GoalA',
        m_bountyTotal: 3,
        m_autoComplete: true,
        m_null: null,
        m_clientTags: ['a', 'b'],
        m_nested: { deep: true },
        m_objects: [{}, {}],
      }),
    ).toEqual([
      ['m_goalName', 'GoalA'],
      ['m_bountyTotal', '3'],
      ['m_autoComplete', 'true'],
      ['m_clientTags', 'a, b'],
    ]);
    expect(primitiveFields(null)).toEqual([]);
    expect(primitiveFields([1, 2])).toEqual([]);
  });
});

describe('extractQuests', () => {
  it('POSTs multipart FormData in the `file` field and lets the browser set the type', async () => {
    fetchMock.mockResolvedValue(json({ quests: [{ m_questName: 'Q1' }], count: 1 }));

    const file = new File(['{}'], 'session.json', { type: 'application/json' });
    await expect(extractQuests(file)).resolves.toEqual({
      quests: [{ m_questName: 'Q1' }],
      count: 1,
    });

    expect(sentUrl()).toBe(EXTRACT_QUESTS_PATH);
    const init = sentInit();
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    const body = init.body as FormData;
    expect(body.get(EXTRACT_FILE_FIELD)).toBeInstanceOf(File);
    expect((body.get(EXTRACT_FILE_FIELD) as File).name).toBe('session.json');
    // The boundary must come from the browser: no Content-Type is invented (and
    // the header set is empty, so `fetch` adds the multipart one itself).
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBeNull();
    expect(headers.get('accept')).toBe('application/json');
  });

  it('threads the AbortSignal into the request (D9/D47)', async () => {
    fetchMock.mockResolvedValue(json({ quests: [], count: 0 }));
    const controller = new AbortController();

    await extractQuests(new File(['{}'], 'c.json'), { signal: controller.signal });

    expect(sentInit().signal).toBe(controller.signal);
  });

  it('rethrows the server {error} envelope as an ApiError', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Failed to parse packet capture: bad header' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(extractQuests(new File(['{}'], 'c.json'))).rejects.toThrow(
      'Failed to parse packet capture: bad header',
    );
  });
});

describe('listQuests — the overwrite check’s data source (gap A)', () => {
  it('GETs /api/quests and hands back the quest rows', async () => {
    fetchMock.mockResolvedValue(
      json({
        quests: [{ quest_name: 'Q1' }, { quest_name: 'Q2' }],
        summary: { total: 2, extracted: 2, reviewed: 0, verified: 0 },
        skipped: [],
      }),
    );

    const result = await listQuests();

    expect(sentUrl()).toBe('/api/quests');
    // A read: no method means the fetch default (GET) and no body.
    expect(sentInit().method).toBeUndefined();
    expect(sentInit().body).toBeUndefined();
    expect(result.quests.map((row) => row.quest_name)).toEqual(['Q1', 'Q2']);
  });

  it('rethrows the server {error} envelope, which the fail-safe path shows', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'SpiralDB path is not configured.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(listQuests()).rejects.toThrow('SpiralDB path is not configured.');
  });
});

describe('saveQuest', () => {
  it('POSTs { quest } as JSON to /api/quests', async () => {
    fetchMock.mockResolvedValue(
      json({
        quest_name: 'Q1',
        outcome: 'created',
        action: 'extract',
        commit: 'abc',
        branch: 'content/2026-09-26',
        commit_message: 'spiraldb: extract quest Q1',
        file: 'QuestTemplates/questtemplates_Q1.json',
        metadata: 'QuestMetadatas/questmetadata_Q1.json',
        metadata_outcome: 'created',
        status: { object_type: 'quest', object_key: 'Q1', status: 'extracted' },
        warnings: [],
      }),
    );

    const quest = { m_questName: 'Q1' };
    await expect(saveQuest({ quest })).resolves.toMatchObject({ quest_name: 'Q1' });

    expect(sentUrl()).toBe('/api/quests');
    const init = sentInit();
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ quest });
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });

  it('exposes the browse-list query key the save invalidates', () => {
    expect(QUESTS_QUERY_KEY).toEqual(['quests']);
  });

  it('adds the capture file name as `source` when the page has one (gap B)', async () => {
    fetchMock.mockResolvedValue(
      json({
        quest_name: 'Q1',
        outcome: 'created',
        action: 'extract',
        commit: 'abc',
        branch: 'content/2026-09-26',
        commit_message: 'spiraldb: extract quest Q1',
        file: 'QuestTemplates/questtemplates_Q1.json',
        metadata: null,
        metadata_outcome: null,
        status: { object_type: 'quest', object_key: 'Q1', status: 'extracted' },
        warnings: [],
      }),
    );

    const quest = { m_questName: 'Q1' };
    await saveQuest({ quest, source: 'session_2026-09-24.json' });

    // Additive: the field is added, nothing existing moves.
    expect(JSON.parse(String(sentInit().body))).toEqual({
      quest,
      source: 'session_2026-09-24.json',
    });
  });
});
