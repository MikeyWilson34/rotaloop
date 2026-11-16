/**
 * A small Group built with the real engine, for the schedule view tests.
 * Members: Ana (the viewer, Admin), Ben, Cal, Pat (Placeholder). Responsibilities: Sound
 * (needs confirmation) and Greeter. Weekly Sunday Events at 9:00 AM Chicago time from
 * Nov 22, 2026 through Jan 10, 2027 (across the year boundary).
 */
import { applyCommand, createGroupState, type Command, type GroupState, type Instant } from '../../engine';
import type { HistoryRecord } from '../history';
import type { ScheduleGroup } from '../views';

export const ZONE = 'America/Chicago';
/** Wednesday Nov 18, 2026, 6:00 AM in Chicago. */
export const NOW: Instant = '2026-11-18T12:00:00.000Z';

const SUNDAYS = ['2026-11-22', '2026-11-29', '2026-12-06', '2026-12-13', '2026-12-20', '2026-12-27', '2027-01-03', '2027-01-10'];
/** 9:00 AM CST is 15:00 UTC. */
export const eventId = (date: string) => `sun@${date}`;

export type Built = { state: GroupState; history: HistoryRecord[] };

export function buildGroup(): Built {
  const state = createGroupState({
    groupId: 'g1',
    members: [
      { id: 'ana', name: 'Ana', accountId: 'acct-ana', isAdmin: true },
      { id: 'ben', name: 'Ben', accountId: 'acct-ben' },
      { id: 'cal', name: 'Cal', accountId: 'acct-cal' },
      { id: 'pat', name: 'Pat' },
    ],
    responsibilities: [
      { id: 'sound', name: 'Sound', headcount: 1, requiresConfirmation: true, qualifiedMemberIds: ['ana', 'ben', 'cal'] },
      { id: 'greeter', name: 'Greeter', headcount: 1, requiresConfirmation: false, qualifiedMemberIds: ['pat', 'cal', 'ben'] },
    ],
    eventSeries: [{ id: 'sun', name: 'Sunday gathering', responsibilityIds: ['sound', 'greeter'] }],
  });
  const built: Built = { state, history: [] };
  run(built, {
    type: 'addEvents',
    events: SUNDAYS.map((d) => ({ id: eventId(d), seriesId: 'sun', startsAt: `${d}T15:00:00.000Z` })),
  }, 'ana');
  return built;
}

let nextId = 1;
/** Applies a command that must succeed, keeping its history entries. */
export function run(built: Built, command: Command, actorId: string | null, now: Instant = NOW): Built {
  const result = applyCommand(built.state, command, { now, actorId });
  if (!result.ok) throw new Error(`Rejected ${command.type}: ${result.reason} (${result.message})`);
  built.state = result.state;
  for (const entry of result.history) built.history.push({ ...entry, id: String(nextId++) });
  return built;
}

/** The Assignment of a Responsibility at an Event (the first seat). */
export function seat(state: GroupState, date: string, responsibilityId: string) {
  const a = state.assignments.find((x) => x.eventId === eventId(date) && x.responsibilityId === responsibilityId);
  if (!a) throw new Error(`No ${responsibilityId} seat on ${date}`);
  return a;
}

export function asGroup(state: GroupState, myMemberId: string | null = 'ana', name = 'Sunday Team'): ScheduleGroup {
  return { id: state.groupId, name, timeZone: ZONE, state, myMemberId };
}
