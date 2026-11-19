# 01 Engine: rotation rules (swap wins, no back-to-back, no double booking)

Status: resolved
Blocked by: none

Reference behaviour (approved): `design/prototype/simple.html`, function `jobInstances`/`fillJob`. Spec: `.scratch/simplify/spec.md` → "Rotation rules". Read GLOSSARY.md and docs/adr/0001 first.

Change the engine (`src/engine/schedule.ts`, `rotation.ts`, and related) so that, when filling an Event of a Responsibility (a "Job" in the new UI), rules apply in this order:

1. **Cover is always a swap** (existing Pay It Back / Make-up Turn behaviour, now always on). If C covered B's turn, B owes C's *very next natural turn* of that job: when C would next be picked (front of the queue), B takes it instead, provided B is not on Time Off, not the person who had the previous date, and not already booked that day (rule 3). If B is on Time Off then, the swap lapses and normal rotation stands.
2. **No back-to-back when avoidable.** Otherwise pick the next eligible person in the queue, skipping whoever had the previous date of this job (including via cover/swap). Skipped people keep their place at the front. Only seat back-to-back when nobody else is eligible.
3. **No double booking.** Within a group, jobs are filled in order; a person who already has a turn of another job on the same date is unavailable for the later job. If nobody is free, the turn is unassigned (shows "Needs cover").

Expected sample (3 members Jordan, Sam, Tom; weekly job; Tom covers Sam on week 2): J, T(covering for S), S(swap for T's turn), J, S, T, S, J, T, S, J, T. No person has consecutive dates.

Acceptance:
- Unit tests in `src/engine/tests`: the sample above; swap lapses when the debtor has Time Off; Time Off causing a would-be double; 2-person group where back-to-back is unavoidable; a group with two jobs on the same Sunday (nobody holds both); swap not placed into a double booking.
- Existing engine tests pass (`npm test`), `npm run typecheck` and `npm run lint` clean. Update any test whose expectation legitimately changes and say which and why.
- Record the rules in a new ADR (extends 0001) and update the GLOSSARY "Rotation" entry (UI words: Job, Turn, Cover, Dates off; never Event Series, Responsibility, Make-up Turn in user-facing text).
- Do not touch UI. Do not commit or push; leave changes in the worktree and report.
