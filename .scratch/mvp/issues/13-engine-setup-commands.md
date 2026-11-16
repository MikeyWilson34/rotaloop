# 13 Engine: Group setup and admin commands
Status: resolved
Blocked by: 03, 04

Gaps found in ticket 04. Add engine commands (pure, tested) and wire them through src/db mapping, the persistence function and group-command:
- Add, edit and remove Responsibilities (name, headcount, requiresConfirmation, order). Set the Primary Responsibility.
- Add, edit and remove Event Series (repeat pattern: weekly / biweekly / monthly / custom; day, time, Responsibilities used). Add or remove one-off Events. Expanding a series into Events stays outside the engine (a server job), but the repeat-pattern column must exist.
- Reorder a Rotation queue by hand (Admin).
- Appoint or remove an Admin; block removing or leaving as the last Admin.
- Rename a Member (own display name, or an Admin renaming a Placeholder).
- Move the permission checks the server does today (addEvents, addTimeOff, removeTimeOff, addMember, qualifyMember, unqualifyMember, requestConfirmation) into the engine, so the rules live in one place.
- Every change produces history plus minimal Assignment diffs, as before.

## Answer
Engine commands (pure, in `src/engine/commands.ts`; types in `types.ts`). Each returns minimal Assignment `changes` plus `history`, like the rest:
- `renameMember { memberId, name }`, `setAdmin { memberId, isAdmin }`.
- `addResponsibility { responsibility: NewResponsibility, qualifiedMemberIds? }`, `editResponsibility { responsibilityId, changes: { name?, headcount?, requiresConfirmation? } }`, `removeResponsibility { responsibilityId }`, `reorderResponsibilities { responsibilityIds }` (fill order), `setPrimaryResponsibility { responsibilityId | null }`.
- `reorderQueue { responsibilityId, queue }` (Admin): the queue must list the current Qualified Members exactly once. It forgets `turnsTakenEarly` exactly as Rebalance does (shared `withQueueOrder` in `rotation.ts`), but Make-up Turns stay outstanding, because only Rebalance orders by workload.
- `addEventSeries { series: NewEventSeries, events? }`, `editEventSeries { seriesId, changes: { name?, responsibilityIds?, repeat? }, replaceFutureEvents? }`, `removeEventSeries { seriesId }`, `removeEvent { eventId }` (one-off Events only; a series' Event takes a Skip Date or a series edit).

Reconciliation: the past never changes. Headcount, a removed Responsibility or Event, or a series' changed Responsibilities are all recomputed by the normal schedule step. Assignments of removed Events are matched like any future Assignment, so a turn moves to the next Event, or they are removed. A Decline or Cover whose seat no longer exists is dropped (Covers are kept before open Coverage Requests when a headcount falls). A dropped Cover's Make-up Turn is cancelled (`coverWithdrawn`). Removing a Responsibility cancels its Make-up Turns (new closed reason `responsibilityRemoved`), empties its queue and clears it as Primary. Requiring confirmation asks future Assignments to confirm (`notYetRequested`). Removed Responsibilities and Event Series are kept with `removedAt`, because past rows still reference them.

Permissions now live in the engine (`permissionError` in `commands.ts`). `src/db/handleGroupCommand.ts` only authenticates the caller and resolves their active Member id. The system (`actorId: null`) may do anything. Other actors must be active Members, except someone joining, who may add only themselves as a plain Member. Admins may do everything. Members may: manage their own Time Off, rename themselves, leave, add and remove Skip Dates, confirm and Decline their own Assignments, Cover, and mark covered when they hold Replacement Duty (the last three are checked per Assignment, as before). Everything else is Admin-only (`notPermitted`). The last active Admin can't step down, leave or be removed (new reason `lastAdmin`). A Placeholder can't be made Admin until claimed.

Database: migration `supabase/migrations/20261116000000_setup_commands.sql` adds `responsibilities.removed_at`, `event_series.repeat` (jsonb `RepeatPattern`: `frequency` weekly | biweekly | monthly | custom, `intervalWeeks` for custom, `daysOfWeek` 0-6, `weekOfMonth` 1-4 or -1 for monthly, `startTime` "HH:MM", `timeZone` IANA, `startsOn` "YYYY-MM-DD"), shape-checked by `is_repeat_pattern`. It also adds `event_series.removed_at` and the `responsibilityRemoved` enum value, and replaces `apply_group_command_result` to write the new columns. Mapped in `groupRows.ts`, parsed in `parseRequest.ts` (time zone checked with `Intl`), typed in `protocol.ts` and `src/lib/groupCommand.ts` (`CommandOf<'...'>` plus re-exported types). `database.types.ts` was hand-edited. The engine stores the repeat pattern but never expands it. An expansion job still has to be written (it would add Events with `addEvents`, or replace them with `editEventSeries.replaceFutureEvents`).

Deploy: `npx supabase db push --remote` stopped at the CLI's consent prompt for the production project (nothing changed). The owner must run `npx supabase db push --remote` (confirm it, or add `--yes`), then `npm run functions:deploy`, then optionally `npm run db:types` to confirm the hand-edited types. Don't deploy the function before the migration.

Tests: `src/engine/tests/setup-commands.test.ts` (46), plus PGlite round trips for the new fields and the repeat check, server tests for permissions, `lastAdmin` and the setup commands, and parser tests. 160 engine and db tests in all (215 including `src/lib/tests`).
