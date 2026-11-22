import { diffAssignments, diffMakeUpTurns, reconcile } from './reconcile';
import { appendToQueue, removeFromQueue, reorderQueue, withQueueOrder } from './rotation';
import { advanceTo, onSameDay, planSchedule } from './schedule';
import {
  activeAdmins,
  findActiveResponsibility,
  findActiveSeries,
  findEvent,
  findMember,
  findResponsibility,
  headcountsNeeded,
  initialConfirmation,
  isActiveMember,
  isPinned,
  isQualified,
  nextId,
  rotationOf,
  toEvent,
  toEventSeries,
  toMember,
  toResponsibility,
  toTimeOff,
} from './state';
import { isKnownTimeZone, isPast, laterOf, ms, timeOffCovers } from './time';
import { workload } from './workload';
import type {
  Assignment,
  Command,
  CommandContext,
  CommandResult,
  CoverTarget,
  Event,
  EventSeriesChanges,
  GroupState,
  HeadcountAnswer,
  HistoryEntry,
  Instant,
  MakeUpTurn,
  MakeUpTurnClosedReason,
  MakeUpTurnStatus,
  MemberId,
  NewEvent,
  RejectionReason,
  RepeatPattern,
  ResponsibilityChanges,
  Rotation,
} from './types';
/** The longest Skip Date reason accepted. */
export const MAX_SKIP_REASON = 300;
/** The longest Decline reason accepted (stored as the Coverage Request's `note`). */
export const MAX_DECLINE_REASON = 300;
/** The longest name of an outside cover (someone not in the Group) accepted. */
export const MAX_GUEST_NAME = 80;

type Outcome = { ok: true; state: GroupState } | { ok: false; reason: RejectionReason; message: string };

interface Context {
  now: Instant;
  actorId: MemberId | null;
}

type Rejection = Extract<Outcome, { ok: false }>;

const reject = (reason: RejectionReason, message: string): Rejection => ({ ok: false, reason, message });
const done = (state: GroupState): Outcome => ({ ok: true, state });

/**
 * Applies one command to a Group's state. Pure: returns the new state, every
 * changed Assignment, and the schedule-history entries, or a rejection.
 */
export function applyCommand(state: GroupState, command: Command, context: CommandContext): CommandResult {
  const now = laterOf(context.now, state.rotatedThrough);
  const ctx: Context = { now, actorId: context.actorId };
  const advanced = advanceTo(state, now);
  const history: HistoryEntry[] = advanced.paid.map((makeUpTurnId) => ({
    at: now,
    actorId: null,
    cause: { type: 'makeUpTurnPaid', makeUpTurnId },
    changes: [],
    makeUpTurns: [{ makeUpTurnId, before: 'outstanding', after: 'paid' }],
  }));
  const before = advanced.state;

  const denied = permissionError(before, command, ctx);
  if (denied) return denied;
  const outcome = handle(before, command, ctx);
  if (!outcome.ok) return outcome;
  if (command.type === 'answerHeadcount') {
    // A "Coming?" answer touches no seat: nothing to reschedule and no history entry (the
    // answer itself records who gave it and when).
    return { ok: true, state: outcome.state, changes: [], history };
  }
  const after = schedule(outcome.state, before.events, now);
  if (command.type === 'withdrawDecline') {
    const lost = seatLost(before, after, command.assignmentId);
    if (lost) return lost;
  }

  const changes = diffAssignments(before.assignments, after.assignments, command);
  history.push({
    at: now,
    actorId: ctx.actorId,
    cause: command,
    changes,
    makeUpTurns: diffMakeUpTurns(before.makeUpTurns, after.makeUpTurns),
  });
  return { ok: true, state: after, changes, history };
}

/**
 * Recomputes the future from the Rotations. A Cover whose seat no longer exists
 * (its Event or Responsibility was removed, or the headcount dropped) is withdrawn
 * with the seat, and its Make-up Turn is cancelled.
 */
function schedule(state: GroupState, eventsBefore: Event[], now: Instant): GroupState {
  const removedEvents = eventsBefore.filter((e) => !findEvent(state, e.id));
  let plan = planSchedule(state);
  const kept = new Set(plan.flatMap((seat) => (seat.pinned ? [seat.pinned.id] : [])));
  const dropped = new Set(
    state.assignments
      .filter((a) => a.coverageRequest?.cover && !kept.has(a.id) && !isHistory(state, a, now))
      .map((a) => a.id),
  );
  let next = state;
  if (dropped.size > 0) {
    next = closeMakeUpTurns(next, (t) => dropped.has(t.coverAssignmentId), 'cancelled', 'coverWithdrawn', now);
    plan = planSchedule(next);
  }
  return reconcile(next, plan, removedEvents);
}

/** Whether the Assignment is at an Event that has started (and so never changes). */
function isHistory(state: GroupState, a: Assignment, now: Instant): boolean {
  const event = findEvent(state, a.eventId);
  return event !== undefined && isPast(event, now);
}

// ---------------------------------------------------------------------------
// Permissions

/**
 * Who may run what. The system (`actorId: null`) may do anything. Otherwise the actor
 * must be an active Member (or be joining: adding themselves, as a plain Member who may
 * be put in every Rotation). There are no Admins for now: the `isAdmin` flag is kept but
 * grants nothing extra, so every active Member may run every Group-wide command (Jobs,
 * Group dates off, settings, adding Stand-ins, picking someone for a turn). What concerns
 * one person (their Time Off, name, membership, a Decline without a Cover, confirming) is
 * theirs to do, or anyone's for a Stand-in (a Placeholder Member, who has no account to
 * act with); see `actsFor`. Assignment commands check those rules themselves.
 */
function permissionError(state: GroupState, command: Command, ctx: Context): Rejection | null {
  const actor = ctx.actorId;
  if (actor === null) return null;
  if (command.type === 'addMember' && command.member.id === actor && !findMember(state, actor)) {
    const joining = command.member.accountId && !command.member.isAdmin;
    return joining ? null : reject('notPermitted', 'Members join as plain Members');
  }
  if (!isActiveMember(state, actor)) return reject('notPermitted', 'Only active Members of the Group can do this');

  const forMember = (memberId: MemberId | undefined, what: string) =>
    memberId === undefined || actsFor(state, ctx, memberId)
      ? null
      : reject('notPermitted', `Members can only ${what} (or a Stand-in's)`);
  switch (command.type) {
    case 'addTimeOff':
      return forMember(command.timeOff.memberId, 'add their own Time Off');
    case 'removeTimeOff':
      return forMember(state.timeOff.find((t) => t.id === command.timeOffId)?.memberId, 'remove their own Time Off');
    case 'renameMember':
      return forMember(command.memberId, 'rename themselves');
    case 'removeMember':
      return forMember(command.memberId, 'leave the Group themselves');
    case 'claimPlaceholder':
      return command.memberId === actor ? null : reject('notPermitted', 'Members can only claim their own Stand-in');
    case 'answerHeadcount':
      return forMember(command.memberId, 'answer for themselves');
    default:
      return null;
  }
}

