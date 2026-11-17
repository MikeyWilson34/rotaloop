# 16 Coverage follow-ups (engine + UI)
Status: resolved
Blocked by: 10 (engine is being edited there)

Gaps found in ticket 09:
- `withdrawDecline { assignmentId }`: requester only, while the Coverage Request is still open (no Cover yet). Clears the Coverage Request, restores confirmation, writes history. Then show "I can make it after all" (CAN_WITHDRAW_DECLINE in src/components/assignment).
- Decline reason: add an optional reason/note to `decline` and the Coverage Request (engine, migration, groupRows, parseRequest). Then unhide the reason chips (DECLINE_REASON_SAVED) and show the reason on the Cover sheet and in history.
- Ticket 08 moved notice reads "Moved from Wed, Nov 18 to Wed, Nov 18" when only the time changed: show the time in that case.
- Decide: should "I can cover" stay visible after the replacement deadline? (Currently it does; the engine accepts it.)

## Answer
**Engine** (test-first: `src/engine/tests/withdraw-decline.test.ts`, 19 scenarios)
- `withdrawDecline { assignmentId }` ("I can make it after all"):
  - Who: the Member who declined, or an Admin (or the system) for a Placeholder Member. Anyone else, including an Admin for a Member with an account, gets `notPermitted`.
  - When: before the Event starts (`eventHasPassed`) and while no one has covered it (`alreadyCovered`, Member or Guest Cover). The "find a replacement by" deadline doesn't matter, so it works under Replacement Duty.
  - Only a Decline: no request is `noCoverageRequest`; a Time Off request is `invalid` (remove the Time Off instead). No new rejection reason was needed.
  - Effect: clears the Coverage Request (and its reason); the Assignment is unpinned and re-planned, so the Member is back on the same seat and id with a one-Assignment diff. If an Admin reordered the Rotation since, so that the seat would go to someone else, it is refused (`invalid`, "The Rotation changed…") rather than silently moving them.
  - A Make-up Turn the Decline had settled ("moved along") is outstanding again.
  - **Confirmation rule:** it follows the existing Cover rules instead of always going back to "requested". Saying "I can make it" yourself counts as confirming (`confirmed`, like volunteering to Cover; the prototype does the same). An Admin speaking for a Placeholder leaves it `requested` (like Mark covered). It is `notRequired` when the Responsibility needs no confirmation.
- `decline { assignmentId, reason? }`: the reason is trimmed, blank means none, and over 300 characters is `invalid`. It is stored as `CoverageRequest.note` (optional in the type; the engine always writes it). Declining a Cover keeps the original Decline's note. A Time Off request (askVolunteer, or no swap partner) gets the note "Time Off"; the Member's own Time Off note stays private.

**Schema:** `supabase/migrations/20261120000000_decline_reason.sql` adds:
- `assignments.coverage_note` (1-300 characters, only on a Coverage Request);
- a backfill of "Time Off" on open Time Off requests, so the next command doesn't report each one as changed;
- `apply_group_command_result`, replaced again. It keeps every column from 20261119 (skip_date_reason, time_off.time_zone, time_off.note) and adds coverage_note.

The column is mapped in `groupRows.ts`. `parseRequest.ts` parses `decline.reason` (≤300) and `withdrawDecline`. The PGlite round trip covers a decline with a reason and a withdraw.

**App:**
- `CAN_WITHDRAW_DECLINE = true`: the decliner of an open Decline sees "I can make it after all" (secondary, after "Mark covered" once the deadline passes). It sends `withdrawDecline` directly, with no sheet, then shows "You're back on Sound for Sun, Nov 22. The Coverage Request is withdrawn."
- `DECLINE_REASON_SAVED = true`: the Decline sheet's chips and note are sent as "Traveling: back on the 10th" (`declineReasonText`). The reason is shown quoted on the Cover sheet and the coverage panel.
- History (`src/schedule/history.ts`, additive):
  - Decline: `Ana can't make Sound on Sun, Nov 22: “Traveling”. Coverage requested.`;
  - the Assignment timeline: `Ana can't make it: “Traveling”. Needs coverage`;
  - withdraw: `Ana can make Sound on Sun, Nov 22 after all; Coverage Request withdrawn.` (or "Ana said Pat can make…" for a Placeholder).
- Error messages for `withdrawDecline` and a too-long reason are in `groupErrors.ts` (additive).
- Moved notice: when only the time changed on the same day, it reads "Moved from 9:00 AM to 10:30 AM on Sun, Nov 22".
- "I can cover" after the deadline is **kept on purpose**: the deadline only decides who must find someone. There is a comment in `coverage/actions.ts` and a pinning test.
- Not built: an Admin-side "They can make it after all" button for a Placeholder's Decline. The engine allows it; the app has no button yet.

**Found:** `.gitignore` had `coverage/`, which also ignored `src/coverage/`, so ticket 09's module was never committed. It is now anchored as `/coverage/`, and `src/coverage/` shows as untracked: include it in the next commit.

**Tests:** 509 pass (555 later, with ticket 12's new tests in the tree). Typecheck and `functions:check` pass. Lint is clean in this ticket's files; at the time of the run it failed only in ticket 12's in-progress `src/home/data.ts` and `src/activity/data.ts`.

**Deploy and live:**
- The dry run showed only this migration pending; it was pushed. `db:types` added only `coverage_note`. `group-command` was redeployed.
- `node --env-file=.env --import tsx scripts/smoke-coverage-followups.mjs [session-file]`: 31/31 ok ("Smoke Test 16 …"). It covers:
  - the reason "Traveling", stored and readable by another Member and in the history cause;
  - Cara's withdraw refused; Ben's withdraw puts him back, confirmed, with a one-Assignment history diff;
  - decline again, Cara covers, and Ben's withdraw is `alreadyCovered`;
  - askVolunteer Time Off stores "Time Off";
  - a 301-character reason is refused.
- Headless Edge screenshots (390px, light and dark) from a local export, not deployed: the decliner with "I can make it after all", and the Cover sheet with the reason.
