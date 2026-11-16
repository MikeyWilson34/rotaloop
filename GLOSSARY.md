# Rotaloop

The language for sharing recurring responsibilities fairly across a group of people.

## Groups and people

**Group**:
A set of people who share recurring Responsibilities, with its own Members, Rotations, rules and history.
_Avoid_: Team, ministry, organization

**Member**:
A person who belongs to a Group. A person can be a Member of many Groups, with different permissions in each.
_Avoid_: Volunteer, user (in domain discussion)

**Admin**:
A Member who can manage a Group's Rotations, Skip Dates, settings and other Members' Assignments. A Group can have several Admins. Being an Admin is separate from serving: an Admin is rotated only for the Responsibilities they're a Qualified Member of.
_Avoid_: Owner, leader, manager

**Placeholder Member**:
A Member added by an Admin by name, without an account yet. They are rotated like anyone else and are claimed when the person joins through an invitation.
_Avoid_: Guest, offline member

## Scheduling

**Event**:
One dated, timed occurrence on a Group's schedule that needs Responsibilities filled. A Group can have more than one Event on the same day.
_Avoid_: Service, slot, date, occurrence

**Responsibility**:
A kind of duty a Group needs filled at its Events, such as Sound or Greeter, with a headcount of how many people each Event needs.
_Avoid_: Role, job, position, task

**Qualified Member**:
A Member who is eligible to be assigned a particular Responsibility.
_Avoid_: Eligible member, trained member

**Assignment**:
One Member filling one seat of one Responsibility at one Event.
_Avoid_: Shift, slot, booking, duty

**Rotation**:
The ordered queue of Qualified Members for one Responsibility, which decides who is assigned next. A Member passed over because they were unavailable keeps their place at the front.
_Avoid_: Roster, cycle, order

**Rebalance**:
An Admin action that reorders a Rotation by workload, so whoever has served least goes first. It settles any outstanding Make-up Turns for that Responsibility.
_Avoid_: Reshuffle, regenerate

**Primary Responsibility**:
The one Responsibility a Group marks as its headline, such as Worship Lead. Whoever holds it at the next Event is shown on the Group's card.
_Avoid_: Lead role, main role

**Event Series**:
A repeating pattern that creates a Group's Events, such as Sundays at 9:00am weekly. It also names which of the Group's Responsibilities those Events need. A Group can have several Event Series, plus one-off Events.
_Avoid_: Recurrence, schedule template, cadence

**Skip Date**:
An Event marked by any Member or Admin as needing no one, such as a holiday or a closure. No turn is used up: everyone assigned from that Event onward moves forward one Event in their Rotation.
_Avoid_: Blackout, cancellation, holiday

**Unconfirmed**:
An Assignment that still has no confirmation when an Admin's chosen alert time arrives. Admins are alerted, and it is never declined automatically.
_Avoid_: Overdue, unanswered

## Changes and coverage

**Decline**:
A Member saying they can't fill one of their Assignments. It turns that Assignment into a Coverage Request.
_Avoid_: Cancel, drop, opt out

**Time Off**:
Dates, ranges or repeating periods when a Member can't serve, optionally limited to certain Responsibilities. The Rotation routes around Time Off: the next Member in line takes the affected Event, and the absent Member keeps their place at the front.
_Avoid_: Unavailability, blackout, vacation

**Coverage Request**:
An Assignment whose Member has Declined it and that is waiting for someone else to fill it. Its status is "Needs coverage".
_Avoid_: Open shift, swap request, sub request

**Cover**:
To take over another Member's Assignment from a Coverage Request. Only that Responsibility's Qualified Members can Cover, and the first to accept gets it. Covering always counts toward the workload of the Member who covers.
_Avoid_: Sub, fill in, swap

**Replacement Duty**:
A per-Group setting that decides who must find someone when a Coverage Request gets no volunteer by the Group's "find a replacement by" deadline (default 3 days before the Event): the Member who declined (the default) or the Admins. Admins are informed either way.
_Avoid_: Escalation, fallback

**Guest Cover**:
Cover arranged with someone outside the Group, recorded by name only. It counts toward no one's workload and creates no Make-up Turn.
_Avoid_: External sub, outside volunteer

**Coverage Policy**:
A per-Group setting that decides what a Decline costs: either Count Real Work (no debt) or Pay It Back (the Member who declined owes a Make-up Turn). New Groups start on Pay It Back.
_Avoid_: Debt mode, fairness mode

**Make-up Turn**:
Under the Pay It Back policy, the turn a Member who declined owes to the Member who covered them. It is paid by taking that Member's next turn in the same Responsibility.
_Avoid_: Debt, IOU, owed turn