function handle(state: GroupState, command: Command, ctx: Context): Outcome {
  switch (command.type) {
    case 'fillSchedule':
      return done(state);
    case 'addEvents':
      return addEvents(state, command.events);
    case 'addSkipDate':
      return addSkipDate(state, command.eventId, command.reason ?? null, ctx);
    case 'removeSkipDate':
      return removeSkipDate(state, command.eventId, ctx);
    case 'addTimeOff':
      return addTimeOff(state, command, ctx);
    case 'removeTimeOff':
      return removeTimeOff(state, command.timeOffId, ctx);
    case 'requestConfirmation':
      return requestConfirmation(state, command.assignmentIds, ctx);
    case 'confirm':
      return confirm(state, command.assignmentId, ctx);
    case 'decline':
      return decline(state, command, ctx);
    case 'withdrawDecline':
      return withdrawDecline(state, command.assignmentId, ctx);
    case 'cover':
      return cover(state, command.assignmentId, ctx);
    case 'answerHeadcount':
      return answerHeadcount(state, command, ctx);
    case 'markCovered':
      return markCovered(state, command, ctx);
    case 'changeSettings':
      return changeSettings(state, command.settings, ctx);
    case 'rebalance':
      return rebalance(state, command.responsibilityId, ctx);
    case 'addMember':
      return addMember(state, command);
    case 'qualifyMember':
      return qualifyMember(state, command.memberId, command.responsibilityId);
    case 'unqualifyMember':
      return unqualifyMember(state, command.memberId, command.responsibilityId, ctx);
    case 'removeMember':
      return removeMember(state, command.memberId, ctx);
    case 'claimPlaceholder':
      return claimPlaceholder(state, command.memberId, command.accountId, command.name);
    case 'mergeStandIn':
      return mergeStandIn(state, command.standInId, command.intoMemberId, ctx);
    case 'renameMember':
      return renameMember(state, command.memberId, command.name);
    case 'setAdmin':
      return setAdmin(state, command.memberId, command.isAdmin);
    case 'addResponsibility':
      return addResponsibility(state, command);
    case 'editResponsibility':
      return editResponsibility(state, command.responsibilityId, command.changes, ctx);
    case 'removeResponsibility':
      return removeResponsibility(state, command.responsibilityId, ctx);
    case 'reorderResponsibilities':
      return reorderResponsibilities(state, command.responsibilityIds);
    case 'setPrimaryResponsibility':
      return setPrimaryResponsibility(state, command.responsibilityId);
    case 'reorderQueue':
      return reorderQueueByHand(state, command.responsibilityId, command.queue);
    case 'addEventSeries':
      return addEventSeries(state, command);
    case 'editEventSeries':
      return editEventSeries(state, command, ctx);
    case 'removeEventSeries':
      return removeEventSeries(state, command.seriesId, ctx);
    case 'removeEvent':
      return removeEvent(state, command.eventId, ctx);
  }
}

// ---------------------------------------------------------------------------
// Events and Skip Dates

function addEvents(state: GroupState, events: NewEvent[]): Outcome {
  const ids = new Set<string>();
  for (const event of events) {
    if (findEvent(state, event.id) || ids.has(event.id)) return reject('invalid', `Event ${event.id} already exists`);
    ids.add(event.id);
    if (event.seriesId === null && !event.responsibilityIds) {
      return reject('invalid', `One-off Event ${event.id} must name its Responsibilities`);
    }
    if (event.seriesId !== null && !findActiveSeries(state, event.seriesId)) {
      return reject('invalid', `No Event Series ${event.seriesId}`);
    }
  }
  return done({ ...state, events: [...state.events, ...events.map(toEvent)] });
}

/** Removes future Events. Their Assignments are reconciled away by the schedule step. */
function withoutEvents(state: GroupState, eventIds: Set<string>): GroupState {
  return {
    ...state,
    events: state.events.filter((e) => !eventIds.has(e.id)),
    headcountAnswers: state.headcountAnswers.filter((a) => !eventIds.has(a.eventId)),
  };
}

function removeEvent(state: GroupState, eventId: string, ctx: Context): Outcome {
  const event = findEvent(state, eventId);
  if (!event) return reject('notFound', `No Event ${eventId}`);
  if (isPast(event, ctx.now)) return reject('eventHasPassed', 'The Event has already started');
  if (event.seriesId !== null) {
    return reject('invalid', 'Only one-off Events can be removed; mark a Skip Date or change the Event Series');
  }
  return done(withoutEvents(state, new Set([eventId])));
}

// ---------------------------------------------------------------------------
// Event Series

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

/** Why a repeat pattern is malformed, or null. The engine stores it but never expands it. */
function repeatError(p: RepeatPattern): string | null {
  if (!['weekly', 'biweekly', 'monthly', 'custom'].includes(p.frequency)) return 'Unknown repeat frequency';
  if (p.frequency === 'custom') {
    if (!Number.isInteger(p.intervalWeeks) || (p.intervalWeeks as number) < 1 || (p.intervalWeeks as number) > 52) {
      return 'A custom repeat needs an interval of 1-52 weeks';
    }
  } else if (p.intervalWeeks !== null) {
    return 'Only a custom repeat has an interval';
  }
  if (p.frequency === 'monthly') {
    if (![1, 2, 3, 4, -1].includes(p.weekOfMonth as number)) return 'A monthly repeat needs a week of the month (1-4 or -1)';
  } else if (p.weekOfMonth !== null) {
    return 'Only a monthly repeat has a week of the month';
  }
  const days = p.daysOfWeek;
  if (days.length === 0 || new Set(days).size !== days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return 'Days of the week must be distinct numbers 0-6';
  }
  if (!HH_MM.test(p.startTime)) return 'Start time must be HH:MM';
  if (p.timeZone.trim() === '') return 'A time zone is needed';
  if (!YYYY_MM_DD.test(p.startsOn) || Number.isNaN(Date.parse(`${p.startsOn}T00:00:00Z`))) {
    return 'Start date must be YYYY-MM-DD';
  }
  return null;
}

function seriesChangesError(state: GroupState, changes: EventSeriesChanges): Outcome | null {
  if (changes.name !== undefined && changes.name.trim() === '') return reject('invalid', 'A name is needed');
  const ids = changes.responsibilityIds;
  if (ids !== undefined) {
    if (new Set(ids).size !== ids.length) return reject('invalid', 'A Responsibility is listed twice');
    const unknown = ids.find((id) => !findActiveResponsibility(state, id));
    if (unknown !== undefined) return reject('notFound', `No Responsibility ${unknown}`);
  }
  const repeatProblem = changes.repeat ? repeatError(changes.repeat) : null;
  return repeatProblem ? reject('invalid', repeatProblem) : null;
}

