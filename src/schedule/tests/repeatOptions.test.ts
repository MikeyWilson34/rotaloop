/**
 * Feedback round 1, ticket 02: every N days, monthly on a date, every N months, and an end
 * (on a date or after N Events). The older kinds are covered in expandSeries.test.ts.
 */
import { describe, expect, it } from 'vitest';

import type { RepeatPattern } from '../../engine';
import {
  expandSeries,
  horizonEnd,
  lastOccurrenceDate,
  localDate,
  localTime,
  nextOccurrences,
  occurrencesBetween,
  samePattern,
} from '../expandSeries';

const pattern = (p: Partial<RepeatPattern>): RepeatPattern => ({
  frequency: 'weekly',
  intervalWeeks: null,
  daysOfWeek: [0],
  weekOfMonth: null,
  startTime: '09:00',
  timeZone: 'America/Chicago',
  startsOn: '2026-11-15',
  ...p,
});

const dates = (instants: string[], tz = 'America/Chicago') => instants.map((i) => localDate(i, tz));
const times = (instants: string[], tz = 'America/Chicago') => [...new Set(instants.map((i) => localTime(i, tz)))];

describe('every N days', () => {
  const daily = (intervalDays: number, p: Partial<RepeatPattern> = {}) =>
    pattern({ frequency: 'daily', intervalDays, daysOfWeek: [], ...p });

  it('every 10 days, counted from startsOn', () => {
    const got = occurrencesBetween(daily(10), '2026-11-01T00:00:00Z', '2027-01-10T00:00:00Z');
    expect(dates(got)).toEqual(['2026-11-15', '2026-11-25', '2026-12-05', '2026-12-15', '2026-12-25', '2027-01-04']);
  });

  it('keeps its phase in a window that starts later, across a year end', () => {
    const got = occurrencesBetween(daily(10), '2026-12-20T00:00:00Z', '2027-01-20T00:00:00Z');
    expect(dates(got)).toEqual(['2026-12-25', '2027-01-04', '2027-01-14']);
  });

  it('every day', () => {
    const got = occurrencesBetween(daily(1), '2026-11-15T00:00:00Z', '2026-11-19T00:00:00Z');
    expect(dates(got)).toEqual(['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18']);
  });

  it('keeps the local time across spring forward', () => {
    const got = occurrencesBetween(daily(3, { startsOn: '2027-03-08' }), '2027-03-01T00:00:00Z', '2027-03-20T00:00:00Z');
    expect(dates(got)).toEqual(['2027-03-08', '2027-03-11', '2027-03-14', '2027-03-17']);
    expect(times(got)).toEqual(['09:00']);
    expect(got.map((i) => i.slice(11, 13))).toEqual(['15', '15', '14', '14']);
  });
});

describe('monthly on a date', () => {
  const onDate = (dayOfMonth: number, p: Partial<RepeatPattern> = {}) =>
    pattern({ frequency: 'monthly', dayOfMonth, daysOfWeek: [], startsOn: '2027-01-01', ...p });

  it('the 15th of each month', () => {
    const got = occurrencesBetween(onDate(15), '2027-01-01T00:00:00Z', '2027-05-01T00:00:00Z');
    expect(dates(got)).toEqual(['2027-01-15', '2027-02-15', '2027-03-15', '2027-04-15']);
  });

  it('the 31st uses the last day of shorter months (Feb 28, Apr 30)', () => {
    const got = occurrencesBetween(onDate(31), '2027-01-01T00:00:00Z', '2027-08-01T00:00:00Z');
    expect(dates(got)).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
      '2027-05-31',
      '2027-06-30',
      '2027-07-31',
    ]);
  });

  it('the 31st and the 30th land on Feb 29 in a leap year', () => {
    const window = ['2028-02-01T00:00:00Z', '2028-03-02T00:00:00Z'] as const;
    expect(dates(occurrencesBetween(onDate(31, { startsOn: '2028-01-01' }), ...window))).toEqual(['2028-02-29']);
    expect(dates(occurrencesBetween(onDate(30, { startsOn: '2028-01-01' }), ...window))).toEqual(['2028-02-29']);
  });

  it('never starts before startsOn', () => {
    const got = occurrencesBetween(onDate(10, { startsOn: '2027-01-20' }), '2027-01-01T00:00:00Z', '2027-03-20T00:00:00Z');
    expect(dates(got)).toEqual(['2027-02-10', '2027-03-10']);
  });

  it('keeps the local time across a change (London)', () => {
    const got = occurrencesBetween(
      onDate(28, { timeZone: 'Europe/London', startTime: '18:00' }),
      '2027-01-01T00:00:00Z',
      '2027-05-01T00:00:00Z',
    );
    expect(times(got, 'Europe/London')).toEqual(['18:00']);
    expect(got.map((i) => i.slice(11, 16))).toEqual(['18:00', '18:00', '17:00', '17:00']);
  });
});

