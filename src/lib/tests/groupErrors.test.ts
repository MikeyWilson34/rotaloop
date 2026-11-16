import { describe, expect, it } from 'vitest';

import type { GroupCommandFailure } from '../../db/protocol';
import { groupCommandMessage, type GroupAction } from '../groupErrors';

const ALL_REASONS: GroupCommandFailure[] = [
  'notFound',
  'notPermitted',
  'eventHasPassed',
  'alreadyCovered',
  'notQualified',
  'noCoverageRequest',
  'alreadyNeedsCoverage',
  'alreadyAssignedAtEvent',
  'lastAdmin',
  'invalid',
  'invalidRequest',
  'unauthenticated',
  'notMember',
  'invalidInvite',
  'alreadyMember',
  'conflict',
  'serverError',
];

const ACTIONS: GroupAction[] = [
  'leave',
  'stepDown',
  'removeMember',
  'appointAdmin',
  'rename',
  'addPlaceholder',
  'join',
  'createGroup',
  'other',
];

const GENERIC = 'Something went wrong. Please try again.';

describe('groupCommandMessage', () => {
  it('has a specific plain message for every reason and action', () => {
    for (const reason of ALL_REASONS) {
      for (const action of ACTIONS) {
        const message = groupCommandMessage(reason, action);
        expect(message, `${reason}/${action}`).not.toBe(GENERIC);
        expect(message.length).toBeGreaterThan(10);
        // No engine jargon or raw reason codes leak through.
        expect(message).not.toMatch(/[a-z][A-Z]/);
      }
    }
  });

  it('explains the last-Admin guard for leaving and stepping down', () => {
    expect(groupCommandMessage('lastAdmin', 'leave')).toMatch(/only Admin.*can't leave/);
    expect(groupCommandMessage('lastAdmin', 'stepDown')).toMatch(/only Admin.*can't step down/);
    expect(groupCommandMessage('lastAdmin', 'removeMember')).toMatch(/only Admin/);
  });

  it('explains why a Placeholder cannot be made an Admin', () => {
    expect(groupCommandMessage('invalid', 'appointAdmin')).toMatch(/haven't joined yet/);
  });

  it('treats an unknown join target as a bad link', () => {
    expect(groupCommandMessage('notFound', 'join')).toMatch(/invite link/);
    expect(groupCommandMessage('invalidInvite', 'join')).toMatch(/invite link/);
  });

  it('falls back to a generic message for unknown reasons', () => {
    expect(groupCommandMessage('somethingNew')).toBe(GENERIC);
  });
});
