import { describe, expect, it } from 'vitest';

import { createGroupState, type Assignment } from '../../engine';
import {
  dayItems,
  displayStatus,
  eventViews,
  findSlot,
  groupByWeek,
  monthBounds,
  monthDays,
  monthGrid,
  nextEvent,
  scheduleItems,
  shiftMonth,
  slotStatus,
  slotView,
  weekLabel,
  weekRange,
  weekStart,
  whoLabel,
  type ScheduleGroup,
} from '../views';
import { asGroup, buildGroup, eventId, NOW, run, seat, ZONE } from './fixture';

const base: Assignment = {
  id: 'a1',
  eventId: 'e1',
  responsibilityId: 'sound',
  memberId: 'ana',
  turnOf: 'ana',
  makeUpTurnId: null,
  confirmation: 'notRequired',
  coverageRequest: null,
};
const EVENT_AT = '2026-11-29T15:00:00.000Z';

describe('slotStatus (via the engine assignmentStatus)', () => {
  it('Confirmed', () => {
    expect(slotStatus({ ...base, confirmation: 'confirmed' }, EVENT_AT, NOW)).toBe('confirmed');
  });
  it('Pending when confirmation was requested', () => {
    expect(slotStatus({ ...base, confirmation: 'requested' }, EVENT_AT, NOW)).toBe('pending');
  });
  it('Pending (not "Unconfirmed") once the alert lead time has come', () => {
    const late = '2026-11-28T00:00:00.000Z';
    expect(slotStatus({ ...base, confirmation: 'notYetRequested' }, EVENT_AT, late)).toBe('pending');
    expect(displayStatus('unconfirmed')).toBe('pending');
  });
  it('Scheduled when confirmation is not needed or not asked for yet', () => {
    expect(slotStatus(base, EVENT_AT, NOW)).toBe('scheduled');
    expect(slotStatus({ ...base, confirmation: 'notYetRequested' }, EVENT_AT, NOW)).toBe('scheduled');
  });
  it('Needs coverage for a Coverage Request without a Cover', () => {
    const declined = { ...base, coverageRequest: { reason: 'declined' as const, requestedBy: 'ana', requestedAt: NOW, cover: null } };
    expect(slotStatus(declined, EVENT_AT, NOW)).toBe('needsCoverage');
    const open = { ...base, memberId: null, coverageRequest: { reason: 'noOneAvailable' as const, requestedBy: null, requestedAt: NOW, cover: null } };
    expect(slotStatus(open, EVENT_AT, NOW)).toBe('needsCoverage');
  });
  it('Covered once someone covers, until the coverer is asked to confirm', () => {
    const cover = { kind: 'member' as const, memberId: 'ben', arrangedBy: 'ben', coveredAt: NOW };
    const covered = {
      ...base,
      memberId: 'ben',
      confirmation: 'confirmed' as const,
      coverageRequest: { reason: 'declined' as const, requestedBy: 'ana', requestedAt: NOW, cover },
    };
    expect(slotStatus(covered, EVENT_AT, NOW)).toBe('covered');
    expect(slotStatus({ ...covered, confirmation: 'requested' }, EVENT_AT, NOW)).toBe('pending');
  });
});

