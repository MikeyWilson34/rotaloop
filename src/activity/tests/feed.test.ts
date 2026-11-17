import { describe, expect, it } from 'vitest';

import type { Cause } from '../../engine';
import { asGroup, buildGroup, eventId, NOW, run, seat, ZONE } from '../../schedule/tests/fixture';
import {
  activityIcon,
  activityItems,
  activityKind,
  activityTarget,
  badgeLabel,
  dayLabel,
  filterActivity,
  groupActivityByDay,
  isFeedWorthy,
  isUnread,
  laterOf,
  newestAt,
  parseActivityFilter,
  unreadCount,
  type FeedEntry,
} from '../feed';
import { createLastSeenStore, lastSeenKey, parseLastSeen, type KeyValueStore } from '../lastSeenStore';

const entry = (id: string, at: string, cause: Cause, actorId: string | null = 'ben', groupId = 'g1'): FeedEntry => ({
  id,
  groupId,
  at,
  actorId,
  cause,
  changes: [],
  makeUpTurns: [],
});

describe('kinds, icons and noise', () => {
  it('maps causes to the three filters', () => {
    expect(['decline', 'cover', 'markCovered', 'makeUpTurnPaid', 'withdrawDecline'].map(activityKind)).toEqual(
      Array(5).fill('coverage'),
    );
    expect(activityKind('confirm')).toBe('confirm');
    expect(activityKind('requestConfirmation')).toBe('confirm');
    expect(activityKind('addSkipDate')).toBe('change');
    expect(activityKind('addTimeOff')).toBe('change');
    expect(activityKind('somethingNew')).toBe('change');
  });

  it('an icon per kind, with a fallback', () => {
    expect(activityIcon('decline')).toBe('repeat');
    expect(activityIcon('confirm')).toBe('checkCircle');
    expect(activityIcon('addSkipDate')).toBe('calX');
    expect(activityIcon('addMember')).toBe('userPlus');
    expect(activityIcon('unknown')).toBe('activity');
  });

  it('leaves out the schedule filling itself in and Events added by the daily job', () => {
    expect(isFeedWorthy({ cause: { type: 'fillSchedule' }, actorId: null })).toBe(false);
    expect(isFeedWorthy({ cause: { type: 'addEvents', events: [] }, actorId: null })).toBe(false);
    expect(isFeedWorthy({ cause: { type: 'addEvents', events: [] }, actorId: 'ana' })).toBe(true);
    expect(isFeedWorthy({ cause: { type: 'requestConfirmation', assignmentIds: ['a1'] }, actorId: null })).toBe(true);
  });

  it('filters parse from the URL', () => {
    expect(parseActivityFilter('coverage')).toBe('coverage');
    expect(parseActivityFilter('confirm')).toBe('confirm');
    expect(parseActivityFilter('change')).toBe('change');
    expect(parseActivityFilter(undefined)).toBe('all');
    expect(parseActivityFilter('bogus')).toBe('all');
  });
});

describe('unread', () => {
  const seen = '2026-11-18T10:00:00.000Z';
  it('newer than last seen and not my own action', () => {
    expect(isUnread({ at: '2026-11-18T11:00:00.000Z', actorId: 'ben' }, seen, 'ana')).toBe(true);
    expect(isUnread({ at: '2026-11-18T11:00:00.000Z', actorId: 'ana' }, seen, 'ana')).toBe(false);
    expect(isUnread({ at: '2026-11-18T09:00:00.000Z', actorId: 'ben' }, seen, 'ana')).toBe(false);
    expect(isUnread({ at: seen, actorId: 'ben' }, seen, 'ana')).toBe(false);
    expect(isUnread({ at: '2026-11-18T11:00:00.000Z', actorId: null }, seen, 'ana')).toBe(true);
  });

  it('nothing is unread before the first visit', () => {
    expect(isUnread({ at: '2026-11-18T11:00:00.000Z', actorId: 'ben' }, null, 'ana')).toBe(false);
  });

  it('counts across Groups with my Member id in each, skipping noise', () => {
    const later = '2026-11-18T11:00:00.000Z';
    const entries = [
      entry('1', later, { type: 'confirm', assignmentId: 'a1' }, 'ben', 'g1'),
      entry('2', later, { type: 'confirm', assignmentId: 'a1' }, 'm7', 'g2'), // mine in g2
      entry('3', later, { type: 'confirm', assignmentId: 'a1' }, 'ana', 'g2'), // someone else in g2
      entry('4', later, { type: 'fillSchedule' }, null, 'g1'),
      entry('5', '2026-11-18T09:00:00.000Z', { type: 'confirm', assignmentId: 'a1' }, 'ben', 'g1'),
    ];
    expect(unreadCount(entries, seen, { g1: 'ana', g2: 'm7' })).toBe(2);
    expect(unreadCount(entries, null, { g1: 'ana', g2: 'm7' })).toBe(0);
  });

  it('badge label', () => {
    expect(badgeLabel(0)).toBeNull();
    expect(badgeLabel(4)).toBe('4');
    expect(badgeLabel(100)).toBe('99+');
  });

  it('last seen only moves forward', () => {
    expect(laterOf(null, seen)).toBe(seen);
    expect(laterOf(seen, null)).toBe(seen);
    expect(laterOf(seen, '2026-11-17T00:00:00.000Z')).toBe(seen);
    expect(newestAt([])).toBeNull();
    expect(newestAt([{ at: '2026-11-17T00:00:00.000Z' }, { at: seen }])).toBe(seen);
  });
});

