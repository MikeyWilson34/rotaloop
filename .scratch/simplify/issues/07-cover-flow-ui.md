# 07 App: one cover flow in plain words

Status: ready-for-agent
Blocked by: 01, 04

Reference: `design/prototype/simple.html` sheets `cant`, `pick`, `cant-self`, `doCover`, `eventText`. Spec: `.scratch/simplify/spec.md` ("Coverage Policy / Replacement Duty / Guest Cover / Make-up Turn" row).

- "Can't make it?" sheet: details line plus two choices: primary **Ask the group for cover**, secondary **I'll find someone to cover**. After "Ask the group" the sheet just closes (no "we've asked the group" confirmation); Home hero shows "Needs cover. We'll tell you when someone takes it."
- "I'll find someone to cover" opens a "Who is covering?" picker: group members (excluding yourself; stand-ins included) plus **Someone else** which asks for a typed name (empty name not accepted). Choosing sets the cover immediately.
- First person to tap "I'll cover" takes a requested cover. If nobody does, every member sees "Needs cover" on the group page (there are no admins for now).
- Swap messages in plain words in the confirmation and Activity: "You're covering Grace's Greeter turn on Nov 29. Grace takes your next turn on Dec 13." / "Sam's covering for you on Nov 29. You'll take Sam's next turn on Dec 13." / for others "Sam is covering Grace's Greeter turn on Nov 29. Grace takes Sam's next turn on Dec 13." Outside covers have no swap sentence. Dates quoted must come from the engine (ticket 01).
- Remove the old coverage-policy, replacement-duty, guest-cover, count-real-work, rebalance options and words from the UI (data stays).
- A member already booked on another job that day cannot be offered "I'll cover" for it (show "You already have another job in <group> that day.").

Acceptance: `npm test`, `npm run typecheck`, `npm run lint`, `npm run e2e:nav` pass; tests for message text; no banned words (Event Series, Responsibility, Qualified, Rebalance, Primary, Replacement Duty, Guest Cover, Coverage Policy, Make-up Turn, Skip Date). Do not commit or push.
