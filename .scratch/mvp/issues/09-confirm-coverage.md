# 09 Confirm, Decline, Coverage, Replacement Duty
Status: resolved
Blocked by: 08

Confirm / Decline flows, Coverage Requests with race-safe first accept, Replacement Duty fallback, Mark covered (Member or Guest), Make-up Turns, Admin Rebalance, Realtime updates.

## Answer
The Assignment screen's actions are built; the engine, migrations and Edge Function are unchanged (the server already made first-accept race-safe with its retry loop).

**Pure logic** (`src/coverage/`, engine imports only, not synced to Deno)
- `actions.ts`: `assignmentActions({ assignment, eventStartsAt, requiresConfirmation, qualified, me, isAdmin, settings, now })` returns the viewer's state, the buttons in order, who holds Replacement Duty and whether the viewer does:
  - mine and Pending (or Unconfirmed): Confirm / Can't make it;
  - mine and Confirmed: "I can't make it after all" (`decline`);
  - mine and Scheduled: "Confirm early" (only when the Responsibility needs confirmation) and Can't make it;
  - covering someone: "I can't make it after all" (`decline` withdraws the Cover and reopens the request); covering and asked to confirm: Confirm / Can't make it;
  - an open Coverage Request I'm Qualified for and didn't ask for: "I can cover" (still shown after the deadline: a volunteer is still welcome);
  - Replacement Duty is mine (`replacementDutyHolder` says `assignedMember` and I declined, or `admins` and I'm an Admin): "Mark covered" (primary); any Admin on any open request: "Mark covered" (secondary);
  - I declined it: no button. **Gap:** the engine has no withdraw command (`confirm` on a Coverage Request is `alreadyNeedsCoverage`, `markCovered` refuses the requester), so "I can make it after all" is hidden (`CAN_WITHDRAW_DECLINE = false`);
  - nothing once the Event has started, or on someone else's Assignment or a Guest Cover.
- `sheets.ts`: `declineSheetView` (who we'll ask: active Qualified Members with an account, except me; the deadline line per Replacement Duty, or that it has passed; the Pay It Back explainer; "This is a Make-up Turn…"; a withdraw-my-Cover variant), `coverSheetView` (Event, "Covering counts toward your workload", and the Make-up Turn date from an **engine preview**: `applyCommand(cover)` on the loaded state without saving, then the new Make-up Turn's paying Assignment; Count Real Work note; the preview's rejection, e.g. `alreadyAssignedAtEvent`, disables the button), `markCoveredSheetView` (every active Member except the decliner; anyone already at that Event disabled unless doubling allows it, same rule as the engine's seat check; Qualified first; no qualification warning; Guest Cover note), `coveragePanelView` (the prototype's coverage card: who can't make it, who was asked, who is finding a replacement), `successMessage`, `coveredByName`.
- `src/schedule/views.ts`: new display status **`findReplacement`** ("Find a replacement", red): `slotStatus(…, settings)` returns it for a Coverage Request once `replacementDutyHolder` is non-null; `slotView` passes the Group's settings, so it shows everywhere (pills, dots, the Assignment screen). Added to `StatusPill` and `statusDotColor`.
- `src/lib/groupErrors.ts`: new actions `confirm`, `decline`, `cover`, `markCovered` with specific messages (additive override map).

**UI** (`src/components/assignment/`): `AssignmentActions` (replaces `AssignmentActionsSlot`), `CoverageSheets` (Decline, Cover, Mark covered), `useAssignmentCommand` (disables every button while sending, reloads on success; on `alreadyCovered` it re-fetches and says "Already covered by Cal."), `parts`. Success shows an inline confirmation ("Confirmed Sound for Sun, Nov 22. Thank you!"); Realtime on `groups` plus the reload brings the final state. `/assignment/[groupId]/[assignmentId]?action=decline|cover|markCovered` opens that sheet on arrival (when the action is offered), for ticket 12's Home and notifications.

**Gaps (backend, reported, not built)**
- No withdraw of a Decline (above). A small `withdrawDecline { assignmentId }` engine command (requester only, request still open: clear `coverageRequest`, restore confirmation) would do it.
- No Decline reason: `decline` carries only the Assignment id and `parseRequest` drops anything else, so the reason chips and note are built but hidden (`DECLINE_REASON_SAVED = false`), and the Cover sheet shows no reason. Needs a `coverage_reason_text`/note field on the Coverage Request (engine type, schema, parser).

**Not built:** inline Confirm / Can't make it on the Schedule tab's "Just me" cards. It is cheap (Confirm sends `confirm`; Can't make it opens `?action=decline`) but the Schedule tab is being edited by ticket 10, so it is left for ticket 12 alongside the Home hero.

**Rebalance** (ticket 07's Responsibility editor) is unchanged; the live script runs it.

**Tests:** `src/coverage/tests/actions.test.ts` (the action matrix), `sheets.test.ts` (who we'll ask, deadline lines, Make-up Turn preview, mark-covered options, coverage panel, messages), Find-a-replacement cases in `src/schedule/tests/views.test.ts`, messages in `src/lib/tests/groupErrors.test.ts`.

**Live:** `node --env-file=.env --import tsx scripts/smoke-coverage.mjs [session-file]`: four guests, "Smoke Test 09 …". B confirms; B declines; A and C cover via `Promise.all` (A ok, C `alreadyCovered`); B owes A a Make-up Turn placed on A's next turn; D declines a one-off Event two days out (past the 3-day deadline, so `replacementDutyHolder` is `assignedMember`), C's `markCovered` is `notPermitted`, D records a Guest Cover (no Make-up Turn); B's `confirm` on an open request is `alreadyNeedsCoverage` (no withdraw); Rebalance ok in a side Group. All steps ok. Headless Edge screenshots (390px, light/dark) of each state from a local export (not deployed).
