import { describe, expect, it } from 'vitest';

import {
  ALERT_LEAD_OPTIONS,
  REMINDER_DAY_OPTIONS,
  alertLeadLabel,
  formatTime,
  nextAlertLead,
  normalizeTime,
  toggleReminderDay,
} from '../notificationPrefs';

describe('reminder days', () => {
  it('only offers values the profiles table accepts', () => {
    for (const option of REMINDER_DAY_OPTIONS) expect([0, 1, 2, 7]).toContain(option.days);
  });

  it('adds and removes days, sorted longest lead first', () => {
    expect(toggleReminderDay([1], 7)).toEqual([7, 1]);
    expect(toggleReminderDay([7, 1], 0)).toEqual([7, 1, 0]);
    expect(toggleReminderDay([7, 1, 0], 1)).toEqual([7, 0]);
    expect(toggleReminderDay([1], 1)).toEqual([]);
  });
});

describe('reminder time', () => {
  it('normalizes Postgres times', () => {
    expect(normalizeTime('18:00:00')).toBe('18:00');
    expect(normalizeTime('8:00')).toBe('08:00');
  });

  it('formats 12-hour times', () => {
    expect(formatTime('08:00:00')).toBe('8:00 AM');
    expect(formatTime('12:00')).toBe('12:00 PM');
    expect(formatTime('18:00:00')).toBe('6:00 PM');
    expect(formatTime('00:30')).toBe('12:30 AM');
  });
});

describe('admin alert lead time', () => {
  it('defaults to the engine default of 3 days', () => {
    expect(alertLeadLabel(259_200_000)).toBe('3 days before');
  });

  it('cycles through the options and wraps', () => {
    expect(nextAlertLead(ALERT_LEAD_OPTIONS[0].ms)).toBe(ALERT_LEAD_OPTIONS[1].ms);
    expect(nextAlertLead(ALERT_LEAD_OPTIONS[3].ms)).toBe(ALERT_LEAD_OPTIONS[0].ms);
    expect(nextAlertLead(12345)).toBe(ALERT_LEAD_OPTIONS[0].ms);
  });

  it('labels values that are not an option', () => {
    expect(alertLeadLabel(5 * 86_400_000)).toBe('5 days before');
  });
});
