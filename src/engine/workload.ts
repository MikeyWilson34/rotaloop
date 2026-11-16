import { servesSeat } from './schedule';
import { rotationOf } from './state';
import { ms } from './time';
import type { GroupState, Instant, MemberId, ResponsibilityId } from './types';

export interface Workload {
  memberId: MemberId;
  /** Past turns served in this Responsibility (own turns and Make-up Turns). */
  served: number;
  /** Past Covers of someone else's Assignment in this Responsibility. */
  covered: number;
  /** Future Assignments the Member will serve. */
  upcoming: number;
}

/**
 * Workload per Member for one Responsibility, as of `now`: the current Qualified
 * Members first (in Rotation order), then anyone else with history. Guest Covers
 * count toward no one. Rebalance orders by `served + covered`.
 */
export function workload(state: GroupState, responsibilityId: ResponsibilityId, now: Instant): Workload[] {
  const byMember = new Map<MemberId, Workload>();
  const entry = (memberId: MemberId) => {
    let found = byMember.get(memberId);
    if (!found) {
      found = { memberId, served: 0, covered: 0, upcoming: 0 };
      byMember.set(memberId, found);
    }
    return found;
  };
  for (const memberId of rotationOf(state, responsibilityId).queue) entry(memberId);
  const startsAt = new Map(state.events.map((e) => [e.id, ms(e.startsAt)]));
  for (const a of state.assignments) {
    if (a.responsibilityId !== responsibilityId || !servesSeat(a) || a.memberId === null) continue;
    const at = startsAt.get(a.eventId);
    if (at === undefined) continue;
    const counts = entry(a.memberId);
    if (at > ms(now)) counts.upcoming += 1;
    else if (a.coverageRequest?.cover) counts.covered += 1;
    else counts.served += 1;
  }
  return [...byMember.values()];
}
