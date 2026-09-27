import { describe, expect, it } from 'vitest';

import type { ActivityFeed, DashboardResult, StatusObjectType } from '../../client/src/lib/api';
import {
  activityErrorMessage,
  activityFeedState,
  activityHref,
  activityRowLabel,
  ACTIVITY_SECTION_TITLE,
  dashboardCards,
  dashboardErrorMessage,
  DASHBOARD_CARD_KEYS,
  DASHBOARD_TYPE_REFS,
  EMPTY_ACTIVITY_CTA,
  EMPTY_ACTIVITY_CTA_PATH,
  EMPTY_ACTIVITY_MESSAGE,
  formatPercent,
  percentOf,
  TOTAL_CARD_HINT,
  TYPE_SECTION_TITLE,
  typeProgressRows,
  unresolvedActivityMessage,
} from '../../client/src/lib/dashboard';

/**
 * Story p5-01 deliverable D2 — the dashboard's pure half.
 *
 * Everything the page decides numerically is asserted here in plain node (D10): the
 * one-decimal percentage rule, which four cards there are and where each number comes
 * from, the eight per-type rows (Quests first, GlobalRegistry absent — Q1), the
 * click-through mapping from a `status_history` row's `object_type` to its detail
 * route (D4), the feed's state ladder, and the copy the tier-1 spec will address.
 *
 * The percentage expectations are the **spec's own worked examples**
 * (docs/spec-api.md L144-164: `157/322 → 48.8`, `70/180 → 38.9`, `45/95 → 47.4`,
 * `272/597 → 45.6`), not values this module produced — so the test witnesses the rule
 * rather than restating the implementation.
 */

/** The eight D4 singular types, typed by hand from the decision (never derived). */
const EXPECTED_OBJECT_TYPES: StatusObjectType[] = [
  'quest',
  'drop_table',
  'npc_inventory',
  'npc_spell_inventory',
  'creature_spellbook',
  'npc_drop_table',
  'treasure_card_inventory',
  'zone_transfer',
];

/** The eight detail routes of docs/spec-api.md L456-474, typed by hand. */
const EXPECTED_DETAIL_ROUTE: Record<StatusObjectType, string> = {
  quest: '/quests',
  drop_table: '/drop-tables',
  npc_inventory: '/npc-inventories',
  npc_spell_inventory: '/npc-spell-inventories',
  creature_spellbook: '/creature-spellbooks',
  npc_drop_table: '/npc-drop-tables',
  treasure_card_inventory: '/treasure-card-inventories',
  zone_transfer: '/zone-transfers',
};

/** The spec's dashboard example (`docs/spec-api.md` L148-163), plus zeros for the rest. */
function exampleDashboard(): DashboardResult {
  const zero = { total: 0, extracted: 0, reviewed: 0, verified: 0 };
  return {
    types: {
      quest: { total: 322, extracted: 45, reviewed: 120, verified: 157 },
      drop_table: { total: 180, extracted: 30, reviewed: 80, verified: 70 },
      npc_inventory: { total: 95, extracted: 10, reviewed: 40, verified: 45 },
      npc_spell_inventory: zero,
      creature_spellbook: zero,
      npc_drop_table: zero,
      treasure_card_inventory: zero,
      zone_transfer: zero,
    },
    overall: {
      total: 597,
      extracted: 85,
      reviewed: 240,
      verified: 272,
      percent_verified: 45.6,
    },
  };
}

