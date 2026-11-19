/**
 * Simplify ticket 09: headcount Jobs. No Rotation and no seats; every Member is asked "Coming?"
 * before each date and their Yes / No is stored per date. No cover flow.
 */
import { describe, expect, it } from 'vitest';

import type { GroupState } from '../index';
import { act, afterWeek, CREW, lineup, NOW, rejected, setup } from './scenario';

/** Sound takes turns; Coffee is a headcount. Both every Sunday. */
function group(): GroupState {
  return setup({
    responsibilities: [
      { id: 'sound', qualified: CREW },
      { id: 'coffee', kind: 'headcount', qualified: CREW },
    ],
  });
}

const answer = (memberId: string, reply: 'yes' | 'no', eventId = 'w1') =>
  ({ type: 'answerHeadcount', eventId, responsibilityId: 'coffee', memberId, answer: reply }) as const;

describe('headcount Jobs', () => {
  it('get no Rotation and no seats; take-turns Jobs fill as before', () => {
    const state = group();
    expect(state.responsibilities.map((r) => [r.id, r.kind])).toEqual([
      ['sound', 'turns'],
      ['coffee', 'headcount'],
    ]);
    expect(state.rotations.find((r) => r.responsibilityId === 'coffee')?.queue).toEqual([]);
    expect(state.assignments.filter((a) => a.responsibilityId === 'coffee')).toEqual([]);
    expect(lineup(state).slice(0, 4)).toEqual(['w1 ana', 'w2 ben', 'w3 cal', 'w4 dee']);
  });

  it('new Members and new headcount Jobs stay out of any Rotation', () => {
    let state = group();
    state = act(state, { type: 'addMember', member: { id: 'eve', name: 'Eve' }, qualifiedFor: ['sound', 'coffee'] }, { by: 'ana' }).state;
    state = act(
      state,
      {
        type: 'addResponsibility',
        responsibility: { id: 'potluck', name: 'Potluck', kind: 'headcount', headcount: 1, requiresConfirmation: false },
        qualifiedMemberIds: CREW,
      },
      { by: 'ana' },
    ).state;
    expect(state.rotations.find((r) => r.responsibilityId === 'coffee')?.queue).toEqual([]);
    expect(state.rotations.find((r) => r.responsibilityId === 'potluck')?.queue).toEqual([]);
    expect(state.rotations.find((r) => r.responsibilityId === 'sound')?.queue).toContain('eve');
  });

  it('stores each Member’s answer per date, replacing it when they answer again, with no history entry', () => {
    let state = group();
    const first = act(state, answer('ben', 'yes'), { by: 'ben' });
    expect(first.history).toEqual([]);
    expect(first.changes).toEqual([]);
    state = first.state;
    state = act(state, answer('cal', 'no'), { by: 'cal' }).state;
    state = act(state, answer('ben', 'no'), { by: 'ben', at: '2026-12-02T00:00:00.000Z' }).state;
    // (Time never runs backwards in a Group: this one is recorded at Dec 2 too.)
    state = act(state, answer('ben', 'yes', 'w2'), { by: 'ben' }).state;
    expect(state.headcountAnswers).toEqual([
      { eventId: 'w1', responsibilityId: 'coffee', memberId: 'ben', answer: 'no', answeredBy: 'ben', answeredAt: '2026-12-02T00:00:00.000Z' },
      { eventId: 'w1', responsibilityId: 'coffee', memberId: 'cal', answer: 'no', answeredBy: 'cal', answeredAt: NOW },
      { eventId: 'w2', responsibilityId: 'coffee', memberId: 'ben', answer: 'yes', answeredBy: 'ben', answeredAt: '2026-12-02T00:00:00.000Z' },
    ]);
    // The schedule is untouched.
    expect(state.assignments).toEqual(group().assignments);
  });

  it('anyone answers for a Stand-in, but not for someone on the app', () => {
    let state = act(group(), { type: 'addMember', member: { id: 'pat', name: 'Pat' } }, { by: 'ana' }).state;
    state = act(state, answer('pat', 'yes'), { by: 'cal' }).state;
    expect(state.headcountAnswers).toEqual([expect.objectContaining({ memberId: 'pat', answer: 'yes', answeredBy: 'cal' })]);
    expect(rejected(state, answer('ben', 'yes'), { by: 'ana' })).toBe('notPermitted');
  });

  it('rejects dates that started, dates off, other Jobs and people who left', () => {
    const state = group();
    expect(rejected(state, answer('ana', 'yes'), { by: 'ana', at: afterWeek(1) })).toBe('eventHasPassed');
    expect(rejected(state, { ...answer('ana', 'yes'), responsibilityId: 'sound' }, { by: 'ana' })).toBe('notFound');
    expect(rejected(state, answer('ana', 'yes', 'nope'), { by: 'ana' })).toBe('notFound');
    const off = act(state, { type: 'addSkipDate', eventId: 'w1' }, { by: 'ana' }).state;
    expect(rejected(off, answer('ana', 'yes'), { by: 'ana' })).toBe('invalid');
    const left = act(state, { type: 'removeMember', memberId: 'dee' }, { by: 'dee' }).state;
    expect(rejected(left, answer('dee', 'yes'))).toBe('notFound');
  });

  it('a removed date takes its answers with it', () => {
    let state = setup({
      responsibilities: [{ id: 'coffee', kind: 'headcount', qualified: CREW }],
      series: [{ id: 'sundays', responsibilityIds: ['coffee'] }],
      events: [{ id: 'once', seriesId: null, startsAt: '2027-01-03T09:00:00.000Z', responsibilityIds: ['coffee'] }],
    });
    state = act(state, answer('ana', 'yes', 'once'), { by: 'ana' }).state;
    state = act(state, { type: 'removeEvent', eventId: 'once' }, { by: 'ana' }).state;
    expect(state.headcountAnswers).toEqual([]);
  });

  it('switching a Job to a headcount drops its future turns; switching back has everyone take turns', () => {
    let state = group();
    state = act(state, { type: 'editResponsibility', responsibilityId: 'sound', changes: { kind: 'headcount' } }, { by: 'ana' }).state;
    expect(state.assignments).toEqual([]);
    expect(state.rotations.find((r) => r.responsibilityId === 'sound')?.queue).toEqual([]);
    state = act(state, { type: 'editResponsibility', responsibilityId: 'coffee', changes: { kind: 'turns' } }, { by: 'ana' }).state;
    expect(lineup(state, 'coffee').slice(0, 4)).toEqual(['w1 ana', 'w2 ben', 'w3 cal', 'w4 dee']);
  });
});
