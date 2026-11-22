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
  run(b, { type: 'decline', assignmentId: g2.id }, g2.memberId);
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
  run(b, { type: 'removeTimeOff', timeOffId: 'off1' }, 'cal');
  // Members.
  run(b, { type: 'addMember', member: { id: 'dee', name: 'Dee', accountId: null } }, 'ana');
  run(b, { type: 'addMember', member: { id: 'eve', name: 'Eve', accountId: 'acct-eve' } }, 'eve');
  run(b, { type: 'qualifyMember', memberId: 'dee', responsibilityId: 'sound' }, 'ana');
  run(b, { type: 'unqualifyMember', memberId: 'dee', responsibilityId: 'sound' }, 'ana');
  run(b, { type: 'renameMember', memberId: 'dee', name: 'Deb' }, 'ana');
  run(b, { type: 'renameMember', memberId: 'eve', name: 'Evie' }, 'eve');
  run(b, { type: 'setAdmin', memberId: 'ben', isAdmin: true }, 'ana');
  run(b, { type: 'setAdmin', memberId: 'ben', isAdmin: false }, 'ben');
  run(b, { type: 'claimPlaceholder', memberId: 'dee', accountId: 'acct-dee', name: 'Deb', standInName: 'Dee' }, null);
  run(b, { type: 'removeMember', memberId: 'dee' }, 'dee');
  run(b, { type: 'removeMember', memberId: 'eve' }, 'eve');
  run(b, { type: 'addMember', member: { id: 'fay', name: 'Fay', accountId: null } }, 'ana');
  run(b, { type: 'mergeStandIn', standInId: 'fay', intoMemberId: 'ben' }, 'cal');
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
  'addMember', 'qualifyMember', 'unqualifyMember', 'removeMember', 'claimPlaceholder', 'mergeStandIn', 'renameMember',
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

  it('describes coverage in plain words, with the swap it makes', () => {
    expect(texts('decline')[0]).toBe("You can't make Sound on Sun, Nov 22. The group was asked to cover.");
    expect(first('decline').tone).toBe('bad');
    // Declining for a Stand-in names them.
    expect(texts('decline')[1]).toMatch("You said Pat can't make Greeter on Sun, Dec 13. The group was asked to cover.");
    // The swap was settled later (by the old Rebalance), so the sentence no longer promises it.
    expect(texts('cover')).toEqual(["Ben's covering for you on Nov 22."]);
    expect(first('cover').detail).toBeNull();
    expect(texts('markCovered')[0]).toBe("Jo is covering Pat's Greeter turn on Dec 13.");
    expect(texts('markCovered')[1]).toMatch(/^(Ben|Pat|Cal) is covering (Ben|Pat|Cal)'s Greeter turn on Dec 20\./);
  });

  it('describes confirmation', () => {
    expect(texts('requestConfirmation')).toEqual(['An Assignment was asked to confirm.']);
    expect(texts('confirm')).toEqual(['Cal confirmed Sound on Sun, Dec 6.']);
    expect(first('confirm').tone).toBe('ok');
  });

  it('describes Skip Dates and Time Off', () => {
    expect(texts('addSkipDate')).toEqual(['Ben marked Sun, Jan 3 as a day off. Turns move forward one date.']);
    expect(texts('removeSkipDate')).toEqual(['You removed the day off on Sun, Jan 3. The turns are back as they were.']);
    expect(texts('addTimeOff')).toEqual(['Cal added Time Off (Dec 26 – Dec 27).']);
    expect(texts('removeTimeOff')).toEqual(['Cal removed Time Off.']);
  });

  it('describes membership', () => {
    expect(texts('addMember')).toEqual(['You added Dee as a stand-in.', 'Eve joined the group.', 'You added Fay as a stand-in.']);
    expect(texts('mergeStandIn')).toEqual(["Fay's stand-in turns now belong to Ben."]);
    expect(texts('qualifyMember')).toEqual(['You added Deb to the Sound turns.']);
    expect(texts('unqualifyMember')).toEqual(['You took Deb out of the Sound Rotation.']);
    expect(texts('renameMember')).toEqual(['You renamed a Member to Deb.', 'Evie changed their name.']);
    expect(texts('setAdmin')).toEqual(["You changed Ben's group permissions.", 'Ben changed their group permissions.']);
    expect(texts('claimPlaceholder')).toEqual(["Deb joined and took over Dee's turns."]);
    expect(texts('removeMember')).toEqual([
      'Deb left the group. Their future turns moved to others.',
      'Evie left the group. Their future turns moved to others.',
    ]);
  });

  it('describes Responsibilities and Rotations', () => {
    expect(texts('addResponsibility')).toEqual(['You added the job Host.']);
    expect(texts('editResponsibility')).toEqual(['You changed Host: set it to 2 people per Event and turned on confirmation.']);
    expect(texts('setPrimaryResponsibility')).toEqual([
      "You made Sound the group's main job.",
      "You cleared the group's main job.",
    ]);
    expect(texts('reorderResponsibilities')).toEqual(['You changed the order jobs are filled in.']);
    expect(texts('removeResponsibility')).toEqual(['You removed the job Host.']);
    expect(texts('reorderQueue')).toEqual(['You reordered the Sound Rotation.']);
    expect(texts('rebalance')).toEqual(['You reordered Sound so whoever has done the fewest turns goes first.']);
  });

  it('describes Event Series and one-off Events', () => {
    expect(texts('addEventSeries')).toEqual(['You added dates for Saturday prep (1 date).']);
    expect(texts('editEventSeries')).toEqual(['You changed when Prep happens.']);
    expect(texts('removeEventSeries')).toEqual(['You removed the dates for Prep.']);
    expect(texts('removeEvent')).toEqual(['You removed the Event.']);
  });

  it('describes settings and swapped turns being taken', () => {
    expect(texts('changeSettings')).toEqual([
      'You changed how covers work.',
      'You changed how covers work.',
    ]);
    // Ana's Sound swap keeps waiting (she greets on Ben's Sound dates), so Cal's is the one paid.
    expect(texts('makeUpTurnPaid')).toEqual(["Cal took Pat's Greeter turn, as swapped."]);
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
    expect(list[0].text).toBe('You changed how covers work.');
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
      "You can't make it. Needs cover",
      'Covered by Ben',
    ]);
    expect(lines[0].detail).toBe('You added 8 Events.');
    expect(lines[2].detail).toBe("Ben's covering for you on Nov 22. You'll take Ben's next turn on Nov 29.");
    expect(lines.map((l) => l.tone)).toEqual(['neutral', 'bad', 'info']);
  });

  it('names a cover found straight away: a Member, someone picked for another’s turn, or an outside name', () => {
    const b = buildGroup();
    const ctx: HistoryContext = { state: b.state, myMemberId: 'ana', timeZone: ZONE };
    const mine = seat(b.state, '2026-11-22', 'sound');
    run(b, { type: 'decline', assignmentId: mine.id, reason: 'Away', coveredBy: { memberId: 'ben' } }, 'ana');
    const others = seat(b.state, '2026-12-13', 'greeter');
    run(b, { type: 'decline', assignmentId: others.id, coveredBy: { guestName: 'Jo' } }, 'ana');
    const latest = (n: number) => describeHistoryEntry(b.history[b.history.length - n], { ...ctx, state: b.state });
    expect(latest(2).text).toBe("Ben's covering for you on Nov 22. You'll take Ben's next turn on Nov 29.");
    expect(latest(1).text).toBe("Jo is covering Pat's Greeter turn on Dec 13.");
    expect(assignmentHistory(b.history, mine.id, { ...ctx, state: b.state }).map((l) => l.text).at(-1)).toBe('Covered by Ben');
  });

  it('includes a swapped turn being placed and taken', () => {
    const b = buildGroup();
    const a = seat(b.state, '2026-11-22', 'sound');
    run(b, { type: 'decline', assignmentId: a.id }, 'ana');
    run(b, { type: 'cover', assignmentId: a.id }, 'ben');
    const paying = b.state.assignments.find((x) => x.makeUpTurnId !== null)!;
    const payAt = b.state.events.find((e) => e.id === paying.eventId)!.startsAt;
    run(b, { type: 'fillSchedule' }, null, new Date(Date.parse(payAt) + 3_600_000).toISOString());
    const ctx: HistoryContext = { state: b.state, myMemberId: 'ana', timeZone: ZONE };
    const lines = assignmentHistory(b.history, paying.id, ctx);
    expect(lines.some((l) => l.text === 'Swapped turn taken')).toBe(true);
    expect(lines.some((l) => /swapped turn|Reassigned/.test(l.text))).toBe(true);
  });

  it('notices a move to another date', () => {
    const b = buildGroup();
    const a = seat(b.state, '2026-11-29', 'sound');
    run(b, { type: 'addSkipDate', eventId: eventId('2026-11-29') }, 'cal');
    const ctx: HistoryContext = { state: b.state, myMemberId: 'ana', timeZone: ZONE };
    expect(movedNotice(b.history, a.id, ctx)).toBe(
      'Moved from Sun, Nov 29 to Sun, Dec 6. Cal marked Sun, Nov 29 as a day off. Turns move forward one date.',
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
    expect(d(null, { ...a, makeUpTurnId: 'm1' })).toBe('Assigned to you as a swapped turn');
    expect(d(a, null)).toBe('Removed from the schedule');
    expect(d(a, { ...a, memberId: 'ben' })).toBe('Reassigned from you to Ben');
    expect(d(a, { ...a, confirmation: 'confirmed' })).toBe('Confirmed by you');
    expect(d(a, { ...a, confirmation: 'requested' })).toBe('You asked to confirm');
    expect(d(a, { ...a, coverageRequest: { ...request, reason: 'timeOff' } })).toBe('You have dates off. Needs cover');
    expect(d(a, { ...a, coverageRequest: { ...request, reason: 'noOneAvailable', requestedBy: null } })).toBe(
      'No one available. Needs cover',
    );
    const covered = { ...a, coverageRequest: { ...request, cover: { kind: 'guest' as const, guestName: 'Jo', arrangedBy: 'ana', coveredAt: NOW } } };
    expect(d({ ...a, coverageRequest: request }, covered)).toBe('Covered by Jo (not in group)');
    expect(d(covered, { ...a, coverageRequest: request })).toBe('Cover withdrawn. Needs cover again');
    expect(d({ ...a, coverageRequest: request }, a)).toBe('Back with you');
    expect(d(a, { ...a, makeUpTurnId: 'm1' })).toBe('Now a swapped turn');
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
