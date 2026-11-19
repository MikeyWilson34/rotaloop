/**
 * Which actions a turn offers the viewer: one cover flow in plain words (simplify ticket 07).
 *
 * - Your turn: "Can't make it" (then: ask the group, or say who is covering).
 * - A Stand-in's turn (a Member not on the app): "Grace can't make it", for them.
 * - A turn that needs cover: "I'll cover" for anyone free that day; the first to tap takes it.
 *   Anyone may also "Pick who's covering" (there are no Admins for now, so no one is gated).
 * - Your open request: "I can make it after all".
 *
 * It mirrors the engine's rules (`src/engine/commands.ts`) so the screen only shows what the
 * server would accept. Pure TypeScript: no React, Supabase or clock reads; unit-tested under Node.
 */
import { assignmentStatus } from '../engine/status';
import type { Assignment, GroupSettings, Instant, MemberId, ReplacementDuty } from '../engine/types';

/** The engine command each button sends. */
export type ActionCommand = 'confirm' | 'decline' | 'withdrawDecline' | 'cover' | 'markCovered';

export type ActionKind =
  /** Pending: "Confirm". */
  | 'confirm'
  /** Scheduled and the job asks for confirmation: "Confirm early". */
  | 'confirmEarly'
  /** Your turn, or a Stand-in's: "Can't make it" (opens the "Can't make it?" sheet). */
  | 'decline'
  /** Confirmed, or covering: "I can't make it after all". */
  | 'declineAfterAll'
  /** An open request of mine (or a Stand-in's): "I can make it after all". */
  | 'withdrawDecline'
  /** A turn that needs cover: "I'll cover". */
  | 'cover'
  /** A turn that needs cover: "Pick who's covering" (anyone in the group). */
  | 'markCovered';

export type AssignmentAction = {
  kind: ActionKind;
  command: ActionCommand;
  label: string;
  variant: 'positive' | 'primary' | 'secondary' | 'quiet' | 'destructive';
};

/**
 * Whether the Member who asked for cover can take it back: the engine's `withdrawDecline` does
 * it while no one has covered, before the date. Only a "can't make it": dates off go away by
 * removing them.
 */
export const CAN_WITHDRAW_DECLINE = true;

export type ActionInput = {
  assignment: Assignment;
  eventStartsAt: Instant;
  /** The job asks for confirmation. */
  requiresConfirmation: boolean;
  /** The viewer is in the job's rotation (the engine only lets them cover then). */
  qualified: boolean;
  /** The viewer's active Member id in the Group, or null. */
  me: MemberId | null;
  /** The viewer already has another job in the group that day (see `busyThatDay`). */
  busyThatDay?: boolean;
  /** The turn's holder (or whoever asked for cover) is a Stand-in, by this name. */
  standInName?: string | null;
  /** Unused: no one is gated on being an Admin any more. Kept for callers. */
  isAdmin?: boolean;
  /** Unused: there is no "find a replacement by" duty any more. Kept for callers. */
  settings?: GroupSettings;
  now: Instant;
};

/** The state of the turn from the viewer's side, which picks the buttons and copy. */
export type ActionState =
  | 'past'
  | 'minePending'
  | 'mineConfirmed'
  | 'mineScheduled'
  /** The viewer covers it and nothing is awaited. */
  | 'mineCovering'
  /** A Stand-in's turn: the viewer can say they can't make it. */
  | 'standIn'
  /** An open request the viewer asked for (or asked for a Stand-in). */
  | 'iDeclined'
  /** A turn someone else asked to have covered (or an open turn). */
  | 'openRequest'
  /** Needs cover, but the viewer already has another job in the group that day. */
  | 'busy'
  /** Someone else's turn, or an outside cover. */
  | 'notMine';

export type ActionsView = {
  state: ActionState;
  actions: AssignmentAction[];
  /** Always null: kept for callers from before the simplification. */
  dutyHolder: ReplacementDuty | null;
  /** Always false: kept for callers from before the simplification. */
  iHoldDuty: boolean;
};

const CONFIRM: AssignmentAction = { kind: 'confirm', command: 'confirm', label: 'Confirm', variant: 'positive' };
const DECLINE: AssignmentAction = { kind: 'decline', command: 'decline', label: "Can't make it", variant: 'destructive' };
const COVER: AssignmentAction = { kind: 'cover', command: 'cover', label: "I'll cover", variant: 'primary' };
const PICK: AssignmentAction = { kind: 'markCovered', command: 'markCovered', label: "Pick who's covering", variant: 'quiet' };

export function isOpenRequest(a: Assignment): boolean {
  return a.coverageRequest !== null && a.coverageRequest.cover === null;
}

/** "Grace" from "Grace Hopper". */
function first(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** The actions a turn offers the viewer, in display order. */
export function assignmentActions(input: ActionInput): ActionsView {
  const { assignment: a, eventStartsAt, me, now } = input;
  const view = (state: ActionState, actions: AssignmentAction[] = []): ActionsView => ({
    state,
    actions,
    dutyHolder: null,
    iHoldDuty: false,
  });
  if (Date.parse(eventStartsAt) <= Date.parse(now)) return view('past');
  if (me === null) return view('notMine');

  const request = a.coverageRequest;
  if (request && !request.cover) {
    const forStandIn = !!input.standInName && request.requestedBy !== me;
    if (request.requestedBy === me || forStandIn) {
      const back: AssignmentAction[] =
        CAN_WITHDRAW_DECLINE && request.reason === 'declined'
          ? [
              {
                kind: 'withdrawDecline',
                command: 'withdrawDecline',
                label: forStandIn ? `${first(input.standInName!)} can make it after all` : 'I can make it after all',
                variant: 'secondary',
              },
            ]
          : [];
      // Someone acting for a Stand-in may also cover it themselves.
      const cover = forStandIn && input.qualified && !input.busyThatDay ? [COVER] : [];
      return view(forStandIn ? 'openRequest' : 'iDeclined', [...cover, PICK, ...back]);
    }
    if (input.busyThatDay) return view('busy', [PICK]);
    return view('openRequest', input.qualified ? [COVER, PICK] : [PICK]);
  }

  if (a.memberId !== me) {
    if (input.standInName && a.memberId !== null && !request) {
      return view('standIn', [{ ...DECLINE, label: `${first(input.standInName)} can't make it` }]);
    }
    return view('notMine');
  }

  const status = assignmentStatus(a, eventStartsAt, now);
  const awaiting = a.confirmation === 'requested' || status === 'unconfirmed';
  if (awaiting) return view('minePending', [CONFIRM, { ...DECLINE, variant: 'secondary' }]);
  if (a.confirmation === 'confirmed' || request?.cover) {
    const after: AssignmentAction = {
      kind: 'declineAfterAll',
      command: 'decline',
      label: "I can't make it after all",
      variant: 'quiet',
    };
    return view(a.confirmation === 'confirmed' && !request?.cover ? 'mineConfirmed' : 'mineCovering', [after]);
  }
  const early: AssignmentAction[] =
    input.requiresConfirmation && a.confirmation === 'notYetRequested'
      ? [{ kind: 'confirmEarly', command: 'confirm', label: 'Confirm early', variant: 'secondary' }]
      : [];
  return view('mineScheduled', [...early, DECLINE]);
}
