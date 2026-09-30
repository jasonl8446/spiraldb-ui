/**
 * Navigation + route tables (task 1.8, decision D39 item 7).
 *
 * One home for three things the shell must agree on:
 *
 * 1. the sidebar groups and items, exactly as `docs/spec-ui-design.md` L73-93
 *    lists them, each with the Lucide icon name it renders (18px);
 * 2. every frontend route in `docs/spec-api.md` L325-350, with the page title the
 *    sticky header shows and the phase that will build the page;
 * 3. the pure matcher used for both ("which route is this path, what is its
 *    title, which stub phase does it announce").
 *
 * Icons are stored as names, not components, so this module stays pure data and
 * is unit-testable in node without pulling React into the test process; the
 * sidebar maps names to components in one place.
 */

/** Every Lucide icon the sidebar uses; resolved to a component by `Sidebar`. */
export type NavIconName =
  | 'bar-chart-3'
  | 'swords'
  | 'package'
  | 'settings'
  | 'layout-dashboard'
  | 'upload'
  | 'list-checks'
  | 'library'
  | 'file-pen'
  | 'backpack'
  | 'sparkles'
  | 'book-open'
  | 'boxes'
  | 'layers'
  | 'map'
  | 'globe'
  | 'refresh-cw';

export interface NavItem {
  /** Route path this item navigates to. */
  path: string;
  label: string;
  icon: NavIconName;
}

export interface NavGroup {
  id: 'overview' | 'quests' | 'data' | 'settings';
  /** Group header text, upper-case exactly as the spec writes it. */
  label: string;
  icon: NavIconName;
  items: readonly NavItem[];
}

/**
 * Sidebar navigation — OVERVIEW / QUESTS / DATA / SETTINGS
 * (docs/spec-ui-design.md L73-93). Every group is collapsible.
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: 'overview',
    label: 'OVERVIEW',
    icon: 'bar-chart-3',
    items: [{ path: '/', label: 'Dashboard', icon: 'layout-dashboard' }],
  },
  {
    id: 'quests',
    label: 'QUESTS',
    icon: 'swords',
    items: [
      { path: '/quests/extract', label: 'Extract Quests', icon: 'upload' },
      { path: '/quests', label: 'Browse Quests', icon: 'list-checks' },
      // Task 6.10 / story p6-11: the spec's QUESTS group ends with Catalog
      // (docs/spec-ui-design.md L148-152), which is the worklist over the catalog.
      { path: '/quests/catalog', label: 'Catalog', icon: 'library' },
      // Task 7.7 / story p7-08 (D144): the draft review queue, after Catalog.
      { path: '/drafts', label: 'Drafts', icon: 'file-pen' },
      // Task 7.12 / story p7-13 (D144): the glossary, after Drafts.
      { path: '/glossary', label: 'Glossary', icon: 'book-open' },
    ],
  },
  {
    id: 'data',
    label: 'DATA',
    icon: 'package',
    items: [
      { path: '/drop-tables', label: 'Drop Tables', icon: 'package' },
      { path: '/npc-inventories', label: 'NPC Inventories', icon: 'backpack' },
      { path: '/npc-spell-inventories', label: 'NPC Spell Inventories', icon: 'sparkles' },
      { path: '/creature-spellbooks', label: 'Creature Spellbooks', icon: 'book-open' },
      { path: '/npc-drop-tables', label: 'NPC Drop Tables', icon: 'boxes' },
      { path: '/treasure-card-inventories', label: 'Treasure Card Inventory', icon: 'layers' },
      { path: '/zone-transfers', label: 'Zone Transfers', icon: 'map' },
      { path: '/global-registry', label: 'Global Registry', icon: 'globe' },
    ],
  },
  {
    id: 'settings',
    label: 'SETTINGS',
    icon: 'settings',
    items: [{ path: '/settings', label: 'Sync Friendly Names', icon: 'refresh-cw' }],
  },
];

/** One route from the `docs/spec-api.md` L325-350 table. */
export interface AppRoute {
  /** Route pattern; `:param` segments are dynamic. */
  path: string;
  /** Header page title for a match. */
  title: string;
  /**
   * Phase that built the page. **Historically the stub announcement** (decision D39
   * item 7): every route now has a real page — chosen by path in `App.tsx`, whose last
   * stub branch story p5-08 deleted — so this value is provenance, not a rendering
   * switch, and `tests/unit/ui-shell.test.ts` is what pins it.
   */
  phase: number;
}

/**
 * The complete frontend route table. Order matters for matching: static paths
 * precede the dynamic patterns that could shadow them (`/quests/extract` before
 * `/quests/:questName`).
 *
 * Phase mapping (lead decision 7): Dashboard → 5; quests → 2 (the browse list and the
 * detail route were both built in Phase 2 — the editors Phase 3 added inside the detail
 * page do not re-stamp its owner phase); Catalog → 6 (task 6.10's own view); the eight
 * other object editors → 4; Settings → 1.
 */
