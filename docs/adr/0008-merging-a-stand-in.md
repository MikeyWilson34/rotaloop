# A Stand-in who joined separately is merged into the real Member

Extends [0001](0001-hybrid-queue-rotation.md) and [0007](0007-stand-ins-and-outside-covers.md). A Stand-in can become a real person in two ways. Claiming (their personal link, or picking their name under "Are you one of these?" when joining with the Group's link) is a membership change only: the same Member id gets an account, so the Rotations don't change. But if they joined as someone new, the Group has the same person twice: the Stand-in still holding turns and the real Member. "This is someone in the group" fixes that with the engine command `mergeStandIn { standInId, intoMemberId }`, which any active Member may run ([0006](0006-members-only.md)).

From now on, everything the Stand-in had belongs to the real Member; the past is left alone.

- **Rotations.** In each queue the real Member takes the earlier of the two places and the other place is dropped (keeping the kept place's early turns). A place only the Stand-in had becomes theirs. We drop a place rather than keep both: one person gets one turn per round.
- **Fixed turns.** Future Covers the Stand-in gives and Can't-make-its they asked move to the real Member, and so do outstanding swaps (Make-up Turns) owed either way. A Cover or swap between the two of them is undone, since one person can't cover or owe themselves: if the real Member couldn't make it and the Stand-in covered, the turn needs cover again; if the real Member covered the Stand-in, the turn goes back to the Rotation. A moved Cover that lands on the real Member's dates off, or on a day they already have a fixed turn, is withdrawn and the Group is asked again.
- **Dates off and "Coming?" answers** move too (the real Member's own answer wins on a date both answered).
- **The past** keeps the Stand-in's name. The Stand-in then leaves the Group, and their former Member record keeps the real Member's account. That link is how the planner knows they are one person: whoever served the latest past date rests at the next one ([0005](0005-rotation-rules.md) rule 2), and a former Member counts as the active Member with the same account. This also covers someone who left and rejoined.
- Then the schedule is re-planned as after any command, so the rules apply: no back-to-back when avoidable, and no double booking (if both had a turn on the same date, the later Job in fill order goes to the next person by normal rotation).

## Considered Options

- **Keep both queue places.** The real Member would serve twice per round. Rejected.
- **Keep the Stand-in's place** (their dates stay exactly as they were). Simpler to explain, but the real Member, who joined later, usually has the later place, so they'd wait longest. Rejected for "the earlier of the two".
- **Rewrite past turns to the real Member.** History would no longer show what the Group actually saw. Rejected.
- **A `merged_into` column** instead of reusing the account. It would need a table and persistence change for one link that the account already gives. Rejected for now.

## Consequences

- A left Member row can now hold an account (`members_one_active_per_account` only covers active rows, so this is allowed). Every query for "my membership" already filters `left_at is null`.
- Workload counts (hidden, used by Rebalance) still count the Stand-in's past turns under the Stand-in.
- The UI says "This is someone in the group", and Activity says "Pat's stand-in turns now belong to Ruth." "Merge" stays an engine word.
