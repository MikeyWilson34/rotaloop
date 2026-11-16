# 08 Schedule generation + views
Status: resolved
Blocked by: 03, 07

Generate Assignments from the engine (rolling horizon of about 3 months). Schedule tab (chronological + month, Just me / Everyone), Group schedule, Assignment details, Members tab with fairness counts, schedule history.

## Answer
Generation was already server-side (the engine fills on every command; the daily job keeps the 12-week horizon). This ticket is the read side. No migration was needed (existing `events_group_starts_at`, `assignments_group_event` and `schedule_history_group_at` indexes cover the queries); the engine is unchanged.

**Routes and screens**
- `(tabs)/schedule`: List / Month segmented control; "Just me" / "Everyone in my groups" chips. View, scope, month and selected day are URL params (`?view=month&scope=everyone&month=2026-12&day=2026-12-06`).
  - List: weeks ("This week", "Next week", "Week of Dec 6", with the year when it isn't this year's) with their date range. "Just me": my Assignments as cards (date box, Responsibility, Group with its accent dot, time, status pill; "Make-up Turn" tag; "Covering" pill when I cover), plus my Groups' Skip Dates. "Everyone": one card per Event with each Responsibility's row (who or "Open", status dot); the header opens the Group's schedule.
  - Month: calendar grid (dots per Group, my days filled, today ringed, Skip-Date-only days dashed and struck, legend); tapping a day lists it below. Navigation runs from this month to the last loaded Event's month.
  - Skip Dates: dashed, hatched (SVG pattern), struck date box, "No one needed. Marked by X. Turns move forward one Event." The engine stores no reason, so none is shown.
  - Times are in the device's zone; when the Group's clock reads differently the card adds "(9:00 AM Chicago time)" and the header notes the viewer's zone.
- `/assignment/[groupId]/[assignmentId]` (gate and root layout updated): Group, Responsibility, long date, time and relative day; "Assigned to" / "Covered by X … for Y" (Guest Cover "Name (guest)", Coverage Request shows "Open … was Y"); status pill ("You're covering"); moved notice (from history), Make-up Turn notices (the turn it pays, and the debt it created); "Also at this Event"; History timeline with "Visible to all Members". **`AssignmentActionsSlot`** (marked comment in the screen) is where ticket 09's Confirm / Can't make it / I can cover / Mark covered go; for now it only explains a Coverage Request in words.
- Group screen: **Schedule** tab (`GroupScheduleTab`) lists upcoming Events by week with rows and Skip Dates. **Overview** (`OverviewTab`, was `PlaceholderTabs`) keeps the setup checklist while setup is incomplete, otherwise shows a "Next Event" card with rows; below either, "Schedule history" (newest first, 8 shown, "Show more"). **Members**: "Workload" explainer, "Make-up Turns owed" lines, legend, and a served / upcoming / covering bar plus total per Member (visible to all Members).
- Polish: pull to refresh on every screen, skeleton cards on the Schedule tab, empty states (no groups; "No Events yet. An Admin can add an Event Series in Settings."; nothing for me), dark mode, 48px rows/day cells/nav buttons, centred column respected. `SegmentedControl` options take an optional icon.

**Data loading** (`src/lib/schedule.ts`)
- `useMySchedule()`: memberships (with each Group's settings columns) → one query each for members, responsibilities, event_series, and events from the start of this month **with embedded assignments** (`events.select('…, assignments(…)')` through the composite FK), all `.in('group_id', ids)` under RLS. Five round trips whatever the number of Groups; no `group_state_rows` per Group. Each Group becomes a partial `GroupState` via `stateFromRows`, so the same view functions serve both screens. Realtime: one channel on `events` and `assignments` with `group_id=in.(…)` (up to 100 Groups) plus the person's `members` rows; debounced 400ms quiet reload. Uses the shared `useLoader` (now exported) for loading, error, refresh and reload on focus.
- `useHistory(groupId, stateVersion, { assignmentId?, makeUpTurnId?, limit })`: `schedule_history` newest first; for one Assignment it filters server-side with jsonb containment on `changes` (`[{assignmentId}]`), plus the `makeUpTurnPaid` entry for its Make-up Turn. It reloads when the Group's state version changes (the Group screen already follows `groups` via Realtime).
- `scheduleGroupOf(groupDetails, accountId)` adapts the Group screen's full state.

**Pure view models** (`src/schedule/`, engine imports only; synced to Deno harmlessly)
- `views.ts`: `slotStatus`/`displayStatus` (engine `assignmentStatus`; "Unconfirmed" is shown as Pending), `slotView` (who, "Name (guest)", "Open", coveredFor, requestedBy, mine, covering, makeUpTurn), `eventView`/`eventViews`/`nextEvent`/`findSlot`, `scheduleItems` (me / everyone, Skip Dates after same-day cards), `weekStart`/`weekLabel`/`weekRange`/`groupByWeek` (Sunday weeks, viewer's local date), `monthGrid`/`monthDays`/`dayItems`/`monthBounds`/`shiftMonth`.
- `format.ts`: civil-date and zone formatting, `groupZoneNote`, `relativeDay`, `formatWhen`.
- `history.ts`: `describeHistoryEntry` (a sentence for every engine cause, including `makeUpTurnPaid`, plus Make-up Turn created/cancelled/settled details and "N Assignments changed"), `describeAssignmentChange`, `assignmentHistory`, `movedNotice`, `historyLines`.
- `workloadView.ts`: `workloadSummary` (engine `workload` per Responsibility on Events of the last 91 days and later; upcoming Covers count as covering; former Members left out), `workloadNote`, `makeUpTurnLines` ("Ana owes Ben a Make-up Turn: Jan 4 Sound."), `assignmentMakeUpNotices`.

**Tests:** `src/schedule/tests/{views,format,history,workloadView}.test.ts` (fixture built with the real engine): every status, who-labels, Skip Dates, me/everyone, weeks across both 2026/27 DST changes and the year boundary, month grids (4/5/6 rows), every history cause, Assignment timelines and moves, workload windows, Guest Covers, Make-up Turn lines; plus gate cases for `assignment`. 392 tests in total; typecheck, lint and `functions:check` pass.

**Live:** `node --env-file=.env --import tsx scripts/seed-schedule.mjs [session-file]`, 26/26 ok: two guests (Alex Rivera, Ben Turner), "Smoke Test 08 …" in America/Chicago, Sound (needs confirmation) and Greeter, Placeholders Pat Morgan and Sam Lee, a weekly Sunday 9:00 series, Ben declines a Sound turn and Alex covers it (Ben owes Alex a Make-up Turn), Ben adds a Skip Date, Alex records a Guest Cover (Jordan Blake) for Sam's Greeter turn, one Sound turn Pending and one Confirmed. Website redeployed with `npm run deploy:web`; 32 headless Edge screenshots (390/1440, light/dark) signed in as Alex, all signed in with no horizontal overflow.

**For later tickets**
- 09: put the buttons in `AssignmentActionsSlot` (`src/app/assignment/[groupId]/[assignmentId].tsx`); `SlotView` already carries `mine`, `covering`, `requestedBy`, status. "Find a replacement" status (engine `replacementDutyHolder`) isn't shown yet.
- 10: the prototype's "Add a Skip Date" / "Remove Skip Date" buttons belong on the Group Overview and Schedule tabs and the Schedule header (Time Off icon); `SkipCard` takes `showGroup`. A Skip Date reason would need an engine/schema field.
- 12: `useMySchedule` + `scheduleItems(…, 'me')` give Home's next-Assignment hero and "Needs your attention".
