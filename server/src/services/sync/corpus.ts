import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { isPlainObject, parseJsonLenient } from './json.js';

/**
 * Corpus-derived rows — task 1.4d, decision **D21** (owner-approved).
 *
 * Two friendly-name tables have no WAD source and are derived from the SpiralDB
 * corpus instead ([plan-phase-1-foundation.md](../../../../docs/plan-phase-1-foundation.md) §1.4d):
 *
 * - `quests` — scan `QuestTemplates/*.json` for `m_questName`, `m_questLevel`,
 *   `m_mainline`; the title is a string-table lookup of `m_questTitle` with the
 *   raw-key fallback.
 * - `zones` — all distinct `ZoneName` + `m_destinationZone` values across the
 *   1,207 `ZoneTransfer/*.json` files; `display_name` is the humanized path
 *   ([spec-domain-reference.md](../../../../docs/spec-domain-reference.md) L700-702).
 *
 * `drop_tables` rows come from the `DropTables/*.json` corpus (`Name` +
 * `Description`, [spec-data-model.md] L121-126).
 *
 * **Every corpus file is JSON5 territory**: only 16 of 322 quest files are strict
 * JSON, the rest carry trailing commas ([spec-data-model.md] L234-246), so the
 * default `parse` is `parseJsonLenient` (strict first, JSON5 recovery).
 */

export interface CorpusDeps {
  readdir: (dir: string) => Promise<string[]>;
  readFile: (file: string) => Promise<string>;
}

export const defaultCorpusDeps: CorpusDeps = {
  readdir: (dir) => readdir(dir),
  readFile: (file) => readFile(file, 'utf8'),
};

export interface CorpusFileError {
  file: string;
  message: string;
}

export interface BuildResult<T> {
  rows: T[];
  /** Files read (successfully or not). */
  files: number;
  parseErrors: CorpusFileError[];
}

/** How a quest title was obtained. */
export type QuestTitleSource = 'resolved' | 'rawKey' | 'missing';

export interface QuestRow {
  quest_name: string;
  /** Never empty — falls back to the raw key, then to `m_questName`. */
  title: string;
  level: number | null;
  is_mainline: boolean;
  /** The raw `m_questTitle` value (`QuestTitle_1ED8A`) when present. */
  titleKey: string | null;
  titleSource: QuestTitleSource;
}

export interface ZoneRow {
  /** `ZoneName` or `m_destinationZone`, e.g. `WizardCity/WC_Hub`. */
  zone_path: string;
  /** Humanized path, e.g. `Wizard City / WC Hub`. */
  display_name: string;
  /** First path segment, e.g. `WizardCity`. */
  world: string | null;
}

export interface DropTableRow {
  name: string;
  description: string | null;
}

/**
 * `WizardCity/WC_Hub` → `Wizard City / WC Hub`
 * ([spec-domain-reference.md] L700-702).
 *
 * The spec's prose says "converting underscores and slashes to spaces", but its
 * own worked example also splits the CamelCase segment (`WizardCity` → `Wizard
 * City`), so the rule implemented here is the example: underscores become
 * spaces, each path segment is split at CamelCase boundaries, and segments are
 * rejoined with ` / `.
 */
