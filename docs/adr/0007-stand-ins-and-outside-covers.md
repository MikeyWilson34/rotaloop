# Stand-ins and outside covers reuse placeholders and guest covers

Groups include people who will never install the app, and turns are sometimes covered by someone outside the Group. Rather than add new models, a **Stand-in** is the existing Placeholder Member (a Member with no account), and an **Outside cover** is the existing Guest Cover (`cover_kind = 'guest'` with `cover_guest_name`), so neither needed a table change ([0006](0006-members-only.md)'s migration only changed who may act).

- A Stand-in takes Turns like anyone. Any Member may act for them: say they can't make it (the Stand-in stays the one asking), answer "Coming?", or pick who covers. They claim their place later through a personal claim link, keeping their history.
- An Outside cover is one-off and named only: no Member, no Rotation place, and no Swap (Make-up Turn), because the person has no next Turn to swap. The schedule shows them as "Not in group", and history shows the name.
- A Cover can come from the Group (first "I'll cover" wins) or be set directly by the person who can't make it, who picks a Member or types an outside name.

## Consequences

- An Outside cover counts toward no one's workload, so the Member who couldn't make it gets that date off without owing a Turn. We accept that: there is nobody to swap with, and arranging an outside cover is already the effort.
- Acting for a Stand-in is open to everyone, so a Stand-in's Turns can be changed by any Member. Activity records who did it.
