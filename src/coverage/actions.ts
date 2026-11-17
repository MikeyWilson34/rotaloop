/**
 * Which actions an Assignment offers the viewer (ticket 09): Confirm, Can't make it, I can
 * cover, Mark covered. It mirrors the engine's rules (`src/engine/commands.ts`) so the screen
 * only shows what the server would accept, and adds the copy around the buttons.
 *
 * Pure TypeScript: no React, Supabase or clock reads; unit-tested under Node.
 */
import { assignmentStatus, replacementDutyHolder } from '../engine/status';
import type { Assignment, GroupSettings, Instant, MemberId, ReplacementDuty } from '../engine/types';

/** The engine command each button sends. */
export type ActionCommand = 'confirm' | 'decline' | 'withdrawDecline' | 'cover' | 'markCovered';

export type ActionKind =
  /** Pending: "Confirm". */
  | 'confirm'
  /** Scheduled and the Responsibility needs confirmation: "Confirm early". */
  | 'confirmEarly'
  /** Pending or Scheduled: "Can't make it" (Decline). */
  | 'decline'
  /** Confirmed, or covering: "I can't make it after all" (Decline, or withdraw a Cover). */
  | 'declineAfterAll'
  /** An open Decline of mine: "I can make it after all" (`withdrawDecline`). */
  | 'withdrawDecline'
  /** A Coverage Request the viewer is Qualified for: "I can cover". */
  | 'cover'
  /** Replacement Duty, or any Admin on an open request: "Mark covered". */
  | 'markCovered';

export type AssignmentAction = {
  kind: ActionKind;
  command: ActionCommand;
  label: string;
  variant: 'positive' | 'primary' | 'secondary' | 'quiet';
};

/**
 * Whether the Member who declined can take it back: the engine's `withdrawDecline` (ticket 16)
 * does it while no one has covered, before the Event, even after the deadline. Only a Decline:
 * a Time Off Coverage Request goes away by removing the Time Off.
 */
export const CAN_WITHDRAW_DECLINE = true;

export type ActionInput = {
  assignment: Assignment;
  eventStartsAt: Instant;
  /** The Responsibility asks for confirmation. */
  requiresConfirmation: boolean;
  /** The viewer is a Qualified Member of the Responsibility. */
  qualified: boolean;
  /** The viewer's active Member id in the Group, or null. */
  me: MemberId | null;
  isAdmin: boolean;
  settings: GroupSettings;
  now: Instant;
};

/** The state of the Assignment from the viewer's side, which picks the buttons and copy. */
export type ActionState =
  | 'past'
  | 'minePending'
  | 'mineConfirmed'
  | 'mineScheduled'
  /** The viewer covers it and nothing is awaited (Covered). */
  | 'mineCovering'
  /** An open Coverage Request the viewer asked for. */
  | 'iDeclined'
  /** An open Coverage Request someone else asked for (or an open seat). */
  | 'openRequest'
  /** Someone else's Assignment, or a Guest Cover. */
  | 'notMine';

export type ActionsView = {
  state: ActionState;
  actions: AssignmentAction[];
  /** For an open Coverage Request: who holds Replacement Duty now (null before the deadline). */
  dutyHolder: ReplacementDuty | null;
  /** The viewer holds Replacement Duty right now. */
  iHoldDuty: boolean;
};

const CONFIRM: AssignmentAction = { kind: 'confirm', command: 'confirm', label: 'Confirm', variant: 'positive' };
const DECLINE: AssignmentAction = { kind: 'decline', command: 'decline', label: "Can't make it", variant: 'secondary' };

export function isOpenRequest(a: Assignment): boolean {
  return a.coverageRequest !== null && a.coverageRequest.cover === null;
}

/** The actions an Assignment offers the viewer, in display order. */
export function assignmentActions(input: ActionInput): ActionsView {
  const { assignment: a, eventStartsAt, me, isAdmin, settings, now } = input;
  const none = (state: ActionState): ActionsView => ({ state, actions: [], dutyHolder: null, iHoldDuty: false });
  if (Date.parse(eventStartsAt) <= Date.parse(now)) return none('past');

  const request = a.coverageRequest;
  if (request && !request.cover) {
    const holder = replacementDutyHolder(a, eventStartsAt, settings, now);
    const iDeclined = me !== null && request.requestedBy === me;
    const iHoldDuty =
      me !== null && ((holder === 'assignedMember' && iDeclined) || (holder === 'admins' && isAdmin));
    const actions: AssignmentAction[] = [];
    // Intentional (ticket 16): "I can cover" stays after the "find a replacement by" deadline.
    // The deadline only decides who must find someone; a volunteer is still welcome and the
    // engine accepts the Cover until the Event starts. Pinned by tests in actions.test.ts.
    if (me !== null && !iDeclined && input.qualified) {
      actions.push({ kind: 'cover', command: 'cover', label: 'I can cover', variant: 'primary' });
    }
    if (me !== null && (iHoldDuty || isAdmin)) {
      actions.push({
        kind: 'markCovered',
        command: 'markCovered',
        label: 'Mark covered',
        variant: iHoldDuty ? 'primary' : 'secondary',
      });
    }
    if (CAN_WITHDRAW_DECLINE && iDeclined && request.reason === 'declined') {
      actions.push({
        kind: 'withdrawDecline',
        command: 'withdrawDecline',
        label: 'I can make it after all',
        variant: 'secondary',
      });
    }
    return { state: iDeclined ? 'iDeclined' : 'openRequest', actions, dutyHolder: holder, iHoldDuty };
  }

  if (me === null || a.memberId !== me) return none('notMine');

  const status = assignmentStatus(a, eventStartsAt, now);
  const awaiting = a.confirmation === 'requested' || status === 'unconfirmed';
  if (awaiting) return { ...none('minePending'), actions: [CONFIRM, DECLINE] };
  if (a.confirmation === 'confirmed' || request?.cover) {
    const after: AssignmentAction = {
      kind: 'declineAfterAll',
      command: 'decline',
      label: "I can't make it after all",
      variant: 'quiet',
    };
    return { ...none(a.confirmation === 'confirmed' ? 'mineConfirmed' : 'mineCovering'), actions: [after] };
  }
  const early: AssignmentAction[] =
    input.requiresConfirmation && a.confirmation === 'notYetRequested'
      ? [{ kind: 'confirmEarly', command: 'confirm', label: 'Confirm early', variant: 'secondary' }]
      : [];
  return { ...none('mineScheduled'), actions: [...early, DECLINE] };
}
