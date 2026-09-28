import { mountPathFor, OBJECT_TYPES } from '@shared/objectTypes';

import type {
  ActivityEntry,
  ActivityFeed,
  DashboardResult,
  StatusObjectType,
  VerificationBucket,
} from './api';
import { serverMessage } from './extract';
import { objectDetailPath } from './objects';

/**
 * The dashboard's pure half (plan task 5.1, story p5-01;
 * docs/spec-ui-design.md L127-180).
 *
 * Everything the page decides lives here in plain functions: which four cards there
 * are and what number each shows, how a percentage is computed and formatted, which
 * eight rows the per-type section draws and what each bar's segments are, the
 * click-through route of one activity row, and the feed's state ladder. The React
 * halves (`pages/DashboardPage.tsx` and its three components) only move state and
 * pixels, so every rule is asserted in plain node (D10) — including the two the
 * acceptance criteria name numerically ("one decimal", "equal to that type's
 * summary").
 *
 * **GlobalRegistry has no row here and cannot acquire one.** The per-type list is
 * derived from `OBJECT_TYPES` filtered on `objectType !== null`, and the one family
 * D4 gives no `object_type` is GlobalRegistry (Q1) — so a card or a bar for it would
 * take a deliberate edit to this filter, not an accident of a hand-written list.
 */

/* ------------------------------------------------------------------- copy */

/** The two section titles, verbatim from the spec's drawings (L149, L162). */
export const TYPE_SECTION_TITLE = 'Verification Progress by Type';
export const ACTIVITY_SECTION_TITLE = 'Recent Activity';

/** Shown while either read is in flight (the skeleton pass is task 5.4). */
export const DASHBOARD_LOADING_MESSAGE = 'Loading dashboard…';

/** The feed's empty state, verbatim from the spec (L179). */
export const EMPTY_ACTIVITY_MESSAGE = 'No activity yet. Extract some quests to get started.';
export const EMPTY_ACTIVITY_CTA = 'Extract Quests';
export const EMPTY_ACTIVITY_CTA_PATH = '/quests/extract';

/** What an unlinkable feed row is called when it has no key to show either. */
export const UNRESOLVED_ROW_LABEL = 'Unknown object';

/** The Total card's hint — the spec's own drawing puts "all objects" there (L146). */
export const TOTAL_CARD_HINT = 'all objects';

/* -------------------------------------------------------------- percentages */

/**
 * `part / total` as a percentage rounded to **one decimal** — the server's own rule
 * (D37: `272 / 597 → 45.6`, `Math.round(ratio * 1000) / 10`, and `0` when `total` is
 * 0 rather than `NaN`).
 *
 * The zero guard is what makes a fresh database render `0.0%` instead of `NaN%`,
 * which is the AC3 path.
 */
export function percentOf(part: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return Math.round((part / total) * 1000) / 10;
}

/**
 * One-decimal percentage text, `45.6%`.
 *
 * `toFixed(1)` is formatting only — the value it is handed has already been rounded
 * to one decimal by {@link percentOf} (or arrived rounded from the server), so no
 * second rounding rule exists. A caller that passes an unrounded number still cannot
 * render two decimals; that is the point of funnelling every percentage through here.
 */
export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

/* ------------------------------------------------------------------- cards */

export type DashboardCardKey = 'total' | 'extracted' | 'reviewed' | 'verified';

/**
 * One stat card.
 *
 * A discriminated union on `key`: the Total card is the one the spec draws without a
 * bar or a percentage (`hint` only), and typing that as its own variant is what stops
 * a component from rendering a bar of `null` or indexing the status palette with
 * `'total'`.
 */
export type DashboardCard =
  | {
      key: 'total';
      /** Card label, verbatim from the spec's drawing. */
      label: string;
      /** The number the card shows, straight from the API's `overall` bucket. */
      value: number;
      /** Total has no bar — see {@link TOTAL_CARD_HINT}. */
      percent: null;
      status: null;
      hint: string;
    }
  | {
      key: 'extracted' | 'reviewed' | 'verified';
      label: string;
      value: number;
      /** The bar's width and the printed percentage, already one-decimal. */
      percent: number;
      status: 'extracted' | 'reviewed' | 'verified';
      hint: null;
    };

/**
 * Does a card get a bar, and if so a bar of what? `'total'` alone has none.
 *
 * Declared as data so the component does not branch on the key by hand.
 */
const CARD_SHAPE: Record<
  DashboardCardKey,
  { label: string; hint: string | null; shareOf: 'extracted' | 'reviewed' | 'verified' | null }
> = {
  total: { label: 'Total', hint: TOTAL_CARD_HINT, shareOf: null },
  extracted: { label: 'Extracted', hint: null, shareOf: 'extracted' },
  reviewed: { label: 'Reviewed', hint: null, shareOf: 'reviewed' },
  verified: { label: 'Verified', hint: null, shareOf: 'verified' },
};

