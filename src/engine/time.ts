import type { Event, Instant, ResponsibilityId, TimeOff } from './types';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function ms(instant: Instant): number {
  const value = Date.parse(instant);
  if (Number.isNaN(value)) throw new Error(`Not an ISO 8601 instant: ${instant}`);
  return value;
}

export function laterOf(a: Instant, b: Instant | null): Instant {
  return b !== null && ms(b) > ms(a) ? b : a;
}

/** Chronological Event order, ties broken by id so the order is total. */
export function compareEvents(a: Event, b: Event): number {
  return ms(a.startsAt) - ms(b.startsAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function isPast(event: Event, now: Instant): boolean {
  return ms(event.startsAt) <= ms(now);
}

// ---------------------------------------------------------------------------
// Local wall-clock time (only the built-in Intl API, so it runs in Node, Deno and Hermes)

const wallFormats = new Map<string, Intl.DateTimeFormat>();

function wallFormat(timeZone: string): Intl.DateTimeFormat {
  let f = wallFormats.get(timeZone);
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
    wallFormats.set(timeZone, f);
  }
  return f;
}

/** Whether the runtime knows this IANA time zone. */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    wallFormat(timeZone);
    return true;
  } catch {
    return false;
  }
}

const wallCache = new Map<string, number>();

/**
 * What the clock in `timeZone` reads at `instant`, as milliseconds on a clock with no
 * daylight-saving jumps (the reading taken as if it were UTC). Whole weeks on this clock
 * keep the same local time of day.
 */
export function wallClockMs(instant: Instant, timeZone: string): number {
  const key = `${timeZone}|${instant}`;
  const cached = wallCache.get(key);
  if (cached !== undefined) return cached;
  const t = ms(instant);
  const parts: Record<string, number> = {};
  for (const p of wallFormat(timeZone).formatToParts(new Date(t))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const hour = parts.hour === 24 ? 0 : parts.hour;
  const wall =
    Date.UTC(parts.year, parts.month - 1, parts.day, hour, parts.minute, parts.second) + (((t % 1000) + 1000) % 1000);
  if (wallCache.size > 20_000) wallCache.clear();
  wallCache.set(key, wall);
  return wall;
}

/** Whether this Time Off keeps its Member from serving the Responsibility at the Event. */
export function timeOffCovers(timeOff: TimeOff, event: Event, responsibilityId: ResponsibilityId): boolean {
  if (timeOff.responsibilityIds && !timeOff.responsibilityIds.includes(responsibilityId)) return false;
  if (timeOff.removedAt !== null && !timeOff.retainedEventIds.includes(event.id)) return false;
  if (!timeOff.repeatEveryWeeks) {
    const at = ms(event.startsAt);
    return at >= ms(timeOff.startsAt) && at < ms(timeOff.endsAt);
  }
  // A repeat counts whole weeks on the Group's wall clock, so it keeps its local time.
  const zone = timeOff.timeZone;
  const clock = (instant: Instant) => (zone ? wallClockMs(instant, zone) : ms(instant));
  const at = clock(event.startsAt);
  const start = clock(timeOff.startsAt);
  const length = clock(timeOff.endsAt) - start;
  if (at < start) return false;
  const period = timeOff.repeatEveryWeeks * WEEK_MS;
  const occurrenceStart = start + Math.floor((at - start) / period) * period;
  if (timeOff.repeatUntil !== null && occurrenceStart > clock(timeOff.repeatUntil)) return false;
  return at < occurrenceStart + length;
}
