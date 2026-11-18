/**
 * Turning an Event Series' repeat pattern into Events.
 *
 * Pure TypeScript with no imports beyond engine types, so it runs in the app (previews), in
 * Node tests and in the `group-command` Edge Function (Deno; synced by
 * scripts/sync-functions-shared.mjs). Time-zone maths uses only the built-in `Intl` API
 * (full ICU in Node, Deno and Hermes), so a pattern such as "Sundays 9:00am America/Chicago"
 * stays at 9:00 local time on both sides of a daylight-saving change.
 *
 * Rules:
 * - Occurrences fall on the pattern's local calendar dates at `startTime` in `timeZone`,
 *   never before `startsOn`.
 * - `weekly` is every week; `biweekly` every 2 weeks; `custom` every `intervalWeeks` weeks.
 *   Weeks run Sunday to Saturday, and the counting starts from the week of the first
 *   matching day on or after `startsOn` (so "every other Sunday from Wed Nov 18" starts on
 *   Sun Nov 22).
 * - `monthly` is the `weekOfMonth`-th matching weekday of each month (1-4), or the last
 *   one (-1), for each of `daysOfWeek`; or, with `dayOfMonth`, that date, using the last day
 *   of months that don't have it (the 31st is Apr 30 and Feb 28 or 29). With
 *   `intervalMonths` it is every that many months, counting from `startsOn`'s month (which
 *   counts even when its matching day falls before `startsOn`).
 * - `daily` is every `intervalDays` days from `startsOn` itself.
 * - `endsOn` is the last local date an occurrence can fall on. `endsAfter` stops after that
 *   many occurrences, counted from `startsOn` by the pattern alone, whatever Events exist:
 *   so expanding again on a later horizon never makes more, and an Event marked as a Skip
 *   Date still counts as one of them.
 * - A local time that doesn't exist (the hour skipped when clocks go forward) moves forward
 *   by the gap, e.g. 2:30 becomes 3:30. A local time that happens twice (clocks go back)
 *   uses the first one. This matches Temporal's "compatible" disambiguation.
 */
import type { Event, EventSeriesId, Instant, NewEvent, RepeatPattern } from '../engine/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** How far ahead a series' Events are kept: about 12 weeks. */
export const HORIZON_WEEKS = 12;

/** The end of the rolling horizon from `now`. */
export function horizonEnd(now: Instant, weeks: number = HORIZON_WEEKS): Instant {
  return new Date(Date.parse(now) + weeks * WEEK_MS).toISOString();
}

// ---------------------------------------------------------------------------
// Civil dates ("YYYY-MM-DD") as day numbers (days since 1970-01-01)

