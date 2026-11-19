import { membersAhead, membersInLine, spendTurns } from './rotation';
import {
  findEvent,
  isActiveMember,
  isPinned,
  responsibilitiesNeeded,
  rotationOf,
} from './state';
import { compareEvents, isKnownTimeZone, ms, timeOffCovers, wallClockMs } from './time';
import type {
  Assignment,
  CoverageRequest,
  Event,
  GroupState,
  Instant,
  MakeUpTurn,
  MakeUpTurnId,
  MemberId,
  Responsibility,
  ResponsibilityId,
  Rotation,
} from './types';

/**
 * Moves the Rotations' reference point forward to `now`: every Event that started
 * since the last call becomes history, and its Assignments use up turns exactly as
 * they happened. Make-up Turns served at those Events are paid, and those that lapsed
 * there (`lapsedSwaps`) are cancelled. A lapse is not a history entry of its own.
 */
export function advanceTo(state: GroupState, now: Instant): { state: GroupState; paid: MakeUpTurnId[] } {
  const from = state.rotatedThrough === null ? -Infinity : ms(state.rotatedThrough);
  const passed = state.events
    .filter((e) => ms(e.startsAt) > from && ms(e.startsAt) <= ms(now) && !e.skipDate)
    .sort(compareEvents);
  const rotations = new Map(state.rotations.map((r) => [r.responsibilityId, r]));
  const servedMakeUpTurns = new Set<MakeUpTurnId>();
  const lapsedMakeUpTurns = new Set<MakeUpTurnId>();
  for (const event of passed) {
    const seats = state.assignments.filter((a) => a.eventId === event.id);
    for (const responsibility of state.responsibilities) {
      const here = seats.filter((a) => a.responsibilityId === responsibility.id);
      const rotation = rotations.get(responsibility.id);
      if (here.length === 0 || !rotation) continue;
      const closed = new Set([...servedMakeUpTurns, ...lapsedMakeUpTurns]);
      for (const id of lapsedSwaps(state, event, responsibility, rotation, here.filter(isPinned), closed)) {
        lapsedMakeUpTurns.add(id);
      }
      rotations.set(responsibility.id, spendTurns(rotation, turnsUsed(here)));
      for (const a of here) if (a.makeUpTurnId && servesSeat(a)) servedMakeUpTurns.add(a.makeUpTurnId);
    }
  }
  const paid: MakeUpTurnId[] = [];
  const makeUpTurns = state.makeUpTurns.map((turn): MakeUpTurn => {
    if (turn.status !== 'outstanding') return turn;
    if (servedMakeUpTurns.has(turn.id)) {
      paid.push(turn.id);
      return { ...turn, status: 'paid', closedAt: now, closedReason: 'paid' };
    }
    if (lapsedMakeUpTurns.has(turn.id)) {
      return { ...turn, status: 'cancelled', closedAt: now, closedReason: 'lapsed' };
    }
    return turn;
  });
  return {
    state: {
      ...state,
      rotations: state.rotations.map((r) => rotations.get(r.responsibilityId) ?? r),
      makeUpTurns,
      rotatedThrough: now,
    },
    paid,
  };
}

/**
 * Rule 1's exception: when a coverer is next in line and the Member who owes them the
 * swap is on Time Off that day, the swap lapses and normal rotation stands. The planner
 * and `advanceTo` both use this, so a lapse decided in the plan is closed for good once
 * its Event has passed. `closed` holds Make-up Turns already paid or lapsed.
 */
function lapsedSwaps(
  state: GroupState,
  event: Event,
  responsibility: Responsibility,
  rotation: Rotation,
  pins: Assignment[],
  closed: Set<MakeUpTurnId>,
): MakeUpTurnId[] {
  const pinnedTurns = new Set(turnsUsed(pins));
  const free = Math.max(0, responsibility.headcount - pins.length);
  const front = membersInLine(rotation)
    .filter((m) => !pinnedTurns.has(m))
    .slice(0, free);
  const lapsed: MakeUpTurnId[] = [];
  for (const creditor of front) {
    if (isOnTimeOff(state, creditor, event, responsibility.id)) continue;
    const turn = state.makeUpTurns.find(
      (t) =>
        t.status === 'outstanding' &&
        t.creditorId === creditor &&
        t.responsibilityId === responsibility.id &&
        !closed.has(t.id) &&
        coveredBefore(state, t, event),
    );
    if (turn && isOnTimeOff(state, turn.debtorId, event, responsibility.id)) lapsed.push(turn.id);
  }
  return lapsed;
}