function addEventSeries(state: GroupState, command: Extract<Command, { type: 'addEventSeries' }>): Outcome {
  const { series } = command;
  if (state.eventSeries.some((s) => s.id === series.id)) return reject('invalid', 'Event Series id already exists');
  const invalid = seriesChangesError(state, series);
  if (invalid) return invalid;
  const events = command.events ?? [];
  if (events.some((e) => e.seriesId !== series.id)) return reject('invalid', `Events must belong to ${series.id}`);
  const next: GroupState = {
    ...state,
    eventSeries: [...state.eventSeries, toEventSeries({ ...series, name: series.name.trim() })],
  };
  return addEvents(next, events);
}

function editEventSeries(state: GroupState, command: Extract<Command, { type: 'editEventSeries' }>, ctx: Context): Outcome {
  const series = findActiveSeries(state, command.seriesId);
  if (!series) return reject('notFound', `No Event Series ${command.seriesId}`);
  const { changes } = command;
  const invalid = seriesChangesError(state, changes);
  if (invalid) return invalid;
  const updated = toEventSeries({
    id: series.id,
    name: changes.name?.trim() ?? series.name,
    responsibilityIds: changes.responsibilityIds ?? series.responsibilityIds,
    repeat: changes.repeat !== undefined ? changes.repeat : series.repeat,
  });
  const next: GroupState = {
    ...state,
    eventSeries: state.eventSeries.map((s) => (s.id === series.id ? updated : s)),
  };
  const replacement = command.replaceFutureEvents;
  if (!replacement) return done(next);

  if (replacement.some((e) => e.seriesId !== series.id)) return reject('invalid', `Events must belong to ${series.id}`);
  if (replacement.some((e) => ms(e.startsAt) <= ms(ctx.now))) return reject('invalid', 'Replacement Events must be in the future');
  const future = state.events.filter((e) => e.seriesId === series.id && !isPast(e, ctx.now));
  const unchanged = new Set(
    replacement
      .filter((e) => future.some((f) => f.id === e.id && ms(f.startsAt) === ms(e.startsAt)))
      .map((e) => e.id),
  );
  const removed = new Set(future.filter((e) => !unchanged.has(e.id)).map((e) => e.id));
  return addEvents(
    withoutEvents(next, removed),
    replacement.filter((e) => !unchanged.has(e.id)),
  );
}

function removeEventSeries(state: GroupState, seriesId: string, ctx: Context): Outcome {
  if (!findActiveSeries(state, seriesId)) return reject('notFound', `No Event Series ${seriesId}`);
  const future = state.events.filter((e) => e.seriesId === seriesId && !isPast(e, ctx.now)).map((e) => e.id);
  const next: GroupState = {
    ...state,
    eventSeries: state.eventSeries.map((s) => (s.id === seriesId ? { ...s, removedAt: ctx.now } : s)),
  };
  return done(withoutEvents(next, new Set(future)));
}

function addSkipDate(state: GroupState, eventId: string, rawReason: string | null, ctx: Context): Outcome {
  const event = findEvent(state, eventId);
  if (!event) return reject('notFound', `No Event ${eventId}`);
  if (isPast(event, ctx.now)) return reject('eventHasPassed', 'The Event has already started');
  if (event.skipDate) return reject('invalid', 'The Event is already a Skip Date');
  const reason = rawReason?.trim() || null;
  if (reason !== null && reason.length > MAX_SKIP_REASON) return reject('invalid', 'The reason is too long');
  // Covers at a skipped Event never happen, so their Make-up Turns go too.
  const covers = state.assignments.filter((a) => a.eventId === eventId && a.coverageRequest?.cover);
  let next = closeMakeUpTurns(
    state,
    (t) => covers.some((a) => a.id === t.coverAssignmentId),
    'cancelled',
    'coverWithdrawn',
    ctx.now,
  );
  next = {
    ...next,
    events: next.events.map((e) =>
      e.id === eventId ? { ...e, skipDate: { markedBy: ctx.actorId, markedAt: ctx.now, reason } } : e,
    ),
  };
  return done(next);
}

function removeSkipDate(state: GroupState, eventId: string, ctx: Context): Outcome {
  const event = findEvent(state, eventId);
  if (!event) return reject('notFound', `No Event ${eventId}`);
  if (isPast(event, ctx.now)) return reject('eventHasPassed', 'The Event has already started');
  if (!event.skipDate) return reject('notFound', 'The Event is not a Skip Date');
  return done({ ...state, events: state.events.map((e) => (e.id === eventId ? { ...e, skipDate: null } : e)) });
}

// ---------------------------------------------------------------------------
// Time Off

function addTimeOff(state: GroupState, command: Extract<Command, { type: 'addTimeOff' }>, ctx: Context): Outcome {
  const timeOff = toTimeOff(command.timeOff);
  if (state.timeOff.some((t) => t.id === timeOff.id)) return reject('invalid', 'Time Off id already exists');
  if (!isActiveMember(state, timeOff.memberId)) return reject('notFound', 'No such Member');
  if (timeOff.timeZone !== null && !isKnownTimeZone(timeOff.timeZone)) return reject('invalid', 'Unknown time zone');
  let next: GroupState = { ...state, timeOff: [...state.timeOff, timeOff] };
  // A Cover the Member gave for a date they are now away is withdrawn.
  for (const a of next.assignments) {
    const event = findEvent(next, a.eventId);
    const cover = a.coverageRequest?.cover;
    if (!event || isPast(event, ctx.now) || cover?.kind !== 'member' || cover.memberId !== timeOff.memberId) continue;
    if (timeOffCovers(timeOff, event, a.responsibilityId)) next = withdrawCover(next, a.id, ctx.now);
  }
  return done(next);
}

function removeTimeOff(state: GroupState, timeOffId: string, ctx: Context): Outcome {
  const timeOff = state.timeOff.find((t) => t.id === timeOffId);
  if (!timeOff || timeOff.removedAt) return reject('notFound', `No Time Off ${timeOffId}`);
  // Routing that already happened stays: keep the Time Off for the Events it covers now.
  const retainedEventIds = state.events
    .filter((e) => !isPast(e, ctx.now) && state.responsibilities.some((r) => timeOffCovers(timeOff, e, r.id)))
    .map((e) => e.id);
  return done({
    ...state,
    timeOff: state.timeOff.map((t) => (t.id === timeOffId ? { ...t, removedAt: ctx.now, retainedEventIds } : t)),
  });
}

// ---------------------------------------------------------------------------
// Headcount answers

/**
 * "Coming?" Yes / No for one future date of a headcount Job. The date must still need the Job
 * (not a group date off), and the Member must be active. One answer per Member and date:
 * a new answer replaces the old one in place.
 */
