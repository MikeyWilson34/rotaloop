# 02 App: three tabs (Home · Groups · Me), Activity as a bell

Status: resolved
Blocked by: none

Reference: `design/prototype/simple.html` (tab bar, `lt-head` with bell, Me page, Activity page). Spec: `.scratch/simplify/spec.md` → "Navigation", "Me".

- Reduce the tab bar from 5 to **Home · Groups · Me** (`src/app/(tabs)`). Activity moves to a bell icon (with unread dot) in the Home header that opens the Activity screen as a pushed page with a back button. Time Off moves into Me.
- **Me** screen: name (tap to edit), notifications on/off, reminder time, "My dates off" (list + add/remove, reuse the existing Time Off screens/logic), sign out.
- Keep existing routes working for deep links and notification taps (see ticket 17 learnings: in-app navigation must not blank screens; web loading hardening must stay).
- Use existing design tokens/components in `src/theme` and `src/components/ui`. One primary button per screen.
- No banned words in UI text: Event Series, Responsibility, Qualified, Rebalance, Primary, Replacement Duty, Guest Cover, Coverage Policy, Make-up Turn, Skip Date.

Acceptance: `npm test`, `npm run typecheck`, `npm run lint` pass; `npm run e2e:nav` passes (update it for the new tab set: tap through Home, bell → Activity → back, Groups, Me, dates off). Report screenshots or a short description. Do not commit or push.
