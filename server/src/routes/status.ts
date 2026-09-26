import { Router } from 'express';

import type { ApiError } from '../../../shared/index.js';
import { readSettings, type Db } from '../db.js';
import {
  importStatusBody,
  getLastImportResult,
  type ImportResult,
  type ImportStatusBody,
} from '../services/import.js';
import {
  applyStatusChange,
  getStatusHistory,
  isStatusRequestType,
  isStatusRouteType,
  isStatusValue,
  listStatus,
  resolveStatusObjectTypes,
  STATUS_TYPE_BY_ROUTE,
  unknownStatusTypeMessage,
  type StatusEntryRow,
  type StatusObjectType,
  type StatusRequestType,
  type StatusRouteType,
  type StatusValue,
} from '../services/status.js';

/**
 * Status API — the verification lifecycle endpoints (task 1.6,
 * docs/spec-api.md L48-142):
 *
 * - `GET    /api/status/:type`               list + pre-filter summary
 * - `PATCH  /api/status/:type/:key`          update status, log history
 * - `GET    /api/status/:type/:key/history`  oldest → newest history
 * - `GET    /api/status/_import`             once-only import toast payload
 *
 * `:type` is the plural route name and D4 maps it to the singular column via one
 * constant (`server/src/services/status.ts`); an unknown type is a 404 whose
 * message lists the valid ones. `type=all` aggregates the eight tracked types on
 * the two GET reads — PATCH and history address one real entry, so `all` is not
 * a valid type for them.
 *
 * The `/status/_import` *literal* route is registered before `/:type` so Express
 * can never resolve it through the parameterised route first (lead decision 7).
 *
 * Failures are JSON `{ error }`: unknown type / unknown key → 404, a malformed
 * `status` or `?status=` → 400.
 *
 * The router is built from an injected connection, and `routes/index.ts` mounts it
 * lazily so importing `app.ts` never opens `data/spiraldb-ui.db` (decision D32).
 */
export interface StatusRouterOptions {
  /** Connection holding `entry_status` + `status_history` (+ `settings`). */
  db: Db;
  /**
   * Last import of this process, for `/status/_import`. Defaults to the import
   * service's in-memory record (lead decision 7) and is injectable so a test can
   * pin the body without running an import.
   */
  readLastImport?: () => ImportResult | null;
}

/** Validates the `:type` segment; `allowAll` covers the aggregate GET routes. */
function rejectUnknownType(type: string, allowAll: boolean): string | undefined {
  if (allowAll ? isStatusRequestType(type) : isStatusRouteType(type)) {
    return undefined;
  }
  return unknownStatusTypeMessage(type);
}

/** D4: the singular column value for a route segment already known to be valid. */
function objectTypeForRoute(route: string): StatusObjectType {
  return STATUS_TYPE_BY_ROUTE[route as StatusRouteType];
}

/**
 * `changed_by` falls back to the owner's `settings.user_name` (task 1.7). An
 * explicit `null` in the body is kept as `null` (an unattributed change); only an
 * absent field defaults.
 */
function defaultChangedBy(db: Db): string | null {
  return readSettings(db).user_name ?? null;
}

interface PatchBody {
  status: StatusValue;
  notes?: string | null;
  changedBy?: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates a PATCH body. `status` is required and must be one of the three
 * lifecycle values; `notes` / `changed_by` are optional but, when present, must
 * be strings or `null`. Unknown keys are ignored.
 */
function parsePatchBody(
  body: unknown,
): { ok: true; value: PatchBody } | { ok: false; error: string } {
  if (!isPlainObject(body)) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }

  if (body.status === undefined) {
    return {
      ok: false,
      error: 'Missing status: status must be one of extracted, reviewed, verified',
    };
  }

  if (!isStatusValue(body.status)) {
    return {
      ok: false,
      error: `Invalid status ${JSON.stringify(body.status)}: status must be one of extracted, reviewed, verified`,
    };
  }

  const value: PatchBody = { status: body.status };

  if (body.notes !== undefined) {
    if (body.notes !== null && typeof body.notes !== 'string') {
      return { ok: false, error: 'Invalid notes: notes must be a string or null' };
    }
    value.notes = body.notes;
  }

  if (body.changed_by !== undefined) {
    if (body.changed_by !== null && typeof body.changed_by !== 'string') {
      return { ok: false, error: 'Invalid changed_by: changed_by must be a string or null' };
    }
    value.changedBy = body.changed_by;
  }

  return { ok: true, value };
}

export function createStatusRouter({
  db,
  readLastImport = getLastImportResult,
}: StatusRouterOptions): Router {
  const router = Router();

  // Literal first: `/_import` must never be shadowed by `/:type`.
  router.get('/_import', (_req, res) => {
    res.json(importStatusBody(readLastImport()) satisfies ImportStatusBody);
  });

  router.get('/:type', (req, res) => {
    const type = req.params.type;
    const typeError = rejectUnknownType(type, true);
    if (typeError !== undefined) {
      res.status(404).json({ error: typeError } satisfies ApiError);
      return;
    }

    // Exactly one of the three values, or nothing at all — an empty
    // `?status=`, a repeated parameter and any other value are all a 400.
    let status: StatusValue | undefined;
    if (req.query.status !== undefined) {
      if (!isStatusValue(req.query.status)) {
        res.status(400).json({
          error: `Invalid status filter "${String(
            req.query.status,
          )}": status must be one of extracted, reviewed, verified`,
        } satisfies ApiError);
        return;
      }
      status = req.query.status;
    }

    // `rejectUnknownType` above validated the segment.
    const types = resolveStatusObjectTypes(type as StatusRequestType);
    const result = listStatus(db, types, status === undefined ? {} : { status });

    res.json(result);
  });

  router.patch('/:type/:key', (req, res) => {
    const typeError = rejectUnknownType(req.params.type, false);
    if (typeError !== undefined) {
      res.status(404).json({ error: typeError } satisfies ApiError);
      return;
    }

    const parsed = parsePatchBody(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error } satisfies ApiError);
      return;
    }

    // `rejectUnknownType` above narrowed the segment to a real route type.
    const objectType = objectTypeForRoute(req.params.type);
    const updated: StatusEntryRow | undefined = applyStatusChange(db, {
      objectType,
      objectKey: req.params.key,
      status: parsed.value.status,
      notes: parsed.value.notes ?? null,
      changedBy:
        parsed.value.changedBy === undefined ? defaultChangedBy(db) : parsed.value.changedBy,
    });

    if (updated === undefined) {
      res.status(404).json({
        error: `Unknown ${req.params.type} entry "${req.params.key}"`,
      } satisfies ApiError);
      return;
    }

    res.json(updated);
  });

  router.get('/:type/:key/history', (req, res) => {
    const typeError = rejectUnknownType(req.params.type, false);
    if (typeError !== undefined) {
      res.status(404).json({ error: typeError } satisfies ApiError);
      return;
    }

    const objectType = objectTypeForRoute(req.params.type);
    const result = getStatusHistory(db, objectType, req.params.key);

    if (!result.found) {
      res.status(404).json({
        error: `Unknown ${req.params.type} entry "${req.params.key}"`,
      } satisfies ApiError);
      return;
    }

    res.json({ history: result.history });
  });

  return router;
}
