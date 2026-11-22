/**
 * Feedback-2 ticket 05, part B: "This is someone in the group". A Stand-in turns out to be a
 * Member who joined on their own, and `mergeStandIn` hands everything the Stand-in had from
 * now on to the real Member (docs/adr/0008-merging-a-stand-in.md).
 */
import { describe, expect, it } from 'vitest';

import type { GroupState } from '../index';
import { act, afterWeek, assignmentOf, lineup, rejected, setup, timeOff } from './scenario';

const MERGE = { type: 'mergeStandIn', standInId: 'pat', intoMemberId: 'ruth' } as const;

/** Ana, Ben and Ruth on the app; Pat is a Stand-in for Ruth. Sound turns go in `order`. */
function group(order: string[], jobs: string[] = ['sound']): GroupState {
  let state = setup({
    members: ['ana', 'ben', 'ruth'],
    responsibilities: jobs.map((id) => ({ id, qualified: ['ana', 'ben', 'ruth'] })),
  });
  state = act(state, { type: 'addMember', member: { id: 'pat', name: 'Pat' }, qualifiedFor: jobs }, { by: 'ana' }).state;
  return act(state, { type: 'reorderQueue', responsibilityId: 'sound', queue: order }, { by: 'ana' }).state;
}

/** Each week's people across every job, e.g. "w1 ana,ben". */
function seatsByWeek(state: GroupState): string[] {
  return [...state.events]
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .map((e) => {
      const people = state.assignments.filter((a) => a.eventId === e.id && a.memberId !== null).map((a) => a.memberId);
      return `${e.id} ${people.join(',')}`;
    });
}

