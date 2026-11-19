/**
 * Maps a Group's engine state to database rows and back.
 *
 * The row shapes mirror the tables in supabase/migrations (snake_case columns). Each
 * GroupState array is stored with a `position`, so `stateFromRows(rowsFromState(s))`
 * deep-equals `s` (instants are normalized to `Date#toISOString()` form).
 *
 * Pure TypeScript with relative imports only: the group-command Edge Function (Deno)
 * uses a copy of this file (see scripts/sync-functions-shared.mjs), and the app can use
 * it to build a GroupState for local previews from `group_state_rows`.
 */
import type {
  Assignment,
  Confirmation,
  CoveragePolicy,
  CoverageRequest,
  GroupState,
  HeadcountReply,
  Instant,
  JobKind,
  MakeUpTurnClosedReason,
  MakeUpTurnStatus,
  RepeatPattern,
  ReplacementDuty,
  TimeOffHandling,
} from '../engine';

// ---------------------------------------------------------------------------
// Row shapes (engine columns only; tables may have more, e.g. groups.name)

export interface GroupRow {
  id: string;
  coverage_policy: CoveragePolicy;
  time_off_handling: TimeOffHandling;
  allow_doubling: boolean;
  replacement_duty: ReplacementDuty;
  replacement_deadline_ms: number;
  primary_responsibility_id: string | null;
  rotated_through: string | null;
  id_sequence: number;
}

export interface MemberRow {
  id: string;
  position: number;
  display_name: string;
  is_admin: boolean;
  account_id: string | null;
  left_at: string | null;
}

export interface ResponsibilityRow {
  id: string;
  position: number;
  name: string;
  /** Added by 20261124000000_headcount_jobs.sql; absent (take turns) in older selects. */
  kind?: JobKind;
  headcount: number;
  requires_confirmation: boolean;
  removed_at: string | null;
}

export interface RotationRow {
  responsibility_id: string;
  position: number;
  queue: string[];
  turns_taken_early: Record<string, number>;
}

export interface EventSeriesRow {
  id: string;
  position: number;
  name: string;
  responsibility_ids: string[];
  /** The engine's RepeatPattern as jsonb (see the 20261116 migration). */
  repeat: RepeatPattern | null;
  removed_at: string | null;
}

export interface EventRow {
  id: string;
  position: number;
  series_id: string | null;
  starts_at: string;
  responsibility_ids: string[] | null;
  skip_date_marked_at: string | null;
  skip_date_marked_by: string | null;
  /** Added by 20261119000000_skip_reason_time_off_zone.sql; absent in older selects. */
  skip_date_reason?: string | null;
}

export interface TimeOffRow {
  id: string;
  position: number;
  member_id: string;
  starts_at: string;
  ends_at: string;
  repeat_every_weeks: number | null;
  repeat_until: string | null;
  responsibility_ids: string[] | null;
  removed_at: string | null;
  retained_event_ids: string[];
  /** Added by 20261119000000_skip_reason_time_off_zone.sql; absent in older selects. */
  time_zone?: string | null;
  note?: string | null;
}

export interface MakeUpTurnRow {
  id: string;
  position: number;
  responsibility_id: string;
  debtor_id: string;
  creditor_id: string;
  cover_assignment_id: string;
  created_at: string;
  status: MakeUpTurnStatus;
  closed_at: string | null;
  closed_reason: MakeUpTurnClosedReason | null;
}

export interface AssignmentRow {
  id: string;
  position: number;
  event_id: string;
  responsibility_id: string;
  member_id: string | null;
  turn_of: string | null;
  make_up_turn_id: string | null;
  confirmation: Confirmation;
  coverage_reason: CoverageRequest['reason'] | null;
  coverage_requested_by: string | null;
  coverage_requested_at: string | null;
  /** CoverageRequest.note (migration 20261120000000). Optional so older payloads still type. */
  coverage_note?: string | null;
  cover_kind: 'member' | 'guest' | null;
  cover_member_id: string | null;
  cover_guest_name: string | null;
  cover_arranged_by: string | null;
  covered_at: string | null;
}

/** A "Coming?" answer (20261124000000_headcount_jobs.sql). */
export interface HeadcountAnswerRow {
  event_id: string;
  responsibility_id: string;
  member_id: string;
  position: number;
  answer: HeadcountReply;
  answered_by: string | null;
  answered_at: string;
}

/** Everything `group_state_rows` returns and `apply_group_command_result` takes. */
export interface GroupRows {
  group: GroupRow;
  members: MemberRow[];
  responsibilities: ResponsibilityRow[];
  rotations: RotationRow[];
  event_series: EventSeriesRow[];
  events: EventRow[];
  time_off: TimeOffRow[];
  make_up_turns: MakeUpTurnRow[];
  assignments: AssignmentRow[];
  /** Optional so payloads from before 20261124000000_headcount_jobs.sql still read (as none). */
  headcount_answers?: HeadcountAnswerRow[];
}

