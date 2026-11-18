# 02 More repeat options for Event Series
Status: resolved

Extend `RepeatPattern` (`src/engine/types.ts`), `src/schedule/expandSeries.ts`, validation/parsing (`src/lib/groupSetup.ts`, `src/db/parseRequest.ts`, Edge Function shared copy via `npm run functions:sync`), and the series editor (`src/app/group/[groupId]/series/[seriesId].tsx`) with:
- **Every N days** (N ≥ 1), counted from `startsOn`.
- **Monthly on a date** (1-31; months without that date use the last day — state this in the UI hint).
- **Every N months** for both monthly kinds (Nth weekday and date), phase from `startsOn`'s month.
- **Ends**: never / on a date / after N Events.
Existing stored patterns must keep working unchanged (backward-compatible defaults). DST behaviour as today. Live preview of upcoming dates in the editor reflects the new options. Plain-language summary ("Every 3 months on the 15th, until Jun 30").

## Answer

`RepeatPattern` gains a `'daily'` frequency and five optional fields. A missing field keeps the old behaviour, so stored patterns parse, round-trip and expand exactly as before:
- `intervalDays` (daily only, 1-365): every N days from `startsOn`. `daysOfWeek` is `[]`.
- `dayOfMonth` (monthly only, 1-31): monthly on a date instead of `weekOfMonth`, with `daysOfWeek` `[]`. Months without that date use their last day (the 31st is Apr 30 and Feb 28 or 29).
- `intervalMonths` (monthly only, 1-12, missing = 1): every N months for both monthly kinds, phased from `startsOn`'s month. That month counts even when its matching day falls before `startsOn`.
- `endsOn` (the last local date, inclusive) or `endsAfter` (1-500 Events), not both.

The parser, the row mapping and the editor write the new fields only when they say something (never `intervalMonths: 1` or a null end), so older rows never change.

**How "after N Events" counts:** by the pattern alone, from `startsOn`. The Nth occurrence's date becomes the effective end date. It doesn't depend on which Events exist, so the rolling 12-week horizon can expand again as often as it likes and never makes more than N. An Event marked as a Skip Date still counts as one of the N. Editing keeps `startsOn`, so changing the time doesn't restart the count, but moving `startsOn` does. Changing only the end counts as a pattern change: Events past the new end are removed through `replaceFutureEvents`.

**Editor:** the new chips are "Every few days" and "Monthly", with "Each time on: A weekday / A date". It adds fields for every N days, every N months and the day of the month (its hint says what short months do), plus "Ends: Never / On a date / After a number of Events". The live preview also shows when the last Event falls. Summaries read like "Every 3 months on the 15th at 9:00 AM, until Jun 30" or "Every 10 days at 9:00 AM, 6 times".

**Migration:** `supabase/migrations/20261122000000_repeat_options.sql` widens the `is_repeat_pattern` check on `event_series.repeat`. It is required live: without it the database rejects daily and date patterns. It has not been pushed.

Tests: `src/schedule/tests/repeatOptions.test.ts` covers expansion. The engine, parser, persistence (PGlite with the migration) and form cases are in the existing test files.
