/**
 * Profile notification preferences: the options the prototype's Profile offers and how they
 * map to the `profiles` columns. Pure: unit-tested under Node.
 */
import { MORNING_OF_TIME } from '../notify/plan';

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

// ---------------------------------------------------------------------------
// "We'll remind you…" (Home's hero, ticket 11)

/** The morning time "Morning of" reminders use (the notify planner's rule). */
function morningOfTime(reminderTime: string): string {
  const time = normalizeTime(reminderTime);
  return time < '12:00' ? time : MORNING_OF_TIME;
}

const OFFSET_PHRASE: Record<number, string> = { 7: 'a week before', 2: '2 days before', 1: 'the day before', 0: 'the morning of' };

function joinAnd(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The person's reminder settings as one sentence, e.g. "We'll remind you the day before at
 * 6:00 PM." or "We'll remind you a week before and the day before at 6:00 PM, and the morning
 * of at 7:00 AM." Matches what the notify planner sends (src/notify/plan.ts).
 */
export function reminderSummary(prefs: { push_enabled: boolean; reminder_days_before: readonly number[]; reminder_time: string }): string {
  if (!prefs.push_enabled) return 'Reminders are off: turn on push notifications in Profile to get them.';
  const days = [...new Set(prefs.reminder_days_before)].filter((d) => d in OFFSET_PHRASE).sort((a, b) => b - a);
  if (days.length === 0) return 'You have no reminders set. Choose some in Profile.';
  const time = formatTime(prefs.reminder_time);
  const morning = formatTime(morningOfTime(prefs.reminder_time));
  const before = days.filter((d) => d > 0).map((d) => OFFSET_PHRASE[d]);
  const groups: string[] = [];
  if (days.includes(0) && morning === time) {
    groups.push(`${joinAnd([...before, OFFSET_PHRASE[0]])} at ${time}`);
  } else {
    if (before.length) groups.push(`${joinAnd(before)} at ${time}`);
    if (days.includes(0)) groups.push(`${OFFSET_PHRASE[0]} at ${morning}`);
  }
  return `We'll remind you ${groups.join(', and ')}.`;
}
