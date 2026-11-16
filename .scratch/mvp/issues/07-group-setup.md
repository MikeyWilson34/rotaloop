# 07 Responsibilities, Event Series, settings
Status: resolved
Blocked by: 06

Admin screens: Responsibilities (headcount, confirmation required, Primary, Qualified Members and queue order), Event Series (weekly / biweekly / monthly / custom, day and time, Responsibilities used), one-off Events, Group settings (Coverage Policy, Replacement Duty, Time Off handling, doubling).

## Answer
**Series expansion** (`src/schedule/expandSeries.ts`, pure, no dependencies): `occurrencesBetween`, `nextOccurrences` (previews), `expandSeries` (new Events to add, deduped by instant), `replacementEvents` (the full future list for `replaceFutureEvents`; Events still at the same instant keep their id, so their Assignments and Skip Dates stay), `zonedTimeToInstant`, `horizonEnd` (`HORIZON_WEEKS = 12`). Time-zone maths uses only `Intl` (checked in Node and Deno). A local time stays fixed across DST; a skipped time moves forward by the gap, and a repeated time uses the first instant (Temporal's "compatible"). Biweekly and custom count from the Sunday-start week of the first matching day on or after `startsOn`. Monthly supports 1st-4th or the last weekday (-1). Event ids are `<seriesId>@YYYYMMDDTHHMMZ`.

**Server** (`src/db/handleGroupCommand.ts`): `addEventSeries` with a pattern and no `events` gets its Events up to the horizon in the same engine command, and `editEventSeries` with a new `repeat` gets `replaceFutureEvents`. `createGroup` does the same. One engine run means one request, one history entry, and the schedule filled at once (the engine fills on every command, so no separate `fillSchedule`). `extendHorizons(store)` is the daily job: for each Group with an active repeating series, it runs `addEvents` as the system (`actorId: null`) with the missing Events, and skips Groups with nothing to add.

**Daily job** (migration `20261118000000_event_horizon_job.sql`): enables `pg_net` and `pg_cron` (both on the free plan) and adds `public.request_event_horizon_extension()`, which POSTs `{"action":"extendHorizons"}` to `group-command` with the key from Vault. Cron job `extend-event-horizons` runs at 08:17 UTC daily and is **active**. The Vault secrets `group_command_url` and `group_command_service_key` (the service role key) are set on the hosted project; nothing secret is in git. The Edge Function refuses that action unless the bearer is the service role key: it is compared to the env key, or checked against the service-role-only RPC `is_service_role_caller()` (migration `20261118000100_service_role_probe.sql`). The anon key and no auth both get 403. Triggered by hand: HTTP 200 `{groups:1, extended:0, failed:0}`. Sync script now also copies `src/schedule`.

**App:**
- Settings tab (`components/group/settings/*`): Group name and time zone (`update_group_details`); Responsibilities (summary, Primary, add, fill order sheet); Event Series and one-off Events (add sheet, remove with confirm); Coverage (Coverage Policy with a Count Real Work warning that counts the Make-up Turns it cancels, Replacement Duty, "Find a replacement by", Time Off handling, doubling) with the prototype's wording. Members see it all read-only.
- `/group/[groupId]/responsibility/[id|new]`: name, a headcount stepper, Needs confirmation, Primary, Qualified Members chips (qualify/unqualify), Rotation order (up/down, `reorderQueue`), Rebalance (confirm says it settles Make-up Turns), Remove (confirm says future seats go). Members get a read-only view.
- `/group/[groupId]/series/[id|new]`: name, repeat (every week / every other week / monthly with 1st-4th or Last / every N weeks), days, time (lenient parser), time zone (Group's by default), start date, Responsibilities, and a live "Next dates" preview. Changing the days or time explains, then confirms, that turns follow to the new dates and need confirming again.
- Overview: the setup checklist (Add Responsibilities, Choose who's Qualified, Set when Events happen, Invite people) while the Group has no Responsibilities or no Event Series. Each item links to its editor.
- New UI: `ReorderList`, `ChoiceSheet`, `Stepper`, and the shared `TimeZoneSheet`. `ValueRow`'s value is now optional. Errors go through `groupCommandMessage` (new setup actions) and `groupDetailsMessage`.
- Pure logic is in `src/lib/groupSetup.ts`.

**Tests:** `src/schedule/tests/expandSeries.test.ts` (44: every frequency, the last weekday, Chicago/London/Sydney DST, skipped and repeated hours, horizon extension, pattern edits); `src/lib/tests/groupSetup.test.ts` (48); `src/db/tests/seriesExpansion.test.ts` (10, PGlite: expansion, edits, the daily job across DST, permissions). 338 in total.

**Live:** `node --env-file=.env scripts/smoke-setup.mjs`, 23/23 ok. The next Chicago DST change (Mar 14) is past today's 12-week horizon, so the script adds the Events the daily job will add (same function) to show both sides at 10:00. Data is in "Smoke Test 07 …" Groups.

**Engine:** not changed.
