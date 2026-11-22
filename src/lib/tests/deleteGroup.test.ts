import { describe, expect, it } from 'vitest';

import { createGroupState } from '../../engine';
import { deleteGroupConfirm, deletedInviteMessage, groupDeletedMessage, realMemberCount } from '../deleteGroup';

describe('deleteGroupConfirm', () => {
  it('names the Group and counts everyone it affects', () => {
    expect(deleteGroupConfirm('Sunday Team', 4)).toEqual({
      title: 'Delete Sunday Team?',
      message: "This removes the group and its schedule for everyone (4 people). It can't be undone.",
    });
  });

  it('says "for you" when you are the only one', () => {
    expect(deleteGroupConfirm('Solo', 1).message).toBe("This removes the group and its schedule for you. It can't be undone.");
    expect(deleteGroupConfirm('Solo', 0).message).toMatch(/for you\./);
  });
});

describe('realMemberCount', () => {
  it('counts people with an account who are still in the Group, not Stand-ins', () => {
    const state = createGroupState({
      groupId: 'g',
      responsibilities: [],
      members: [
        { id: 'a', name: 'Ana', isAdmin: true, accountId: 'acc-a' },
        { id: 'b', name: 'Ben', accountId: 'acc-b' },
        { id: 'd', name: 'Dee', accountId: null },
      ],
    });
    expect(realMemberCount(state)).toBe(2);
    const left = { ...state, members: state.members.map((m) => (m.id === 'b' ? { ...m, leftAt: '2026-11-01T00:00:00.000Z' } : m)) };
    expect(realMemberCount(left)).toBe(1);
  });
});

describe('plain messages', () => {
  it('say the Group was deleted', () => {
    expect(groupDeletedMessage('Sunday Team')).toBe('Sunday Team was deleted.');
    expect(deletedInviteMessage('Sunday Team')).toBe("Sunday Team was deleted, so this invite link doesn't work anymore.");
  });
});
