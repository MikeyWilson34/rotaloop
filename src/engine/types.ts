/**
 * Data model of the rotation engine. Everything here is plain, serializable data
 * (JSON round-trips losslessly). See index.ts for the narrative description.
 */

/** An ISO 8601 UTC timestamp, e.g. "2026-11-15T09:00:00.000Z". */
export type Instant = string;

export type GroupId = string;
export type MemberId = string;
export type ResponsibilityId = string;
export type EventSeriesId = string;
export type EventId = string;
export type AssignmentId = string;
export type TimeOffId = string;
export type MakeUpTurnId = string;

// ---------------------------------------------------------------------------
// Group and settings

export type CoveragePolicy = 'payItBack' | 'countRealWork';
export type TimeOffHandling = 'routeAround' | 'askVolunteer';
export type ReplacementDuty = 'assignedMember' | 'admins';

export interface GroupSettings {
  /** What a Decline costs. New Groups start on Pay It Back. */
  coveragePolicy: CoveragePolicy;
  /** Whether Time Off is routed around or turned into a Coverage Request. */
  timeOffHandling: TimeOffHandling;
  /** Whether one Member may hold seats of two Responsibilities at one Event. */
  allowDoubling: boolean;
  /** Who must find someone when a Coverage Request has no volunteer by the deadline. */
  replacementDuty: ReplacementDuty;
  /** "Find a replacement by": how long before the Event Replacement Duty starts, in ms. */
  replacementDeadlineMs: number;
}

export interface Member {
  id: MemberId;
  name: string;
  isAdmin: boolean;
  /** The person's account. `null` means this is a Placeholder Member. */
  accountId: string | null;
  /** Set when the Member left or was removed. Former Members keep their history. */
  leftAt: Instant | null;
}

export interface Responsibility {
  id: ResponsibilityId;
  name: string;
  /** How many seats each Event needs. */
  headcount: number;
  requiresConfirmation: boolean;
  /**
   * Set when an Admin removed the Responsibility. It is kept for the history of past
   * Events; from then on no Event needs it and no one is Qualified for it.
   */
  removedAt: Instant | null;
}

/**
 * The Rotation of one Responsibility: the ordered queue of its Qualified Members
 * as of `GroupState.rotatedThrough`. Being in the queue is what makes a Member
 * a Qualified Member.
 */
export interface Rotation {
  responsibilityId: ResponsibilityId;
  queue: MemberId[];
  /**
   * Turns a Member took ahead of their place in the queue (filling in for someone
   * passed over for Time Off, or a turn used by a Decline out of order). When the
   * Member reaches the front, one such turn is skipped instead of served again.
   * Only non-zero counts are stored.
   */
  turnsTakenEarly: Record<MemberId, number>;
}

// ---------------------------------------------------------------------------
// Scheduling

export type RepeatFrequency = 'weekly' | 'biweekly' | 'monthly' | 'custom';

/**
 * When an Event Series' Events happen, in local time. The engine only stores and
 * validates it: expanding it into Events is a server job, which adds them with
 * `addEvents` (or `editEventSeries` with `replaceFutureEvents`).
 */
export interface RepeatPattern {
  frequency: RepeatFrequency;
  /** `custom` only: weeks between occurrences (weekly is 1, biweekly is 2). Otherwise `null`. */
  intervalWeeks: number | null;
  /** Days of the week it happens on: 0 = Sunday ... 6 = Saturday (the server parser sorts them). */
  daysOfWeek: number[];
  /** `monthly` only: which of the month's matching days, 1-4, or -1 for the last. Otherwise `null`. */
  weekOfMonth: number | null;
  /** Local start time, "HH:MM" (24-hour). */
  startTime: string;
  /** IANA time zone of `startTime`, e.g. "America/Chicago". */
  timeZone: string;
  /** Local date "YYYY-MM-DD" the pattern counts from (sets the phase of biweekly and custom). */
  startsOn: string;
}

export interface EventSeries {
  id: EventSeriesId;
  name: string;
  /** The Responsibilities this series' Events need. */
  responsibilityIds: ResponsibilityId[];
  /** `null` when the series has no stored pattern. */
  repeat: RepeatPattern | null;
  /** Set when an Admin removed the series. Its past Events keep pointing to it. */
  removedAt: Instant | null;
}

