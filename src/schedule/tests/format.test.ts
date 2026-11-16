import { describe, expect, it } from 'vitest';

import {
  addDays,
  dateIn,
  dayOfMonth,
  formatDayLong,
  formatDayShort,
  formatMonthDay,
  formatMonthTitle,
  formatTimeIn,
  formatWhen,
  groupZoneNote,
  monthAbbrev,
  relativeDay,
  safeZone,
  zoneCity,
} from '../format';

describe('dates', () => {
  it('formats civil dates without shifting them', () => {
    expect(formatDayShort('2026-11-22')).toBe('Sun, Nov 22');
    expect(formatDayLong('2026-11-22')).toBe('Sunday, November 22');
    expect(formatMonthDay('2027-01-03')).toBe('Jan 3');
    expect(formatMonthDay('2027-01-03', true)).toBe('Jan 3, 2027');
    expect(monthAbbrev('2026-12-06')).toBe('Dec');
    expect(dayOfMonth('2026-12-06')).toBe(6);
    expect(formatMonthTitle('2026-11')).toBe('November 2026');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('reads instants in a time zone', () => {
    expect(dateIn('2026-11-22T05:30:00.000Z', 'America/Chicago')).toBe('2026-11-21');
    expect(formatTimeIn('2026-11-22T15:00:00.000Z', 'America/Chicago')).toBe('9:00 AM');
    expect(formatTimeIn('2026-11-22T15:00:00.000Z', 'Not/AZone')).toBe('3:00 PM');
    expect(safeZone('Not/AZone')).toBe('UTC');
    expect(zoneCity('America/New_York')).toBe('New York');
  });

  it('labels the Group\'s time when it reads differently from the viewer\'s', () => {
    const at = '2026-11-22T15:00:00.000Z';
    expect(groupZoneNote(at, 'America/Chicago', 'America/Chicago')).toBeNull();
    expect(groupZoneNote(at, 'America/Chicago', 'America/New_York')).toBe('9:00 AM Chicago time');
    // Same clock, different zone names: nothing to say.
    expect(groupZoneNote(at, 'America/Chicago', 'America/Winnipeg')).toBeNull();
    // A different day there.
    expect(groupZoneNote('2026-11-22T03:00:00.000Z', 'America/Chicago', 'Europe/London')).toBe('Sat 9:00 PM Chicago time');
  });

  it('says how far away a day is', () => {
    const today = '2026-11-18';
    expect(relativeDay('2026-11-18', today)).toBe('Today');
    expect(relativeDay('2026-11-19', today)).toBe('Tomorrow');
    expect(relativeDay('2026-11-22', today)).toBe('In 4 days');
    expect(relativeDay('2026-11-25', today)).toBe('In 1 week');
    expect(relativeDay('2026-12-02', today)).toBe('In 2 weeks');
    expect(relativeDay('2026-11-17', today)).toBe('Yesterday');
    expect(relativeDay('2026-11-15', today)).toBe('3 days ago');
  });

  it('says when something happened', () => {
    const now = '2026-11-18T20:00:00.000Z';
    expect(formatWhen('2026-11-18T19:04:00.000Z', now, 'America/Chicago')).toBe('Today · 1:04 PM');
    expect(formatWhen('2026-11-17T19:04:00.000Z', now, 'America/Chicago')).toBe('Yesterday · 1:04 PM');
    expect(formatWhen('2026-11-12T19:04:00.000Z', now, 'America/Chicago')).toBe('Nov 12 · 1:04 PM');
    expect(formatWhen('2025-12-30T19:04:00.000Z', now, 'America/Chicago')).toBe('Dec 30, 2025 · 1:04 PM');
  });
});
