# 04 Data + commands: members only (no admins), stand-ins, outside covers

Status: resolved
Blocked by: 01 (engine rules)

Reference: `design/prototype/simple.html` (`add-standin`, `isStandIn`, `isGuest`, `cant-self`). Spec: `.scratch/simplify/spec.md`.

- **No admins for now:** every group member may do what admins did (edit jobs, group dates off, rename, time zone, add stand-ins, pick someone for a turn, act for a stand-in). Change RLS/policies and the `group-command` function accordingly via a new migration; keep the admin column (hide, don't migrate). Add a test that a plain member can run each former admin command.
- **Stand-ins:** a member who isn't on the app (a named placeholder with no user account), in the rotation like anyone. Reuse the existing placeholder/invite-link mechanism if it exists. Any member can add one ("Add stand-in"), and can mark a stand-in's turn "can't make it" on their behalf (asker = the stand-in). A stand-in can later claim their spot via the invite link.
- **Outside cover:** when someone covers a turn they can be a typed name of a person who isn't in the group (one-off, not a member, not in the rotation, no swap/make-up turn is created since they have no next turn). Model it so history/Activity can show the name and the schedule can show "Not in group".
- Cover can be set directly by the person who can't make it ("I'll find someone to cover": pick a member or type a name) as well as by the group asking and the first volunteer taking it.
- Regenerate `src/lib/database.types.ts` if the schema changes (`npm run db:types` needs the remote; if unavailable, hand-edit and say so). Do NOT run `db:push` or deploy functions: report the migration and I will apply it.

Acceptance: `npm test`, `npm run typecheck`, `npm run lint`, `npm run functions:check` pass; new tests for the above. Do not commit or push.