function coveredBefore(state: GroupState, turn: MakeUpTurn, event: Event): boolean {
  const cover = state.assignments.find((a) => a.id === turn.coverAssignmentId);
  const coveredEvent = cover ? findEvent(state, cover.eventId) : undefined;
  return !coveredEvent || compareEvents(coveredEvent, event) < 0;
}

function isOnTimeOff(state: GroupState, memberId: MemberId, event: Event, responsibilityId: ResponsibilityId) {
  return state.timeOff.some((t) => t.memberId === memberId && timeOffCovers(t, event, responsibilityId));
}

/** A seat the schedule wants, before it is matched to an existing Assignment. */
export interface PlannedSeat {
  /** Set for pinned Assignments, which pass through unchanged. */
  pinned: Assignment | null;
  eventId: string;
  responsibilityId: ResponsibilityId;
  memberId: MemberId | null;
  turnOf: MemberId | null;
  makeUpTurnId: MakeUpTurnId | null;
  coverageRequest: CoverageRequest | null;
}

/**
 * Plans every future Event from the Rotations as of `state.rotatedThrough`.
 * Past Assignments are untouched; pinned future Assignments (Declines and Covers)
 * stay on their Event and use up the turn they were given.
 */
export function planSchedule(state: GroupState): PlannedSeat[] {
  const now = state.rotatedThrough === null ? -Infinity : ms(state.rotatedThrough);
  const future = state.events.filter((e) => ms(e.startsAt) > now && !e.skipDate).sort(compareEvents);
  const rotations = new Map(state.responsibilities.map((r) => [r.id, rotationOf(state, r.id)]));
  const pinnedByEvent = new Map<string, Assignment[]>();
  for (const a of state.assignments) {
    if (!isPinned(a)) continue;
    pinnedByEvent.set(a.eventId, [...(pinnedByEvent.get(a.eventId) ?? []), a]);
  }
  const placedMakeUpTurns = new Set<MakeUpTurnId>();
  const plan: PlannedSeat[] = [];
  const previous = previousServers(state, now);
  // Pins of a Responsibility an Event no longer needs are dropped, and so are pins
  // beyond its headcount (Covers are kept before open Coverage Requests).
  const keptPins = new Map(
    future.map((event) => [
      event.id,
      responsibilitiesNeeded(state, event).flatMap((r) =>
        keepWithinHeadcount((pinnedByEvent.get(event.id) ?? []).filter((p) => p.responsibilityId === r.id), r.headcount),
      ),
    ]),
  );
  const days = new Map<string, DaySeats>();
  const zone = groupTimeZone(state);
  for (const event of future) {
    const day = localDay(event, zone);
    if (!days.has(day)) days.set(day, new DaySeats());
    (days.get(day) as DaySeats).addPins(event.id, keptPins.get(event.id) ?? []);
  }

  future.forEach((event, index) => {
    const needed = responsibilitiesNeeded(state, event);
    const pins = keptPins.get(event.id) ?? [];
    const atEvent = new EventSeats(event.id, days.get(localDay(event, zone)) as DaySeats, pins);
    for (const responsibility of needed) {
      const rotation = rotations.get(responsibility.id) as Rotation;
      const ownPins = pins.filter((p) => p.responsibilityId === responsibility.id);
      for (const id of lapsedSwaps(state, event, responsibility, rotation, ownPins, placedMakeUpTurns)) {
        placedMakeUpTurns.add(id);
      }
      const filler = new SeatFiller({
        state,
        event,
        laterEvents: future.slice(index + 1),
        responsibility,
        rotation,
        pins: ownPins,
        atEvent,
        placedMakeUpTurns,
        rested: previous.get(responsibility.id) ?? new Set(),
      });
      const seats = filler.fill();
      rotations.set(responsibility.id, spendTurns(rotation, [...turnsUsed(ownPins), ...filler.turnsUsed]));
      const planned = [...ownPins.map(pinnedSeat), ...seats];
      previous.set(responsibility.id, servers(planned));
      plan.push(...planned);
    }
  });
  return plan;
}

function servers(seats: (Assignment | PlannedSeat)[]): Set<MemberId> {
  return new Set(seats.filter(servesSeat).map((s) => s.memberId as MemberId));
}

/**
 * Who served the latest past Event of each Responsibility (Covers count for the
 * coverer): they just had the previous date, so they rest at the next one if they can.
 */
