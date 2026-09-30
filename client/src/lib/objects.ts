import { mountPathFor, objectTypeConfig, type ObjectTypeConfig } from '@shared/objectTypes';
import { ULong } from '@shared/ulong';

import { apiFetch, type StatusRouteType, type StatusValue } from './api';
import type { ObjectStatusSummary } from './object-list';

/**
 * The generic object API client — task 4.1.
 *
 * One set of functions for the eight families, driven by the same
 * `shared/objectTypes.ts` row the server mounts from, so a client page can never
 * call a path the server does not serve.
 *
 * The row shapes mirror the server's (`server/src/services/objects.ts`)
 * field for field — `objects[]`, `summary`, `skipped`, `missing_directory`,
 * `duplicate_keys` — including the tolerances the corpus measured: a missing
 * directory is a legitimate empty list, a family with no lifecycle has
 * `summary: null` and `status: null` per row, and a file that could not be parsed
 * arrives in `skipped[]` instead of failing the request (D12: the list is a fresh
 * scan per request, which for ~2,000 files is what "no caching" costs).
 */

/** One `objects[]` row — the server's `ObjectListRow` mirrored. */
export interface ObjectListRow {
  /** The key in its canonical text form (`ULong.toKey` for a `TemplateID` family). */
  key: string;
  /** Display title: equal to `key` for all eight families — the pair is `friendly_name`. */
  title: string;
  /**
   * The family's friendly name, resolved **server-side** from `npcs`/`zones`
   * (D105/P6-16), or `null` when there is none. The client pairs it with `key`
   * through `display.ts`'s one rule — the server emits data and never formats.
   */
  friendly_name: string | null;
  modified_at: string | null;
  /** `null` for a family with no lifecycle (GlobalRegistry, Q1). */
  status: StatusValue | null;
}

/** A file that could not be read or keyed, reported rather than fatal. */
export interface ObjectListSkipped {
  /** Path relative to the SpiralDB root. */
  file: string;
  message: string;
}

/** `GET /api/<type>` response envelope. */
export interface ObjectListResponse {
  objects: ObjectListRow[];
  /** `null` for a family with no lifecycle. */
  summary: ObjectStatusSummary | null;
  skipped: ObjectListSkipped[];
  /** `true` when the family's directory is absent (`NpcDropTable/` today). */
  missing_directory: boolean;
  duplicate_keys: string[];
}

/** `POST /api/<type>` response body, mirroring the server's snake_case result. */
export interface ObjectSaveResult {
  key: string;
  file_type: string;
  object_type: string | null;
  outcome: 'created' | 'updated';
  action: 'create' | 'extract' | 'update';
  commit: string;
  branch: string;
  commit_message: string;
  file: string;
  status: unknown;
  status_created: boolean;
  warnings: string[];
}

/** The request body a save sends (the same envelope the quests API uses). */
export interface ObjectSaveBody {
  object: Record<string, unknown>;
  notes?: string;
  key?: string;
}

/** TanStack Query key for one family's list. */
export function objectListQueryKey(config: ObjectTypeConfig): readonly unknown[] {
  return ['objects', config.fileType];
}

/** TanStack Query key for one entry's document. */
export function objectDetailQueryKey(config: ObjectTypeConfig, key: string): readonly unknown[] {
  return ['object', config.fileType, key];
}

/** `GET /api/<type>` — the browse list (one fresh scan per request, D12). */
export function listObjects(config: ObjectTypeConfig): Promise<ObjectListResponse> {
  return apiFetch<ObjectListResponse>(config.urlPath);
}

/** `GET /api/<type>/:key` — one document, exactly what a save round-trips. */
export function getObject(config: ObjectTypeConfig, key: string): Promise<Record<string, unknown>> {
  return apiFetch<Record<string, unknown>>(objectDetailApiPath(config, key));
}

/** `POST /api/<type>` — one save (`spiraldb: {create|update} …` + status upsert on create). */
export function saveObject(
  config: ObjectTypeConfig,
  body: ObjectSaveBody,
): Promise<ObjectSaveResult> {
  return apiFetch<ObjectSaveResult>(config.urlPath, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** The API path of one entry. */
export function objectDetailApiPath(config: ObjectTypeConfig, key: string): string {
  return `${config.urlPath}/${encodeURIComponent(key)}`;
}

/** The frontend route of one entry (`/npc-inventories/1025`). */
export function objectDetailPath(config: ObjectTypeConfig, key: string): string {
  return `${mountPathFor(config)}/${encodeURIComponent(key)}`;
}

/** The DropTable editor's route for one table name (`/drop-tables/DS-ACAD-C01-001`). */
export function dropTablePath(name: string): string {
  return `${mountPathFor(objectTypeConfig('droptable'))}/${encodeURIComponent(name)}`;
}

/** The frontend route of a family's list (`/npc-inventories`). */
export function objectListPath(config: ObjectTypeConfig): string {
  return mountPathFor(config);
}

/**
 * The display key of a raw JSON key value: the canonical text for a `'ulong'`
 * family (`shared/ulong.ts` — the one conversion point), a trimmed string
 * otherwise. `''` when there is no usable key, which the detail page renders as
 * "not found" rather than fetching a blank path.
 */
export function displayKeyFor(config: ObjectTypeConfig, rawValue: unknown): string {
  if (config.keyType === 'ulong') {
    return ULong.toKey(rawValue) ?? '';
  }
  return typeof rawValue === 'string' ? rawValue.trim() : '';
}

/** The status route type a family's status lives under, or `undefined` for GlobalRegistry. */
export function statusRouteTypeFor(config: ObjectTypeConfig): StatusRouteType | undefined {
  return config.routeType === null ? undefined : config.routeType;
}
