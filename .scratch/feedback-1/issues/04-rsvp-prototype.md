# 04 Prototype: RSVP events and duty emphasis
Status: ready-for-human

Add to `design/prototype/index.html` (follow `design/design-system.md`) the flows from spec items 3 and 5:
- Create a one-off event (any Member): title, date/time, location, notes, optional Responsibilities, reminder time (default 1 day before), optional RSVP deadline.
- Event page: Going / Can't buttons, live headcount with who's going / not answered, deadline state, the optional duties.
- How an RSVP invite and a duty Assignment look on Home and Schedule side by side: duty clearly stronger (brighter/filled), RSVP quieter.
- Use "Team" wording, not "Qualified Members".
Then owner sign-off (set `ready-for-human` when done).

## Answer

Prototype v0.4 is in `design/prototype/index.html`. Open it straight from disk in a browser. The "Viewing as" (Member / Admin) and Light / Dark controls on the left work on every new screen.

### Owner review, round 2 (v0.4)
The owner reviewed v0.3. These changes are in:

1. **Answer once (confirmed).** If you hold a duty at an Event, Confirm also counts as Going and Can't make it counts as Can't. The UI now says so:
   - Home duty card (Friendsgiving, Bring food): "Confirming also marks you as going." under Confirm / Can't make it.
   - Event page duty block: "Confirming also marks you as going. Can't make it marks you as can't." Once confirmed: "You're counted as going. No separate RSVP needed."
   - The toasts repeat it ("You're also marked as going", "You're marked as can't").
   - On an Event with RSVP off, the note doesn't appear, because there's nothing to RSVP to.
2. **Collapsible Home sections.** "Events coming up" and "Needs your attention" now work the same way as "Needs your attention" in the real app:
   - Tap the heading to toggle. The heading has a chevron (down when open, pointing right when collapsed) and `aria-expanded`.
   - The count badge stays visible when collapsed. Events use a quiet neutral badge and Attention keeps its amber one. "N to answer" stays on the right of the Events heading.
   - When a section is collapsed, a line says "5 events hidden. Tap the heading to show them." or "4 items hidden. Tap the heading to show them." (singular: "...show it."). An empty collapsed Attention section says "You're all caught up."
   - Each section remembers its state on this device in `localStorage`, under `rotaloop.home.eventsCollapsed` and `rotaloop.home.attentionCollapsed` (value "collapsed" or "expanded", wrapped in try/catch, falling back to expanded).
3. **RSVP is opt-in, and so is the deadline (confirmed).** In the New / Edit Event form, under Reminder:
   - **Ask who's coming** is a switch, on by default. Off means no Going / Can't, no headcount and no RSVP nudges. The Event shows its details and any Responsibilities. With it off, the button reads **Create Event** instead of "Create and invite", the bottom note says "Nobody is asked to answer", and the reminder hint says it reminds everyone in the group.
   - **Set an RSVP deadline** is a switch, off by default, shown only while Ask who's coming is on. The deadline chips (1 day / 2 days / 1 week before, plus "Keep …" when editing) appear only when it's on.
   - Events without a deadline show no deadline state anywhere: no "RSVPs open" note on the Event page and no badge on the cards.
   - **No-RSVP cards.** On Home, a no-RSVP Event is a quiet outlined card with a calendar icon, an "EVENT" label, and the group, time and location. It has no answer buttons. On Schedule and in a group's lists it's a hollow-date row labelled "Event" with no answer pill. On the Event page the header pill says "Event", a note says "No RSVPs for this Event…", and Who's coming is hidden. **Send reminder now** goes to everyone in the group, and the Manage note says "No RSVP nudges."
4. **After the deadline, only the creator and Admins can change answers (confirmed).**
   - Members see disabled Going / Can't buttons and "Only Grace and the group's Admins can change answers now, so if your plans change, tell Grace."
   - The creator or an Admin can still change their own answer. In Who's coming they get a **Mark going** / **Mark can't** button next to each name, so they can change other people's answers too. People with a duty are left out, because their answer follows the duty. A note under the rows explains this. Each change is logged in Activity.

