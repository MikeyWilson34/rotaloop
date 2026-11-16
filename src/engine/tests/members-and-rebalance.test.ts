import { describe, expect, it } from 'vitest';

import type { GroupState } from '../index';
import { workload } from '../index';
import { act, afterWeek, assignmentOf, lineup, moves, rejected, setup } from './scenario';

function declineAndCover(state: GroupState, eventId: string, decliner: string, coverer: string, at?: string) {
  const assignmentId = assignmentOf(state, eventId, decliner).id;
  const next = act(state, { type: 'decline', assignmentId }, { by: decliner, at }).state;
  return act(next, { type: 'cover', assignmentId }, { by: coverer, at }).state;
}

describe('Rebalance', () => {
  it('Rebalance after Covers: the queue is reordered by served plus covered, fewest first, and Make-up Turns are settled', () => {
    let state = setup({ admins: ['ben'] });
    state = declineAndCover(state, 'w1', 'ana', 'cal');
    expect(lineup(state)[2]).toBe('w3 ana'); // ana's Make-up Turn
    const result = act(state, { type: 'rebalance', responsibilityId: 'sound' }, { by: 'ben', at: afterWeek(2) });
    expect(workload(result.state, 'sound', afterWeek(2))).toEqual([
      { memberId: 'dee', served: 0, covered: 0, upcoming: 2 },
      { memberId: 'ana', served: 0, covered: 0, upcoming: 2 },
      { memberId: 'cal', served: 0, covered: 1, upcoming: 1 },
      { memberId: 'ben', served: 1, covered: 0, upcoming: 1 },
    ]);
    expect(lineup(result.state)).toEqual([
      'w1 cal', 'w2 ben', 'w3 dee', 'w4 ana', 'w5 cal', 'w6 ben', 'w7 dee', 'w8 ana',
    ]);
    expect(result.state.makeUpTurns[0]).toMatchObject({ status: 'settled', closedReason: 'rebalance' });
  });

  it('Rebalance: equal workloads keep the current Rotation order, so nothing changes', () => {
    const state = setup({ admins: ['ana'] });
    const result = act(state, { type: 'rebalance', responsibilityId: 'sound' }, { by: 'ana' });
    expect(result.changes).toEqual([]);
  });

  it('Rebalance is for Admins only', () => {
    expect(rejected(setup(), { type: 'rebalance', responsibilityId: 'sound' }, { by: 'ana' })).toBe('notPermitted');
  });
});

