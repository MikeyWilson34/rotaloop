/**
 * Plain-language messages for every way the `group-command` function can refuse a request.
 * Pure: unit-tested under Node.
 */
import type { GroupCommandFailure } from '../db/protocol';

/**
 * What the person was trying to do, for messages that depend on it, such as `invalid` and `notFound`.
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
  /** "Coming?" Yes / No for a headcount job (simplify ticket 09). */
  | 'answerHeadcount'
  /** "This is someone in the group": merge a stand-in into a real member (feedback-2 ticket 05). */
  | 'mergeStandIn'
  /** Deleting the whole group (feedback-2 ticket 08). */
  | 'deleteGroup'
  | 'other';

/**
 * `lastAdmin`: the engine still keeps one Admin per Group, though the app has no Admins for
 * now (docs/adr/0006-members-only.md), so nothing in the UI should reach this.
 */
const LAST_ADMIN = "That can't be changed right now. Pull down to refresh, then try again.";

const INVALID: Partial<Record<GroupAction, string>> = {
  appointAdmin: "They haven't joined yet. Send them their personal invite link first.",
  rename: 'Enter a name.',
  addPlaceholder: 'Enter a name.',
  createGroup: 'Check the group name and time zone, then try again.',
  saveResponsibility: 'Check the job name, then try again.',
  reorder: 'The list changed while you were editing. Pull down to refresh, then try again.',
  saveSeries: 'Check the days, time and start date, then try again.',
  addEvent: 'Check the date and time, then try again.',
  removeEvent: "Only one-off dates can be removed. To skip one date of a repeating job, add it to the group's dates off.",
  changeSettings: "That setting isn't available. Pull down to refresh, then try again.",
  groupDetails: 'Check the group name and time zone, then try again.',
  addTimeOff: 'Check the days you picked, then try again.',
  decline: 'Keep the reason under 300 characters, then try again.',
  addSkipDate: "That date is already off, or the reason is too long. Pull down to refresh, then try again.",
  // The server doesn't know how to delete a group yet (an older version is running).
  deleteGroup: "Couldn't delete the group right now. Please try again later.",
};

const NOT_FOUND: Partial<Record<GroupAction, string>> = {
  saveResponsibility: "That job isn't in the group anymore. Pull down to refresh.",
  removeResponsibility: "That job isn't in the group anymore. Pull down to refresh.",
  qualify: "That person or job isn't in the group anymore. Pull down to refresh.",
  rebalance: "That job isn't in the group anymore. Pull down to refresh.",
  saveSeries: "That job isn't in the group anymore. Pull down to refresh.",
  removeSeries: "That job isn't in the group anymore. Pull down to refresh.",
  removeEvent: "That date isn't on the schedule anymore. Pull down to refresh.",
  removeTimeOff: 'Those dates off were already removed. Pull down to refresh.',
  addSkipDate: "That date isn't on the schedule anymore. Pull down to refresh.",
  removeSkipDate: 'Those dates off were already removed. Pull down to refresh.',
};

/** The cover flow's actions (simplify ticket 07): messages that replace the general ones for that action. */
const ASSIGNMENT: Partial<Record<GroupAction, Partial<Record<string, string>>>> = {
  confirm: {
    notPermitted: "Only the person whose turn it is can confirm this. Pull down to refresh.",
    alreadyNeedsCoverage: "You've already said you can't make it, so this needs cover now.",
  },
  decline: {
    notPermitted: "Only the person whose turn it is can say they can't make it. Pull down to refresh.",
    alreadyNeedsCoverage: 'This already needs cover. The group has been asked.',
    alreadyAssignedAtEvent: 'They already have another job then. Pick someone else.',
    invalid: "Enter their name, or pick someone other than the person who can't make it.",
    notFound: "That person isn't in the group anymore. Pick someone else.",
  },
  cover: {
    notPermitted: 'Only people in this group can cover.',
    notQualified: "You're not in the turns for this job, so you can't cover it.",
    noCoverageRequest: "This doesn't need cover anymore. Pull down to refresh.",
    alreadyAssignedAtEvent: "You already have another job then, so you can't cover this one too.",
    invalid: "You can't make this one, so you can't cover it yourself.",
  },
  withdrawDecline: {
    alreadyCovered: 'Someone already covered this, so it’s theirs now. Pull down to refresh.',
    noCoverageRequest: "You're already back on this one. Pull down to refresh.",
    notPermitted: 'Only the person who said they can’t make it can take it back.',
    invalid: 'The turns changed since you said you can’t make it, so this one has moved on. Cover someone else’s turn instead.',
  },
  answerHeadcount: {
    notPermitted: "You can only answer for yourself, or for someone who isn't on the app.",
    eventHasPassed: 'That date has already started, so the answers are closed.',
    notFound: "That date or job isn't in the group anymore. Pull down to refresh.",
    invalid: "That date doesn't need this job anymore. Pull down to refresh.",
  },
  mergeStandIn: {
    notFound: 'They already joined or left the group. Pull down to refresh.',
    invalid: 'Pick someone who is on the app.',
  },
  markCovered: {
    notPermitted: 'Only people in this group can say who is covering.',
    noCoverageRequest: "This doesn't need cover anymore. Pull down to refresh.",
    alreadyAssignedAtEvent: 'They already have another job then. Pick someone else.',
    invalid: "Enter their name, or pick someone other than the person who can't make it.",
    notFound: "That person isn't in the group anymore. Pick someone else.",
  },
};

export function groupCommandMessage(reason: GroupCommandFailure | string, action: GroupAction = 'other'): string {
  const specific = ASSIGNMENT[action]?.[reason];
  if (specific) return specific;
  switch (reason) {
    case 'lastAdmin':
      return LAST_ADMIN;
    case 'notPermitted':
      return "You can't change that. Pull down to refresh, then try again.";
    case 'notFound':
      if (action === 'join') return "That invite link isn't working. Ask for a new one.";
      return NOT_FOUND[action] ?? "That person or item isn't in the group anymore. Pull down to refresh.";
    case 'invalid':
      return INVALID[action] ?? "That change isn't possible. Check it and try again.";
    case 'invalidRequest':
      return INVALID[action] ?? "Something in that request wasn't right. Check it and try again.";
    case 'eventHasPassed':
      return 'That date has already passed, so it can no longer change.';
    case 'alreadyCovered':
      return 'Someone else already covered that.';
    case 'notQualified':
      return "That person isn't in the turns for this job.";
    case 'noCoverageRequest':
      return "That turn doesn't need cover anymore.";
    case 'alreadyNeedsCoverage':
      return 'That turn already needs cover.';
    case 'alreadyAssignedAtEvent':
      return 'That person already has a turn then.';
    case 'unauthenticated':
      return 'Your session has ended. Close and reopen the app, then try again.';
    case 'notMember':
      return "You're no longer in this group.";
    case 'invalidInvite':
      return "That invite link isn't working. It may have been reset or already used: ask for a new one.";
    case 'alreadyMember':
      return "You're already in this group.";
    case 'standInTaken':
      return 'Someone else just joined as that person. Pick again, or join as someone new.';
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
