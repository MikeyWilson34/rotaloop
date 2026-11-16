import type { MemberId, Rotation } from './types';

/**
 * Queue mechanics of a Rotation. A Rotation is a cyclic queue plus a count of turns
 * each Member took early. Turns are used up in batches (all seats of one
 * Responsibility at one Event) so the result never depends on seat order:
 * a Member at the front goes to the back; anyone else used a turn early and skips
 * their next turn at the front.
 */

function earlyTurns(rotation: Rotation, memberId: MemberId): number {
  return rotation.turnsTakenEarly[memberId] ?? 0;
}

/** Members whose turn comes next, in order, leaving out anyone who took a turn early. */
export function membersInLine(rotation: Rotation): MemberId[] {
  return rotation.queue.filter((m) => earlyTurns(rotation, m) === 0);
}

/** Members who took a turn early, in queue order: a last resort to fill a seat. */
export function membersAhead(rotation: Rotation): MemberId[] {
  return rotation.queue.filter((m) => earlyTurns(rotation, m) > 0);
}

export function spendTurns(rotation: Rotation, memberIds: MemberId[]): Rotation {
  const queue = [...rotation.queue];
  const early: Record<MemberId, number> = { ...rotation.turnsTakenEarly };
  const pending = new Set(memberIds.filter((m) => queue.includes(m)));
  while (queue.length > 0) {
    const front = queue[0];
    if ((early[front] ?? 0) > 0) {
      early[front] -= 1;
      queue.push(queue.shift() as MemberId);
    } else if (pending.has(front)) {
      pending.delete(front);
      queue.push(queue.shift() as MemberId);
    } else {
      break;
    }
  }
  for (const m of pending) early[m] = (early[m] ?? 0) + 1;
  return { ...rotation, queue, turnsTakenEarly: withoutZeros(early) };
}

export function appendToQueue(rotation: Rotation, memberId: MemberId): Rotation {
  if (rotation.queue.includes(memberId)) return rotation;
  return { ...rotation, queue: [...rotation.queue, memberId] };
}

export function removeFromQueue(rotation: Rotation, memberId: MemberId): Rotation {
  const early = { ...rotation.turnsTakenEarly };
  delete early[memberId];
  return { ...rotation, queue: rotation.queue.filter((m) => m !== memberId), turnsTakenEarly: early };
}

/** Reorders the queue (stable for equal keys) and forgets early turns. */
export function reorderQueue(rotation: Rotation, key: (memberId: MemberId) => number): Rotation {
  const queue = rotation.queue
    .map((memberId, index) => ({ memberId, index, key: key(memberId) }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map((entry) => entry.memberId);
  return withQueueOrder(rotation, queue);
}

/**
 * Puts the queue in the given order and forgets early turns: a reordered queue
 * (Rebalance or by hand) starts fresh, so no one skips a turn they took before.
 */
export function withQueueOrder(rotation: Rotation, queue: MemberId[]): Rotation {
  return { ...rotation, queue: [...queue], turnsTakenEarly: {} };
}

function withoutZeros(record: Record<MemberId, number>): Record<MemberId, number> {
  const result: Record<MemberId, number> = {};
  for (const [key, value] of Object.entries(record)) if (value > 0) result[key] = value;
  return result;
}
