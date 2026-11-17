/** Shared test setup for the planner: the schedule fixture Group plus profiles. */
import { applyCommand, type Command, type GroupState, type HistoryEntry, type Instant } from '../../engine';
import { buildGroup, NOW, ZONE } from '../../schedule/tests/fixture';
import type { NotifyGroup, NotifyProfile } from '../plan';

export { NOW, ZONE };

/** Account ids of the fixture's Members (Pat is a Placeholder). */
export const ACCOUNT = { ana: 'acct-ana', ben: 'acct-ben', cal: 'acct-cal' } as const;

export function profile(accountId: string, overrides: Partial<NotifyProfile> = {}): NotifyProfile {
  return {
    accountId,
    pushEnabled: true,
    notifyCoverageRequests: true,
    notifyChanges: true,
    reminderDaysBefore: [1],
    reminderTime: '18:00:00',
    timeZone: ZONE,
    adminAlertLeadTimeMs: 3 * 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

export function profiles(overrides: Partial<Record<keyof typeof ACCOUNT, Partial<NotifyProfile>>> = {}): Map<string, NotifyProfile> {
  return new Map(
    (Object.keys(ACCOUNT) as (keyof typeof ACCOUNT)[]).map((k) => [ACCOUNT[k], profile(ACCOUNT[k], overrides[k])]),
  );
}

/** A Group under test: state plus the history of the last command. */
export class TestGroup {
  state: GroupState;
  last: HistoryEntry[] = [];
  version = 1;

  constructor() {
    this.state = buildGroup().state;
  }

  run(command: Command, actorId: string | null, now: Instant = NOW): HistoryEntry[] {
    const result = applyCommand(this.state, command, { now, actorId });
    if (!result.ok) throw new Error(`Rejected ${command.type}: ${result.reason} (${result.message})`);
    this.state = result.state;
    this.last = result.history;
    this.version++;
    return result.history;
  }

  get group(): NotifyGroup {
    return { id: 'g1', name: 'Sunday Team', state: this.state };
  }

  /** The Assignment of a Responsibility at the Sunday `date`. */
  seat(date: string, responsibilityId: string) {
    const a = this.state.assignments.find((x) => x.eventId === `sun@${date}` && x.responsibilityId === responsibilityId);
    if (!a) throw new Error(`No ${responsibilityId} seat on ${date}`);
    return a;
  }
}

export const at = (iso: string): Instant => new Date(iso).toISOString();
export const plusMinutes = (instant: Instant, minutes: number): Instant =>
  new Date(Date.parse(instant) + minutes * 60_000).toISOString();
