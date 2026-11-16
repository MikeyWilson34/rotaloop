# 03 Rotation engine (pure TS, test-first)
Status: resolved
Blocked by: 02

`src/engine/`: pure functions over plain data implementing spec items 1–8: queue fill with headcount, Time Off (both modes), the no-doubling setting, Skip Date add/remove, Decline / Coverage / first-accept, Make-up Turns (create, pay by swap, move along, cancel on policy switch, settle on Rebalance), Rebalance by per-Responsibility workload, Member join (end of queue) and leave (close up), and history entries plus a 'changed assignments' diff for notifications and confirmation reset. Exhaustive scenario tests named in GLOSSARY terms.

## Answer
Pure module in `src/engine/` (no React/Expo/Supabase, no clock reads; 64 scenario tests in `src/engine/tests/`). Public API from `src/engine/index.ts`:
- `createGroupState(group): GroupState`: builds state (Rotations from each Responsibility's `qualifiedMemberIds`), no Assignments yet.
- `applyCommand(state, command, { now, actorId }): CommandResult`: the only way to change anything. Returns `{ ok: true, state, changes: AssignmentChange[], history: HistoryEntry[] }` or `{ ok: false, reason, message }` (`alreadyCovered`, `notQualified`, `notPermitted`, `eventHasPassed`, ...). Because it is pure, it also serves as a preview. Commands: `fillSchedule`, `addEvents`, `addSkipDate`, `removeSkipDate`, `addTimeOff`, `removeTimeOff`, `requestConfirmation`, `confirm`, `decline`, `cover`, `markCovered`, `changeSettings`, `rebalance`, `addMember`, `qualifyMember`, `unqualifyMember`, `removeMember`, `claimPlaceholder`.
- `assignmentStatus(assignment, eventStartsAt, now, alertLeadTimeMs?)`, `isUnconfirmed(...)`, `replacementDutyHolder(assignment, eventStartsAt, settings, now)`.
- `workload(state, responsibilityId, now)`: served / covered / upcoming per Member.
- All data types (`GroupState`, `Assignment`, `MakeUpTurn`, `Command`, ...), plus `DEFAULT_GROUP_SETTINGS` and `DEFAULT_ALERT_LEAD_TIME_MS`.

The data model and the scheduling approach are documented at the top of `src/engine/index.ts`.
