import { describe, expect, it } from 'vitest';

import { toTimeOff } from '../state';
import { timeOffCovers } from '../time';
import { act, lineup, moves, rejected, setup, sundays, timeOff, week } from './scenario';

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

describe('Repeating Time Off across daylight-saving changes', () => {
  // Sundays at 9:00 Chicago time, Jan 3 - Apr 25 2027. Clocks go forward on Mar 14 (CST -6h
  // to CDT -5h), so 9:00 local is 15:00Z before and 14:00Z after.
  const CHICAGO = 'America/Chicago';
  const sundayAt9 = (date: string) => {
    const [y, m, d] = date.split('-').map(Number);
    const dst = Date.UTC(y, m - 1, d) >= Date.UTC(2027, 2, 14);
    return new Date(Date.UTC(y, m - 1, d, dst ? 14 : 15)).toISOString();
  };
  const dates = Array.from({ length: 17 }, (_, i) => new Date(Date.UTC(2027, 0, 3 + 7 * i)).toISOString().slice(0, 10));
  const events = dates.map((date, i) => ({ id: `w${i + 1}`, seriesId: 'sundays', startsAt: sundayAt9(date) }));
  // "Every other Sunday, 8:30-9:30 AM", from Jan 3: covers w1, w3, w5, ...
  const repeating = (extra: object = {}) => ({
    id: 't1',
    memberId: 'cal',
    startsAt: '2027-01-03T14:30:00.000Z',
    endsAt: '2027-01-03T15:30:00.000Z',
    repeatEveryWeeks: 2,
    ...extra,
  });
  const calWeeks = (state: ReturnType<typeof setup>) =>
    lineup(state).filter((l) => l.endsWith(' cal')).map((l) => l.split(' ')[0]);

  it('without a time zone the repeat keeps whole UTC weeks and misses 9:00 local after the change; with one it does not', () => {
    const at = (id: string) => ({ ...events.find((e) => e.id === id)!, responsibilityIds: null, skipDate: null });
    const utc = toTimeOff(repeating());
    const local = toTimeOff(repeating({ timeZone: CHICAGO }));
    expect(timeOffCovers(utc, at('w9'), 'sound')).toBe(true);
    expect(timeOffCovers(utc, at('w11'), 'sound')).toBe(false); // the old drift
    expect(timeOffCovers(local, at('w9'), 'sound')).toBe(true);
    expect(timeOffCovers(local, at('w11'), 'sound')).toBe(true);
    expect(timeOffCovers(local, at('w12'), 'sound')).toBe(false);
  });

  it("with the Group's time zone, every occurrence stays at 8:30-9:30 local time on both sides of the change", () => {
    const state = setup({ members: ['ana', 'ben', 'cal'], events });
    const result = act(state, { type: 'addTimeOff', timeOff: repeating({ timeZone: CHICAGO }) });
    const odd = ['w1', 'w3', 'w5', 'w7', 'w9', 'w11', 'w13', 'w15', 'w17'];
    expect(calWeeks(result.state).filter((w) => odd.includes(w))).toEqual([]);
    expect(calWeeks(result.state).length).toBeGreaterThan(0);
    expect(result.state.timeOff[0]).toMatchObject({ timeZone: CHICAGO, note: null });
  });

  it('repeatUntil is read in local time too', () => {
    const state = setup({ members: ['ana', 'ben', 'cal'], events });
    // Until Mar 21 9:00 local (14:00Z): w11 (Mar 14) and w12's week are inside, w13 (Mar 28) is not.
    const result = act(state, {
      type: 'addTimeOff',
      timeOff: repeating({ timeZone: CHICAGO, repeatEveryWeeks: 1, repeatUntil: '2027-03-21T14:00:00.000Z' }),
    });
    const weeks = calWeeks(result.state);
    expect(weeks.every((w) => Number(w.slice(1)) > 12)).toBe(true);
  });

  it('rejects an unknown time zone', () => {
    const state = setup({ members: ['ana', 'ben', 'cal'], events });
    expect(rejected(state, { type: 'addTimeOff', timeOff: repeating({ timeZone: 'Mars/Olympus' }) })).toBe('invalid');
  });

  it('keeps the note', () => {
    const state = setup({ members: ['ana', 'ben', 'cal'], events });
    const result = act(state, { type: 'addTimeOff', timeOff: repeating({ note: 'Family trip' }) });
    expect(result.state.timeOff[0].note).toBe('Family trip');
  });
});
