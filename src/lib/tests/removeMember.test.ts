import { describe, expect, it } from 'vitest';

import { removeMemberConfirm } from '../removeMember';

describe('removeMemberConfirm', () => {
  it('tells a real member they can join again', () => {
    expect(removeMemberConfirm('Ben Ng', false)).toEqual({
      title: 'Remove Ben Ng?',
      message: 'Their upcoming turns go to the next people in the rotation. They can join again with the invite link.',
      toast: 'Ben Ng removed',
    });
  });

  it('keeps it short for a stand-in', () => {
    expect(removeMemberConfirm('Pat', true).message).toBe('Their upcoming turns go to the next people in the rotation.');
  });
});
