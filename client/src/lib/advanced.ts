import { isEmptyValue, type DocPath } from '@shared/document';
import { fieldTier } from '@shared/glossary';
import { buildQuestScaffold } from '@shared/quest/scaffold';

import { newDialogEntry, newDialogGroup, newDialogList } from './quest-dialog';
import { newGoalLogicEntry } from './quest-goal-logic';
import { GOAL_TYPE_SPECS, newGoalObject } from './quest-goals';
import { newResultObject, newSoundRouter, RESULT_TYPE_SPECS } from './quest-results';
import {
  newRequirementGroup,
  newRequirementLeaf,
  REQUIREMENT_TYPE_SPECS,
} from './requirement-tree';

/**
 * Basic vs Advanced (task 7.11, D132). The tier is the glossary's (`fieldTier`); nothing here
 * holds a second table. A form splits its field list with {@link splitByTier}, and its Advanced
 * disclosure opens on {@link hasAdvancedValue} or a validation error.
 */

/** The fields of a form in their own order, split by the glossary tier of each `key`. */
export function splitByTier<T extends { key: string }>(
  items: readonly T[],
): { basic: T[]; advanced: T[] } {
  return {
    basic: items.filter((item) => fieldTier(item.key) === 'basic'),
    advanced: items.filter((item) => fieldTier(item.key) === 'advanced'),
  };
}

/** The class key of the quest document itself, which carries no `$type` (the D118 skeleton). */
const QUEST_ROOT = '(quest)';

/** A field's own default: `known: false` when no builder states one unambiguously. */
export type FieldDefault = { known: true; value: unknown } | { known: false };

interface DefaultTables {
  /** `$type` (or {@link QUEST_ROOT}) → key → the value a new node of that class is built with. */
  byClass: Map<string, Map<string, unknown>>;
  /** key → value, for keys every builder that writes them agrees on (the untyped containers). */
  byKey: Map<string, unknown>;
}

let tables: DefaultTables | undefined;

/**
 * The per-field defaults, **derived** from the builders that create new content (D195) — the D118
 * skeleton (`buildQuestScaffold`), `newDialogEntry`/`newDialogGroup`/`newDialogList`, every goal
 * class's `newGoalObject`, every requirement leaf and group, every result class and its sound
 * router, and `newGoalLogicEntry` — so there is no second hand-typed table to drift. Built once,
 * on first use (the builders' modules must have finished loading).
 */
function defaultTables(): DefaultTables {
  if (tables !== undefined) {
    return tables;
  }
  const built: Array<Record<string, unknown>> = [
    newDialogEntry(),
    newDialogGroup(),
    newDialogList(),
    ...GOAL_TYPE_SPECS.map((spec) => newGoalObject(spec.shortName, '')),
    ...REQUIREMENT_TYPE_SPECS.map((spec) => newRequirementLeaf(spec.shortName)),
    newRequirementGroup([]),
    ...RESULT_TYPE_SPECS.map((spec) => newResultObject(spec.shortName)),
    newSoundRouter(),
    newGoalLogicEntry(),
  ];
  const byClass = new Map<string, Map<string, unknown>>([
    [
      QUEST_ROOT,
      new Map(Object.entries(buildQuestScaffold({ name: QUEST_ROOT, link: { kind: 'none' } }))),
    ],
  ]);
  const byKeyAll = new Map<string, unknown[]>();
  for (const node of [...built, Object.fromEntries(byClass.get(QUEST_ROOT) ?? [])]) {
    const classType = typeof node.$type === 'string' ? node.$type : undefined;
    if (classType !== undefined && !byClass.has(classType)) {
      byClass.set(classType, new Map(Object.entries(node)));
    }
    for (const [key, value] of Object.entries(node)) {
      byKeyAll.set(key, [...(byKeyAll.get(key) ?? []), value]);
    }
  }
  const byKey = new Map<string, unknown>();
  for (const [key, values] of byKeyAll) {
    const first = JSON.stringify(values[0]);
    if (values.every((value) => JSON.stringify(value) === first)) {
      byKey.set(key, values[0]);
    }
  }
  tables = { byClass, byKey };
  return tables;
}

/**
 * The default a new node gives {@link key} (D195): the class's own when the container's `$type`
 * (or the quest root) names a built class that writes the key, else the one value every builder
 * agrees on. `m_isQuestRegistry` is the case that needs the class: `ReqHasEntry` starts it `true`,
 * `ResModifyEntry` `false`.
 */
export function fieldDefault(key: string, classType?: string): FieldDefault {
  const { byClass, byKey } = defaultTables();
  const ofClass = classType === undefined ? undefined : byClass.get(classType);
  if (ofClass?.has(key) === true) {
    return { known: true, value: ofClass.get(key) };
  }
  return byKey.has(key) ? { known: true, value: byKey.get(key) } : { known: false };
}

/**
 * `true` when {@link value} is what a new node would hold for the field — so it does **not** open
 * Advanced (D195, amending D132/D179's generic empty set). `null`/absent is never authored. With a
 * known scalar default, only that exact value is default: an authored `false` where a new node
 * writes `true` (`m_bypassCameraOnReview`, 35 of 1,706 clone entries) or `0` where it writes `0.5`
 * is a real value and shows. A container default, or a field no builder writes, keeps the
 * `isEmptyValue` rule (`''`, `0`, `false`, `[]`, empty containers).
 */
export function isDefaultFieldValue(key: string, value: unknown, classType?: string): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  const fallback = fieldDefault(key, classType);
  if (fallback.known && (fallback.value === null || typeof fallback.value !== 'object')) {
    return value === fallback.value;
  }
  if (fallback.known && JSON.stringify(value) === JSON.stringify(fallback.value)) {
    return true;
  }
  return isEmptyValue(value);
}

/**
 * `true` when any of {@link paths} holds a value that differs from **its own field's** default
 * ({@link isDefaultFieldValue}; D195). The class is read from the container the path ends in — its
 * `$type`, or the quest itself for a one-segment path — so a dialog entry's `m_cameraFadeTime: 0.5`
 * stays collapsed and its `m_bypassCameraOnReview: false` opens the Camera accordion.
 */
export function hasAdvancedValue(
  state: { value: (path: DocPath) => unknown },
  paths: readonly DocPath[],
): boolean {
  return paths.some((path) => {
    const key = path[path.length - 1];
    if (typeof key !== 'string') {
      return !isEmptyValue(state.value(path));
    }
    const container = path.length === 1 ? undefined : state.value(path.slice(0, -1));
    const classType =
      path.length === 1
        ? QUEST_ROOT
        : typeof container === 'object' &&
            container !== null &&
            typeof (container as { $type?: unknown }).$type === 'string'
          ? ((container as { $type: string }).$type as string)
          : undefined;
    return !isDefaultFieldValue(key, state.value(path), classType);
  });
}

/**
 * The value to show as read-only text when an enum admits exactly one literal and the document
 * already holds it, else `null`. A document that is missing the value, or holds another one,
 * keeps its select so the value can still be set and nothing unlisted is snapped (D57).
 */
export function singleLegalValue(options: readonly string[], current: unknown): string | null {
  return options.length === 1 && current === options[0] ? (options[0] as string) : null;
}
