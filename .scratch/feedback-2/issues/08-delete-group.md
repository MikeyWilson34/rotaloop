# 08 Delete a group

Status: resolved

From the product owner (2026-11-22): "I think we need to add the ability to delete groups as well."

Decision (owner chose): any active member can delete (members only, no admins, ADR 0006), with a clear confirm. The others are told, and the group is kept hidden on the server for 30 days so a mistake can be undone by hand. No in-app restore for now. See `docs/adr/0009-deleting-a-group.md`.

Built:
- **Server** (migration `20261126000000_delete_group.sql`, additive): `groups.deleted_at`, `groups.deleted_by`. `is_group_member()` is false for a deleted group, so all RLS and member RPCs hide or refuse it, old app versions included. `group_state_rows()` returns no group for a deleted one, so group-command (commands, joins, the horizon job) and notify (reminders and all scheduled pushes) skip it. `invite_link_preview()` and `invite_link_stand_ins()` hide deleted groups, and the new `deleted_group_for_invite()` lets the join screen say so. The `groups` row stays readable to the people who were in it, so Realtime reaches an open group page. `mark_group_deleted()` is service role only. New `notification_kind` value `groupDeleted`.
- **group-command** has a new `deleteGroup` action: an active member only. It then asks notify (new `groupDeleted` action) to send "Sam deleted Sunday Team" / "The group and its schedule are gone for everyone." to everyone else still in the group with push on. Tapping it opens Groups.
- **App:**
  - Group settings has "Delete group" under "Leave group" (same red text row).
  - Confirm sheet: "Delete Sunday Team?" / "This removes the group and its schedule for everyone (4 people). It can't be undone." It counts people with an account, you included, not stand-ins. Alone it says "for you". One main button, "Delete group".
  - On success: back to the Groups tab with the toast "You deleted Sunday Team".
  - Anyone with the group, its settings or a turn open is sent back to Groups with "Sunday Team was deleted." This happens live through Realtime, or on the next load.
  - The join link says "Sunday Team was deleted, so this invite link doesn't work anymore."
- Activity is per group and is hidden with it, so the push (and the person's notification log) is where the event lives.
- **Tests:**
  - PGlite: `src/notify/tests/deleteGroup-db.test.ts`.
  - Unit: `src/lib/tests/deleteGroup.test.ts` and `src/notify/tests/plan-groupDeleted.test.ts`.
  - e2e:nav: creates a throwaway group, checks the Delete row and confirm sheet, deletes it, and checks it's gone from Groups and Home, that a second tab with it open is sent back, and that its join link says deleted. The deleting steps are skipped with a "needs server deploy" note until the migration is live.
- e2e:nav uses main's `revealJob()` (ticket 05) for the "Show more dates" date issue; this ticket's duplicate helper was dropped in the merge.

Deploy: `db:push` (the migration) first, then `functions:deploy` (group-command and notify).
