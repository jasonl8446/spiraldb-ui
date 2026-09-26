import {
  Backpack,
  BarChart3,
  BookOpen,
  Boxes,
  ChevronDown,
  Globe,
  Layers,
  LayoutDashboard,
  ListChecks,
  Map as MapIcon,
  Package,
  RefreshCw,
  Settings,
  Sparkles,
  Swords,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { APP_NAME } from '@shared/index';

import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { activeNavGroupId, activeNavPath, NAV_GROUPS, type NavIconName } from '../../lib/routes';
import { swipeShouldClose } from '../../lib/swipe';
import { cn } from '../../lib/utils';

/**
 * Sidebar navigation (docs/spec-ui-design.md L60-97).
 *
 * 260px fixed, full viewport height, `zinc-900` on a `zinc-800` right border, with
 * four collapsible groups (OVERVIEW / QUESTS / DATA / SETTINGS) whose items carry
 * 18px Lucide icons. The active item gets `blue-600/10` + `blue-400` text; hover
 * is `zinc-800` (spec L85-89).
 *
 * Which item is active comes from `activeNavPath(pathname)` — a single path or
 * `null` — and never from `NavLink`'s own `isActive`, which prefix-matches and so
 * highlighted `/quests` as well as `/quests/extract`. `Link` is enough here because
 * the highlight and `aria-current="page"` are both derived from that one value, so
 * exactly one item can ever be active.
 *
 * Mobile (< md): the same navigation renders inside a Radix dialog — a real
 * overlay that traps focus, closes on Escape and outer click, and hides the rest
 * of the page from assistive tech, so it never blocks navigation (spec
 * L97/L540-550). The gesture baseline from the spec ("swipe-to-close") is
 * implemented with the pure `swipeShouldClose` helper.
 */

/** Icon name → component, in one place so `lib/routes.ts` stays pure data. */
const NAV_ICONS: Record<NavIconName, LucideIcon> = {
  'bar-chart-3': BarChart3,
  swords: Swords,
  package: Package,
  settings: Settings,
  'layout-dashboard': LayoutDashboard,
  upload: Upload,
  'list-checks': ListChecks,
  backpack: Backpack,
  sparkles: Sparkles,
  'book-open': BookOpen,
  boxes: Boxes,
  layers: Layers,
  map: MapIcon,
  globe: Globe,
  'refresh-cw': RefreshCw,
};

const ICON_SIZE = 18;

const ITEM_BASE =
  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950';

/** The nav list itself — shared by the desktop rail and the mobile overlay. */
function NavContent({ onNavigate }: { onNavigate?: () => void }): JSX.Element {
  const { pathname } = useLocation();
  const activePath = activeNavPath(pathname);
  const activeGroup = activeNavGroupId(pathname);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // A route change opens the group that contains the new active item, so the
  // highlight is never hidden behind a collapsed header.
  useEffect(() => {
    if (activeGroup === undefined) {
      return;
    }
    setCollapsed((previous) =>
      previous[activeGroup] === false ? previous : { ...previous, [activeGroup]: false },
    );
  }, [activeGroup]);

  return (
    <nav aria-label="Main navigation" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
      {NAV_GROUPS.map((group) => {
        const GroupIcon = NAV_ICONS[group.icon];
        const isCollapsed = collapsed[group.id] === true;
        return (
          <div key={group.id} className="pb-1">
            <button
              type="button"
              onClick={() =>
                setCollapsed((previous) => ({ ...previous, [group.id]: !isCollapsed }))
              }
              aria-expanded={!isCollapsed}
              aria-controls={`nav-group-${group.id}`}
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
              )}
            >
              <GroupIcon size={ICON_SIZE} aria-hidden="true" className="shrink-0" />
              <span className="flex-1 text-left">{group.label}</span>
              <ChevronDown
                size={16}
                aria-hidden="true"
                className={cn('shrink-0 transition-transform', isCollapsed && '-rotate-90')}
              />
            </button>

            {isCollapsed ? null : (
              <ul id={`nav-group-${group.id}`} className="mt-1 space-y-1">
                {group.items.map((item) => {
                  const ItemIcon = NAV_ICONS[item.icon];
                  // At most one item satisfies this, by construction: `activePath` is
                  // a single path and nav paths are unique.
                  const isActive = item.path === activePath;
                  return (
                    <li key={item.path}>
                      <Link
                        to={item.path}
                        onClick={onNavigate}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          ITEM_BASE,
                          isActive
                            ? 'bg-blue-600/10 text-blue-400'
                            : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50',
                        )}
                      >
                        <ItemIcon size={ICON_SIZE} aria-hidden="true" className="shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function Brand(): JSX.Element {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-800 px-4">
      <Sparkles size={ICON_SIZE} aria-hidden="true" className="text-blue-400" />
      <span className="text-sm font-semibold text-zinc-50">{APP_NAME}</span>
    </div>
  );
}

export interface SidebarProps {
  /** Mobile overlay visibility (the header hamburger owns the state). */
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

export default function Sidebar({ mobileOpen, onMobileOpenChange }: SidebarProps): JSX.Element {
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  return (
    <>
      {/* Desktop rail — 260px, fixed, full height. */}
      <aside
        aria-label="Sidebar"
        className="fixed inset-y-0 left-0 z-40 hidden w-[260px] flex-col border-r border-zinc-800 bg-zinc-900 md:flex"
      >
        <Brand />
        <NavContent />
      </aside>

      {/* Mobile overlay — an actual dialog, so focus/escape/scroll-lock are real. */}
      <Dialog open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <DialogContent
          // twMerge resolves these against the primitive's centred defaults.
          className="inset-y-0 left-0 flex h-full w-[260px] max-w-[85vw] translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-l-0 border-r border-zinc-800 bg-zinc-900 p-0 sm:rounded-none md:hidden"
          onTouchStart={(event) => {
            const touch = event.touches[0];
            touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
          }}
          onTouchEnd={(event) => {
            const start = touchStart.current;
            const touch = event.changedTouches[0];
            touchStart.current = null;
            if (start === null || touch === undefined) {
              return;
            }
            if (swipeShouldClose(start.x, start.y, touch.clientX, touch.clientY)) {
              onMobileOpenChange(false);
            }
          }}
        >
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <Brand />
          <NavContent onNavigate={() => onMobileOpenChange(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
