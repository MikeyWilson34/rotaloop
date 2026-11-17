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
  /** Assignment actions (ticket 09). */
  | 'confirm'
  | 'decline'
  | 'cover'
  | 'markCovered'
  /** "I can make it after all" (ticket 16). */
  | 'withdrawDecline'
  /** Time Off and Skip Dates (ticket 10). */
  | 'addTimeOff'
  | 'removeTimeOff'
  | 'addSkipDate'
  | 'removeSkipDate'
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
  confirm: 'The group needs at least one Admin. Make someone else an Admin first.',
  decline: 'The group needs at least one Admin. Make someone else an Admin first.',
  cover: 'The group needs at least one Admin. Make someone else an Admin first.',
  markCovered: 'The group needs at least one Admin. Make someone else an Admin first.',
  withdrawDecline: 'The group needs at least one Admin. Make someone else an Admin first.',
  addTimeOff: 'The group needs at least one Admin. Make someone else an Admin first.',
  removeTimeOff: 'The group needs at least one Admin. Make someone else an Admin first.',
  addSkipDate: 'The group needs at least one Admin. Make someone else an Admin first.',
  removeSkipDate: 'The group needs at least one Admin. Make someone else an Admin first.',
  other:'The group needs at least one Admin. Make someone else an Admin first.',
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
  addTimeOff: 'Check the days you picked, then try again.',
  decline: 'Keep the reason under 300 characters, then try again.',
  addSkipDate: "That Event is already a Skip Date, or the reason is too long. Pull down to refresh, then try again.",
};

const NOT_FOUND: Partial<Record<GroupAction, string>> = {
  saveResponsibility: "That Responsibility isn't in the group anymore. Pull down to refresh.",
  removeResponsibility: "That Responsibility isn't in the group anymore. Pull down to refresh.",
  qualify: "That person or Responsibility isn't in the group anymore. Pull down to refresh.",
  rebalance: "That Responsibility isn't in the group anymore. Pull down to refresh.",
  saveSeries: "That Event Series or one of its Responsibilities isn't in the group anymore. Pull down to refresh.",
  removeSeries: "That Event Series isn't in the group anymore. Pull down to refresh.",
  removeEvent: "That Event isn't on the schedule anymore. Pull down to refresh.",
  removeTimeOff: 'That Time Off was already removed. Pull down to refresh.',
  addSkipDate: "That Event isn't on the schedule anymore. Pull down to refresh.",
  removeSkipDate: "That Skip Date was already removed. Pull down to refresh.",
};

/** Assignment actions (ticket 09): messages that replace the general ones for that action. */
const ASSIGNMENT: Partial<Record<GroupAction, Partial<Record<string, string>>>> = {
  confirm: {
    notPermitted: "Only the person assigned can confirm this. Pull down to refresh.",
    alreadyNeedsCoverage: "You've already said you can't make it, so this needs coverage now.",
  },
  decline: {
    notPermitted: "Only the person assigned can say they can't make it. Pull down to refresh.",
    alreadyNeedsCoverage: 'This already needs coverage. Qualified Members have been asked.',
    invalid: 'No one holds this Assignment anymore. Pull down to refresh.',
  },
  cover: {
    notPermitted: 'Only Members of this group can cover.',
    notQualified: "Only Qualified Members for this Responsibility can cover it. Ask an Admin to add you.",
    noCoverageRequest: "This doesn't need coverage anymore. Pull down to refresh.",
    alreadyAssignedAtEvent: "You already have an Assignment at this Event, so you can't cover this one too.",
    invalid: "You asked for coverage on this one, so you can't cover it yourself.",
  },
  withdrawDecline: {
    alreadyCovered: 'Someone already covered this, so it’s theirs now. Pull down to refresh.',
    noCoverageRequest: "You're already back on this one. Pull down to refresh.",
    notPermitted: 'Only the person who said they can’t make it can take it back.',
    invalid:
      'The Rotation changed since you said you can’t make it, so this turn has moved on. Ask an Admin, or cover someone else’s turn.',
  },
  markCovered: {
    notPermitted: 'Only whoever is finding a replacement, or an Admin, can mark this covered.',
    noCoverageRequest: "This doesn't need coverage anymore. Pull down to refresh.",
    invalid: "Enter the guest's name, or pick someone other than the person who can't make it.",
    notFound: "That person isn't in the group anymore. Pick someone else.",
  },
};

export function groupCommandMessage(reason: GroupCommandFailure | string, action: GroupAction = 'other'): string {
  const specific = ASSIGNMENT[action]?.[reason];
  if (specific) return specific;
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
