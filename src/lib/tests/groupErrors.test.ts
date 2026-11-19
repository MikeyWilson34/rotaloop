import { describe, expect, it } from 'vitest';

import type { GroupCommandFailure } from '../../db/protocol';
import { groupCommandMessage, groupDetailsMessage, type GroupAction } from '../groupErrors';

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
  'saveResponsibility',
  'removeResponsibility',
  'qualify',
  'reorder',
  'rebalance',
  'saveSeries',
  'removeSeries',
  'addEvent',
  'removeEvent',
  'changeSettings',
  'groupDetails',
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
    // No Admins in the app (ADR 0006): one plain message, never the word Admin.
    for (const action of ['leave', 'stepDown', 'removeMember'] as const) {
      expect(groupCommandMessage('lastAdmin', action)).toBe("That can't be changed right now. Pull down to refresh, then try again.");
    }
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

describe('group setup messages', () => {
  it('explains setup refusals in plain words', () => {
    expect(groupCommandMessage('invalid', 'removeEvent')).toMatch(/dates off/);
    expect(groupCommandMessage('invalid', 'saveSeries')).toMatch(/days, time/);
    expect(groupCommandMessage('notFound', 'removeSeries')).toMatch(/That job isn't in the group/);
    expect(groupCommandMessage('notPermitted', 'changeSettings')).toMatch(/You can't change that/);
  });

  it('maps update_group_details errors', () => {
    expect(groupDetailsMessage({ code: '42501' })).toMatch(/You can't change that/);
    expect(groupDetailsMessage({ code: '23514' })).toMatch(/group name and time zone/);
    expect(groupDetailsMessage(null)).toMatch(/connection/);
  });
});

describe('Assignment action messages (ticket 09)', () => {
  it('explains coverage refusals in plain words', () => {
    expect(groupCommandMessage('alreadyCovered', 'cover')).toBe('Someone else already covered that.');
    expect(groupCommandMessage('notQualified', 'cover')).toMatch(/not in the turns for this job/);
    expect(groupCommandMessage('alreadyAssignedAtEvent', 'cover')).toMatch(/already have another job then/);
    expect(groupCommandMessage('notPermitted', 'markCovered')).toMatch(/Only people in this group/);
    expect(groupCommandMessage('invalid', 'markCovered')).toMatch(/Enter their name/);
    expect(groupCommandMessage('alreadyNeedsCoverage', 'confirm')).toMatch(/needs cover now/);
    expect(groupCommandMessage('notPermitted', 'decline')).toMatch(/Only the person whose turn it is/);
    expect(groupCommandMessage('eventHasPassed', 'confirm')).toMatch(/already passed/);
  });

  it('keeps the general messages for other actions', () => {
    expect(groupCommandMessage('notPermitted', 'rebalance')).toMatch(/You can't change that/);
    expect(groupCommandMessage('invalid')).toMatch(/isn't possible/);
  });
});
