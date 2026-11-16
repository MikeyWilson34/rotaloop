/**
 * What the schedule screens show, derived from engine state: each Assignment's status
 * (through the engine's `assignmentStatus`), who fills it, Events with their rows, Skip
 * Dates, "Just me" vs "Everyone", weeks and month cells in the viewer's time zone.
 *
 * Pure TypeScript: no React, Supabase or clock reads (callers pass `now` and the viewer's
 * time zone), so it is unit-tested under Node.
 */
import { assignmentStatus } from '../engine/status';
import type { Assignment, AssignmentStatus, Event, GroupState, Instant, MemberId } from '../engine/types';
import { dateOf, dayNumber, weekdayOf } from './expandSeries';
import { addDays, dateIn, daysBetween, formatMonthDay } from './format';

// ---------------------------------------------------------------------------
// Inputs

/**
 * One Group as the schedule views see it. `state` may hold only part of the Group (the
 * cross-group schedule loads upcoming Events and their Assignments only).
 */
export type ScheduleGroup = {
  id: string;
  name: string;
  timeZone: string;
  state: GroupState;
  /** The viewer's active Member in this Group, or null. */
  myMemberId: MemberId | null;
};

// ---------------------------------------------------------------------------
// Status

/**
 * The statuses the app shows (design-system §2). The engine's "Unconfirmed" is an Admin
 * alert about a missing confirmation, so it is shown as "Pending" (still awaiting it).
 */
export type DisplayStatus = 'confirmed' | 'pending' | 'needsCoverage' | 'covered' | 'scheduled';

const STATUS_LABELS: Record<DisplayStatus, string> = {
  confirmed: 'Confirmed',
  pending: 'Pending',
  needsCoverage: 'Needs coverage',
  covered: 'Covered',
  scheduled: 'Scheduled',
};

/** "Needs coverage", for screen readers next to a status dot. */
export function displayStatusLabel(status: DisplayStatus): string {
  return STATUS_LABELS[status];
}

export function displayStatus(status: AssignmentStatus): DisplayStatus {
  return status === 'unconfirmed' ? 'pending' : status;
}

/** The status shown for an Assignment at an Event starting at `startsAt`. */
export function slotStatus(assignment: Assignment, startsAt: Instant, now: Instant): DisplayStatus {
  return displayStatus(assignmentStatus(assignment, startsAt, now));
}

// ---------------------------------------------------------------------------
// One Assignment

export type Who =
  | { kind: 'member'; memberId: MemberId; name: string; isMe: boolean }
  | { kind: 'guest'; name: string }
  | { kind: 'open' };

export type SlotView = {
  /** `${groupId}/${assignmentId}`: unique across Groups. */
  key: string;
  groupId: string;
  assignmentId: string;
  eventId: string;
  responsibilityId: string;
  responsibilityName: string;
  startsAt: Instant;
  status: DisplayStatus;
  who: Who;
  /** "You", "Sam", "Pat (guest)" or "Open". */
  whoLabel: string;
  /** For a covered Assignment: whose it was ("you" or a name). */
  coveredFor: string | null;
  /** For a Coverage Request: who asked ("you" or a name). */
  requestedBy: string | null;
  /** The viewer fills this seat (including while asking for coverage, and when covering). */
  mine: boolean;
  /** The viewer covers someone else's Assignment. */
  covering: boolean;
  /** This Assignment pays a Make-up Turn. */
  makeUpTurn: boolean;
};

const memberName = (state: GroupState, id: MemberId | null): string | null =>
  id === null ? null : (state.members.find((m) => m.id === id)?.name ?? 'Former Member');

function personLabel(state: GroupState, id: MemberId | null, me: MemberId | null, you: string): string | null {
  if (id === null) return null;
  return id === me ? you : memberName(state, id);
}

export function slotView(group: ScheduleGroup, assignment: Assignment, startsAt: Instant, now: Instant): SlotView {
  const { state, myMemberId: me } = group;
  const cover = assignment.coverageRequest?.cover ?? null;
  let who: Who;
  if (cover?.kind === 'guest') who = { kind: 'guest', name: cover.guestName };
  else if (assignment.coverageRequest && !cover) {
    // A Coverage Request: the seat is open until someone covers it (`requestedBy` says whose it was).
    who = { kind: 'open' };
  } else if (assignment.memberId !== null) {
    who = {
      kind: 'member',
      memberId: assignment.memberId,
      name: memberName(state, assignment.memberId) ?? '',
      isMe: assignment.memberId === me,
    };
  } else who = { kind: 'open' };
  const request = assignment.coverageRequest;
  const askedBy = request ? (request.requestedBy ?? assignment.turnOf) : null;
  return {
    key: `${group.id}/${assignment.id}`,
    groupId: group.id,
    assignmentId: assignment.id,
    eventId: assignment.eventId,
    responsibilityId: assignment.responsibilityId,
    responsibilityName: state.responsibilities.find((r) => r.id === assignment.responsibilityId)?.name ?? 'Responsibility',
    startsAt,
    status: slotStatus(assignment, startsAt, now),
    who,
    whoLabel: whoLabel(who),
    coveredFor: cover ? personLabel(state, askedBy, me, 'you') : null,
    requestedBy: request && !cover ? personLabel(state, askedBy, me, 'you') : null,
    mine: me !== null && assignment.memberId === me,
    covering: me !== null && cover?.kind === 'member' && cover.memberId === me && askedBy !== me,
    makeUpTurn: assignment.makeUpTurnId !== null,
  };
}