function previousServers(state: GroupState, now: number): Map<ResponsibilityId, Set<MemberId>> {
  const result = new Map<ResponsibilityId, Set<MemberId>>();
  const past = state.events.filter((e) => ms(e.startsAt) <= now && !e.skipDate).sort(compareEvents);
  for (const event of past) {
    const seats = state.assignments.filter((a) => a.eventId === event.id);
    for (const responsibilityId of new Set(seats.map((a) => a.responsibilityId))) {
      result.set(responsibilityId, servers(seats.filter((a) => a.responsibilityId === responsibilityId)));
    }
  }
  return result;
}

/** The time zone a Group's calendar days are counted in: its Event Series', else UTC. */
function groupTimeZone(state: GroupState): string | null {
  const series = state.eventSeries.find((s) => s.removedAt === null && s.repeat) ?? state.eventSeries.find((s) => s.repeat);
  return series?.repeat?.timeZone ?? null;
}

/** The Event's calendar date ("YYYY-MM-DD") in the Group's time zone. */
function localDay(event: Event, zone: string | null): string {
  const clock = zone && isKnownTimeZone(zone) ? wallClockMs(event.startsAt, zone) : ms(event.startsAt);
  return new Date(clock).toISOString().slice(0, 10);
}

function keepWithinHeadcount(pins: Assignment[], headcount: number): Assignment[] {
  if (pins.length <= headcount) return pins;
  const rank = (a: Assignment) => {
    const cover = a.coverageRequest?.cover;
    return cover?.kind === 'member' ? 0 : cover?.kind === 'guest' ? 1 : 2;
  };
  const kept = new Set(
    pins
      .map((a, index) => ({ a, index }))
      .sort((x, y) => rank(x.a) - rank(y.a) || x.index - y.index)
      .slice(0, headcount)
      .map((x) => x.a),
  );
  return pins.filter((a) => kept.has(a));
}

function pinnedSeat(a: Assignment): PlannedSeat {
  return {
    pinned: a,
    eventId: a.eventId,
    responsibilityId: a.responsibilityId,
    memberId: a.memberId,
    turnOf: a.turnOf,
    makeUpTurnId: a.makeUpTurnId,
    coverageRequest: a.coverageRequest,
  };
}

function turnsUsed(assignments: Assignment[]): MemberId[] {
  return assignments.map((a) => a.turnOf).filter((m): m is MemberId => m !== null);
}

/** Whether the Assignment's holder actually serves (it is not an open Coverage Request). */
export function servesSeat(a: Assignment | PlannedSeat): boolean {
  return a.memberId !== null && (a.coverageRequest === null || a.coverageRequest.cover !== null);
}

/** Who already sits where on one calendar day, across Events and Responsibilities. */
class DaySeats {
  private seats = new Map<MemberId, { eventId: string; responsibilityId: ResponsibilityId }[]>();

  /** Pins are known up front, so a Cover at a later Event that day already counts. */
  addPins(eventId: string, pins: Assignment[]) {
    for (const pin of pins) if (servesSeat(pin)) this.add(pin.memberId as MemberId, eventId, pin.responsibilityId);
  }

  add(memberId: MemberId, eventId: string, responsibilityId: ResponsibilityId) {
    this.seats.set(memberId, [...(this.seats.get(memberId) ?? []), { eventId, responsibilityId }]);
  }

  held(memberId: MemberId) {
    return this.seats.get(memberId) ?? [];
  }
}

/** Who already sits where at one Event, and on the rest of its day. */
class EventSeats {
  /** Members who Declined a seat at this Event: they aren't put back on it. */
  readonly declined = new Set<MemberId>();

  constructor(
    private readonly eventId: string,
    private readonly day: DaySeats,
    pins: Assignment[],
  ) {
    for (const pin of pins) if (pin.coverageRequest?.requestedBy) this.declined.add(pin.coverageRequest.requestedBy);
  }

  add(memberId: MemberId, responsibilityId: ResponsibilityId) {
    this.day.add(memberId, this.eventId, responsibilityId);
  }

  /**
   * No double booking: a Member with a seat anywhere that day is taken, unless the
   * Group allows doubling (then only a second seat of the same Responsibility at the
   * same Event is ruled out).
   */
  blocks(memberId: MemberId, responsibilityId: ResponsibilityId, allowDoubling: boolean): boolean {
    const held = this.day.held(memberId);
    if (held.length === 0) return false;
    return !allowDoubling || held.some((s) => s.eventId === this.eventId && s.responsibilityId === responsibilityId);
  }
}

