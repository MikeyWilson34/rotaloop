import { describe, expect, it } from 'vitest';

import type { Cause, HistoryEntry } from '../../engine';
import {
  assignmentHistory,
  describeAssignmentChange,
  describeHistoryEntry,
  historyLines,
  movedNotice,
  type HistoryContext,
  type HistoryRecord,
} from '../history';
import { buildGroup, eventId, NOW, run, seat, ZONE, type Built } from './fixture';

const LATER = '2026-11-23T12:00:00.000Z';

/** Runs a story through the engine that emits every kind of history entry. */
function story(): Built {
  const b = buildGroup();
  // Coverage: Ana declines, Ben covers (Pay It Back: Ana owes Ben); a Guest Cover.
  const ana = seat(b.state, '2026-11-22', 'sound');
  run(b, { type: 'decline', assignmentId: ana.id }, 'ana');
  run(b, { type: 'cover', assignmentId: ana.id }, 'ben');
  const greeter = seat(b.state, '2026-12-13', 'greeter');
  run(b, { type: 'decline', assignmentId: greeter.id }, 'ana');
  run(b, { type: 'markCovered', assignmentId: greeter.id, by: { guestName: 'Jo' } }, 'ana');
  const g2 = seat(b.state, '2026-12-20', 'greeter');
  run(b, { type: 'decline', assignmentId: g2.id }, 'ana');
  const seated = new Set(b.state.assignments.filter((a) => a.eventId === g2.eventId).map((a) => a.memberId));
  const other = ['pat', 'ben', 'cal', 'ana'].find((m) => !seated.has(m))!;
  run(b, { type: 'markCovered', assignmentId: g2.id, by: { memberId: other } }, 'ana');
  // Confirmation.
  const cal = seat(b.state, '2026-12-06', 'sound');
  run(b, { type: 'requestConfirmation', assignmentIds: [cal.id] }, null);
  run(b, { type: 'confirm', assignmentId: cal.id }, 'cal');
  // Skip Dates.
  run(b, { type: 'addSkipDate', eventId: eventId('2027-01-03') }, 'ben');
  run(b, { type: 'removeSkipDate', eventId: eventId('2027-01-03') }, 'ana');
  // Time Off.
  run(b, {
    type: 'addTimeOff',
    timeOff: { id: 'off1', memberId: 'cal', startsAt: '2026-12-26T06:00:00.000Z', endsAt: '2026-12-28T06:00:00.000Z' },
  }, 'cal');
  run(b, { type: 'removeTimeOff', timeOffId: 'off1' }, 'ana');
  // Members.
  run(b, { type: 'addMember', member: { id: 'dee', name: 'Dee', accountId: null } }, 'ana');
  run(b, { type: 'addMember', member: { id: 'eve', name: 'Eve', accountId: 'acct-eve' } }, 'eve');
  run(b, { type: 'qualifyMember', memberId: 'dee', responsibilityId: 'sound' }, 'ana');
  run(b, { type: 'unqualifyMember', memberId: 'dee', responsibilityId: 'sound' }, 'ana');
  run(b, { type: 'renameMember', memberId: 'dee', name: 'Deb' }, 'ana');
  run(b, { type: 'renameMember', memberId: 'eve', name: 'Evie' }, 'eve');
  run(b, { type: 'setAdmin', memberId: 'ben', isAdmin: true }, 'ana');
  run(b, { type: 'setAdmin', memberId: 'ben', isAdmin: false }, 'ben');
  run(b, { type: 'claimPlaceholder', memberId: 'dee', accountId: 'acct-dee' }, null);
  run(b, { type: 'removeMember', memberId: 'dee' }, 'ana');
  run(b, { type: 'removeMember', memberId: 'eve' }, 'eve');
  // Responsibilities.
  run(b, { type: 'addResponsibility', responsibility: { id: 'host', name: 'Host', headcount: 1, requiresConfirmation: false } }, 'ana');
  run(b, { type: 'editResponsibility', responsibilityId: 'host', changes: { headcount: 2, requiresConfirmation: true } }, 'ana');
  run(b, { type: 'setPrimaryResponsibility', responsibilityId: 'sound' }, 'ana');
  run(b, { type: 'setPrimaryResponsibility', responsibilityId: null }, 'ana');
  run(b, { type: 'reorderResponsibilities', responsibilityIds: ['greeter', 'sound', 'host'] }, 'ana');
  run(b, { type: 'removeResponsibility', responsibilityId: 'host' }, 'ana');
  run(b, { type: 'reorderQueue', responsibilityId: 'sound', queue: ['cal', 'ana', 'ben'] }, 'ana');
  // Events.
  run(b, {
    type: 'addEventSeries',
    series: { id: 'sat', name: 'Saturday prep', responsibilityIds: ['greeter'] },
    events: [{ id: 'sat@1', seriesId: 'sat', startsAt: '2026-11-28T15:00:00.000Z' }],
  }, 'ana');
  run(b, { type: 'editEventSeries', seriesId: 'sat', changes: { name: 'Prep' } }, 'ana');
  run(b, { type: 'removeEventSeries', seriesId: 'sat' }, 'ana');
  run(b, { type: 'addEvents', events: [{ id: 'once', seriesId: null, startsAt: '2026-12-31T23:00:00.000Z', responsibilityIds: ['greeter'] }] }, 'ana');
  run(b, { type: 'removeEvent', eventId: 'once' }, 'ana');
  run(b, { type: 'fillSchedule' }, null);
  // Settings, then time passes so Ana's Make-up Turn is paid, then a Rebalance.
  run(b, { type: 'changeSettings', settings: { replacementDuty: 'admins', replacementDeadlineMs: 2 * 86_400_000 } }, 'ana');
  const paying = b.state.assignments.find((a) => a.makeUpTurnId !== null)!;
  const payAt = b.state.events.find((e) => e.id === paying.eventId)!.startsAt;
  run(b, { type: 'rebalance', responsibilityId: 'sound' }, 'ana', new Date(Date.parse(payAt) + 3_600_000).toISOString());
  run(b, { type: 'changeSettings', settings: { coveragePolicy: 'countRealWork' } }, 'ana', LATER);
  return b;
}

