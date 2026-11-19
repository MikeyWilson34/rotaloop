import { describe, expect, it } from 'vitest';

import type { GroupState, NewEvent } from '../index';
import { act, afterWeek, assignmentOf, lineup, setup, sundays, timeOff, week } from './scenario';

/**
 * Rotation rules (ADR 0005): a Cover is a swap, no back-to-back turns when avoidable,
 * and no one is booked twice on one day.
 */

const TRIO = ['jordan', 'sam', 'tom'];

function weekly(members: string[], weeks: number): GroupState {
  return setup({ members, responsibilities: [{ id: 'job', qualified: members }], events: sundays(weeks) });
}

function covered(state: GroupState, eventId: string, decliner: string, coverer: string, job = 'job'): GroupState {
  const assignmentId = assignmentOf(state, eventId, decliner, job).id;
  const next = act(state, { type: 'decline', assignmentId }, { by: decliner }).state;
  return act(next, { type: 'cover', assignmentId }, { by: coverer }).state;
}

/** Who holds each date of one job, in order ("w3 sam" -> "sam"). */
function holders(state: GroupState, job = 'job'): string[] {
  return lineup(state, job).map((line) => line.split(' ')[1]);
}

function backToBack(state: GroupState, job = 'job'): string[] {
  const people = holders(state, job);
  return people.filter((p, i) => i > 0 && p === people[i - 1]);
}

/** Greeter at 9:00 and Teach at 11:00 every Sunday: two Jobs on the same day. */
function twoJobs(greeters: string[], teachers: string[], weeks = 6): GroupState {
  const events: NewEvent[] = Array.from({ length: weeks }, (_, i) => [
    { id: `g${i + 1}`, seriesId: 'greet', startsAt: week(i + 1) },
    { id: `t${i + 1}`, seriesId: 'teach', startsAt: new Date(Date.parse(week(i + 1)) + 2 * 3600e3).toISOString() },
  ]).flat();
  return setup({
    members: ['a', 'b', 'c'],
    responsibilities: [
      { id: 'greeter', qualified: greeters },
      { id: 'teach', qualified: teachers },
    ],
    series: [
      { id: 'greet', responsibilityIds: ['greeter'] },
      { id: 'teach', responsibilityIds: ['teach'] },
    ],
    events,
  });
}

function doubleBooked(state: GroupState): string[] {
  const greeters = holders(state, 'greeter');
  return holders(state, 'teach').filter((p, i) => p === greeters[i]);
}

describe('Rotation rules', () => {
  it('Cover is a swap and no one serves back-to-back: Tom covers Sam on week 2', () => {
    const state = covered(weekly(TRIO, 12), 'w2', 'sam', 'tom');
    // Matches the approved prototype (design/prototype/simple.html, fillJob).
    expect(holders(state)).toEqual([
      'jordan', 'tom', 'sam', 'jordan', 'sam', 'tom', 'jordan', 'sam', 'tom', 'jordan', 'sam', 'tom',
    ]);
    expect(assignmentOf(state, 'w3', 'sam', 'job')).toMatchObject({ turnOf: 'tom', makeUpTurnId: expect.any(String) });
    expect(backToBack(state)).toEqual([]);
  });

  it("The swap lapses when the person who owes it is on Dates off at the coverer's next turn", () => {
    let state = covered(weekly(TRIO, 8), 'w2', 'sam', 'tom');
    state = act(state, { type: 'addTimeOff', timeOff: timeOff('t1', 'sam', 3) }, { by: 'sam' }).state;
    // Tom just covered w2, so he rests at w3 and Jordan steps in; Sam owes nothing after that.
    expect(holders(state)).toEqual(['jordan', 'tom', 'jordan', 'tom', 'sam', 'tom', 'jordan', 'sam']);
    expect(backToBack(state)).toEqual([]);
    const later = act(state, { type: 'fillSchedule' }, { at: afterWeek(3) });
    expect(later.state.makeUpTurns[0]).toMatchObject({ status: 'cancelled', closedReason: 'lapsed' });
    expect(holders(later.state)).toEqual(holders(state));
  });

  it('Back-to-back only when no one else can serve: a 2-person group with one on Dates off', () => {
    let state = weekly(['ana', 'ben'], 4);
    state = act(state, { type: 'addTimeOff', timeOff: timeOff('t1', 'ben', 2) }, { by: 'ben' }).state;
    expect(holders(state)).toEqual(['ana', 'ana', 'ben', 'ana']);
  });

  it('Back-to-back is avoided across the boundary with past dates', () => {
    let state = weekly(['ana', 'ben', 'cal'], 6);
    state = act(state, { type: 'addTimeOff', timeOff: timeOff('t1', 'ana', 1) }, { by: 'ana' }).state;
    const later = act(state, { type: 'fillSchedule' }, { at: afterWeek(2) });
    expect(backToBack(later.state)).toEqual([]);
  });

  it('Two jobs on the same Sunday: no one holds both', () => {
    const state = twoJobs(['a', 'b', 'c'], ['a', 'b', 'c']);
    expect(doubleBooked(state)).toEqual([]);
    expect(backToBack(state, 'greeter')).toEqual([]);
    expect(backToBack(state, 'teach')).toEqual([]);
  });

  it('Dates off that would route someone into a double booking pick the next free person', () => {
    let state = twoJobs(['a', 'b', 'c'], ['b', 'a', 'c']);
    expect(lineup(state, 'greeter')[0]).toBe('g1 a');
    expect(lineup(state, 'teach')[0]).toBe('t1 b');
    state = act(state, { type: 'addTimeOff', timeOff: timeOff('t1', 'b', 1) }, { by: 'b' }).state;
    // a is next in line for Teach but is greeting that morning, so c teaches.
    expect(lineup(state, 'teach')[0]).toBe('t1 c');
    expect(doubleBooked(state)).toEqual([]);
  });

  it('A swap is never placed into a double booking: it waits for a later turn', () => {
    const state = covered(twoJobs(['a', 'b', 'c'], ['a', 'b', 'c']), 't3', 'b', 'c', 'teach');
    // c's next Teach turn is w5, but b is greeting that morning: c keeps it and b still owes c.
    expect(lineup(state, 'greeter')[4]).toBe('g5 b');
    expect(lineup(state, 'teach')[4]).toBe('t5 c');
    expect(state.makeUpTurns).toEqual([
      expect.objectContaining({ debtorId: 'b', creditorId: 'c', status: 'outstanding' }),
    ]);
    expect(doubleBooked(state)).toEqual([]);
  });

  it('A Cover booked later that day keeps the coverer off the earlier job', () => {
    const state = covered(twoJobs(['a', 'b', 'c'], ['a', 'b', 'c']), 't2', 'a', 'b', 'teach');
    expect(lineup(state, 'teach')[1]).toBe('t2 b');
    expect(lineup(state, 'greeter')[1]).not.toBe('g2 b');
    expect(doubleBooked(state)).toEqual([]);
  });
});
