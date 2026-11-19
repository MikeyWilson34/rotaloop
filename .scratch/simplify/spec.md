# Simplify Rotaloop

Status: ready-for-agent (prototype stage)

## Why

Tester feedback (2026-11-18): "I like the idea, but the UI is too complex. Too many steps and not intuitive to set up." The product owner agrees: the goal is something simpler than a group text.

Today an admin goes through ~8 screens and 40+ taps (Welcome → Name → Notifications → Join/create → Create group → setup checklist → Event Series editor → Responsibility editor → Invite) and has to learn Events, Event Series, Responsibilities and Rotations before anything happens. The glossary has ~20 user-facing terms.

## Principles

1. **One main button per screen.** Everything else sits behind a single "⋯" menu or a collapsed "More options".
2. **Defaults over questions.** Never ask something during setup that has a sensible default.
3. **Plain words.** User-facing vocabulary: Group, Member, Admin, Job, Turn, Headcount, Cover, Dates off. No Event Series, Responsibility, Qualified Member, Rebalance, Primary, Replacement Duty, Guest Cover, Coverage Policy, Make-up Turn in the UI.
4. **Hide, don't migrate (for now).** Removed options keep their database columns with the defaults below. A later ticket can delete them.

## Job types

- **Take turns** (default): one person per date, rotating fairly. "People needed" is removed; it's always 1.
- **Headcount**: no rotation. Before each date every member gets "Coming?" Yes / No; the group shows "12 coming · 3 not · 5 no reply". No cover flow.

## New setup: 3 screens

1. **Name your group.** Time zone detected automatically (changeable later in settings).
2. **What needs doing, and when?** One row per job, read as a sentence: `[Greeter] · [every Sunday ▾] · [10:00am]`, with a small `Take turns | Headcount` toggle (defaults to Take turns). "+ Add another job" link. Repeat options: every week / every 2 weeks / monthly (Nth weekday) / one-off date.
3. **Who's in?** Share link / QR, or type names (become placeholder members). "Done" lands on the group page with the schedule already filled.

Onboarding drops the notifications step (push on by default; change in Me). Welcome → Name → Join or create.

## Defaults replacing setup questions

| Old option | New behaviour |
|---|---|
| Qualified members | Everyone does every job |
| Rotation order | Join order, then auto-fair |
| People needed | Removed (always 1; Headcount covers the "many people" case) |
| Needs confirmation | Off: you only hear from people who can't make it |
| Primary responsibility | Removed |
| Event Series vs Responsibility | Merged into one "Job" (name + when + type) |
| Coverage Policy / Replacement Duty / Guest Cover / Make-up Turn | One flow: "Can't make it" → group asked for a volunteer → first to tap "I'll cover" takes it. If nobody does, the admin sees "Needs cover". **A cover is always a swap** (the engine's existing Pay It Back behaviour, now always on and never named): the person who couldn't make it automatically takes the coverer's next turn of that job, so the coverer gets a break instead of serving back-to-back. Shown in plain words: "Sam's covering for you. You'll take Sam's next turn on Dec 6." If the swap turn lands on the original person's dates off, normal rotation picks someone. Count Real Work and Rebalance are hidden. |
| Time Off + Skip Dates | One "Dates off" idea: mine (person) or the whole group's (admin) |

## Rotation rules

1. **Cover = swap** (see table above).
2. **No back-to-back turns when avoidable.** When filling a date, if the next person in line also had the previous date of that job, skip to the next eligible person and give the skipped person the following date instead (they keep their place). Only fall back to back-to-back when nobody else is available (e.g. a 2-person group with one on dates off). This applies to every cause: covers, dates off, people leaving, new jobs.

## Navigation

- Tabs: **Home · Groups · Me** (was 5).
- Home: **only the next 7 days**. The first item is the big card (one button: red "Can't make it", or green Yes / red No for headcounts); the rest of the week is a short list under it. If nothing is due this week, a calm "Nothing this week" note that names your next turn. "Needs you" items appear only when there are any. Underneath: **Your groups**, one tappable card per group (name + your next turn there). Activity becomes a bell icon in the Home header.
- Group page "Coming up" highlights your own turns so you can scan your schedule for that group.
- Button colours: "Can't make it" uses the danger token; headcount Yes uses success, No uses danger (in both light and dark themes).
- Group page: one page that scrolls (no sub-tabs): coming up → members → gear icon for settings. Settings: jobs (tap to edit the same sentence row), dates off, invite link, admins, leave group.
- Me: name, notifications on/off, reminder time, my dates off, sign out.