const ALL_CAUSES: Cause['type'][] = [
  'fillSchedule', 'addEvents', 'addSkipDate', 'removeSkipDate', 'addTimeOff', 'removeTimeOff',
  'requestConfirmation', 'confirm', 'decline', 'cover', 'markCovered', 'changeSettings', 'rebalance',
  'addMember', 'qualifyMember', 'unqualifyMember', 'removeMember', 'claimPlaceholder', 'renameMember',
  'setAdmin', 'addResponsibility', 'editResponsibility', 'removeResponsibility', 'reorderResponsibilities',
  'setPrimaryResponsibility', 'reorderQueue', 'addEventSeries', 'editEventSeries', 'removeEventSeries',
  'removeEvent', 'makeUpTurnPaid',
];

describe('describeHistoryEntry', () => {
  const b = story();
  const ctx: HistoryContext = { state: b.state, myMemberId: 'ana', timeZone: ZONE };
  const lines = b.history.map((e) => ({ type: e.cause.type, actor: e.actorId, ...describeHistoryEntry(e, ctx) }));
  const texts = (type: Cause['type']) => lines.filter((l) => l.type === type).map((l) => l.text);
  const first = (type: Cause['type']) => lines.find((l) => l.type === type)!;

  it('covers every kind of entry the engine emits', () => {
    expect(new Set(lines.map((l) => l.type))).toEqual(new Set(ALL_CAUSES));
    for (const line of lines) {
      expect(line.text).toMatch(/^[A-Z].*\.$/);
      expect(line.text).not.toMatch(/undefined|null|\[object/);
      if (line.detail) expect(line.detail).not.toMatch(/undefined|null|\[object/);
    }
  });

  it('describes Events being added', () => {
    expect(texts('addEvents')[0]).toBe('You added 8 Events.');
    expect(first('addEvents').detail).toBe('16 Assignments changed.');
    expect(texts('fillSchedule')).toEqual(['The schedule was filled from the Rotations.']);
  });

  it('describes coverage, with the Make-up Turn it creates', () => {
    expect(texts('decline')[0]).toBe("You can't make Sound on Sun, Nov 22. Coverage requested.");
    expect(first('decline').tone).toBe('bad');
    // An Admin declining for someone else names them.
    expect(texts('decline')[1]).toMatch(/^You said (Pat|Ben|Cal) can't make Greeter on Sun, Dec 13. Coverage requested.$/);
    expect(texts('cover')).toEqual(['Ben covered Sound on Sun, Nov 22 for you.']);
    expect(first('cover').detail).toBe('You owe Ben a Sound Make-up Turn.');
    expect(texts('markCovered')[0]).toBe('You marked Greeter on Sun, Dec 13 covered by Jo (guest).');
    expect(texts('markCovered')[1]).toMatch(/^You marked Greeter on Sun, Dec 20 covered by (Ben|Pat|Cal)\.$/);
  });

  it('describes confirmation', () => {
    expect(texts('requestConfirmation')).toEqual(['An Assignment was asked to confirm.']);
    expect(texts('confirm')).toEqual(['Cal confirmed Sound on Sun, Dec 6.']);
    expect(first('confirm').tone).toBe('ok');
  });

  it('describes Skip Dates and Time Off', () => {
    expect(texts('addSkipDate')).toEqual(['Ben marked Sun, Jan 3 as a Skip Date. Turns move forward one Event.']);
    expect(texts('removeSkipDate')).toEqual(['You removed the Skip Date on Sun, Jan 3. The Rotation is restored.']);
    expect(texts('addTimeOff')).toEqual(['Cal added Time Off (Dec 26 – Dec 27).']);
    expect(texts('removeTimeOff')).toEqual(['You removed Time Off for Cal.']);
  });

  it('describes membership', () => {
    expect(texts('addMember')).toEqual(['You added Dee as a Placeholder Member.', 'Eve joined the group.']);
    expect(texts('qualifyMember')).toEqual(['You made Deb a Qualified Member for Sound.']);
    expect(texts('unqualifyMember')).toEqual(['You took Deb out of the Sound Rotation.']);
    expect(texts('renameMember')).toEqual(['You renamed a Member to Deb.', 'Evie changed their name.']);
    expect(texts('setAdmin')).toEqual(['You made Ben an Admin.', 'Ben stepped down as Admin.']);
    expect(texts('claimPlaceholder')).toEqual(['Deb joined and took their place in the Rotations.']);
    expect(texts('removeMember')).toEqual([
      'You removed Deb from the group. Their future turns moved to others.',
      'Evie left the group. Their future turns moved to others.',
    ]);
  });

  it('describes Responsibilities and Rotations', () => {
    expect(texts('addResponsibility')).toEqual(['You added the Responsibility Host.']);
    expect(texts('editResponsibility')).toEqual(['You changed Host: set it to 2 people per Event and turned on confirmation.']);
    expect(texts('setPrimaryResponsibility')).toEqual([
      'You made Sound the Primary Responsibility.',
      'You cleared the Primary Responsibility.',
    ]);
    expect(texts('reorderResponsibilities')).toEqual(['You changed the order Responsibilities are filled in.']);
    expect(texts('removeResponsibility')).toEqual(['You removed the Responsibility Host.']);
    expect(texts('reorderQueue')).toEqual(['You reordered the Sound Rotation.']);
    expect(texts('rebalance')).toEqual(['You rebalanced the Sound Rotation by workload.']);
  });

  it('describes Event Series and one-off Events', () => {
    expect(texts('addEventSeries')).toEqual(['You added the Event Series Saturday prep (1 Event).']);
    expect(texts('editEventSeries')).toEqual(['You changed the Event Series Prep.']);
    expect(texts('removeEventSeries')).toEqual(['You removed the Event Series Prep.']);
    expect(texts('removeEvent')).toEqual(['You removed the Event.']);
  });

  it('describes settings and Make-up Turns being paid or cancelled', () => {
    expect(texts('changeSettings')).toEqual([
      'You changed Replacement Duty to Admins and "Find a replacement by" to 2 days before.',
      'You changed the Coverage Policy to Count Real Work.',
    ]);
    expect(texts('makeUpTurnPaid')).toEqual(['You paid back the Sound Make-up Turn owed to Ben.']);
    expect(first('makeUpTurnPaid').tone).toBe('ok');
  });

  it('describes a system entry and an unknown cause plainly', () => {
    const entry: HistoryEntry = {
      at: NOW,
      actorId: null,
      cause: { type: 'addEvents', events: [{ id: 'x', seriesId: 'sun', startsAt: NOW }] },
      changes: [],
      makeUpTurns: [],
    };
    expect(describeHistoryEntry(entry, ctx)).toEqual({ text: '1 new Event added to the schedule.', detail: null, tone: 'neutral' });
    const odd = { ...entry, cause: { type: 'somethingNew' } as unknown as Cause };
    expect(describeHistoryEntry(odd, ctx).text).toBe('The schedule changed.');
  });

  it('lists newest first', () => {
    const list = historyLines(b.history, ctx);
    expect(list[0].text).toBe('You changed the Coverage Policy to Count Real Work.');
    expect(list[list.length - 1].text).toBe('You added 8 Events.');
  });
});

describe('one Assignment\'s history', () => {
  it('tells its story oldest first', () => {
    const b = buildGroup();
    const a = seat(b.state, '2026-11-22', 'sound');
    run(b, { type: 'decline', assignmentId: a.id }, 'ana');
    run(b, { type: 'cover', assignmentId: a.id }, 'ben');
    const ctx: HistoryContext = { state: b.state, myMemberId: 'ana', timeZone: ZONE };
    const lines = assignmentHistory(b.history, a.id, ctx);
    expect(lines.map((l) => l.text)).toEqual([
      'Assigned to you by Rotation',
      "You can't make it. Needs coverage",
      'Covered by Ben',
    ]);
    expect(lines[0].detail).toBe('You added 8 Events.');
    expect(lines[2].detail).toBe('Ben covered Sound on Sun, Nov 22 for you.');
    expect(lines.map((l) => l.tone)).toEqual(['neutral', 'bad', 'info']);
  });

  it('includes a Make-up Turn being placed and paid', () => {
    const b = buildGroup();
    const a = seat(b.state, '2026-11-22', 'sound');
    run(b, { type: 'decline', assignmentId: a.id }, 'ana');
    run(b, { type: 'cover', assignmentId: a.id }, 'ben');
    const paying = b.state.assignments.find((x) => x.makeUpTurnId !== null)!;
    const payAt = b.state.events.find((e) => e.id === paying.eventId)!.startsAt;
    run(b, { type: 'fillSchedule' }, null, new Date(Date.parse(payAt) + 3_600_000).toISOString());
    const ctx: HistoryContext = { state: b.state, myMemberId: 'ana', timeZone: ZONE };
    const lines = assignmentHistory(b.history, paying.id, ctx);
    expect(lines.some((l) => l.text === 'Make-up Turn paid')).toBe(true);
    expect(lines.some((l) => /Make-up Turn|Reassigned/.test(l.text))).toBe(true);
  });

  it('notices a move to another date', () => {
    const b = buildGroup();
    const a = seat(b.state, '2026-11-29', 'sound');
    run(b, { type: 'addSkipDate', eventId: eventId('2026-11-29') }, 'cal');
    const ctx: HistoryContext = { state: b.state, myMemberId: 'ana', timeZone: ZONE };
    expect(movedNotice(b.history, a.id, ctx)).toBe(
      'Moved from Sun, Nov 29 to Sun, Dec 6. Cal marked Sun, Nov 29 as a Skip Date. Turns move forward one Event.',
    );
    const never = seat(b.state, '2026-11-22', 'sound');
    expect(movedNotice(b.history, never.id, ctx)).toBeNull();
  });

  it('describes each kind of change to an Assignment', () => {
    const b = buildGroup();
    const ctx: HistoryContext = { state: b.state, myMemberId: 'ana', timeZone: ZONE };
    const a = seat(b.state, '2026-11-22', 'sound');
    const d = (before: typeof a | null, after: typeof a | null) =>
      describeAssignmentChange({ assignmentId: a.id, before, after, reason: { type: 'fillSchedule' } }, ctx).text;
    const request = { reason: 'declined' as const, requestedBy: 'ana', requestedAt: NOW, cover: null };
    expect(d(null, { ...a, memberId: null })).toBe('Added. No one was available yet');
    expect(d(null, { ...a, makeUpTurnId: 'm1' })).toBe('Assigned to you as a Make-up Turn');
    expect(d(a, null)).toBe('Removed from the schedule');
    expect(d(a, { ...a, memberId: 'ben' })).toBe('Reassigned from you to Ben');
    expect(d(a, { ...a, confirmation: 'confirmed' })).toBe('Confirmed by you');
    expect(d(a, { ...a, confirmation: 'requested' })).toBe('You asked to confirm');
    expect(d(a, { ...a, coverageRequest: { ...request, reason: 'timeOff' } })).toBe('You are on Time Off. Needs coverage');
    expect(d(a, { ...a, coverageRequest: { ...request, reason: 'noOneAvailable', requestedBy: null } })).toBe(
      'No one available. Needs coverage',
    );
    const covered = { ...a, coverageRequest: { ...request, cover: { kind: 'guest' as const, guestName: 'Jo', arrangedBy: 'ana', coveredAt: NOW } } };
    expect(d({ ...a, coverageRequest: request }, covered)).toBe('Covered by Jo (guest)');
    expect(d(covered, { ...a, coverageRequest: request })).toBe('Cover withdrawn. Needs coverage again');
    expect(d({ ...a, coverageRequest: request }, a)).toBe('Back with you');
    expect(d(a, { ...a, makeUpTurnId: 'm1' })).toBe('Now a Make-up Turn');
    expect(d(a, a)).toBe('Updated');
  });

  it('keeps entries in id order when they share a time', () => {
    const records: HistoryRecord[] = [
      { id: '2', at: NOW, actorId: null, cause: { type: 'fillSchedule' }, changes: [], makeUpTurns: [] },
      { id: '10', at: NOW, actorId: null, cause: { type: 'addEvents', events: [] }, changes: [], makeUpTurns: [] },
    ];
    const ctx: HistoryContext = { state: buildGroup().state, myMemberId: null, timeZone: ZONE };
    expect(historyLines(records, ctx).map((l) => l.key)).toEqual(['10', '2']);
  });
});
