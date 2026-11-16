# 04 Supabase schema + RLS
Status: resolved
Blocked by: 03

SQL migrations for Groups, Memberships (role, placeholder, claim token), Responsibilities, Qualified Members and queue order, Event Series, Events (with a participation model extensible to attendance-style), Assignments (status, confirmation, guest cover), Coverage Requests (race-safe accept via RPC), Make-up Turns, Time Off, Skip Dates, schedule history, notification preferences, and group settings. RLS: Members read their Group; writes per the permissions in spec item 10; health views Admin-only. Generated TS types.

## Answer
Pushed to the hosted project (migration `supabase/migrations/20261115000000_schema_and_rls.sql`), and `group-command` is deployed. Architecture: docs/adr/0004-schedule-writes-go-through-the-engine.md.

**Tables** (engine tables use `(group_id, id)` keys plus `position` to keep array order): `groups` (settings columns, `primary_responsibility_id`, `rotated_through`, `id_sequence`, `state_version`, `name`, `time_zone`), `members` (`account_id` null = Placeholder, `is_admin`, `left_at`), `responsibilities`, `rotations` (`queue text[]`, `turns_taken_early jsonb`), `event_series`, `events` (`skip_date_marked_at/by`), `time_off`, `make_up_turns`, `assignments` (Coverage Request and Cover inline: `coverage_*`, `cover_*`), `schedule_history` (the engine's HistoryEntry plus `state_version` and `cause_type`). Also `profiles` (created by a trigger on sign-up; push on by default, email/SMS opt-ins and phone, `reminder_days_before smallint[]`, `reminder_time`, `time_zone`, `admin_alert_lead_time_ms`, `onboarding_completed_at`), `push_tokens`, and `invite_links` (the Group's join link, plus personal claim links when `member_id` is set). Enum values match the engine's string unions.

**RLS:** active Members SELECT everything in their Groups. Former Members, non-members and anon see nothing. Clients have no INSERT/UPDATE/DELETE on scheduling tables. Profiles: own row only (select/insert/update). Push tokens: own rows, registered via `register_push_token`. Invite links: Admins only.

**RPCs:**
- Clients: `group_state_rows(group_id)` (security invoker, so RLS applies; feed it to `stateFromRows` to run engine previews), `reset_invite_link`, `claim_link_for(group_id, member_id)`, `invite_link_preview(token)`, `update_group_details`, `register_push_token`.
- Service role only: `apply_group_command_result(group_id, expected_version, rows, history)`. It returns the new version, or null on a conflict.

**Edge Function `group-command`** (`supabase/functions/group-command/index.ts`, typed client `src/lib/groupCommand.ts`). Actions:
- `command`: any engine command except `claimPlaceholder`. `addMember` adds a Placeholder and the server picks its id.
- `createGroup`: the creator becomes Admin. Responsibilities, Event Series and Events can only be given here for now (see engine gaps).
- `join`: a join link adds a Member; a claim link claims the Placeholder.

The logic lives in `src/db/handleGroupCommand.ts` (Node-tested), the row mapping in `src/db/groupRows.ts`, and input sanitizing in `src/db/parseRequest.ts`. The function uses generated copies of `src/engine` and `src/db` in `supabase/functions/_shared/` (`npm run functions:sync`). Deploy with `npm run functions:deploy`, check with `npm run functions:check` (`deno check` via npx), push migrations with `npm run db:push`, and regenerate `src/lib/database.types.ts` with `npm run db:types`.

**Tests:** 40 in `src/db/tests/` run the migrations in PGlite with stubbed Supabase roles and `auth.uid()`. They cover RLS, round trips, version conflicts, create/join/claim, permissions, and the Cover race.

**Engine gaps for later tickets** (engine not modified):
- There are no commands to add or edit Responsibilities, Event Series or the Primary Responsibility after creation, to reorder a queue manually, to appoint or remove an Admin, to rename a Member, or to remove an Event. Tickets 06 and 07 need these.
- The engine doesn't check permissions for `addEvents`, `addTimeOff`, `removeTimeOff`, `addMember`, `qualifyMember`, `unqualifyMember`, `requestConfirmation` or `claimPlaceholder`. The server enforces them instead.
