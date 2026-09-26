# Story p1-09 — one-time `user_name` gate (task 1.7)

Commit `4d95dda` on `phase-1-foundation`. Evidence protocol: D23 tier 2 (browser),
captured by the lead with playwright-mcp against the real dev stack
(`npm run dev` → Express :3001 + Vite :5173) and the real `data/spiraldb-ui.db`.

**Environment fact (measured):** Vite 5 binds `[::1]:5173` only, so the UI is at
<http://localhost:5173> — `http://127.0.0.1:5173` refuses the connection (curl exit 7).
Every UI automation step below uses `localhost`.

Screenshots (copied out of the playwright-mcp cache root, which is the only
writable location for that tool): [`p1-09-01-modal-open.png`](./p1-09-01-modal-open.png),
[`p1-09-02-after-save-reload.png`](./p1-09-02-after-save-reload.png).

## 1. Starting state — no modal on load

`GET /api/settings` → `"user_name": ""` (the "not asked yet" state). After
navigating to `http://localhost:5173`, the accessibility snapshot shows the
diagnostic panel reading **`User name: not set`** and **no `dialog` node** — the
gate is action-triggered per spec-data-model L229 ("on first status transition or
save"), not a page-load popup.

## 2. First transition with an empty name opens the gate

Clicking **Mark reviewed** (selected quest `DS-ACAD-C01-001`) produced:

```yaml
- button "Working…" [disabled]            # the pending action is held, not applied
- dialog "What should we call you?" [ref=e18]:
  - paragraph: Stored locally in this app's settings and used to attribute status
      changes, metadata and commits. We only ask once.
  - textbox "Your name" [active]         # focus lands in the input on open
  - paragraph: Up to 64 characters.
  - button "Cancel"
  - button "Save name" [disabled]        # disabled while blank
```

DOM assertions (`browser_evaluate`):

```json
{ "label": "empty",  "value": "\"\"",   "saveDisabled": true }
{ "label": "spaces", "value": "\"   \"", "saveDisabled": true }
{ "hasDialog": true, "cancelPresent": true, "ariaModal": "true",
  "labelledBy": "user-name-dialog-title" }
```

Blank and whitespace-only input keep `Save name` disabled and issue **no request**.

## 3. Saving the name resumes the pending action

Typed `Jason` → `Save name` enabled → clicked. The dialog closed, the button
returned to an enabled **Mark reviewed**, and the panel switched to
**`User name: Jason`**. Raw database state immediately afterwards:

```
settings.user_name = "Jason"
status_history (latest):
  id 6  reviewed->reviewed  by "Jason"   (no notes)
DS-ACAD-C01-001 status = reviewed
```

Row 6 is the proof that matters: the transition that triggered the gate was
**resumed automatically after the name was saved** (the user never re-clicked),
and `changed_by` came from the entered name. No console errors or warnings were
recorded during the whole run.

## 4. It never asks again

A second `Mark reviewed` click with the name already set:

```json
{ "dialogPresentAfterSecondAttempt": false }
```

and it appended another history row without any prompt:

```
status_history rows: 7
  id 6  reviewed->reviewed  by Jason
  id 7  reviewed->reviewed  by Jason
```

Reloading `http://localhost:5173`:

```json
{ "dialogPresentAfterReload": false, "panelShowsName": true,
  "panelText": "SpiralDB UIHomeThe app shell arrives in task 1.8.Diagnostic surface
    (temporary)User name: JasonDS-ACAD-C01-001…" }
```

The name survives a reload because it is persisted in `settings`, not in client
storage — so "never ask again" holds across browsers and sessions.

## 5. Server-side default (belt and braces)

The client sends `changed_by` explicitly, but the gate must not be the only thing
keeping attribution correct. From the command line, with `user_name` set:

```
PATCH /api/status/quests/DS-ACAD-C01-002
  {"status":"reviewed","notes":"p1-09 server-default evidence (no changed_by in body)"}
  → 200 {"object_type":"quest","object_key":"DS-ACAD-C01-002","status":"reviewed", …}

GET /api/status/quests/DS-ACAD-C01-002/history
  → {"history":[{"old_status":"extracted","new_status":"reviewed",
       "changed_by":"p1-09-verify", …}]}      # defaulted from settings.user_name
```

The empty state was then restored with `PUT /api/settings {"user_name":""}` so the
browser run above started from a genuine "not asked yet" state.

## Reproduce

```bash
npm run dev                       # Express :3001 + Vite :5173
# open http://localhost:5173 (NOT 127.0.0.1)
curl -s -X PUT localhost:5173/api/settings -H 'content-type: application/json' \
     -d '{"user_name":""}'        # reset the "not asked yet" state to re-see the modal
```