describe('slotView: who fills a seat', () => {
  const built = buildGroup();
  const ana = seat(built.state, '2026-11-22', 'sound');
  run(built, { type: 'decline', assignmentId: ana.id }, 'ana');
  run(built, { type: 'cover', assignmentId: ana.id }, 'ben');
  const greeter = seat(built.state, '2026-11-29', 'greeter');
  const greeterName = built.state.members.find((m) => m.id === greeter.memberId)!.name;
  run(built, { type: 'decline', assignmentId: greeter.id }, greeter.memberId);
  run(built, { type: 'markCovered', assignmentId: greeter.id, by: { guestName: 'Jo' } }, 'ana');
  const benSound = seat(built.state, '2026-12-06', 'sound');
  const benId = benSound.memberId!;
  run(built, { type: 'decline', assignmentId: benSound.id }, benId);

  it('shows the coverer and whose turn it was', () => {
    const g = asGroup(built.state);
    const a = built.state.assignments.find((x) => x.id === ana.id)!;
    const v = slotView(g, a, '2026-11-22T15:00:00.000Z', NOW);
    expect(v.who).toEqual({ kind: 'member', memberId: 'ben', name: 'Ben', isMe: false });
    expect(v.whoLabel).toBe('Ben');
    expect(v.coveredFor).toBe('you');
    expect(v.status).toBe('covered');
    expect(v.mine).toBe(false);
    expect(v.covering).toBe(false);
    // Seen by Ben: he is covering.
    const asBen = slotView(asGroup(built.state, 'ben'), a, '2026-11-22T15:00:00.000Z', NOW);
    expect(asBen.whoLabel).toBe('You');
    expect(asBen.mine).toBe(true);
    expect(asBen.covering).toBe(true);
    expect(asBen.coveredFor).toBe('Ana');
  });

  it('labels a Guest Cover "Name (guest)"', () => {
    const a = built.state.assignments.find((x) => x.id === greeter.id)!;
    const v = slotView(asGroup(built.state), a, '2026-11-29T15:00:00.000Z', NOW);
    expect(v.who).toEqual({ kind: 'guest', name: 'Jo' });
    expect(v.whoLabel).toBe('Jo (guest)');
    expect(v.coveredFor).toBe(greeterName);
    expect(v.status).toBe('covered');
  });

  it('keeps a Coverage Request with the Member who asked', () => {
    const a = built.state.assignments.find((x) => x.id === benSound.id)!;
    const v = slotView(asGroup(built.state, benId), a, '2026-12-06T15:00:00.000Z', NOW);
    expect(v.status).toBe('needsCoverage');
    expect(v.mine).toBe(true);
    expect(v.requestedBy).toBe('you');
    expect(v.whoLabel).toBe('Open');
    expect(slotView(asGroup(built.state, 'ana'), a, '2026-12-06T15:00:00.000Z', NOW).requestedBy).not.toBe('you');
  });

  it('marks a Make-up Turn', () => {
    const paying = built.state.assignments.find((a) => a.makeUpTurnId !== null)!;
    const event = built.state.events.find((e) => e.id === paying.eventId)!;
    expect(slotView(asGroup(built.state), paying, event.startsAt, NOW).makeUpTurn).toBe(true);
  });

  it('says "Open" for an empty seat', () => {
    expect(whoLabel({ kind: 'open' })).toBe('Open');
  });
});

