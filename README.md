# Chronos

Chronos is a local-first, mobile-first scheduling assistant. Describe a focus block in plain language, review potential overlaps, and save it locally or to Google Calendar. Its horizontally scrollable seven-day calendar supports editing and deleting individual blocks. Each scheduled date is a separate event; recurring requests expand into individual dates rather than recurrence rules.

## Run locally

```sh
npm install
npm run dev
```

Open the localhost URL printed by Vite (typically `http://127.0.0.1:5173`). Create a production build with `npm run build`; run the NLP, calendar, and scheduler tests with `npm test`.

## Connect Google Calendar

1. In Google Cloud Console, create a project, enable the Google Calendar API, and configure the OAuth consent screen.
2. Create an OAuth client ID for a **Web application** and add the exact Vite origin (usually `http://127.0.0.1:5173`) to **Authorized JavaScript origins**.
3. In Chronos, select **Connect calendar**, enter the client ID, and authorize calendar event access. Use `primary` or another calendar ID.

Chronos uses Google Identity Services' browser token flow. The OAuth client ID is public application configuration; the access token stays in memory and is discarded when the tab closes or reloads. Blocks and preferences are stored in this browser's local storage. Connecting requests the `calendar.events` scope so the app can create, move, or delete events when you choose those conflict actions.

## Scheduling and conflict behavior

- Examples: `Block 2–3 PM for coding every day this week`, `Focus on writing from 9 to 10 AM every weekday`, `Study on Tuesday from 6 to 7 PM`, and `Read at 2 PM for 90 minutes`.
- Repeated requests create one calendar event per matching day for the next seven calendar days, not a recurring event rule. Today's blocks that have already started are skipped.
- Before saving, Chronos checks local blocks and timed or all-day Google Calendar events for overlaps on each requested date.
- On conflict, choose to move the new blocks to the next available daytime slot, move existing timed Google events, permanently delete conflicting Google events, allow overlaps, or cancel.
- The delete option requires confirmation. All-day Google events and local blocks cannot be moved or deleted through the conflict dialog.
- Select an owned block in the calendar to edit its task, date, and time. Changes to a Google-synced block require an active connection and update its individual Google event.
- Voice input uses the browser Web Speech API when available; typing works in all supported browsers. Enter submits the schedule; Shift+Enter adds a line.

The parser uses `compromise` and `compromise-dates` for natural-language date interpretation, with explicit time-range, duration, and weekday rules for reliable scheduling. Time zones come from the browser. Travel-time buffers, geolocation, and AI integrations are outside the current v1 scope.
