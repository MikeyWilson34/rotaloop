import { describe, expect, it } from 'vitest';

import { DEFAULT_GROUP_SETTINGS, type Assignment, type GroupSettings } from '../../engine';
import { assignmentActions, CAN_WITHDRAW_DECLINE, type ActionInput } from '../actions';

const EVENT_AT = '2026-11-29T15:00:00.000Z';
/** Well before the "find a replacement by" deadline (Nov 26, 15:00 UTC). */
const NOW = '2026-11-18T12:00:00.000Z';
/** After the deadline, before the Event. */
const LATE = '2026-11-27T12:00:00.000Z';

const mine: Assignment = {
  id: 'a1',
  eventId: 'e1',
  responsibilityId: 'sound',
  memberId: 'me',
  turnOf: 'me',
  makeUpTurnId: null,
  confirmation: 'notYetRequested',
  coverageRequest: null,
};

const declinedBy = (who: string): Assignment => ({
  ...mine,
  memberId: who,
  turnOf: who,
  coverageRequest: { reason: 'declined', requestedBy: who, requestedAt: NOW, cover: null },
});

function input(assignment: Assignment, over: Partial<ActionInput> = {}): ActionInput {
  return {
    assignment,
    eventStartsAt: EVENT_AT,
    requiresConfirmation: true,
    qualified: true,
    me: 'me',
    isAdmin: false,
    settings: DEFAULT_GROUP_SETTINGS,
    now: NOW,
    ...over,
  };
}

const labels = (i: ActionInput) => assignmentActions(i).actions.map((a) => a.label);
const admins: GroupSettings = { ...DEFAULT_GROUP_SETTINGS, replacementDuty: 'admins' };

describe('assignmentActions: my own Assignment', () => {
  it('Pending: Confirm / Can’t make it', () => {
    const v = assignmentActions(input({ ...mine, confirmation: 'requested' }));
    expect(v.state).toBe('minePending');
    expect(v.actions.map((a) => [a.label, a.command])).toEqual([
      ['Confirm', 'confirm'],
      ["Can't make it", 'decline'],
    ]);
  });

  it('Unconfirmed (inside the alert lead time) is treated as Pending', () => {
    expect(labels(input(mine, { now: LATE }))).toEqual(['Confirm', "Can't make it"]);
  });

  it('Confirmed: "I can’t make it after all", which declines', () => {
    const v = assignmentActions(input({ ...mine, confirmation: 'confirmed' }));
    expect(v.state).toBe('mineConfirmed');
    expect(v.actions).toEqual([
      { kind: 'declineAfterAll', command: 'decline', label: "I can't make it after all", variant: 'quiet' },
    ]);
  });

  it('Scheduled with confirmation required: Confirm early and Can’t make it', () => {
    const v = assignmentActions(input(mine));
    expect(v.state).toBe('mineScheduled');
    expect(v.actions.map((a) => [a.label, a.command])).toEqual([
      ['Confirm early', 'confirm'],
      ["Can't make it", 'decline'],
    ]);
  });

  it('Scheduled with no confirmation needed: only Can’t make it', () => {
    expect(labels(input({ ...mine, confirmation: 'notRequired' }, { requiresConfirmation: false }))).toEqual([
      "Can't make it",
    ]);
  });

  it('Covering someone: "I can’t make it after all" (withdraws the Cover)', () => {
    const covering: Assignment = {
      ...mine,
      turnOf: 'ben',
      confirmation: 'notRequired',
      coverageRequest: {
        reason: 'declined',
        requestedBy: 'ben',
        requestedAt: NOW,
        cover: { kind: 'member', memberId: 'me', arrangedBy: 'me', coveredAt: NOW },
      },
    };
    const v = assignmentActions(input(covering, { requiresConfirmation: false }));
    expect(v.state).toBe('mineCovering');
    expect(labels(input(covering))).toEqual(["I can't make it after all"]);
    // Marked covered by someone else and asked to confirm: Confirm / Can't make it.
    expect(labels(input({ ...covering, confirmation: 'requested' }))).toEqual(['Confirm', "Can't make it"]);
  });

  it('no actions once the Event has started', () => {
    const v = assignmentActions(input({ ...mine, confirmation: 'requested' }, { now: EVENT_AT }));
    expect(v).toMatchObject({ state: 'past', actions: [] });
    expect(assignmentActions(input(declinedBy('ben'), { now: EVENT_AT, isAdmin: true })).actions).toEqual([]);
  });
});