export function humanizeZonePath(zonePath: string): string {
  return zonePath
    .split('/')
    .map((segment) =>
      segment
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((segment) => segment !== '')
    .join(' / ');
}

/** First path segment of a zone path (`WizardCity/WC_Hub` → `WizardCity`). */
export function zoneWorld(zonePath: string): string | null {
  const [first] = zonePath.split('/');
  const world = first?.trim();
  return world ? world : null;
}

async function readCorpusDir(
  dir: string,
  deps: CorpusDeps,
): Promise<{ files: string[]; error?: CorpusFileError }> {
  try {
    const names = (await deps.readdir(dir)).filter((name) => name.endsWith('.json')).sort();
    return { files: names.map((name) => path.join(dir, name)) };
  } catch (error) {
    // A missing directory is tolerated by the first-startup import too
    // ([plan-phase-1-foundation.md] §1.6: `NpcDropTable/` does not exist today).
    return {
      files: [],
      error: { file: dir, message: error instanceof Error ? error.message : String(error) },
    };
  }
}

async function readDocuments(
  files: readonly string[],
  deps: CorpusDeps,
  parse: (text: string) => unknown,
  concurrency: number,
): Promise<{ docs: Array<{ file: string; doc: unknown }>; errors: CorpusFileError[] }> {
  const docs: Array<{ file: string; doc: unknown }> = [];
  const errors: CorpusFileError[] = [];
  for (let offset = 0; offset < files.length; offset += concurrency) {
    const batch = files.slice(offset, offset + concurrency);
    const parsed = await Promise.all(
      batch.map(async (file) => {
        try {
          return { file, doc: parse(await deps.readFile(file)) };
        } catch (error) {
          errors.push({ file, message: error instanceof Error ? error.message : String(error) });
          return undefined;
        }
      }),
    );
    for (const entry of parsed) {
      if (entry) {
        docs.push(entry);
      }
    }
  }
  return { docs, errors };
}

export interface BuildQuestRowsOptions {
  questTemplatesDir: string;
  /** String-table lookup for `m_questTitle`; `undefined` → raw-key fallback. */
  lookupTitle?: (key: string) => string | undefined;
  deps?: Partial<CorpusDeps>;
  parse?: (text: string) => unknown;
  concurrency?: number;
}

/**
 * `quests` rows from `QuestTemplates/*.json` (D21).
 *
 * `m_questTitle` is absent on 7 of the 322 files; those rows take `m_questName`
 * as the title and report `titleSource: 'missing'`.
 */
export async function buildQuestRows(
  options: BuildQuestRowsOptions,
): Promise<
  BuildResult<QuestRow> & { resolvedTitles: number; rawKeyFallbacks: number; missingTitles: number }
> {
  const deps: CorpusDeps = { ...defaultCorpusDeps, ...options.deps };
  const parse = options.parse ?? parseJsonLenient;
  const { files, error } = await readCorpusDir(options.questTemplatesDir, deps);
  const { docs, errors } = await readDocuments(files, deps, parse, options.concurrency ?? 24);
  if (error) {
    errors.push(error);
  }

  const byName = new Map<string, QuestRow>();
  let resolvedTitles = 0;
  let rawKeyFallbacks = 0;
  let missingTitles = 0;

  for (const { doc } of docs) {
    if (!isPlainObject(doc)) {
      continue;
    }
    const questName = typeof doc.m_questName === 'string' ? doc.m_questName.trim() : '';
    if (questName === '') {
      continue;
    }
    const titleKey =
      typeof doc.m_questTitle === 'string' && doc.m_questTitle.trim() !== ''
        ? doc.m_questTitle.trim()
        : null;

    let title: string;
    let titleSource: QuestTitleSource;
    if (titleKey === null) {
      title = questName;
      titleSource = 'missing';
      missingTitles += 1;
    } else {
      const resolved = options.lookupTitle?.(titleKey);
      if (resolved !== undefined && resolved !== '') {
        title = resolved;
        titleSource = 'resolved';
        resolvedTitles += 1;
      } else {
        title = titleKey;
        titleSource = 'rawKey';
        rawKeyFallbacks += 1;
      }
    }

    const level = typeof doc.m_questLevel === 'number' ? doc.m_questLevel : null;
    byName.set(questName, {
      quest_name: questName,
      title,
      level,
      is_mainline: doc.m_mainline === true,
      titleKey,
      titleSource,
    });
  }

  const rows = [...byName.values()].sort((a, b) => a.quest_name.localeCompare(b.quest_name));
  return {
    rows,
    files: files.length,
    parseErrors: errors,
    resolvedTitles,
    rawKeyFallbacks,
    missingTitles,
  };
}

/** Recursively collects every `m_destinationZone` string in a document. */
function collectDestinationZones(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectDestinationZones(item, out);
    }
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'm_destinationZone' && typeof child === 'string' && child.trim() !== '') {
      out.add(child.trim());
      continue;
    }
    collectDestinationZones(child, out);
  }
}

export interface BuildZoneRowsOptions {
  zoneTransferDir: string;
  deps?: Partial<CorpusDeps>;
  parse?: (text: string) => unknown;
  concurrency?: number;
}

/**
 * `zones` rows from `ZoneTransfer/*.json` (D21): the distinct `ZoneName` plus
 * every `m_destinationZone` reachable from a file (the `Teleports[].Teleport`
 * objects carry them; the recursive walk also picks up any inside `Events`).
 */
export async function buildZoneRows(options: BuildZoneRowsOptions): Promise<BuildResult<ZoneRow>> {
  const deps: CorpusDeps = { ...defaultCorpusDeps, ...options.deps };
  const parse = options.parse ?? parseJsonLenient;
  const { files, error } = await readCorpusDir(options.zoneTransferDir, deps);
  const { docs, errors } = await readDocuments(files, deps, parse, options.concurrency ?? 24);
  if (error) {
    errors.push(error);
  }

  const paths = new Set<string>();
  for (const { doc } of docs) {
    if (!isPlainObject(doc)) {
      continue;
    }
    const zoneName = typeof doc.ZoneName === 'string' ? doc.ZoneName.trim() : '';
    if (zoneName !== '') {
      paths.add(zoneName);
    }
    collectDestinationZones(doc, paths);
  }

  const rows = [...paths]
    .sort((a, b) => a.localeCompare(b))
    .map((zonePath) => ({
      zone_path: zonePath,
      display_name: humanizeZonePath(zonePath),
      world: zoneWorld(zonePath),
    }));
  return { rows, files: files.length, parseErrors: errors };
}

export interface BuildDropTableRowsOptions {
  dropTablesDir: string;
  deps?: Partial<CorpusDeps>;
  parse?: (text: string) => unknown;
  concurrency?: number;
}

/** `drop_tables` rows from `DropTables/*.json` (`Name`, optional `Description`). */
export async function buildDropTableRows(
  options: BuildDropTableRowsOptions,
): Promise<BuildResult<DropTableRow>> {
  const deps: CorpusDeps = { ...defaultCorpusDeps, ...options.deps };
  const parse = options.parse ?? parseJsonLenient;
  const { files, error } = await readCorpusDir(options.dropTablesDir, deps);
  const { docs, errors } = await readDocuments(files, deps, parse, options.concurrency ?? 24);
  if (error) {
    errors.push(error);
  }

  const byName = new Map<string, DropTableRow>();
  for (const { doc } of docs) {
    if (!isPlainObject(doc)) {
      continue;
    }
    const name = typeof doc.Name === 'string' ? doc.Name.trim() : '';
    if (name === '') {
      continue;
    }
    const description = typeof doc.Description === 'string' ? doc.Description : '';
    byName.set(name, { name, description: description === '' ? null : description });
  }

  const rows = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { rows, files: files.length, parseErrors: errors };
}
