/**
 * Headcount Jobs (simplify ticket 09): no turns; before each date every Member is asked
 * "Coming?" Yes / No, and the Group sees "12 coming · 3 not · 5 no reply".
 *
 * Pure TypeScript over engine state (relative imports only), shared by the app (Home, the
 * group page) and the `notify` Edge Function.
 */
import { headcountsNeeded } from '../engine/state';
import type { GroupState, HeadcountReply, Instant, MemberId } from '../engine/types';

export type HeadcountCounts = { coming: number; notComing: number; noReply: number };

/** One date of a headcount Job. */
export type HeadcountDate = {
  eventId: string;
  responsibilityId: string;
  jobName: string;
  startsAt: Instant;
};

/** One Member's answer for one date. */
export type HeadcountPerson = {
  memberId: MemberId;
  name: string;
  isMe: boolean;
  /** Not on the app: anyone in the Group may answer for them. */
  isStandIn: boolean;
  answer: HeadcountReply | null;
};

const activeMembers = (state: GroupState) => state.members.filter((m) => m.leftAt === null);

/** The Member's answer for the date, or null when they haven't answered. */
export function answerOf(
  state: GroupState,
  eventId: string,
  responsibilityId: string,
  memberId: MemberId | null,
): HeadcountReply | null {
  if (!memberId) return null;
  return (
    state.headcountAnswers.find(
      (a) => a.eventId === eventId && a.responsibilityId === responsibilityId && a.memberId === memberId,
    )?.answer ?? null
  );
}

/** Everyone in the Group now, in join order, with their answer. */
export function headcountPeople(
  state: GroupState,
  eventId: string,
  responsibilityId: string,
  me: MemberId | null,
): HeadcountPerson[] {
  return activeMembers(state).map((m) => ({
    memberId: m.id,
    name: m.name,
    isMe: m.id === me,
    isStandIn: m.accountId === null,
    answer: answerOf(state, eventId, responsibilityId, m.id),
  }));
}

/** How many of the Group's current Members said Yes, No, or nothing yet. */
export function headcountCounts(state: GroupState, eventId: string, responsibilityId: string): HeadcountCounts {
  const counts: HeadcountCounts = { coming: 0, notComing: 0, noReply: 0 };
  for (const p of headcountPeople(state, eventId, responsibilityId, null)) {
    if (p.answer === 'yes') counts.coming++;
    else if (p.answer === 'no') counts.notComing++;
    else counts.noReply++;
  }
  return counts;
}

/** "12 coming · 3 not · 5 no reply". */
export function headcountText(c: HeadcountCounts): string {
  return `${c.coming} coming · ${c.notComing} not · ${c.noReply} no reply`;
}

/** The Group's upcoming headcount dates (not started, not a date off), soonest first. */
export function upcomingHeadcounts(state: GroupState, now: Instant): HeadcountDate[] {
  const t = Date.parse(now);
  const out: HeadcountDate[] = [];
  for (const event of state.events) {
    if (event.skipDate || Date.parse(event.startsAt) <= t) continue;
    for (const job of headcountsNeeded(state, event)) {
      out.push({ eventId: event.id, responsibilityId: job.id, jobName: job.name, startsAt: event.startsAt });
    }
  }
  const order = new Map(state.responsibilities.map((r, i) => [r.id, i]));
  return out.sort(
    (a, b) =>
      Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
      (order.get(a.responsibilityId) ?? 0) - (order.get(b.responsibilityId) ?? 0),
  );
}

/** The next date of each headcount Job: the one people are asked about now. */
export function nextHeadcounts(state: GroupState, now: Instant): HeadcountDate[] {
  const seen = new Set<string>();
  return upcomingHeadcounts(state, now).filter((d) => {
    if (seen.has(d.responsibilityId)) return false;
    seen.add(d.responsibilityId);
    return true;
  });
}

/** The toast after answering. */
export function answeredMessage(answer: HeadcountReply, forName?: string | null): string {
  if (forName) return answer === 'yes' ? `Got it. ${forName} is coming.` : `Got it. ${forName} isn't coming.`;
  return answer === 'yes' ? 'Got it. See you there!' : 'Got it. Thanks for letting us know.';
}
