/**
 * Plain-language messages for every way the `group-command` function can refuse a request.
 * Pure: unit-tested under Node.
 */
import type { GroupCommandFailure } from '../db/protocol';

/**
 * What the person was trying to do, for messages that depend on it (mostly `lastAdmin`,
 * which the engine uses for stepping down, leaving and being removed alike).
 */
export type GroupAction =
  | 'leave'
  | 'stepDown'
  | 'removeMember'
  | 'appointAdmin'
  | 'rename'
  | 'addPlaceholder'
  | 'join'
  | 'createGroup'
  /** Group setup (ticket 07). */
  | 'saveResponsibility'
  | 'removeResponsibility'
  | 'qualify'
  | 'reorder'
  | 'rebalance'
  | 'saveSeries'
  | 'removeSeries'
  | 'addEvent'
  | 'removeEvent'
  | 'changeSettings'
  | 'groupDetails'
  | 'other';

const LAST_ADMIN: Record<GroupAction, string> = {
  leave: "You're the only Admin, so you can't leave yet. Make someone else an Admin first.",
  stepDown: "You're the only Admin, so you can't step down yet. Make someone else an Admin first.",
  removeMember: "That's the group's only Admin. Make someone else an Admin first.",
  appointAdmin: 'The group needs at least one Admin. Make someone else an Admin first.',
  rename: 'The group needs at least one Admin. Make someone else an Admin first.',
  addPlaceholder: 'The group needs at least one Admin. Make someone else an Admin first.',
  join: 'The group needs at least one Admin. Make someone else an Admin first.',
  createGroup: 'The group needs at least one Admin.',
  saveResponsibility: 'The group needs at least one Admin. Make someone else an Admin first.',
  removeResponsibility: 'The group needs at least one Admin. Make someone else an Admin first.',
  qualify: 'The group needs at least one Admin. Make someone else an Admin first.',
  reorder: 'The group needs at least one Admin. Make someone else an Admin first.',
  rebalance: 'The group needs at least one Admin. Make someone else an Admin first.',
  saveSeries: 'The group needs at least one Admin. Make someone else an Admin first.',
  removeSeries: 'The group needs at least one Admin. Make someone else an Admin first.',
  addEvent: 'The group needs at least one Admin. Make someone else an Admin first.',
  removeEvent: 'The group needs at least one Admin. Make someone else an Admin first.',
  changeSettings: 'The group needs at least one Admin. Make someone else an Admin first.',
  groupDetails: 'The group needs at least one Admin. Make someone else an Admin first.',
  other: 'The group needs at least one Admin. Make someone else an Admin first.',
};

const INVALID: Partial<Record<GroupAction, string>> = {
  appointAdmin: "They haven't joined yet. Send them their personal invite link, then make them an Admin.",
  rename: 'Enter a name.',
  addPlaceholder: 'Enter a name.',
  createGroup: 'Check the group name and time zone, then try again.',
  saveResponsibility: 'Check the name and how many people each Event needs, then try again.',
  reorder: 'The list changed while you were editing. Pull down to refresh, then try again.',
  saveSeries: 'Check the days, time, start date and Responsibilities, then try again.',
  addEvent: 'Check the date and time. A one-off Event needs at least one Responsibility.',
  removeEvent: 'Only one-off Events can be removed. To skip one Event of a series, add a Skip Date.',
  changeSettings: "That setting isn't available. Pull down to refresh, then try again.",
  groupDetails: 'Check the group name and time zone, then try again.',
};

const NOT_FOUND: Partial<Record<GroupAction, string>> = {
  saveResponsibility: "That Responsibility isn't in the group anymore. Pull down to refresh.",
  removeResponsibility: "That Responsibility isn't in the group anymore. Pull down to refresh.",
  qualify: "That person or Responsibility isn't in the group anymore. Pull down to refresh.",
  rebalance: "That Responsibility isn't in the group anymore. Pull down to refresh.",
  saveSeries: "That Event Series or one of its Responsibilities isn't in the group anymore. Pull down to refresh.",
  removeSeries: "That Event Series isn't in the group anymore. Pull down to refresh.",
  removeEvent: "That Event isn't on the schedule anymore. Pull down to refresh.",
};

export function groupCommandMessage(reason: GroupCommandFailure | string, action: GroupAction = 'other'): string {
  switch (reason) {
    case 'lastAdmin':
      return LAST_ADMIN[action];
    case 'notPermitted':
      return 'Only Admins can do that. Ask an Admin of this group.';
    case 'notFound':
      if (action === 'join') return "That invite link isn't working. Ask for a new one.";
      return NOT_FOUND[action] ?? "That person or item isn't in the group anymore. Pull down to refresh.";
    case 'invalid':
      return INVALID[action] ?? "That change isn't possible. Check it and try again.";
    case 'invalidRequest':
      return INVALID[action] ?? "Something in that request wasn't right. Check it and try again.";
    case 'eventHasPassed':
      return 'That Event has already happened, so it can no longer change.';
    case 'alreadyCovered':
      return 'Someone else already covered that.';
    case 'notQualified':
      return "That person isn't a Qualified Member for this Responsibility.";
    case 'noCoverageRequest':
      return 'There is no Coverage Request for that Assignment anymore.';
    case 'alreadyNeedsCoverage':
      return 'That Assignment already needs coverage.';
    case 'alreadyAssignedAtEvent':
      return 'That person already has an Assignment at this Event.';
    case 'unauthenticated':
      return 'Your session has ended. Close and reopen the app, then try again.';
    case 'notMember':
      return "You're no longer a Member of this group.";
    case 'invalidInvite':
      return "That invite link isn't working. It may have been reset or already used: ask for a new one.";
    case 'alreadyMember':
      return "You're already a Member of this group.";
    case 'conflict':
      return 'Others were changing the group at the same moment. Please try again.';
    case 'serverError':
      return "Couldn't reach the server. Check your connection and try again.";
    default:
      return 'Something went wrong. Please try again.';
  }
}

/** A plain-language message for a failed `update_group_details` call (rename or time zone). */
export function groupDetailsMessage(error: { code?: string; message?: string } | null | undefined): string {
  if (error?.code === '42501') return groupCommandMessage('notPermitted');
  if (error?.code === '23514' || error?.code === '22023') return groupCommandMessage('invalid', 'groupDetails');
  return groupCommandMessage('serverError');
}