/** The four cards, in the spec's own order (L135-146). */
export const DASHBOARD_CARD_KEYS: readonly DashboardCardKey[] = [
  'total',
  'extracted',
  'reviewed',
  'verified',
];

/**
 * The four stat cards from the API's `overall` bucket.
 *
 * Three of the four percentages are computed with {@link percentOf}; the Verified
 * card shows **`overall.percent_verified` itself**. That is deliberate and is the
 * reason no rounding can disagree with the API: the endpoint answers that one
 * pre-rounded number, so re-deriving it client-side would add a second implementation
 * of the same rule for no gain. Both come out identical anyway — the same formula,
 * witnessed by the spec's own example (`272/597 → 45.6`, pinned in
 * `tests/unit/dashboard.test.ts` against the API's live value in D3c).
 */
export function dashboardCards(overall: DashboardResult['overall']): DashboardCard[] {
  return DASHBOARD_CARD_KEYS.map((key) => {
    const shape = CARD_SHAPE[key];
    const value = overall[key];
    if (shape.shareOf === null) {
      return {
        key: 'total',
        label: shape.label,
        value,
        percent: null,
        status: null,
        hint: shape.hint ?? TOTAL_CARD_HINT,
      };
    }
    return {
      key: shape.shareOf,
      label: shape.label,
      value,
      percent:
        key === 'verified'
          ? overall.percent_verified
          : percentOf(overall[shape.shareOf], overall.total),
      status: shape.shareOf,
      hint: null,
    };
  });
}

/* -------------------------------------------------------------- per-type rows */

export interface TypeProgressRow {
  /** The D4 singular `object_type` — the key this row reads in the API's `types`. */
  objectType: StatusObjectType;
  /** Family label, from `shared/objectTypes.ts` (`Drop Tables`, …). */
  label: string;
  /** The family's list route (`/drop-tables`, …) — the same string its page is mounted at. */
  path: string;
  bucket: VerificationBucket;
  /** `verified / total` to one decimal (the spec's `157/322 (48.8%)`). */
  percent: number;
  /** `"157/322"` — the numerator is `verified`, exactly as the spec draws it (L149-160). */
  fraction: string;
  /** One segment per lifecycle value, in status order, as a percentage of `total`. */
  segments: ReadonlyArray<{ status: 'extracted' | 'reviewed' | 'verified'; percent: number }>;
}

/** The eight rows' static half: type, label and route, in the spec's drawing order. */
export interface DashboardTypeRef {
  objectType: StatusObjectType;
  label: string;
  path: string;
}

/**
 * The eight tracked types, in the spec's order: **Quests first**, then the seven
 * generic families in `OBJECT_TYPES` order (which is also the order the server's
 * `STATUS_OBJECT_TYPES` uses, so `types` is already sorted the same way).
 *
 * Quests are not in `OBJECT_TYPES` — that table is the eight *non-quest* families
 * (task 4.1) — so their one row is here, with the spec's own label ("Quests") and
 * the `/quests` route of docs/spec-api.md's URL table.
 */
export const DASHBOARD_TYPE_REFS: readonly DashboardTypeRef[] = [
  { objectType: 'quest', label: 'Quests', path: '/quests' },
  // `flatMap` rather than `filter` + a non-null assertion: the null row is dropped
  // by construction, so the narrowed value needs no cast.
  ...OBJECT_TYPES.flatMap((config) =>
    config.objectType === null
      ? []
      : [{ objectType: config.objectType, label: config.label, path: mountPathFor(config) }],
  ),
];

/** The zero bucket, for a type the API did not report (defensive, never expected). */
const ZERO_BUCKET: VerificationBucket = { total: 0, extracted: 0, reviewed: 0, verified: 0 };

/** One type's progress row. */
export function typeProgressRow(
  ref: DashboardTypeRef,
  bucket: VerificationBucket,
): TypeProgressRow {
  return {
    objectType: ref.objectType,
    label: ref.label,
    path: ref.path,
    bucket,
    percent: percentOf(bucket.verified, bucket.total),
    // `verified`/`total`, not `total`/`total`: the spec's own example line reads
    // `157/322 (48.8%)` against `{total: 322, verified: 157}`.
    fraction: `${String(bucket.verified)}/${String(bucket.total)}`,
    segments: [
      { status: 'extracted', percent: percentOf(bucket.extracted, bucket.total) },
      { status: 'reviewed', percent: percentOf(bucket.reviewed, bucket.total) },
      { status: 'verified', percent: percentOf(bucket.verified, bucket.total) },
    ],
  };
}