describe('percentOf / formatPercent — one decimal, always', () => {
  it('reproduces the spec’s worked examples', () => {
    expect(percentOf(157, 322)).toBe(48.8);
    expect(percentOf(70, 180)).toBe(38.9);
    expect(percentOf(45, 95)).toBe(47.4);
    expect(percentOf(272, 597)).toBe(45.6);
  });

  it('is 0 — never NaN — when the total is 0 (the empty-database case)', () => {
    expect(percentOf(0, 0)).toBe(0);
    expect(percentOf(5, 0)).toBe(0);
    expect(formatPercent(percentOf(0, 0))).toBe('0.0%');
  });

  it('never renders a whole number or more than one decimal', () => {
    // Every reachable (part, total) pair over a small grid, plus the boundaries.
    for (let total = 1; total <= 400; total += 7) {
      for (const part of [0, 1, Math.floor(total / 3), total - 1, total]) {
        const text = formatPercent(percentOf(part, total));
        expect(text, `percentOf(${part}, ${total})`).toMatch(/^\d+\.\d%$/);
        // One decimal means exactly one digit after the point — never "14%" or "14.25%".
        expect(text.split('.')[1]).toHaveLength(2); // "<digit>%"
      }
    }
  });

  it('rounds half up at the first decimal, as the server does (D37)', () => {
    // 1/8 = 12.5 exact; 1/16 = 6.25 must land on 6.3, not truncate to 6.2.
    expect(percentOf(1, 8)).toBe(12.5);
    expect(percentOf(1, 16)).toBe(6.3);
    expect(percentOf(1, 3)).toBe(33.3);
    expect(percentOf(2, 3)).toBe(66.7);
    expect(formatPercent(100)).toBe('100.0%');
    expect(formatPercent(8)).toBe('8.0%');
  });
});

describe('dashboardCards — the four cards', () => {
  it('takes every number straight from the API’s overall bucket', () => {
    const overall = exampleDashboard().overall;
    const cards = dashboardCards(overall);

    expect(cards.map((card) => card.key)).toEqual([...DASHBOARD_CARD_KEYS]);
    expect(cards.map((card) => card.label)).toEqual(['Total', 'Extracted', 'Reviewed', 'Verified']);
    expect(cards.map((card) => card.value)).toEqual([
      overall.total,
      overall.extracted,
      overall.reviewed,
      overall.verified,
    ]);
  });

  it('shows the three status shares to one decimal, and the server’s own verified percentage', () => {
    const overall = exampleDashboard().overall;
    const byKey = Object.fromEntries(dashboardCards(overall).map((card) => [card.key, card]));

    expect(byKey.total.percent).toBeNull();
    expect(byKey.total.hint).toBe(TOTAL_CARD_HINT);
    // 85/597 = 14.237… → 14.2 (the spec's card drawing shows 14.2%)
    expect(byKey.extracted.percent).toBe(14.2);
    // 240/597 = 40.201… → 40.2 (the spec's drawing shows 40.2%)
    expect(byKey.reviewed.percent).toBe(40.2);
    // The Verified card shows the API's pre-rounded value itself — no second rule.
    expect(byKey.verified.percent).toBe(overall.percent_verified);
    expect(formatPercent(byKey.verified.percent ?? 0)).toBe('45.6%');
  });

  it('renders four zeros and 0.0% on an empty dashboard (AC3’s shape)', () => {
    const cards = dashboardCards({
      total: 0,
      extracted: 0,
      reviewed: 0,
      verified: 0,
      percent_verified: 0,
    });

    expect(cards.map((card) => card.value)).toEqual([0, 0, 0, 0]);
    expect(cards.filter((card) => card.percent !== null).map((card) => card.percent)).toEqual([
      0, 0, 0,
    ]);
    for (const card of cards) {
      if (card.percent !== null) {
        expect(formatPercent(card.percent)).toBe('0.0%');
      }
    }
  });

  it('pins the client rule to the API’s own value for the spec’s example', () => {
    // The Verified card reuses `overall.percent_verified`; this asserts the client's
    // `percentOf` would have produced the identical number, which is what makes the two
    // implementations one rule rather than two.
    const overall = exampleDashboard().overall;
    expect(percentOf(overall.verified, overall.total)).toBe(overall.percent_verified);
  });
});