interface SeatFillerInput {
  state: GroupState;
  event: Event;
  laterEvents: Event[];
  responsibility: Responsibility;
  rotation: Rotation;
  pins: Assignment[];
  atEvent: EventSeats;
  placedMakeUpTurns: Set<MakeUpTurnId>;
  /** Who served the previous Event of this Responsibility: they rest unless no one else can serve. */
  rested: Set<MemberId>;
}

/**
 * Fills the free seats of one Responsibility at one Event. Rules, in order:
 * 1. A Cover is a swap: when the coverer's turn comes up, the Member they covered
 *    takes it instead (`paysBack`).
 * 2. No back-to-back turns when avoidable: whoever had the previous date rests and
 *    keeps their place at the front (`rested`).
 * 3. No double booking: a Member with a seat elsewhere that day is unavailable.
 */
class SeatFiller {
  readonly turnsUsed: MemberId[] = [];
  private readonly seats: PlannedSeat[] = [];
  private readonly line: MemberId[];

  constructor(private readonly input: SeatFillerInput) {
    const pinnedTurns = new Set(turnsUsed(input.pins));
    this.line = membersInLine(input.rotation).filter((m) => !pinnedTurns.has(m));
  }

  fill(): PlannedSeat[] {
    const free = Math.max(0, this.input.responsibility.headcount - this.input.pins.length);
    const partners = new Set<number>();

    for (let i = 0; i < free && i < this.line.length; i++) {
      const next = this.line[i];
      if (this.paysBack(next)) continue;
      if (this.canServe(next) && !this.isRested(next)) {
        this.seat(next, next);
      } else if (this.canServe(next)) {
        // `next` just had the previous date: the next free Member takes this one and
        // `next` keeps the front. Otherwise the seat waits for the fallback below.
        const stand = this.line.findIndex(
          (m, j) => j >= free && !partners.has(j) && this.canServe(m) && !this.isRested(m),
        );
        if (stand >= 0) {
          partners.add(stand);
          if (!this.paysBack(this.line[stand])) this.seat(this.line[stand], this.line[stand]);
        }
      } else if (this.isOnlyOnTimeOff(next) && this.input.state.settings.timeOffHandling === 'askVolunteer') {
        this.requestCoverage(next, 'timeOff');
      } else {
        const partner =
          this.routeAroundPartner(next, free, partners, false) ?? this.routeAroundPartner(next, free, partners, true);
        if (partner !== null) {
          partners.add(partner);
          this.seat(this.line[partner], this.line[partner]);
        } else if (this.isOnlyOnTimeOff(next)) {
          this.requestCoverage(next, 'timeOff');
        }
        // Otherwise the seat waits for the fallback below and `next` keeps the front.
      }
    }

    const ahead = membersAhead(this.input.rotation);
    const fallback = [...this.line.filter((_, j) => j >= free && !partners.has(j)), ...ahead];
    // Back-to-back only when no one else can serve.
    const lastResort = [...this.line, ...ahead];
    for (const [candidates, allowRested] of [
      [fallback, false],
      [lastResort, true],
    ] as const) {
      for (const m of candidates) {
        if (this.seats.length >= free) break;
        if (!this.turnsUsed.includes(m) && this.canServe(m) && (allowRested || !this.isRested(m))) this.seat(m, m);
      }
    }
    while (this.seats.length < free) this.requestCoverage(null, 'noOneAvailable');
    return this.seats;
  }

  /**
   * A Cover is a swap: when the coverer's turn comes up, the Member they covered takes
   * it instead, unless that Member just had the previous date or is booked elsewhere
   * that day (then it waits for the coverer's next turn). A swap whose Member is on
   * Time Off has already lapsed (`lapsedSwaps`). Returns whether a seat was taken.
   */
  private paysBack(creditor: MemberId): boolean {
    if (!this.canServe(creditor)) return false;
    const debt = this.makeUpTurnOwedTo(creditor);
    if (!debt) return false;
    if (debt.debtorId === creditor || this.isRested(debt.debtorId) || !this.canServe(debt.debtorId)) return false;
    this.seat(debt.debtorId, creditor, { makeUpTurnId: debt.id });
    this.input.placedMakeUpTurns.add(debt.id);
    return true;
  }

