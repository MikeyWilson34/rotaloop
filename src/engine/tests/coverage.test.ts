import { describe, expect, it } from 'vitest';

import type { GroupState } from '../index';
import { workload } from '../index';
import { act, afterWeek, assignmentOf, CREW, lineup, moves, rejected, setup, timeOff } from './scenario';

const WITH_EVE = [...CREW, 'eve'];

function declined(state: GroupState, eventId: string, memberId: string) {
  return act(state, { type: 'decline', assignmentId: assignmentOf(state, eventId, memberId).id }, { by: memberId });
}

function covered(state: GroupState, eventId: string, decliner: string, coverer: string) {
  const assignmentId = assignmentOf(state, eventId, decliner).id;
  return act(state, { type: 'cover', assignmentId }, { by: coverer });
}

describe('Decline and Cover', () => {
  it('Decline: the Assignment becomes a Coverage Request and nothing else moves', () => {
    const result = declined(setup(), 'w1', 'ana');
    expect(lineup(result.state)[0]).toBe('w1 ana (needs coverage)');
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].after?.coverageRequest).toMatchObject({ reason: 'declined', requestedBy: 'ana', cover: null });
  });

  it('Cover: the first Qualified Member to accept gets it; a later accept is told it is already covered', () => {
    let state = setup({ settings: { coveragePolicy: 'countRealWork' } });
    state = declined(state, 'w1', 'ana').state;
    const assignmentId = assignmentOf(state, 'w1', 'ana').id;
    const first = act(state, { type: 'cover', assignmentId }, { by: 'cal' });
    expect(lineup(first.state)[0]).toBe('w1 cal');
    expect(moves(first)).toEqual(['ana@w1 -> cal@w1']);
    expect(rejected(first.state, { type: 'cover', assignmentId }, { by: 'dee' })).toBe('alreadyCovered');
  });

  it('Cover: only Qualified Members can volunteer', () => {
    let state = setup({ members: WITH_EVE, responsibilities: [{ id: 'sound', qualified: CREW }] });
    state = declined(state, 'w1', 'ana').state;
    const assignmentId = assignmentOf(state, 'w1', 'ana').id;
    expect(rejected(state, { type: 'cover', assignmentId }, { by: 'eve' })).toBe('notQualified');
  });

  it('Cover: a Member already serving at that Event cannot also cover there', () => {
    let state = setup({ responsibilities: [{ id: 'sound', headcount: 2, qualified: CREW }] });
    state = declined(state, 'w1', 'ana').state;
    const assignmentId = assignmentOf(state, 'w1', 'ana').id;
    expect(rejected(state, { type: 'cover', assignmentId }, { by: 'ben' })).toBe('alreadyAssignedAtEvent');
  });

  it('Cover: a volunteer accepting counts as confirming', () => {
    let state = setup({ responsibilities: [{ id: 'sound', qualified: CREW, requiresConfirmation: true }] });
    state = declined(state, 'w1', 'ana').state;
    state = covered(state, 'w1', 'ana', 'cal').state;
    expect(assignmentOf(state, 'w1', 'cal').confirmation).toBe('confirmed');
  });

  it('Declining a Cover withdraws it and the Coverage Request opens again', () => {
    let state = setup();
    state = declined(state, 'w1', 'ana').state;
    state = covered(state, 'w1', 'ana', 'cal').state;
    const result = act(state, { type: 'decline', assignmentId: assignmentOf(state, 'w1', 'cal').id }, { by: 'cal' });
    expect(lineup(result.state)).toEqual(lineup(declined(setup(), 'w1', 'ana').state));
    expect(result.state.makeUpTurns[0]).toMatchObject({ status: 'cancelled', closedReason: 'coverWithdrawn' });
  });

  it('Time Off for a coverer on the covered date withdraws the Cover', () => {
    let state = setup();
    state = declined(state, 'w1', 'ana').state;
    state = covered(state, 'w1', 'ana', 'cal').state;
    state = act(state, { type: 'addTimeOff', timeOff: timeOff('t1', 'cal', 1) }, { by: 'cal' }).state;
    expect(lineup(state)[0]).toBe('w1 ana (needs coverage)');
    expect(state.makeUpTurns[0].status).toBe('cancelled');
  });
});

