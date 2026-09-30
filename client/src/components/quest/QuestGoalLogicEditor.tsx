import '@xyflow/react/dist/style.css';

import {
  Background,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {
  LayoutGrid,
  Maximize,
  Plus,
  Star,
  Trash2,
  TriangleAlert,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import type { QuestDocumentState } from '../../hooks/useQuestDocument';
import {
  DELETE_GOAL_LABEL,
  SET_START_GOAL_LABEL,
  UNSET_START_GOAL_LABEL,
  deleteGoalEdit,
} from '../../lib/quest-goals';
import {
  GOAL_LOGIC_PATH,
  NODE_HEIGHT,
  NODE_WIDTH,
  addGoalLogicEntryEdits,
  buildGoalLogicGraph,
  connectGoalsEdits,
  disconnectEdgeEdits,
  goalLogicEntries,
  goalLogicEntryNames,
  goalLogicEntryPath,
  goalLogicEntrySummary,
  goalLogicNamesText,
  goalNameFromNodeId,
  layoutGoalLogicGraph,
  setStartGoalEdits,
  updateGoalLogicEntryEdits,
  validateGoalLogic,
  type GoalLogicEdge,
  type GoalLogicNode,
  type GoalLogicValidation,
} from '../../lib/quest-goal-logic';
import { motionDuration, prefersReducedMotion } from '../../lib/reduced-motion';
import { cn } from '../../lib/utils';
import { FieldMessages, fieldAriaInvalid, useFieldMessages } from '../shared/FieldValidation';
import TermLabel from '../TermLabel';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { usePreviewTabSelect } from './QuestPreview';

/* ---------------------------------------------------------------------- copy */

/**
 * The tab's user-facing copy. It lives here, with the UI, and **not** in
 * `lib/quest-goal-logic.ts`: the model returns structured findings, and the one string the
 * spec pins verbatim (docs/spec-ui-design.md L384) is a display concern a unit test of the
 * model cannot check — and a UI that re-derived it from finding kinds would silently break
 * when the wording changed.
 */
export const GOAL_LOGIC_EDITOR_LABEL = 'Quest goal logic editor';

/** The canvas container's accessible name (the spec's own words: a React Flow canvas, L344). */
export const GOAL_LOGIC_CANVAS_LABEL = 'Goal logic flowchart';

/** docs/spec-ui-design.md L384, verbatim — sign and both sentences. */
export const DISCONNECTED_BANNER_TEXT =
  '⚠️ Goal logic has disconnected nodes. All goals must be reachable from start goals.';

/** The banner's headline when the findings are none of the kinds the pinned text covers. */
export const OTHER_FINDINGS_TEXT = '⚠️ Goal logic has validation findings.';

export const VALIDATION_DETAILS_LABEL = 'Goal logic validation details';
export const ZOOM_IN_LABEL = 'Zoom in';
export const ZOOM_OUT_LABEL = 'Zoom out';
export const FIT_VIEW_LABEL = 'Fit to view';
/**
 * The fit-to-view animation's duration, exported so the tier-1 reduced-motion spec can
 * name the number it asserts against. Under `prefers-reduced-motion: reduce` it is passed
 * to React Flow as `0` (an instant jump) — a d3 transition is not reachable by any
 * stylesheet rule (plan task 5.5 AC#11; `lib/reduced-motion.ts`).
 */
export const FIT_VIEW_DURATION_MS = 200;
export const AUTO_LAYOUT_LABEL = 'Auto-layout';
export const ADD_ENTRY_LABEL = 'Add GoalLogicEntry';
export const ENTRIES_LIST_LABEL = 'Goal logic entries';
export const ENTRY_INSPECTOR_LABEL = 'Goal logic entry inspector';
export const NO_ENTRIES_TEXT = 'This quest has no goal logic entries. Add one to start the chain.';
export const SELECT_ENTRY_TEXT = 'Select an entry to edit its five fields.';
/** The spec's own context-menu wording (docs/spec-ui-design.md L382). */
export const EDIT_GOAL_MENU_LABEL = 'Edit Goal';
export const NODE_MENU_LABEL = 'Goal node actions';
export const AND_HANDLE_LABEL = 'AND dependency';
export const OR_HANDLE_LABEL = 'OR dependency';
export const TARGET_HANDLE_LABEL = 'Goal dependency input';
export const START_BADGE_LABEL = 'Start';

/** One entry inspector field: its document key and the control kind it renders. */
interface GoalLogicEntryFieldSpec {
  key: string;
  kind: 'names' | 'count' | 'bool';
}

/** The entry inspector's five fields, in the corpus's key order (D57: exactly these five). */
const ENTRY_FIELDS: GoalLogicEntryFieldSpec[] = [
  { key: 'm_goalsAND', kind: 'names' },
  { key: 'm_goalsOR', kind: 'names' },
  { key: 'm_goalsToAdd', kind: 'names' },
  { key: 'm_completeQuest', kind: 'bool' },
  { key: 'm_requiredORCount', kind: 'count' },
];

/* ----------------------------------------------------------------- component */

export interface QuestGoalLogicEditorProps {
  /** The live document + its mutations (`useQuestDocument`) — the one document state. */
  state: QuestDocumentState;
  /** Present for symmetry with the other live panels; the flowchart has no timestamp row. */
  modifiedAt?: string | null;
}

/**
 * `QuestGoalLogicEditor` — the Goal Logic tab (plan task 3.5, story p3-05;
 * docs/spec-ui-design.md L344-385, docs/spec-domain-reference.md L336-351).
 *
 * The canvas, the toolbar, the entry inspector and the node context menu all route their
 * changes through the model's `shared/document.ts` edit builders, on the one document
 * `useQuestDocument` holds — so the Goals tab, this tab and the JSON side panel cannot
 * disagree about a byte. Nothing here spreads a document or writes a Zod output.
 *
 * Six decisions worth naming (all in the story report):
 *
 * 1. **The canvas is a view of the document, never a second model.** An effect rebuilds React
 *    Flow's nodes and edges from `buildGoalLogicGraph(state.doc)` whenever the document
 *    changes, keeping each node's dragged position by id. Deleting an edge therefore goes
 *    selection + `Delete` → `onEdgesDelete` → `disconnectEdgeEdits` → a document edit → the
 *    effect → the edge is gone for real, and a document that still had it would bring it back.
 * 2. **Two source handles per goal** (`AND dependency` solid, `OR dependency` dashed): the
 *    handle a connection is dragged from is the only thing that decides whether the new
 *    dependency lands in `m_goalsAND` or `m_goalsOR`, so drawing an edge never guesses. The
 *    Complete node has no source handle and a non-connectable target handle: it is a sink, and
 *    `m_completeQuest` in the inspector is the only thing that makes it an arrow's target.
 * 3. **The banner is driven by finding kinds, not by a boolean.** The spec pins the verbatim
 *    sentence to "disconnected nodes or cycles" (L384), so that sentence renders when such a
 *    finding is present; a duplicate name or an unknown reference gets the neutral headline
 *    rather than inaccurate pinned copy. The banner region itself appears whenever the
 *    validator reports anything, and its details list names **every** finding.
 * 4. **`Edit Goal` switches to the Goals tab** through `QuestPreview`'s tab context — the tab
 *    that owns goal-field editing. Expanding that goal's card from here would need a second
 *    cross-tab channel; the goal's name is on the node, and the Goals tab lists it. (Honest
 *    limit, not a silent gap.)
 * 5. **Delete and Set as Start Goal are the p3-04 operations** — `deleteGoalEdit` and
 *    `setStartGoalEdits` (which is `toggleStartGoalEdits`) — so the context menu and the Goals
 *    tab apply the identical edit. The item's label follows the goal's membership, because the
 *    primitive is a toggle.
 * 6. **The canvas is keyboard-reachable**: React Flow focuses nodes, and `Shift+F10` (or the
 *    context-menu key) on a selected node opens the same menu the right-click opens, with
 *    focus moved to its first item and `Escape` closing it.
 * 7. **`role="group" aria-label="Goal logic flowchart"` wraps the canvas *and* its toolbar**
 *    (and the node menu): the zoom/fit/layout/add controls live inside the region they
 *    control, so a screen reader announces the controls as part of the flowchart rather than
 *    as loose buttons after it. The label is the spec's own word for this surface (L344).
 *
 * **What the corpus does not exercise** (measured, and not over-claimed): all 742 real entries
 * have an empty `m_goalsOR` and `m_requiredORCount: 1`, so the dashed OR rendering, the
 * multi-condition entry and the `unsatisfiable-or-count` finding are provable only with a
 * synthetic fixture. The solid AND edge, the Complete node and the disconnected banner are all
 * corpus-backed.
 */
export default function QuestGoalLogicEditor({ state }: QuestGoalLogicEditorProps): JSX.Element {
  return (
    <ReactFlowProvider>
      <GoalLogicCanvas state={state} />
    </ReactFlowProvider>
  );
}

/* --------------------------------------------------------------- the canvas */

function GoalLogicCanvas({ state }: { state: QuestDocumentState }): JSX.Element {
  const graph = useMemo(() => buildGoalLogicGraph(state.doc), [state.doc]);
  const validation = useMemo(() => validateGoalLogic(state.doc), [state.doc]);
  const selectTab = usePreviewTabSelect();
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState<GoalLogicFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<GoalLogicFlowEdge>([]);
  const [menu, setMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const wrapper = useRef<HTMLDivElement | null>(null);
  const firstMenuItem = useRef<HTMLButtonElement | null>(null);

  const entries = goalLogicEntries(state.doc);

  function openMenu(nodeId: string, clientX: number, clientY: number): void {
    const rect = wrapper.current?.getBoundingClientRect();
    setMenu({ nodeId, x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) });
  }

  // The document is the truth: rebuild the flow whenever it changes, keeping the position a
  // user dragged a node to (keyed by the node id, so an unrelated edit cannot reset it).
  useEffect(() => {
    const laidOut = layoutGoalLogicGraph(graph);
    setNodes((previous) => {
      const kept = new Map(previous.map((node) => [node.id, node.position]));
      return graph.nodes.map((node) => ({
        id: node.id,
        type: 'goalLogic',
        position: kept.get(node.id) ?? laidOut[node.id],
        data: { node, onOpenMenu: openMenu },
        connectable: node.kind === 'goal',
        deletable: false,
        draggable: true,
      }));
    });
    setEdges(
      graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'smoothstep',
        data: { edge },
        label: edgeLabel(edge),
        labelStyle: { fill: '#a1a1aa', fontSize: 10 },
        labelBgStyle: { fill: '#09090b' },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 2,
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(edge), width: 16, height: 16 },
        style: {
          stroke: edgeColor(edge),
          strokeWidth: 2,
          ...(edge.dashed ? { strokeDasharray: '6 4' } : {}),
        },
      })),
    );
  }, [graph, setNodes, setEdges]);

  // The inspector only ever shows an entry that still exists.
  const selectedIndex = selected !== null && selected < entries.length ? selected : null;

  useEffect(() => {
    if (menu !== null) {
      firstMenuItem.current?.focus();
    }
  }, [menu]);

  function disconnect(edge: GoalLogicEdge): void {
    const entry = entries[edge.entryIndex];
    const listLength =
      edge.kind === 'complete'
        ? 1
        : goalLogicEntryNames(entry, edge.kind === 'and' ? 'm_goalsAND' : 'm_goalsOR').length;
    state.editAll(disconnectEdgeEdits(edge, listLength));
  }

  function onConnect(connection: Connection): void {
    const source = connection.source === null ? null : goalNameFromNodeId(connection.source);
    const target = connection.target === null ? null : goalNameFromNodeId(connection.target);
    if (source === null || target === null) {
      return;
    }
    state.editAll(
      connectGoalsEdits(state.doc, source, target, connection.sourceHandle === 'or' ? 'or' : 'and'),
    );
  }

  function onCanvasKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      setMenu(null);
      return;
    }
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) {
      return;
    }
    const current = nodes.find((node) => node.selected === true);
    if (current === undefined) {
      return;
    }
    const element = wrapper.current?.querySelector(`[data-id="${current.id}"]`);
    const rect = element?.getBoundingClientRect();
    openMenu(current.id, (rect?.left ?? 0) + 12, (rect?.top ?? 0) + 12);
    event.preventDefault();
  }

  const menuNode = menu === null ? undefined : graph.nodes.find((node) => node.id === menu.nodeId);

  return (
    <section aria-label={GOAL_LOGIC_EDITOR_LABEL} className="flex flex-col gap-3">
      <ValidationBanner validation={validation} />

      <div className="flex flex-col gap-3 lg:flex-row">
        <div role="group" aria-label={GOAL_LOGIC_CANVAS_LABEL} className="relative min-w-0 flex-1">
          <div
            ref={wrapper}
            tabIndex={-1}
            onKeyDown={onCanvasKeyDown}
            className="h-[60vh] min-h-[22rem] w-full overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodeTypes={NODE_TYPES}
              onConnect={onConnect}
              onEdgesDelete={(deleted) => {
                for (const edge of deleted) {
                  if (edge.data !== undefined) {
                    disconnect(edge.data.edge);
                  }
                }
              }}
              onNodeContextMenu={(event, node) => {
                event.preventDefault();
                // The pane's own context-menu handler closes the menu; a node's must not.
                event.stopPropagation();
                openMenu(node.id, event.clientX, event.clientY);
              }}
              onPaneClick={() => setMenu(null)}
              onPaneContextMenu={() => setMenu(null)}
              fitView
              minZoom={0.2}
              maxZoom={2}
              // React Flow's own default is `Backspace` alone; both keys are the platform
              // convention for "remove the selected thing", and it is what disconnects a
              // dependency (goals are not deletable by key — the context menu owns that).
              deleteKeyCode={['Delete', 'Backspace']}
              nodesConnectable
              nodesFocusable
              edgesFocusable
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#27272a" gap={20} />
            </ReactFlow>
          </div>

          <div className="absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900/95 p-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={ZOOM_IN_LABEL}
              title={ZOOM_IN_LABEL}
              onClick={() => zoomIn()}
            >
              <ZoomIn className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={ZOOM_OUT_LABEL}
              title={ZOOM_OUT_LABEL}
              onClick={() => zoomOut()}
            >
              <ZoomOut className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={FIT_VIEW_LABEL}
              title={FIT_VIEW_LABEL}
              onClick={() =>
                fitView({ duration: motionDuration(prefersReducedMotion(), FIT_VIEW_DURATION_MS) })
              }
            >
              <Maximize className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={AUTO_LAYOUT_LABEL}
              title={AUTO_LAYOUT_LABEL}
              onClick={() => {
                const laidOut = layoutGoalLogicGraph(graph);
                setNodes((previous) =>
                  previous.map((node) => ({ ...node, position: laidOut[node.id] })),
                );
              }}
            >
              <LayoutGrid className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                state.editAll(addGoalLogicEntryEdits(state.value([GOAL_LOGIC_PATH])));
                setSelected(entries.length);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {ADD_ENTRY_LABEL}
            </Button>
          </div>

          {menu !== null && menuNode !== undefined ? (
            <div
              role="menu"
              aria-label={NODE_MENU_LABEL}
              className="absolute z-20 flex min-w-[12rem] flex-col rounded-md border border-zinc-700 bg-zinc-900 p-1 shadow-lg"
              style={{ left: menu.x, top: menu.y }}
            >
              <button
                ref={firstMenuItem}
                type="button"
                role="menuitem"
                className={MENU_ITEM_CLASS}
                onClick={() => {
                  setMenu(null);
                  selectTab?.('Goals');
                }}
              >
                {EDIT_GOAL_MENU_LABEL}
              </button>
              <button
                type="button"
                role="menuitem"
                className={MENU_ITEM_CLASS}
                onClick={() => {
                  setMenu(null);
                  if (menuNode.goalIndex !== null) {
                    state.editAll([deleteGoalEdit(menuNode.goalIndex)]);
                  }
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {DELETE_GOAL_LABEL}
              </button>
              <button
                type="button"
                role="menuitem"
                className={MENU_ITEM_CLASS}
                onClick={() => {
                  setMenu(null);
                  state.editAll(setStartGoalEdits(menuNode.name, state.value(['m_startGoals'])));
                }}
              >
                <Star className="h-4 w-4" aria-hidden="true" />
                {menuNode.isStart ? UNSET_START_GOAL_LABEL : SET_START_GOAL_LABEL}
              </button>
            </div>
          ) : null}
        </div>

        <EntryInspector
          state={state}
          entries={entries}
          selected={selectedIndex}
          onSelect={setSelected}
        />
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- the banner */

function ValidationBanner({ validation }: { validation: GoalLogicValidation }): JSX.Element | null {
  if (validation.findings.length === 0) {
    return null;
  }
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-md border border-amber-500/60 bg-amber-500/10 p-3"
    >
      <p className="flex items-center gap-2 text-sm font-medium text-amber-200">
        <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
        {validation.hasGraphShapeFinding ? DISCONNECTED_BANNER_TEXT : OTHER_FINDINGS_TEXT}
      </p>
      <ul
        aria-label={VALIDATION_DETAILS_LABEL}
        className="flex list-inside list-disc flex-col gap-1 text-xs text-amber-200/90"
      >
        {validation.findings.map((finding) => (
          <li key={`${finding.kind}:${finding.goalName ?? ''}:${finding.entryIndices.join(',')}`}>
            {finding.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------- the inspector */

function EntryInspector({
  state,
  entries,
  selected,
  onSelect,
}: {
  state: QuestDocumentState;
  entries: readonly unknown[];
  selected: number | null;
  onSelect: (index: number | null) => void;
}): JSX.Element {
  const entry = selected === null ? undefined : entries[selected];
  return (
    <div className="flex w-full shrink-0 flex-col gap-2 lg:w-80">
      <h3 className="text-sm font-medium text-zinc-200">{ENTRIES_LIST_LABEL}</h3>
      {entries.length === 0 ? (
        <p className="text-xs text-zinc-400">{NO_ENTRIES_TEXT}</p>
      ) : (
        <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
          {entries.map((item, index) => (
            <li key={index}>
              <button
                type="button"
                aria-current={selected === index}
                onClick={() => onSelect(selected === index ? null : index)}
                className={cn(
                  'w-full truncate rounded-md border px-2 py-1 text-left font-mono text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
                  selected === index
                    ? 'border-blue-500 bg-blue-500/10 text-zinc-50'
                    : 'border-zinc-800 bg-zinc-900/50 text-zinc-300 hover:text-zinc-100',
                )}
              >
                {goalLogicEntrySummary(item, index)}
              </button>
            </li>
          ))}
        </ul>
      )}

      {entry === undefined || selected === null ? (
        <p className="text-xs text-zinc-400">{SELECT_ENTRY_TEXT}</p>
      ) : (
        <div
          role="group"
          aria-label={ENTRY_INSPECTOR_LABEL}
          className="flex flex-col gap-2 rounded-md border border-zinc-800 bg-zinc-900/50 p-3"
        >
          {ENTRY_FIELDS.map((field) => (
            <GoalLogicEntryField
              key={field.key}
              entry={entry}
              selected={selected}
              field={field}
              state={state}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One field of the entry inspector, as its own component.
 *
 * Extracted in story p3-09 so the field's validation messages can come from a hook: the
 * checklist's own rule — `goal-logic-not-completing` — lands on
 * `m_goalLogic[<last>].m_completeQuest`, and a hook cannot be called inside the `map`. The
 * control is unchanged otherwise; the messages render below it (L547).
 */
function GoalLogicEntryField({
  entry,
  selected,
  field,
  state,
}: {
  entry: unknown;
  selected: number;
  field: GoalLogicEntryFieldSpec;
  state: QuestDocumentState;
}): JSX.Element {
  const controlId = `${ENTRY_INSPECTOR_LABEL}-${field.key}`;
  const path = goalLogicEntryPath(selected, field.key);
  const present = state.has(path);
  const messages = useFieldMessages(path);
  const messagesId = `${controlId}-messages`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={controlId} className="text-xs text-zinc-400">
        <TermLabel term={{ field: field.key }} />
      </label>
      {field.kind === 'bool' ? (
        <input
          id={controlId}
          type="checkbox"
          checked={state.value(path) === true}
          aria-invalid={fieldAriaInvalid(messages)}
          onChange={(event) =>
            state.edit(
              updateGoalLogicEntryEdits(
                selected,
                field.key,
                present,
                event.target.checked ? 'true' : 'false',
              ),
            )
          }
          className="h-4 w-4 accent-blue-500"
        />
      ) : (
        <DraftInput
          id={controlId}
          kind={field.kind}
          value={
            field.kind === 'names'
              ? goalLogicNamesText(entry, field.key)
              : String(state.value(path) ?? '')
          }
          onCommit={(raw) =>
            state.edit(updateGoalLogicEntryEdits(selected, field.key, present, raw))
          }
        />
      )}
      <FieldMessages messages={messages} id={messagesId} />
    </div>
  );
}

/**
 * A text/number input for a document-backed field, with a **local draft**.
 *
 * The document is the value; the draft is only what the user is in the middle of typing. The
 * distinction is load-bearing for a comma-separated name list: committing `1_Start,` parses to
 * `['1_Start']`, so an input rendered straight from the document would eat the comma and the
 * next name would be appended to the first one — a second name could never be typed. The draft
 * holds the raw text, the document holds the parsed list, and the effect re-syncs the draft
 * only when the document's *parsed* value has really changed (a canvas disconnect, the Goals
 * tab, the JSON panel) — never for the user's own half-typed text.
 */
function DraftInput({
  id,
  value,
  kind,
  onCommit,
}: {
  id: string;
  value: string;
  kind: 'names' | 'count';
  onCommit: (raw: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    const same =
      kind === 'names'
        ? parseNamesKey(draft) === parseNamesKey(value)
        : draft.trim() === value.trim();
    if (!same) {
      setDraft(value);
    }
  }, [value, kind, draft]);

  return (
    <Input
      id={id}
      type={kind === 'count' ? 'number' : 'text'}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        onCommit(event.target.value);
      }}
      className="h-8 font-mono text-xs"
    />
  );
}

/* --------------------------------------------------------------------- nodes */

interface GoalLogicNodeData extends Record<string, unknown> {
  node: GoalLogicNode;
  onOpenMenu: (nodeId: string, clientX: number, clientY: number) => void;
}

type GoalLogicFlowNode = Node<GoalLogicNodeData, 'goalLogic'>;
type GoalLogicFlowEdge = Edge<{ edge: GoalLogicEdge }>;

/**
 * One node card (docs/spec-ui-design.md L346-355): a type-coloured left stripe, the mono goal
 * name, the `$type`'s TypeName (D60h), the first summary line and the Start badge. The stripe
 * takes its colour from the p3-04 badge vocabulary (`goals.ts`'s `badgeClass`), so the
 * flowchart and the Goals tab name one palette.
 *
 * ## The handles carry `title`, never `aria-label` (story p5-07)
 *
 * React Flow's `Handle` renders a bare `<div>` with **no role**, and `aria-label` is
 * *prohibited* on the generic role (ARIA 1.2) — axe reports it as the **serious**
 * `aria-prohibited-attr` on this tab (`tests/ui/a11y.spec.ts`). The label was therefore inert
 * for assistive tech while looking like a name, which is the worst of both. `title` carries the
 * same words legally: it is the pointer user's tooltip and the generic element's accessible-name
 * fallback. The handles are pointer affordances either way — edge creation is drag-only, and the
 * keyboard-equivalent edit is the `EntryInspector`'s `m_goalsAND`/`m_goalsOR` lists beside the
 * canvas (the audit's §1 ruling, `docs/evidence/phase-5/p5-05-d1-audit.md`).
 */
function GoalLogicNodeCard({ data, selected }: NodeProps<GoalLogicFlowNode>): JSX.Element {
  const node = data.node;
  if (node.kind === 'complete') {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border-2 border-emerald-500 bg-emerald-500/10 px-3',
          selected === true && 'ring-2 ring-blue-500',
        )}
        style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      >
        <Handle
          type="target"
          position={Position.Left}
          isConnectable={false}
          title={TARGET_HANDLE_LABEL}
        />
        <span className="text-sm font-medium text-emerald-300">{node.name}</span>
      </div>
    );
  }
  const first = node.summary[0];
  return (
    <div
      className={cn(
        'relative flex flex-col gap-1 overflow-hidden rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2',
        selected === true && 'ring-2 ring-blue-500',
      )}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      <span
        aria-hidden="true"
        data-testid="goal-type-stripe"
        className={cn('absolute inset-y-0 left-0 w-1', typeStripeClass(node.badgeClass))}
      />
      <Handle
        type="target"
        position={Position.Left}
        isConnectable
        title={TARGET_HANDLE_LABEL}
        className="!bg-zinc-500"
      />
      <div className="flex items-center gap-2 pl-1">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-100">{node.name}</span>
        {node.isStart ? <Badge variant="secondary">{START_BADGE_LABEL}</Badge> : null}
      </div>
      {node.typeTerm === null ? null : (
        <TermLabel term={node.typeTerm} className="truncate pl-1 text-xs text-zinc-400" />
      )}
      {first === undefined ? null : (
        <span className="truncate pl-1 text-[11px] text-zinc-400">
          <TermLabel term={{ field: first.key }} />: {first.value}
        </span>
      )}
      <Handle
        type="source"
        id="and"
        position={Position.Right}
        title={`${AND_HANDLE_LABEL} (solid)`}
        className="!bg-zinc-300"
      />
      <Handle
        type="source"
        id="or"
        position={Position.Right}
        style={{ top: '72%' }}
        title={`${OR_HANDLE_LABEL} (dashed)`}
        className="!border-2 !border-dashed !border-zinc-300 !bg-zinc-900"
      />
    </div>
  );
}

const NODE_TYPES = { goalLogic: GoalLogicNodeCard };

/* ------------------------------------------------------------------ styling */

const MENU_ITEM_CLASS =
  'flex items-center gap-2 rounded px-2 py-1 text-left text-xs text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950';

/** The card's left-stripe class, taken from the p3-04 badge vocabulary's `bg-*` token. */
export function typeStripeClass(badgeClass: string): string {
  return badgeClass.split(' ').find((token) => token.startsWith('bg-')) ?? 'bg-zinc-500';
}

function edgeLabel(edge: GoalLogicEdge): string {
  if (edge.kind === 'complete') {
    return 'Complete';
  }
  return edge.dashed ? 'OR' : 'AND';
}

function edgeColor(edge: GoalLogicEdge): string {
  if (edge.kind === 'complete') {
    return '#10b981';
  }
  return edge.dashed ? '#a1a1aa' : '#3f3f46';
}

/** A parsed name list as a comparable key, so `1_Start,` and `1_Start` are the same text. */
function parseNamesKey(text: string): string {
  return text
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')
    .join('\u0000');
}
