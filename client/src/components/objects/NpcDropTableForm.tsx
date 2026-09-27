import { NPC_DROP_TABLE_LIST_KEY, numberIdFromRaw, readStringList } from '@shared/simpleObjects';

import type { QuestDocumentState } from '../../hooks/useQuestDocument';
import FriendlyNameDropdown from '../FriendlyNameDropdown';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import ObjectIdMultiSelect from './ObjectIdMultiSelect';

/**
 * The NpcDropTable editor — plan task 4.6 / story p4-06 AC1, docs/spec-domain-reference.md
 * L166-181.
 *
 * The document is `{TemplateID, DropTableNames}` and nothing else, and the **family has no
 * corpus at all** (`NpcDropTable/` does not exist in the fork) — see
 * `shared/simpleObjects/npcDropTable.ts` for every measured number and for why that is a fact
 * rather than an omission. So this form is schema-driven, and its two controls are the two the
 * criterion names:
 *
 * | AC1's words | here |
 * |---|---|
 * | "NPC dropdown" | `FriendlyNameDropdown` over `npcs`, the raw id converted by the one helper |
 * | "`DropTableNames` multi-select sourced from synced `drop_tables` names" | the shared `ObjectIdMultiSelect` with `idKind="text"`, chips showing the **name** |
 *
 * ## The list is text, and that is the whole difference from the three p4-03 forms
 *
 * `DropTableNames` holds DropTable **names** (`"WC-UNICORN-MAIN-007"`), not ids: the names table
 * is `drop_tables`, whose `idColumn` is `name` and whose `idKind` is `text`
 * (`server/src/services/names.ts`), and the 317 names are exactly the 317 `DropTables/*.json`
 * keys. So the multi-select takes the text kind — the shared component carries it rather than a
 * second chips implementation existing (D71(i)) — and a value the table does not hold still
 * renders as itself and can be typed back in the raw-value box (the spec's own
 * `WC-UNICORN-BONUS-001` is that case, measured).
 *
 * ## Edits go through the document state, and the array is replaced whole
 *
 * Both controls write through `state.edit` with a `DocPath` rather than spreading the object
 * (D58: the shared document primitives are the editors' mutation contract), so key order and any
 * unknown key survive (D5/D57). Membership and order are the editor's, so one `set` of
 * `DropTableNames` is one unambiguous edit and the server's D5 merge takes the incoming array —
 * several chips down to `[]` still saves `[]`, never `null` and never a dropped key.
 *
 * Removal is **index**-addressed inside the shared component, so a name repeated in one file
 * survives every unrelated edit.
 */
export interface NpcDropTableFormProps {
  /** The live document (the layout's baseline-aware model). */
  document: Record<string, unknown>;
  /** `view` renders the same fields read-only; `edit` renders the controls. */
  mode: 'view' | 'edit';
  /**
   * The live document state — the D58 mutation contract (`edit`/`editAll`) rather than a
   * bespoke setter, so a form that mounts a shared editor needs no adapter.
   */
  state: QuestDocumentState;
  disabled?: boolean;
}

export default function NpcDropTableForm({
  document,
  mode,
  state,
  disabled = false,
}: NpcDropTableFormProps): JSX.Element {
  const editing = mode === 'edit' && !disabled;
  const templateId = document.TemplateID;
  const names = readStringList(document, NPC_DROP_TABLE_LIST_KEY);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">NPC</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {editing ? (
            <FriendlyNameDropdown
              type="npcs"
              name="TemplateID"
              value={typeof templateId === 'number' ? templateId : null}
              onChange={(rawId) => {
                // The one raw-id conversion (`shared/ulong.ts` through the model): the document
                // must carry a JSON number, never the control's string. An unparsable id writes
                // nothing, so the key keeps the value it had.
                const parsed = numberIdFromRaw(rawId);
                if (parsed !== undefined) {
                  state.edit({ op: 'set', path: ['TemplateID'], value: parsed });
                }
              }}
              aria-label="NPC TemplateID"
              placeholder="Select an NPC…"
            />
          ) : (
            <>
              <span className="font-mono text-sm text-zinc-100">
                {templateId === undefined || templateId === null ? '—' : String(templateId)}
              </span>
              <span className="text-xs text-zinc-500">TemplateID (the key of this file)</span>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Drop tables</CardTitle>
        </CardHeader>
        <CardContent>
          <ObjectIdMultiSelect
            type="drop_tables"
            idKind="text"
            noun="drop table"
            idPrefix="npc-drop-table"
            values={names}
            disabled={!editing}
            emptyText="This NPC rolls no drop tables (the file carries an empty DropTableNames array)."
            rawIdLabel="Add a drop table name"
            help="All 317 DropTable names are in the drop_tables table; a name it does not hold (the spec's own WC-UNICORN-BONUS-001) can still be typed in and is kept verbatim."
            onChange={(next) => {
              state.edit({ op: 'set', path: [NPC_DROP_TABLE_LIST_KEY], value: next });
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
