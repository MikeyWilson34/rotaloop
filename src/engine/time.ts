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

/** Whether this Time Off keeps its Member from serving the Responsibility at the Event. */
export function timeOffCovers(timeOff: TimeOff, event: Event, responsibilityId: ResponsibilityId): boolean {
  if (timeOff.responsibilityIds && !timeOff.responsibilityIds.includes(responsibilityId)) return false;
  if (timeOff.removedAt !== null && !timeOff.retainedEventIds.includes(event.id)) return false;
  const at = ms(event.startsAt);
  const start = ms(timeOff.startsAt);
  const length = ms(timeOff.endsAt) - start;
  if (at < start) return false;
  if (!timeOff.repeatEveryWeeks) return at < start + length;
  const period = timeOff.repeatEveryWeeks * WEEK_MS;
  const occurrenceStart = start + Math.floor((at - start) / period) * period;
  if (timeOff.repeatUntil !== null && occurrenceStart > ms(timeOff.repeatUntil)) return false;
  return at < occurrenceStart + length;
}