describe('typeProgressRows — the eight per-type bars', () => {
  it('draws all eight D4 types, GlobalRegistry excluded (Q1)', () => {
    const rows = typeProgressRows(exampleDashboard());

    expect(rows.map((row) => row.objectType)).toEqual(EXPECTED_OBJECT_TYPES);
    expect(rows).toHaveLength(8);
    expect(rows.some((row) => (row.objectType as string) === 'global_registry')).toBe(false);
    expect(DASHBOARD_TYPE_REFS.map((ref) => ref.objectType)).toEqual(EXPECTED_OBJECT_TYPES);
  });

  it('maps each row to its own family label and list route', () => {
    const rows = typeProgressRows(exampleDashboard());
    const byType = Object.fromEntries(rows.map((row) => [row.objectType, row]));

    expect(byType.quest.label).toBe('Quests');
    expect(byType.quest.path).toBe('/quests');
    for (const objectType of EXPECTED_OBJECT_TYPES) {
      if (objectType === 'quest') {
        continue;
      }
      expect(byType[objectType].path).toBe(EXPECTED_DETAIL_ROUTE[objectType]);
    }
  });

  it('takes each fraction and percentage from that type’s own summary', () => {
    const result = exampleDashboard();
    const rows = typeProgressRows(result);

    for (const row of rows) {
      const bucket = result.types[row.objectType];
      expect(row.bucket).toEqual(bucket);
      // The fraction is `verified/total` (the spec's `157/322 (48.8%)`), spelled exactly.
      expect(row.fraction).toBe(`${bucket.verified}/${bucket.total}`);
    }

    const byType = Object.fromEntries(rows.map((row) => [row.objectType, row]));
    // The spec's own three example lines (L149-160), asserted as rendered text.
    expect(`${byType.quest.fraction} (${formatPercent(byType.quest.percent)})`).toBe(
      '157/322 (48.8%)',
    );
    expect(`${byType.drop_table.fraction} (${formatPercent(byType.drop_table.percent)})`).toBe(
      '70/180 (38.9%)',
    );
    expect(
      `${byType.npc_inventory.fraction} (${formatPercent(byType.npc_inventory.percent)})`,
    ).toBe('45/95 (47.4%)');
  });

  it('gives each bar its three lifecycle segments as shares of the total', () => {
    const rows = typeProgressRows(exampleDashboard());
    const quest = rows.find((row) => row.objectType === 'quest');

    expect(quest?.segments).toEqual([
      { status: 'extracted', percent: 14 }, // 45/322 = 13.975… → 14.0
      { status: 'reviewed', percent: 37.3 }, // 120/322 = 37.267… → 37.3
      { status: 'verified', percent: 48.8 },
    ]);
  });

  it('renders a zero-row type as 0/0 (0.0%) rather than NaN', () => {
    const rows = typeProgressRows(exampleDashboard());
    const empty = rows.find((row) => row.objectType === 'npc_drop_table');

    expect(empty?.fraction).toBe('0/0');
    expect(formatPercent(empty?.percent ?? -1)).toBe('0.0%');
    expect(empty?.segments.map((segment) => segment.percent)).toEqual([0, 0, 0]);
  });

  it('keeps a stable row set even if the API omitted a type (defensive zeros)', () => {
    const result = exampleDashboard();
    const types = { ...result.types };
    delete (types as Partial<typeof types>).npc_spell_inventory;

    const rows = typeProgressRows({ ...result, types });

    expect(rows).toHaveLength(8);
    expect(rows.find((row) => row.objectType === 'npc_spell_inventory')?.fraction).toBe('0/0');
  });
});

