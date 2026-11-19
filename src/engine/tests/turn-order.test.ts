import { describe, expect, it } from 'vitest';

import type { GroupState } from '../index';
import { act, afterWeek, assignmentOf, lineup, setup, timeOff } from './scenario';

/**
 * Turn order in group settings (feedback-2 ticket 02): putting a Rotation's queue in a new
 * order by hand reseats every future, not-yet-happened turn to follow it, from the job's next
 * date. Past turns, Covers already arranged and dates off stay as they were, and the
 * no-back-to-back rule (ADR 0005) still holds.
 */

const CREW = ['ana', 'ben', 'cal', 'dee'];
const reorder = (queue: string[]) => ({ type: 'reorderQueue' as const, responsibilityId: 'sound', queue });

function holders(state: GroupState): string[] {
  return lineup(state).map((line) => line.split(' ')[1]);
}

function backToBack(state: GroupState): string[] {
  const people = holders(state).filter((p) => p !== 'skipped');
  return people.filter((p, i) => i > 0 && p === people[i - 1]);
}

function covered(state: GroupState, eventId: string, decliner: string, coverer: string): GroupState {
  const assignmentId = assignmentOf(state, eventId, decliner).id;
  const next = act(state, { type: 'decline', assignmentId }, { by: decliner }).state;
  return act(next, { type: 'cover', assignmentId }, { by: coverer }).state;
}

describe('Turn order: reordering reseats future turns only', () => {
  it('With nothing past, the first person in the new order gets the next date and it cycles', () => {
    const state = setup({ members: CREW });
    expect(holders(state)).toEqual(['ana', 'ben', 'cal', 'dee', 'ana', 'ben', 'cal', 'dee']);
    const result = act(state, reorder(['dee', 'ana', 'ben', 'cal']), { by: 'ana' });
    expect(lineup(result.state)).toEqual([
      'w1 dee', 'w2 ana', 'w3 ben', 'w4 cal', 'w5 dee', 'w6 ana', 'w7 ben', 'w8 cal',
    ]);
  });

  it('Past turns are kept; the new order starts at the next date after now', () => {
    const state = setup({ members: CREW });
    const later = afterWeek(2); // w1 (ana) and w2 (ben) have happened
    const result = act(state, reorder(['cal', 'dee', 'ana', 'ben']), { by: 'ana', at: later });
    expect(lineup(result.state)).toEqual([
      'w1 ana', 'w2 ben', 'w3 cal', 'w4 dee', 'w5 ana', 'w6 ben', 'w7 cal', 'w8 dee',
    ]);
    const reversed = act(state, reorder(['dee', 'cal', 'ana', 'ben']), { by: 'ana', at: later });
    expect(lineup(reversed.state)).toEqual([
      'w1 ana', 'w2 ben', 'w3 dee', 'w4 cal', 'w5 ana', 'w6 ben', 'w7 dee', 'w8 cal',
    ]);
    // No past turn changed.
    expect(reversed.changes.every((c) => !['w1', 'w2'].includes(c.before?.eventId ?? c.after!.eventId))).toBe(true);
  });

  it('A Cover already arranged stays put', () => {
    let state = setup({ members: CREW });
    state = covered(state, 'w3', 'cal', 'ben');
    const before = state.assignments.find((a) => a.eventId === 'w3')!;
    const result = act(state, reorder(['dee', 'cal', 'ben', 'ana']), { by: 'ana' });
    const after = result.state.assignments.find((a) => a.eventId === 'w3')!;
    expect(after).toEqual(before);
    expect(after.memberId).toBe('ben');
    expect(holders(result.state)[2]).toBe('ben');
  });

  it('Dates off stay off and the order moves along past them', () => {
    let state = setup({ members: CREW });
    state = act(state, { type: 'addSkipDate', eventId: 'w2', reason: null }, { by: 'ana' }).state;
    const result = act(state, reorder(['dee', 'cal', 'ben', 'ana']), { by: 'ana' });
    expect(lineup(result.state)).toEqual([
      'w1 dee', 'w2 skipped', 'w3 cal', 'w4 ben', 'w5 ana', 'w6 dee', 'w7 cal', 'w8 ben',
    ]);
  });

  it("Someone's own dates off are respected after a reorder", () => {
    let state = setup({ members: CREW });
    state = act(state, { type: 'addTimeOff', timeOff: timeOff('t1', 'dee', 1) }).state;
    const result = act(state, reorder(['dee', 'cal', 'ben', 'ana']), { by: 'ana' });
    expect(holders(result.state)[0]).not.toBe('dee');
    expect(holders(result.state)).toContain('dee');
  });

  it('No back-to-back: whoever had the last past date rests even when moved to the top', () => {
    const state = setup({ members: CREW });
    const later = afterWeek(2); // ben had w2
    const result = act(state, reorder(['ben', 'cal', 'dee', 'ana']), { by: 'ana', at: later });
    expect(holders(result.state).slice(0, 2)).toEqual(['ana', 'ben']);
    expect(holders(result.state)[2]).not.toBe('ben');
    expect(backToBack(result.state)).toEqual([]);
  });

  it('A Stand-in is moved like anyone else', () => {
    let state = setup({ members: ['ana', 'ben'] });
    state = act(state, { type: 'addMember', member: { id: 'tom', name: 'Tom', accountId: null }, qualifiedFor: ['sound'] }, { by: 'ana' }).state;
    const queue = state.rotations[0].queue;
    expect(queue).toContain('tom');
    const result = act(state, reorder(['tom', ...queue.filter((m) => m !== 'tom')]), { by: 'ben' });
    expect(holders(result.state)[0]).toBe('tom');
    expect(backToBack(result.state)).toEqual([]);
  });
});
