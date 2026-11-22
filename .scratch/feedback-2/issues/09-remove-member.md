# 09 Remove someone from a group

Status: resolved

From the product owner (2026-11-22): "I also need a way to remove other users. Like if someone stops using the app and didn't leave themself."

Rule: any active member can remove any other member (members only, no admins, ADR 0006; same as delete group, ticket 08).

Built:
- **Server (no migration):** the engine's `permissionError` only let you remove yourself or a stand-in; `removeMember` is now open to any active member. group-command runs that same engine, so it needs `functions:deploy` (group-command only). Backward compatible: it only loosens a check, old apps are unaffected. Removing sets `left_at`, and RLS (`is_group_member` needs `left_at is null`) already hides the group from the removed person, so for them it just disappears.
- **App:** in Members, tapping another real member opens a small sheet: their name, "Remove from group" (red quiet button), Close. Not on your own row (use Leave group). A stand-in's sheet gets "Remove from group" under "This is someone in the group". Confirm: "Remove <Name>?" / "Their upcoming turns go to the next people in the rotation. They can join again with the invite link." (stand-in: first sentence only), one main button "Remove". Then toast "<Name> removed" and the row is gone. New `quietDanger` Button variant; wording in `src/lib/removeMember.ts`.
- **Activity:** "You removed Ben from the group. Their future turns moved to others." (leaving yourself still reads "Ben left the group…"); history tests cover removal by someone else.
- **Push:** none exists for a member leaving or being removed, and adding one is more than a small change in the notify path. Left for later ("<Name> removed you from <Group>").
- **Tests:** engine, handleGroupCommand (any member removes an app user, who is then `notMember`), history, `src/lib/tests/removeMember.test.ts`. e2e:nav adds a stand-in and removes it (sheet, confirm, toast, gone), then a second browser context joins by link and is removed; the real-member removal is skipped with a "needs server deploy" note until group-command is deployed.

Deploy: `functions:deploy` (group-command). No `db:push`.
