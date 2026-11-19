# 09 Headcount jobs (job kind, Yes/No responses, counts)

Status: ready-for-agent
Blocked by: 01, 03

Reference: `design/prototype/simple.html` (`type:'headcount'`, `hcCounts`, `resp`, headcount hero and sheet). Spec: "Job types".

- Add a job kind (`turns` default | `headcount`) to the data model (migration, engine types, `parseRequest`, `groupRows`, database types). The legacy `Responsibility.headcount` field means people-per-turn and stays unrelated.
- Engine: headcount jobs get no rotation/seats; every member is asked "Coming?" before each date. No cover flow for them.
- Store each member's Yes/No per date; group shows "12 coming · 3 not · 5 no reply". Stand-ins' answers can be set by any member.
- UI: green Yes / red No on the Home hero and the details sheet (outlined unselected, filled selected); the setup toggle (ticket 03) must create real headcount jobs instead of take-turns placeholders (remove the placeholder comment).
- Notifications: reminder asks "Coming?" for the next date.

Acceptance: `npm test`, `npm run typecheck`, `npm run lint`, `npm run functions:check`, `npm run e2e:nav`. Do not commit/push or run db:push.