describe('Pay It Back', () => {
  it("Pay It Back: a Cover creates a Make-up Turn and the decliner takes the coverer's next turn", () => {
    let state = declined(setup(), 'w1', 'ana').state;
    const result = covered(state, 'w1', 'ana', 'cal');
    state = result.state;
    expect(lineup(state)).toEqual(['w1 cal', 'w2 ben', 'w3 ana', 'w4 dee', 'w5 ana', 'w6 ben', 'w7 cal', 'w8 dee']);
    expect(moves(result)).toEqual(['ana@w1 -> cal@w1', 'cal@w3 -> ana@w3']);
    expect(state.makeUpTurns).toEqual([
      expect.objectContaining({ debtorId: 'ana', creditorId: 'cal', status: 'outstanding' }),
    ]);
    expect(assignmentOf(state, 'w3', 'ana')).toMatchObject({ turnOf: 'cal', makeUpTurnId: state.makeUpTurns[0].id });
  });

  it('Pay It Back: the Make-up Turn is paid once its Event has happened', () => {
    let state = declined(setup(), 'w1', 'ana').state;
    state = covered(state, 'w1', 'ana', 'cal').state;
    const later = act(state, { type: 'fillSchedule' }, { at: afterWeek(3) });
    expect(later.state.makeUpTurns[0]).toMatchObject({ status: 'paid', closedReason: 'paid' });
    expect(later.history[0]).toMatchObject({ cause: { type: 'makeUpTurnPaid' } });
    expect(lineup(later.state)).toEqual(lineup(state));
  });

  it('Pay It Back: declining a Make-up Turn moves the debt to the new coverer', () => {
    let state = declined(setup(), 'w1', 'ana').state;
    state = covered(state, 'w1', 'ana', 'cal').state;
    state = declined(state, 'w3', 'ana').state;
    expect(state.makeUpTurns[0]).toMatchObject({ status: 'settled', closedReason: 'movedAlong' });
    state = covered(state, 'w3', 'ana', 'dee').state;
    expect(state.makeUpTurns[1]).toMatchObject({ debtorId: 'ana', creditorId: 'dee', status: 'outstanding' });
    expect(lineup(state)).toEqual(['w1 cal', 'w2 ben', 'w3 dee', 'w4 ana', 'w5 ana', 'w6 ben', 'w7 cal', 'w8 dee']);
  });

  it("Pay It Back: a Make-up Turn waits for the coverer's next turn the decliner can take", () => {
    let state = declined(setup(), 'w1', 'ana').state;
    state = covered(state, 'w1', 'ana', 'cal').state;
    state = act(state, { type: 'addTimeOff', timeOff: timeOff('t1', 'ana', 3) }, { by: 'ana' }).state;
    expect(lineup(state)).toEqual(['w1 cal', 'w2 ben', 'w3 cal', 'w4 dee', 'w5 ana', 'w6 ben', 'w7 ana', 'w8 dee']);
  });

  it('Count Real Work: a Cover creates no Make-up Turn and moves no one else', () => {
    let state = declined(setup({ settings: { coveragePolicy: 'countRealWork' } }), 'w1', 'ana').state;
    state = covered(state, 'w1', 'ana', 'cal').state;
    expect(state.makeUpTurns).toEqual([]);
    expect(lineup(state)).toEqual(['w1 cal', 'w2 ben', 'w3 cal', 'w4 dee', 'w5 ana', 'w6 ben', 'w7 cal', 'w8 dee']);
  });

  it('Switching to Count Real Work cancels outstanding Make-up Turns and gives the coverer their turn back', () => {
    let state = setup({ admins: ['ben'] });
    state = declined(state, 'w1', 'ana').state;
    state = covered(state, 'w1', 'ana', 'cal').state;
    const result = act(state, { type: 'changeSettings', settings: { coveragePolicy: 'countRealWork' } }, { by: 'ben' });
    expect(result.state.makeUpTurns[0]).toMatchObject({ status: 'cancelled', closedReason: 'coveragePolicyChanged' });
    expect(moves(result)).toEqual(['ana@w3 -> cal@w3']);
    expect(result.history.at(-1)?.makeUpTurns).toEqual([
      { makeUpTurnId: state.makeUpTurns[0].id, before: 'outstanding', after: 'cancelled' },
    ]);
  });

  it('Changing settings is for Admins only', () => {
    expect(rejected(setup(), { type: 'changeSettings', settings: { allowDoubling: true } }, { by: 'ana' })).toBe(
      'notPermitted',
    );
  });
});