describe('eventViews and scheduleItems', () => {
  const built = buildGroup();
  run(built, { type: 'addSkipDate', eventId: eventId('2026-12-06') }, 'ben');
  const group = asGroup(built.state);

  it('lists Events from today on, with rows in fill order', () => {
    const events = eventViews([group], NOW, ZONE);
    expect(events[0].date).toBe('2026-11-22');
    expect(events[0].slots.map((s) => s.responsibilityName)).toEqual(['Sound', 'Greeter']);
    expect(events[0].mine).toBe(true);
    expect(events[0].seriesName).toBe('Sunday gathering');
    expect(eventViews([group], NOW, ZONE, '2026-12-01')[0].date).toBe('2026-12-06');
  });

  it('draws a Skip Date with who marked it and no rows', () => {
    const skip = eventViews([group], NOW, ZONE).find((e) => e.date === '2026-12-06')!;
    expect(skip.skipDate).toEqual({ markedBy: 'Ben' });
    expect(skip.slots).toEqual([]);
  });

  it('"Just me" shows my Assignments plus Skip Dates; "Everyone" one card per Event', () => {
    const events = eventViews([group], NOW, ZONE);
    const mine = scheduleItems(events, 'me');
    expect(mine.every((i) => i.kind === 'skip' || (i.kind === 'slot' && i.slot.mine))).toBe(true);
    expect(mine.filter((i) => i.kind === 'skip')).toHaveLength(1);
    expect(mine.filter((i) => i.kind === 'slot').length).toBeGreaterThan(0);
    const all = scheduleItems(events, 'everyone');
    expect(all.filter((i) => i.kind === 'event')).toHaveLength(events.length - 1);
  });

  it('merges Groups in time order, Skip Dates after other cards on the same day', () => {
    const other = createGroupState({
      groupId: 'g2',
      members: [{ id: 'm1', name: 'Me', accountId: 'x' }],
      responsibilities: [],
      eventSeries: [],
      events: [
        { id: 'early', seriesId: null, startsAt: '2026-12-06T14:00:00.000Z', responsibilityIds: [] },
      ],
    });
    const g2: ScheduleGroup = { id: 'g2', name: 'Hosts', timeZone: ZONE, state: other, myMemberId: 'm1' };
    const items = scheduleItems(eventViews([group, g2], NOW, ZONE), 'everyone').filter((i) => i.date === '2026-12-06');
    expect(items.map((i) => i.kind)).toEqual(['event', 'skip']);
  });

  it('finds one Assignment with its Event, and the next Event', () => {
    const a = seat(built.state, '2026-11-29', 'greeter');
    const found = findSlot(group, a.id, NOW, ZONE)!;
    expect(found.event.date).toBe('2026-11-29');
    expect(found.slot.responsibilityName).toBe('Greeter');
    expect(findSlot(group, 'missing', NOW, ZONE)).toBeNull();
    expect(nextEvent(group, NOW, ZONE)?.date).toBe('2026-11-22');
    expect(nextEvent(group, '2026-12-01T00:00:00.000Z', ZONE)?.date).toBe('2026-12-13');
  });
});

describe('weeks', () => {
  it('start on Sunday', () => {
    expect(weekStart('2026-11-18')).toBe('2026-11-15');
    expect(weekStart('2026-11-15')).toBe('2026-11-15');
    expect(weekStart('2026-11-21')).toBe('2026-11-15');
  });

  it('are labelled This week, Next week, Week of …', () => {
    const today = '2026-11-18';
    expect(weekLabel('2026-11-15', today)).toBe('This week');
    expect(weekLabel('2026-11-22', today)).toBe('Next week');
    expect(weekLabel('2026-12-06', today)).toBe('Week of Dec 6');
    expect(weekRange('2026-12-06')).toBe('Dec 6 – Dec 12');
  });

  it('cross the year boundary', () => {
    const today = '2026-12-20';
    expect(weekLabel('2026-12-27', today)).toBe('Next week');
    expect(weekRange('2026-12-27')).toBe('Dec 27 – Jan 2');
    expect(weekLabel('2027-01-03', today)).toBe('Week of Jan 3, 2027');
    const weeks = groupByWeek(
      [{ date: '2027-01-01' }, { date: '2026-12-28' }, { date: '2027-01-03' }],
      today,
    );
    expect(weeks.map((w) => [w.key, w.items.length])).toEqual([
      ['2026-12-27', 2],
      ['2027-01-03', 1],
    ]);
  });

  it('use the viewer\'s local date across the autumn DST change', () => {
    // Sun Nov 1, 2026, 00:30 CDT (UTC-5) is 05:30 UTC. Read with the later CST offset it would
    // fall on Saturday Oct 31, the previous week.
    const group = asGroup(
      createGroupState({
        groupId: 'dst',
        members: [{ id: 'm', name: 'M', accountId: 'a' }],
        responsibilities: [],
        eventSeries: [],
        events: [
          { id: 'late', seriesId: null, startsAt: '2026-11-01T05:30:00.000Z', responsibilityIds: [] },
          { id: 'next', seriesId: null, startsAt: '2026-11-08T06:30:00.000Z', responsibilityIds: [] },
        ],
      }),
      'm',
    );
    const events = eventViews([group], '2026-10-28T12:00:00.000Z', ZONE);
    expect(events.map((e) => e.date)).toEqual(['2026-11-01', '2026-11-08']);
    const weeks = groupByWeek(scheduleItems(events, 'everyone'), '2026-10-28');
    expect(weeks.map((w) => [w.key, w.label])).toEqual([
      ['2026-11-01', 'Next week'],
      ['2026-11-08', 'Week of Nov 8'],
    ]);
  });

  it('and across the spring DST change', () => {
    // Sun Mar 14, 2027 at 3:30 AM CDT is 08:30 UTC; Sat Mar 13 at 11:30 PM CST is 05:30 UTC.
    const group = asGroup(
      createGroupState({
        groupId: 'dst2',
        members: [{ id: 'm', name: 'M', accountId: 'a' }],
        responsibilities: [],
        eventSeries: [],
        events: [
          { id: 'sat', seriesId: null, startsAt: '2027-03-14T05:30:00.000Z', responsibilityIds: [] },
          { id: 'sun', seriesId: null, startsAt: '2027-03-14T08:30:00.000Z', responsibilityIds: [] },
        ],
      }),
      'm',
    );
    const events = eventViews([group], '2027-03-10T12:00:00.000Z', ZONE);
    expect(events.map((e) => e.date)).toEqual(['2027-03-13', '2027-03-14']);
    expect(groupByWeek(scheduleItems(events, 'everyone'), '2027-03-10').map((w) => w.label)).toEqual([
      'This week',
      'Next week',
    ]);
  });
});

