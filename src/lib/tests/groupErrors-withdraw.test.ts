import { describe, expect, it } from 'vitest';

import { groupCommandMessage } from '../groupErrors';

describe('withdrawDecline and Decline reason messages (ticket 16)', () => {
  it('explains each refusal of "I can make it after all"', () => {
    expect(groupCommandMessage('alreadyCovered', 'withdrawDecline')).toBe(
      'Someone already covered this, so it’s theirs now. Pull down to refresh.',
    );
    expect(groupCommandMessage('noCoverageRequest', 'withdrawDecline')).toBe("You're already back on this one. Pull down to refresh.");
    expect(groupCommandMessage('notPermitted', 'withdrawDecline')).toBe('Only the person who said they can’t make it can take it back.');
    expect(groupCommandMessage('invalid', 'withdrawDecline')).toMatch(/^The turns changed/);
    expect(groupCommandMessage('eventHasPassed', 'withdrawDecline')).toBe(
      'That date has already passed, so it can no longer change.',
    );
  });

  it('a Decline reason that is too long', () => {
    expect(groupCommandMessage('invalidRequest', 'decline')).toBe('Keep the reason under 300 characters, then try again.');
  });
});
