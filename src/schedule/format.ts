/**
 * Plain-language dates and times for the schedule views, in a given time zone.
 *
 * Pure TypeScript (only `Intl`), like the rest of src/schedule. Civil dates are
 * "YYYY-MM-DD" strings in the viewer's time zone; instants are ISO UTC strings.
 */
import type { Instant } from '../engine/types';
import { dateOf, dayNumber, isValidTimeZone, localDate, localTime } from './expandSeries';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A known time zone, or UTC. */
export function safeZone(timeZone: string): string {
  return isValidTimeZone(timeZone) ? timeZone : 'UTC';
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();
function formatCivil(date: string, options: Intl.DateTimeFormatOptions): string {
  const key = JSON.stringify(options);
  let f = dateFormats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' });
    dateFormats.set(key, f);
  }
  return f.format(new Date(dayNumber(date) * DAY_MS + 12 * 60 * 60 * 1000));
}

/** "Sun, Nov 22". */
export function formatDayShort(date: string): string {
  return formatCivil(date, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "Sunday, November 22". */
export function formatDayLong(date: string): string {
  return formatCivil(date, { weekday: 'long', month: 'long', day: 'numeric' });
}

/** "Nov 22", or "Nov 22, 2027" when `withYear`. */
export function formatMonthDay(date: string, withYear = false): string {
  return formatCivil(date, withYear ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' });
}

/** "Nov", the short month name of a date (date box). */
export function monthAbbrev(date: string): string {
  return formatCivil(date, { month: 'short' });
}

/** The day of the month, e.g. 22. */
export function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10));
}

/** "November 2026" for "2026-11". */
export function formatMonthTitle(month: string): string {
  return formatCivil(`${month}-01`, { month: 'long', year: 'numeric' });
}

/** "9:00 AM" for "09:00". */
export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** The local time of an instant in a zone: "9:00 AM". */
export function formatTimeIn(instant: Instant, timeZone: string): string {
  return formatClock(localTime(instant, safeZone(timeZone)));
}

/** The local date of an instant in a zone. */
export function dateIn(instant: Instant, timeZone: string): string {
  return localDate(instant, safeZone(timeZone));
}

/** "America/Chicago" → "Chicago". */
export function zoneCity(timeZone: string): string {
  const parts = timeZone.split('/');
  return parts[parts.length - 1].replace(/_/g, ' ');
}

/**
 * When the Group keeps its schedule in another time zone than the viewer's and the clock
 * reads differently there: "10:00 AM Chicago time" (plus the day when it differs, e.g.
 * "Sat 11:00 PM Chicago time"). Otherwise null.
 */
export function groupZoneNote(instant: Instant, groupTimeZone: string, viewerTimeZone: string): string | null {
  const group = safeZone(groupTimeZone);
  const viewer = safeZone(viewerTimeZone);
  if (group === viewer) return null;
  const groupDate = localDate(instant, group);
  const groupTime = localTime(instant, group);
  if (groupDate === localDate(instant, viewer) && groupTime === localTime(instant, viewer)) return null;
  const day = groupDate === localDate(instant, viewer) ? '' : `${formatCivil(groupDate, { weekday: 'short' })} `;
  return `${day}${formatClock(groupTime)} ${zoneCity(group)} time`;
}

/** Days from `today` to `date` (both civil dates). */
export function daysBetween(today: string, date: string): number {
  return dayNumber(date) - dayNumber(today);
}

/** "Today", "Tomorrow", "In 5 days", "In 1 week", "In 2 weeks", "Yesterday", "3 days ago". */
export function relativeDay(date: string, today: string): string {
  const n = daysBetween(today, date);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n < 0) return `${-n} days ago`;
  if (n % 7 === 0) return n === 7 ? 'In 1 week' : `In ${n / 7} weeks`;
  return `In ${n} days`;
}

/** "Today · 3:04 PM", "Yesterday · 3:04 PM", "Nov 12 · 3:04 PM" (with the year when not this year). */
export function formatWhen(instant: Instant, now: Instant, timeZone: string): string {
  const zone = safeZone(timeZone);
  const date = localDate(instant, zone);
  const today = localDate(now, zone);
  const n = daysBetween(today, date);
  const day =
    n === 0 ? 'Today' : n === -1 ? 'Yesterday' : formatMonthDay(date, date.slice(0, 4) !== today.slice(0, 4));
  return `${day} · ${formatTimeIn(instant, zone)}`;
}

/** The civil date `n` days after `date`. */
export function addDays(date: string, n: number): string {
  return dateOf(dayNumber(date) + n);
}
