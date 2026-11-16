/**
 * Readable scenario helpers for the engine tests. Not part of the public API.
 */
import {
  applyCommand,
  createGroupState,
  type Command,
  type CommandResult,
  type GroupSettings,
  type GroupState,
  type Instant,
  type NewEvent,
  type NewTimeOff,
} from '../index';

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const FIRST_SUNDAY = Date.parse('2027-01-03T09:00:00.000Z');

/** "Now" for most scenarios: before every generated Event. */
export const NOW: Instant = '2026-12-01T00:00:00.000Z';

/** Start time of week n's Sunday Event (1-based). */
export function week(n: number): Instant {
  return new Date(FIRST_SUNDAY + (n - 1) * WEEK).toISOString();
}

/** A moment shortly after week n's Event started. */
export function afterWeek(n: number): Instant {
  return new Date(Date.parse(week(n)) + 3 * 60 * 60 * 1000).toISOString();
}

/** Sunday Events w1..wn from the given Event Series. */
export function sundays(count: number, seriesId = 'sundays'): NewEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `w${i + 1}`,
    seriesId,
    startsAt: week(i + 1),
  }));
}

/** Time Off covering exactly the given weeks' Sundays (whole days). */
export function timeOff(
  id: string,
  memberId: string,
  fromWeek: number,
  toWeek = fromWeek,
  extra: Partial<NewTimeOff> = {},
): NewTimeOff {
  return {
    id,
    memberId,
    startsAt: new Date(Date.parse(week(fromWeek)) - 9 * 60 * 60 * 1000).toISOString(),
    endsAt: new Date(Date.parse(week(toWeek)) + 15 * 60 * 60 * 1000).toISOString(),
    ...extra,
  };
}

export interface ScenarioResponsibility {
  id: string;
  headcount?: number;
  requiresConfirmation?: boolean;
  qualified: string[];
}

export interface Scenario {
  members?: string[];
  admins?: string[];
  responsibilities?: ScenarioResponsibility[];
  series?: { id: string; responsibilityIds: string[] }[];
  events?: NewEvent[];
  settings?: Partial<GroupSettings>;
}

export const CREW = ['ana', 'ben', 'cal', 'dee'];

/** Builds a Group and fills its schedule at NOW. */
export function setup(scenario: Scenario = {}): GroupState {
  const members = scenario.members ?? CREW;
  const responsibilities = scenario.responsibilities ?? [{ id: 'sound', qualified: members }];
  const series = scenario.series ?? [
    { id: 'sundays', responsibilityIds: responsibilities.map((r) => r.id) },
  ];
  const state = createGroupState({
    groupId: 'g1',
    settings: scenario.settings,
    members: members.map((id) => ({
      id,
      name: id,
      isAdmin: (scenario.admins ?? []).includes(id),
      accountId: `acct-${id}`,
    })),
    responsibilities: responsibilities.map((r) => ({
      id: r.id,
      name: r.id,
      headcount: r.headcount ?? 1,
      requiresConfirmation: r.requiresConfirmation ?? false,
      qualifiedMemberIds: r.qualified,
    })),
    eventSeries: series.map((s) => ({ ...s, name: s.id })),
    events: scenario.events ?? sundays(8),
  });
  return act(state, { type: 'fillSchedule' }).state;
}

type Applied = Extract<CommandResult, { ok: true }>;

/** Applies a command that must succeed. */
export function act(
  state: GroupState,
  command: Command,
  options: { by?: string | null; at?: Instant } = {},
): Applied {
  const result = applyCommand(state, command, { now: options.at ?? NOW, actorId: options.by ?? null });
  if (!result.ok) throw new Error(`Rejected ${command.type}: ${result.reason} (${result.message})`);
  return result;
}

/** Applies a command that must be rejected, and returns the reason. */
export function rejected(
  state: GroupState,
  command: Command,
  options: { by?: string | null; at?: Instant } = {},
): string {
  const result = applyCommand(state, command, { now: options.at ?? NOW, actorId: options.by ?? null });
  if (result.ok) throw new Error(`Expected ${command.type} to be rejected`);
  return result.reason;
}

/**
 * The schedule of one Responsibility as readable lines, e.g. "w1 ana",
 * "w2 ben+cal", "w3 skipped", "w4 dee (needs coverage)", "w5 guest:Pat", "w6 open".
 */
export function lineup(state: GroupState, responsibilityId = 'sound'): string[] {
  const events = [...state.events].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const lines: string[] = [];
  for (const event of events) {
    if (event.skipDate) {
      lines.push(`${event.id} skipped`);
      continue;
    }
    const seats = state.assignments.filter(
      (a) => a.eventId === event.id && a.responsibilityId === responsibilityId,
    );
    if (seats.length === 0) continue;
    const names = seats
      .map((a) => {
        const cover = a.coverageRequest?.cover;
        let name = a.memberId ?? (cover?.kind === 'guest' ? `guest:${cover.guestName}` : 'open');
        if (a.coverageRequest && !a.coverageRequest.cover) name += ' (needs coverage)';
        return name;
      })
      .sort();
    lines.push(`${event.id} ${names.join('+')}`);
  }
  return lines;
}

/** The Assignment of a Member at an Event (throws if missing). */
export function assignmentOf(state: GroupState, eventId: string, memberId: string, responsibilityId = 'sound') {
  const found = state.assignments.find(
    (a) => a.eventId === eventId && a.memberId === memberId && a.responsibilityId === responsibilityId,
  );
  if (!found) throw new Error(`${memberId} has no ${responsibilityId} Assignment at ${eventId}`);
  return found;
}

/** Summarizes changes as "ana: w1 -> w2" lines (sorted) for compact assertions. */
export function moves(result: Applied): string[] {
  return result.changes
    .map((c) => {
      const from = c.before ? `${c.before.memberId ?? 'open'}@${c.before.eventId}` : 'none';
      const to = c.after ? `${c.after.memberId ?? 'open'}@${c.after.eventId}` : 'none';
      return `${from} -> ${to}`;
    })
    .sort();
}
