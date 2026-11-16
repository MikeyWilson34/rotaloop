import type { PlannedSeat } from './schedule';
import { findResponsibility, isPinned } from './state';
import { compareEvents, ms } from './time';
import type {
  Assignment,
  AssignmentChange,
  Cause,
  Confirmation,
  Event,
  GroupState,
  MakeUpTurn,
  MakeUpTurnChange,
} from './types';

/**
 * Turns a planned schedule into Assignments, reusing existing future Assignments so
 * that as few as possible change. Matching runs in three passes:
 * 1. the same Member at the same Event (unchanged);
 * 2. the same Member in the same Responsibility, in date order (the turn moved);
 * 3. the same Event and Responsibility (someone else took the seat).
 * Anything unmatched is created or removed. A matched Assignment whose Member or
 * Event changed asks for confirmation again.
 *
 * `removedEvents` are future Events the command removed: their Assignments are
 * matched like any other future Assignment (so a turn moves to the next Event) or
 * removed, and never kept as history.
 */
export function reconcile(state: GroupState, plan: PlannedSeat[], removedEvents: Event[] = []): GroupState {
  const now = state.rotatedThrough === null ? -Infinity : ms(state.rotatedThrough);
  const known = [...state.events, ...removedEvents.filter((r) => !state.events.some((e) => e.id === r.id))];
  const eventRank = new Map([...known].sort(compareEvents).map((e, i) => [e.id, i]));
  const isFuture = (a: Assignment) => {
    const event = known.find((e) => e.id === a.eventId);
    return event !== undefined && ms(event.startsAt) > now;
  };
  const past = state.assignments.filter((a) => !isFuture(a));
  const pool = state.assignments
    .filter((a) => isFuture(a) && !isPinned(a))
    .sort((a, b) => (eventRank.get(a.eventId) ?? 0) - (eventRank.get(b.eventId) ?? 0));

  const computed = plan.filter((seat) => seat.pinned === null);
  const matchOf = new Map<PlannedSeat, Assignment>();
  const used = new Set<Assignment>();
  const passes: ((s: PlannedSeat | Assignment) => string | null)[] = [
    (s) => `${s.eventId}|${s.responsibilityId}|${s.memberId}`,
    (s) => (s.memberId === null ? null : `${s.responsibilityId}|${s.memberId}`),
    (s) => `${s.eventId}|${s.responsibilityId}`,
  ];
  for (const key of passes) {
    const buckets = new Map<string, Assignment[]>();
    for (const old of pool) {
      const k = key(old);
      if (used.has(old) || k === null) continue;
      buckets.set(k, [...(buckets.get(k) ?? []), old]);
    }
    for (const seat of computed) {
      const k = key(seat);
      if (matchOf.has(seat) || k === null) continue;
      const old = buckets.get(k)?.find((a) => !used.has(a));
      if (!old) continue;
      matchOf.set(seat, old);
      used.add(old);
    }
  }

  let sequence = state.idSequence;
  const future = plan.map((seat): Assignment => {
    if (seat.pinned) return seat.pinned;
    const old = matchOf.get(seat);
    const id = old?.id ?? `a${++sequence}`;
    return {
      id,
      eventId: seat.eventId,
      responsibilityId: seat.responsibilityId,
      memberId: seat.memberId,
      turnOf: seat.turnOf,
      makeUpTurnId: seat.makeUpTurnId,
      confirmation: confirmationFor(state, seat, old),
      coverageRequest: keepRequestedAt(seat, old),
    };
  });
  return { ...state, assignments: [...past, ...future], idSequence: sequence };
}

function confirmationFor(state: GroupState, seat: PlannedSeat, old: Assignment | undefined): Confirmation {
  const responsibility = findResponsibility(state, seat.responsibilityId);
  if (!responsibility?.requiresConfirmation || seat.memberId === null) return 'notRequired';
  if (!old) return 'notYetRequested';
  // Confirmation became required since the seat was filled.
  if (old.confirmation === 'notRequired' && old.memberId !== null) return 'notYetRequested';
  const unchanged = old.eventId === seat.eventId && old.memberId === seat.memberId;
  return unchanged ? old.confirmation : 'requested';
}

function keepRequestedAt(seat: PlannedSeat, old: Assignment | undefined) {
  const request = seat.coverageRequest;
  const before = old?.coverageRequest;
  if (!request || !before) return request;
  const same = before.reason === request.reason && before.requestedBy === request.requestedBy;
  return same ? { ...request, requestedAt: before.requestedAt } : request;
}

// ---------------------------------------------------------------------------
// Diffs

export function diffAssignments(before: Assignment[], after: Assignment[], reason: Cause): AssignmentChange[] {
  const oldById = new Map(before.map((a) => [a.id, a]));
  const newById = new Map(after.map((a) => [a.id, a]));
  const changes: AssignmentChange[] = [];
  for (const a of after) {
    const old = oldById.get(a.id) ?? null;
    if (old === null || !sameData(old, a)) changes.push({ assignmentId: a.id, before: old, after: a, reason });
  }
  for (const old of before) {
    if (!newById.has(old.id)) changes.push({ assignmentId: old.id, before: old, after: null, reason });
  }
  return changes;
}

export function diffMakeUpTurns(before: MakeUpTurn[], after: MakeUpTurn[]): MakeUpTurnChange[] {
  const oldById = new Map(before.map((t) => [t.id, t]));
  return after
    .filter((t) => oldById.get(t.id)?.status !== t.status)
    .map((t) => ({ makeUpTurnId: t.id, before: oldById.get(t.id)?.status ?? null, after: t.status }));
}

export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => sameData((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