describe('Replacement Duty', () => {
  it('Guest Cover: recorded by name only, counts toward no one and creates no Make-up Turn', () => {
    let state = declined(setup(), 'w1', 'ana').state;
    const assignmentId = assignmentOf(state, 'w1', 'ana').id;
    state = act(state, { type: 'markCovered', assignmentId, by: { guestName: 'Pat' } }, { by: 'ana' }).state;
    expect(lineup(state)[0]).toBe('w1 guest:Pat');
    expect(state.makeUpTurns).toEqual([]);
    const counts = workload(state, 'sound', afterWeek(1));
    expect(counts.reduce((sum, w) => sum + w.served + w.covered, 0)).toBe(0);
  });

  it('The assigned Member can mark it covered by any Group Member, Qualified or not', () => {
    let state = setup({
      members: WITH_EVE,
      responsibilities: [{ id: 'sound', qualified: CREW, requiresConfirmation: true }],
    });
    state = declined(state, 'w1', 'ana').state;
    const assignmentId = assignmentOf(state, 'w1', 'ana').id;
    const result = act(state, { type: 'markCovered', assignmentId, by: { memberId: 'eve' } }, { by: 'ana' });
    expect(lineup(result.state)[0]).toBe('w1 eve');
    // eve has no turns in sound to take, so no Make-up Turn; eve is asked to confirm.
    expect(result.state.makeUpTurns).toEqual([]);
    expect(assignmentOf(result.state, 'w1', 'eve').confirmation).toBe('requested');
  });

  it('Replacement Duty with Admins: only an Admin may mark it covered, and a Qualified coverer is owed', () => {
    let state = setup({
      members: WITH_EVE,
      admins: ['eve'],
      responsibilities: [{ id: 'sound', qualified: CREW }],
      settings: { replacementDuty: 'admins' },
    });
    state = declined(state, 'w1', 'ana').state;
    const assignmentId = assignmentOf(state, 'w1', 'ana').id;
    const command = { type: 'markCovered', assignmentId, by: { memberId: 'ben' } } as const;
    expect(rejected(state, command, { by: 'ana' })).toBe('notPermitted');
    state = act(state, command, { by: 'eve' }).state;
    expect(state.makeUpTurns).toEqual([expect.objectContaining({ debtorId: 'ana', creditorId: 'ben' })]);
  });
});

describe('Skip Dates and Covers', () => {
  it('Skip Date removed after Covers happened: the Cover stays on its Event and the Rotation closes back around it', () => {
    let state = act(setup(), { type: 'addSkipDate', eventId: 'w2' }).state;
    expect(lineup(state).slice(0, 3)).toEqual(['w1 ana', 'w2 skipped', 'w3 ben']);
    state = declined(state, 'w3', 'ben').state;
    state = covered(state, 'w3', 'ben', 'dee').state;
    const result = act(state, { type: 'removeSkipDate', eventId: 'w2' });
    expect(lineup(result.state)).toEqual([
      'w1 ana', 'w2 ben', 'w3 dee', 'w4 cal', 'w5 ben', 'w6 ana', 'w7 cal', 'w8 dee',
    ]);
    expect(result.state.makeUpTurns[0]).toMatchObject({ debtorId: 'ben', creditorId: 'dee', status: 'outstanding' });
  });

  it('Skip Date on a covered Event: the Cover is cancelled with its Make-up Turn', () => {
    let state = declined(setup(), 'w1', 'ana').state;
    state = covered(state, 'w1', 'ana', 'cal').state;
    state = act(state, { type: 'addSkipDate', eventId: 'w1' }).state;
    expect(state.makeUpTurns[0]).toMatchObject({ status: 'cancelled' });
    expect(lineup(state).slice(0, 3)).toEqual(['w1 skipped', 'w2 ana', 'w3 ben']);
  });
});
