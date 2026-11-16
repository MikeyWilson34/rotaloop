import { describe, expect, it } from 'vitest';

import { act, lineup, NOW, setup, sundays, timeOff, week } from './scenario';

describe('Filling the schedule from Rotations', () => {
  it('Rotation: each Event takes the next Member from the front of the queue', () => {
    const state = setup();
    expect(lineup(state)).toEqual([
      'w1 ana', 'w2 ben', 'w3 cal', 'w4 dee', 'w5 ana', 'w6 ben', 'w7 cal', 'w8 dee',
    ]);
  });

  it('Headcount: an Event with two seats takes the next two Members', () => {
    const state = setup({
      responsibilities: [{ id: 'greeter', headcount: 2, qualified: ['ana', 'ben', 'cal'] }],
      events: sundays(3),
    });
    expect(lineup(state, 'greeter')).toEqual(['w1 ana+ben', 'w2 cal+ana', 'w3 ben+cal'].map(sortSeats));
  });

  it('Event Series: each Event fills only the Responsibilities its series needs, and one-off Events name their own', () => {
    const state = setup({
      responsibilities: [
        { id: 'sound', qualified: ['ana', 'ben', 'cal'] },
        { id: 'greeter', qualified: ['dee', 'eve'] },
      ],
      members: ['ana', 'ben', 'cal', 'dee', 'eve'],
      series: [
        { id: 'sundays', responsibilityIds: ['sound', 'greeter'] },
        { id: 'midweek', responsibilityIds: ['sound'] },
      ],
      events: [
        { id: 'sun1', seriesId: 'sundays', startsAt: week(1) },
        { id: 'wed1', seriesId: 'midweek', startsAt: '2027-01-06T19:00:00.000Z' },
        { id: 'party', seriesId: null, startsAt: '2027-01-08T19:00:00.000Z', responsibilityIds: ['greeter'] },
        { id: 'sun2', seriesId: 'sundays', startsAt: week(2) },
      ],
    });
    expect(lineup(state, 'sound')).toEqual(['sun1 ana', 'wed1 ben', 'sun2 cal']);
    expect(lineup(state, 'greeter')).toEqual(['sun1 dee', 'party eve', 'sun2 dee']);
  });

  it('No doubling: a Member already holding a seat at the Event is passed over and keeps their front place', () => {
    const state = setup({
      responsibilities: [
        { id: 'sound', qualified: ['ana', 'ben'] },
        { id: 'greeter', qualified: ['ana', 'cal', 'dee'] },
      ],
      events: sundays(4),
    });
    expect(lineup(state, 'sound')).toEqual(['w1 ana', 'w2 ben', 'w3 ana', 'w4 ben']);
    // ana is on sound at w1, so cal fills in; ana keeps the front and greets at w2.
    expect(lineup(state, 'greeter')).toEqual(['w1 cal', 'w2 ana', 'w3 dee', 'w4 ana']);
  });

  it('Doubling allowed: a Member may hold seats of two Responsibilities at one Event', () => {
    const state = setup({
      responsibilities: [
        { id: 'sound', qualified: ['ana', 'ben'] },
        { id: 'greeter', qualified: ['ana', 'cal'] },
      ],
      events: sundays(2),
      settings: { allowDoubling: true },
    });
    expect(lineup(state, 'sound')).toEqual(['w1 ana', 'w2 ben']);
    expect(lineup(state, 'greeter')).toEqual(['w1 ana', 'w2 cal']);
  });

  it('Everyone unavailable: the seat stays open and needs coverage', () => {
    let state = setup({ members: ['ana', 'ben'], events: sundays(3) });
    state = act(state, { type: 'addTimeOff', timeOff: timeOff('t1', 'ana', 2) }, { by: 'ana' }).state;
    state = act(state, { type: 'addTimeOff', timeOff: timeOff('t2', 'ben', 2) }, { by: 'ben' }).state;
    expect(lineup(state)).toEqual(['w1 ana', 'w2 ben (needs coverage)', 'w3 ana']);
  });

  it('No Qualified Members: every seat stays open and needs coverage', () => {
    const state = setup({ responsibilities: [{ id: 'sound', qualified: [] }], events: sundays(2) });
    expect(lineup(state)).toEqual(['w1 open (needs coverage)', 'w2 open (needs coverage)']);
  });

  it('Adding Events continues the Rotation and only creates Assignments for the new Events', () => {
    const state = setup({ events: sundays(3) });
    const result = act(state, {
      type: 'addEvents',
      events: sundays(5).slice(3),
    });
    expect(lineup(result.state)).toEqual(['w1 ana', 'w2 ben', 'w3 cal', 'w4 dee', 'w5 ana']);
    expect(result.changes.every((c) => c.before === null)).toBe(true);
    expect(result.changes).toHaveLength(2);
  });

  it('Filling the schedule is deterministic and refilling changes nothing', () => {
    const state = setup();
    const again = act(state, { type: 'fillSchedule' }, { at: NOW });
    expect(again.changes).toEqual([]);
    expect(again.state).toEqual(state);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('Past Events are history: the queue carries on from what actually happened', () => {
    const state = setup();
    const later = act(state, { type: 'fillSchedule' }, { at: '2027-01-20T00:00:00.000Z' });
    expect(later.changes).toEqual([]);
    expect(later.state.rotatedThrough).toBe('2027-01-20T00:00:00.000Z');
    expect(lineup(later.state)).toEqual(lineup(state));
  });
});

function sortSeats(line: string): string {
  const [event, seats] = line.split(' ');
  return `${event} ${seats.split('+').sort().join('+')}`;
}
