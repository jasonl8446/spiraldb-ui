import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type { DocPath } from '@shared/document';

import { insertTargetAt, type EvidenceInsertTarget } from '../../lib/evidence-insert';

/**
 * The evidence panel's **focus channel** (plan task 6.7, story p6-08) — how "the focused
 * `m_dialog`", "the focused goal" and "the focused `m_locationName`" of
 * docs/spec-ui-design.md L437-438 become a fact the panel can read.
 *
 * The panel sits in the right rail, beside the editor, and the plan's own wording puts the target
 * in the **editor**: an available evidence row carries `field: null` from the API, so the field it
 * belongs to is whatever the user is working in. The shipped editors therefore report the field
 * they hold focus in, and the panel consumes the latest report.
 *
 * Three reporters, and the rule that decides between them:
 *
 * | reporter | where | target |
 * |---|---|---|
 * | goal card (`useEvidenceCardFocus`) | `QuestGoalsEditor`'s `<article>`, on **capture** | `m_goals[i].m_goalText` |
 * | location field (`useEvidenceFieldFocus`) | the goal's `m_locationName` input, on **bubble** | `m_goals[i].m_locationName` |
 * | dialog entry card (`useEvidenceCardFocus`) | `DialogListEditor`'s entry `<article>`, on **capture** | `…m_dialogEntries[j].m_dialog` |
 *
 * Capture versus bubble is the whole mechanism for the goal's two targets: a focus inside the
 * location input fires the card's capture handler first and the input's bubble handler second, so
 * the **innermost** reporter wins and focusing the location name inserts a location name, while
 * focusing any other control of the card inserts goal text. `tests/ui/quests-evidence-panel.spec.ts`
 * asserts both ends of that, so a React change in dispatch order fails a test rather than silently
 * retargeting the insert.
 *
 * `m_goalText` is deliberately reported for the **card** rather than for an input: measured, no
 * corpus goal carries an `m_goalText` key at all, so the Goals tab has no control for it and an
 * insert there *adds* the field to the focused goal (see `lib/evidence-insert.ts`).
 *
 * The default context is a no-op with `target: null`, so an editor mounted without the provider
 * (a unit render, another host) still works and simply reports nowhere. In **view mode** no editor
 * is mounted at all, so nothing reports and the panel shows the view-mode explanation: the insert
 * targets live in the edit-mode editors by construction, not by a mode check inside the panel.
 */
export interface EvidenceFocusValue {
  /** The field the editor last reported looking at, or `null` when nothing is focused. */
  target: EvidenceInsertTarget | null;
  /** Reports the focused field; `null` clears it. */
  focus: (target: EvidenceInsertTarget | null) => void;
}

/** The no-provider fallback: reports nowhere, so a host that does not care costs nothing. */
const NO_FOCUS: EvidenceFocusValue = { target: null, focus: () => undefined };

const EvidenceFocusContext = createContext<EvidenceFocusValue>(NO_FOCUS);

/**
 * Holds the focused target for one quest page. Mounted around both the editor and the rail, so a
 * focus in either reaches the other without prop-drilling through `QuestPreview`'s `panels` map.
 */
export function EvidenceFocusProvider({ children }: { children: ReactNode }): JSX.Element {
  const [target, setTarget] = useState<EvidenceInsertTarget | null>(null);
  const focus = useCallback((next: EvidenceInsertTarget | null) => {
    setTarget(next);
  }, []);
  const value = useMemo<EvidenceFocusValue>(() => ({ target, focus }), [target, focus]);
  return <EvidenceFocusContext.Provider value={value}>{children}</EvidenceFocusContext.Provider>;
}

/** The current focus report (a no-op channel when no provider is mounted). */
export function useEvidenceFocus(): EvidenceFocusValue {
  return useContext(EvidenceFocusContext);
}

/**
 * The focus handlers a **container** (a goal card, a dialog entry card) attaches. `path: null`
 * attaches nothing — a container that owns no insertable field must not clear the channel on a
 * focus, and an empty handler object spreads to nothing.
 */
export function useEvidenceCardFocus(path: DocPath | null): { onFocusCapture?: () => void } {
  const { focus } = useEvidenceFocus();
  const report = useCallback(() => {
    focus(path === null ? null : insertTargetAt(path));
  }, [focus, path]);
  return path === null ? {} : { onFocusCapture: report };
}

/**
 * The focus handler one **control** attaches. Used in the bubble phase so it overrides a container's
 * capture report — see the table in the module header. `path: null` attaches nothing.
 */
export function useEvidenceFieldFocus(path: DocPath | null): { onFocus?: () => void } {
  const { focus } = useEvidenceFocus();
  const report = useCallback(() => {
    focus(path === null ? null : insertTargetAt(path));
  }, [focus, path]);
  return path === null ? {} : { onFocus: report };
}
