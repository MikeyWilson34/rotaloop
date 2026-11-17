import { describe, expect, it } from 'vitest';

import { applyCommand, createGroupState, type GroupState } from '../index';
import { act, afterWeek, assignmentOf, CREW, lineup, moves, NOW, rejected, setup, timeOff, week } from './scenario';

function declined(state: GroupState, eventId: string, memberId: string, reason?: string) {
  const assignmentId = assignmentOf(state, eventId, memberId).id;
  return act(state, { type: 'decline', assignmentId, ...(reason !== undefined ? { reason } : {}) }, { by: memberId });
}

const idOf = (state: GroupState, eventId: string, memberId: string) => assignmentOf(state, eventId, memberId).id;

describe('withdrawDecline', () => {
  it('puts the Member back in the seat, clears the Coverage Request and changes only that Assignment', () => {
    const before = setup();
    const state = declined(before, 'w1', 'ana').state;
    const result = act(state, { type: 'withdrawDecline', assignmentId: idOf(state, 'w1', 'ana') }, { by: 'ana' });
    expect(lineup(result.state)).toEqual(lineup(before));
    expect(moves(result)).toEqual(['ana@w1 -> ana@w1']);
    expect(result.changes[0].after?.coverageRequest).toBeNull();
    expect(result.changes[0].after?.id).toBe(idOf(before, 'w1', 'ana'));
    expect(result.history.at(-1)?.cause).toEqual({ type: 'withdrawDecline', assignmentId: idOf(state, 'w1', 'ana') });
  });

  it('counts as confirming when the Member says it themselves; not required stays not required', () => {
    const r = [{ id: 'sound', qualified: CREW, requiresConfirmation: true }];
    let state = declined(setup({ responsibilities: r }), 'w1', 'ana').state;
    state = act(state, { type: 'withdrawDecline', assignmentId: idOf(state, 'w1', 'ana') }, { by: 'ana' }).state;
    expect(assignmentOf(state, 'w1', 'ana').confirmation).toBe('confirmed');

    let plain = declined(setup(), 'w1', 'ana').state;
    plain = act(plain, { type: 'withdrawDecline', assignmentId: idOf(plain, 'w1', 'ana') }, { by: 'ana' }).state;
    expect(assignmentOf(plain, 'w1', 'ana').confirmation).toBe('notRequired');
  });

  it('an Admin may withdraw for a Placeholder Member, who is then asked to confirm', () => {
    let state = createGroupState({
      groupId: 'g1',
      members: [
        { id: 'adm', name: 'Adm', isAdmin: true, accountId: 'acct-adm' },
        { id: 'pat', name: 'Pat', accountId: null },
        { id: 'ben', name: 'Ben', accountId: 'acct-ben' },
      ],
      responsibilities: [
        { id: 'sound', name: 'Sound', headcount: 1, requiresConfirmation: true, qualifiedMemberIds: ['pat', 'ben'] },
      ],
      eventSeries: [{ id: 'sundays', name: 'Sundays', responsibilityIds: ['sound'] }],
      events: [
        { id: 'w1', seriesId: 'sundays', startsAt: week(1) },
        { id: 'w2', seriesId: 'sundays', startsAt: week(2) },
      ],
    });
    state = act(state, { type: 'fillSchedule' }).state;
    state = act(state, { type: 'decline', assignmentId: idOf(state, 'w1', 'pat') }, { by: 'adm' }).state;
    state = act(state, { type: 'withdrawDecline', assignmentId: idOf(state, 'w1', 'pat') }, { by: 'adm' }).state;
    expect(lineup(state)).toEqual(['w1 pat', 'w2 ben']);
    expect(assignmentOf(state, 'w1', 'pat').confirmation).toBe('requested');
  });

  it('only the Member who declined may withdraw it; an Admin may not for a Member with an account', () => {
    const state = declined(setup({ admins: ['dee'] }), 'w1', 'ana').state;
    const assignmentId = idOf(state, 'w1', 'ana');
    expect(rejected(state, { type: 'withdrawDecline', assignmentId }, { by: 'ben' })).toBe('notPermitted');
    expect(rejected(state, { type: 'withdrawDecline', assignmentId }, { by: 'dee' })).toBe('notPermitted');
  });

  it('is rejected once someone covered it', () => {
    let state = declined(setup(), 'w1', 'ana').state;
    const assignmentId = idOf(state, 'w1', 'ana');
    state = act(state, { type: 'cover', assignmentId }, { by: 'cal' }).state;
    expect(rejected(state, { type: 'withdrawDecline', assignmentId }, { by: 'ana' })).toBe('alreadyCovered');
  });

  it('is rejected after a Guest Cover too', () => {
    let state = declined(setup(), 'w1', 'ana').state;
    const assignmentId = idOf(state, 'w1', 'ana');
    state = act(state, { type: 'markCovered', assignmentId, by: { guestName: 'Pat' } }, { by: 'ana' }).state;
    expect(rejected(state, { type: 'withdrawDecline', assignmentId }, { by: 'ana' })).toBe('alreadyCovered');
  });

  it('works again once the Cover was withdrawn and the request is open', () => {
    let state = declined(setup(), 'w1', 'ana').state;
    const assignmentId = idOf(state, 'w1', 'ana');
    state = act(state, { type: 'cover', assignmentId }, { by: 'cal' }).state;
    state = act(state, { type: 'decline', assignmentId }, { by: 'cal' }).state;
    state = act(state, { type: 'withdrawDecline', assignmentId }, { by: 'ana' }).state;
    expect(lineup(state)).toEqual(lineup(setup()));
  });

  it('is rejected when there is no Coverage Request', () => {
    const state = setup();
    expect(rejected(state, { type: 'withdrawDecline', assignmentId: idOf(state, 'w1', 'ana') }, { by: 'ana' })).toBe(
      'noCoverageRequest',
    );
  });

  it('is rejected once the Event has started', () => {
    const state = declined(setup(), 'w1', 'ana').state;
    const assignmentId = idOf(state, 'w1', 'ana');
    expect(rejected(state, { type: 'withdrawDecline', assignmentId }, { by: 'ana', at: afterWeek(1) })).toBe(
      'eventHasPassed',
    );
  });

  it('is still allowed after the "find a replacement by" deadline, while no one has covered', () => {
    const state = declined(setup(), 'w1', 'ana').state;
    const assignmentId = idOf(state, 'w1', 'ana');
    const dayBefore = new Date(Date.parse(week(1)) - 24 * 60 * 60 * 1000).toISOString();
    const result = act(state, { type: 'withdrawDecline', assignmentId }, { by: 'ana', at: dayBefore });
    expect(lineup(result.state)[0]).toBe('w1 ana');
  });

  it('a Time Off Coverage Request cannot be withdrawn this way (remove the Time Off instead)', () => {
    let state = setup({ settings: { timeOffHandling: 'askVolunteer' } });
    state = act(state, { type: 'addTimeOff', timeOff: timeOff('t1', 'ana', 1) }, { by: 'ana' }).state;
    const request = state.assignments.find((a) => a.eventId === 'w1')!;
    expect(request.coverageRequest?.reason).toBe('timeOff');
    expect(rejected(state, { type: 'withdrawDecline', assignmentId: request.id }, { by: 'ana' })).toBe('invalid');
  });

  it('a declined Make-up Turn owes again when the Decline is withdrawn', () => {
    let state = declined(setup(), 'w1', 'ana').state;
    state = act(state, { type: 'cover', assignmentId: idOf(state, 'w1', 'ana') }, { by: 'cal' }).state;
    const paying = state.assignments.find((a) => a.makeUpTurnId !== null)!;
    expect(paying.memberId).toBe('ana');
    const before = lineup(state);
    state = act(state, { type: 'decline', assignmentId: paying.id }, { by: 'ana' }).state;
    expect(state.makeUpTurns[0].status).toBe('settled');
    const result = act(state, { type: 'withdrawDecline', assignmentId: paying.id }, { by: 'ana' });
    expect(lineup(result.state)).toEqual(before);
    expect(result.state.makeUpTurns[0]).toMatchObject({ status: 'outstanding', closedAt: null, closedReason: null });
    expect(result.state.assignments.find((a) => a.id === paying.id)?.makeUpTurnId).toBe(paying.makeUpTurnId);
  });

  it('is rejected when the Rotation changed so the seat would go to someone else', () => {
    let state = declined(setup({ admins: ['dee'] }), 'w1', 'ana').state;
    state = act(state, { type: 'reorderQueue', responsibilityId: 'sound', queue: ['ben', 'cal', 'dee', 'ana'] }, { by: 'dee' }).state;
    expect(rejected(state, { type: 'withdrawDecline', assignmentId: idOf(state, 'w1', 'ana') }, { by: 'ana' })).toBe(
      'invalid',
    );
  });
});