export interface SkipDate {
  markedBy: MemberId | null;
  markedAt: Instant;
  /**
   * Why the Event needs no one, shown to everyone and kept in history, e.g. "Holiday" or
   * "Closure: Building closed for repairs". `null` when none was given.
   */
  reason: string | null;
}

export interface Event {
  id: EventId;
  /** `null` for a one-off Event. */
  seriesId: EventSeriesId | null;
  startsAt: Instant;
  /**
   * Responsibilities this Event needs. `null` inherits them from the Event Series.
   * A one-off Event must list them.
   */
  responsibilityIds: ResponsibilityId[] | null;
  /** Set when the Event is a Skip Date: it needs no one. */
  skipDate: SkipDate | null;
}

/**
 * A period a Member can't serve: `[startsAt, endsAt)`, optionally repeating every
 * N weeks until `repeatUntil`, optionally limited to some Responsibilities.
 *
 * A repeat counts whole weeks on the wall clock of `timeZone` (the Group's), so
 * "Sundays 8:30-9:30" stays at 8:30 local time across daylight-saving changes. Without a
 * time zone it counts whole weeks of UTC time, which drifts an hour at those changes.
 */
export interface TimeOff {
  id: TimeOffId;
  memberId: MemberId;
  startsAt: Instant;
  endsAt: Instant;
  repeatEveryWeeks: number | null;
  repeatUntil: Instant | null;
  /** `null` means every Responsibility. */
  responsibilityIds: ResponsibilityId[] | null;
  /** IANA time zone a repeat is counted in (see above). `null`: whole UTC weeks. */
  timeZone: string | null;
  /** The Member's own note, e.g. "Family trip". Stored only. */
  note: string | null;
  /**
   * Set when the Time Off was removed. Removing Time Off never undoes routing that
   * already happened, so it keeps applying to the Events in `retainedEventIds`
   * (the existing future Events it covered at removal) and to nothing else.
   */
  removedAt: Instant | null;
  retainedEventIds: EventId[];
}

// ---------------------------------------------------------------------------
// Assignments and coverage

/**
 * - `notRequired`: the Responsibility needs no confirmation.
 * - `notYetRequested`: confirmation will be asked for later (status "Scheduled").
 * - `requested`: the Member has been asked to confirm (status "Pending").
 * - `confirmed`.
 */
export type Confirmation = 'notRequired' | 'notYetRequested' | 'requested' | 'confirmed';

/**
 * Who covers a seat: a Member (a swap: they are owed a Make-up Turn), or `guest`, an outside
 * cover: a typed name of someone not in the Group ("Not in group"), one-off, not in any
 * Rotation, and owed nothing. History keeps the name.
 */
export type Cover =
  | { kind: 'member'; memberId: MemberId; arrangedBy: MemberId; coveredAt: Instant }
  | { kind: 'guest'; guestName: string; arrangedBy: MemberId; coveredAt: Instant };

/**
 * The coverage side of an Assignment. While `cover` is `null` the Assignment is a
 * Coverage Request ("Needs coverage").
 * - `declined`: the Member Declined it.
 * - `timeOff`: the Member is on Time Off and the Group asks for a volunteer
 *   (or no one could be routed in).
 * - `noOneAvailable`: no Qualified Member could fill the seat.
 */
export interface CoverageRequest {
  reason: 'declined' | 'timeOff' | 'noOneAvailable';
  requestedBy: MemberId | null;
  requestedAt: Instant;
  /**
   * Why, in the Member's words, shown on the Cover sheet and in history, e.g. "Traveling: back
   * on the 10th" (at most 300 characters). "Time Off" for a `timeOff` request. Absent or `null`
   * when none was given.
   */
  note?: string | null;
  cover: Cover | null;
}

/** One Member filling one seat of one Responsibility at one Event. */
export interface Assignment {
  id: AssignmentId;
  eventId: EventId;
  responsibilityId: ResponsibilityId;
  /**
   * Who fills the seat. While the Assignment is a Coverage Request it is the
   * Member who asked for coverage; once covered it is the coverer. `null` for an
   * open seat or a Guest Cover.
   */
  memberId: MemberId | null;
  /** Whose Rotation turn this seat used up. */
  turnOf: MemberId | null;
  /** Set when this Assignment pays a Make-up Turn. */
  makeUpTurnId: MakeUpTurnId | null;
  confirmation: Confirmation;
  coverageRequest: CoverageRequest | null;
}

