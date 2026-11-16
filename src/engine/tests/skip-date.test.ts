import { describe, expect, it } from 'vitest';

import { act, afterWeek, assignmentOf, lineup, moves, rejected, setup, sundays, timeOff } from './scenario';

describe('Skip Date', () => {
  it('Skip Date: everyone from the skipped Event onward moves forward one Event', () => {
    const state = setup();
    const result = act(state, { type: 'addSkipDate', eventId: 'w3' }, { by: 'ben' });
    expect(lineup(result.state)).toEqual([
      'w1 ana', 'w2 ben', 'w3 skipped', 'w4 cal', 'w5 dee', 'w6 ana', 'w7 ben', 'w8 cal',
    ]);
    expect(moves(result)).toEqual([
      'ana@w5 -> ana@w6',
      'ben@w6 -> ben@w7',
      'cal@w3 -> cal@w4',
      'cal@w7 -> cal@w8',
      'dee@w4 -> dee@w5',
      'dee@w8 -> none',
    ]);
    expect(result.history).toHaveLength(1);
    expect(result.history[0]).toMatchObject({ actorId: 'ben', cause: { type: 'addSkipDate', eventId: 'w3' } });
  });

  it('Skip Date: no turn is used up, so the next Event goes to the Member whose turn was pushed out', () => {
    let state = setup();
    state = act(state, { type: 'addSkipDate', eventId: 'w3' }).state;
    state = act(state, { type: 'addEvents', events: sundays(9).slice(8) }).state;
    expect(lineup(state).at(-1)).toBe('w9 dee');
  });

  it('Removing a Skip Date restores the Rotation, with the same Assignments', () => {
    const original = setup();
    const skipped = act(original, { type: 'addSkipDate', eventId: 'w3' }).state;
    const restored = act(skipped, { type: 'removeSkipDate', eventId: 'w3' });
    expect(lineup(restored.state)).toEqual(lineup(original));
    const ids = (s: typeof original) => s.assignments.filter((a) => a.memberId === 'cal').map((a) => a.id);
    expect(ids(restored.state)).toEqual(ids(original));
  });

  it('Skip Date: moved Assignments ask for confirmation again; untouched ones keep their confirmation', () => {
    let state = setup({ responsibilities: [{ id: 'sound', qualified: ['ana', 'ben', 'cal', 'dee'], requiresConfirmation: true }] });
    state = act(state, { type: 'confirm', assignmentId: assignmentOf(state, 'w1', 'ana').id }, { by: 'ana' }).state;
    state = act(state, { type: 'confirm', assignmentId: assignmentOf(state, 'w2', 'ben').id }, { by: 'ben' }).state;
    state = act(state, { type: 'addSkipDate', eventId: 'w2' }).state;
    expect(assignmentOf(state, 'w1', 'ana').confirmation).toBe('confirmed');
    expect(assignmentOf(state, 'w3', 'ben').confirmation).toBe('requested');
  });

  it('Skip Date: every Rotation moves forward, each in its own Responsibility', () => {
    const state = setup({
      members: ['ana', 'ben', 'cal', 'dee'],
      responsibilities: [
        { id: 'sound', qualified: ['ana', 'ben'] },
        { id: 'greeter', qualified: ['cal', 'dee'] },
      ],
      events: sundays(4),
    });
    const next = act(state, { type: 'addSkipDate', eventId: 'w1' }).state;
    expect(lineup(next, 'sound')).toEqual(['w1 skipped', 'w2 ana', 'w3 ben', 'w4 ana']);
    expect(lineup(next, 'greeter')).toEqual(['w1 skipped', 'w2 cal', 'w3 dee', 'w4 cal']);
  });

  it('Skip Date plus Time Off: the shifted turn is routed around Time Off on its new date', () => {
    let state = setup();
    state = act(state, { type: 'addTimeOff', timeOff: timeOff('t1', 'ben', 3) }, { by: 'ben' }).state;
    expect(lineup(state)).toEqual(lineup(setup())); // ben serves w2, so nothing changes yet
    const result = act(state, { type: 'addSkipDate', eventId: 'w1' });
    expect(lineup(result.state)).toEqual([
      'w1 skipped', 'w2 ana', 'w3 cal', 'w4 ben', 'w5 dee', 'w6 ana', 'w7 ben', 'w8 cal',
    ]);
  });

  it('Skip Date: is a pure preview until the caller saves the new state', () => {
    const state = setup();
    const snapshot = JSON.stringify(state);
    act(state, { type: 'addSkipDate', eventId: 'w3' });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('Skip Date: an Event that has started cannot be skipped', () => {
    const state = setup();
    expect(rejected(state, { type: 'addSkipDate', eventId: 'w1' }, { at: afterWeek(1) })).toBe('eventHasPassed');
  });
});

describe('Skip Date reason', () => {
  it('stores the reason with the Skip Date and in the history cause', () => {
    const state = setup();
    const result = act(state, { type: 'addSkipDate', eventId: 'w3', reason: 'Holiday: Building closed' }, { by: 'ben' });
    const event = result.state.events.find((e) => e.id === 'w3');
    expect(event?.skipDate).toEqual({ markedBy: 'ben', markedAt: expect.any(String), reason: 'Holiday: Building closed' });
    expect(result.history[0].cause).toEqual({ type: 'addSkipDate', eventId: 'w3', reason: 'Holiday: Building closed' });
  });

  it('a Skip Date without a reason has a null reason', () => {
    const result = act(setup(), { type: 'addSkipDate', eventId: 'w3' }, { by: 'ben' });
    expect(result.state.events.find((e) => e.id === 'w3')?.skipDate?.reason).toBeNull();
  });

  it('a blank reason is stored as null, and an over-long one is rejected', () => {
    const blank = act(setup(), { type: 'addSkipDate', eventId: 'w3', reason: '   ' });
    expect(blank.state.events.find((e) => e.id === 'w3')?.skipDate?.reason).toBeNull();
    expect(rejected(setup(), { type: 'addSkipDate', eventId: 'w3', reason: 'x'.repeat(301) })).toBe('invalid');
  });

  it('removing the Skip Date removes its reason', () => {
    let state = act(setup(), { type: 'addSkipDate', eventId: 'w3', reason: 'Closure' }).state;
    state = act(state, { type: 'removeSkipDate', eventId: 'w3' }, { by: 'cal' }).state;
    expect(state.events.find((e) => e.id === 'w3')?.skipDate).toBeNull();
  });
});
