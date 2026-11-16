/**
 * The Skip Date flow's view models: the upcoming Events to pick from, the reason, and the
 * before/after preview, computed by running the engine's `addSkipDate` on the loaded state
 * without saving it.
 *
 * Pure TypeScript (engine imports only), so it is unit-tested under Node.
 */
import { applyCommand } from '../engine/commands';
import type { Event, GroupState, Instant, MemberId } from '../engine/types';
import { dateIn } from './format';
import { slotView, type ScheduleGroup, type SkipDateView } from './views';

/** The reason chips, in the prototype's order. */
export const SKIP_REASONS = ['Holiday', 'Closure', 'Special event', 'Other'] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** The longest reason the server accepts. */
export const MAX_SKIP_REASON_LENGTH = 300;

/**
 * The reason as stored: "Holiday", "Holiday: Building closed", or just the details for
 * "Other". Null when there is neither.
 */
export function skipReasonText(chip: SkipReason | null, details: string): string | null {
  const text = details.trim().replace(/\s+/g, ' ');
  if (!chip) return text || null;
  if (!text) return chip;
  if (chip === 'Other') return text;
  return `${chip}: ${text}`;
}

/** The sentence on a Skip Date card: "No one needed. Holiday: Building closed. Marked by Ben. Turns move forward one Event." */
export function skipDateText(skip: SkipDateView): string {
  const reason = skip.reason?.trim().replace(/[.!\s]+$/, '');
  const parts = ['No one needed.'];
  if (reason) parts.push(`${reason}.`);
  if (skip.markedBy) parts.push(`Marked by ${skip.markedBy}.`);
  parts.push('Turns move forward one Event.');
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Step 1: which Event

export type SkipCandidate = {
  eventId: string;
  startsAt: Instant;
  /** The Event's date in the viewer's time zone. */
  date: string;
  /** Who serves, e.g. "Ana, Ben" ("You" for the viewer); "No one yet" when empty. */
  who: string;
};

function upcomingEvents(state: GroupState, now: Instant): Event[] {
  const t = Date.parse(now);
  return state.events
    .filter((e) => Date.parse(e.startsAt) > t)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));
}

function seatLabels(group: ScheduleGroup, state: GroupState, event: Event, responsibilityId: string, now: Instant): string[] {
  const view = { ...group, state };
  return state.assignments
    .filter((a) => a.eventId === event.id && a.responsibilityId === responsibilityId)
    .map((a) => slotView(view, a, event.startsAt, now).whoLabel);
}

/** Upcoming Events that aren't Skip Dates yet, soonest first. */
export function skipCandidates(group: ScheduleGroup, now: Instant, viewerTimeZone: string, limit = 8): SkipCandidate[] {
  const { state } = group;
  return upcomingEvents(state, now)
    .filter((e) => !e.skipDate)
    .slice(0, limit)
    .map((event) => {
      const names = state.responsibilities.flatMap((r) => seatLabels(group, state, event, r.id, now));
      const unique = [...new Set(names.filter((n) => n !== 'Open'))];
      return {
        eventId: event.id,
        startsAt: event.startsAt,
        date: dateIn(event.startsAt, viewerTimeZone),
        who: unique.length ? unique.join(', ') : 'No one yet',
      };
    });
}

// ---------------------------------------------------------------------------
// Step 3: the preview

export type SkipPreviewRow = {
  responsibilityId: string;
  responsibilityName: string;
  /** "Ana", "Ana + Ben", "You", or null for no one. */
  before: string | null;
  after: string | null;
  changed: boolean;
};

export type SkipPreviewEvent = {
  eventId: string;
  date: string;
  /** The Event that becomes the Skip Date. */
  skipped: boolean;
  rows: SkipPreviewRow[];
};

export type SkipPreview =
  | {
      ok: true;
      events: SkipPreviewEvent[];
      /** People whose Assignments change (moved, added or removed). */
      affected: number;
      /** The viewer is among them. */
      includesMe: boolean;
    }
  | { ok: false; reason: string };

/**
 * What adding a Skip Date on `eventId` would do to the next `count` Events from it: the engine
 * runs on the loaded state, nothing is saved.
 */
export function skipPreview(
  group: ScheduleGroup,
  eventId: string,
  reason: string | null,
  now: Instant,
  viewerTimeZone: string,
  count = 5,
): SkipPreview {
  const result = applyCommand(group.state, { type: 'addSkipDate', eventId, reason }, { now, actorId: group.myMemberId });
  if (!result.ok) return { ok: false, reason: result.reason };
  const before = group.state;
  const after = result.state;
  const all = upcomingEvents(before, now).filter((e) => !e.skipDate);
  const start = all.findIndex((e) => e.id === eventId);
  const shown = start < 0 ? [] : all.slice(start, start + count);
  const responsibilities = before.responsibilities.filter((r) => r.removedAt === null);
  const label = (names: string[]) => (names.length ? names.join(' + ') : null);
  const events = shown.map((event): SkipPreviewEvent => {
    const skipped = event.id === eventId;
    const rows = responsibilities
      .map((r) => {
        const b = label(seatLabels(group, before, event, r.id, now));
        const a = skipped ? null : label(seatLabels(group, after, event, r.id, now));
        return { responsibilityId: r.id, responsibilityName: r.name, before: b, after: a, changed: b !== a };
      })
      .filter((row) => row.before !== null || row.after !== null);
    return { eventId: event.id, date: dateIn(event.startsAt, viewerTimeZone), skipped, rows };
  });
  const people = new Set<MemberId>();
  for (const c of result.changes) {
    if (c.before?.memberId) people.add(c.before.memberId);
    if (c.after?.memberId) people.add(c.after.memberId);
  }
  return {
    ok: true,
    events,
    affected: people.size,
    includesMe: group.myMemberId !== null && people.has(group.myMemberId),
  };
}

/** "1 person affected", "4 people affected". */
export function affectedLabel(n: number): string {
  return `${n} ${n === 1 ? 'person' : 'people'} affected`;
}