  private isRested(memberId: MemberId): boolean {
    return this.input.rested.has(memberId);
  }

  /**
   * Time Off routing: the next Member in line who can serve now and whose own next
   * date (which the absent Member takes over) is not inside the absent Member's
   * Time Off. Whoever had the previous date is only chosen when `allowRested`.
   */
  private routeAroundPartner(absent: MemberId, free: number, taken: Set<number>, allowRested: boolean): number | null {
    for (let j = free; j < this.line.length; j++) {
      if (taken.has(j) || !this.canServe(this.line[j])) continue;
      if (!allowRested && this.isRested(this.line[j])) continue;
      const swapEvent = this.eventOfSeat(j - free);
      if (swapEvent && (this.isOnTimeOff(absent, swapEvent) || this.hasPinAt(absent, swapEvent))) continue;
      return j;
    }
    return null;
  }

  /** The later Event holding the n-th seat (0-based) of this Responsibility after this Event. */
  private eventOfSeat(n: number): Event | null {
    let remaining = n;
    for (const later of this.input.laterEvents) {
      if (!responsibilitiesNeeded(this.input.state, later).some((r) => r.id === this.input.responsibility.id)) {
        continue;
      }
      if (remaining < this.input.responsibility.headcount) return later;
      remaining -= this.input.responsibility.headcount;
    }
    return null;
  }

  private makeUpTurnOwedTo(creditorId: MemberId): MakeUpTurn | undefined {
    const { state, event, responsibility, placedMakeUpTurns } = this.input;
    return state.makeUpTurns.find(
      (turn) =>
        turn.status === 'outstanding' &&
        turn.creditorId === creditorId &&
        turn.responsibilityId === responsibility.id &&
        !placedMakeUpTurns.has(turn.id) &&
        coveredBefore(state, turn, event),
    );
  }

  private canServe(memberId: MemberId): boolean {
    return this.isAvailable(memberId) && !this.isOnTimeOff(memberId, this.input.event);
  }

  private isOnlyOnTimeOff(memberId: MemberId): boolean {
    return this.isAvailable(memberId) && this.isOnTimeOff(memberId, this.input.event);
  }

  /** Everything but Time Off: Qualified, still a Member, free at this Event. */
  private isAvailable(memberId: MemberId): boolean {
    const { state, responsibility, atEvent } = this.input;
    return (
      isActiveMember(state, memberId) &&
      this.input.rotation.queue.includes(memberId) &&
      !atEvent.declined.has(memberId) &&
      !this.seats.some((s) => s.memberId === memberId) &&
      !atEvent.blocks(memberId, responsibility.id, state.settings.allowDoubling)
    );
  }

  private isOnTimeOff(memberId: MemberId, event: Event): boolean {
    return isOnTimeOff(this.input.state, memberId, event, this.input.responsibility.id);
  }

  private hasPinAt(memberId: MemberId, event: Event): boolean {
    return this.input.state.assignments.some(
      (a) => a.eventId === event.id && isPinned(a) && (a.memberId === memberId || a.turnOf === memberId),
    );
  }

  private seat(memberId: MemberId, turnOf: MemberId, extra: { makeUpTurnId?: MakeUpTurnId } = {}) {
    this.seats.push(this.planned(memberId, turnOf, extra.makeUpTurnId ?? null, null));
    this.turnsUsed.push(turnOf);
    this.input.atEvent.add(memberId, this.input.responsibility.id);
  }

  private requestCoverage(memberId: MemberId | null, reason: CoverageRequest['reason']) {
    const request: CoverageRequest = {
      reason,
      requestedBy: memberId,
      requestedAt: this.input.state.rotatedThrough ?? this.input.event.startsAt,
      // The reason shown on the Cover sheet; the Member's own Time Off note stays private.
      note: reason === 'timeOff' ? 'Time Off' : null,
      cover: null,
    };
    this.seats.push(this.planned(memberId, memberId, null, request));
    if (memberId !== null) this.turnsUsed.push(memberId);
  }

  private planned(
    memberId: MemberId | null,
    turnOf: MemberId | null,
    makeUpTurnId: MakeUpTurnId | null,
    coverageRequest: CoverageRequest | null,
  ): PlannedSeat {
    return {
      pinned: null,
      eventId: this.input.event.id,
      responsibilityId: this.input.responsibility.id,
      memberId,
      turnOf,
      makeUpTurnId,
      coverageRequest,
    };
  }
}
