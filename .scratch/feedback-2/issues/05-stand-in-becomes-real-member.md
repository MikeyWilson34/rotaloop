# 05 Stand-ins become real people smoothly when they join

Status: resolved
Blocked by: none

From the product owner (2026-11-19): "we need to plan how to replace stand-ins with real people smoothly if they accept an invite."

## What exists today
- Each stand-in has a personal claim link (`claim_link_for` RPC, `fetchClaimToken` in `src/lib/inviteLinks.ts`; opened from the stand-in's row in Members). Joining through it makes that person the stand-in, keeping their turns.
- The general group invite link (`fetchGroupInviteToken`) always creates a NEW member. If "Ruth" was a stand-in and joins through the general link, the group ends up with Ruth twice: the stand-in (still holding turns) and the real Ruth (with no turns).

## To plan
- On joining via the general link, if the group has stand-ins, ask "Are you one of these?" (list stand-in names, plus "No, I'm new"). Picking one claims it.
- Should a name match be suggested automatically ("Ruth Smith" vs stand-in "Ruth")? Never claim silently.
- Undo / fix-up: let a member merge a duplicate (real person + stand-in) afterwards, moving the stand-in's future turns, covers and dates off onto the real person.
- Notify the group: "Ruth joined and took over her turns."
- Engine: claiming is a membership change only (same member id), so the rotation is untouched; a merge of two ids is not, and needs engine design (ADR).

## Follow-up (product owner, 2026-11-22): the joiner's name replaces the stand-in's name
"If someone replaced a stand in, then the username they have should replace the stand in name."
- `claimPlaceholder` now takes the joiner's own name (`name`, the same one they'd get joining as new) and renames the member like `renameMember`, so past turns and activity show the new name. An empty name keeps the stand-in's. It also carries `standInName` (set by the server) for the Activity line: "Ruth Smith joined and took over Ruth's turns."
- Done in the server's join path (`handleGroupCommand`) for both "Join as <name>" and a personal claim link, so it needs only a `group-command` deploy. No migration; old clients already send `memberName` and get it too. The merge path is unchanged (it already ends with the real member's name).
- e2e: the name step skips with "needs server deploy" while the deployed `group-command` is the old one.