function answerHeadcount(state: GroupState, command: Extract<Command, { type: 'answerHeadcount' }>, ctx: Context): Outcome {
  const { eventId, responsibilityId, memberId, answer } = command;
  if (answer !== 'yes' && answer !== 'no') return reject('invalid', 'Answer Yes or No');
  const event = findEvent(state, eventId);
  if (!event) return reject('notFound', `No Event ${eventId}`);
  if (isPast(event, ctx.now)) return reject('eventHasPassed', 'The Event has already started');
  const job = findActiveResponsibility(state, responsibilityId);
  if (!job || job.kind !== 'headcount') return reject('notFound', 'No such headcount Job');
  if (!headcountsNeeded(state, event).some((r) => r.id === responsibilityId)) {
    return reject('invalid', 'That date does not need this Job');
  }
  if (!isActiveMember(state, memberId)) return reject('notFound', 'No such Member');
  const given: HeadcountAnswer = { eventId, responsibilityId, memberId, answer, answeredBy: ctx.actorId, answeredAt: ctx.now };
  const same = (a: HeadcountAnswer) => a.eventId === eventId && a.responsibilityId === responsibilityId && a.memberId === memberId;
  const existing = state.headcountAnswers.some(same);
  return done({
    ...state,
    headcountAnswers: existing
      ? state.headcountAnswers.map((a) => (same(a) ? given : a))
      : [...state.headcountAnswers, given],
  });
}

// ---------------------------------------------------------------------------
// Confirmation, Decline and Cover

type Found = { ok: true; assignment: Assignment } | { ok: false; reason: RejectionReason; message: string };

function futureAssignment(state: GroupState, assignmentId: string, ctx: Context): Found {
  const assignment = state.assignments.find((a) => a.id === assignmentId);
  if (!assignment) return { ok: false, reason: 'notFound', message: `No Assignment ${assignmentId}` };
  const event = findEvent(state, assignment.eventId);
  if (!event || isPast(event, ctx.now)) {
    return { ok: false, reason: 'eventHasPassed', message: 'The Event has already started' };
  }
  return { ok: true, assignment };
}

function updateAssignment(state: GroupState, id: string, update: (a: Assignment) => Assignment): GroupState {
  return { ...state, assignments: state.assignments.map((a) => (a.id === id ? update(a) : a)) };
}

function requestConfirmation(state: GroupState, assignmentIds: string[], ctx: Context): Outcome {
  let next = state;
  for (const id of assignmentIds) {
    const found = futureAssignment(next, id, ctx);
    if (!found.ok) return found;
    next = updateAssignment(next, id, (a) =>
      a.confirmation === 'notYetRequested' ? { ...a, confirmation: 'requested' } : a,
    );
  }
  return done(next);
}

function confirm(state: GroupState, assignmentId: string, ctx: Context): Outcome {
  const found = futureAssignment(state, assignmentId, ctx);
  if (!found.ok) return found;
  const { assignment } = found;
  if (!actsFor(state, ctx, assignment.memberId)) return reject('notPermitted', 'Only the assigned Member can confirm');
  if (assignment.coverageRequest && !assignment.coverageRequest.cover) {
    return reject('alreadyNeedsCoverage', 'The Assignment needs coverage');
  }
  return done(updateAssignment(state, assignmentId, (a) => ({ ...a, confirmation: 'confirmed' })));
}

/**
 * "Can't make it". Without `coveredBy` it opens a Coverage Request: the group is asked and the
 * first volunteer takes it. Only the holder may do that, or anyone for a Stand-in (the request's
 * asker is then the Stand-in). With `coveredBy` the turn goes straight to that cover, in one
 * step and one history entry ("I'll find someone to cover", or "Pick someone to do it" on
 * anyone's turn): a Member cover is a swap as for any Cover, and an outside cover (a name)
 * creates none. Any active Member may name a cover.
 */
function decline(state: GroupState, command: Extract<Command, { type: 'decline' }>, ctx: Context): Outcome {
  const { assignmentId, coveredBy } = command;
  const found = futureAssignment(state, assignmentId, ctx);
  if (!found.ok) return found;
  const { assignment } = found;
  const request = assignment.coverageRequest;
  const note = command.reason?.trim() || null;
  if (note !== null && note.length > MAX_DECLINE_REASON) return reject('invalid', 'The reason is too long');

  if (coveredBy) {
    if (request) return reject('alreadyNeedsCoverage', 'The Assignment already needs coverage; mark it covered instead');
    if (assignment.memberId === null) return reject('invalid', 'No one holds this Assignment');
    const opened = openRequest(state, assignment, note, ctx);
    return coverWith(opened, assignmentId, coveredBy, ctx);
  }

  if (request?.cover) {
    // Declining a Cover withdraws it: the Coverage Request opens again, keeping the
    // original Decline's reason (the coverer's reason is only in the history cause).
    const arranger = request.cover.kind === 'guest' ? request.cover.arrangedBy : null;
    if (!actsFor(state, ctx, assignment.memberId) && ctx.actorId !== arranger) {
      return reject('notPermitted', 'Only the coverer can decline this Assignment');
    }
    return done(withdrawCover(state, assignmentId, ctx.now));
  }
  if (request) return reject('alreadyNeedsCoverage', 'The Assignment already needs coverage');
  if (assignment.memberId === null) return reject('invalid', 'No one holds this Assignment');
  if (!actsFor(state, ctx, assignment.memberId)) return reject('notPermitted', 'Only the assigned Member can decline');
  return done(openRequest(state, assignment, note, ctx));
}

/** Turns the holder's seat into an open Coverage Request asked by the holder. */
function openRequest(state: GroupState, assignment: Assignment, note: string | null, ctx: Context): GroupState {
  const next = updateAssignment(state, assignment.id, (a) => ({
    ...a,
    coverageRequest: { reason: 'declined', requestedBy: a.memberId, requestedAt: ctx.now, note, cover: null },
  }));
  // Declining a Make-up Turn settles it; whoever covers is owed instead.
  if (!assignment.makeUpTurnId) return next;
  return closeMakeUpTurns(next, (t) => t.id === assignment.makeUpTurnId, 'settled', 'movedAlong', ctx.now);
}

/**
 * "I can make it after all": undoes a Decline while its Coverage Request is still open.
 *
 * - Who: the Member who declined, or an Admin (or the system) for a Placeholder Member.
 * - When: before the Event starts and before anyone (Member or guest) covers it. The "find a
 *   replacement by" deadline doesn't matter: taking the seat back ends Replacement Duty too.
 * - Only a Decline: a Time Off Coverage Request goes away by removing the Time Off.
 * - Confirmation follows the Cover rule: saying "I can make it" yourself is a confirmation
 *   (like volunteering to Cover); an Admin speaking for a Placeholder leaves it `requested`
 *   (like Mark covered). It is `notRequired` when the Responsibility needs no confirmation.
 * - A Make-up Turn the Decline settled ("moved along") owes again, since no one covered.
 *
 * The Assignment is no longer pinned, so the schedule step re-plans it; `seatLost` then makes
 * sure the Rotation still gives this seat to the Member (an Admin may have reordered it).
 */
