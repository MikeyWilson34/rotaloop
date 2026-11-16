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
  other: 'The group needs at least one Admin. Make someone else an Admin first.',
};

const INVALID: Partial<Record<GroupAction, string>> = {
  appointAdmin: "They haven't joined yet. Send them their personal invite link, then make them an Admin.",
  rename: 'Enter a name.',
  addPlaceholder: 'Enter a name.',
  createGroup: 'Check the group name and time zone, then try again.',
};

export function groupCommandMessage(reason: GroupCommandFailure | string, action: GroupAction = 'other'): string {
  switch (reason) {
    case 'lastAdmin':
      return LAST_ADMIN[action];
    case 'notPermitted':
      return 'Only Admins can do that. Ask an Admin of this group.';
    case 'notFound':
      return action === 'join'
        ? "That invite link isn't working. Ask for a new one."
        : "That person or item isn't in the group anymore. Pull down to refresh.";
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
