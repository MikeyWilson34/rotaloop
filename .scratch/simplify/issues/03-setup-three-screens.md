# 03 App: 3-screen group setup and shorter onboarding

Status: ready-for-agent
Blocked by: none

Reference: `design/prototype/simple.html` (flows `create`, `onb`, `jobRow`, repeat/time sheets). Spec: `.scratch/simplify/spec.md` → "New setup" and "Defaults replacing setup questions".

- Create group in 3 screens: (1) name your group (time zone detected, changeable later), (2) "What needs doing, and when?": one sentence row per job `[name] · [every Sunday ▾] · [10:00am]` with a `Take turns | Headcount` toggle (default Take turns), "+ Add another job", repeat options every week / every 2 weeks / monthly (Nth weekday) / one-off, (3) "Who's in?": share link / QR, or type names (become **stand-ins**, see ticket 05; if ticket 05 is not merged yet, create them with the existing placeholder-member mechanism). Done lands on the group page with the schedule filled in.
- Defaults replace old questions: everyone does every job, join-order rotation, one person per turn, no confirmation step. The existing DB columns stay; write the defaults.
- A job is one thing (name + when + type); do not expose Event Series vs Responsibility.
- Onboarding drops the notifications step: Welcome → Name → Join or create (push on by default; changeable in Me).
- Reuse existing setup commands (`supabase/functions/group-command`, `src/db`) where possible; add what's missing.

Acceptance: `npm test`, `npm run typecheck`, `npm run lint` pass; a test or script walks create-group end to end; `npm run e2e:nav` still passes; no banned words (Event Series, Responsibility, Qualified, Rebalance, Primary, Replacement Duty, Guest Cover, Coverage Policy, Make-up Turn, Skip Date) in UI text. Do not commit or push.