function withdrawDecline(state: GroupState, assignmentId: string, ctx: Context): Outcome {
  const found = futureAssignment(state, assignmentId, ctx);
  if (!found.ok) return found;
  const { assignment } = found;
  const request = assignment.coverageRequest;
  if (!request) return reject('noCoverageRequest', 'The Assignment is not a Coverage Request');
  if (request.cover) return reject('alreadyCovered', 'Someone already covered this Assignment');
  if (request.reason !== 'declined' || request.requestedBy === null) {
    return reject('invalid', 'Only a Decline can be withdrawn; remove the Time Off instead');
  }
  const memberId = request.requestedBy;
  const member = findMember(state, memberId);
  const self = ctx.actorId === memberId;
  if (!member || member.leftAt) return reject('notFound', 'No such Member');
  if (!actsFor(state, ctx, memberId)) return reject('notPermitted', 'Only the Member who declined can take it back');

  const responsibility = findResponsibility(state, assignment.responsibilityId);
  const confirmation = !responsibility?.requiresConfirmation ? 'notRequired' : self ? 'confirmed' : 'requested';
  let next = updateAssignment(state, assignmentId, (a) => ({ ...a, memberId, confirmation, coverageRequest: null }));
  if (assignment.makeUpTurnId) {
    next = {
      ...next,
      makeUpTurns: next.makeUpTurns.map((t) =>
        t.id === assignment.makeUpTurnId && t.status === 'settled' && t.closedReason === 'movedAlong'
          ? { ...t, status: 'outstanding', closedAt: null, closedReason: null }
          : t,
      ),
    };
  }
  return done(next);
}

/** After `withdrawDecline`: the re-planned schedule must seat the Member at that Event again. */
function seatLost(before: GroupState, after: GroupState, assignmentId: string): Rejection | null {
  const old = before.assignments.find((a) => a.id === assignmentId);
  const memberId = old?.coverageRequest?.requestedBy;
  if (!old || !memberId) return null;
  const back = after.assignments.some(
    (a) =>
      a.eventId === old.eventId &&
      a.responsibilityId === old.responsibilityId &&
      a.memberId === memberId &&
      a.coverageRequest === null,
  );
  return back
    ? null
    : reject('invalid', 'The Rotation changed since the Decline, so this seat is no longer theirs to take back');
}

function cover(state: GroupState, assignmentId: string, ctx: Context): Outcome {
  const found = futureAssignment(state, assignmentId, ctx);
  if (!found.ok) return found;
  const { assignment } = found;
  const request = assignment.coverageRequest;
  if (!request) return reject('noCoverageRequest', 'The Assignment is not a Coverage Request');
  if (request.cover) return reject('alreadyCovered', 'Someone already covered this Assignment');
  const coverer = ctx.actorId;
  if (coverer === null || !isActiveMember(state, coverer)) return reject('notPermitted', 'Only a Member can Cover');
  if (!isQualified(state, coverer, assignment.responsibilityId)) {
    return reject('notQualified', 'Only Qualified Members can Cover');
  }
  const conflict = seatConflict(state, assignment, coverer);
  if (conflict) return conflict;

  const responsibility = findResponsibility(state, assignment.responsibilityId);
  const next = updateAssignment(state, assignmentId, (a) => ({
    ...a,
    memberId: coverer,
    // Volunteering is itself a confirmation.
    confirmation: responsibility?.requiresConfirmation ? 'confirmed' : 'notRequired',
    coverageRequest: { ...request, cover: { kind: 'member', memberId: coverer, arrangedBy: coverer, coveredAt: ctx.now } },
  }));
  return done(addMakeUpTurn(next, assignment, coverer, ctx.now));
}

function markCovered(state: GroupState, command: Extract<Command, { type: 'markCovered' }>, ctx: Context): Outcome {
  const found = futureAssignment(state, command.assignmentId, ctx);
  if (!found.ok) return found;
  const { assignment } = found;
  const request = assignment.coverageRequest;
  if (!request) return reject('noCoverageRequest', 'The Assignment is not a Coverage Request');
  if (request.cover) return reject('alreadyCovered', 'Someone already covered this Assignment');
  // No Admins for now: any active Member (checked by permissionError) may pick the cover.
  return coverWith(state, assignment.id, command.by, ctx);
}

/**
 * Covers an open Coverage Request with the given Member (a swap: a Make-up Turn, as for any
 * Cover) or an outside cover: a typed name of someone not in the Group, who holds the seat
 * once (`memberId: null`, no Make-up Turn, since they have no turns to swap).
 */
function coverWith(state: GroupState, assignmentId: string, by: CoverTarget, ctx: Context): Outcome {
  const assignment = state.assignments.find((a) => a.id === assignmentId);
  const request = assignment?.coverageRequest;
  if (!assignment || !request) return reject('noCoverageRequest', 'The Assignment is not a Coverage Request');
  const arrangedBy = ctx.actorId ?? request.requestedBy ?? 'system';

  if ('guestName' in by) {
    const guestName = by.guestName.trim();
    if (!guestName) return reject('invalid', 'An outside cover needs a name');
    if (guestName.length > MAX_GUEST_NAME) return reject('invalid', 'The name is too long');
    return done(
      updateAssignment(state, assignment.id, (a) => ({
        ...a,
        memberId: null,
        confirmation: 'notRequired',
        coverageRequest: { ...request, cover: { kind: 'guest', guestName, arrangedBy, coveredAt: ctx.now } },
      })),
    );
  }

  const memberId = by.memberId;
  if (!isActiveMember(state, memberId)) return reject('notFound', 'No such Member');
  if (memberId === request.requestedBy) return reject('invalid', 'The Member who asked for coverage cannot cover it');
  const conflict = seatConflict(state, assignment, memberId);
  if (conflict) return conflict;
  const responsibility = findResponsibility(state, assignment.responsibilityId);
  const next = updateAssignment(state, assignment.id, (a) => ({
    ...a,
    memberId,
    confirmation: responsibility?.requiresConfirmation ? 'requested' : 'notRequired',
    coverageRequest: { ...request, cover: { kind: 'member', memberId, arrangedBy, coveredAt: ctx.now } },
  }));
  return done(addMakeUpTurn(next, assignment, memberId, ctx.now));
}

function seatConflict(state: GroupState, target: Assignment, memberId: MemberId): Outcome | null {
  if (target.coverageRequest?.requestedBy === memberId) {
    return reject('invalid', 'The Member who asked for coverage cannot cover it');
  }
  const clash = state.assignments.find(
    (a) =>
      a.id !== target.id &&
      a.eventId === target.eventId &&
      a.memberId === memberId &&
      (a.coverageRequest === null || a.coverageRequest.cover !== null) &&
      (a.responsibilityId === target.responsibilityId || !state.settings.allowDoubling),
  );
  return clash ? reject('alreadyAssignedAtEvent', 'The Member already holds a seat at this Event') : null;
}

/**
 * Under Pay It Back a Cover creates a Make-up Turn, but only when the coverer has
 * turns in that Responsibility to give (a Qualified Member) and someone asked.
 */
function addMakeUpTurn(state: GroupState, covered: Assignment, coverer: MemberId, now: Instant): GroupState {
  const debtorId = covered.coverageRequest?.requestedBy ?? null;
  if (state.settings.coveragePolicy !== 'payItBack' || debtorId === null) return state;
  if (!isQualified(state, coverer, covered.responsibilityId)) return state;
  const [id, next] = nextId(state, 'm');
  const turn: MakeUpTurn = {
    id,
    responsibilityId: covered.responsibilityId,
    debtorId,
    creditorId: coverer,
    coverAssignmentId: covered.id,
    createdAt: now,
    status: 'outstanding',
    closedAt: null,
    closedReason: null,
  };
  return { ...next, makeUpTurns: [...next.makeUpTurns, turn] };
}

