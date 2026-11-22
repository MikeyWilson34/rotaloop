/**
 * Deleting a Group (feedback-2 ticket 08, docs/adr/0009-deleting-a-group.md): the words the
 * app shows. Pure: unit-tested under Node.
 */
import type { GroupState } from '../engine';

/** People in the Group with an account (not Stand-ins, not people who left), you included. */
export function realMemberCount(state: GroupState): number {
  return state.members.filter((m) => m.leftAt === null && m.accountId !== null).length;
}

/** The confirm sheet: "Delete Sunday Team?" and who it affects. */
export function deleteGroupConfirm(groupName: string, realMembers: number): { title: string; message: string } {
  const who = realMembers <= 1 ? 'for you' : `for everyone (${realMembers} people)`;
  return {
    title: `Delete ${groupName}?`,
    message: `This removes the group and its schedule ${who}. It can't be undone.`,
  };
}

/** Shown when a Group you have open (or try to open) was deleted. */
export function groupDeletedMessage(groupName: string): string {
  return `${groupName} was deleted.`;
}

/** The join screen, for an invite link of a deleted Group. */
export function deletedInviteMessage(groupName: string): string {
  return `${groupName} was deleted, so this invite link doesn't work anymore.`;
}

/** The toast after you delete a Group. */
export function youDeletedMessage(groupName: string): string {
  return `You deleted ${groupName}`;
}
