import { describe, expect, it } from 'vitest';

import { act, lineup, moves, setup, sundays, timeOff, week } from './scenario';

describe('Time Off', () => {
  it("Time Off: the next in line takes the Event and the absent Member takes that Member's next date", () => {
    const state = setup();
    const result = act(state, { type: 'addTimeOff', timeOff: timeOff('t1', 'ana', 1) }, { by: 'ana' });
    expect(lineup(result.state)).toEqual([
      'w1 ben', 'w2 ana', 'w3 cal', 'w4 dee', 'w5 ana', 'w6 ben', 'w7 cal', 'w8 dee',
    ]);
    expect(moves(result)).toEqual(['ana@w1 -> ana@w2', 'ben@w2 -> ben@w1']);
  });

  it('Time Off over several consecutive Events: the partner is the first Member whose next date is outside it', () => {
    const state = setup();
    const result = act(state, { type: 'addTimeOff', timeOff: timeOff('t1', 'ana', 1, 2) }, { by: 'ana' });
    expect(lineup(result.state)).toEqual([
      'w1 cal', 'w2 ben', 'w3 ana', 'w4 dee', 'w5 ana', 'w6 ben', 'w7 cal', 'w8 dee',
    ]);
    expect(moves(result)).toEqual(['ana@w1 -> ana@w3', 'cal@w3 -> cal@w1']);
  });

  it('Time Off scoped to one Responsibility only routes that Responsibility', () => {
    let state = setup({
      responsibilities: [
        { id: 'sound', qualified: ['ana', 'ben', 'cal'] },
        { id: 'greeter', qualified: ['dee', 'ana'] },
      ],
      events: sundays(4),
      settings: { allowDoubling: true },
    });
    state = act(state, {
      type: 'addTimeOff',
      timeOff: timeOff('t1', 'ana', 1, 1, { responsibilityIds: ['sound'] }),
    }).state;
    expect(lineup(state, 'sound')).toEqual(['w1 ben', 'w2 ana', 'w3 cal', 'w4 ana']);
    expect(lineup(state, 'greeter')).toEqual(['w1 dee', 'w2 ana', 'w3 dee', 'w4 ana']);
  });

  it('Time Off repeating every other week routes around each occurrence', () => {
    const state = setup({ members: ['ana', 'ben', 'cal'], events: sundays(6) });
    const result = act(state, {
      type: 'addTimeOff',
      timeOff: timeOff('t1', 'cal', 1, 1, { repeatEveryWeeks: 2 }),
    });
    // cal is away on odd weeks: w3 swaps with ana's w4.
    expect(lineup(result.state)).toEqual(['w1 ana', 'w2 ben', 'w3 ana', 'w4 cal', 'w5 ben', 'w6 cal']);
  });

  it('Ask for a volunteer: Time Off turns the Assignment into a Coverage Request instead', () => {
    const state = setup({ settings: { timeOffHandling: 'askVolunteer' } });
    const result = act(state, { type: 'addTimeOff', timeOff: timeOff('t1', 'ana', 1) }, { by: 'ana' });
    expect(lineup(result.state).slice(0, 2)).toEqual(['w1 ana (needs coverage)', 'w2 ben']);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].after?.coverageRequest).toMatchObject({ reason: 'timeOff', requestedBy: 'ana' });
  });

  it('Removing Time Off does not undo routing that already happened', () => {
    let state = setup();
    state = act(state, { type: 'addTimeOff', timeOff: timeOff('t1', 'ana', 1) }, { by: 'ana' }).state;
    const result = act(state, { type: 'removeTimeOff', timeOffId: 't1' }, { by: 'ana' });
    expect(result.changes).toEqual([]);
    expect(lineup(result.state).slice(0, 2)).toEqual(['w1 ben', 'w2 ana']);
    expect(result.state.timeOff[0]).toMatchObject({ removedAt: expect.any(String), retainedEventIds: ['w1'] });
  });

  it('Removed Time Off does not apply to Events added later', () => {
    let state = setup({ events: sundays(2) });
    state = act(state, {
      type: 'addTimeOff',
      timeOff: { id: 't1', memberId: 'cal', startsAt: week(1), endsAt: week(9) },
    }).state;
    state = act(state, { type: 'removeTimeOff', timeOffId: 't1' }).state;
    state = act(state, { type: 'addEvents', events: sundays(3).slice(2) }).state;
    expect(lineup(state)).toEqual(['w1 ana', 'w2 ben', 'w3 cal']);
  });
});