describe('assignmentActions: Coverage Requests', () => {
  it('Qualified and not mine: I can cover', () => {
    const v = assignmentActions(input(declinedBy('ben')));
    expect(v.state).toBe('openRequest');
    expect(v.actions.map((a) => [a.label, a.command])).toEqual([['I can cover', 'cover']]);
    expect(v.dutyHolder).toBeNull();
  });

  it('not Qualified: nothing (a plain Member)', () => {
    expect(labels(input(declinedBy('ben'), { qualified: false }))).toEqual([]);
  });

  it('not a Member of the Group: nothing', () => {
    expect(labels(input(declinedBy('ben'), { me: null }))).toEqual([]);
  });

  it('I declined it: "I can make it after all" (withdrawDecline)', () => {
    expect(CAN_WITHDRAW_DECLINE).toBe(true);
    const v = assignmentActions(input(declinedBy('me')));
    expect(v).toMatchObject({ state: 'iDeclined', iHoldDuty: false });
    expect(v.actions.map((a) => [a.label, a.command, a.variant])).toEqual([
      ['I can make it after all', 'withdrawDecline', 'secondary'],
    ]);
  });

  it('a Time Off Coverage Request offers no withdraw (remove the Time Off instead)', () => {
    const timeOff: Assignment = { ...declinedBy('me'), coverageRequest: { reason: 'timeOff', requestedBy: 'me', requestedAt: NOW, cover: null } };
    expect(labels(input(timeOff))).toEqual([]);
  });

  it('withdrawing is still offered after the deadline, after Mark covered', () => {
    expect(labels(input(declinedBy('me'), { now: LATE }))).toEqual(['Mark covered', 'I can make it after all']);
  });

  it('Admins can mark any open request covered, as a secondary action', () => {
    const v = assignmentActions(input(declinedBy('ben'), { isAdmin: true }));
    expect(v.actions.map((a) => [a.label, a.variant])).toEqual([
      ['I can cover', 'primary'],
      ['Mark covered', 'secondary'],
    ]);
    expect(labels(input(declinedBy('ben'), { isAdmin: true, qualified: false }))).toEqual(['Mark covered']);
  });

  it('after the deadline (Assigned Member duty): the decliner marks it covered', () => {
    const v = assignmentActions(input(declinedBy('me'), { now: LATE }));
    expect(v).toMatchObject({ state: 'iDeclined', dutyHolder: 'assignedMember', iHoldDuty: true });
    expect(v.actions.map((a) => [a.label, a.command, a.variant])).toEqual([
      ['Mark covered', 'markCovered', 'primary'],
      ['I can make it after all', 'withdrawDecline', 'secondary'],
    ]);
  });

  // Intentional (ticket 16): "I can cover" stays after the "find a replacement by" deadline. The
  // deadline only decides who must find someone; a volunteer is still welcome and the engine
  // accepts the Cover. (The prototype hid it; the owner's rule is that nothing is ever locked.)
  it('after the deadline, others can still volunteer, and see who holds the duty', () => {
    const v = assignmentActions(input(declinedBy('ben'), { now: LATE }));
    expect(v).toMatchObject({ dutyHolder: 'assignedMember', iHoldDuty: false });
    expect(v.actions.map((a) => a.label)).toEqual(['I can cover']);
  });

  it('after the deadline (Admins duty): Admins hold it, the decliner does not', () => {
    const asAdmin = assignmentActions(input(declinedBy('ben'), { now: LATE, settings: admins, isAdmin: true }));
    expect(asAdmin).toMatchObject({ dutyHolder: 'admins', iHoldDuty: true });
    expect(asAdmin.actions.map((a) => [a.label, a.variant])).toEqual([
      ['I can cover', 'primary'],
      ['Mark covered', 'primary'],
    ]);
    const decliner = assignmentActions(input(declinedBy('me'), { now: LATE, settings: admins }));
    expect(decliner).toMatchObject({ iHoldDuty: false });
    expect(decliner.actions.map((a) => a.label)).toEqual(['I can make it after all']);
  });

  it('before the deadline the decliner can’t mark it covered (an Admin decliner can)', () => {
    expect(labels(input(declinedBy('me')))).toEqual(['I can make it after all']);
    expect(labels(input(declinedBy('me'), { isAdmin: true }))).toEqual(['Mark covered', 'I can make it after all']);
  });
});

describe('"I can cover" after the deadline is intentional (ticket 16)', () => {
  it('stays visible to Qualified Members under either Replacement Duty setting, until the Event starts', () => {
    expect(labels(input(declinedBy('ben'), { now: LATE }))).toEqual(['I can cover']);
    expect(labels(input(declinedBy('ben'), { now: LATE, settings: admins }))).toEqual(['I can cover']);
    expect(labels(input(declinedBy('ben'), { now: EVENT_AT }))).toEqual([]);
  });
});

describe('assignmentActions: someone else’s Assignment', () => {
  it('nothing on another Member’s Assignment or a Guest Cover', () => {
    expect(assignmentActions(input({ ...mine, memberId: 'ben' }, { isAdmin: true }))).toMatchObject({
      state: 'notMine',
      actions: [],
    });
    const guest: Assignment = {
      ...mine,
      memberId: null,
      coverageRequest: {
        reason: 'declined',
        requestedBy: 'ben',
        requestedAt: NOW,
        cover: { kind: 'guest', guestName: 'Jo', arrangedBy: 'ben', coveredAt: NOW },
      },
    };
    expect(labels(input(guest))).toEqual([]);
  });
});