/** Takes a Cover back: the Assignment is a Coverage Request again and its Make-up Turn is cancelled. */
function withdrawCover(state: GroupState, assignmentId: string, now: Instant): GroupState {
  const next = updateAssignment(state, assignmentId, (a) => {
    const request = a.coverageRequest;
    if (!request?.cover) return a;
    const responsibility = findResponsibility(state, a.responsibilityId);
    return {
      ...a,
      memberId: request.requestedBy,
      confirmation: initialConfirmation(responsibility, request.requestedBy),
      coverageRequest: { ...request, cover: null },
    };
  });
  return closeMakeUpTurns(next, (t) => t.coverAssignmentId === assignmentId, 'cancelled', 'coverWithdrawn', now);
}

function closeMakeUpTurns(
  state: GroupState,
  which: (turn: MakeUpTurn) => boolean,
  status: Exclude<MakeUpTurnStatus, 'outstanding'>,
  closedReason: MakeUpTurnClosedReason,
  now: Instant,
): GroupState {
  return {
    ...state,
    makeUpTurns: state.makeUpTurns.map((t) =>
      t.status === 'outstanding' && which(t) ? { ...t, status, closedAt: now, closedReason } : t,
    ),
  };
}

/**
 * Whether the actor may act on behalf of this Member: the system, the Member themselves, or
 * any active Member for a Stand-in (a Placeholder Member: no account, so others act for them).
 */
function actsFor(state: GroupState, ctx: Context, memberId: MemberId | null): boolean {
  if (ctx.actorId === null) return true;
  if (memberId === null) return false;
  return ctx.actorId === memberId || (isActiveMember(state, ctx.actorId) && isStandIn(state, memberId));
}

/** A Placeholder Member still in the Group: in the Rotations like anyone, but not on the app. */
function isStandIn(state: GroupState, memberId: MemberId): boolean {
  const member = findMember(state, memberId);
  return member !== undefined && member.leftAt === null && member.accountId === null;
}

// ---------------------------------------------------------------------------
// Settings and Rebalance

function changeSettings(
  state: GroupState,
  settings: Extract<Command, { type: 'changeSettings' }>['settings'],
  ctx: Context,
): Outcome {
  let next: GroupState = { ...state, settings: { ...state.settings, ...settings } };
  if (state.settings.coveragePolicy === 'payItBack' && next.settings.coveragePolicy === 'countRealWork') {
    next = closeMakeUpTurns(next, () => true, 'cancelled', 'coveragePolicyChanged', ctx.now);
  }
  return done(next);
}

function rebalance(state: GroupState, responsibilityId: string, ctx: Context): Outcome {
  if (!findActiveResponsibility(state, responsibilityId)) return reject('notFound', 'No such Responsibility');
  const load = new Map(workload(state, responsibilityId, ctx.now).map((w) => [w.memberId, w.served + w.covered]));
  const next: GroupState = {
    ...state,
    rotations: state.rotations.map((r) =>
      r.responsibilityId === responsibilityId ? reorderQueue(r, (m) => load.get(m) ?? 0) : r,
    ),
  };
  return done(closeMakeUpTurns(next, (t) => t.responsibilityId === responsibilityId, 'settled', 'rebalance', ctx.now));
}

// ---------------------------------------------------------------------------
// Members

function addMember(state: GroupState, command: Extract<Command, { type: 'addMember' }>): Outcome {
  if (findMember(state, command.member.id)) return reject('invalid', 'Member id already exists');
  let next: GroupState = { ...state, members: [...state.members, toMember(command.member)] };
  for (const responsibilityId of command.qualifiedFor ?? []) {
    const outcome = qualifyMember(next, command.member.id, responsibilityId);
    if (!outcome.ok) return outcome;
    next = outcome.state;
  }
  return done(next);
}

function qualifyMember(state: GroupState, memberId: string, responsibilityId: string): Outcome {
  if (!isActiveMember(state, memberId)) return reject('notFound', 'No such Member');
  const job = findActiveResponsibility(state, responsibilityId);
  if (!job) return reject('notFound', 'No such Responsibility');
  // A headcount Job has no Rotation: everyone in the Group is asked "Coming?".
  if (job.kind === 'headcount') return done(state);
  return done(withRotation(state, appendToQueue(rotationOf(state, responsibilityId), memberId)));
}

function withRotation(state: GroupState, rotation: Rotation): GroupState {
  const exists = state.rotations.some((r) => r.responsibilityId === rotation.responsibilityId);
  const rotations = exists
    ? state.rotations.map((r) => (r.responsibilityId === rotation.responsibilityId ? rotation : r))
    : [...state.rotations, rotation];
  return { ...state, rotations };
}

function unqualifyMember(state: GroupState, memberId: string, responsibilityId: string, ctx: Context): Outcome {
  if (!findMember(state, memberId)) return reject('notFound', 'No such Member');
  const next: GroupState = {
    ...state,
    rotations: state.rotations.map((r) => (r.responsibilityId === responsibilityId ? removeFromQueue(r, memberId) : r)),
  };
  return done(
    closeMakeUpTurns(
      next,
      (t) => t.responsibilityId === responsibilityId && (t.debtorId === memberId || t.creditorId === memberId),
      'cancelled',
      'memberNoLongerQualified',
      ctx.now,
    ),
  );
}

function removeMember(state: GroupState, memberId: string, ctx: Context): Outcome {
  const member = findMember(state, memberId);
  if (!member || member.leftAt) return reject('notFound', 'No such Member');

  let next: GroupState = {
    ...state,
    members: state.members.map((m) => (m.id === memberId ? { ...m, leftAt: ctx.now } : m)),
    rotations: state.rotations.map((r) => removeFromQueue(r, memberId)),
  };
  next = closeMakeUpTurns(
    next,
    (t) => t.debtorId === memberId || t.creditorId === memberId,
    'cancelled',
    'memberLeft',
    ctx.now,
  );
  for (const a of next.assignments) {
    const event = findEvent(next, a.eventId);
    if (!event || isPast(event, ctx.now)) continue;
    const request = a.coverageRequest;
    if (request?.cover?.kind === 'member' && request.cover.memberId === memberId) {
      next = withdrawCover(next, a.id, ctx.now);
    } else if (request && !request.cover && request.requestedBy === memberId) {
      // Their open Coverage Request goes back to the Rotation, which closes up around them.
      next = updateAssignment(next, a.id, (x) => ({ ...x, coverageRequest: null }));
    }
  }
  return done(next);
}

