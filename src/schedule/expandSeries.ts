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
 *   one (-1), for each of `daysOfWeek`.
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
      return null;
  }
}

/** The day number of the Sunday starting the pattern's first week. */
function anchorWeek(pattern: RepeatPattern): number {
  const start = dayNumber(pattern.startsOn);
  for (let d = start; d < start + 7; d++) {
    if (pattern.daysOfWeek.includes(weekdayOf(d))) return d - weekdayOf(d);
  }
  return start - weekdayOf(start);
}

/** Whether the pattern happens on this local calendar day (ignoring `startsOn`). */
function happensOn(pattern: RepeatPattern, day: number, anchor: number): boolean {
  const weekday = weekdayOf(day);
  if (!pattern.daysOfWeek.includes(weekday)) return false;
  const step = stepWeeks(pattern);
  if (step !== null) {
    const weeks = Math.floor((day - weekday - anchor) / 7);
    return weeks >= 0 && weeks % step === 0;
  }
  const [year, month, dom] = dateOf(day).split('-').map(Number);
  if (pattern.weekOfMonth === -1) return dom + 7 > daysInMonth(year, month);
  return Math.floor((dom - 1) / 7) + 1 === pattern.weekOfMonth;
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
  const last = dayNumber(localDate(until, pattern.timeZone)) + 1;
  const result: Instant[] = [];
  for (let day = first; day <= last; day++) {
    if (!happensOn(pattern, day, anchor)) continue;
    const at = zonedTimeToInstant(dateOf(day), pattern.startTime, pattern.timeZone);
    const t = Date.parse(at);
    if (t > from && t <= to) result.push(at);
  }
  return result;
}

/** The next `count` occurrences after `after` (looking up to about two years ahead). For previews. */
export function nextOccurrences(pattern: RepeatPattern, after: Instant, count: number): Instant[] {
  const result: Instant[] = [];
  let from = after;
  for (let i = 0; i < 8 && result.length < count; i++) {
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
    a.startTime === b.startTime &&
    a.timeZone === b.timeZone &&
    a.startsOn === b.startsOn &&
    [...a.daysOfWeek].sort().join() === [...b.daysOfWeek].sort().join()
  );
}
