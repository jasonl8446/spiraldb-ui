import { existsSync, statSync } from 'node:fs';

import { Router } from 'express';

import type { ApiError } from '../../../shared/index.js';
import { SETTINGS_KEYS, readSettings, type Db, type SettingKey } from '../db.js';

/**
 * Settings API — `GET /api/settings` / `PUT /api/settings` (task 1.3,
 * docs/spec-api.md L291-321).
 *
 * GET returns the five settings as one flat string map. PUT takes a partial
 * subset of those keys, validates the whole body, and answers 200 with the full
 * updated map, so a client refreshes in one round trip (lead resolution).
 */

/**
 * The filesystem view the validator is allowed to use.
 *
 * Injected so the validation matrix is unit-testable without touching a real
 * disk — and so no test can ever probe the owner's repositories.
 */
export interface PathProbe {
  /** `true` when the path exists, whatever its kind. */
  existsSync: (candidate: string) => boolean;
  /** `true` when the path exists *and* is a directory. */
  isDirectory: (candidate: string) => boolean;
}

/** The real filesystem. */
export const defaultPathProbe: PathProbe = {
  existsSync,
  isDirectory: (candidate) => {
    try {
      return statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  },
};

/**
 * What each path-valued setting must point at: the two repositories are
 * directories, `imcodec_path` is the executable itself (lead resolution).
 * `user_name` and `git_branch` are free text and are absent on purpose.
 */
const PATH_KIND_BY_KEY: Partial<Record<SettingKey, 'directory' | 'file'>> = {
  aurorium_path: 'directory',
  imcodec_path: 'file',
  spiraldb_path: 'directory',
};

function isSettingKey(key: string): key is SettingKey {
  return (SETTINGS_KEYS as readonly string[]).includes(key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Names a received value for a 400 message, e.g. `null`, `array`, `number`. */
function describeValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}

/**
 * Validates a partial settings update.
 *
 * Returns the actionable 400 message, or `undefined` when every pair may be
 * persisted. Pure apart from the injected `probe`; nothing is written here, so
 * a body with one bad key persists none of its good keys (atomic PUT).
 */
export function validateSettingsPatch(
  patch: unknown,
  probe: PathProbe = defaultPathProbe,
): string | undefined {
  if (!isPlainObject(patch)) {
    return 'Request body must be a JSON object of settings key/value pairs';
  }

  const unknownKeys = Object.keys(patch).filter((key) => !isSettingKey(key));
  if (unknownKeys.length > 0) {
    return `Unknown settings key${unknownKeys.length === 1 ? '' : 's'}: ${unknownKeys.join(
      ', ',
    )}. Allowed keys: ${SETTINGS_KEYS.join(', ')}`;
  }

  const values = new Map<SettingKey, string>();
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value !== 'string') {
      return `Invalid value for ${key}: expected a string but received ${describeValue(value)}`;
    }
    if (isSettingKey(key)) {
      values.set(key, value);
    }
  }

  for (const key of SETTINGS_KEYS) {
    const kind = PATH_KIND_BY_KEY[key];
    const value = values.get(key);
    if (kind === undefined || value === undefined) {
      continue;
    }
    if (kind === 'directory' && !(probe.existsSync(value) && probe.isDirectory(value))) {
      return `${key} "${value}" is not an existing directory`;
    }
    if (kind === 'file' && !(probe.existsSync(value) && !probe.isDirectory(value))) {
      return `${key} "${value}" is not an existing file`;
    }
  }

  return undefined;
}

export interface SettingsRouterOptions {
  /** Connection holding the `settings` table (tests inject a seeded `:memory:` DB). */
  db: Db;
}

/**
 * Builds the `/api/settings` router.
 *
 * The body is validated in full before the first write, then the supplied rows
 * are upserted: existing rows are UPDATEd, never re-seeded, so a path the owner
 * edited survives a restart (decision D31c).
 */
export function createSettingsRouter({ db }: SettingsRouterOptions): Router {
  const router = Router();

  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  const upsertAll = db.transaction((entries: Array<[string, string]>) => {
    for (const [key, value] of entries) {
      upsert.run(key, value);
    }
  });

  router.get('/', (_req, res) => {
    res.json(readSettings(db));
  });

  router.put('/', (req, res) => {
    const error = validateSettingsPatch(req.body);
    if (error !== undefined) {
      res.status(400).json({ error } satisfies ApiError);
      return;
    }

    // An empty body is a valid no-op update: zero entries, zero writes.
    upsertAll(Object.entries(req.body as Record<string, string>));
    res.json(readSettings(db));
  });

  return router;
}