/**
 * Every per-type row, in {@link DASHBOARD_TYPE_REFS} order — all eight, zeros
 * included, so the section is the same shape on a fresh database as on a full one
 * (D37's reason for putting the zeros on the wire).
 */
export function typeProgressRows(result: DashboardResult): TypeProgressRow[] {
  return DASHBOARD_TYPE_REFS.map((ref) =>
    typeProgressRow(ref, result.types[ref.objectType] ?? ZERO_BUCKET),
  );
}

/* -------------------------------------------------------------- the feed */

/**
 * The detail route of one activity row's object — the D4 mapping, never a guess:
 * the singular `object_type` selects the family and the **existing**
 * `objectDetailPath` builds the route, so the feed link and the list pages' links are
 * the same string by construction (`/drop-tables/KT-SPH3-C02-003`,
 * `/zone-transfers/WizardCity%2FWC_Hub`, `/quests/DS-ACAD-C01-001`).
 *
 * `null` — and therefore no link — for every row the feed cannot open:
 *
 * - the join found no parent (`object_type` and `object_key` are both `null`);
 * - the type is outside the eight D4 tracks (a hand-written row; no route exists);
 * - the key is blank (the detail routes have nothing to address).
 *
 * A guessed route would be a 404 for one of the eight; returning `null` instead makes
 * "no page to open" a state the feed can say out loud.
 */
export function activityHref(
  entry: Pick<ActivityEntry, 'object_type' | 'object_key'>,
): string | null {
  const key = entry.object_key;
  const objectType = entry.object_type;
  // `typeof objectType !== 'string'` is load-bearing, not defensive: `OBJECT_TYPES`'s
  // GlobalRegistry row has `objectType: null`, so an implicit `null` lookup through
  // `.find()` would have matched it and answered `/global-registry/<key>` — a route
  // that does not exist (Q1's family has no detail route). The unit test caught exactly
  // that before this guard existed.
  if (
    typeof key !== 'string' ||
    key === '' ||
    typeof objectType !== 'string' ||
    objectType === ''
  ) {
    return null;
  }
  if (objectType === 'quest') {
    // The one route not in `OBJECT_TYPES`; the same expression the browse table, the
    // card list and the detail page's navigate() use, so it cannot drift from them.
    return `/quests/${encodeURIComponent(key)}`;
  }
  const config = OBJECT_TYPES.find((row) => row.objectType === objectType);
  return config === undefined ? null : objectDetailPath(config, key);
}

/** The label a row shows when it has no key at all (a join that found nothing). */
export function activityRowLabel(entry: Pick<ActivityEntry, 'object_key'>): string {
  return typeof entry.object_key === 'string' && entry.object_key !== ''
    ? entry.object_key
    : UNRESOLVED_ROW_LABEL;
}

/**
 * The feed's one-line notice when the API reported unlinkable rows.
 *
 * The criterion's failure mode is a feed that shows unresolved rows *without saying
 * so*; this is the sentence that says so. Singular/plural are both written out
 * because "1 status changes" would be its own defect.
 */
export function unresolvedActivityMessage(count: number): string {
  if (count === 1) {
    return '1 status change in this feed has no object to open — its entry is missing from the status table, so it is shown without a link.';
  }
  return `${String(count)} status changes in this feed have no object to open — their entries are missing from the status table, so they are shown without a link.`;
}

/** Which of the feed's four states to render. */
export type ActivityFeedState = 'loading' | 'error' | 'empty' | 'ready';

/**
 * The feed's state, from the query's flags — so the ladder
 * (loading → error → empty → ready) is asserted in plain node instead of being
 * re-derived in JSX.
 *
 * **Error is checked before empty on purpose, and a missing `data` is an error.**
 * The criterion's failure mode is an empty state that appears because the API errored
 * rather than because the history is empty. An errored query has `data === undefined`,
 * so an `empty`-first ladder would render the friendly empty state over a broken
 * request; requiring a *successful* read with zero rows before the empty state is what
 * rules that out — a third state where the query is neither pending nor error but has
 * no data (a disabled or not-yet-started observer) is equally not "the history is empty".
 */
export function activityFeedState(query: {
  isPending: boolean;
  isError: boolean;
  data: ActivityFeed | undefined;
}): ActivityFeedState {
  if (query.isPending) {
    return 'loading';
  }
  if (query.isError || query.data === undefined) {
    return 'error';
  }
  return query.data.activity.length === 0 ? 'empty' : 'ready';
}

/** The dashboard aggregate's failure line. */
export function dashboardErrorMessage(error: unknown): string {
  return serverMessage(error, 'Could not load the dashboard.');
}

/** The activity feed's failure line. */
export function activityErrorMessage(error: unknown): string {
  return serverMessage(error, 'Could not load the recent activity.');
}
