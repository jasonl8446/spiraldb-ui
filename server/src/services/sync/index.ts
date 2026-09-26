/**
 * Friendly-name sync pipeline — tasks 1.4b–1.4e.
 *
 * Task 1.4f (transactional replace + `sync_history`) and 1.4g (API + `npm run
 * sync` wiring) are the next story (p1-06); they consume these modules, which
 * perform no I/O against the database and no writes outside a temp tree.
 *
 * Pipeline order:
 *
 * ```
 * resolveRevision()  →  runUnpack()  →  scanLangDir()  →  scanTemplateTree()
 *                                    ↘  buildQuestRows() / buildZoneRows() / buildDropTableRows()
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
