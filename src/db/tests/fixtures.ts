/** A small Group built with the engine's public API, for database tests. */
import { applyCommand, createGroupState, type Command, type GroupState, type Instant } from '../../engine';

export const NOW: Instant = '2026-12-01T00:00:00.000Z';

const WEEK = 7 * 24 * 60 * 60 * 1000;
const FIRST_SUNDAY = Date.parse('2027-01-03T09:00:00.000Z');

/** Week n's Sunday Event start (1-based). */
export function week(n: number): Instant {
  return new Date(FIRST_SUNDAY + (n - 1) * WEEK).toISOString();
}

export function afterWeek(n: number): Instant {
  return new Date(Date.parse(week(n)) + 3 * 60 * 60 * 1000).toISOString();
}

/**
 * Members ana (Admin), ben, cal, dee. Sound (headcount 1, needs confirmation) rotates
 * all four; Greeter (headcount 2, no confirmation) rotates ana, ben, cal. Six Sundays,
 * plus a one-off Event needing only Sound.
 */
export function newGroupState(groupId: string, accounts: Partial<Record<string, string>> = {}): GroupState {
  const names = ['ana', 'ben', 'cal', 'dee'];
  return createGroupState({
    groupId,
    primaryResponsibilityId: 'sound',
    members: names.map((id) => ({ id, name: id.toUpperCase(), isAdmin: id === 'ana', accountId: accounts[id] ?? null })),
    responsibilities: [
      { id: 'sound', name: 'Sound', headcount: 1, requiresConfirmation: true, qualifiedMemberIds: names },
      { id: 'greeter', name: 'Greeter', headcount: 2, requiresConfirmation: false, qualifiedMemberIds: ['ana', 'ben', 'cal'] },
    ],
    eventSeries: [{ id: 'sundays', name: 'Sundays', responsibilityIds: ['sound', 'greeter'] }],
    events: [
      ...Array.from({ length: 6 }, (_, i) => ({ id: `w${i + 1}`, seriesId: 'sundays', startsAt: week(i + 1) })),
      { id: 'special', seriesId: null, startsAt: '2027-01-20T18:30:00.000Z', responsibilityIds: ['sound'] },
    ],
  });
}

export function run(state: GroupState, command: Command, actorId: string | null, now: Instant = NOW) {
  const result = applyCommand(state, command, { now, actorId });
  if (!result.ok) throw new Error(`${command.type} rejected: ${result.reason} ${result.message}`);
  return result;
}

/** The Assignment id holding `responsibilityId` at `eventId` for `memberId` (or the first seat). */
export function seat(state: GroupState, eventId: string, responsibilityId: string, memberId?: string): string {
  const found = state.assignments.find(
    (a) =>
      a.eventId === eventId &&
      a.responsibilityId === responsibilityId &&
      (memberId === undefined || a.memberId === memberId),
  );
  if (!found) throw new Error(`No ${responsibilityId} seat at ${eventId}${memberId ? ` for ${memberId}` : ''}`);
  return found.id;
}

export function holder(state: GroupState, assignmentId: string): string {
  const memberId = state.assignments.find((a) => a.id === assignmentId)?.memberId;
  if (!memberId) throw new Error(`No one holds ${assignmentId}`);
  return memberId;
}
