# Chronos

Chronos is a local-first personal workspace with a visual workflow builder and a natural-language scheduler.

## Run locally

```sh
npm install
npm run dev
```

Open the localhost URL printed by Vite (typically `http://127.0.0.1:5173`) for Workflow Studio, or visit `/scheduler.html` for the personal scheduler. Create a production build with `npm run build`; run tests with `npm test`.

## Workflow Studio

Create Input, Process, and Output nodes from the palette, then connect a node's output port to a compatible input port. Select nodes to edit their names and variables, set JSON defaults, and configure process expressions. The deterministic runner evaluates nodes in topological order, highlights the first failed step, and records inputs and outputs in the trace panel. Expressions support input names, parentheses, arithmetic, comparisons, booleans, null, and quoted strings; arbitrary JavaScript is not evaluated.

Workflows are saved in browser local storage. Use **Export JSON** and **Import** to move a graph between browsers. The canvas also supports node dragging, pan, zoom, fit, undo, and redo. Deleting a connected node prompts before its edges are removed, leaving downstream inputs unconnected.

Workflow graphs are versioned JSON objects with `version`, `nodes`, and `edges` fields. The workflow engine is dependency-free and its tests run with `npm test`.

## Personal scheduler

Chronos is also a local-first, mobile-first scheduling assistant. Describe a focus block in plain language, review potential overlaps, and save it locally or to Google Calendar. Its horizontally scrollable seven-day calendar supports editing and deleting individual blocks. Each scheduled date is a separate event; recurring requests expand into individual dates rather than recurrence rules.

## Connect Google Calendar

1. In Google Cloud Console, create a project, enable the Google Calendar API, and configure the OAuth consent screen.
2. Create an OAuth client ID for a **Web application** and add the exact Vite origin (usually `http://127.0.0.1:5173`) to **Authorized JavaScript origins**.
3. In Chronos, select **Connect calendar**, enter the client ID, and authorize calendar event access. Use `primary` or another calendar ID.

Chronos uses Google Identity Services' browser token flow. The OAuth client ID is public application configuration. The short-lived access token is kept in session storage so a page reload in the same tab can automatically sync; it is cleared when the tab session ends, the user disconnects, or the token expires. Blocks and preferences are stored in this browser's local storage. Connecting requests the `calendar.events` scope so the app can create, move, or delete events when you choose those conflict actions.

## Scheduling and conflict behavior

- Examples: `Block 2–3 PM for coding every day this week`, `Focus on writing from 9 to 10 AM every weekday`, `Study on Tuesday from 6 to 7 PM`, and `Read at 2 PM for 90 minutes`.
- Repeated requests create one calendar event per matching day for the next seven calendar days, not a recurring event rule. Today's blocks that have already started are skipped.
- Before saving, Chronos checks local blocks and timed or all-day Google Calendar events for overlaps on each requested date.
- On conflict, choose to move the new blocks to the next available daytime slot, move existing timed Google events, permanently delete conflicting Google events, allow overlaps, or cancel.
- The delete option requires confirmation. All-day Google events and local blocks cannot be moved or deleted through the conflict dialog.
- Select an owned block in the calendar to edit its task, date, and time. Changes to a Google-synced block require an active connection and update its individual Google event.
- Voice input uses the browser Web Speech API when available; typing works in all supported browsers. Enter submits the schedule; Shift+Enter adds a line.

The parser uses `compromise` and `compromise-dates` for natural-language date interpretation, with explicit time-range, duration, and weekday rules for reliable scheduling. Time zones come from the browser. Travel-time buffers, geolocation, and AI integrations are outside the current v1 scope.