export function whoLabel(who: Who): string {
  if (who.kind === 'guest') return `${who.name} (guest)`;
  if (who.kind === 'member') return who.isMe ? 'You' : who.name;
  return 'Open';
}

// ---------------------------------------------------------------------------
// Events

export type SkipDateView = { markedBy: string | null };

export type EventView = {
  /** `${groupId}/${eventId}`. */
  key: string;
  groupId: string;
  groupName: string;
  groupTimeZone: string;
  eventId: string;
  startsAt: Instant;
  /** The Event's date in the viewer's time zone. */
  date: string;
  /** The Event Series' name, or null for a one-off Event. */
  seriesName: string | null;
  skipDate: SkipDateView | null;
  /** Rows in the Group's fill order (Responsibilities), then seat order. */
  slots: SlotView[];
  /** The viewer fills one of the rows. */
  mine: boolean;
};

export function eventView(group: ScheduleGroup, event: Event, now: Instant, viewerTimeZone: string): EventView {
  const { state } = group;
  const order = new Map(state.responsibilities.map((r, i) => [r.id, i]));
  const slots = event.skipDate
    ? []
    : state.assignments
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => a.eventId === event.id)
        .sort((x, y) => (order.get(x.a.responsibilityId) ?? 99) - (order.get(y.a.responsibilityId) ?? 99) || x.i - y.i)
        .map(({ a }) => slotView(group, a, event.startsAt, now));
  const series = event.seriesId ? state.eventSeries.find((s) => s.id === event.seriesId) : undefined;
  return {
    key: `${group.id}/${event.id}`,
    groupId: group.id,
    groupName: group.name,
    groupTimeZone: group.timeZone,
    eventId: event.id,
    startsAt: event.startsAt,
    date: dateIn(event.startsAt, viewerTimeZone),
    seriesName: series?.name ?? null,
    skipDate: event.skipDate
      ? { markedBy: personLabel(state, event.skipDate.markedBy, group.myMemberId, 'You') }
      : null,
    slots,
    mine: slots.some((s) => s.mine),
  };
}

/**
 * Every Event of the given Groups on or after the viewer's `fromDate` (default: today),
 * soonest first. Ties go by Group name.
 */
export function eventViews(
  groups: ScheduleGroup[],
  now: Instant,
  viewerTimeZone: string,
  fromDate: string = dateIn(now, viewerTimeZone),
): EventView[] {
  const out: EventView[] = [];
  for (const group of groups) {
    for (const event of group.state.events) {
      const view = eventView(group, event, now, viewerTimeZone);
      if (view.date >= fromDate) out.push(view);
    }
  }
  return out.sort(
    (a, b) =>
      Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
      a.groupName.localeCompare(b.groupName, undefined, { sensitivity: 'base' }) ||
      a.key.localeCompare(b.key),
  );
}

/** The next Event that isn't a Skip Date and hasn't started yet. */
export function nextEvent(group: ScheduleGroup, now: Instant, viewerTimeZone: string): EventView | null {
  const t = Date.parse(now);
  const next = [...group.state.events]
    .filter((e) => !e.skipDate && Date.parse(e.startsAt) >= t)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  return next ? eventView(group, next, now, viewerTimeZone) : null;
}

/** The Event and row of one Assignment, or null when it isn't in the state. */
export function findSlot(
  group: ScheduleGroup,
  assignmentId: string,
  now: Instant,
  viewerTimeZone: string,
): { event: EventView; slot: SlotView } | null {
  const assignment = group.state.assignments.find((a) => a.id === assignmentId);
  const event = assignment && group.state.events.find((e) => e.id === assignment.eventId);
  if (!assignment || !event) return null;
  const view = eventView(group, event, now, viewerTimeZone);
  const slot = view.slots.find((s) => s.assignmentId === assignmentId);
  return slot ? { event: view, slot } : null;
}

// ---------------------------------------------------------------------------
// "Just me" and "Everyone"

export type Scope = 'me' | 'everyone';

export type ScheduleItem =
  | { kind: 'slot'; key: string; date: string; event: EventView; slot: SlotView }
  | { kind: 'event'; key: string; date: string; event: EventView }
  | { kind: 'skip'; key: string; date: string; event: EventView };