function claimPlaceholder(state: GroupState, memberId: string, accountId: string, name?: string): Outcome {
  const member = findMember(state, memberId);
  if (!member || member.leftAt) return reject('notFound', 'No such Member');
  if (member.accountId !== null) return reject('invalid', 'This Member is not a Placeholder Member');
  // The person's own name replaces the typed one, like a rename (past turns show it too).
  const ownName = name?.trim();
  return done({
    ...state,
    members: state.members.map((m) => (m.id === memberId ? { ...m, accountId, name: ownName ? ownName : m.name } : m)),
  });
}

/**
 * "This is someone in the group" (ADR 0008): the Stand-in `standInId` is really `intoId`, a
 * Member on the app who joined separately. From now on, everything the Stand-in had is theirs:
 *
 * - Rotations: `intoId` takes the earlier of the two places in each queue and the other place
 *   is dropped (a Stand-in-only place simply becomes theirs).
 * - Future Covers the Stand-in gives, Can't-make-its they asked, and swaps (Make-up Turns) owed
 *   either way. A Cover between the two of them makes no sense for one person: if the real
 *   Member couldn't make it and the Stand-in covered, the turn needs cover again; if the real
 *   Member covered the Stand-in, the turn just goes back to the Rotation. A moved Cover that
 *   lands on the real Member's dates off, or on a day they already have a fixed turn, is
 *   withdrawn (the group is asked again).
 * - Dates off and future "Coming?" answers (the real Member's own answer wins).
 *
 * Past history keeps the Stand-in's name. The Stand-in then leaves, keeping the real Member's
 * account so the planner knows they are one person (no back-to-back with the Stand-in's last
 * turn). The schedule step then re-plans the future, which applies every rotation rule.
 */
function mergeStandIn(state: GroupState, standInId: MemberId, intoId: MemberId, ctx: Context): Outcome {
  if (standInId === intoId) return reject('invalid', 'Pick someone else');
  if (!isStandIn(state, standInId)) return reject('notFound', 'No such Stand-in');
  const into = findMember(state, intoId);
  if (!into || into.leftAt !== null) return reject('notFound', 'No such Member');
  if (into.accountId === null) return reject('invalid', 'Pick someone who is on the app');
  const swap = (id: MemberId | null) => (id === standInId ? intoId : id);
  const future = (a: Assignment) => {
    const event = findEvent(state, a.eventId);
    return event !== undefined && !isPast(event, ctx.now);
  };

  let next: GroupState = {
    ...state,
    rotations: state.rotations.map((r) => mergeQueuePlace(r, standInId, intoId)),
    timeOff: state.timeOff.map((t) => (t.memberId === standInId ? { ...t, memberId: intoId } : t)),
  };

  // Future seats. Covers the Stand-in gave are checked once everything has moved.
  const movedCovers: string[] = [];
  for (const a of state.assignments) {
    if (!future(a)) continue;
    const request = a.coverageRequest;
    const cover = request?.cover;
    if (cover?.kind === 'member' && cover.memberId === standInId && request?.requestedBy === intoId) {
      next = withdrawCover(next, a.id, ctx.now);
    } else if (cover?.kind === 'member' && cover.memberId === intoId && request?.requestedBy === standInId) {
      next = closeMakeUpTurns(next, (t) => t.coverAssignmentId === a.id, 'cancelled', 'memberLeft', ctx.now);
      next = updateAssignment(next, a.id, (x) => ({ ...x, turnOf: intoId, coverageRequest: null }));
    } else {
      if (cover?.kind === 'member' && cover.memberId === standInId) movedCovers.push(a.id);
      next = updateAssignment(next, a.id, (x) => ({
        ...x,
        memberId: swap(x.memberId),
        turnOf: swap(x.turnOf),
        coverageRequest: x.coverageRequest && {
          ...x.coverageRequest,
          requestedBy: swap(x.coverageRequest.requestedBy),
          cover:
            x.coverageRequest.cover?.kind === 'member'
              ? { ...x.coverageRequest.cover, memberId: swap(x.coverageRequest.cover.memberId) as MemberId }
              : x.coverageRequest.cover,
        },
      }));
    }
  }
  for (const id of movedCovers) {
    const a = next.assignments.find((x) => x.id === id);
    const event = a && findEvent(next, a.eventId);
    if (!a || !event) continue;
    const away = next.timeOff.some((t) => t.memberId === intoId && timeOffCovers(t, event, a.responsibilityId));
    const busy = next.assignments.some((other) => {
      const at = other.id !== id && other.memberId === intoId && isPinned(other) && !!other.coverageRequest?.cover;
      const otherEvent = at ? findEvent(next, other.eventId) : undefined;
      return otherEvent !== undefined && onSameDay(next, otherEvent, event);
    });
    if (away || busy) next = withdrawCover(next, id, ctx.now);
  }

  // Swaps still owed: the real Member owes or is owed instead. One owed to themselves goes.
  next = closeMakeUpTurns(
    next,
    (t) => (t.debtorId === standInId && t.creditorId === intoId) || (t.debtorId === intoId && t.creditorId === standInId),
    'cancelled',
    'memberLeft',
    ctx.now,
  );
  next = {
    ...next,
    makeUpTurns: next.makeUpTurns.map((t) =>
      t.status === 'outstanding' ? { ...t, debtorId: swap(t.debtorId) as MemberId, creditorId: swap(t.creditorId) as MemberId } : t,
    ),
  };

  // Future "Coming?" answers.
  const answeredByInto = new Set(
    next.headcountAnswers.filter((h) => h.memberId === intoId).map((h) => `${h.eventId}|${h.responsibilityId}`),
  );
  next = {
    ...next,
    headcountAnswers: next.headcountAnswers.flatMap((h) => {
      const event = findEvent(next, h.eventId);
      if (h.memberId !== standInId || !event || isPast(event, ctx.now)) return [h];
      return answeredByInto.has(`${h.eventId}|${h.responsibilityId}`) ? [] : [{ ...h, memberId: intoId }];
    }),
  };

  return done({
    ...next,
    members: next.members.map((m) => (m.id === standInId ? { ...m, leftAt: ctx.now, accountId: into.accountId } : m)),
  });
}

/** One queue place for the merged person: the earlier of the two, keeping that place's early turns. */
function mergeQueuePlace(rotation: Rotation, standInId: MemberId, intoId: MemberId): Rotation {
  const s = rotation.queue.indexOf(standInId);
  if (s < 0) return rotation;
  const i = rotation.queue.indexOf(intoId);
  const kept = i < 0 ? s : Math.min(s, i);
  const early: Record<MemberId, number> = { ...rotation.turnsTakenEarly };
  const keptEarly = early[rotation.queue[kept]] ?? 0;
  delete early[standInId];
  delete early[intoId];
  if (keptEarly > 0) early[intoId] = keptEarly;
  const queue = rotation.queue.flatMap((m, index) => {
    if (index === kept) return [intoId];
    return m === standInId || m === intoId ? [] : [m];
  });
  return { ...rotation, queue, turnsTakenEarly: early };
}

function renameMember(state: GroupState, memberId: string, name: string): Outcome {
  const member = findMember(state, memberId);
  if (!member || member.leftAt) return reject('notFound', 'No such Member');
  const trimmed = name.trim();
  if (trimmed === '') return reject('invalid', 'A name is needed');
  return done({ ...state, members: state.members.map((m) => (m.id === memberId ? { ...m, name: trimmed } : m)) });
}