Still open: "a Responsibility created in the Event form starts with the whole group as its team" is still being discussed, so that behaviour is unchanged.

**Sample data (v0.4).** A friend group called **Game Night Crew** (13 Members, no Event Series, only one-off Events). Its Responsibilities are Host, Bring food, Bring drinks and Bring games, each with its own team. It has three Events:
- **Game Night** (Fri, Nov 20): RSVP on, created by Sam, deadline tonight at 9:00 PM ("close in N hours"). Jordan hasn't answered yet: 7 going · 2 can't · 4 haven't answered.
- **Escape room** (Sat, Nov 28): created by Jordan, so you see the creator view. RSVPs are closed, and you can use Mark going / Mark can't.
- **Friendsgiving potluck** (Sat, Dec 5): RSVP on, **no deadline**, with Responsibilities. Jordan is on **Bring food** ×2 with Ana.

Sunday Worship Team has two:
- **Carols in the park** (Sun, Dec 13): **RSVP off**. Created by Grace, with Vocals ×2 and Acoustic ×1 duties. As Admin you see Manage. As Member you see the plain view.
- **Christmas volunteer dinner** (Fri, Dec 18): created by Grace. RSVPs **closed Nov 17** (numbers went to the caterer). As **Admin** you can still change answers. As **Member** you're locked out.

The rest of this Answer describes v0.3 and is still accurate, except where the round-2 notes above say otherwise.

### New screens and how to reach them
1. **New Event form**. There are three ways in:
   - Home: tap the **+** next to your avatar. You pick the group first.
   - Schedule: tap the **+** at the top right, next to the Time Off icon. You pick the group first.
   - Group screen (Groups → any group): tap **Create an Event** on the Overview tab or the Schedule tab. The group is already chosen.

   The form has: title, date and time, location, notes, and optional Responsibilities. Add a Responsibility from the group's list or type a new one. Use the ×N stepper to set how many people. Each Responsibility shows "From the Bring food team · 6 people · Next up: …". You also set the reminder (default "1 day before"), the **Ask who's coming** switch (on by default) and, while that's on, the **Set an RSVP deadline** switch (off by default; 1 day / 2 days / 1 week before, with the closing time worked out). **Create and invite** (or **Create Event** with RSVP off) opens the new Event page in the creator view.
2. **Event page**. Tap any Event card on Home, Schedule (list or a day in Month view), a group's Overview or Schedule tab, or an Event entry in Activity. It shows:
   - **Going** and **Can't** buttons. There's no Maybe and no +1s. They're hidden on Events with RSVP off.
   - The deadline state, only if a deadline was set: open until a date, "close in 13 hours", or closed (with a lock).
   - Location, notes and who created it.
   - **Who's coming** (RSVP on only): a live headcount line ("7 going · 2 can't · 4 haven't answered") with a bar, and three rows you can expand to see names.
   - **Responsibilities**: each one shows its team, filled count and who's assigned with their status. If you're on the team, you get "I'll take it" on an open spot.

   If you have a duty on the Event, the RSVP buttons are replaced by a filled "You're on Bring food" block with Confirm and Can't make it. Confirming counts as Going. Can't make it counts as Can't, frees the spot and asks the rest of that team.
