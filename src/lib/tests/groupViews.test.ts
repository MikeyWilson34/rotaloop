import { describe, expect, it } from 'vitest';

import { createGroupState, type GroupState } from '../../engine';
import {
  accentFor,
  adminNames,
  availableTimeZones,
  COMMON_TIME_ZONES,
  formatEventTime,
  groupCards,
  memberCountLabel,
  memberRows,
  myMember,
  nextEventAt,
  orList,
  searchTimeZones,
  timeZoneLabel,
} from '../groupViews';

function sampleState(): GroupState {
  const state = createGroupState({
    groupId: 'g1',
    members: [
      { id: 'm1', name: 'zoe', accountId: 'acc-zoe' },
      { id: 'm2', name: 'Ben', accountId: 'acc-ben', isAdmin: true },
      { id: 'm3', name: 'Pat' },
      { id: 'm4', name: 'Ann', accountId: 'acc-ann' },
      { id: 'm5', name: 'Al', accountId: 'acc-al', isAdmin: true },
      { id: 'm6', name: 'Gone', accountId: 'acc-gone' },
    ],
    responsibilities: [
      { id: 'r1', name: 'Host', headcount: 1, requiresConfirmation: true, qualifiedMemberIds: ['m1', 'm3'] },
      { id: 'r2', name: 'Setup', headcount: 1, requiresConfirmation: false, qualifiedMemberIds: ['m3', 'm2'] },
      { id: 'r3', name: 'Old', headcount: 1, requiresConfirmation: false, qualifiedMemberIds: ['m3'] },
    ],
    events: [
      { id: 'e1', seriesId: null, startsAt: '2026-11-01T15:00:00.000Z' },
      { id: 'e2', seriesId: null, startsAt: '2026-11-29T15:00:00.000Z' },
      { id: 'e3', seriesId: null, startsAt: '2026-11-22T15:00:00.000Z' },
    ],
  });
  return {
    ...state,
    members: state.members.map((m) => (m.id === 'm6' ? { ...m, leftAt: '2026-10-01T00:00:00.000Z' } : m)),
    responsibilities: state.responsibilities.map((r) =>
      r.id === 'r3' ? { ...r, removedAt: '2026-10-01T00:00:00.000Z' } : r,
    ),
    events: state.events.map((e) =>
      e.id === 'e3' ? { ...e, skipDate: { markedBy: 'm2', markedAt: '2026-11-10T00:00:00.000Z' } } : e,
    ),
  };
}

describe('memberRows', () => {
  const rows = memberRows(sampleState(), 'acc-ann');

  it('lists Admins first, then everyone by name (case-insensitive), without former Members', () => {
    expect(rows.map((r) => r.name)).toEqual(['Al', 'Ben', 'Ann', 'Pat', 'zoe']);
  });

  it('marks Admins, Placeholders and the viewer', () => {
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName.Al.isAdmin).toBe(true);
    expect(byName.Pat.isPlaceholder).toBe(true);
    expect(byName.Ann.isPlaceholder).toBe(false);
    expect(byName.Ann.isMe).toBe(true);
    expect(rows.filter((r) => r.isMe)).toHaveLength(1);
  });

  it('lists the current Responsibilities each Member is Qualified for, in the Group order', () => {
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName.Pat.qualifiedFor).toEqual(['Host', 'Setup']);
    expect(byName.Ben.qualifiedFor).toEqual(['Setup']);
    expect(byName.Ann.qualifiedFor).toEqual([]);
  });

  it('finds the viewer and the Admins', () => {
    const state = sampleState();
    expect(myMember(state, 'acc-ben')?.id).toBe('m2');
    expect(myMember(state, 'acc-gone')).toBeUndefined();
    expect(myMember(state, null)).toBeUndefined();
    expect(adminNames(state)).toEqual(['Ben', 'Al']);
  });
});

describe('labels', () => {
  it('joins names with "or"', () => {
    expect(orList([])).toBe('');
    expect(orList(['Sam'])).toBe('Sam');
    expect(orList(['Sam', 'Lee'])).toBe('Sam or Lee');
    expect(orList(['Sam', 'Lee', 'Kim'])).toBe('Sam, Lee or Kim');
  });

  it('counts Members', () => {
    expect(memberCountLabel(1)).toBe('1 Member');
    expect(memberCountLabel(3)).toBe('3 Members');
  });
});

