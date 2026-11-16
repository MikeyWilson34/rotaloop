import { describe, expect, it } from 'vitest';

import type { RepeatPattern } from '../../engine';
import {
  dayNumber,
  expandSeries,
  horizonEnd,
  isValidTimeZone,
  localDate,
  localTime,
  nextOccurrences,
  occurrencesBetween,
  offsetAt,
  replacementEvents,
  samePattern,
  seriesEventId,
  weekdayOf,
  zonedTimeToInstant,
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

const dates = (instants: string[], tz: string) => instants.map((i) => localDate(i, tz));
const times = (instants: string[], tz: string) => [...new Set(instants.map((i) => localTime(i, tz)))];

describe('civil dates', () => {
  it('knows weekdays', () => {
    expect(weekdayOf(dayNumber('1970-01-01'))).toBe(4);
    expect(weekdayOf(dayNumber('2026-11-15'))).toBe(0);
    expect(weekdayOf(dayNumber('2027-03-13'))).toBe(6);
  });
  it('validates time zones', () => {
    expect(isValidTimeZone('America/Chicago')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('zonedTimeToInstant', () => {
  it('converts winter and summer times in Chicago', () => {
    expect(zonedTimeToInstant('2026-11-15', '09:00', 'America/Chicago')).toBe('2026-11-15T15:00:00.000Z');
    expect(zonedTimeToInstant('2026-07-05', '09:00', 'America/Chicago')).toBe('2026-07-05T14:00:00.000Z');
  });

  it('converts winter and summer times in London', () => {
    expect(zonedTimeToInstant('2026-12-06', '10:30', 'Europe/London')).toBe('2026-12-06T10:30:00.000Z');
    expect(zonedTimeToInstant('2027-04-04', '10:30', 'Europe/London')).toBe('2027-04-04T09:30:00.000Z');
  });

  it('moves a skipped time forward by the gap (spring forward)', () => {
    // Chicago skips 2:00-3:00 on 2027-03-14.
    expect(zonedTimeToInstant('2027-03-14', '02:30', 'America/Chicago')).toBe('2027-03-14T08:30:00.000Z');
    expect(localTime('2027-03-14T08:30:00.000Z', 'America/Chicago')).toBe('03:30');
    // London skips 1:00-2:00 on 2027-03-28.
    expect(zonedTimeToInstant('2027-03-28', '01:30', 'Europe/London')).toBe('2027-03-28T01:30:00.000Z');
    expect(localTime('2027-03-28T01:30:00.000Z', 'Europe/London')).toBe('02:30');
  });

  it('uses the first of a repeated time (fall back)', () => {
    // Chicago's 1:30 happens twice on 2026-11-01: 06:30Z (CDT) then 07:30Z (CST).
    expect(zonedTimeToInstant('2026-11-01', '01:30', 'America/Chicago')).toBe('2026-11-01T06:30:00.000Z');
    // London's 1:30 happens twice on 2026-10-25: 00:30Z (BST) then 01:30Z (GMT).
    expect(zonedTimeToInstant('2026-10-25', '01:30', 'Europe/London')).toBe('2026-10-25T00:30:00.000Z');
  });

  it('handles times right at midnight and zones east of UTC', () => {
    expect(zonedTimeToInstant('2026-12-31', '00:00', 'Asia/Tokyo')).toBe('2026-12-30T15:00:00.000Z');
    expect(zonedTimeToInstant('2026-12-31', '23:59', 'Pacific/Auckland')).toBe('2026-12-31T10:59:00.000Z');
    expect(offsetAt(Date.parse('2026-06-01T00:00:00Z'), 'UTC')).toBe(0);
  });
});

describe('occurrencesBetween: weekly', () => {
  it('makes every Sunday in the window at the local time', () => {
    const got = occurrencesBetween(pattern({}), '2026-11-15T00:00:00Z', '2026-12-13T23:00:00Z');
    expect(dates(got, 'America/Chicago')).toEqual(['2026-11-15', '2026-11-22', '2026-11-29', '2026-12-06', '2026-12-13']);
    expect(times(got, 'America/Chicago')).toEqual(['09:00']);
  });

  it('is strictly after `after` and includes `until`', () => {
    const at = '2026-11-22T15:00:00.000Z';
    expect(occurrencesBetween(pattern({}), at, '2026-11-29T15:00:00.000Z')).toEqual(['2026-11-29T15:00:00.000Z']);
    expect(occurrencesBetween(pattern({}), '2026-11-22T14:59:59.000Z', at)).toEqual([at]);
    expect(occurrencesBetween(pattern({}), at, at)).toEqual([]);
  });

  it('never starts before startsOn', () => {
    const got = occurrencesBetween(pattern({ startsOn: '2026-12-01' }), '2026-11-15T00:00:00Z', '2026-12-14T00:00:00Z');
    expect(dates(got, 'America/Chicago')).toEqual(['2026-12-06', '2026-12-13']);
  });

  it('handles several days a week, in time order', () => {
    const got = occurrencesBetween(
      pattern({ daysOfWeek: [2, 4], startTime: '18:30' }),
      '2026-11-15T00:00:00Z',
      '2026-11-29T00:00:00Z',
    );
    expect(dates(got, 'America/Chicago')).toEqual(['2026-11-17', '2026-11-19', '2026-11-24', '2026-11-26']);
    expect(times(got, 'America/Chicago')).toEqual(['18:30']);
  });

  it('keeps the local date when the UTC date differs (late evening west of UTC)', () => {
    const got = occurrencesBetween(pattern({ startTime: '21:00' }), '2026-11-15T00:00:00Z', '2026-11-23T12:00:00Z');
    expect(got).toEqual(['2026-11-16T03:00:00.000Z', '2026-11-23T03:00:00.000Z']);
    expect(dates(got, 'America/Chicago')).toEqual(['2026-11-15', '2026-11-22']);
  });
});

describe('occurrencesBetween: every other week and custom', () => {
  it('biweekly counts from the first matching day on or after startsOn', () => {
    // Starts Wednesday Nov 18: the first Sunday is Nov 22.
    const got = occurrencesBetween(
      pattern({ frequency: 'biweekly', startsOn: '2026-11-18' }),
      '2026-11-15T00:00:00Z',
      '2027-01-10T23:00:00Z',
    );
    expect(dates(got, 'America/Chicago')).toEqual(['2026-11-22', '2026-12-06', '2026-12-20', '2027-01-03']);
  });

  it('biweekly keeps its phase in a window that starts later', () => {
    const p = pattern({ frequency: 'biweekly', startsOn: '2026-11-22' });
    const got = occurrencesBetween(p, '2026-12-10T00:00:00Z', '2027-01-10T23:00:00Z');
    expect(dates(got, 'America/Chicago')).toEqual(['2026-12-20', '2027-01-03']);
  });

  it('biweekly with two days keeps both days in the same on-week', () => {
    const got = occurrencesBetween(
      pattern({ frequency: 'biweekly', daysOfWeek: [2, 4], startsOn: '2026-11-18' }),
      '2026-11-15T00:00:00Z',
      '2026-12-13T00:00:00Z',
    );
    // First matching day is Thu Nov 19, so the week of Nov 15 is week 0.
    expect(dates(got, 'America/Chicago')).toEqual(['2026-11-19', '2026-12-01', '2026-12-03']);
  });

  it('custom every 3 weeks', () => {
    const got = occurrencesBetween(
      pattern({ frequency: 'custom', intervalWeeks: 3, daysOfWeek: [6], startsOn: '2026-11-15' }),
      '2026-11-15T00:00:00Z',
      '2027-01-31T00:00:00Z',
    );
    expect(dates(got, 'America/Chicago')).toEqual(['2026-11-21', '2026-12-12', '2027-01-02', '2027-01-23']);
  });

  it('custom every 1 week is weekly', () => {
    const window = ['2026-11-15T00:00:00Z', '2027-02-01T00:00:00Z'] as const;
    expect(occurrencesBetween(pattern({ frequency: 'custom', intervalWeeks: 1 }), ...window)).toEqual(
      occurrencesBetween(pattern({}), ...window),
    );
  });
});

describe('occurrencesBetween: monthly', () => {
  const window = ['2026-11-15T00:00:00Z', '2027-06-01T00:00:00Z'] as const;

  it('first Sunday of each month', () => {
    const got = occurrencesBetween(pattern({ frequency: 'monthly', weekOfMonth: 1 }), ...window);
    expect(dates(got, 'America/Chicago')).toEqual([
      '2026-12-06',
      '2027-01-03',
      '2027-02-07',
      '2027-03-07',
      '2027-04-04',
      '2027-05-02',
    ]);
  });

  it('fourth Thursday of each month', () => {
    const got = occurrencesBetween(pattern({ frequency: 'monthly', weekOfMonth: 4, daysOfWeek: [4] }), ...window);
    expect(dates(got, 'America/Chicago')).toEqual([
      '2026-11-26',
      '2026-12-24',
      '2027-01-28',
      '2027-02-25',
      '2027-03-25',
      '2027-04-22',
      '2027-05-27',
    ]);
  });

  it('last Sunday of each month, including five-Sunday months', () => {
    const got = occurrencesBetween(pattern({ frequency: 'monthly', weekOfMonth: -1 }), ...window);
    expect(dates(got, 'America/Chicago')).toEqual([
      '2026-11-29',
      '2026-12-27',
      '2027-01-31', // January 2027 has five Sundays
      '2027-02-28',
      '2027-03-28',
      '2027-04-25',
      '2027-05-30',
    ]);
  });

  it('last Friday in a leap-year February', () => {
    const got = occurrencesBetween(
      pattern({ frequency: 'monthly', weekOfMonth: -1, daysOfWeek: [5], startsOn: '2028-01-01' }),
      '2028-02-01T00:00:00Z',
      '2028-03-01T00:00:00Z',
    );
    expect(dates(got, 'America/Chicago')).toEqual(['2028-02-25']);
  });

  it('several weekdays at the same week of the month', () => {
    const got = occurrencesBetween(
      pattern({ frequency: 'monthly', weekOfMonth: 2, daysOfWeek: [1, 3] }),
      '2026-12-01T00:00:00Z',
      '2027-01-31T00:00:00Z',
    );
    expect(dates(got, 'America/Chicago')).toEqual(['2026-12-09', '2026-12-14', '2027-01-11', '2027-01-13']);
  });
});

describe('daylight saving time', () => {
  it('Chicago: Sundays 9:00 stay 9:00 local across spring forward', () => {
    const got = occurrencesBetween(pattern({}), '2027-03-01T00:00:00Z', '2027-03-22T00:00:00Z');
    expect(got).toEqual(['2027-03-07T15:00:00.000Z', '2027-03-14T14:00:00.000Z', '2027-03-21T14:00:00.000Z']);
    expect(times(got, 'America/Chicago')).toEqual(['09:00']);
  });

  it('Chicago: Sundays 9:00 stay 9:00 local across fall back', () => {
    const got = occurrencesBetween(pattern({ startsOn: '2026-10-01' }), '2026-10-20T00:00:00Z', '2026-11-09T00:00:00Z');
    expect(got).toEqual(['2026-10-25T14:00:00.000Z', '2026-11-01T15:00:00.000Z', '2026-11-08T15:00:00.000Z']);
    expect(times(got, 'America/Chicago')).toEqual(['09:00']);
  });

  it('Chicago: an Event in the skipped hour moves to 3:30, others stay at 2:30', () => {
    const got = occurrencesBetween(pattern({ startTime: '02:30' }), '2027-03-01T00:00:00Z', '2027-03-22T00:00:00Z');
    expect(got.map((i) => localTime(i, 'America/Chicago'))).toEqual(['02:30', '03:30', '02:30']);
  });

  it('London: Sundays 10:30 stay 10:30 local across both changes', () => {
    const p = pattern({ timeZone: 'Europe/London', startTime: '10:30', startsOn: '2026-10-01' });
    const autumn = occurrencesBetween(p, '2026-10-15T00:00:00Z', '2026-11-02T00:00:00Z');
    expect(autumn).toEqual(['2026-10-18T09:30:00.000Z', '2026-10-25T10:30:00.000Z', '2026-11-01T10:30:00.000Z']);
    const spring = occurrencesBetween(p, '2027-03-20T00:00:00Z', '2027-04-05T00:00:00Z');
    expect(spring).toEqual(['2027-03-21T10:30:00.000Z', '2027-03-28T09:30:00.000Z', '2027-04-04T09:30:00.000Z']);
    expect(times([...autumn, ...spring], 'Europe/London')).toEqual(['10:30']);
  });

  it('London: an early-morning Event on the change day', () => {
    const p = pattern({ timeZone: 'Europe/London', startTime: '01:30', startsOn: '2026-10-01' });
    const [repeated] = occurrencesBetween(p, '2026-10-24T00:00:00Z', '2026-10-26T00:00:00Z');
    expect(repeated).toBe('2026-10-25T00:30:00.000Z'); // the first 1:30 (BST)
    const [skipped] = occurrencesBetween(p, '2027-03-27T00:00:00Z', '2027-03-29T00:00:00Z');
    expect(localTime(skipped, 'Europe/London')).toBe('02:30');
  });

  it('a 12-week horizon through a change keeps the local time (Sydney, southern hemisphere)', () => {
    const p = pattern({ timeZone: 'Australia/Sydney', startTime: '09:00', startsOn: '2027-03-01' });
    const got = occurrencesBetween(p, '2027-03-01T00:00:00Z', horizonEnd('2027-03-01T00:00:00Z'));
    expect(got).toHaveLength(12);
    expect(times(got, 'Australia/Sydney')).toEqual(['09:00']);
    expect(new Set(got.map((i) => i.slice(11, 13))).size).toBe(2); // two UTC hours: DST ended
  });

  it('a monthly pattern keeps local time across a change', () => {
    const got = occurrencesBetween(
      pattern({ frequency: 'monthly', weekOfMonth: -1, timeZone: 'Europe/London', startTime: '18:00' }),
      '2027-01-01T00:00:00Z',
      '2027-05-01T00:00:00Z',
    );
    expect(times(got, 'Europe/London')).toEqual(['18:00']);
    expect(got.map((i) => i.slice(11, 16))).toEqual(['18:00', '18:00', '17:00', '17:00']);
  });
});

describe('nextOccurrences', () => {
  it('gives the next few dates for a preview', () => {
    const got = nextOccurrences(pattern({ frequency: 'monthly', weekOfMonth: 1 }), '2026-11-15T00:00:00Z', 4);
    expect(dates(got, 'America/Chicago')).toEqual(['2026-12-06', '2027-01-03', '2027-02-07', '2027-03-07']);
  });
  it('looks far ahead for sparse patterns', () => {
    const got = nextOccurrences(
      pattern({ frequency: 'custom', intervalWeeks: 52, startsOn: '2026-11-15' }),
      '2026-11-16T00:00:00Z',
      2,
    );
    expect(dates(got, 'America/Chicago')).toEqual(['2027-11-14', '2028-11-12']);
  });
});

describe('expandSeries', () => {
  const now = '2026-11-15T12:00:00.000Z';
  const p = pattern({ startTime: '10:00' });

  it('makes 12 weeks of Events with stable ids', () => {
    const events = expandSeries({ seriesId: 's1', pattern: p, existing: [], now, until: horizonEnd(now) });
    expect(events).toHaveLength(12);
    expect(events[0]).toEqual({ id: 's1@20261115T1600Z', seriesId: 's1', startsAt: '2026-11-15T16:00:00.000Z' });
    expect(new Set(events.map((e) => e.id)).size).toBe(12);
  });

  it('extending the horizon adds only the new weeks, never duplicates', () => {
    const first = expandSeries({ seriesId: 's1', pattern: p, existing: [], now, until: horizonEnd(now) });
    const later = '2026-11-29T12:00:00.000Z';
    const more = expandSeries({ seriesId: 's1', pattern: p, existing: first, now: later, until: horizonEnd(later) });
    expect(more.map((e) => localDate(e.startsAt, 'America/Chicago'))).toEqual(['2027-02-07', '2027-02-14']);
    expect(expandSeries({ seriesId: 's1', pattern: p, existing: [...first, ...more], now: later, until: horizonEnd(later) })).toEqual([]);
  });

  it('extending the horizon across spring forward keeps 10:00 local', () => {
    const existing = expandSeries({ seriesId: 's1', pattern: p, existing: [], now, until: horizonEnd(now) });
    const later = '2027-02-01T12:00:00.000Z';
    const more = expandSeries({ seriesId: 's1', pattern: p, existing, now: later, until: horizonEnd(later) });
    expect(more.map((e) => e.startsAt)).toContain('2027-03-07T16:00:00.000Z');
    expect(more.map((e) => e.startsAt)).toContain('2027-03-14T15:00:00.000Z');
    expect(times(more.map((e) => e.startsAt), 'America/Chicago')).toEqual(['10:00']);
  });

  it("ignores other series' Events at the same time but avoids their ids", () => {
    const other = { id: 's1@20261122T1600Z', seriesId: 'x', startsAt: '2026-11-22T16:00:00.000Z' };
    const events = expandSeries({ seriesId: 's1', pattern: p, existing: [other], now, until: '2026-11-23T00:00:00Z' });
    expect(events.map((e) => e.id)).toEqual(['s1@20261115T1600Z', 's1@20261122T1600Z-2']);
  });

  it('dedupes on the instant, whatever the existing id', () => {
    const existing = [{ id: 'w1', seriesId: 's1', startsAt: '2026-11-15T16:00:00.000Z' }];
    const events = expandSeries({ seriesId: 's1', pattern: p, existing, now, until: '2026-11-23T00:00:00Z' });
    expect(events.map((e) => e.startsAt)).toEqual(['2026-11-22T16:00:00.000Z']);
  });

  it('makes nothing in the past', () => {
    const events = expandSeries({ seriesId: 's1', pattern: p, existing: [], now: '2026-11-15T16:00:00.000Z', until: '2026-11-23T00:00:00Z' });
    expect(events.map((e) => e.startsAt)).toEqual(['2026-11-22T16:00:00.000Z']);
  });

  it('formats ids from the UTC start', () => {
    expect(seriesEventId('abc', '2027-03-14T15:00:00Z')).toBe('abc@20270314T1500Z');
  });
});

describe('replacementEvents (editing a pattern)', () => {
  const now = '2026-11-15T12:00:00.000Z';
  const sundays = pattern({ startTime: '10:00' });
  const existing = [
    { id: 'past', seriesId: 's1', startsAt: '2026-11-08T16:00:00.000Z' },
    ...expandSeries({ seriesId: 's1', pattern: sundays, existing: [], now, until: horizonEnd(now) }),
  ];

  it('the same pattern keeps every Event (no change)', () => {
    const replacement = replacementEvents({ seriesId: 's1', pattern: sundays, existing, now, until: horizonEnd(now) });
    expect(replacement).toEqual(existing.slice(1));
  });

  it('a new time replaces every future Event with new ids', () => {
    const replacement = replacementEvents({
      seriesId: 's1',
      pattern: { ...sundays, startTime: '11:00' },
      existing,
      now,
      until: horizonEnd(now),
    });
    expect(replacement).toHaveLength(12);
    expect(times(replacement.map((e) => e.startsAt), 'America/Chicago')).toEqual(['11:00']);
    expect(replacement.some((e) => existing.some((x) => x.id === e.id))).toBe(false);
  });

  it('weekly to biweekly keeps the Events that still happen', () => {
    const replacement = replacementEvents({
      seriesId: 's1',
      pattern: { ...sundays, frequency: 'biweekly' },
      existing,
      now,
      until: horizonEnd(now),
    });
    expect(replacement).toHaveLength(6);
    for (const e of replacement) expect(existing.find((x) => x.id === e.id)?.startsAt).toBe(e.startsAt);
  });

  it('adding a day keeps the old Events and adds the new ones', () => {
    const replacement = replacementEvents({
      seriesId: 's1',
      pattern: { ...sundays, daysOfWeek: [0, 3] },
      existing,
      now,
      until: horizonEnd(now),
    });
    const kept = replacement.filter((e) => existing.some((x) => x.id === e.id));
    expect(kept).toHaveLength(12);
    expect(replacement.length).toBeGreaterThanOrEqual(23);
  });

  it('reaches as far as the furthest existing Event', () => {
    const far = { id: 'far', seriesId: 's1', startsAt: '2027-03-21T15:00:00.000Z' };
    const replacement = replacementEvents({
      seriesId: 's1',
      pattern: sundays,
      existing: [...existing, far],
      now,
      until: horizonEnd(now),
    });
    expect(replacement.find((e) => e.startsAt === far.startsAt)?.id).toBe('far');
    // and the DST change on Mar 14 in between stays at 10:00 local
    expect(times(replacement.map((e) => e.startsAt), 'America/Chicago')).toEqual(['10:00']);
  });
});

describe('samePattern', () => {
  it('compares the fields that decide dates and times', () => {
    expect(samePattern(pattern({ daysOfWeek: [0, 3] }), pattern({ daysOfWeek: [3, 0] }))).toBe(true);
    expect(samePattern(pattern({}), pattern({ startTime: '10:00' }))).toBe(false);
    expect(samePattern(pattern({}), pattern({ timeZone: 'Europe/London' }))).toBe(false);
    expect(samePattern(null, null)).toBe(true);
    expect(samePattern(pattern({}), null)).toBe(false);
  });
});