export function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function dateOf(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(day: number): number {
  return (((day + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// ---------------------------------------------------------------------------
// Time zones

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Whether `timeZone` is an IANA zone this runtime knows. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The local wall-clock time at instant `t` (ms), as if it were UTC (ms). */
function wallClock(t: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(t))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const hour = parts.hour === 24 ? 0 : parts.hour;
  return Date.UTC(parts.year, parts.month - 1, parts.day, hour, parts.minute, parts.second);
}

/** The zone's offset from UTC at instant `t`, in ms (e.g. -6h for Chicago in winter). */
export function offsetAt(t: number, timeZone: string): number {
  const whole = Math.floor(t / 1000) * 1000;
  return wallClock(whole, timeZone) - whole;
}

/**
 * The instant at which the clock in `timeZone` reads `date` `time` ("YYYY-MM-DD", "HH:MM").
 * Skipped times move forward by the gap; repeated times use the earlier instant.
 */
export function zonedTimeToInstant(date: string, time: string, timeZone: string): Instant {
  const [h, m] = time.split(':').map(Number);
  const wall = dayNumber(date) * DAY_MS + (h * 60 + m) * 60_000;
  // Offsets a day either side: a zone changes offset at most once in that window.
  const before = offsetAt(wall - DAY_MS, timeZone);
  const after = offsetAt(wall + DAY_MS, timeZone);
  const candidates = [...new Set([wall - before, wall - after])]
    .filter((t) => wallClock(t, timeZone) === wall)
    .sort((a, b) => a - b);
  // No candidate: the time was skipped. Using the offset from before the change moves it
  // forward by the gap.
  const t = candidates.length > 0 ? candidates[0] : wall - before;
  return new Date(t).toISOString();
}

/** The local date ("YYYY-MM-DD") in `timeZone` at `instant`. */
export function localDate(instant: Instant, timeZone: string): string {
  return new Date(wallClock(Date.parse(instant), timeZone)).toISOString().slice(0, 10);
}

/** The local time ("HH:MM") in `timeZone` at `instant`. */
export function localTime(instant: Instant, timeZone: string): string {
  return new Date(wallClock(Date.parse(instant), timeZone)).toISOString().slice(11, 16);
}

// ---------------------------------------------------------------------------
// Occurrences

function stepWeeks(pattern: RepeatPattern): number | null {
  switch (pattern.frequency) {
    case 'weekly':
      return 1;
    case 'biweekly':
      return 2;
    case 'custom':
      return pattern.intervalWeeks ?? 1;
    case 'monthly':
    case 'daily':
      return null;
  }
}

const monthIndex = (year: number, month: number) => year * 12 + (month - 1);

/** The day number of the Sunday starting the pattern's first week. */
function anchorWeek(pattern: RepeatPattern): number {
  const start = dayNumber(pattern.startsOn);
  for (let d = start; d < start + 7; d++) {
    if (pattern.daysOfWeek.includes(weekdayOf(d))) return d - weekdayOf(d);
  }
  return start - weekdayOf(start);
}

/** Whether the pattern happens on this local calendar day (ignoring `startsOn` and the end). */
function happensOn(pattern: RepeatPattern, day: number, anchor: number): boolean {
  if (pattern.frequency === 'daily') {
    const since = day - dayNumber(pattern.startsOn);
    return since >= 0 && since % (pattern.intervalDays ?? 1) === 0;
  }
  const weekday = weekdayOf(day);
  const step = stepWeeks(pattern);
  if (step !== null) {
    if (!pattern.daysOfWeek.includes(weekday)) return false;
    const weeks = Math.floor((day - weekday - anchor) / 7);
    return weeks >= 0 && weeks % step === 0;
  }
  const [year, month, dom] = dateOf(day).split('-').map(Number);
  const [startYear, startMonth] = pattern.startsOn.split('-').map(Number);
  const months = monthIndex(year, month) - monthIndex(startYear, startMonth);
  if (months < 0 || months % (pattern.intervalMonths ?? 1) !== 0) return false;
  if (pattern.dayOfMonth != null) return dom === Math.min(pattern.dayOfMonth, daysInMonth(year, month));
  if (!pattern.daysOfWeek.includes(weekday)) return false;
  if (pattern.weekOfMonth === -1) return dom + 7 > daysInMonth(year, month);
  return Math.floor((dom - 1) / 7) + 1 === pattern.weekOfMonth;
}

/** The days (day numbers, in order) the pattern happens on in one calendar month. */
function daysInMonthOf(pattern: RepeatPattern, year: number, month: number): number[] {
  const first = dayNumber(`${year}-${String(month).padStart(2, '0')}-01`);
  const length = daysInMonth(year, month);
  if (pattern.dayOfMonth != null) return [first + Math.min(pattern.dayOfMonth, length) - 1];
  return pattern.daysOfWeek
    .map((weekday) => {
      const firstDom = 1 + ((weekday - weekdayOf(first) + 7) % 7);
      const dom = pattern.weekOfMonth === -1 ? firstDom + 7 * Math.floor((length - firstDom) / 7) : firstDom + 7 * ((pattern.weekOfMonth ?? 1) - 1);
      return first + dom - 1;
    })
    .sort((a, b) => a - b);
}

/**
 * The day of the pattern's `n`-th occurrence (1-based), counting from `startsOn`. Steps a
 * week or a month at a time, so even "every 12 months, 500 times" is quick.
 */
function nthOccurrenceDay(pattern: RepeatPattern, n: number): number {
  const start = dayNumber(pattern.startsOn);
  if (pattern.frequency === 'daily') return start + (n - 1) * (pattern.intervalDays ?? 1);
  // A malformed pattern with no days never happens (the engine rejects it anyway).
  if (pattern.dayOfMonth == null && pattern.daysOfWeek.length === 0) return start - 1;
  let seen = 0;
  const step = stepWeeks(pattern);
  if (step !== null) {
    const days = [...pattern.daysOfWeek].sort((a, b) => a - b);
    for (let week = anchorWeek(pattern); ; week += 7 * step) {
      for (const d of days) {
        if (week + d >= start && ++seen === n) return week + d;
      }
    }
  }
  const [startYear, startMonth] = pattern.startsOn.split('-').map(Number);
  for (let m = monthIndex(startYear, startMonth); ; m += pattern.intervalMonths ?? 1) {
    for (const day of daysInMonthOf(pattern, Math.floor(m / 12), (m % 12) + 1)) {
      if (day >= start && ++seen === n) return day;
    }
  }
}

/** The last local day the pattern can happen on, or null when it never ends. */
function endDay(pattern: RepeatPattern): number | null {
  if (pattern.endsOn != null) return dayNumber(pattern.endsOn);
  if (pattern.endsAfter != null) return nthOccurrenceDay(pattern, pattern.endsAfter);
  return null;
}

/**
 * The local date ("YYYY-MM-DD") of the pattern's last Event, or null when it never ends
 * (or ends before it starts). For the editor's preview.
 */
export function lastOccurrenceDate(pattern: RepeatPattern): string | null {
  const end = endDay(pattern);
  if (end === null) return null;
  const start = dayNumber(pattern.startsOn);
  const anchor = anchorWeek(pattern);
  // The longest gap between two occurrences is a year (every 12 months, or 52 weeks).
  for (let day = end; day >= start && day > end - 400; day--) {
    if (happensOn(pattern, day, anchor)) return dateOf(day);
  }
  return null;
}

/**
 * Every occurrence's start, in order, strictly after `after` and at or before `until`.
 */
export function occurrencesBetween(pattern: RepeatPattern, after: Instant, until: Instant): Instant[] {
  const from = Date.parse(after);
  const to = Date.parse(until);
  if (!(to > from)) return [];
  const anchor = anchorWeek(pattern);
  const first = Math.max(dayNumber(localDate(after, pattern.timeZone)) - 1, dayNumber(pattern.startsOn));
  const end = endDay(pattern);
  const last = Math.min(dayNumber(localDate(until, pattern.timeZone)) + 1, end ?? Infinity);
  const result: Instant[] = [];
  for (let day = first; day <= last; day++) {
    if (!happensOn(pattern, day, anchor)) continue;
    const at = zonedTimeToInstant(dateOf(day), pattern.startTime, pattern.timeZone);
    const t = Date.parse(at);
    if (t > from && t <= to) result.push(at);
  }
  return result;
}

/**
 * The next `count` occurrences after `after`, for previews. Looks up to about two years
 * ahead, or ten for patterns that repeat every few months.
 */
export function nextOccurrences(pattern: RepeatPattern, after: Instant, count: number): Instant[] {
  const result: Instant[] = [];
  const end = endDay(pattern);
  const chunks = pattern.frequency === 'monthly' && (pattern.intervalMonths ?? 1) > 1 ? 40 : 8;
  let from = after;
  for (let i = 0; i < chunks && result.length < count; i++) {
    if (end !== null && dayNumber(localDate(from, pattern.timeZone)) > end + 1) break;
    const until = new Date(Date.parse(from) + 13 * WEEK_MS).toISOString();
    result.push(...occurrencesBetween(pattern, from, until));
    from = until;
  }
  return result.slice(0, count);
}

// ---------------------------------------------------------------------------
// Events

/** A series Event's id: the series plus its UTC start, e.g. "s1@20261122T1500Z". */
export function seriesEventId(seriesId: EventSeriesId, startsAt: Instant): string {
  const iso = new Date(Date.parse(startsAt)).toISOString();
  return `${seriesId}@${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}Z`;
}

export interface ExpandInput {
  seriesId: EventSeriesId;
  pattern: RepeatPattern;
  /** The Group's current Events (any series, and one-offs): used to avoid duplicates and id clashes. */
  existing: readonly Pick<Event, 'id' | 'seriesId' | 'startsAt'>[];
  /** Only Events after this instant are made. */
  now: Instant;
  /** The horizon end (inclusive), usually `horizonEnd(now)`. */
  until: Instant;
}

function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/**
 * The Events to add so the series has every occurrence in `(now, until]`. Occurrences the
 * series already has an Event at (same instant) are skipped, so running it again, or with
 * a later horizon, never duplicates.
 */
export function expandSeries(input: ExpandInput): NewEvent[] {
  const have = new Set(
    input.existing.filter((e) => e.seriesId === input.seriesId).map((e) => Date.parse(e.startsAt)),
  );
  const taken = new Set(input.existing.map((e) => e.id));
  return occurrencesBetween(input.pattern, input.now, input.until)
    .filter((at) => !have.has(Date.parse(at)))
    .map((startsAt) => ({ id: uniqueId(seriesEventId(input.seriesId, startsAt), taken), seriesId: input.seriesId, startsAt }));
}

/**
 * The series' complete list of future Events under a (new) pattern, for
 * `editEventSeries.replaceFutureEvents`. An existing future Event at the same instant keeps
 * its id (so its Assignments, confirmations and Skip Date stay); the engine removes the
 * series' other future Events and adds the new ones. The horizon reaches at least as far as
 * the series' furthest existing Event.
 */
export function replacementEvents(input: ExpandInput): NewEvent[] {
  const now = Date.parse(input.now);
  const future = input.existing.filter((e) => e.seriesId === input.seriesId && Date.parse(e.startsAt) > now);
  const furthest = Math.max(Date.parse(input.until), ...future.map((e) => Date.parse(e.startsAt)));
  const byInstant = new Map(future.map((e) => [Date.parse(e.startsAt), e.id]));
  const taken = new Set(input.existing.map((e) => e.id));
  return occurrencesBetween(input.pattern, input.now, new Date(furthest).toISOString()).map((startsAt) => {
    const kept = byInstant.get(Date.parse(startsAt));
    return {
      id: kept ?? uniqueId(seriesEventId(input.seriesId, startsAt), taken),
      seriesId: input.seriesId,
      startsAt,
    };
  });
}

/** Whether two patterns produce the same dates and times (name and Responsibilities aside). */
export function samePattern(a: RepeatPattern | null, b: RepeatPattern | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.frequency === b.frequency &&
    a.intervalWeeks === b.intervalWeeks &&
    a.weekOfMonth === b.weekOfMonth &&
    (a.intervalDays ?? null) === (b.intervalDays ?? null) &&
    (a.dayOfMonth ?? null) === (b.dayOfMonth ?? null) &&
    (a.intervalMonths ?? 1) === (b.intervalMonths ?? 1) &&
    (a.endsOn ?? null) === (b.endsOn ?? null) &&
    (a.endsAfter ?? null) === (b.endsAfter ?? null) &&
    a.startTime === b.startTime &&
    a.timeZone === b.timeZone &&
    a.startsOn === b.startsOn &&
    [...a.daysOfWeek].sort().join() === [...b.daysOfWeek].sort().join()
  );
}