export const APP_ROUTES: readonly AppRoute[] = [
  { path: '/', title: 'Dashboard', phase: 5 },

  { path: '/quests/extract', title: 'Extract Quests', phase: 2 },
  { path: '/quests', title: 'Browse Quests', phase: 2 },
  // Static before the dynamic pattern that would shadow it (spec-api.md L1023-1027): the
  // Catalog view is Phase 6's (task 6.10), and `/quests/:questName` stays after it.
  { path: '/quests/catalog', title: 'Quest Catalog', phase: 6 },
  { path: '/quests/:questName', title: 'Quest Detail', phase: 2 },

  // Task 7.7 / story p7-08: the draft queue and the two file-less draft editors (D165).
  { path: '/drafts', title: 'Drafts', phase: 7 },
  { path: '/drafts/quest/:questName', title: 'Draft Quest', phase: 7 },
  { path: '/drafts/id/:questId', title: 'Draft Quest', phase: 7 },
  { path: '/glossary', title: 'Glossary', phase: 7 },

  { path: '/drop-tables', title: 'Drop Tables', phase: 4 },
  { path: '/drop-tables/:name', title: 'Drop Table Detail', phase: 4 },
  { path: '/npc-inventories', title: 'NPC Inventories', phase: 4 },
  { path: '/npc-inventories/:id', title: 'NPC Inventory Detail', phase: 4 },
  { path: '/npc-spell-inventories', title: 'NPC Spell Inventories', phase: 4 },
  { path: '/npc-spell-inventories/:id', title: 'NPC Spell Inventory Detail', phase: 4 },
  { path: '/creature-spellbooks', title: 'Creature Spellbooks', phase: 4 },
  { path: '/creature-spellbooks/:name', title: 'Creature Spellbook Detail', phase: 4 },
  { path: '/npc-drop-tables', title: 'NPC Drop Tables', phase: 4 },
  { path: '/npc-drop-tables/:id', title: 'NPC Drop Table Detail', phase: 4 },
  { path: '/treasure-card-inventories', title: 'Treasure Card Inventory', phase: 4 },
  { path: '/treasure-card-inventories/:id', title: 'Treasure Card Inventory Detail', phase: 4 },
  { path: '/zone-transfers', title: 'Zone Transfers', phase: 4 },
  { path: '/zone-transfers/:name', title: 'Zone Transfer Detail', phase: 4 },
  { path: '/global-registry', title: 'Global Registry', phase: 4 },

  { path: '/settings', title: 'Settings', phase: 1 },
];

/** What the shell knows about a pathname. */
export interface RouteMatch {
  /** The matched route pattern (or `undefined` for an unknown path). */
  route: AppRoute | undefined;
  title: string;
}

const NOT_FOUND_TITLE = 'Not found';

/** Compiles one route pattern into an anchored regex (`:param` → one segment). */
function patternToRegExp(pattern: string): RegExp {
  const source = pattern
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        return '[^/]+';
      }
      // Escape nothing else: route segments are literal slugs, but a literal
      // segment could contain regex metacharacters in principle.
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return new RegExp(`^${source}/?$`);
}

/**
 * Matches a pathname against the route table.
 *
 * Exact (static) patterns win over dynamic ones regardless of order, so
 * `/quests/extract` can never be swallowed by `/quests/:questName`. Unknown paths
 * answer `Not found` — the 404 page.
 */
export function matchRoute(pathname: string): RouteMatch {
  const exact = APP_ROUTES.find(
    (route) => !route.path.includes(':') && patternToRegExp(route.path).test(pathname),
  );
  if (exact !== undefined) {
    return { route: exact, title: exact.title };
  }

  const dynamic = APP_ROUTES.find(
    (route) => route.path.includes(':') && patternToRegExp(route.path).test(pathname),
  );
  if (dynamic !== undefined) {
    return { route: dynamic, title: dynamic.title };
  }

  return { route: undefined, title: NOT_FOUND_TITLE };
}

/** Header page title for a pathname. */
export function pageTitleForPath(pathname: string): string {
  return matchRoute(pathname).title;
}

/**
 * Sidebar items, flattened — used to decide "open the parent of the active
 * route" (e.g. a quest detail page keeps QUESTS expanded).
 */
export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** Drops trailing slashes, so `/settings/` and `/settings` name the same page. */
function normalizePathname(pathname: string): string {
  return pathname === '/' ? pathname : pathname.replace(/\/+$/, '');
}

/**
 * The nav item to highlight for a pathname — **exactly one**, or `null` for none.
 *
 * `docs/spec-ui-design.md` L85-89 describes a single active item, so the sidebar
 * derives its highlight from this function instead of react-router's `NavLink`, whose
 * `isActive` prefix-matches: on `/quests/extract` that lit up both `/quests/extract`
 * and `/quests` (the defect story p1-13 pinned). Adding `end` to every link would only
 * trade that case for the next one, because a detail route
 * (`/quests/DS-ACAD-C01-001`) has no nav item of its own and *must* keep highlighting
 * the list item that owns it.
 *
 * The rule, in order:
 *
 * 1. an exact match wins — `/quests/extract` belongs to `/quests/extract`, never to
 *    `/quests`, even though both are prefixes;
 * 2. otherwise the longest segment-aligned prefix owns the pathname —
 *    `/quests/DS-ACAD-C01-001` → `/quests`, `/drop-tables/ABC` → `/drop-tables`;
 * 3. `/` owns only `/`;
 * 4. "segment-aligned" means the match ends on a `/`, so `/questsfoo` is owned by
 *    nothing;
 * 5. a trailing slash is normalized away (`/settings/` → `/settings`).
 *
 * `null` means no nav item owns the pathname (an unknown route), so nothing is
 * highlighted.
 */
export function activeNavPath(pathname: string): string | null {
  const path = normalizePathname(pathname);
  let best: string | null = null;
  for (const item of NAV_ITEMS) {
    const owns =
      item.path === '/' ? path === '/' : path === item.path || path.startsWith(`${item.path}/`);
    if (owns && (best === null || item.path.length > best.length)) {
      best = item.path;
    }
  }
  return best;
}

/** The sidebar group a path belongs to, so it can be force-expanded. */
export function activeNavGroupId(pathname: string): NavGroup['id'] | undefined {
  const active = activeNavPath(pathname);
  if (active === null) {
    return undefined;
  }
  return NAV_GROUPS.find((group) => group.items.some((item) => item.path === active))?.id;
}
