/**
 * Display formats for friendly names (task 1.8, decision D8; specs
 * docs/spec-domain-reference.md L694-702 and docs/spec-ui-design.md L696).
 *
 * Pure and dependency-free on purpose: this is the logic the
 * `FriendlyNameDropdown` renders through, so every rule — NPC
 * `"Name (TemplateID)"`, zone humanization, and the "a miss shows the raw key"
 * fallback (spec L693-695) — is unit-tested in node with no jsdom and no React.
 */

/** The seven friendly-name types `GET /api/names/:type` accepts (spec-api L13). */
export const NAMES_TYPES = [
  'items',
  'spells',
  'npcs',
  'quests',
  'zones',
  'drop_tables',
  'strings',
] as const;

export type NamesType = (typeof NAMES_TYPES)[number];

/** Row shapes exactly as the names API returns them (decision D36). */
export interface NameRowMap {
  items: { gid: number; name: string | null };
  spells: { template_id: number; name: string | null };
  npcs: { template_id: number; name: string | null };
  quests: { quest_name: string; title: string | null; level: number | null; is_mainline: number };
  zones: { zone_path: string; display_name: string | null; world: string | null };
  drop_tables: { name: string; description: string | null };
  strings: { key: string; value: string | null; category: string | null };
}

/** Any single row from any of the seven types. */
export type NameRow = NameRowMap[NamesType];

/** The id-like field of each type, per the D36 table. */
export function nameRowId(type: NamesType, row: NameRow): string {
  switch (type) {
    case 'items':
      return String((row as NameRowMap['items']).gid);
    case 'spells':
    case 'npcs':
      return String((row as NameRowMap['spells']).template_id);
    case 'quests':
      return (row as NameRowMap['quests']).quest_name;
    case 'zones':
      return (row as NameRowMap['zones']).zone_path;
    case 'drop_tables':
      return (row as NameRowMap['drop_tables']).name;
    case 'strings':
      return (row as NameRowMap['strings']).key;
  }
}

/** `true` when a value is a non-empty display string. */
function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Zone display name (spec-domain-reference L700-702 + lead decision 5):
 * `WizardCity/WC_Hub` → `Wizard City / WC Hub`.
 *
 * Each `/`-separated segment is humanized (underscores become spaces, camel-case
 * boundaries become spaces) and the segments are re-joined with ` / `.
 *
 * The camel-case split is what the spec's own example needs: `WizardCity` has no
 * underscore, yet the documented output is `Wizard City`. `WC_Hub` is left as
 * `WC Hub` — its upper-case run is already a word, so only `_` separates it.
 */
