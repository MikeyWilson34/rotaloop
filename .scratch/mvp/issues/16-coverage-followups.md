# 16 Coverage follow-ups (engine + UI)
Status: blocked
Blocked by: 10 (engine is being edited there)

Gaps found in ticket 09:
- `withdrawDecline { assignmentId }`: requester only, while the Coverage Request is still open (no Cover yet). Clears the Coverage Request, restores confirmation, writes history. Then show "I can make it after all" (CAN_WITHDRAW_DECLINE in src/components/assignment).
- Decline reason: add an optional reason/note to `decline` and the Coverage Request (engine, migration, groupRows, parseRequest). Then unhide the reason chips (DECLINE_REASON_SAVED) and show the reason on the Cover sheet and in history.
- Ticket 08 moved notice reads "Moved from Wed, Nov 18 to Wed, Nov 18" when only the time changed: show the time in that case.
- Decide: should "I can cover" stay visible after the replacement deadline? (Currently it does; the engine accepts it.)
