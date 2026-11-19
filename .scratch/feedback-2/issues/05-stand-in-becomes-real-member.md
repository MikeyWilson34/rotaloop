# 05 Stand-ins become real people smoothly when they join

Status: needs-triage (parked by the product owner, 2026-11-19: "make a note of that and handle that later")
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
