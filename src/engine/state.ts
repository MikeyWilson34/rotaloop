import type {
  Assignment,
  Event,
  EventSeries,
  GroupSettings,
  GroupState,
  Member,
  NewEvent,
  NewEventSeries,
  NewMember,
  NewResponsibility,
  NewTimeOff,
  Responsibility,
  ResponsibilityId,
  Rotation,
  TimeOff,
} from './types';

export const DEFAULT_REPLACEMENT_DEADLINE_MS = 3 * 24 * 60 * 60 * 1000;

export const DEFAULT_GROUP_SETTINGS: GroupSettings = {
  coveragePolicy: 'payItBack',
  timeOffHandling: 'routeAround',
  allowDoubling: false,
  replacementDuty: 'assignedMember',
  replacementDeadlineMs: DEFAULT_REPLACEMENT_DEADLINE_MS,
};

export interface NewGroup {
  groupId: string;
  settings?: Partial<GroupSettings>;
  primaryResponsibilityId?: ResponsibilityId | null;
  members: NewMember[];
  /** Each Responsibility with its Qualified Members in their starting Rotation order. */
  responsibilities: (NewResponsibility & { qualifiedMemberIds: string[] })[];
  eventSeries?: NewEventSeries[];
  events?: NewEvent[];
}

/** Builds a Group's state with empty Assignments. Run `fillSchedule` to fill it. */
export function createGroupState(group: NewGroup): GroupState {
  return {
    groupId: group.groupId,
    settings: { ...DEFAULT_GROUP_SETTINGS, ...group.settings },
    primaryResponsibilityId: group.primaryResponsibilityId ?? null,
    members: group.members.map(toMember),
    responsibilities: group.responsibilities.map(({ qualifiedMemberIds: _, ...r }) => toResponsibility(r)),
    rotations: group.responsibilities.map((r) => ({
      responsibilityId: r.id,
      // A headcount Job has no turns: everyone is asked "Coming?" instead.
      queue: r.kind === 'headcount' ? [] : [...r.qualifiedMemberIds],
      turnsTakenEarly: {},
    })),
    eventSeries: (group.eventSeries ?? []).map(toEventSeries),
    events: (group.events ?? []).map(toEvent),
    timeOff: [],
    assignments: [],
    makeUpTurns: [],
    headcountAnswers: [],
    rotatedThrough: null,
    idSequence: 0,
  };
}

export function toMember(member: NewMember): Member {
  return {
    id: member.id,
    name: member.name,
    isAdmin: member.isAdmin ?? false,
    accountId: member.accountId ?? null,
    leftAt: null,
  };
}

export function toResponsibility(r: NewResponsibility): Responsibility {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind ?? 'turns',
    headcount: r.headcount,
    requiresConfirmation: r.requiresConfirmation,
    removedAt: null,
  };
}

export function toEventSeries(s: NewEventSeries): EventSeries {
  return {
    id: s.id,
    name: s.name,
    responsibilityIds: [...s.responsibilityIds],
    repeat: s.repeat ? { ...s.repeat, daysOfWeek: [...s.repeat.daysOfWeek] } : null,
    removedAt: null,
  };
}

export function toEvent(event: NewEvent): Event {
  return { ...event, responsibilityIds: event.responsibilityIds ?? null, skipDate: null };
}

export function toTimeOff(timeOff: NewTimeOff): TimeOff {
  return {
    ...timeOff,
    repeatEveryWeeks: timeOff.repeatEveryWeeks ?? null,
    repeatUntil: timeOff.repeatUntil ?? null,
    responsibilityIds: timeOff.responsibilityIds ?? null,
    timeZone: timeOff.timeZone ?? null,
    note: timeOff.note ?? null,
    removedAt: null,
    retainedEventIds: [],
  };
}

// ---------------------------------------------------------------------------
// Lookups

export function findMember(state: GroupState, memberId: string | null): Member | undefined {
  return memberId === null ? undefined : state.members.find((m) => m.id === memberId);
}

export function isActiveMember(state: GroupState, memberId: string | null): boolean {
  const member = findMember(state, memberId);
  return member !== undefined && member.leftAt === null;
}

export function isAdmin(state: GroupState, memberId: string | null): boolean {
  const member = findMember(state, memberId);
  return member !== undefined && member.leftAt === null && member.isAdmin;
}

export function findEvent(state: GroupState, eventId: string): Event | undefined {
  return state.events.find((e) => e.id === eventId);
}

export function findResponsibility(state: GroupState, id: string): Responsibility | undefined {
  return state.responsibilities.find((r) => r.id === id);
}

/** A Responsibility that hasn't been removed. */
export function findActiveResponsibility(state: GroupState, id: string): Responsibility | undefined {
  const found = findResponsibility(state, id);
  return found && found.removedAt === null ? found : undefined;
}

/** An Event Series that hasn't been removed. */
export function findActiveSeries(state: GroupState, id: string): EventSeries | undefined {
  return state.eventSeries.find((s) => s.id === id && s.removedAt === null);
}

/** Active Admins who can act (Placeholder Members can't). */
export function activeAdmins(state: GroupState): Member[] {
  return state.members.filter((m) => m.isAdmin && m.leftAt === null && m.accountId !== null);
}

export function rotationOf(state: GroupState, responsibilityId: string): Rotation {
  return (
    state.rotations.find((r) => r.responsibilityId === responsibilityId) ?? {
      responsibilityId,
      queue: [],
      turnsTakenEarly: {},
    }
  );
}

export function isQualified(state: GroupState, memberId: string, responsibilityId: string): boolean {
  return isActiveMember(state, memberId) && rotationOf(state, responsibilityId).queue.includes(memberId);
}

/** The Responsibilities an Event needs, in the Group's fill order. */
export function responsibilitiesNeeded(state: GroupState, event: Event): Responsibility[] {
  if (event.skipDate) return [];
  const ids =
    event.responsibilityIds ?? state.eventSeries.find((s) => s.id === event.seriesId)?.responsibilityIds ?? [];
  return state.responsibilities.filter((r) => r.removedAt === null && ids.includes(r.id));
}

/** The take-turns Jobs an Event needs: the ones that get seats (Assignments), in fill order. */
export function seatsNeeded(state: GroupState, event: Event): Responsibility[] {
  return responsibilitiesNeeded(state, event).filter((r) => r.kind !== 'headcount');
}

/** The headcount Jobs an Event needs: everyone is asked "Coming?" for them. */
export function headcountsNeeded(state: GroupState, event: Event): Responsibility[] {
  return responsibilitiesNeeded(state, event).filter((r) => r.kind === 'headcount');
}

export function initialConfirmation(responsibility: Responsibility | undefined, memberId: string | null) {
  return responsibility?.requiresConfirmation && memberId !== null ? 'notYetRequested' : 'notRequired';
}

/**
 * Assignments the schedule must not recompute: a Decline stays on its Event, and
 * so does any Cover. Everything else in the future is derived from the Rotations.
 */
export function isPinned(assignment: Assignment): boolean {
  const request = assignment.coverageRequest;
  return request !== null && (request.reason === 'declined' || request.cover !== null);
}

export function nextId(state: GroupState, prefix: string): [string, GroupState] {
  const sequence = state.idSequence + 1;
  return [`${prefix}${sequence}`, { ...state, idSequence: sequence }];
}