/**
 * The cards to show. "Just me": each of the viewer's Assignments as its own card, plus the
 * Skip Dates of their Groups (so a missing turn is explained). "Everyone": one card per Event.
 * Skip Dates come after other cards on the same day.
 */
export function scheduleItems(events: EventView[], scope: Scope): ScheduleItem[] {
  const items: ScheduleItem[] = [];
  for (const event of events) {
    if (event.skipDate) {
      items.push({ kind: 'skip', key: `skip:${event.key}`, date: event.date, event });
    } else if (scope === 'everyone') {
      items.push({ kind: 'event', key: `event:${event.key}`, date: event.date, event });
    } else {
      for (const slot of event.slots) {
        if (slot.mine) items.push({ kind: 'slot', key: `slot:${slot.key}`, date: event.date, event, slot });
      }
    }
  }
  const rank = (i: ScheduleItem) => (i.kind === 'skip' ? 1 : 0);
  // Stable: events are already in time order.
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => a.item.date.localeCompare(b.item.date) || rank(a.item) - rank(b.item) || a.i - b.i)
    .map(({ item }) => item);
}

// ---------------------------------------------------------------------------
// Weeks

/** The Sunday that starts the week of `date`. */
export function weekStart(date: string): string {
  const day = dayNumber(date);
  return dateOf(day - weekdayOf(day));
}

/** "This week", "Next week", "Week of Dec 7" (with the year when it isn't this year's). */
export function weekLabel(start: string, today: string): string {
  const n = daysBetween(weekStart(today), start);
  if (n === 0) return 'This week';
  if (n === 7) return 'Next week';
  if (n === -7) return 'Last week';
  return `Week of ${formatMonthDay(start, start.slice(0, 4) !== today.slice(0, 4))}`;
}

/** "Dec 27 – Jan 2". */
export function weekRange(start: string): string {
  return `${formatMonthDay(start)} – ${formatMonthDay(addDays(start, 6))}`;
}

export type WeekSection<T> = { key: string; label: string; range: string; items: T[] };

/** Groups dated items into Sunday-to-Saturday weeks (in the order the items come). */
export function groupByWeek<T extends { date: string }>(items: T[], today: string): WeekSection<T>[] {
  const weeks = new Map<string, T[]>();
  for (const item of items) {
    const start = weekStart(item.date);
    const list = weeks.get(start);
    if (list) list.push(item);
    else weeks.set(start, [item]);
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([start, list]) => ({ key: start, label: weekLabel(start, today), range: weekRange(start), items: list }));
}

// ---------------------------------------------------------------------------
// Month

/** "2026-11". */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** The month `n` months after `month`. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export type MonthCell = { date: string; inMonth: boolean };

/**
 * The calendar grid of a month: whole Sunday-to-Saturday weeks, 5 or 6 rows (4 when a
 * February fits exactly).
 */
export function monthGrid(month: string): MonthCell[] {
  const first = `${month}-01`;
  const start = weekStart(first);
  const next = `${shiftMonth(month, 1)}-01`;
  const cells: MonthCell[] = [];
  for (let d = start; d < next || weekdayOf(dayNumber(d)) !== 0; d = addDays(d, 1)) {
    cells.push({ date: d, inMonth: monthOf(d) === month });
  }
  return cells;
}

export type MonthDay = MonthCell & {
  isToday: boolean;
  /** The viewer serves that day. */
  mine: boolean;
  /** Every Event that day is a Skip Date. */
  skipOnly: boolean;
  /** One dot per Group with something to show that day ("Just me": the viewer's Groups). */
  groupIds: string[];
};

/** The month's cells with what happens on each day. */
export function monthDays(events: EventView[], scope: Scope, month: string, today: string): MonthDay[] {
  const byDate = new Map<string, EventView[]>();
  for (const e of events) {
    const list = byDate.get(e.date);
    if (list) list.push(e);
    else byDate.set(e.date, [e]);
  }
  return monthGrid(month).map((cell) => {
    const day = byDate.get(cell.date) ?? [];
    const held = day.filter((e) => !e.skipDate);
    const shown = scope === 'me' ? held.filter((e) => e.mine) : held;
    return {
      ...cell,
      isToday: cell.date === today,
      mine: held.some((e) => e.mine),
      skipOnly: day.length > 0 && held.length === 0,
      groupIds: [...new Set(shown.map((e) => e.groupId))],
    };
  });
}

/** The cards for one day of the month view. */
export function dayItems(events: EventView[], scope: Scope, date: string): ScheduleItem[] {
  return scheduleItems(
    events.filter((e) => e.date === date),
    scope,
  );
}

/** The first and last month the calendar can show: this month through the last Event's. */
export function monthBounds(events: EventView[], today: string): { first: string; last: string } {
  const first = monthOf(today);
  const lastDate = events.reduce((max, e) => (e.date > max ? e.date : max), today);
  return { first, last: monthOf(lastDate) };
}
