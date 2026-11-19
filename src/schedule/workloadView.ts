/**
 * The Members tab's workload bars and Make-up Turn lines. Workload is visible to every
 * Member (it is history, not group health).
 *
 * Pure TypeScript on top of the engine's `workload`, unit-tested under Node.
 */
import type { GroupState, Instant, MemberId } from '../engine/types';
import { workload } from '../engine/workload';
import { dateIn, formatMonthDay } from './format';

/** How far back "served" counts: about 3 months. */
export const WORKLOAD_WINDOW_DAYS = 91;

export type WorkloadBar = {
  memberId: MemberId;
  /** Turns served in the window (own turns and Make-up Turns). */
  served: number;
  /** Upcoming turns that are the Member's own (not Covers). */
  upcoming: number;
  /** Covers of someone else's Assignment: served in the window and upcoming. */
  covering: number;
  total: number;
};

export type WorkloadSummary = {
  /** Active Members in a Rotation (or with turns in the window), by Member id. */
  bars: Map<MemberId, WorkloadBar>;
  /** The largest total, for scaling the bars (at least 1). */
  max: number;
  /** The smallest and largest totals among Members in a Rotation, or null when none. */
  range: { low: number; high: number } | null;
};

/**
 * Workload per active Member across all Responsibilities: served (the last ~3 months),
 * upcoming and covering. Built from the engine's `workload` on the window's Events, so
 * Guest Covers count toward no one and covering counts toward the coverer.
 */
export function workloadSummary(state: GroupState, now: Instant, windowDays = WORKLOAD_WINDOW_DAYS): WorkloadSummary {
  const from = Date.parse(now) - windowDays * 24 * 60 * 60 * 1000;
  const windowed: GroupState = { ...state, events: state.events.filter((e) => Date.parse(e.startsAt) >= from) };
  const active = new Set(state.members.filter((m) => m.leftAt === null).map((m) => m.id));
  const inRotation = new Set(state.rotations.flatMap((r) => r.queue));
  const bars = new Map<MemberId, WorkloadBar>();
  const bar = (memberId: MemberId) => {
    let b = bars.get(memberId);
    if (!b) {
      b = { memberId, served: 0, upcoming: 0, covering: 0, total: 0 };
      bars.set(memberId, b);
    }
    return b;
  };
  for (const r of state.responsibilities) {
    for (const w of workload(windowed, r.id, now)) {
      if (!active.has(w.memberId)) continue;
      if (w.served + w.covered + w.upcoming === 0 && !inRotation.has(w.memberId)) continue;
      const b = bar(w.memberId);
      b.served += w.served;
      b.covering += w.covered;
      b.upcoming += w.upcoming;
    }
  }
  // Upcoming Covers move from "upcoming" to "covering".
  const startsAt = new Map(windowed.events.map((e) => [e.id, Date.parse(e.startsAt)]));
  for (const a of state.assignments) {
    const cover = a.coverageRequest?.cover;
    const at = startsAt.get(a.eventId);
    if (cover?.kind !== 'member' || a.memberId === null || at === undefined || at <= Date.parse(now)) continue;
    const b = bars.get(a.memberId);
    if (!b) continue;
    b.upcoming -= 1;
    b.covering += 1;
  }
  let max = 1;
  const rotated: number[] = [];
  for (const b of bars.values()) {
    b.total = b.served + b.upcoming + b.covering;
    max = Math.max(max, b.total);
    if (inRotation.has(b.memberId)) rotated.push(b.total);
  }
  const range = rotated.length ? { low: Math.min(...rotated), high: Math.max(...rotated) } : null;
  return { bars, max, range };
}

/** "Workload: everyone has 2–4 turns across the last 3 months and what's scheduled." */
export function workloadNote(range: WorkloadSummary['range']): string {
  const span = !range ? null : range.low === range.high ? `${range.low}` : `${range.low}–${range.high}`;
  const turns = range && range.high === 1 && range.low === 1 ? 'turn' : 'turns';
  const lead = span
    ? `everyone has ${span} ${turns} across the last 3 months and what's scheduled.`
    : 'no one is in a Rotation yet.';
  return `${lead} Covering always counts toward the Member who covers.`;
}

/** "3 turns", "1 turn". */
export function turnsLabel(n: number): string {
  return `${n} ${n === 1 ? 'turn' : 'turns'}`;
}

/**
 * Outstanding swaps (Make-up Turns) as sentences: "Ana takes Ben's next Sound turn on Jan 4."
 * (the date is the turn it's placed on), with "You" for the viewer.
 */
export function makeUpTurnLines(state: GroupState, myMemberId: MemberId | null, timeZone: string): string[] {
  const name = (id: MemberId) =>
    id === myMemberId ? 'You' : (state.members.find((m) => m.id === id)?.name ?? 'A former Member');
  return state.makeUpTurns
    .filter((t) => t.status === 'outstanding')
    .map((t) => {
      const what = state.responsibilities.find((r) => r.id === t.responsibilityId)?.name ?? 'a Responsibility';
      const paying = state.assignments.find((a) => a.makeUpTurnId === t.id);
      const event = paying && state.events.find((e) => e.id === paying.eventId);
      const debtor = name(t.debtorId);
      const creditor = name(t.creditorId);
      const takes = debtor === 'You' ? 'take' : 'takes';
      const whose = creditor === 'You' ? 'your' : `${creditor}'s`;
      const when = event ? ` on ${formatMonthDay(dateIn(event.startsAt, timeZone))}` : '';
      return `${debtor} ${takes} ${whose} next ${what} turn${when}.`;
    });
}

/**
 * The Make-up Turn notices on one Assignment: the one it pays ("You're taking Ben's turn,
 * because Ben covered you on Nov 22.") and the one it created ("Ana owes Ben a Make-up Turn:
 * Jan 4 Sound.").
 */
export function assignmentMakeUpNotices(
  state: GroupState,
  assignmentId: string,
  myMemberId: MemberId | null,
  timeZone: string,
): { paying: string | null; created: string | null } {
  const assignment = state.assignments.find((a) => a.id === assignmentId);
  if (!assignment) return { paying: null, created: null };
  const name = (id: MemberId) => (id === myMemberId ? 'you' : (state.members.find((m) => m.id === id)?.name ?? 'a former Member'));

  let paying: string | null = null;
  const turn = assignment.makeUpTurnId ? state.makeUpTurns.find((t) => t.id === assignment.makeUpTurnId) : undefined;
  if (turn) {
    const covered = state.assignments.find((a) => a.id === turn.coverAssignmentId);
    const event = covered && state.events.find((e) => e.id === covered.eventId);
    const debtor = name(turn.debtorId);
    const creditor = name(turn.creditorId);
    const subject = debtor === 'you' ? "You're" : `${debtor} is`;
    const on = event ? ` on ${formatMonthDay(dateIn(event.startsAt, timeZone))}` : '';
    paying = `${subject} taking ${creditor === 'you' ? 'your' : `${creditor}'s`} turn, because ${creditor} covered ${debtor === 'you' ? 'you' : 'them'}${on}.`;
  }

  let created: string | null = null;
  const owed = state.makeUpTurns.find((t) => t.coverAssignmentId === assignmentId && t.status === 'outstanding');
  if (owed) created = makeUpTurnLines({ ...state, makeUpTurns: [owed] }, myMemberId, timeZone)[0] ?? null;
  return { paying, created };
}