export function humanizeZone(raw: string): string {
  return raw
    .split('/')
    .map((segment) =>
      segment
        .replace(/_/g, ' ')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((segment) => segment !== '')
    .join(' / ');
}

/**
 * **The pair rule — the one home of `"Name (ID)"`** (D105/P6-16, spec-ui-design
 * §Names L45-81).
 *
 * Every surface that shows a friendly name beside its technical value renders it
 * through this function: `npcDisplayName` is it with a numeric id, `formatNameRow`
 * is it for the names API's rows, and the object list's key cell is it with the
 * server's `friendly_name`. A second construction of `friendly (technical)`
 * anywhere in the client is a defect, and `tests/unit/display-single-home.test.ts`
 * scans for one (with its own negative control).
 *
 * A missing/blank friendly name degrades to the **technical value alone** — never
 * an empty pair of parentheses, and never a humanised guess (spec-ui-design L65-66:
 * "a humanised key reads as a name that does not exist").
 */
export function namePair(friendlyName: string | null | undefined, technical: string): string {
  return hasText(friendlyName) ? `${friendlyName} (${technical})` : technical;
}

/**
 * The pair rule with the **identity case collapsed**: when the friendly name *is* the
 * technical value, printing `X (X)` says nothing, so the value stands alone.
 *
 * That case is real and measured: a quest whose title fell back to its own name
 * (`title_source: 'none'` — `QuestListRow.title` is "the resolved title, the raw
 * `m_questTitle` key, or `m_questName`") and a drop table whose `Name` is its key. One
 * guard, one place — {@link namePair} still owns the construction.
 */
export function namePairDistinct(
  friendlyName: string | null | undefined,
  technical: string,
): string {
  return hasText(friendlyName) && friendlyName !== technical
    ? namePair(friendlyName, technical)
    : technical;
}

/**
 * NPCs always render as `"Name (TemplateID)"` uniformly — NPCs are a flat list
 * with no type classification (spec-domain-reference L696-698).
 *
 * A missing name degrades to the bare id rather than an empty pair of
 * parentheses: the raw key is the documented fallback.
 */
export function npcDisplayName(
  name: string | null | undefined,
  templateId: string | number,
): string {
  return namePair(name, String(templateId));
}

/**
 * **The friendly half of a row's label** — the left side of the pair — or `null` when
 * the row has none (a NULL/blank column, a blank zone label with no path to humanise).
 *
 * This is the one definition of "the friendly name of a names row", and it is what the
 * subject's three consumers share: `formatNameRow` pairs it with the technical value,
 * `toNameOptions` labels an option with that pair, and an object **detail header** asks
 * the single lookup (`GET /api/names/:type/:id`) for the same half and pairs it with the
 * object key through the same rule. Two notions of "the friendly name" would let a
 * dropdown and a header disagree about the same row.
 */
export function friendlyNameOf(type: NamesType, row: NameRow): string | null {
  // **A body that is not a row is a miss, never a crash.** The single lookup is
  // documented to answer the bare row or 404 (spec-api L32-44), but a 200 carrying
  // anything else — a list envelope, an error object, an empty body — must degrade to
  // "the technical value alone" like every other miss. Measured: a mock that answered
  // every `/api/names/*` path with the seven-table envelope white-screened the
  // ZoneTransfer detail page (`humanizeZone(undefined)`), which is the Tier-1 §1 sweep's
  // 20-routes arm and the reason this guard is here rather than assumed.
  if (row === null || typeof row !== 'object') {
    return null;
  }
  switch (type) {
    case 'items':
      return textOrNull((row as NameRowMap['items']).name);
    case 'spells':
      return textOrNull((row as NameRowMap['spells']).name);
    case 'npcs':
      return textOrNull((row as NameRowMap['npcs']).name);
    case 'quests':
      return textOrNull((row as NameRowMap['quests']).title);
    case 'zones': {
      // The synced label wins; a blank one falls back to the path's humanised form
      // (`zones.display_name` is NOT NULL in the schema today, so this is the
      // documented ladder rather than a live branch).
      const zone = row as NameRowMap['zones'];
      if (hasText(zone.display_name)) {
        return zone.display_name;
      }
      return typeof zone.zone_path === 'string' ? humanizeZone(zone.zone_path) : null;
    }
    case 'drop_tables':
      return textOrNull((row as NameRowMap['drop_tables']).name);
    case 'strings':
      return textOrNull((row as NameRowMap['strings']).value);
  }
}

/** Non-empty text, else `null`. */
function textOrNull(value: string | null | undefined): string | null {
  return hasText(value) ? value : null;
}

/**
 * The display label for one row, per type (lead decision 5 / D8, extended by
 * D105/P6-16).
 *
 * The per-family table of spec-ui-design §Names L56-63 decides which types pair:
 *
 * | type                  | friendly source            | pair                                      |
 * |-----------------------|----------------------------|-------------------------------------------|
 * | `quests` (QuestTemplate) | `title`                 | **yes** — `Wizard Tours (DS-ACAD-C01-001)` |
 * | `npcs` (the four `TemplateID` families) | `name`     | **yes** — `Merle Ambrose (38168)`          |
 * | `zones` (ZoneTransfer) | `display_name`/humanizer  | **yes** — `Wizard City / WC Hub (WizardCity/WC_Hub)` |
 * | `items`, `spells`     | `name`                     | **no** — see below                         |
 * | `drop_tables`         | none: the key *is* the name | **no**                                    |
 * | `strings`             | `value`                    | **no** — a string table has no id to show  |
 *
 * `items`/`spells` are the friendly-name **sources** the object families reference
 * (a `TreasureCardInventory` names a spell; a `DropTable` names items). They are not
 * families of the §Names table, and the row already shows the only name it has; the
 * technical id is made findable instead of displayed (`?q=` matches the id column
 * for both, spec-api L59-67).
 *
 * The three families with **no** friendly source render the technical value alone
 * and say why — DropTable and GlobalRegistry permanently (`description` is NULL in
 * 316 of 317 rows; a registry key is a flag name) and CreatureSpellbook until task
 * 6.9 populates `decks` (spec-ui-design L65-69). That is a spec sentence, not a
 * humaniser: a humanised key reads as a name that does not exist.
 */
export function formatNameRow(type: NamesType, row: NameRow): string {
  const friendly = friendlyNameOf(type, row);
  switch (type) {
    case 'items':
      return orFallback(friendly, String((row as NameRowMap['items']).gid));
    case 'spells':
      return orFallback(friendly, String((row as NameRowMap['spells']).template_id));
    case 'npcs':
      // `npcDisplayName` is the pair with a numeric id; a missing name is the bare id.
      return npcDisplayName(friendly, (row as NameRowMap['npcs']).template_id);
    case 'quests':
      return namePair(friendly, (row as NameRowMap['quests']).quest_name);
    case 'zones':
      return namePair(friendly, (row as NameRowMap['zones']).zone_path);
    case 'drop_tables':
      // No pair and no humaniser: the key *is* the name (316 of 317 rows carry a
      // NULL `description`), so the technical value is the whole label.
      return orFallback(friendly, '');
    case 'strings':
      return orFallback(friendly, (row as NameRowMap['strings']).key);
  }
}

/** Non-empty text, else the documented raw fallback. */
function orFallback(value: string | null | undefined, fallback: string): string {
  return hasText(value) ? value : fallback;
}

/* ------------------------------------------------------------ relative time */

/** Second/minute/hour/day/month lengths the thresholds below use. */
const MINUTE_S = 60;
const HOUR_S = 60 * MINUTE_S;
const DAY_S = 24 * HOUR_S;
const MONTH_S = 30 * DAY_S;
const YEAR_S = 365 * DAY_S;

/** What an absent or unparsable timestamp renders as. */
export const RELATIVE_TIME_FALLBACK = '—';

/** `"1 minute ago"` / `"5 minutes ago"` — the unit's singular form when n is 1. */
function ago(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

/**
 * A timestamp as relative time — the browse table's **Modified** column (40/60/
 * 120px widths, spec-ui-design L254-262) and the mobile card's modified date.
 *
 * Thresholds (spec-silent; the spec only says "Relative time"):
 *
 * | age                       | rendered                     |
 * |---------------------------|------------------------------|
 * | < 45 s (also future/skew) | `just now`                   |
 * | < 60 min                  | `N minutes ago`              |
 * | < 24 h                    | `N hours ago`                |
 * | < 30 days                 | `N days ago`                 |
 * | < 365 days                | `N months ago` (30-day month)|
 * | otherwise                 | `N years ago` (365-day year) |
 *
 * Every boundary is one whole unit, so the label never contradicts its own unit:
 * at 60 minutes the column reads `1 hour ago`, not `60 minutes ago` (the failure
 * mode of an "under 90 minutes" minutes-branch). Deliberately **never
 * locale-formatted**: a machine-dependent date string inside a fixed 120px column
 * (and inside the tier-1 specs) would be a moving target.
 * A missing, empty or unparsable value — `modified_at` is `null` when a corpus
 * file vanished before the server stat'ed it — renders {@link RELATIVE_TIME_FALLBACK}.
 *
 * `now` is injectable so the unit tests pin every boundary without freezing time.
 */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (typeof iso !== 'string' || iso.trim() === '') {
    return RELATIVE_TIME_FALLBACK;
  }
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) {
    return RELATIVE_TIME_FALLBACK;
  }

  const seconds = (now - timestamp) / 1000;
  // A future timestamp (clock skew between the file's mtime and the browser) is
  // "just now", never "-3 minutes ago".
  if (seconds < 45) {
    return 'just now';
  }
  if (seconds < HOUR_S) {
    return ago(Math.max(1, Math.floor(seconds / MINUTE_S)), 'minute');
  }
  if (seconds < DAY_S) {
    return ago(Math.max(1, Math.floor(seconds / HOUR_S)), 'hour');
  }
  if (seconds < 30 * DAY_S) {
    return ago(Math.max(1, Math.floor(seconds / DAY_S)), 'day');
  }
  if (seconds < YEAR_S) {
    return ago(Math.max(1, Math.floor(seconds / MONTH_S)), 'month');
  }
  return ago(Math.max(1, Math.floor(seconds / YEAR_S)), 'year');
}

/**
 * The label shown for a selected value.
 *
 * `row` is the single-lookup result (`GET /api/names/:type/:id`); when the lookup
 * missed — unknown id, or a `strings` key that has no entry — the **raw key/id is
 * rendered as-is and no error is raised** (spec-domain-reference L693-695).
 */
export function formatNameValue(
  type: NamesType,
  id: string | number,
  row: NameRow | undefined,
): string {
  if (row === undefined) {
    return String(id);
  }
  return formatNameRow(type, row) || String(id);
}

/** One selectable option: raw id (what the hidden field stores) + label + search text. */
export interface NameOption {
  id: string;
  label: string;
  /** Lower-cased `"<label> <id>"` so a search for an id finds the row too. */
  keywords: string;
}

/** Builds the option list for one type's cached rows. */
export function toNameOptions(type: NamesType, rows: readonly NameRow[]): NameOption[] {
  return rows.map((row) => {
    const id = nameRowId(type, row);
    const label = formatNameRow(type, row) || id;
    return { id, label, keywords: `${label} ${id}`.toLowerCase() };
  });
}