3. **Event page, Member view.** Use Game Night, or Carols / the Christmas dinner while viewing as Member. Instead of manage actions you see a reminder note, plus "Only Sam and the group's Admins can change this Event". The Christmas dinner shows the locked, after-deadline state.
4. **Event page, creator or Admin view.**
   - Creator: Escape room. Jordan created it, so this works in either persona.
   - Admin: Christmas volunteer dinner (RSVPs closed, Mark going / Mark can't) or Carols in the park (RSVP off), while viewing as **Admin**. It notes that you can edit any Event because you're an Admin.

   The **Manage** section shows the reminder setting and three actions: **Send reminder now** (reminds the people going and nudges anyone who hasn't answered), **Edit Event** (opens the same form, filled in) and **Remove Event** (asks you to confirm first).
5. **Home: "Events coming up"**, right under the Next-up hero, collapsible (tap the heading). Duties and invites sit side by side in date order: Game Night invite, Escape room invite, the Bring food duty, Carols in the park (plain Event card), then the Christmas dinner invite. You can answer an invite straight from the card with Going or Can't. Duty cards have Confirm and Can't make it.
6. **Schedule**: Events are mixed into the List view in "Just me" and "Everyone" scopes. In Month view, days where you have a duty are solid, invites are hollow dots, and the legend explains both.
7. **Activity**: there's a new **Events** filter, and tapping an Event entry opens its Event page.

### Duty vs RSVP emphasis
- **Duty** (an Assignment, "You're on Bring food"):
  - On Home it's a **filled** card in the new `--duty` token (#3A6894 light, #86AEDB dark) with a shadow.
  - The title is 800 weight, with a clipboard-check icon and a "YOUR DUTY" label.
  - Confirm is the inverted button. Can't make it uses `--duty-raise`.
  - On Schedule, every Assignment (rotation turns too) gets a solid `--duty` date box, a 4px `--duty` left bar, 800 weight and a "Your duty" label.
- **Invite** (RSVP only, "Game Night, Fri. Are you coming?"):
  - **Outlined** with a 1.5px `--rsvp-line` border (#948A7D light, #5D6B80 dark).
  - Transparent background, no shadow, 700 weight.
  - Mail icon in an outlined tile, "INVITE" label, and a hollow date box on Schedule.
  - The answer shows as a pill: Going (sage), Can't go or Not answered (neutral).
- **Not colour alone:** duty and invite also differ in fill vs outline, shadow vs none, weight, icon, label text and wording.
- **Contrast (WCAG):**

  | Pair | Light | Dark |
  |---|---|---|
  | Text on the duty fill | 5.85:1 | 7.57:1 |
  | Secondary text on the duty fill | 4.67:1 | 5.95:1 |
  | Pill on `--duty-raise` | 7.7:1 | 9.9:1 |
  | Invite outline on the background | 3.17:1 | 3.35:1 (meets 3:1 for UI) |

- The design system doesn't define these tokens yet. They should be added to `design/design-system.md` after sign-off, along with the new moss accent for Game Night Crew (#5F7A2E / #EAF0DC light, #B5CF83 / #26301A dark).

### "Team" wording
All copy that said "Qualified" now uses the Responsibility's team, for example:
- "Asked the Greeter team (6 people). Only the Greeter team can cover…"
- "the rest of the Keys team"
- "Sound team · 3 people" in Settings
- "Teams: Sound · Slides" in Members
- "When someone on one of my teams needs cover"

### Owner decisions
Confirmed:
- If you have a duty on an Event, confirming it counts as Going, and Can't make it counts as Can't. You answer one question, not two.
- RSVP is opt-in per Event ("Ask who's coming", on by default). The RSVP deadline is opt-in too ("Set an RSVP deadline", off by default). A deadline only exists when it was turned on.
- After the RSVP deadline, only the creator and the group's Admins can change answers (their own and other people's). Everyone else can't.

Still to confirm:
- Invites sit in their own "Events coming up" section, not in "Needs your attention". That keeps them quieter than duties and coverage problems. The section is now collapsible.
- A new Responsibility made in the Event form starts with the whole group as its team. This is still being discussed, so the behaviour is unchanged.
- In the prototype, a duty holder can still drop their duty after the RSVP deadline (Can't make it starts the cover flow and marks them as can't). Duties follow the coverage rules, not the RSVP lock. Is that right?
