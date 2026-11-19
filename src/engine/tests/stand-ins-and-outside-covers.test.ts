/**
 * Simplify ticket 04: no Admins, Stand-ins (Placeholder Members acted for by anyone), outside
 * covers (a typed name), and naming the cover straight away when you can't make it.
 */
import { describe, expect, it } from 'vitest';

import type { GroupState } from '../index';
import { act, assignmentOf, CREW, lineup, rejected, setup } from './scenario';

/** ana..dee on the app, plus Pat, a Stand-in, at the end of the Sound queue. */
function withStandIn(): GroupState {
  return act(setup(), { type: 'addMember', member: { id: 'pat', name: 'Pat' }, qualifiedFor: ['sound'] }, { by: 'ben' }).state;
}

describe('Stand-ins', () => {
  it('are in the Rotation like anyone', () => {
    expect(lineup(withStandIn()).slice(0, 6)).toEqual(['w1 ana', 'w2 ben', 'w3 cal', 'w4 dee', 'w5 pat', 'w6 ana']);
  });

  it('any Member says a Stand-in can’t make it; the request is the Stand-in’s, and anyone may take it back for them', () => {
    let state = withStandIn();
    const seat = assignmentOf(state, 'w5', 'pat');
    state = act(state, { type: 'decline', assignmentId: seat.id }, { by: 'cal' }).state;
    expect(state.assignments.find((a) => a.id === seat.id)?.coverageRequest).toMatchObject({ requestedBy: 'pat', cover: null });
    state = act(state, { type: 'withdrawDecline', assignmentId: seat.id }, { by: 'dee' }).state;
    expect(lineup(state)[4]).toBe('w5 pat');
  });

  it('a covered Stand-in owes the swap like anyone', () => {
    let state = withStandIn();
    const seat = assignmentOf(state, 'w5', 'pat');
    state = act(state, { type: 'decline', assignmentId: seat.id }, { by: 'cal' }).state;
    state = act(state, { type: 'cover', assignmentId: seat.id }, { by: 'ben' }).state;
    expect(state.makeUpTurns).toEqual([expect.objectContaining({ debtorId: 'pat', creditorId: 'ben', status: 'outstanding' })]);
  });

  it('Members can’t say another app user can’t make it, or take it back for them', () => {
    let state = withStandIn();
    const seat = assignmentOf(state, 'w2', 'ben');
    expect(rejected(state, { type: 'decline', assignmentId: seat.id }, { by: 'ana' })).toBe('notPermitted');
    state = act(state, { type: 'decline', assignmentId: seat.id }, { by: 'ben' }).state;
    expect(rejected(state, { type: 'withdrawDecline', assignmentId: seat.id }, { by: 'ana' })).toBe('notPermitted');
  });

  it('claiming keeps the Stand-in’s place', () => {
    const before = withStandIn();
    const after = act(before, { type: 'claimPlaceholder', memberId: 'pat', accountId: 'acct-pat' }, { by: 'pat' }).state;
    expect(lineup(after)).toEqual(lineup(before));
  });
});

describe('Naming the cover when you can’t make it', () => {
  it('a Member cover is set in one step, as a swap: the asker takes the coverer’s next turn', () => {
    const state = setup();
    const seat = assignmentOf(state, 'w1', 'ana');
    const result = act(state, { type: 'decline', assignmentId: seat.id, coveredBy: { memberId: 'cal' } }, { by: 'ana' });
    expect(result.history).toHaveLength(1);
    expect(result.state.assignments.find((a) => a.id === seat.id)).toMatchObject({
      memberId: 'cal',
      coverageRequest: { reason: 'declined', requestedBy: 'ana', cover: { kind: 'member', memberId: 'cal', arrangedBy: 'ana' } },
    });
    // Cal covers week 1, so Ana takes Cal's turn (week 3); Cal rests rather than serve back-to-back.
    expect(lineup(result.state).slice(0, 4)).toEqual(['w1 cal', 'w2 ben', 'w3 ana', 'w4 dee']);
  });

  it('“Pick someone to do it”: any Member may give anyone’s turn to someone, which is still a swap', () => {
    const state = setup();
    const seat = assignmentOf(state, 'w2', 'ben');
    const next = act(state, { type: 'decline', assignmentId: seat.id, coveredBy: { memberId: 'dee' } }, { by: 'ana' }).state;
    expect(next.makeUpTurns).toEqual([expect.objectContaining({ debtorId: 'ben', creditorId: 'dee' })]);
  });

  it('an outside cover holds the seat by name only: no Member, no swap, no turn counted', () => {
    const state = setup();
    const seat = assignmentOf(state, 'w1', 'ana');
    const next = act(state, { type: 'decline', assignmentId: seat.id, coveredBy: { guestName: '  Jo ' } }, { by: 'ana' }).state;
    expect(next.assignments.find((a) => a.id === seat.id)).toMatchObject({
      memberId: null,
      coverageRequest: { requestedBy: 'ana', cover: { kind: 'guest', guestName: 'Jo', arrangedBy: 'ana' } },
    });
    expect(next.makeUpTurns).toEqual([]);
    expect(next.members.map((m) => m.id)).toEqual(CREW);
    expect(lineup(next)[0]).toBe('w1 guest:Jo');
  });

  it('rejects a bad cover', () => {
    const state = setup();
    const seat = assignmentOf(state, 'w1', 'ana');
    const decline = (coveredBy: { memberId: string } | { guestName: string }) =>
      rejected(state, { type: 'decline', assignmentId: seat.id, coveredBy }, { by: 'ana' });
    expect(decline({ memberId: 'ana' })).toBe('invalid');
    expect(decline({ memberId: 'nobody' })).toBe('notFound');
    expect(decline({ guestName: '   ' })).toBe('invalid');
    expect(decline({ guestName: 'x'.repeat(81) })).toBe('invalid');
    const open = act(state, { type: 'decline', assignmentId: seat.id }, { by: 'ana' }).state;
    expect(rejected(open, { type: 'decline', assignmentId: seat.id, coveredBy: { memberId: 'ben' } }, { by: 'ana' })).toBe(
      'alreadyNeedsCoverage',
    );
  });

  it('any Member may cover an open request with someone (“mark covered”), whatever Replacement Duty says', () => {
    let state = setup({ settings: { replacementDuty: 'admins' } });
    const seat = assignmentOf(state, 'w1', 'ana');
    state = act(state, { type: 'decline', assignmentId: seat.id }, { by: 'ana' }).state;
    state = act(state, { type: 'markCovered', assignmentId: seat.id, by: { guestName: 'Lee' } }, { by: 'dee' }).state;
    expect(lineup(state)[0]).toBe('w1 guest:Lee');
  });
});
