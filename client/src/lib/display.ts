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
  const id = String(templateId);
  return hasText(name) ? `${name} (${id})` : id;
}

/**
 * The display label for one row, per type (lead decision 5 / D8):
 * items & spells & drop_tables show `name`; NPCs add the template id; quests show
 * the resolved title; zones show the humanized path; strings show the value.
 */
export function formatNameRow(type: NamesType, row: NameRow): string {
  switch (type) {
    case 'items':
      return orFallback(
        (row as NameRowMap['items']).name,
        String((row as NameRowMap['items']).gid),
      );
    case 'spells': {
      const spell = row as NameRowMap['spells'];
      return orFallback(spell.name, String(spell.template_id));
    }
    case 'npcs': {
      const npc = row as NameRowMap['npcs'];
      return npcDisplayName(npc.name, npc.template_id);
    }
    case 'quests': {
      const quest = row as NameRowMap['quests'];
      return orFallback(quest.title, quest.quest_name);
    }
    case 'zones': {
      const zone = row as NameRowMap['zones'];
      if (hasText(zone.display_name)) {
        return zone.display_name;
      }
      return humanizeZone(zone.zone_path);
    }
    case 'drop_tables':
      return orFallback((row as NameRowMap['drop_tables']).name, '');
    case 'strings':
      return orFallback((row as NameRowMap['strings']).value, (row as NameRowMap['strings']).key);
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
