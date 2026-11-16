import { describe, expect, it } from 'vitest';

import {
  assignmentStatus,
  DEFAULT_GROUP_SETTINGS,
  isUnconfirmed,
  replacementDutyHolder,
  type Assignment,
} from '../index';

const EVENT = '2027-01-10T09:00:00.000Z';
const FOUR_DAYS_BEFORE = '2027-01-06T09:00:00.000Z';
const TWO_DAYS_BEFORE = '2027-01-08T09:00:00.000Z';
const HOUR = 60 * 60 * 1000;

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: 'a1',
    eventId: 'w2',
    responsibilityId: 'sound',
    memberId: 'ana',
    turnOf: 'ana',
    makeUpTurnId: null,
    confirmation: 'notRequired',
    coverageRequest: null,
    ...overrides,
  };
}

const openRequest = { reason: 'declined', requestedBy: 'ana', requestedAt: FOUR_DAYS_BEFORE, cover: null } as const;

describe('Assignment status', () => {
  it('Scheduled: no confirmation is needed, or it has not been requested yet', () => {
    expect(assignmentStatus(assignment(), EVENT, FOUR_DAYS_BEFORE)).toBe('scheduled');
    expect(assignmentStatus(assignment({ confirmation: 'notYetRequested' }), EVENT, FOUR_DAYS_BEFORE)).toBe('scheduled');
  });

  it('Pending: confirmation has been requested', () => {
    expect(assignmentStatus(assignment({ confirmation: 'requested' }), EVENT, FOUR_DAYS_BEFORE)).toBe('pending');
  });

  it('Confirmed', () => {
    expect(assignmentStatus(assignment({ confirmation: 'confirmed' }), EVENT, TWO_DAYS_BEFORE)).toBe('confirmed');
  });

  it('Unconfirmed: still not confirmed when the Admin alert lead time arrives', () => {
    const pending = assignment({ confirmation: 'requested' });
    expect(isUnconfirmed(pending, EVENT, FOUR_DAYS_BEFORE)).toBe(false);
    expect(isUnconfirmed(pending, EVENT, TWO_DAYS_BEFORE)).toBe(true);
    expect(assignmentStatus(pending, EVENT, TWO_DAYS_BEFORE)).toBe('unconfirmed');
    // Each Admin brings their own lead time.
    expect(isUnconfirmed(pending, EVENT, TWO_DAYS_BEFORE, 24 * HOUR)).toBe(false);
    expect(isUnconfirmed(assignment(), EVENT, TWO_DAYS_BEFORE)).toBe(false);
  });

  it('Needs coverage: a Coverage Request nobody has covered yet', () => {
    expect(assignmentStatus(assignment({ coverageRequest: openRequest }), EVENT, TWO_DAYS_BEFORE)).toBe('needsCoverage');
  });

  it('Covered: a Cover by a volunteer or a Guest Cover', () => {
    const cover = { kind: 'guest', guestName: 'Pat', arrangedBy: 'ana', coveredAt: FOUR_DAYS_BEFORE } as const;
    const covered = assignment({ memberId: null, coverageRequest: { ...openRequest, cover } });
    expect(assignmentStatus(covered, EVENT, TWO_DAYS_BEFORE)).toBe('covered');
  });

  it('Replacement Duty starts at the Group\'s "find a replacement by" deadline', () => {
    const request = assignment({ coverageRequest: openRequest });
    expect(replacementDutyHolder(request, EVENT, DEFAULT_GROUP_SETTINGS, FOUR_DAYS_BEFORE)).toBeNull();
    expect(replacementDutyHolder(request, EVENT, DEFAULT_GROUP_SETTINGS, TWO_DAYS_BEFORE)).toBe('assignedMember');
    const admins = { ...DEFAULT_GROUP_SETTINGS, replacementDuty: 'admins', replacementDeadlineMs: 5 * 24 * HOUR } as const;
    expect(replacementDutyHolder(request, EVENT, admins, FOUR_DAYS_BEFORE)).toBe('admins');
  });
});
