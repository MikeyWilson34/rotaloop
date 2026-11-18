/**
 * The rotation engine: the pure TypeScript domain module for Rotaloop.
 *
 * Rules for this folder: no React, React Native, Expo or Supabase imports, no I/O,
 * no clock reads (the caller passes `now`). Terms follow GLOSSARY.md.
 *
 * ## Public API
 *
 * - `createGroupState(group)` builds a Group's state (no Assignments yet).
 * - `applyCommand(state, command, { now, actorId })` is the single way to change
 *   anything. It returns `{ ok: true, state, changes, history }` or
 *   `{ ok: false, reason, message }` (e.g. `alreadyCovered`, `notQualified`).
 *   It is pure, so it doubles as a preview (e.g. the Skip Date before/after view).
 *   It also enforces who may do what (`notPermitted`), so callers only resolve the
 *   acting Member: `actorId: null` is the system and may do anything; any other actor
 *   must be an active Member (or be joining, adding themselves as a plain Member).
 *   Admins may do everything. Members may manage their own Time Off, name and
 *   membership (leave), add and remove Skip Dates, confirm and Decline their own
 *   Assignments (with an optional reason) and withdraw an open Decline, Cover, and mark covered when they hold Replacement Duty. The last
 *   active Admin can't step down, leave or be removed (`lastAdmin`).
 * - `assignmentStatus`, `isUnconfirmed`, `replacementDutyHolder` are status helpers.
 * - `workload(state, responsibilityId, now)` gives served / covered / upcoming counts.
 *
 * ## Data model (`GroupState`, all plain JSON)
 *
 * - `settings`: Coverage Policy, Time Off handling, doubling, Replacement Duty and
 *   its "find a replacement by" deadline.
 * - `members`: Members, Admins (`isAdmin`), Placeholder Members (`accountId: null`)
 *   and former Members (`leftAt`). Members are never deleted.
 * - `responsibilities`: headcount and whether confirmation is required. Their order
 *   is the fill order at each Event. A removed Responsibility stays (`removedAt`) for
 *   past Events' history; no Event needs it after that.
 * - `rotations`: per Responsibility, the queue of Qualified Members (being in the
 *   queue is what being Qualified means) plus `turnsTakenEarly`. The queue is the
 *   state as of `rotatedThrough`, i.e. after every Event that has started.
 * - `eventSeries` / `events`: an Event needs its own `responsibilityIds`, or its
 *   series' when `null`. A Skip Date is `event.skipDate`. A series carries its
 *   `repeat` pattern (weekly / biweekly / monthly / custom, local time and zone) but
 *   the engine never expands it: Events are added by the caller (`addEvents`, or
 *   `editEventSeries` with `replaceFutureEvents`). A removed series stays
 *   (`removedAt`) and loses its future Events; only one-off Events are removed singly.
 * - `timeOff`: ranges, optionally repeating weekly and scoped to Responsibilities.
 *   Removed Time Off is kept (`removedAt`) for the Events it already routed.
 * - `assignments`: one seat each. `memberId` is who fills it, `turnOf` whose
 *   Rotation turn it used, `makeUpTurnId` the Make-up Turn it pays, `confirmation`
 *   its confirmation state, and `coverageRequest` a Decline / Coverage Request with
 *   its `cover` (a Member or a Guest Cover by name).
 * - `makeUpTurns`: Pay It Back debts (debtor owes creditor) with status
 *   outstanding / paid / settled / cancelled.
 * - `idSequence`: the counter behind engine-made ids (`a12`, `m3`).
 *
 * ## How the schedule is computed
 *
 * Past Assignments are history and never change. Future Assignments are derived on
 * every command by walking future Events in order from the Rotations: the next
 * Member in line fills each seat; a Member who can't (Time Off, already seated)
 * keeps the front while a routing partner takes the seat early. Declines and
 * Covers are pinned to their Event, while their seat exists: when a removed Event or
 * Responsibility or a lower headcount takes the seat away, the pin goes (Covers are
 * kept before open Coverage Requests) and a dropped Cover's Make-up Turn is
 * cancelled. Outstanding Make-up Turns are placed on the
 * creditor's next turn. The result is matched back to existing Assignments so
 * identity follows each Member's turn and only real changes are reported. Any
 * Assignment whose Member or Event changes asks for confirmation again.
 */

export { applyCommand, MAX_REPEAT_COUNT } from './commands';
export { createGroupState, DEFAULT_GROUP_SETTINGS, type NewGroup } from './state';
export {
  assignmentStatus,
  DEFAULT_ALERT_LEAD_TIME_MS,
  isUnconfirmed,
  replacementDutyHolder,
} from './status';
export { workload, type Workload } from './workload';
export type * from './types';
