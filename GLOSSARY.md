# Rotaloop

The language for sharing recurring jobs fairly across a group of people. The first part is what people see in the app. The second part is the engine's own words, which stay in code and must never appear in the UI (a banned-words test checks this).

## In the app

**Group**:
A set of people who share recurring Jobs, with its own Members, schedule and history.
_Avoid_: Team, ministry, organization

**Member**:
A person who belongs to a Group. Every Member can do everything in their Group; there are no Admins for now (ADR 0006).
_Avoid_: Volunteer, user, Admin, Qualified Member

**Stand-in**:
A Member who isn't on the app, added by name by anyone in the Group. They take Turns like anyone else, any Member can answer for them, and they can claim their place later through their own invite link.
_Avoid_: Placeholder, guest, offline member

**Job**:
Something the Group needs doing on a repeating schedule, read as a sentence: Greeter, every Sunday, 10:00am. A Job either takes turns or is a Headcount job.
_Avoid_: Responsibility, Event Series, role, duty, task

**Turn**:
One Member doing one Job on one date. Turns rotate fairly through every Member, and nobody gets two in a row when someone else can take it.
_Avoid_: Assignment, shift, slot

**Headcount job**:
A Job with no Turns: before each date every Member is asked "Coming?", and the Group sees how many are coming. It has no Cover.
_Avoid_: Attendance event, RSVP

**Coming?**:
The Yes / No question a Headcount job asks each Member before each date. No answer yet counts as "no reply".
_Avoid_: RSVP, attendance, confirm

**Can't make it**:
A Member saying they can't do one of their Turns. The Group is asked for someone to Cover it.
_Avoid_: Decline, cancel, drop out

**Cover**:
Taking someone's Turn after they can't make it: the first Member to tap "I'll cover" gets it, or the person who can't make it picks who covers. A Cover by a Member is always a Swap.
_Avoid_: Sub, fill in, Coverage Request

**Swap**:
What a Cover costs: the person who couldn't make it takes the coverer's next Turn of that Job, so the coverer gets a break. If that Turn lands on their Dates off, the swap is dropped.
_Avoid_: Make-up Turn, debt, IOU, payback

**Outside cover**:
A Cover by someone who isn't in the Group, recorded by name only. It creates no Swap, since they have no next Turn.
_Avoid_: Guest Cover, external sub

**Needs cover**:
A Turn whose Member can't make it and that nobody has covered yet.
_Avoid_: Open shift, Coverage Request

**Dates off**:
Dates when a Member can't take Turns (mine), or when the whole Group needs nobody (the Group's). Turns route around them: the next person in line takes the date and the absent Member keeps their place.
_Avoid_: Time Off, Skip Date, blackout, unavailability

## Engine words (code only)

These stay in code, types and the database. The UI says the word in brackets.

**Event** (a date):
One dated, timed occurrence of a Job on the Group's schedule.

**Responsibility** (Job):
The engine's record of a Job: its name, kind (turns or headcount) and fill order.

**Event Series** (when a Job happens):
The repeating pattern that creates a Job's Events.

**Assignment** (Turn):
One Member filling one seat of one Responsibility at one Event.

**Rotation** (the turns):
The ordered queue of Members for one Responsibility, which decides who is next (ADR 0005).

**Coverage Request** (Needs cover), **Decline** (Can't make it):
The engine's names for a Turn someone can't make and their saying so.

**Make-up Turn** (Swap):
The record that one Member owes another a Turn after a Cover.

**Guest Cover** (Outside cover), **Placeholder Member** (Stand-in), **Time Off** and **Skip Date** (Dates off: mine and the Group's).

**Admin**:
A Member flag the engine still keeps but nothing in the app uses for now (ADR 0006).

**Hidden settings**:
Qualified Member (everyone does every Job), Rebalance, Primary Responsibility, Coverage Policy (always Pay It Back, shown as a Swap) and Replacement Duty keep their columns and defaults but have no UI.