describe('last seen store', () => {
  function memory(initial: Record<string, string> = {}) {
    const data = { ...initial };
    const store: KeyValueStore = {
      getItem: async (k) => data[k] ?? null,
      setItem: async (k, v) => {
        data[k] = v;
      },
    };
    return { data, store };
  }

  it('loads per account, parses garbage as null, and saves forward moves only', async () => {
    const { data, store } = memory({ [lastSeenKey('u1')]: '2026-11-18T10:00:00.000Z', [lastSeenKey('u2')]: 'garbage' });
    const s = createLastSeenStore(store);
    expect(s.get('u1')).toBeUndefined();
    await s.load('u1');
    await s.load('u2');
    expect(s.get('u1')).toBe('2026-11-18T10:00:00.000Z');
    expect(s.get('u2')).toBeNull();
    let calls = 0;
    s.subscribe(() => calls++);
    await s.markSeen('u1', '2026-11-17T00:00:00.000Z');
    expect(s.get('u1')).toBe('2026-11-18T10:00:00.000Z');
    expect(calls).toBe(0);
    await s.markSeen('u1', '2026-11-19T00:00:00.000Z');
    expect(s.get('u1')).toBe('2026-11-19T00:00:00.000Z');
    expect(data[lastSeenKey('u1')]).toBe('2026-11-19T00:00:00.000Z');
    expect(calls).toBe(1);
  });

  it('storage failures are harmless', async () => {
    const s = createLastSeenStore({
      getItem: () => Promise.reject(new Error('no storage')),
      setItem: () => Promise.reject(new Error('no storage')),
    });
    await s.load('u');
    expect(s.get('u')).toBeNull();
    await s.markSeen('u', NOW);
    expect(s.get('u')).toBe(NOW);
    expect(parseLastSeen(null)).toBeNull();
  });
});

describe('days', () => {
  // NOW is Wednesday Nov 18, 2026; the week started Sunday Nov 15.
  const today = '2026-11-18';
  it('Today, Yesterday, Earlier this week, then dates (with the year when not this year)', () => {
    expect(dayLabel('2026-11-18', today)).toBe('Today');
    expect(dayLabel('2026-11-17', today)).toBe('Yesterday');
    expect(dayLabel('2026-11-16', today)).toBe('Earlier this week');
    expect(dayLabel('2026-11-15', today)).toBe('Earlier this week');
    expect(dayLabel('2026-11-14', today)).toBe('Sat, Nov 14');
    expect(dayLabel('2025-12-31', today)).toBe('Wed, Dec 31, 2025');
  });

  it('on a Monday, yesterday (Sunday) is "Yesterday" and nothing is "Earlier this week"', () => {
    expect(dayLabel('2026-11-15', '2026-11-16')).toBe('Yesterday');
    expect(dayLabel('2026-11-14', '2026-11-16')).toBe('Sat, Nov 14');
  });
});

