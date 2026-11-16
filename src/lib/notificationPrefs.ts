/**
 * Profile notification preferences: the options the prototype's Profile offers and how they
 * map to the `profiles` columns. Pure: unit-tested under Node.
 */

/** "Remind me before an Assignment" chips → `reminder_days_before` values (schema allows 0, 1, 2, 7). */
export const REMINDER_DAY_OPTIONS = [
  { days: 7, label: '1 week before' },
  { days: 2, label: '2 days before' },
  { days: 1, label: '1 day before' },
  { days: 0, label: 'Morning of' },
] as const;

/** "Reminder time" chips → `reminder_time` (a Postgres `time`, local to the profile's time zone). */
export const REMINDER_TIME_OPTIONS = ['08:00', '12:00', '18:00', '20:00'] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** "As an Admin: alert me about Unconfirmed / Needs coverage" → `admin_alert_lead_time_ms`. */
export const ALERT_LEAD_OPTIONS = [
  { ms: 1 * DAY_MS, label: '1 day before' },
  { ms: 2 * DAY_MS, label: '2 days before' },
  { ms: 3 * DAY_MS, label: '3 days before' },
  { ms: 7 * DAY_MS, label: '1 week before' },
] as const;

/** Adds or removes a reminder day, keeping the array unique and sorted longest lead first. */
export function toggleReminderDay(current: readonly number[], days: number): number[] {
  const next = current.includes(days) ? current.filter((d) => d !== days) : [...current, days];
  return [...new Set(next)].sort((a, b) => b - a);
}

/** "18:00:00" or "18:00" → "18:00". */
export function normalizeTime(time: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!match) return time;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

/** "18:00" or "18:00:00" → "6:00 PM". */
export function formatTime(time: string): string {
  const [h, m] = normalizeTime(time).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return time;
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** The option after `currentMs` (wrapping), for the tap-to-cycle Admin alert row. */
export function nextAlertLead(currentMs: number): number {
  const index = ALERT_LEAD_OPTIONS.findIndex((o) => o.ms === currentMs);
  return ALERT_LEAD_OPTIONS[(index + 1) % ALERT_LEAD_OPTIONS.length].ms;
}

export function alertLeadLabel(ms: number): string {
  const option = ALERT_LEAD_OPTIONS.find((o) => o.ms === ms);
  if (option) return option.label;
  const days = Math.round(ms / DAY_MS);
  return days === 1 ? '1 day before' : `${days} days before`;
}
