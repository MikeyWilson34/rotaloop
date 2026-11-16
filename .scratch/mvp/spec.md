# Rotaloop MVP: Spec

Status: approved domain model (2026-11-15). Read these before any ticket:
- `docs/product-brief.md`: product vision, screens, MVP scope.
- `GLOSSARY.md`: **use these terms exactly**, in code (type names, tables, functions) and in copy.
- `.scratch/domain-grilling/decisions.md`: every behavioral rule. It is authoritative where it differs from the brief.
- `docs/adr/`: the rotation model, "nothing is ever firm", and the stack.
- `design/design-system.md` and `design/prototype/index.html`: visual tokens and reference screens.

## Stack
- Expo (React Native + TypeScript, expo-router), targeting iOS, Android and web.
- Supabase: Postgres, Auth, RLS, Realtime, Edge Functions, and pg_cron for reminders.
- The rotation logic lives in a **pure TypeScript domain module** (`src/engine/`) with no React or Supabase imports, and is fully unit-tested. The app and the Edge Functions both call it.
- No Docker on the dev machine. Supabase work targets a hosted project (the owner will create one); migrations live as SQL in `supabase/migrations/`.

## Cross-cutting rules
- The app name lives in one constant or config only ("Rotaloop" is provisional).
- Generic wording in the core UI; church words appear only in sample data and templates. A future **attendance-style Event** (who's coming, a live count, no reply yet) must be addable without restructuring Event participation.
- Every automatic schedule change writes a **schedule history** entry: what changed, why, and who or what caused it. Every Member can read their Group's history.
- When an Assignment's date or Member changes, it resets to needing confirmation (if its Responsibility requires confirmation), and the affected Members are notified.

## Domain behavior (summary; full rules in decisions.md)
1. **Rotation**: an ordered queue per Responsibility of Qualified Members. Each Event fills `headcount` seats from the queue front, skipping anyone on Time Off or already holding another seat at that Event (unless the Group allows doubling). Passed-over Members keep their front position. New Qualified Members join the end.
2. **Skip Date**: the Event gets no Assignments, and every Rotation moves forward one Event from there on. Anyone in the Group can add one (after a before/after preview) or remove one (which restores the Rotation).
3. **Time Off**: setting `routeAround` (the default) means the next in line takes the Event and the absent Member keeps the front place; setting `askVolunteer` creates a Coverage Request instead.
4. **Decline**: creates a Coverage Request. Qualified Members are notified, and the first accept wins (it must be race-safe on the server). One follow-up reminder goes out at the alert lead time.
5. **Replacement Duty** (`assignedMember`, the default, or `admins`): if there's no taker by the alert time, that party must arrange cover. They can pick any Group Member (a normal Cover, no qualification check) or record a **Guest Cover** by name. Admins are informed either way.
6. **Coverage Policy** (`payItBack`, the default, or `countRealWork`): under Pay It Back, the decliner owes the coverer a **Make-up Turn**, paid by taking the coverer's next turn in that Responsibility. Declining a Make-up Turn moves the debt to the new coverer. A Guest Cover creates no debt. Switching to Count Real Work cancels outstanding debts. Rebalance settles them.
7. **Rebalance** (Admin): reorders a Responsibility's queue by workload (served plus covered, per Responsibility), ascending.
8. **Member leaves**: the Rotation closes up for their future Assignments, their history is kept, and their debts are cancelled.
9. **Confirmation**: required or not per Responsibility. Each Admin sets an alert lead time (default 3 days) for anything Unconfirmed or Needs coverage. Nothing is declined automatically.
10. **Permissions**: Members act on their own Assignments, Time Off, Covers, Skip Dates, and arranged replacements when they hold Replacement Duty. Admins can do everything in the Group. Group health stats are Admin-only.
11. **Joining**: an invite link or QR code joins directly; Admins can reset the link and remove Members. A **Placeholder Member** is claimed through a personal invite link and inherits their Assignments and history.
12. **Notifications**: push is on by default. The first-launch onboarding includes notification setup with email and SMS opt-ins; actually delivering email and SMS is post-MVP.

## Home (personal-first, admin-aware)
1. Next assignment hero (Confirm / Can't make it).
2. Needs your attention (only when there's something).
3. One **"Your groups"** list. Managed groups' cards show health stats; filters: All / Managed by me / Needs attention.

Members never see group health.

## Out of scope
Group chat, calendar sync, the AI assistant, reporting, payments, delivering email and SMS, attendance-style Events, join approval, and configurable Make-up Turn payment.