describe('Members joining and leaving', () => {
  it('A newly Qualified Member joins the end of the queue', () => {
    const state = setup();
    const result = act(state, {
      type: 'addMember',
      member: { id: 'eve', name: 'Eve', accountId: 'acct-eve' },
      qualifiedFor: ['sound'],
    });
    expect(lineup(result.state)).toEqual([
      'w1 ana', 'w2 ben', 'w3 cal', 'w4 dee', 'w5 eve', 'w6 ana', 'w7 ben', 'w8 cal',
    ]);
  });

  it('A Member leaving: the Rotation closes up for their future Assignments and their history stays', () => {
    const state = setup({ admins: ['ana'] });
    const result = act(state, { type: 'removeMember', memberId: 'ben' }, { by: 'ana', at: afterWeek(2) });
    expect(lineup(result.state)).toEqual([
      'w1 ana', 'w2 ben', 'w3 cal', 'w4 dee', 'w5 ana', 'w6 cal', 'w7 dee', 'w8 ana',
    ]);
    expect(result.state.members.find((m) => m.id === 'ben')?.leftAt).toBe(afterWeek(2));
  });

  it('A Member leaving while owing and owed Make-up Turns: both are cancelled and their Cover reopens', () => {
    let state = setup();
    state = declineAndCover(state, 'w1', 'ana', 'cal'); // ana owes cal
    state = declineAndCover(state, 'w2', 'ben', 'ana'); // ben owes ana
    expect(state.makeUpTurns.map((t) => t.status)).toEqual(['outstanding', 'outstanding']);
    const result = act(state, { type: 'removeMember', memberId: 'ana' }, { by: 'ana' });
    expect(result.state.makeUpTurns.map((t) => [t.status, t.closedReason])).toEqual([
      ['cancelled', 'memberLeft'],
      ['cancelled', 'memberLeft'],
    ]);
    expect(lineup(result.state)).toEqual([
      'w1 cal', 'w2 ben (needs coverage)', 'w3 cal', 'w4 dee', 'w5 ben', 'w6 cal', 'w7 dee', 'w8 ben',
    ]);
  });

  it("A Member leaving with an open Coverage Request: the Rotation fills that seat", () => {
    let state = setup();
    state = act(state, { type: 'decline', assignmentId: assignmentOf(state, 'w2', 'ben').id }, { by: 'ben' }).state;
    const result = act(state, { type: 'removeMember', memberId: 'ben' }, { by: 'ben' });
    expect(lineup(result.state).slice(0, 4)).toEqual(['w1 ana', 'w2 cal', 'w3 dee', 'w4 ana']);
  });

  it('A Member who is no longer Qualified leaves that Rotation only', () => {
    const state = setup();
    const result = act(state, { type: 'unqualifyMember', memberId: 'dee', responsibilityId: 'sound' });
    expect(lineup(result.state).slice(0, 4)).toEqual(['w1 ana', 'w2 ben', 'w3 cal', 'w4 ana']);
  });

  it('Claiming a Placeholder Member keeps its identity, Assignments and history', () => {
    let state = setup();
    state = act(state, { type: 'addMember', member: { id: 'eve', name: 'Eve' }, qualifiedFor: ['sound'] }).state;
    expect(state.members.find((m) => m.id === 'eve')?.accountId).toBeNull();
    const result = act(state, { type: 'claimPlaceholder', memberId: 'eve', accountId: 'acct-eve' });
    expect(result.changes).toEqual([]);
    expect(result.state.assignments).toEqual(state.assignments);
    expect(result.state.members.find((m) => m.id === 'eve')?.accountId).toBe('acct-eve');
    expect(rejected(result.state, { type: 'claimPlaceholder', memberId: 'eve', accountId: 'x' })).toBe('invalid');
  });
});

describe('Change tracking', () => {
  it('Headcount > 1 with Time Off: only the absent Member and the routing partner change', () => {
    const state = setup({ responsibilities: [{ id: 'sound', headcount: 2, qualified: ['ana', 'ben', 'cal', 'dee'] }] });
    const result = act(state, {
      type: 'addTimeOff',
      timeOff: { id: 't1', memberId: 'ana', startsAt: '2027-01-03T00:00:00.000Z', endsAt: '2027-01-04T00:00:00.000Z' },
    });
    expect(lineup(result.state).slice(0, 3)).toEqual(['w1 ben+cal', 'w2 ana+dee', 'w3 ana+ben']);
    expect(moves(result)).toEqual(['ana@w1 -> ana@w2', 'cal@w2 -> cal@w1']);
  });

  it('Every change carries its reason, and the history entry says who caused it', () => {
    const state = setup();
    const result = act(state, { type: 'addSkipDate', eventId: 'w7' }, { by: 'dee' });
    expect(result.changes.every((c) => c.reason.type === 'addSkipDate')).toBe(true);
    expect(result.history.at(-1)).toMatchObject({ actorId: 'dee', at: expect.any(String) });
    expect(result.history.at(-1)?.changes).toEqual(result.changes);
  });

  it('Moved Assignments only ask for confirmation when their Responsibility requires it', () => {
    const state = setup();
    const result = act(state, { type: 'addSkipDate', eventId: 'w1' });
    expect(result.changes.every((c) => c.after === null || c.after.confirmation === 'notRequired')).toBe(true);
  });

  it('A rejected command reports why and changes nothing', () => {
    const state = setup();
    expect(rejected(state, { type: 'decline', assignmentId: 'nope' })).toBe('notFound');
    const assignmentId = assignmentOf(state, 'w1', 'ana').id;
    expect(rejected(state, { type: 'decline', assignmentId }, { by: 'ben' })).toBe('notPermitted');
    expect(rejected(state, { type: 'cover', assignmentId }, { by: 'ben' })).toBe('noCoverageRequest');
  });
});
