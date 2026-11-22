# Deleting a Group: soft, by any Member, kept 30 days

The product owner asked for a way to delete a Group (2026-11-22). Any active Member may delete it, matching [0006](0006-members-only.md): there are no Admins, so there is no one else to ask. The app asks first ("Delete Sunday Team? This removes the group and its schedule for everyone (4 people). It can't be undone."), and everyone else who was in the Group gets a push: "Sam deleted Sunday Team".

Deleting is soft. `groups.deleted_at` and `groups.deleted_by` are set and every row stays, so a mistake can be undone by hand for 30 days. There is no restore button in the app for now.

## How it works

- **The action.** The app sends `{ action: 'deleteGroup', groupId }` to `group-command`. The handler (`src/db/handleGroupCommand.ts`) checks that the caller is an active Member and calls `mark_group_deleted(group, account)`, a service-role-only RPC that checks membership again and sets the two columns. We used group-command rather than a client RPC so the notify call stays server-side, like every other push.
- **Hidden everywhere, enforced by the database.** Migration `20261126000000_delete_group.sql`:
  - `is_group_member()` (and `is_group_admin()`) return false for a deleted Group. Every RLS policy and member RPC is built on it, so members, jobs, turns, dates off, history, headcount answers and invite links are hidden, and renaming, resetting the link and claim links are refused. This also covers app versions that don't know about `deleted_at`: the deployed app's Groups tab and Home read `members` (joined to `groups`), and those rows are gone.
  - `group_state_rows()` returns no Group for a deleted one, to clients and to the service role. `group-command` and `notify` load Groups only through it, so commands, joins, the daily horizon job, reminders and every other scheduled push skip deleted Groups without any new checks.
  - `invite_link_preview()` and `invite_link_stand_ins()` ("Are you one of these?") return nothing for a deleted Group's links, and a join with `standInId` is refused like any join. The new `deleted_group_for_invite(token)` returns the Group's name, so the join screen can say "Sunday Team was deleted, so this invite link doesn't work anymore."
  - The `groups` row alone stays readable to the people who were in the Group when it was deleted (`was_in_deleted_group()`). Realtime only delivers a change to someone who can read the new row, so this is what lets an open Group page hear about the deletion at once. The app then finds no Group in `group_state_rows`, reads the row's `deleted_at`, and sends the person back to Groups with "Sunday Team was deleted." The deployed app never reads `groups` on its own, so for it the Group just disappears on the next load.
- **Telling the others.** After a successful delete, group-command posts `{ action: 'groupDeleted', groupId }` to `notify`, which reads the deleted Group's name, `deleted_by` and members (service role), and plans one push per remaining Member with an account and push on, not the person who deleted it (`planGroupDeletedNotifications` in `src/notify/plan.ts`). No topic switch turns it off: it is about the whole Group, not one turn. The dedupe key includes `deleted_at`, so a Group restored and deleted again tells people again. Activity is per Group (built from `schedule_history`, which is hidden now), so the push and each person's own `notification_log` row are the only record they get. We didn't add an Activity entry.

## Restoring by hand

Within 30 days, in the SQL editor:

```sql
-- Find it
select id, name, deleted_at, deleted_by from public.groups where deleted_at is not null order by deleted_at desc;
-- Bring it back for everyone (members, schedule, history, invite links are all still there)
update public.groups set deleted_at = null, deleted_by = null where id = '<group id>';
```

Nothing is sent to anyone when a Group is restored. The schedule wasn't extended while the Group was deleted, but the daily horizon job adds the missing dates on its next run.

## Later

- Purging: a job that runs `delete from public.groups where deleted_at < now() - interval '30 days'` (everything cascades). Not built yet, so deleted Groups stay until then.
- An in-app restore, if people need it.

## Tested

`src/notify/tests/deleteGroup-db.test.ts` runs the real migrations in PGlite and checks: who may delete; that nothing in any scheduling table is visible afterwards, including through the deployed app's membership query; that the groups row is visible only to the people who were in the Group; group_state_rows for members and the service role; refused RPCs; the invite preview and deleted message; the hand restore; the push (once, not to the deleter); and that the scheduled run skips the Group.
