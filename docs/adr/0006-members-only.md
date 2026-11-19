# Members only: no Admins for now

Testers found the app too complex, and the Admin role added screens, permissions and words ("Only Admins can do that") for groups that just want something simpler than a group text. So every active Member may now do what Admins did: edit Jobs, add the Group's Dates off, rename the Group, change its time zone, reset the invite link, add Stand-ins, pick someone for a Turn and act for a Stand-in. The engine (`src/engine/commands.ts`) and the `20261123000000_members_only.sql` migration apply that rule. This supersedes the "Admin-only commands" part of [0004](0004-schedule-writes-go-through-the-engine.md): permissions still live in the engine, but the check is now "is an active Member" (or "is this Member, or a Stand-in", for Turns and answers).

We hid Admins instead of removing them. `members.is_admin`, `is_group_admin`, the `setAdmin` command and its last-Admin guard all stay, and a Group's creator is still stored as an Admin, so the role can come back without a data migration if groups ask for it.

## Consequences

- Anyone in a Group can change anything in it. History (Activity) shows who did what, and that is the only safeguard for now.
- Admin copy is gone from the UI (banned-words test `src/lib/tests/bannedWords.test.ts`). Older history entries for `setAdmin` read "changed X's group permissions".
- The `lastAdmin` refusal can only come from `setAdmin`, which no screen sends; it maps to a generic message.