describe('every N months', () => {
  it('first Tuesday every 3 months, phased from the start month', () => {
    const p = pattern({ frequency: 'monthly', weekOfMonth: 1, daysOfWeek: [2], intervalMonths: 3, startsOn: '2026-11-18' });
    const got = occurrencesBetween(p, '2026-11-01T00:00:00Z', '2028-01-01T00:00:00Z');
    // November's first Tuesday (Nov 3) is before startsOn, but November still sets the phase.
    expect(dates(got)).toEqual(['2027-02-02', '2027-05-04', '2027-08-03', '2027-11-02']);
  });

  it('the 15th every 3 months', () => {
    const p = pattern({ frequency: 'monthly', dayOfMonth: 15, daysOfWeek: [], intervalMonths: 3, startsOn: '2026-11-15' });
    const got = occurrencesBetween(p, '2026-11-01T00:00:00Z', '2027-09-01T00:00:00Z');
    expect(dates(got)).toEqual(['2026-11-15', '2027-02-15', '2027-05-15', '2027-08-15']);
  });

  it('every 1 month is the same as plain monthly', () => {
    const window = ['2026-11-15T00:00:00Z', '2027-06-01T00:00:00Z'] as const;
    const monthly = pattern({ frequency: 'monthly', weekOfMonth: -1 });
    expect(occurrencesBetween({ ...monthly, intervalMonths: 1 }, ...window)).toEqual(occurrencesBetween(monthly, ...window));
  });

  it('every 12 months on the 29th is Feb 28 in common years', () => {
    const p = pattern({ frequency: 'monthly', dayOfMonth: 29, daysOfWeek: [], intervalMonths: 12, startsOn: '2028-02-01' });
    const got = occurrencesBetween(p, '2028-01-01T00:00:00Z', '2031-01-01T00:00:00Z');
    expect(dates(got)).toEqual(['2028-02-29', '2029-02-28', '2030-02-28']);
  });
});

