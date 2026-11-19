import { describe, expect, it } from 'vitest';

import type { Assignment } from '../../engine';
import { assignmentActions, CAN_WITHDRAW_DECLINE, type ActionInput } from '../actions';

const EVENT_AT = '2026-11-29T15:00:00.000Z';
const NOW = '2026-11-18T12:00:00.000Z';
/** Close to the date (inside the old alert lead time), before it starts. */
const LATE = '2026-11-27T12:00:00.000Z';

const mine: Assignment = {
  id: 'a1',
  eventId: 'e1',
  responsibilityId: 'sound',
  memberId: 'me',
  turnOf: 'me',
  makeUpTurnId: null,
  confirmation: 'notRequired',
  coverageRequest: null,
};

const declinedBy = (who: string): Assignment => ({
  ...mine,
  memberId: who,
  turnOf: who,
  coverageRequest: { reason: 'declined', requestedBy: who, requestedAt: NOW, cover: null },
});

function input(assignment: Assignment, over: Partial<ActionInput> = {}): ActionInput {
  return { assignment, eventStartsAt: EVENT_AT, requiresConfirmation: false, qualified: true, me: 'me', now: NOW, ...over };
}

const labels = (i: ActionInput) => assignmentActions(i).actions.map((a) => a.label);

describe('assignmentActions: my own turn', () => {
  it("one red \"Can't make it\"", () => {
    const v = assignmentActions(input(mine));
    expect(v.state).toBe('mineScheduled');
    expect(v.actions).toEqual([{ kind: 'decline', command: 'decline', label: "Can't make it", variant: 'destructive' }]);
  });

  it('a job that still asks for confirmation (older groups): Confirm / Can’t make it', () => {
    const v = assignmentActions(input({ ...mine, confirmation: 'requested' }, { requiresConfirmation: true }));
    expect(v.state).toBe('minePending');
    expect(v.actions.map((a) => [a.label, a.command])).toEqual([
      ['Confirm', 'confirm'],
      ["Can't make it", 'decline'],
    ]);
    expect(labels(input({ ...mine, confirmation: 'notYetRequested' }, { requiresConfirmation: true }))).toEqual([
      'Confirm early',
      "Can't make it",
    ]);
  });

  it('covering someone: "I can\'t make it after all"', () => {
    const covering: Assignment = {
      ...declinedBy('ben'),
      memberId: 'me',
      coverageRequest: {
        reason: 'declined',
        requestedBy: 'ben',
        requestedAt: NOW,
        cover: { kind: 'member', memberId: 'me', arrangedBy: 'me', coveredAt: NOW },
      },
    };
    const v = assignmentActions(input(covering));
    expect(v.state).toBe('mineCovering');
    expect(labels(input(covering))).toEqual(["I can't make it after all"]);
  });

  it('nothing once it has started', () => {
    expect(assignmentActions(input(mine, { now: EVENT_AT })).state).toBe('past');
  });
});

describe('assignmentActions: a turn that needs cover', () => {
  it('anyone free that day: "I\'ll cover" first, and "Pick who\'s covering" (no Admin needed)', () => {
    const v = assignmentActions(input(declinedBy('ben')));
    expect(v.state).toBe('openRequest');
    expect(v.actions.map((a) => [a.label, a.command])).toEqual([
      ["I'll cover", 'cover'],
      ["Pick who's covering", 'markCovered'],
    ]);
    expect(v.dutyHolder).toBeNull();
    expect(v.iHoldDuty).toBe(false);
  });

  it('stays on offer close to the date: no "find a replacement by" duty any more', () => {
    expect(labels(input(declinedBy('ben'), { now: LATE }))).toEqual(["I'll cover", "Pick who's covering"]);
  });

  it('not "I\'ll cover" when I already have another job that day', () => {
    const v = assignmentActions(input(declinedBy('ben'), { busyThatDay: true }));
    expect(v.state).toBe('busy');
    expect(labels(input(declinedBy('ben'), { busyThatDay: true }))).toEqual(["Pick who's covering"]);
  });

  it('my own request: "I can make it after all", and I can still name who covers', () => {
    const v = assignmentActions(input(declinedBy('me')));
    expect(v.state).toBe('iDeclined');
    expect(labels(input(declinedBy('me')))).toEqual(["Pick who's covering", 'I can make it after all']);
    expect(CAN_WITHDRAW_DECLINE).toBe(true);
  });

  it("a Stand-in's request: anyone can cover it, pick, or take it back for them", () => {
    expect(labels(input(declinedBy('pat'), { standInName: 'Pat Jones' }))).toEqual([
      "I'll cover",
      "Pick who's covering",
      'Pat can make it after all',
    ]);
  });
});

describe("assignmentActions: someone else's turn", () => {
  it('nothing for a Member on the app', () => {
    const v = assignmentActions(input({ ...mine, memberId: 'ben', turnOf: 'ben' }));
    expect(v.state).toBe('notMine');
    expect(v.actions).toEqual([]);
  });

  it('"Pat can\'t make it" on a Stand-in\'s turn', () => {
    const v = assignmentActions(input({ ...mine, memberId: 'pat', turnOf: 'pat' }, { standInName: 'Pat Jones' }));
    expect(v.state).toBe('standIn');
    expect(v.actions.map((a) => [a.label, a.command])).toEqual([["Pat can't make it", 'decline']]);
  });

  it('nothing when the viewer is not an active Member', () => {
    expect(assignmentActions(input(declinedBy('ben'), { me: null })).actions).toEqual([]);
  });
});