describe('Merging a Stand-in into a real Member', () => {
  it('moves the Stand-in’s future turns: the real Member takes the earlier queue place, the other place goes', () => {
    const before = group(['ana', 'pat', 'ben', 'ruth']);
    expect(lineup(before).slice(0, 4)).toEqual(['w1 ana', 'w2 pat', 'w3 ben', 'w4 ruth']);
    const after = act(before, MERGE, { by: 'ben' }).state;
    expect(after.rotations.find((r) => r.responsibilityId === 'sound')?.queue).toEqual(['ana', 'ruth', 'ben']);
    expect(lineup(after).slice(0, 6)).toEqual(['w1 ana', 'w2 ruth', 'w3 ben', 'w4 ana', 'w5 ruth', 'w6 ben']);
    expect(after.assignments.some((a) => a.memberId === 'pat' || a.turnOf === 'pat')).toBe(false);
  });

  it('keeps the past: history still shows the Stand-in, who leaves with the real Member’s account', () => {
    let state = group(['ana', 'pat', 'ben', 'ruth']);
    state = act(state, MERGE, { by: 'ana', at: afterWeek(2) }).state;
    expect(lineup(state).slice(0, 2)).toEqual(['w1 ana', 'w2 pat']);
    expect(state.members.find((m) => m.id === 'pat')).toMatchObject({ leftAt: afterWeek(2), accountId: 'acct-ruth' });
    expect(state.rotations.every((r) => !r.queue.includes('pat'))).toBe(true);
  });

  it('no back-to-back: the real Member rests after the Stand-in’s last turn', () => {
    // Pat had week 2. Ruth is then first in line, but rests at week 3.
    let state = group(['ana', 'pat', 'ruth', 'ben']);
    state = act(state, MERGE, { by: 'ana', at: afterWeek(2) }).state;
    const line = lineup(state);
    expect(line[1]).toBe('w2 pat');
    expect(line[2]).toBe('w3 ben');
    expect(line[3]).toBe('w4 ruth');
  });

  it('no double booking: when both had a turn on the same date, normal rotation reseats one', () => {
    let state = group(['ana', 'ben', 'ruth', 'pat'], ['sound', 'door']);
    state = act(state, { type: 'reorderQueue', responsibilityId: 'door', queue: ['ben', 'ana', 'pat', 'ruth'] }, { by: 'ana' }).state;
    expect(assignmentOf(state, 'w3', 'ruth', 'sound')).toBeTruthy();
    expect(assignmentOf(state, 'w3', 'pat', 'door')).toBeTruthy();

    const after = act(state, MERGE, { by: 'ana' }).state;
    for (const week of seatsByWeek(after)) {
      const people = week.split(' ')[1].split(',');
      expect(new Set(people).size, week).toBe(people.length);
    }
    expect(assignmentOf(after, 'w3', 'ruth', 'sound')).toBeTruthy();
    expect(after.assignments.find((a) => a.eventId === 'w3' && a.responsibilityId === 'door')?.memberId).not.toBe('ruth');
  });

  it('carries over covers given, open requests, swaps owed and dates off', () => {
    let state = group(['ana', 'ben', 'ruth', 'pat']);
    // Pat covers Ben's week 2 (Ben owes Pat a swap), and can't make their next own turn.
    const benSeat = assignmentOf(state, 'w2', 'ben');
    state = act(state, { type: 'decline', assignmentId: benSeat.id, coveredBy: { memberId: 'pat' } }, { by: 'ben' }).state;
    const patSeat = state.assignments.find((a) => a.memberId === 'pat' && a.coverageRequest === null)!;
    state = act(state, { type: 'decline', assignmentId: patSeat.id }, { by: 'ana' }).state;
    state = act(state, { type: 'addTimeOff', timeOff: timeOff('off1', 'pat', 7) }, { by: 'ana' }).state;

    const after = act(state, MERGE, { by: 'ana' }).state;
    expect(after.assignments.find((a) => a.id === benSeat.id)).toMatchObject({
      memberId: 'ruth',
      coverageRequest: { requestedBy: 'ben', cover: { kind: 'member', memberId: 'ruth' } },
    });
    expect(after.assignments.find((a) => a.id === patSeat.id)).toMatchObject({
      memberId: 'ruth',
      coverageRequest: { requestedBy: 'ruth', cover: null },
    });
    expect(after.makeUpTurns.filter((t) => t.status === 'outstanding')).toEqual([
      expect.objectContaining({ debtorId: 'ben', creditorId: 'ruth' }),
    ]);
    expect(after.timeOff.find((t) => t.id === 'off1')?.memberId).toBe('ruth');
    expect(lineup(after)[6]).not.toBe('w7 ruth');
  });

  it('a cover between the two is undone: the real Member’s turn needs cover again', () => {
    let state = group(['ana', 'ben', 'ruth', 'pat']);
    const ruthSeat = assignmentOf(state, 'w3', 'ruth');
    state = act(state, { type: 'decline', assignmentId: ruthSeat.id, coveredBy: { memberId: 'pat' } }, { by: 'ruth' }).state;
    const after = act(state, MERGE, { by: 'ruth' }).state;
    expect(after.assignments.find((a) => a.id === ruthSeat.id)).toMatchObject({
      memberId: 'ruth',
      coverageRequest: { requestedBy: 'ruth', cover: null },
    });
    expect(after.makeUpTurns.every((t) => t.status !== 'outstanding')).toBe(true);
  });

  it('a moved cover on the real Member’s dates off is withdrawn', () => {
    let state = group(['ana', 'ben', 'ruth', 'pat']);
    const anaSeat = assignmentOf(state, 'w5', 'ana');
    state = act(state, { type: 'decline', assignmentId: anaSeat.id, coveredBy: { memberId: 'pat' } }, { by: 'ana' }).state;
    state = act(state, { type: 'addTimeOff', timeOff: timeOff('off2', 'ruth', 5) }, { by: 'ruth' }).state;
    const after = act(state, MERGE, { by: 'ana' }).state;
    expect(after.assignments.find((a) => a.id === anaSeat.id)?.coverageRequest).toMatchObject({ requestedBy: 'ana', cover: null });
  });

  it('is refused for anyone but a Stand-in, into someone on the app', () => {
    const state = act(group(['ana', 'ben', 'ruth', 'pat']), { type: 'addMember', member: { id: 'sue', name: 'Sue' } }, { by: 'ana' }).state;
    expect(rejected(state, { type: 'mergeStandIn', standInId: 'ben', intoMemberId: 'ruth' }, { by: 'ana' })).toBe('notFound');
    expect(rejected(state, { type: 'mergeStandIn', standInId: 'pat', intoMemberId: 'sue' }, { by: 'ana' })).toBe('invalid');
    expect(rejected(state, { type: 'mergeStandIn', standInId: 'pat', intoMemberId: 'pat' }, { by: 'ana' })).toBe('invalid');
    expect(rejected(state, MERGE, { by: 'zed' })).toBe('notPermitted');
  });
});
