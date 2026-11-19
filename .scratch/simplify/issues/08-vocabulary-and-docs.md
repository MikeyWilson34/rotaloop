# 08 Vocabulary sweep, glossary, docs, final e2e

Status: ready-for-agent
Blocked by: 02, 03, 05, 06, 07

- Grep all user-facing strings (screens, notifications, push text, edge-function messages, web metadata) for: Event Series, Responsibility, Qualified, Rebalance, Primary, Replacement Duty, Guest Cover, Coverage Policy, Make-up Turn, Skip Date. Replace with Job, Turn, Member, Cover, Dates off, Stand-in. Internal code names may stay.
- Update GLOSSARY.md (user-facing vocabulary: Group, Member, Stand-in, Job, Turn, Headcount, Cover, Dates off) and product brief pointers; add ADRs for: members-only (admins deferred), stand-ins and outside covers.
- Add a banned-words test over source strings.
- Run the whole suite and `npm run e2e:nav`; fix breakages.

Acceptance: all checks green; list of changed strings reported. Do not commit or push.
