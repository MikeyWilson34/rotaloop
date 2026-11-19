# 03 "Invite people" under Members on the group page

Status: resolved
Blocked by: none

From the product owner (2026-11-19): "We should add the invite ability from the Group page without having to click the gear icon. Beneath Members there should be an invite others ability."

## What was built
- Last row of the Members list on the group page: "Invite people" (user-plus icon, same quiet list-row style as "Add stand-in"), so the page keeps one main button.
- Opens the same `InviteSheet` as settings (QR, copy, share, reset) using `fetchGroupInviteToken` / `resetGroupInviteToken`. No new logic.
- Shown to every member, same as settings (which has no admin check today).
- The invite link in settings stays.
- e2e step in `scripts/e2e-nav.mjs`: tap "Invite people", see the join link, close.