/** Postgres returns timestamptz as e.g. "2027-01-03T09:00:00+00:00"; the engine uses toISOString form. */
export function toInstant(value: string): Instant {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`Not a timestamp: ${value}`);
  return new Date(parsed).toISOString();
}

const instantOrNull = (value: string | null): Instant | null => (value === null ? null : toInstant(value));

/** A copy of the repeat pattern with only its known fields, in a fixed order. */
function copyRepeat(p: RepeatPattern | null): RepeatPattern | null {
  if (p === null) return null;
  return {
    frequency: p.frequency,
    intervalWeeks: p.intervalWeeks ?? null,
    daysOfWeek: [...p.daysOfWeek],
    weekOfMonth: p.weekOfMonth ?? null,
    startTime: p.startTime,
    timeZone: p.timeZone,
    startsOn: p.startsOn,
  };
}

// ---------------------------------------------------------------------------
// GroupState -> rows

export function rowsFromState(state: GroupState): GroupRows {
  const { settings } = state;
  return {
    group: {
      id: state.groupId,
      coverage_policy: settings.coveragePolicy,
      time_off_handling: settings.timeOffHandling,
      allow_doubling: settings.allowDoubling,
      replacement_duty: settings.replacementDuty,
      replacement_deadline_ms: settings.replacementDeadlineMs,
      primary_responsibility_id: state.primaryResponsibilityId,
      rotated_through: state.rotatedThrough,
      id_sequence: state.idSequence,
    },
    members: state.members.map((m, position) => ({
      id: m.id,
      position,
      display_name: m.name,
      is_admin: m.isAdmin,
      account_id: m.accountId,
      left_at: m.leftAt,
    })),
    responsibilities: state.responsibilities.map((r, position) => ({
      id: r.id,
      position,
      name: r.name,
      kind: r.kind,
      headcount: r.headcount,
      requires_confirmation: r.requiresConfirmation,
      removed_at: r.removedAt,
    })),
    rotations: state.rotations.map((r, position) => ({
      responsibility_id: r.responsibilityId,
      position,
      queue: [...r.queue],
      turns_taken_early: { ...r.turnsTakenEarly },
    })),
    event_series: state.eventSeries.map((s, position) => ({
      id: s.id,
      position,
      name: s.name,
      responsibility_ids: [...s.responsibilityIds],
      repeat: copyRepeat(s.repeat),
      removed_at: s.removedAt,
    })),
    events: state.events.map((e, position) => ({
      id: e.id,
      position,
      series_id: e.seriesId,
      starts_at: e.startsAt,
      responsibility_ids: e.responsibilityIds && [...e.responsibilityIds],
      skip_date_marked_at: e.skipDate?.markedAt ?? null,
      skip_date_marked_by: e.skipDate?.markedBy ?? null,
      skip_date_reason: e.skipDate?.reason ?? null,
    })),
    time_off: state.timeOff.map((t, position) => ({
      id: t.id,
      position,
      member_id: t.memberId,
      starts_at: t.startsAt,
      ends_at: t.endsAt,
      repeat_every_weeks: t.repeatEveryWeeks,
      repeat_until: t.repeatUntil,
      responsibility_ids: t.responsibilityIds && [...t.responsibilityIds],
      removed_at: t.removedAt,
      retained_event_ids: [...t.retainedEventIds],
      time_zone: t.timeZone,
      note: t.note,
    })),
    make_up_turns: state.makeUpTurns.map((t, position) => ({
      id: t.id,
      position,
      responsibility_id: t.responsibilityId,
      debtor_id: t.debtorId,
      creditor_id: t.creditorId,
      cover_assignment_id: t.coverAssignmentId,
      created_at: t.createdAt,
      status: t.status,
      closed_at: t.closedAt,
      closed_reason: t.closedReason,
    })),
    assignments: state.assignments.map(assignmentRow),
    headcount_answers: state.headcountAnswers.map((a, position) => ({
      event_id: a.eventId,
      responsibility_id: a.responsibilityId,
      member_id: a.memberId,
      position,
      answer: a.answer,
      answered_by: a.answeredBy,
      answered_at: a.answeredAt,
    })),
  };
}

