# 10 Time Off + Skip Dates
Status: resolved
Blocked by: 08

Availability screen (single days, ranges, repeating, Responsibility scoping) and Skip Date flow with before/after preview, open to any Member; removal by anyone.

## Note from ticket 03
The engine treats repeating Time Off as whole weeks in UTC milliseconds and does not handle daylight-saving shifts. Make repeats and Event times timezone-aware (the Group's timezone) here, or in a small engine follow-up first.

## Answer
**Engine** (test-first, minimal):
- `addSkipDate { eventId, reason? }`: `SkipDate.reason` (string or null, trimmed, max 300, else `invalid`). The history cause carries it too.
- `TimeOff` gains `timeZone` and `note` (both optional on `NewTimeOff`, default null). An unknown zone is `invalid`.

**Schema:** new migration `supabase/migrations/20261119000000_skip_reason_time_off_zone.sql` adds:
- `events.skip_date_reason` (1-300 characters, only on a Skip Date);
- `time_off.time_zone` and `time_off.note`;
- a replaced `apply_group_command_result` that writes them.

It is mapped in `groupRows.ts` and parsed in `parseRequest.ts` (reason ≤300, note ≤200, zone checked with Intl). Pushed after a dry run showed only this one pending. `db:types` was regenerated (clean diff) and `group-command` was redeployed.

**DST:** I chose (b), the engine takes a zone. A repeating Time Off with `timeZone` counts whole weeks on that zone's wall clock (`wallClockMs` in `engine/time.ts`, Intl only, cached), so "Sundays 8:30-9:30" stays local. Without a zone it keeps the old UTC behaviour.
- Why not (a): expanding in the app or server can't express open-ended "every week" without a job that keeps extending it, and it multiplies rows and history entries. (b) is about 30 lines plus one column.
- The app always sends the Group's zone.
- "Every month" can't be expressed by the engine (it repeats by whole weeks only), so the app expands it into 12 separate monthly entries, each at local midnight (day clamped to month end).

**Pure modules** (`src/schedule/`):
- `timeOff.ts`: picking, runs, "Applies to" by Responsibility name across Groups, draft → engine entries per Group, the preview (`addTimeOff` applied to each loaded state, net diff → "Ben takes it, and you take Ben's turn on Dec 20." / "Becomes a Coverage Request (… asks for a volunteer / no one free to swap with)"), the toast, the "Your Time Off" items, and calendar marks.
- Batch ids: one save shares an id across Groups, `<batch>-r<n>` or `-r<n>m<k>`, so the list shows and removes a save as one item.
- `skipDate.ts`: reason text, card sentence, candidates, before/after preview (`addSkipDate` on the loaded state) and the affected count.
- `history.ts` (additive): the reason in Skip Date entries; ", repeats weekly" in Time Off entries.

**App:**
- `/time-off` (`src/app/time-off.tsx`, gate + Stack registered): opened from the Schedule header icon and Profile → Time Off. It has:
  - Single days / Date range; a month calendar (picked red, already-off hatched, serving dotted, past disabled);
  - Repeat chips; "Applies to" chips; Note;
  - the preview note; Clear / "Save N days" (writes per Group, retries a conflict once, summary toast);
  - "Your Time Off" with remove and a confirm saying swaps already made stay.
  - Data comes from `src/lib/timeOff.ts` (`group_state_rows` per Group).
- Skip Dates (`components/skipDate/`):
  - "Add a Skip Date" on Overview (with "Upcoming Skip Dates") and on the Group Schedule tab;
  - a 3-step sheet (pick, reason chips + details + notify note, preview rows with "no turn is used up" and "N people affected");
  - "Remove Skip Date" under each Skip Date card, with a confirm that says the Rotation is restored.
- `SkipCard` shows the reason.
- New UI: `Toast` (`showToast`, `ToastHost` in the root layout) and `InfoNote`.
- Errors: added `addTimeOff` / `removeTimeOff` / `addSkipDate` / `removeSkipDate` to `groupErrors.ts` (additive).

**Tests:** 473 pass, including:
- engine: reason, DST across Mar 14 2027, repeatUntil in local time, bad zone, note;
- 24 Time Off view-model tests and 7 Skip Date tests;
- parser and round-trip DB tests (PGlite).

Typecheck, lint and `functions:check` pass.

**Live:** `node --env-file=.env --import tsx scripts/smoke-time-off-skip.mjs [session-file]`: 34/34 ok in "Smoke Test 10 …". It covers:
- the two-person swap;
- askVolunteer making a Coverage Request;
- a Member's Skip Date with a reason (shift forward, reason stored and in history) and another Member removing it (restored);
- a weekly 9:30-10:30 Time Off across the Mar 14 2027 change (Events added as the daily job would) that holds on both sides, with a check that UTC-only weeks would have missed the later Sundays.
