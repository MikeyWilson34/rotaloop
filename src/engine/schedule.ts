import { membersAhead, membersInLine, spendTurns } from './rotation';
import {
  findEvent,
  isActiveMember,
  isPinned,
  responsibilitiesNeeded,
  rotationOf,
} from './state';
import { compareEvents, ms, timeOffCovers } from './time';
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
 * they happened. Make-up Turns served at those Events are paid.
 */
export function advanceTo(state: GroupState, now: Instant): { state: GroupState; paid: MakeUpTurnId[] } {
  const from = state.rotatedThrough === null ? -Infinity : ms(state.rotatedThrough);
  const passed = state.events
    .filter((e) => ms(e.startsAt) > from && ms(e.startsAt) <= ms(now) && !e.skipDate)
    .sort(compareEvents);
  const rotations = new Map(state.rotations.map((r) => [r.responsibilityId, r]));
  const servedMakeUpTurns = new Set<MakeUpTurnId>();
  for (const event of passed) {
    const seats = state.assignments.filter((a) => a.eventId === event.id);
    for (const responsibility of state.responsibilities) {
      const here = seats.filter((a) => a.responsibilityId === responsibility.id);
      const rotation = rotations.get(responsibility.id);
      if (here.length === 0 || !rotation) continue;
      rotations.set(responsibility.id, spendTurns(rotation, turnsUsed(here)));
      for (const a of here) if (a.makeUpTurnId && servesSeat(a)) servedMakeUpTurns.add(a.makeUpTurnId);
    }
  }
  const paid: MakeUpTurnId[] = [];
  const makeUpTurns = state.makeUpTurns.map((turn): MakeUpTurn => {
    if (turn.status !== 'outstanding' || !servedMakeUpTurns.has(turn.id)) return turn;
    paid.push(turn.id);
    return { ...turn, status: 'paid', closedAt: now, closedReason: 'paid' };
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

  future.forEach((event, index) => {
    const needed = responsibilitiesNeeded(state, event);
    // Pins of a Responsibility the Event no longer needs are dropped, and so are pins
    // beyond its headcount (Covers are kept before open Coverage Requests).
    const pins = needed.flatMap((r) =>
      keepWithinHeadcount((pinnedByEvent.get(event.id) ?? []).filter((p) => p.responsibilityId === r.id), r.headcount),
    );
    const atEvent = new EventSeats(pins);
    for (const responsibility of needed) {
      const rotation = rotations.get(responsibility.id) as Rotation;
      const ownPins = pins.filter((p) => p.responsibilityId === responsibility.id);
      const filler = new SeatFiller({
        state,
        event,
        laterEvents: future.slice(index + 1),
        responsibility,
        rotation,
        pins: ownPins,
        atEvent,
        placedMakeUpTurns,
      });
      const seats = filler.fill();
      rotations.set(responsibility.id, spendTurns(rotation, [...turnsUsed(ownPins), ...filler.turnsUsed]));
      plan.push(...ownPins.map(pinnedSeat), ...seats);
    }
  });
  return plan;
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

/** Who already sits where at one Event, across Responsibilities. */
class EventSeats {
  private seats = new Map<MemberId, Set<ResponsibilityId>>();
  /** Members who Declined a seat at this Event: they aren't put back on it. */
  readonly declined = new Set<MemberId>();

  constructor(pins: Assignment[]) {
    for (const pin of pins) {
      if (servesSeat(pin)) this.add(pin.memberId as MemberId, pin.responsibilityId);
      if (pin.coverageRequest?.requestedBy) this.declined.add(pin.coverageRequest.requestedBy);
    }
  }

  add(memberId: MemberId, responsibilityId: ResponsibilityId) {
    this.seats.set(memberId, new Set([...(this.seats.get(memberId) ?? []), responsibilityId]));
  }

  blocks(memberId: MemberId, responsibilityId: ResponsibilityId, allowDoubling: boolean): boolean {
    const held = this.seats.get(memberId);
    if (!held || held.size === 0) return false;
    return held.has(responsibilityId) || !allowDoubling;
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
}

/** Fills the free seats of one Responsibility at one Event. */
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
      const debt = this.makeUpTurnOwedTo(next);
      if (debt) {
        this.seat(debt.debtorId, next, { makeUpTurnId: debt.id });
        this.input.placedMakeUpTurns.add(debt.id);
      } else if (this.canServe(next)) {
        this.seat(next, next);
      } else if (this.isOnlyOnTimeOff(next) && this.input.state.settings.timeOffHandling === 'askVolunteer') {
        this.requestCoverage(next, 'timeOff');
      } else {
        const partner = this.routeAroundPartner(next, free, partners);
        if (partner !== null) {
          partners.add(partner);
          this.seat(this.line[partner], this.line[partner]);
        } else if (this.isOnlyOnTimeOff(next)) {
          this.requestCoverage(next, 'timeOff');
        }
        // Otherwise the seat waits for the fallback below and `next` keeps the front.
      }
    }

    const fallback = [
      ...this.line.filter((_, j) => j >= free && !partners.has(j)),
      ...membersAhead(this.input.rotation),
    ];
    for (const m of fallback) {
      if (this.seats.length >= free) break;
      if (!this.turnsUsed.includes(m) && this.canServe(m)) this.seat(m, m);
    }
    while (this.seats.length < free) this.requestCoverage(null, 'noOneAvailable');
    return this.seats;
  }

  /**
   * Time Off routing: the next Member in line who can serve now and whose own next
   * date (which the absent Member takes over) is not inside the absent Member's
   * Time Off.
   */
  private routeAroundPartner(absent: MemberId, free: number, taken: Set<number>): number | null {
    for (let j = free; j < this.line.length; j++) {
      if (taken.has(j) || !this.canServe(this.line[j])) continue;
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
        this.coveredBefore(turn, event) &&
        this.canServe(turn.debtorId),
    );
  }

  private coveredBefore(turn: MakeUpTurn, event: Event): boolean {
    const cover = this.input.state.assignments.find((a) => a.id === turn.coverAssignmentId);
    const coveredEvent = cover ? findEvent(this.input.state, cover.eventId) : undefined;
    return !coveredEvent || compareEvents(coveredEvent, event) < 0;
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
    return this.input.state.timeOff.some(
      (t) => t.memberId === memberId && timeOffCovers(t, event, this.input.responsibility.id),
    );
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
