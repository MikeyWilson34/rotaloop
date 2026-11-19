# Volunteer Scheduling App — Master Product & Design Brief

> Source of truth from the product owner (received 2026-11-15). Working name: Rotaloop (not final).
>
> **Simplified 2026-11-18** after tester feedback ("too complex"): see `.scratch/simplify/spec.md`. Where this brief and the simplification differ, the simplification wins. In short: user-facing words are Group, Member, Stand-in, Job, Turn, Headcount, Cover and Dates off (`GLOSSARY.md`); there are no Admins for now, so everyone in a group can manage it ([ADR 0006](adr/0006-members-only.md)); Stand-ins and outside covers are in [ADR 0007](adr/0007-stand-ins-and-outside-covers.md); rotation rules are in [ADR 0005](adr/0005-rotation-rules.md). The admin overview, fairness settings and Rebalance below are deferred.

**Product category:** Group scheduling and shared-responsibility management
**Initial audience:** Church volunteer teams
**Long-term audience:** Any group that shares recurring responsibilities
**Design direction:** Warm, welcoming, modern, and practical

## 1. Product vision
Mobile-first app that removes the confusion of rotating responsibilities. People create groups, invite members, define responsibilities, and the app manages a fair rotation.

Members always know: what they're responsible for next; when it's coming up; whether they need to confirm; whether someone needs help covering.
Admins can manage multiple groups without opening each one.

**Core promise:** Know whose turn it is, know what to do, and handle changes without a group text conversation.

## 2. Product principles
1. Personal-first — show each person their next responsibility immediately.
2. Admin-aware — important updates across managed groups visible at a glance.
3. Fairness — distribute responsibilities fairly over time.
4. Flexible — groups define their own responsibilities and scheduling rules.
5. Collaborative — members can edit schedules; groups can have multiple admins.
6. Predictable — schedule changes are visible, explained, and communicated.
7. Low friction — common actions take seconds.

## 3. Users and groups
- Anyone can create a group; creator becomes first admin; admins can appoint admins.
- Join via shareable invite link or QR code.
- Users can belong to multiple groups; each group has independent members, responsibilities, rules, and history.
- Permissions are per-group.

## 4. Scheduling system
Groups configure: weekly / biweekly / monthly / custom cadence; multiple responsibilities; independent rotation per responsibility; manual overrides; fairness preferences.

Engine considers: total assignments per person; consecutive assignments; time since last assignment; availability & time off; coverage assignments; per-responsibility totals. **Coverage counts toward actual workload.**

## 5. Availability and time off
Members mark single dates, ranges, and recurring periods unavailable, optionally scoped to selected responsibilities.
App: respects availability when generating; detects conflicts with existing assignments; recalculates affected assignments; preserves fairness after time off; notifies affected members; keeps schedule-change history.

## 6. Skip dates / no-assignment dates
Groups mark dates needing no assignments (holidays, church-wide events, closures). When skipped:
- Remove assignments for that date; don't consume anyone's turn; preserve rotation order; shift future assignments forward.
- Notify affected members; record change + reason in history.
- Admins can manually override the result.

## 7. Confirmations and coverage
Reminders at each member's configured notification time. Members can confirm, decline, or volunteer to cover someone else.

Decline flow: open assignment identified → other members notified → a member volunteers → schedule updates → future rotations rebalance for fairness → affected members updated.
If nobody accepts, assignment stays marked "needs coverage".
Support assignments can have independent rotations and don't require confirmation by default.

## 8. Navigation
Primary tabs: **Home**, **Groups**, **Schedule**, **Activity**, **Profile**.
Within a group: Overview, Schedule, Members, Settings.

## 9. Home screen — personal-first, admin-aware
- **A. Your next assignment** (most prominent): group, date, responsibility, confirmation status, confirm/decline action.
- **B. Needs your attention** (only when relevant): coverage requests, pending confirmations, schedule changes, upcoming conflicts, invitations/requests.
- **C. Your groups**: compact cards — name, next date, next lead/primary responsibility, schedule status, outstanding issues.
- **Admin overview** (for administered groups): open coverage requests, pending member confirmations, recent adjustments, upcoming events/skipped dates, membership changes. Filters: All groups / Managed by me / Needs attention. Regular members don't see admin noise.

## 10. Main screens
Home · Groups · Group overview · Schedule (chronological default, optional month calendar) · Assignment details · Availability · Skip dates (create, reason, preview changes, confirm) · Members · Activity · Group settings (frequency, responsibilities, fairness, reminders, permissions).

## 11. Visual design system — "Warm & welcoming"
Palette: warm off-white backgrounds; deep navy for key text & nav; sage green = positive; muted blue = interactive; soft gray = secondary; muted amber = attention/pending.
Rounded cards, subtle shadows/borders, generous spacing, readable type, simple icons, strong hierarchy, large obvious action buttons, consistent status colors. Balanced density. Mobile-first, responsive to tablet & web.

## 12. MVP scope
**Build:** accounts; multiple groups; invitations; multiple admins; configurable responsibilities; automatic rotations; fairness balancing; availability/time off; skip dates; confirm/decline; volunteer coverage; notifications; schedule history; personal dashboard; admin multi-group overview.
**Defer:** group chat; advanced calendar integrations; AI scheduling assistant; complex reporting; payments/rewards.

## 13. Open decisions
Final name/brand; final colors & typography; exact home layout; detailed member/admin permissions; notification channels & defaults; scheduling templates?; complex conflicts & simultaneous coverage claims.

## 14. Design quality goals
New user can: understand without instructions; create a group quickly; invite members; set up a basic rotation; understand next assignment immediately; confirm/decline in seconds.
Admins spot problems across groups without opening each. Easier than a text message.