describe('month', () => {
  it('grids whole weeks from Sunday', () => {
    const nov = monthGrid('2026-11');
    expect(nov[0]).toEqual({ date: '2026-11-01', inMonth: true });
    expect(nov).toHaveLength(35);
    expect(nov[nov.length - 1]).toEqual({ date: '2026-12-05', inMonth: false });
    const jan = monthGrid('2027-01');
    expect(jan[0]).toEqual({ date: '2026-12-27', inMonth: false });
    expect(jan).toHaveLength(42);
    expect(monthGrid('2026-02')).toHaveLength(28);
  });

  it('shifts months across years', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2027-01', -1)).toBe('2026-12');
    expect(shiftMonth('2026-11', 14)).toBe('2028-01');
  });

  it('marks my days, Skip Dates, today and a dot per Group', () => {
    const built = buildGroup();
    run(built, { type: 'addSkipDate', eventId: eventId('2026-12-06') }, 'ana');
    const events = eventViews([asGroup(built.state)], NOW, ZONE);
    const mine = monthDays(events, 'me', '2026-11', '2026-11-18');
    const byDate = (d: string) => mine.find((c) => c.date === d)!;
    expect(byDate('2026-11-18').isToday).toBe(true);
    expect(byDate('2026-11-22')).toMatchObject({ mine: true, groupIds: ['g1'], skipOnly: false });
    // Ben serves Sound on the 29th, Cal greets: nothing of mine, so no dot in "Just me".
    expect(byDate('2026-11-29')).toMatchObject({ mine: false, groupIds: [] });
    const everyone = monthDays(events, 'everyone', '2026-11', '2026-11-18');
    expect(everyone.find((c) => c.date === '2026-11-29')!.groupIds).toEqual(['g1']);
    const dec = monthDays(events, 'everyone', '2026-12', '2026-11-18');
    expect(dec.find((c) => c.date === '2026-12-06')).toMatchObject({ skipOnly: true, groupIds: [] });
  });

  it('lists one day, and bounds navigation by the last Event', () => {
    const built = buildGroup();
    const events = eventViews([asGroup(built.state)], NOW, ZONE);
    expect(dayItems(events, 'everyone', '2026-11-22')).toHaveLength(1);
    expect(dayItems(events, 'me', '2026-11-22').map((i) => i.kind)).toEqual(['slot']);
    expect(dayItems(events, 'me', '2026-11-23')).toEqual([]);
    expect(monthBounds(events, '2026-11-18')).toEqual({ first: '2026-11', last: '2027-01' });
    expect(monthBounds([], '2026-11-18')).toEqual({ first: '2026-11', last: '2026-11' });
  });
});