export type MakeUpTurnStatus = 'outstanding' | 'paid' | 'settled' | 'cancelled';

export type MakeUpTurnClosedReason =
  | 'paid'
  | 'movedAlong'
  | 'rebalance'
  | 'coveragePolicyChanged'
  | 'memberLeft'
  | 'memberNoLongerQualified'
  | 'coverWithdrawn'
  | 'responsibilityRemoved'
  /** The debtor was on Time Off at the coverer's next natural turn, so the swap lapsed. */
  | 'lapsed';

/**
 * Under Pay It Back: the debtor (who asked for coverage) owes the creditor (who
 * covered). It is paid by the debtor taking the creditor's next turn in the
 * Responsibility after the covered Event.
 */
export interface MakeUpTurn {
  id: MakeUpTurnId;
  responsibilityId: ResponsibilityId;
  debtorId: MemberId;
  creditorId: MemberId;
  /** The covered Assignment that created this Make-up Turn. */
  coverAssignmentId: AssignmentId;
  createdAt: Instant;
  status: MakeUpTurnStatus;
  closedAt: Instant | null;
  closedReason: MakeUpTurnClosedReason | null;
}

// ---------------------------------------------------------------------------
// The whole state

export interface GroupState {
  groupId: GroupId;
  settings: GroupSettings;
  primaryResponsibilityId: ResponsibilityId | null;
  members: Member[];
  /** In fill order: earlier Responsibilities are filled first at each Event. */
  responsibilities: Responsibility[];
  rotations: Rotation[];
  eventSeries: EventSeries[];
  events: Event[];
  timeOff: TimeOff[];
  /** Past and future Assignments. Past ones are history and never change. */
  assignments: Assignment[];
  makeUpTurns: MakeUpTurn[];
  /** Events starting at or before this instant are history. `null` = none yet. */
  rotatedThrough: Instant | null;
  /** Counter for engine-generated ids (Assignments and Make-up Turns). */
  idSequence: number;
}

// ---------------------------------------------------------------------------
// Commands

export interface NewMember {
  id: MemberId;
  name: string;
  isAdmin?: boolean;
  /** Omit or `null` for a Placeholder Member. */
  accountId?: string | null;
}

type OptionalTimeOffFields = 'repeatEveryWeeks' | 'repeatUntil' | 'responsibilityIds' | 'timeZone' | 'note';

export type NewTimeOff = Omit<TimeOff, 'removedAt' | 'retainedEventIds' | OptionalTimeOffFields> &
  Partial<Pick<TimeOff, OptionalTimeOffFields>>;

export type NewEvent = Omit<Event, 'skipDate' | 'responsibilityIds'> &
  Partial<Pick<Event, 'responsibilityIds'>>;

export type NewResponsibility = Omit<Responsibility, 'removedAt'>;

export type NewEventSeries = Omit<EventSeries, 'removedAt' | 'repeat'> & Partial<Pick<EventSeries, 'repeat'>>;

export type ResponsibilityChanges = Partial<Pick<Responsibility, 'name' | 'headcount' | 'requiresConfirmation'>>;

export type EventSeriesChanges = Partial<Pick<EventSeries, 'name' | 'responsibilityIds' | 'repeat'>>;

export type CoverTarget = { memberId: MemberId } | { guestName: string };

