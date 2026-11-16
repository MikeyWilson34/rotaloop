# Domain grilling — decisions so far

Running log of rules settled with the product owner (2026-11-15). Terms live in `GLOSSARY.md`; this file holds the behavioral rules that will feed the spec.

## Settled
- Unit scheduled is an **Event** (date + time; several per day allowed).
- Responsibilities have a headcount; an Assignment = one Member, one seat, one Responsibility, one Event.
- Each Responsibility has explicit **Qualified Members**; only they are rotated or can Cover.
- Rotation = ordered queue per Responsibility, plus an Admin **Rebalance** that reorders by workload (hybrid).
- One Member can't hold two Assignments at the same Event by default; a Group setting can allow it.
- **No firm/published window.** Nothing is locked; the schedule can always change.
- **Skip Date**: no turn is used up; everyone from that Event onward moves forward one Event.
- **Time Off** routes around: the next in line takes the Event, and the absent Member keeps the front place. If that person declines, it becomes a normal Coverage Request.
- An Assignment whose date changes resets to "needs confirmation", and the Member is told what moved and why.
- Coverage: only Qualified Members can Cover; the first tap wins; no Admin approval.
- Confirmation is required or not per Responsibility. Each Admin sets an alert lead time (default 3 days before the Event) for anything still Unconfirmed or Needs coverage. A Coverage Request notifies Qualified Members immediately and reminds them once more at that time. Nothing is declined automatically.
- One **Primary Responsibility** per Group, shown on group cards.
- A Group has one or more **Event Series** plus one-off Events; each series picks its Responsibilities.
- Admin is a permission. An Admin can also be a Qualified Member.
- **Coverage Policy** is per Group: Count Real Work or Pay It Back. New Groups start on Pay It Back.
- Under Pay It Back, the Member who declined pays the Make-up Turn by taking the coverer's next turn in that Responsibility.
- Declining a Make-up Turn moves the debt along: the original debt is settled, and the decliner now owes whoever covers. Each Decline creates at most one Make-up Turn.
- Switching to Count Real Work cancels outstanding Make-up Turns, recorded in history. Switching to Pay It Back starts with no debts.

- MVP Group settings: Coverage Policy; Time Off handling (route around, the default, or ask for a volunteer); allowing the same person twice at one Event (off by default); confirmation required per Responsibility. Fixed for now: a Make-up Turn is paid by swapping with the coverer.
- Rebalance settles outstanding Make-up Turns for that Responsibility, recorded in history.
- ADRs 0001–0003 written (hybrid rotation, nothing is ever firm, Expo + Supabase).
- Home: merge "Admin overview" into one "Your groups" list. Managed groups' cards show health stats, with All / Managed by me / Needs attention filters.
- Regular Members see no group-level health: only their own Assignments and Coverage Requests they're Qualified for.
- Notifications: push is on by default. On first launch, every user goes through a notification setup step; email and SMS appear there as opt-ins. Delivering email and SMS can come in a later build phase (interpretation; confirm with owner).

- Skip Dates can be added by Members as well as Admins, so a Skip Date isn't missed when an Admin forgets (guardrails: Q38).
- Invite links join directly, with no approval in MVP. Admins can remove Members and reset the link.
- A newly Qualified Member joins the end of the Rotation queue.
- When a Member leaves or is removed, the Rotation closes up for their future Assignments, routing around them like Time Off, and the affected Members are notified. Their history stays, marked as a former Member, and their Make-up Turns are cancelled.
- Every Member can see the full Group schedule history.
- To claim a Placeholder, an Admin sends that person a personal invite link, and joining with it inherits the Placeholder's Assignments and history. A plain Group link creates a new Member.

- **Replacement Duty** is a Group setting: Assigned Member (the default) or Admins. If a Coverage Request has no taker by the alert time, it falls to that person, and Admins are informed either way.
- The assigned Member can mark an Assignment covered by (a) a Group Member, which is a normal Cover: notified, asked to confirm, counted toward workload, and a Make-up Turn under Pay It Back; or (b) a **Guest Cover**, recorded by name only, which counts toward no one's workload and creates no Make-up Turn.
- They may pick a Group Member who isn't Qualified for that Responsibility. There's no warning; it is visible in history.
- Skip Dates by Members: the same before/after preview as the Admin flow, and no Admin notification. Any Admin or Group Member can remove a Skip Date, which restores the Rotation.

- Replacement Duty is triggered by a **Group setting, "Find a replacement by"** (default 3 days before the Event). Each Admin's personal alert lead time only controls when that Admin is notified.
- The workload view (served, upcoming and covering per person) is visible to all Members; it is treated as history, not group health.

- **MVP sign-in uses guest accounts with no email** (Supabase anonymous sign-in plus a display name), owner decision 2026-11-16. The reason: the free Supabase tier blocks custom email templates without custom SMTP. Trade-off: the account is tied to one device or browser. Before launch, add "Save your account" (link email or Apple/Google to the same account), and custom SMTP if email is used.

## Future direction (not MVP, but design must not block it)
- The audience goes beyond church teams: friends rotating who hosts or who's in charge of what, and pickup-sports groups.
- The current model already handles **rotation-style** uses, e.g. friends rotating a "Host" Responsibility.
- Later: **attendance-style** Events (e.g. pickup basketball). Everyone in the Group answers whether they're coming (in, out, or no response yet), and the Event shows a live count plus who hasn't answered. This is customizable per type of Event.
- Implications now:
  - Keep church-specific wording out of the core UI and copy; church words belong only in example data and templates.
  - Model Event participation so that an attendance response per Member can be added later without restructuring. The term for it is not settled yet; "RSVP" and "Attendance" are candidates.

## Open
- None. Awaiting the owner's confirmation of shared understanding.

## Distribution
- Early sharing happens through a hosted website (the Expo web build on EAS Hosting), not app-store builds (owner, 2026-11-16). Invite links are https URLs so they open in any browser. Native store builds come later.