function isLastAdmin(state: GroupState, memberId: string): boolean {
  const admins = activeAdmins(state);
  return admins.length === 1 && admins[0].id === memberId;
}

function setAdmin(state: GroupState, memberId: string, value: boolean): Outcome {
  const member = findMember(state, memberId);
  if (!member || member.leftAt) return reject('notFound', 'No such Member');
  if (value && member.accountId === null) {
    return reject('invalid', 'A Placeholder Member can be made an Admin once they have joined');
  }
  if (!value && isLastAdmin(state, memberId)) {
    return reject('lastAdmin', 'The last Admin cannot step down; appoint another Admin first');
  }
  return done({ ...state, members: state.members.map((m) => (m.id === memberId ? { ...m, isAdmin: value } : m)) });
}

// ---------------------------------------------------------------------------
// Responsibilities

function responsibilityChangesError(changes: ResponsibilityChanges): Outcome | null {
  if (changes.name !== undefined && changes.name.trim() === '') return reject('invalid', 'A name is needed');
  if (changes.kind !== undefined && changes.kind !== 'turns' && changes.kind !== 'headcount') {
    return reject('invalid', 'A Job takes turns or is a headcount');
  }
  if (changes.headcount !== undefined && (!Number.isInteger(changes.headcount) || changes.headcount < 1)) {
    return reject('invalid', 'Headcount must be a whole number of at least 1');
  }
  return null;
}

function addResponsibility(state: GroupState, command: Extract<Command, { type: 'addResponsibility' }>): Outcome {
  const { responsibility } = command;
  if (findResponsibility(state, responsibility.id)) return reject('invalid', 'Responsibility id already exists');
  const invalid = responsibilityChangesError(responsibility);
  if (invalid) return invalid;
  let next: GroupState = withRotation(
    {
      ...state,
      responsibilities: [...state.responsibilities, toResponsibility({ ...responsibility, name: responsibility.name.trim() })],
    },
    { responsibilityId: responsibility.id, queue: [], turnsTakenEarly: {} },
  );
  for (const memberId of command.qualifiedMemberIds ?? []) {
    const outcome = qualifyMember(next, memberId, responsibility.id);
    if (!outcome.ok) return outcome;
    next = outcome.state;
  }
  return done(next);
}

/**
 * Edits a Responsibility. Its future Assignments are recomputed by the schedule step
 * (a new headcount adds or removes seats from the next Event on). Declines and Covers
 * are not recomputed, so a change to confirmation is applied to them here.
 */
function editResponsibility(state: GroupState, id: string, changes: ResponsibilityChanges, ctx: Context): Outcome {
  const current = findActiveResponsibility(state, id);
  if (!current) return reject('notFound', 'No such Responsibility');
  const invalid = responsibilityChangesError(changes);
  if (invalid) return invalid;
  const updated = {
    ...current,
    name: changes.name?.trim() ?? current.name,
    kind: changes.kind ?? current.kind,
    headcount: changes.headcount ?? current.headcount,
    requiresConfirmation: changes.requiresConfirmation ?? current.requiresConfirmation,
  };
  let next: GroupState = { ...state, responsibilities: state.responsibilities.map((r) => (r.id === id ? updated : r)) };
  if (updated.kind !== current.kind) {
    if (updated.kind === 'headcount') {
      // No more turns: the Rotation empties, its future seats go (the schedule step) and so
      // do the swaps owed in it.
      next = withRotation(next, withQueueOrder(rotationOf(next, id), []));
      next = closeMakeUpTurns(next, (t) => t.responsibilityId === id, 'cancelled', 'responsibilityRemoved', ctx.now);
    } else {
      // Everyone does every Job: the whole Group takes turns, in join order.
      const everyone = next.members.filter((m) => m.leftAt === null).map((m) => m.id);
      next = withRotation(next, withQueueOrder(rotationOf(next, id), everyone));
    }
  }
  if (updated.requiresConfirmation !== current.requiresConfirmation) {
    next = {
      ...next,
      assignments: next.assignments.map((a) => {
        if (a.responsibilityId !== id || !isPinned(a) || isHistory(next, a, ctx.now)) return a;
        if (!updated.requiresConfirmation) return { ...a, confirmation: 'notRequired' };
        return a.memberId !== null && a.confirmation === 'notRequired' ? { ...a, confirmation: 'notYetRequested' } : a;
      }),
    };
  }
  return done(next);
}

/**
 * Removes a Responsibility from now on. It stays in the state for past Events' history;
 * its future seats go, no one stays Qualified, and its Make-up Turns are cancelled.
 */
function removeResponsibility(state: GroupState, id: string, ctx: Context): Outcome {
  if (!findActiveResponsibility(state, id)) return reject('notFound', 'No such Responsibility');
  const next: GroupState = withRotation(
    {
      ...state,
      responsibilities: state.responsibilities.map((r) => (r.id === id ? { ...r, removedAt: ctx.now } : r)),
      primaryResponsibilityId: state.primaryResponsibilityId === id ? null : state.primaryResponsibilityId,
    },
    withQueueOrder(rotationOf(state, id), []),
  );
  return done(closeMakeUpTurns(next, (t) => t.responsibilityId === id, 'cancelled', 'responsibilityRemoved', ctx.now));
}

const isPermutationOf = (list: string[], of: string[]) =>
  list.length === of.length && new Set(list).size === list.length && list.every((x) => of.includes(x));

/** Sets the fill order. The list names every current Responsibility once; removed ones follow. */
function reorderResponsibilities(state: GroupState, ids: string[]): Outcome {
  const active = state.responsibilities.filter((r) => r.removedAt === null);
  if (!isPermutationOf(ids, active.map((r) => r.id))) {
    return reject('invalid', 'List every Responsibility exactly once');
  }
  const ordered = ids.map((id) => active.find((r) => r.id === id)!);
  return done({ ...state, responsibilities: [...ordered, ...state.responsibilities.filter((r) => r.removedAt !== null)] });
}

function setPrimaryResponsibility(state: GroupState, id: string | null): Outcome {
  if (id !== null && !findActiveResponsibility(state, id)) return reject('notFound', 'No such Responsibility');
  return done({ ...state, primaryResponsibilityId: id });
}

/**
 * An Admin puts a Rotation's queue in a new order. Early turns are forgotten exactly as
 * in Rebalance; Make-up Turns stay outstanding (only Rebalance settles them, because
 * only Rebalance orders by workload).
 */
function reorderQueueByHand(state: GroupState, responsibilityId: string, queue: string[]): Outcome {
  if (!findActiveResponsibility(state, responsibilityId)) return reject('notFound', 'No such Responsibility');
  const rotation = rotationOf(state, responsibilityId);
  if (!isPermutationOf(queue, rotation.queue)) {
    return reject('invalid', 'The new order must list each Qualified Member exactly once');
  }
  return done(withRotation(state, withQueueOrder(rotation, queue)));
}