export type Command =
  | { type: 'fillSchedule' }
  | { type: 'addEvents'; events: NewEvent[] }
  | { type: 'addSkipDate'; eventId: EventId; reason?: string | null }
  | { type: 'removeSkipDate'; eventId: EventId }
  | { type: 'addTimeOff'; timeOff: NewTimeOff }
  | { type: 'removeTimeOff'; timeOffId: TimeOffId }
  | { type: 'requestConfirmation'; assignmentIds: AssignmentId[] }
  | { type: 'confirm'; assignmentId: AssignmentId }
  /**
   * "Can't make it". `reason`: optional, at most 300 characters; stored as the Coverage
   * Request's `note`. `coveredBy`: the cover is found already ("I'll find someone to cover",
   * or any Member's "Pick someone to do it"): the request is covered in the same step.
   */
  | { type: 'decline'; assignmentId: AssignmentId; reason?: string | null; coveredBy?: CoverTarget }
  /**
   * "I can make it after all": the Member who declined takes the seat back while no one has
   * covered it yet (an Admin may do it for a Placeholder Member). See commands.ts.
   */
  | { type: 'withdrawDecline'; assignmentId: AssignmentId }
  | { type: 'cover'; assignmentId: AssignmentId }
  | { type: 'markCovered'; assignmentId: AssignmentId; by: CoverTarget }
  | { type: 'changeSettings'; settings: Partial<GroupSettings> }
  | { type: 'rebalance'; responsibilityId: ResponsibilityId }
  | { type: 'addMember'; member: NewMember; qualifiedFor?: ResponsibilityId[] }
  | { type: 'qualifyMember'; memberId: MemberId; responsibilityId: ResponsibilityId }
  | { type: 'unqualifyMember'; memberId: MemberId; responsibilityId: ResponsibilityId }
  | { type: 'removeMember'; memberId: MemberId }
  | { type: 'claimPlaceholder'; memberId: MemberId; accountId: string }
  | { type: 'renameMember'; memberId: MemberId; name: string }
  | { type: 'setAdmin'; memberId: MemberId; isAdmin: boolean }
  | { type: 'addResponsibility'; responsibility: NewResponsibility; qualifiedMemberIds?: MemberId[] }
  | { type: 'editResponsibility'; responsibilityId: ResponsibilityId; changes: ResponsibilityChanges }
  | { type: 'removeResponsibility'; responsibilityId: ResponsibilityId }
  | { type: 'reorderResponsibilities'; responsibilityIds: ResponsibilityId[] }
  | { type: 'setPrimaryResponsibility'; responsibilityId: ResponsibilityId | null }
  | { type: 'reorderQueue'; responsibilityId: ResponsibilityId; queue: MemberId[] }
  | { type: 'addEventSeries'; series: NewEventSeries; events?: NewEvent[] }
  | {
      type: 'editEventSeries';
      seriesId: EventSeriesId;
      changes: EventSeriesChanges;
      /**
       * The series' Events from now on (e.g. after its day or time changed). Its future
       * Events not listed, or listed at another time, are removed; the rest are added.
       */
      replaceFutureEvents?: NewEvent[];
    }
  | { type: 'removeEventSeries'; seriesId: EventSeriesId }
  | { type: 'removeEvent'; eventId: EventId };

export interface CommandContext {
  /** The current time. The engine never reads the clock itself. */
  now: Instant;
  /** The Member acting, or `null` for the system (scheduled jobs). */
  actorId: MemberId | null;
}

// ---------------------------------------------------------------------------
// Results

/** Why something changed: the command, or an automatic consequence of time passing. */
export type Cause = Command | { type: 'makeUpTurnPaid'; makeUpTurnId: MakeUpTurnId };

/**
 * One Assignment whose stored record changed. `before` is `null` when it was
 * created, `after` is `null` when it was removed. Identity follows the Member's
 * turn: when a turn moves to another Event the same Assignment changes `eventId`.
 */
export interface AssignmentChange {
  assignmentId: AssignmentId;
  before: Assignment | null;
  after: Assignment | null;
  reason: Cause;
}

export interface MakeUpTurnChange {
  makeUpTurnId: MakeUpTurnId;
  before: MakeUpTurnStatus | null;
  after: MakeUpTurnStatus;
}

/** A schedule-history entry: what changed, why, and who (or the system) caused it. */
export interface HistoryEntry {
  at: Instant;
  actorId: MemberId | null;
  cause: Cause;
  changes: AssignmentChange[];
  makeUpTurns: MakeUpTurnChange[];
}

export type RejectionReason =
  | 'notFound'
  | 'notPermitted'
  | 'eventHasPassed'
  | 'alreadyCovered'
  | 'notQualified'
  | 'noCoverageRequest'
  | 'alreadyNeedsCoverage'
  | 'alreadyAssignedAtEvent'
  /** The command would leave the Group without an active Admin. */
  | 'lastAdmin'
  | 'invalid';

export type CommandResult =
  | {
      ok: true;
      state: GroupState;
      /** Every changed Assignment, across all history entries. */
      changes: AssignmentChange[];
      history: HistoryEntry[];
    }
  | { ok: false; reason: RejectionReason; message: string };

export type AssignmentStatus =
  | 'confirmed'
  | 'pending'
  | 'unconfirmed'
  | 'needsCoverage'
  | 'covered'
  | 'scheduled';
