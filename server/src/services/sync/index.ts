/**
 * Friendly-name sync pipeline — tasks 1.4b–1.4g.
 *
 * The parsers (1.4b–1.4e) do no database I/O and write nothing outside an unpack
 * tree. `runSync` (1.4f) orchestrates them into **one** transaction over the
 * seven friendly-name tables plus the `success` `sync_history` row, with a
 * separate transaction for the `failed` row; `createSyncRouter` (1.4g) and
 * `runSyncCli` (1.4g / `npm run sync`) both drive that single orchestrator.
 *
 * Pipeline order:
 *
 * ```
 * resolveRevision()  →  runUnpack()  →  scanLangDir()  →  scanTemplateTree()
 *                                    ↘  buildQuestRows() / buildZoneRows() / buildDropTableRows()
 *                                    →  runSync(): DELETE ×7 + bulk INSERT + sync_history
 * ```
 */
export {
  REVISION_PREFIX,
  ROOT_WAD_RELATIVE_PATH,
  compareRevisionNames,
  defaultRevisionPathProbe,
  isRevisionName,
  resolveRevision,
  sortRevisionsDescending,
  type ResolveRevisionOptions,
  type RevisionInfo,
  type RevisionPathProbe,
} from './revision.js';

export {
  DEFAULT_UNPACK_MAX_BUFFER_BYTES,
  DEFAULT_UNPACK_TIMEOUT_MS,
  TEMP_DIR_PREFIX,
  UNPACK_ARGV_PREFIX,
  UnpackError,
  buildUnpackArgs,
  defaultExecFile,
  hasUnpackTree,
  runUnpack,
  type ExecFileLike,
  type RunUnpackOptions,
  type RunUnpackResult,
} from './unpack.js';

export {
  UTF16BE_BOM,
  UTF16LE_BOM,
  createKeyLookup,
  decodeLangBuffer,
  defaultLangDirDeps,
  formatLangKey,
  langEntryCount,
  langKeyCategory,
  langKeyForm,
  langKeySuffix,
  langKeyToIndex,
  parseLangBuffer,
  resolveLangKey,
  scanLangDir,
  type LangEntryMaps,
  type LangKeyForm,
  type LangLookup,
  type LangTable,
  type ParseLangOptions,
  type ScanLangDirOptions,
  type ScanLangDirResult,
} from './lang.js';

export {
  ITEM_CLASSES,
  MOUNT_CLASSES,
  NPC_CLASSES,
  PET_CLASSES,
  SPELL_CLASSES,
  TEMPLATE_SCAN_ROOTS,
  classifyTemplateClass,
  defaultTemplateScanDeps,
  extractTemplateRow,
  scanTemplateTree,
  type ExtractTemplateOptions,
  type ItemRow,
  type NpcRow,
  type ScanTemplateTreeOptions,
  type SpellRow,
  type TemplateFamily,
  type TemplateIdSource,
  type TemplateNameSource,
  type TemplateRow,
  type TemplateScanResult,
} from './templates.js';

export {
  buildDropTableRows,
  buildQuestRows,
  buildZoneRows,
  defaultCorpusDeps,
  humanizeZonePath,
  zoneWorld,
  type BuildDropTableRowsOptions,
  type BuildQuestRowsOptions,
  type BuildResult,
  type BuildZoneRowsOptions,
  type CorpusDeps,
  type CorpusFileError,
  type DropTableRow,
  type QuestRow,
  type QuestTitleSource,
  type ZoneRow,
} from './corpus.js';

export { isPlainObject, parseJsonLenient } from './json.js';

export { buildStringTableRows, type StringTableRow } from './stringtable.js';

export { createStringLookup, lookupCandidates, lookupString } from './lookup.js';

export {
  ZERO_SYNC_COUNTS,
  ZERO_SYNC_DEDUPE,
  defaultSyncDeps,
  formatSyncTimestamp,
  recordSyncFailure,
  runSync,
  type RunSyncOptions,
  type RunSyncResult,
  type SyncCounts,
  type SyncDedupe,
  type SyncDeps,
  type SyncOverrides,
  type SyncRunner,
  type SyncStatus,
  type SyncTimings,
} from './execute.js';

export {
  SYNC_USAGE,
  formatSyncSummary,
  parseSyncArgs,
  runSyncCli,
  type CliSyncRunner,
  type SyncCliArgs,
  type SyncCliOptions,
} from './cli.js';