function assignmentRow(a: Assignment, position: number): AssignmentRow {
  const request = a.coverageRequest;
  const cover = request?.cover ?? null;
  return {
    id: a.id,
    position,
    event_id: a.eventId,
    responsibility_id: a.responsibilityId,
    member_id: a.memberId,
    turn_of: a.turnOf,
    make_up_turn_id: a.makeUpTurnId,
    confirmation: a.confirmation,
    coverage_reason: request?.reason ?? null,
    coverage_requested_by: request?.requestedBy ?? null,
    coverage_requested_at: request?.requestedAt ?? null,
    coverage_note: request?.note ?? null,
    cover_kind: cover?.kind ?? null,
    cover_member_id: cover?.kind === 'member' ? cover.memberId : null,
    cover_guest_name: cover?.kind === 'guest' ? cover.guestName : null,
    cover_arranged_by: cover?.arrangedBy ?? null,
    covered_at: cover?.coveredAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// rows -> GroupState

const byPosition = <T extends { position: number }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => a.position - b.position);

export function stateFromRows(rows: GroupRows): GroupState {
  const g = rows.group;
  return {
    groupId: g.id,
    settings: {
      coveragePolicy: g.coverage_policy,
      timeOffHandling: g.time_off_handling,
      allowDoubling: g.allow_doubling,
      replacementDuty: g.replacement_duty,
      replacementDeadlineMs: Number(g.replacement_deadline_ms),
    },
    primaryResponsibilityId: g.primary_responsibility_id,
    members: byPosition(rows.members).map((m) => ({
      id: m.id,
      name: m.display_name,
      isAdmin: m.is_admin,
      accountId: m.account_id,
      leftAt: instantOrNull(m.left_at),
    })),
    responsibilities: byPosition(rows.responsibilities).map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind ?? 'turns',
      headcount: r.headcount,
      requiresConfirmation: r.requires_confirmation,
      removedAt: instantOrNull(r.removed_at ?? null),
    })),
    rotations: byPosition(rows.rotations).map((r) => ({
      responsibilityId: r.responsibility_id,
      queue: [...r.queue],
      turnsTakenEarly: { ...r.turns_taken_early },
    })),
    eventSeries: byPosition(rows.event_series).map((s) => ({
      id: s.id,
      name: s.name,
      responsibilityIds: [...s.responsibility_ids],
      repeat: copyRepeat(s.repeat ?? null),
      removedAt: instantOrNull(s.removed_at ?? null),
    })),
    events: byPosition(rows.events).map((e) => ({
      id: e.id,
      seriesId: e.series_id,
      startsAt: toInstant(e.starts_at),
      responsibilityIds: e.responsibility_ids && [...e.responsibility_ids],
      skipDate:
        e.skip_date_marked_at === null
          ? null
          : {
              markedBy: e.skip_date_marked_by,
              markedAt: toInstant(e.skip_date_marked_at),
              reason: e.skip_date_reason ?? null,
            },
    })),
    timeOff: byPosition(rows.time_off).map((t) => ({
      id: t.id,
      memberId: t.member_id,
      startsAt: toInstant(t.starts_at),
      endsAt: toInstant(t.ends_at),
      repeatEveryWeeks: t.repeat_every_weeks,
      repeatUntil: instantOrNull(t.repeat_until),
      responsibilityIds: t.responsibility_ids && [...t.responsibility_ids],
      removedAt: instantOrNull(t.removed_at),
      retainedEventIds: [...t.retained_event_ids],
      timeZone: t.time_zone ?? null,
      note: t.note ?? null,
    })),
    assignments: byPosition(rows.assignments).map(assignmentFromRow),
    makeUpTurns: byPosition(rows.make_up_turns).map((t) => ({
      id: t.id,
      responsibilityId: t.responsibility_id,
      debtorId: t.debtor_id,
      creditorId: t.creditor_id,
      coverAssignmentId: t.cover_assignment_id,
      createdAt: toInstant(t.created_at),
      status: t.status,
      closedAt: instantOrNull(t.closed_at),
      closedReason: t.closed_reason,
    })),
    headcountAnswers: byPosition(rows.headcount_answers ?? []).map((a) => ({
      eventId: a.event_id,
      responsibilityId: a.responsibility_id,
      memberId: a.member_id,
      answer: a.answer,
      answeredBy: a.answered_by,
      answeredAt: toInstant(a.answered_at),
    })),
    rotatedThrough: instantOrNull(g.rotated_through),
    idSequence: g.id_sequence,
  };
}

function assignmentFromRow(r: AssignmentRow): Assignment {
  return {
    id: r.id,
    eventId: r.event_id,
    responsibilityId: r.responsibility_id,
    memberId: r.member_id,
    turnOf: r.turn_of,
    makeUpTurnId: r.make_up_turn_id,
    confirmation: r.confirmation,
    coverageRequest: coverageRequestFromRow(r),
  };
}

function coverageRequestFromRow(r: AssignmentRow): CoverageRequest | null {
  if (r.coverage_reason === null || r.coverage_requested_at === null) return null;
  return {
    reason: r.coverage_reason,
    requestedBy: r.coverage_requested_by,
    requestedAt: toInstant(r.coverage_requested_at),
    note: r.coverage_note ?? null,
    cover: coverFromRow(r),
  };
}

function coverFromRow(r: AssignmentRow): CoverageRequest['cover'] {
  if (r.cover_kind === null || r.covered_at === null || r.cover_arranged_by === null) return null;
  const common = { arrangedBy: r.cover_arranged_by, coveredAt: toInstant(r.covered_at) };
  if (r.cover_kind === 'guest') return { kind: 'guest', guestName: r.cover_guest_name ?? '', ...common };
  return { kind: 'member', memberId: r.cover_member_id ?? '', ...common };
}
