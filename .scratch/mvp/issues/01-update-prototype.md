# 01 Update prototype to the approved domain model
Status: resolved
Blocked by: none

Update `design/prototype/index.html` (and `design/design-system.md` if tokens change) to match spec.md and decisions.md:
- Home: merge Admin overview into one 'Your groups' list; managed cards show health stats; keep the All / Managed by me / Needs attention filters.
- Rotation: queue semantics. Time Off routes around (swap with the next in line). Skip Date shifts forward (already done).
- Coverage: Replacement Duty fallback state ('Nobody's free, find a replacement'), a 'Mark covered' flow (pick a Group Member or enter a Guest name), and Make-up Turn display under Pay It Back.
- Any Member can add and remove Skip Dates (same 3-step preview).
- Group Settings: Coverage Policy, Replacement Duty, Time Off handling, allow doubling, per-Responsibility confirmation, Admin alert lead time. Remove the 'members can edit schedule' and 'swap' toggles.
- Schedule history visible to all Members.
- First-launch onboarding with a notification setup step (push default; email/SMS opt-ins).
- Generic copy (no church wording outside sample data).