describe('next Event', () => {
  it('skips past Events and Skip Dates', () => {
    expect(nextEventAt(sampleState(), new Date('2026-11-15T00:00:00Z'))).toBe('2026-11-29T15:00:00.000Z');
    expect(nextEventAt(sampleState(), new Date('2026-12-01T00:00:00Z'))).toBeNull();
  });

  it('formats in the Group time zone', () => {
    expect(formatEventTime('2026-11-22T15:00:00.000Z', 'America/Chicago')).toBe('Sun, Nov 22 · 9:00 AM');
    expect(formatEventTime('2026-11-22T15:00:00.000Z', 'Not/AZone')).toBe('Sun, Nov 22 · 3:00 PM');
  });
});

describe('groupCards', () => {
  const now = new Date('2026-11-15T00:00:00Z');
  const memberships = [
    { groupId: 'a', name: 'Zeta', timeZone: 'UTC', isAdmin: false },
    { groupId: 'b', name: 'alpha', timeZone: 'UTC', isAdmin: true },
    { groupId: 'c', name: 'Beta', timeZone: 'UTC', isAdmin: false },
    { groupId: 'd', name: 'Gamma', timeZone: 'UTC', isAdmin: true },
  ];
  const events = [
    { groupId: 'a', startsAt: '2026-11-20T10:00:00Z', skipped: false },
    { groupId: 'a', startsAt: '2026-11-18T10:00:00Z', skipped: true },
    { groupId: 'd', startsAt: '2026-11-17T10:00:00Z', skipped: false },
    { groupId: 'd', startsAt: '2026-11-10T10:00:00Z', skipped: false },
  ];

  it('puts Groups with an upcoming Event first (soonest first), then the rest by name', () => {
    const cards = groupCards(memberships, events, now);
    expect(cards.map((c) => c.name)).toEqual(['Gamma', 'Zeta', 'alpha', 'Beta']);
  });

  it('shows the next Event that is not a Skip Date, or none', () => {
    const cards = Object.fromEntries(groupCards(memberships, events, now).map((c) => [c.groupId, c]));
    expect(cards.a.nextEventAt).toBe('2026-11-20T10:00:00Z');
    expect(cards.d.nextEventAt).toBe('2026-11-17T10:00:00Z');
    expect(cards.b.nextEventAt).toBeNull();
    expect(cards.b.isAdmin).toBe(true);
  });
});

describe('accentFor', () => {
  it('is stable per Group', () => {
    expect(accentFor('g-1')).toBe(accentFor('g-1'));
    expect(['blue', 'plum', 'clay', 'teal']).toContain(accentFor('anything'));
  });
});

describe('time zones', () => {
  it('lists every zone when the engine can, and falls back to common ones', () => {
    expect(availableTimeZones(() => ['Europe/Paris'])).toEqual(['Europe/Paris', 'UTC']);
    expect(availableTimeZones(() => [])).toBe(COMMON_TIME_ZONES);
    expect(
      availableTimeZones(() => {
        throw new Error('nope');
      }),
    ).toBe(COMMON_TIME_ZONES);
  });

  it('labels a zone city first', () => {
    expect(timeZoneLabel('America/New_York')).toBe('New York · America');
    expect(timeZoneLabel('America/Argentina/Buenos_Aires')).toBe('Buenos Aires · America / Argentina');
    expect(timeZoneLabel('UTC')).toBe('UTC');
  });

  it('searches by every word, ignoring underscores and slashes', () => {
    expect(searchTimeZones(COMMON_TIME_ZONES, 'new york')).toEqual(['America/New_York']);
    expect(searchTimeZones(COMMON_TIME_ZONES, 'europe ber')).toEqual(['Europe/Berlin']);
    expect(searchTimeZones(COMMON_TIME_ZONES, '  ')).toBe(COMMON_TIME_ZONES);
    expect(searchTimeZones(COMMON_TIME_ZONES, 'atlantis')).toEqual([]);
  });
});