describe('activityItems', () => {
  function built() {
    const b = buildGroup();
    const sound = seat(b.state, '2026-11-29', 'sound');
    run(b, { type: 'requestConfirmation', assignmentIds: [sound.id] }, 'ana');
    run(b, { type: 'confirm', assignmentId: sound.id }, 'ben');
    run(b, { type: 'decline', assignmentId: seat(b.state, '2026-12-06', 'sound').id }, 'cal');
    run(b, { type: 'addSkipDate', eventId: eventId('2027-01-10') }, 'ana');
    run(b, { type: 'fillSchedule' }, null);
    // The engine stamps entries with its clock; give them the times of a real week.
    const times: Record<string, string> = {
      requestConfirmation: '2026-11-16T15:00:00.000Z',
      confirm: '2026-11-17T20:00:00.000Z',
      decline: '2026-11-18T11:00:00.000Z',
      addSkipDate: '2026-11-18T11:30:00.000Z',
      fillSchedule: '2026-11-18T11:40:00.000Z',
    };
    const entries: FeedEntry[] = b.history
      .filter((h) => h.cause.type in times)
      .map((h) => ({ ...h, at: times[h.cause.type], groupId: 'g1' }));
    return { b, entries, sound };
  }

  it('newest first, described, with icon, tone, kind, "Group · time", noise left out', () => {
    const { b, entries } = built();
    const items = activityItems(entries, [asGroup(b.state)], { now: NOW, viewerTimeZone: ZONE, lastSeenAt: '2026-11-17T00:00:00.000Z' });
    expect(items.map((i) => i.kind)).toEqual(['change', 'coverage', 'confirm', 'confirm']);
    const [skip, decline, confirm] = items;
    expect(skip.text).toMatch(/^You marked Sun, Jan 10 as a Skip Date/);
    expect(skip.icon).toBe('calX');
    expect(skip.unread).toBe(false); // my own
    expect(decline.text).toBe("Cal can't make Sound on Sun, Dec 6. Coverage requested.");
    expect(decline.tone).toBe('bad');
    expect(decline.meta).toBe('Sunday Team · 5:00 AM');
    expect(decline.unread).toBe(true);
    expect(confirm.text).toBe('Ben confirmed Sound on Sun, Nov 29.');
    expect(confirm.tone).toBe('ok');
    expect(confirm.unread).toBe(true);
    // Before last seen.
    expect(items[3].unread).toBe(false);
    // "Earlier this week" items carry the weekday.
    expect(items[3].meta).toBe('Sunday Team · Mon 9:00 AM');
  });

  it('leaves out Groups I’m not in and duplicates', () => {
    const { b, entries } = built();
    const items = activityItems([...entries, ...entries, { ...entries[0], groupId: 'gone' }], [asGroup(b.state)], {
      now: NOW,
      viewerTimeZone: ZONE,
      lastSeenAt: null,
    });
    expect(items).toHaveLength(4);
    expect(items.every((i) => !i.unread)).toBe(true);
  });

  it('filters and day sections', () => {
    const { b, entries } = built();
    const items = activityItems(entries, [asGroup(b.state)], { now: NOW, viewerTimeZone: ZONE, lastSeenAt: null });
    expect(filterActivity(items, 'all')).toHaveLength(4);
    expect(filterActivity(items, 'coverage')).toHaveLength(1);
    expect(filterActivity(items, 'confirm')).toHaveLength(2);
    expect(filterActivity(items, 'change')).toHaveLength(1);
    const sections = groupActivityByDay(items, NOW, ZONE);
    expect(sections.map((s) => [s.label, s.items.length])).toEqual([
      ['Today', 2],
      ['Yesterday', 1],
      ['Earlier this week', 1],
    ]);
  });

  it('targets: the Assignment it’s about, or the Group', () => {
    const { b, entries, sound } = built();
    const g = asGroup(b.state);
    const byType = (t: string) => entries.find((e) => e.cause.type === t)!;
    expect(activityTarget(byType('confirm'), g)).toEqual({ kind: 'assignment', groupId: 'g1', assignmentId: sound.id });
    expect(activityTarget(byType('requestConfirmation'), g)).toEqual({ kind: 'assignment', groupId: 'g1', assignmentId: sound.id });
    expect(activityTarget(byType('addSkipDate'), g)).toEqual({ kind: 'group', groupId: 'g1' });
    // An Assignment no longer on the schedule opens the Group.
    const gone = { ...byType('confirm'), cause: { type: 'confirm', assignmentId: 'nope' } as Cause };
    expect(activityTarget(gone, g)).toEqual({ kind: 'group', groupId: 'g1' });
  });
});