describe('Decline reason', () => {
  it('is stored on the Coverage Request (trimmed) and carried by the history cause', () => {
    const result = declined(setup(), 'w1', 'ana', '  Traveling: back on the 10th ');
    expect(assignmentOf(result.state, 'w1', 'ana').coverageRequest?.note).toBe('Traveling: back on the 10th');
    expect(result.history.at(-1)?.cause).toMatchObject({ type: 'decline', reason: '  Traveling: back on the 10th ' });
  });

  it('is optional; blank means none', () => {
    expect(assignmentOf(declined(setup(), 'w1', 'ana').state, 'w1', 'ana').coverageRequest?.note).toBeNull();
    expect(assignmentOf(declined(setup(), 'w1', 'ana', '   ').state, 'w1', 'ana').coverageRequest?.note).toBeNull();
  });

  it('is at most 300 characters', () => {
    const state = setup();
    const assignmentId = idOf(state, 'w1', 'ana');
    expect(rejected(state, { type: 'decline', assignmentId, reason: 'x'.repeat(301) }, { by: 'ana' })).toBe('invalid');
    expect(act(state, { type: 'decline', assignmentId, reason: 'x'.repeat(300) }, { by: 'ana' }).ok).toBe(true);
  });

  it('stays with the request through a Cover and its withdrawal', () => {
    let state = declined(setup(), 'w1', 'ana', 'Sick').state;
    const assignmentId = idOf(state, 'w1', 'ana');
    state = act(state, { type: 'cover', assignmentId }, { by: 'cal' }).state;
    expect(state.assignments.find((a) => a.id === assignmentId)?.coverageRequest?.note).toBe('Sick');
    state = act(state, { type: 'decline', assignmentId, reason: 'Work conflict' }, { by: 'cal' }).state;
    expect(state.assignments.find((a) => a.id === assignmentId)?.coverageRequest?.note).toBe('Sick');
  });

  it('Time Off asking for a volunteer gives the reason "Time Off"', () => {
    let state = setup({ settings: { timeOffHandling: 'askVolunteer' } });
    state = act(state, { type: 'addTimeOff', timeOff: timeOff('t1', 'ana', 1) }, { by: 'ana' }).state;
    const request = state.assignments.find((a) => a.eventId === 'w1')!.coverageRequest;
    expect(request).toMatchObject({ reason: 'timeOff', note: 'Time Off' });
  });

  it('is part of the preview result too (pure)', () => {
    const state = setup();
    const r = applyCommand(state, { type: 'decline', assignmentId: idOf(state, 'w1', 'ana'), reason: 'Sick' }, { now: NOW, actorId: 'ana' });
    expect(r.ok && r.changes[0].after?.coverageRequest?.note).toBe('Sick');
  });
});