describe('activityHref — the D4 click-through', () => {
  it('maps every tracked object_type to its detail route', () => {
    const keys: Record<StatusObjectType, string> = {
      quest: 'DS-ACAD-C01-001',
      drop_table: 'KT-SPH3-C02-003',
      npc_inventory: '87112',
      npc_spell_inventory: '99002',
      creature_spellbook: 'Mdeck-L-BR-DS-SylviaDrake-A-50',
      npc_drop_table: '1025',
      treasure_card_inventory: '38214',
      zone_transfer: 'WizardCity/WC_Hub',
    };

    for (const objectType of EXPECTED_OBJECT_TYPES) {
      const href = activityHref({ object_type: objectType, object_key: keys[objectType] });
      expect(href, objectType).toBe(
        `${EXPECTED_DETAIL_ROUTE[objectType]}/${encodeURIComponent(keys[objectType])}`,
      );
    }

    // The two shapes worth spelling out: an encoded `/` in a ZoneTransfer key (how the
    // list pages link them too) and an encoded quest name.
    expect(activityHref({ object_type: 'zone_transfer', object_key: 'WizardCity/WC_Hub' })).toBe(
      '/zone-transfers/WizardCity%2FWC_Hub',
    );
    expect(activityHref({ object_type: 'quest', object_key: 'DS-ACAD-C01-001' })).toBe(
      '/quests/DS-ACAD-C01-001',
    );
  });

  it('is null — never a guessed route — for every row the feed cannot open', () => {
    // The join found no parent: both halves are null.
    expect(activityHref({ object_type: null, object_key: null })).toBeNull();
    // A parent exists but the key is blank (nothing to address).
    expect(activityHref({ object_type: 'quest', object_key: '' })).toBeNull();
    // A key exists but there is no type at all.
    expect(activityHref({ object_type: null, object_key: 'DS-ACAD-C01-001' })).toBeNull();
    // A type outside D4's eight — Q1's GlobalRegistry can never be patched through the
    // API (the route 404s), so only a hand-written row reaches this, and it must not link.
    expect(
      activityHref({ object_type: 'global_registry', object_key: 'GlobalRegistryValues' }),
    ).toBeNull();
    expect(activityHref({ object_type: 'not_a_type', object_key: 'x' })).toBeNull();
  });
});

describe('the feed’s copy and state ladder', () => {
  it('labels an unkeyable row "Unknown object" and otherwise shows the key', () => {
    expect(activityRowLabel({ object_key: 'DS-ACAD-C01-001' })).toBe('DS-ACAD-C01-001');
    expect(activityRowLabel({ object_key: null })).toBe('Unknown object');
    expect(activityRowLabel({ object_key: '' })).toBe('Unknown object');
  });

  it('says out loud how many rows it could not link', () => {
    expect(unresolvedActivityMessage(1)).toContain('1 status change in this feed');
    expect(unresolvedActivityMessage(1)).not.toContain('changes');
    expect(unresolvedActivityMessage(3)).toContain('3 status changes in this feed');
    expect(unresolvedActivityMessage(3)).toContain('shown without a link');
  });

  it('never renders the empty state for a request that failed or has not answered', () => {
    const empty: ActivityFeed = { activity: [], unresolved: 0 };
    const ready: ActivityFeed = {
      activity: [
        {
          id: 1,
          object_type: 'quest',
          object_key: 'DS-ACAD-C01-001',
          old_status: null,
          new_status: 'extracted',
          notes: null,
          changed_by: 'Jason',
          changed_at: '2026-09-26T06:23:17.332Z',
        },
      ],
      unresolved: 0,
    };

    expect(activityFeedState({ isPending: true, isError: false, data: undefined })).toBe('loading');
    expect(activityFeedState({ isPending: false, isError: true, data: undefined })).toBe('error');
    // A successful-but-empty read is the only path to the empty state.
    expect(activityFeedState({ isPending: false, isError: false, data: empty })).toBe('empty');
    expect(activityFeedState({ isPending: false, isError: false, data: ready })).toBe('ready');
    // Neither pending nor error but no data is NOT "the history is empty".
    expect(activityFeedState({ isPending: false, isError: false, data: undefined })).toBe('error');
    // An error that still holds stale data is an error, not a stale ready.
    expect(activityFeedState({ isPending: false, isError: true, data: ready })).toBe('error');
  });

  it('carries the spec’s literals verbatim', () => {
    expect(TYPE_SECTION_TITLE).toBe('Verification Progress by Type');
    expect(ACTIVITY_SECTION_TITLE).toBe('Recent Activity');
    expect(EMPTY_ACTIVITY_MESSAGE).toBe('No activity yet. Extract some quests to get started.');
    expect(EMPTY_ACTIVITY_CTA).toBe('Extract Quests');
    expect(EMPTY_ACTIVITY_CTA_PATH).toBe('/quests/extract');
  });

  it('falls back to its own sentence when the server sent no message', () => {
    expect(dashboardErrorMessage(new Error('boom'))).toBe('boom');
    expect(dashboardErrorMessage(undefined)).toBe('Could not load the dashboard.');
    expect(activityErrorMessage(new Error('boom'))).toBe('boom');
    expect(activityErrorMessage(undefined)).toBe('Could not load the recent activity.');
  });
});