describe('ends', () => {
  const window = ['2026-11-01T00:00:00Z', '2027-06-01T00:00:00Z'] as const;

  it('on a date, including Events on that local day', () => {
    const got = occurrencesBetween(pattern({ endsOn: '2026-12-06' }), ...window);
    expect(dates(got)).toEqual(['2026-11-15', '2026-11-22', '2026-11-29', '2026-12-06']);
  });

  it('the end date is a local date: a late-evening Event on it still happens', () => {
    const got = occurrencesBetween(pattern({ startTime: '23:30', endsOn: '2026-11-22' }), ...window);
    expect(dates(got)).toEqual(['2026-11-15', '2026-11-22']);
  });

  it('after N Events, counted from startsOn', () => {
    const p = pattern({ frequency: 'daily', intervalDays: 10, daysOfWeek: [], endsAfter: 4 });
    expect(dates(occurrencesBetween(p, ...window))).toEqual(['2026-11-15', '2026-11-25', '2026-12-05', '2026-12-15']);
  });

  it('after N Events counts from startsOn, not from the window, so a later window never adds more', () => {
    const p = pattern({ endsAfter: 6 }); // Sundays from Nov 15: the 6th is Dec 20
    expect(dates(occurrencesBetween(p, '2026-12-01T00:00:00Z', '2027-06-01T00:00:00Z'))).toEqual([
      '2026-12-06',
      '2026-12-13',
      '2026-12-20',
    ]);
    expect(occurrencesBetween(p, '2026-12-21T00:00:00Z', '2027-06-01T00:00:00Z')).toEqual([]);
  });

  it('after N Events with several days a week, every other week', () => {
    const p = pattern({ frequency: 'biweekly', daysOfWeek: [2, 4], startsOn: '2026-11-18', endsAfter: 3 });
    expect(dates(occurrencesBetween(p, ...window))).toEqual(['2026-11-19', '2026-12-01', '2026-12-03']);
  });

  it('after N Events for both monthly kinds', () => {
    const wide = ['2026-11-01T00:00:00Z', '2029-01-01T00:00:00Z'] as const;
    const tuesdays = pattern({ frequency: 'monthly', weekOfMonth: 1, daysOfWeek: [2], intervalMonths: 3, startsOn: '2026-11-18', endsAfter: 2 });
    expect(dates(occurrencesBetween(tuesdays, ...wide))).toEqual(['2027-02-02', '2027-05-04']);
    const lastDay = pattern({ frequency: 'monthly', dayOfMonth: 31, daysOfWeek: [], startsOn: '2027-01-31', endsAfter: 3 });
    expect(dates(occurrencesBetween(lastDay, ...wide))).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
  });

  it('after N Events is the first N of the open-ended pattern', () => {
    const wide = ['2026-11-01T00:00:00Z', '2029-01-01T00:00:00Z'] as const;
    const kinds: Partial<RepeatPattern>[] = [
      {},
      { frequency: 'custom', intervalWeeks: 3, daysOfWeek: [1, 5], startsOn: '2026-11-18' },
      { frequency: 'monthly', weekOfMonth: -1, daysOfWeek: [0, 6] },
      { frequency: 'monthly', weekOfMonth: 2, daysOfWeek: [3], intervalMonths: 5 },
      { frequency: 'monthly', dayOfMonth: 30, daysOfWeek: [], intervalMonths: 2 },
      { frequency: 'daily', intervalDays: 4, daysOfWeek: [] },
    ];
    for (const k of kinds) {
      const open = occurrencesBetween(pattern(k), ...wide);
      expect(occurrencesBetween(pattern({ ...k, endsAfter: 7 }), ...wide), JSON.stringify(k)).toEqual(open.slice(0, 7));
    }
  });

  it('expandSeries stops at the end, however often the rolling horizon moves on', () => {
    const p = pattern({ startTime: '10:00', endsAfter: 5 });
    let existing: { id: string; seriesId: string | null; startsAt: string }[] = [];
    for (const now of ['2026-11-14T12:00:00.000Z', '2026-12-01T12:00:00.000Z', '2027-02-01T12:00:00.000Z']) {
      existing = [...existing, ...expandSeries({ seriesId: 's1', pattern: p, existing, now, until: horizonEnd(now) })];
    }
    expect(dates(existing.map((e) => e.startsAt))).toEqual(['2026-11-15', '2026-11-22', '2026-11-29', '2026-12-06', '2026-12-13']);
  });

  it('nextOccurrences stops at the end, and looks years ahead for sparse patterns', () => {
    expect(nextOccurrences(pattern({ endsAfter: 2 }), '2026-11-01T00:00:00Z', 4)).toHaveLength(2);
    const yearly = pattern({ frequency: 'monthly', dayOfMonth: 1, daysOfWeek: [], intervalMonths: 12, startsOn: '2027-01-01' });
    expect(dates(nextOccurrences(yearly, '2026-11-01T00:00:00Z', 4))).toEqual(['2027-01-01', '2028-01-01', '2029-01-01', '2030-01-01']);
  });

  it('lastOccurrenceDate gives the final Event date of a pattern that ends', () => {
    expect(lastOccurrenceDate(pattern({}))).toBeNull();
    expect(lastOccurrenceDate(pattern({ endsAfter: 6 }))).toBe('2026-12-20');
    expect(lastOccurrenceDate(pattern({ endsOn: '2026-12-10' }))).toBe('2026-12-06');
    expect(lastOccurrenceDate(pattern({ endsOn: '2026-11-14' }))).toBeNull();
    expect(
      lastOccurrenceDate(pattern({ frequency: 'monthly', dayOfMonth: 31, daysOfWeek: [], startsOn: '2027-01-01', endsOn: '2027-05-15' })),
    ).toBe('2027-04-30');
  });
});

describe('samePattern with the new fields', () => {
  it('compares interval, date and end, treating a missing month interval as 1', () => {
    const monthly = pattern({ frequency: 'monthly', weekOfMonth: 1 });
    expect(samePattern(monthly, { ...monthly, intervalMonths: 1 })).toBe(true);
    expect(samePattern(monthly, { ...monthly, intervalMonths: 3 })).toBe(false);
    expect(samePattern(monthly, { ...monthly, endsOn: '2027-06-30' })).toBe(false);
    expect(samePattern(monthly, { ...monthly, endsAfter: 5 })).toBe(false);
    expect(samePattern(monthly, { ...monthly, endsOn: null, endsAfter: null })).toBe(true);
    const daily = pattern({ frequency: 'daily', intervalDays: 2, daysOfWeek: [] });
    expect(samePattern(daily, { ...daily, intervalDays: 3 })).toBe(false);
    const onDate = pattern({ frequency: 'monthly', dayOfMonth: 15, daysOfWeek: [] });
    expect(samePattern(onDate, { ...onDate, dayOfMonth: 16 })).toBe(false);
  });
});
