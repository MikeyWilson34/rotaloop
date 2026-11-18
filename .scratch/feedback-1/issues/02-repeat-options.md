# 02 More repeat options for Event Series
Status: ready-for-agent

Extend `RepeatPattern` (`src/engine/types.ts`), `src/schedule/expandSeries.ts`, validation/parsing (`src/lib/groupSetup.ts`, `src/db/parseRequest.ts`, Edge Function shared copy via `npm run functions:sync`), and the series editor (`src/app/group/[groupId]/series/[seriesId].tsx`) with:
- **Every N days** (N ≥ 1), counted from `startsOn`.
- **Monthly on a date** (1-31; months without that date use the last day — state this in the UI hint).
- **Every N months** for both monthly kinds (Nth weekday and date), phase from `startsOn`'s month.
- **Ends**: never / on a date / after N Events.
Existing stored patterns must keep working unchanged (backward-compatible defaults). DST behaviour as today. Live preview of upcoming dates in the editor reflects the new options. Plain-language summary ("Every 3 months on the 15th, until Jun 30").
