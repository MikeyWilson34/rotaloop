import { describe, expect, it } from 'vitest';

import type { Command, GroupState, RepeatPattern } from '../index';
import { act, afterWeek, assignmentOf, CREW, lineup, moves, rejected, setup, timeOff, week } from './scenario';

const SUNDAYS_9AM: RepeatPattern = {
  frequency: 'weekly',
  intervalWeeks: null,
  daysOfWeek: [0],
  weekOfMonth: null,
  startTime: '09:00',
  timeZone: 'America/Chicago',
  startsOn: '2027-01-03',
};

/** Sound rotates ana..dee; Greeter rotates eve and fay. ana is the only Admin. */
function twoResponsibilities(): GroupState {
  return setup({
    members: [...CREW, 'eve', 'fay'],
    admins: ['ana'],
    responsibilities: [
      { id: 'sound', qualified: CREW },
      { id: 'greeter', qualified: ['eve', 'fay'] },
    ],
  });
}

function declineAndCover(state: GroupState, eventId: string, decliner: string, coverer: string, responsibilityId = 'sound') {
  const assignmentId = assignmentOf(state, eventId, decliner, responsibilityId).id;
  const next = act(state, { type: 'decline', assignmentId }, { by: decliner }).state;
  return act(next, { type: 'cover', assignmentId }, { by: coverer }).state;
}

const pastAssignments = (state: GroupState, throughWeek: number) =>
  state.assignments.filter((a) => Date.parse(state.events.find((e) => e.id === a.eventId)!.startsAt) <= Date.parse(week(throughWeek)));

// ---------------------------------------------------------------------------

describe('Permissions live in the engine', () => {
  const adminOnly: Command[] = [
    { type: 'fillSchedule' },
    { type: 'addEvents', events: [{ id: 'x', seriesId: 'sundays', startsAt: week(9) }] },
    { type: 'requestConfirmation', assignmentIds: [] },
    { type: 'addMember', member: { id: 'zed', name: 'Zed' } },
    { type: 'qualifyMember', memberId: 'ben', responsibilityId: 'greeter' },
    { type: 'unqualifyMember', memberId: 'ben', responsibilityId: 'sound' },
    { type: 'addResponsibility', responsibility: { id: 'video', name: 'Video', headcount: 1, requiresConfirmation: false } },
    { type: 'editResponsibility', responsibilityId: 'sound', changes: { headcount: 2 } },
    { type: 'removeResponsibility', responsibilityId: 'greeter' },
    { type: 'reorderResponsibilities', responsibilityIds: ['greeter', 'sound'] },
    { type: 'setPrimaryResponsibility', responsibilityId: 'sound' },
    { type: 'reorderQueue', responsibilityId: 'sound', queue: ['dee', 'cal', 'ben', 'ana'] },
    { type: 'addEventSeries', series: { id: 'sat', name: 'Saturdays', responsibilityIds: ['sound'] } },
    { type: 'editEventSeries', seriesId: 'sundays', changes: { name: 'Sun' } },
    { type: 'removeEventSeries', seriesId: 'sundays' },
    { type: 'removeEvent', eventId: 'w1' },
    { type: 'setAdmin', memberId: 'ben', isAdmin: true },
    { type: 'changeSettings', settings: { allowDoubling: true } },
    { type: 'rebalance', responsibilityId: 'sound' },
  ];

  it.each(adminOnly.map((c) => [c.type, c] as const))('%s is for Admins only', (_, command) => {
    expect(rejected(twoResponsibilities(), command, { by: 'ben' })).toBe('notPermitted');
  });

  it('Members manage only their own Time Off; Admins manage anyone’s', () => {
    let state = twoResponsibilities();
    expect(rejected(state, { type: 'addTimeOff', timeOff: timeOff('t-ana', 'ana', 2) }, { by: 'ben' })).toBe('notPermitted');
    state = act(state, { type: 'addTimeOff', timeOff: timeOff('t-ben', 'ben', 2) }, { by: 'ben' }).state;
    state = act(state, { type: 'addTimeOff', timeOff: timeOff('t-cal', 'cal', 3) }, { by: 'ana' }).state;
    expect(rejected(state, { type: 'removeTimeOff', timeOffId: 't-cal' }, { by: 'ben' })).toBe('notPermitted');
    state = act(state, { type: 'removeTimeOff', timeOffId: 't-ben' }, { by: 'ben' }).state;
    act(state, { type: 'removeTimeOff', timeOffId: 't-cal' }, { by: 'ana' });
  });

  it('Members may still add Skip Dates, Decline their own Assignments and Cover', () => {
    let state = twoResponsibilities();
    state = act(state, { type: 'addSkipDate', eventId: 'w8' }, { by: 'cal' }).state;
    state = declineAndCover(state, 'w2', 'ben', 'dee');
    expect(lineup(state)[1]).toBe('w2 dee');
  });

  it('Someone who is not an active Member cannot act', () => {
    let state = twoResponsibilities();
    state = act(state, { type: 'removeMember', memberId: 'dee' }, { by: 'dee' }).state;
    expect(rejected(state, { type: 'addSkipDate', eventId: 'w3' }, { by: 'dee' })).toBe('notPermitted');
    expect(rejected(state, { type: 'addSkipDate', eventId: 'w3' }, { by: 'stranger' })).toBe('notPermitted');
  });

  it('Joining adds yourself as a plain Member; only Admins add others', () => {
    const state = twoResponsibilities();
    act(state, { type: 'addMember', member: { id: 'gus', name: 'Gus', accountId: 'acct-gus' } }, { by: 'gus' });
    expect(
      rejected(state, { type: 'addMember', member: { id: 'gus', name: 'Gus', accountId: 'acct-gus', isAdmin: true } }, { by: 'gus' }),
    ).toBe('notPermitted');
    expect(
      rejected(state, { type: 'addMember', member: { id: 'gus', name: 'Gus', accountId: 'acct-gus' }, qualifiedFor: ['sound'] }, { by: 'gus' }),
    ).toBe('notPermitted');
  });
});

// ---------------------------------------------------------------------------

describe('Renaming a Member', () => {
  it('A Member renames themselves; an Admin can rename anyone, including a Placeholder', () => {
    let state = twoResponsibilities();
    state = act(state, { type: 'renameMember', memberId: 'ben', name: '  Benny ' }, { by: 'ben' }).state;
    expect(state.members.find((m) => m.id === 'ben')?.name).toBe('Benny');
    expect(rejected(state, { type: 'renameMember', memberId: 'cal', name: 'Cally' }, { by: 'ben' })).toBe('notPermitted');
    state = act(state, { type: 'addMember', member: { id: 'gus', name: 'Gus' } }, { by: 'ana' }).state;
    const result = act(state, { type: 'renameMember', memberId: 'gus', name: 'Gus P.' }, { by: 'ana' });
    expect(result.state.members.find((m) => m.id === 'gus')?.name).toBe('Gus P.');
    expect(result.changes).toEqual([]);
    expect(rejected(state, { type: 'renameMember', memberId: 'ben', name: '   ' }, { by: 'ben' })).toBe('invalid');
  });
});

// ---------------------------------------------------------------------------

describe('Admins', () => {
  it('An Admin appoints another Admin, who can then run Admin commands', () => {
    let state = twoResponsibilities();
    state = act(state, { type: 'setAdmin', memberId: 'ben', isAdmin: true }, { by: 'ana' }).state;
    act(state, { type: 'rebalance', responsibilityId: 'sound' }, { by: 'ben' });
  });

  it('The last active Admin cannot be removed as Admin, removed from the Group, or leave', () => {
    const state = twoResponsibilities();
    expect(rejected(state, { type: 'setAdmin', memberId: 'ana', isAdmin: false }, { by: 'ana' })).toBe('lastAdmin');
    expect(rejected(state, { type: 'removeMember', memberId: 'ana' }, { by: 'ana' })).toBe('lastAdmin');
    expect(rejected(state, { type: 'removeMember', memberId: 'ana' })).toBe('lastAdmin');
  });

  it('With a second Admin, either can step down or leave', () => {
    let state = twoResponsibilities();
    state = act(state, { type: 'setAdmin', memberId: 'ben', isAdmin: true }, { by: 'ana' }).state;
    const steppedDown = act(state, { type: 'setAdmin', memberId: 'ana', isAdmin: false }, { by: 'ana' }).state;
    expect(steppedDown.members.find((m) => m.id === 'ana')?.isAdmin).toBe(false);
    expect(rejected(steppedDown, { type: 'removeMember', memberId: 'ben' }, { by: 'ben' })).toBe('lastAdmin');
    const left = act(state, { type: 'removeMember', memberId: 'ana' }, { by: 'ana' }).state;
    expect(left.members.find((m) => m.id === 'ana')?.leftAt).not.toBeNull();
  });

  it('A Placeholder Member cannot be made an Admin until claimed', () => {
    let state = twoResponsibilities();
    state = act(state, { type: 'addMember', member: { id: 'gus', name: 'Gus' } }, { by: 'ana' }).state;
    expect(rejected(state, { type: 'setAdmin', memberId: 'gus', isAdmin: true }, { by: 'ana' })).toBe('invalid');
  });
});

// ---------------------------------------------------------------------------

describe('Responsibilities', () => {
  it('Adding a Responsibility with Qualified Members fills it at Events whose series use it', () => {
    let state = twoResponsibilities();
    state = act(
      state,
      {
        type: 'addResponsibility',
        responsibility: { id: 'video', name: 'Video', headcount: 1, requiresConfirmation: false },
        qualifiedMemberIds: ['eve', 'fay'],
      },
      { by: 'ana' },
    ).state;
    expect(state.responsibilities.map((r) => r.id)).toEqual(['sound', 'greeter', 'video']);
    expect(lineup(state, 'video')).toEqual([]); // no series uses it yet
    const result = act(state, { type: 'editEventSeries', seriesId: 'sundays', changes: { responsibilityIds: ['sound', 'greeter', 'video'] } }, { by: 'ana' });
    expect(lineup(result.state, 'video').length).toBe(8);
    expect(result.changes.every((c) => c.before === null && c.after?.responsibilityId === 'video')).toBe(true);
    expect(rejected(state, { type: 'addResponsibility', responsibility: { id: 'video', name: 'V', headcount: 1, requiresConfirmation: false } }, { by: 'ana' })).toBe('invalid');
  });

  it('Raising the headcount reconciles only future Events: the past is unchanged', () => {
    const state = setup({ admins: ['ana'] });
    const result = act(state, { type: 'editResponsibility', responsibilityId: 'sound', changes: { headcount: 2 } }, { by: 'ana', at: afterWeek(2) });
    expect(lineup(result.state)).toEqual([
      'w1 ana', 'w2 ben', 'w3 cal+dee', 'w4 ana+ben', 'w5 cal+dee', 'w6 ana+ben', 'w7 cal+dee', 'w8 ana+ben',
    ]);
    expect(pastAssignments(result.state, 2)).toEqual(pastAssignments(state, 2));
    expect(result.changes.every((c) => !['w1', 'w2'].includes((c.before ?? c.after)!.eventId))).toBe(true);
    // Six future Events gain a seat each; w3..w8 kept one seat each, matched to the same Member where possible.
    expect(result.changes.filter((c) => c.before === null)).toHaveLength(6);
    expect(result.changes.filter((c) => c.after === null)).toHaveLength(0);
  });

  it('Lowering the headcount removes the extra future seats and the Rotation closes up', () => {
    const state = setup({ admins: ['ana'], responsibilities: [{ id: 'sound', headcount: 2, qualified: CREW }] });
    expect(lineup(state).slice(0, 2)).toEqual(['w1 ana+ben', 'w2 cal+dee']);
    const result = act(state, { type: 'editResponsibility', responsibilityId: 'sound', changes: { headcount: 1 } }, { by: 'ana', at: afterWeek(1) });
    expect(lineup(result.state)).toEqual([
      'w1 ana+ben', 'w2 cal', 'w3 dee', 'w4 ana', 'w5 ben', 'w6 cal', 'w7 dee', 'w8 ana',
    ]);
    expect(result.changes.filter((c) => c.after === null)).toHaveLength(7);
    expect(result.changes.filter((c) => c.before === null)).toHaveLength(0);
    expect(moves(result)).not.toContain('cal@w2 -> cal@w2'); // unchanged seats are not reported
  });

  it('Lowering the headcount below the Covers at an Event keeps one Cover and cancels the dropped Cover’s Make-up Turn', () => {
    let state = setup({ admins: ['ana'], responsibilities: [{ id: 'sound', headcount: 2, qualified: CREW }] });
    state = declineAndCover(state, 'w1', 'ana', 'cal'); // ana owes cal
    state = declineAndCover(state, 'w1', 'ben', 'dee'); // ben owes dee
    expect(lineup(state)[0]).toBe('w1 cal+dee');
    const result = act(state, { type: 'editResponsibility', responsibilityId: 'sound', changes: { headcount: 1 } }, { by: 'ana' });
    expect(lineup(result.state)[0]).toBe('w1 cal');
    expect(result.state.makeUpTurns.map((t) => [t.debtorId, t.creditorId, t.status, t.closedReason])).toEqual([
      ['ana', 'cal', 'outstanding', null],
      ['ben', 'dee', 'cancelled', 'coverWithdrawn'],
    ]);
    const dropped = result.state.makeUpTurns[1].id;
    expect(result.history.at(-1)?.makeUpTurns).toEqual([{ makeUpTurnId: dropped, before: 'outstanding', after: 'cancelled' }]);
  });

  it('Requiring confirmation asks future Assignments to confirm; the past keeps its state', () => {
    const state = setup({ admins: ['ana'] });
    const on = act(state, { type: 'editResponsibility', responsibilityId: 'sound', changes: { requiresConfirmation: true } }, { by: 'ana', at: afterWeek(1) });
    expect(assignmentOf(on.state, 'w1', 'ana').confirmation).toBe('notRequired');
    expect(assignmentOf(on.state, 'w2', 'ben').confirmation).toBe('notYetRequested');
    expect(on.changes).toHaveLength(7);
    const off = act(on.state, { type: 'editResponsibility', responsibilityId: 'sound', changes: { requiresConfirmation: false } }, { by: 'ana', at: afterWeek(1) });
    expect(off.state.assignments.every((a) => a.confirmation === 'notRequired')).toBe(true);
  });

  it('Renaming a Responsibility changes no Assignment', () => {
    const result = act(setup({ admins: ['ana'] }), { type: 'editResponsibility', responsibilityId: 'sound', changes: { name: 'Audio' } }, { by: 'ana' });
    expect(result.state.responsibilities[0].name).toBe('Audio');
    expect(result.changes).toEqual([]);
  });

  it('Removing a Responsibility removes its future seats, keeps its history, and cancels its Make-up Turns', () => {
    let state = twoResponsibilities();
    state = act(state, { type: 'setPrimaryResponsibility', responsibilityId: 'greeter' }, { by: 'ana' }).state;
    state = declineAndCover(state, 'w1', 'eve', 'fay', 'greeter'); // eve owes fay
    const soundBefore = lineup(state, 'sound');
    const result = act(state, { type: 'removeResponsibility', responsibilityId: 'greeter' }, { by: 'ana', at: afterWeek(1) });

    expect(lineup(result.state, 'greeter')).toEqual(['w1 fay']);
    expect(lineup(result.state, 'sound')).toEqual(soundBefore);
    expect(result.changes.every((c) => c.after === null && c.before?.responsibilityId === 'greeter')).toBe(true);
    expect(result.changes).toHaveLength(7);
    expect(result.state.makeUpTurns[0]).toMatchObject({ status: 'cancelled', closedReason: 'responsibilityRemoved' });
    expect(result.state.primaryResponsibilityId).toBeNull();
    expect(result.state.responsibilities.find((r) => r.id === 'greeter')?.removedAt).toBe(afterWeek(1));
    expect(rejected(result.state, { type: 'qualifyMember', memberId: 'ana', responsibilityId: 'greeter' }, { by: 'ana', at: afterWeek(1) })).toBe('notFound');
    expect(rejected(result.state, { type: 'removeResponsibility', responsibilityId: 'greeter' }, { by: 'ana', at: afterWeek(1) })).toBe('notFound');
  });

  it('Reordering Responsibilities changes the fill order; the list must name every Responsibility once', () => {
    const state = twoResponsibilities();
    const result = act(state, { type: 'reorderResponsibilities', responsibilityIds: ['greeter', 'sound'] }, { by: 'ana' });
    expect(result.state.responsibilities.map((r) => r.id)).toEqual(['greeter', 'sound']);
    expect(rejected(state, { type: 'reorderResponsibilities', responsibilityIds: ['greeter'] }, { by: 'ana' })).toBe('invalid');
    expect(rejected(state, { type: 'reorderResponsibilities', responsibilityIds: ['greeter', 'greeter'] }, { by: 'ana' })).toBe('invalid');
  });

  it('Setting the Primary Responsibility', () => {
    const state = twoResponsibilities();
    expect(act(state, { type: 'setPrimaryResponsibility', responsibilityId: 'sound' }, { by: 'ana' }).state.primaryResponsibilityId).toBe('sound');
    expect(act(state, { type: 'setPrimaryResponsibility', responsibilityId: null }, { by: 'ana' }).state.primaryResponsibilityId).toBeNull();
    expect(rejected(state, { type: 'setPrimaryResponsibility', responsibilityId: 'nope' }, { by: 'ana' })).toBe('notFound');
  });
});

// ---------------------------------------------------------------------------

describe('Reordering a Rotation by hand', () => {
  it('The queue takes the new order and early turns are forgotten, as with Rebalance', () => {
    let state = setup({ admins: ['ana'] });
    state = act(state, { type: 'addTimeOff', timeOff: timeOff('t1', 'ana', 1) }).state;
    state = act(state, { type: 'fillSchedule' }, { at: afterWeek(1) }).state;
    expect(state.rotations[0]).toEqual({ responsibilityId: 'sound', queue: CREW, turnsTakenEarly: { ben: 1 } });

    const result = act(state, { type: 'reorderQueue', responsibilityId: 'sound', queue: ['dee', 'cal', 'ben', 'ana'] }, { by: 'ana', at: afterWeek(1) });
    expect(result.state.rotations[0]).toEqual({ responsibilityId: 'sound', queue: ['dee', 'cal', 'ben', 'ana'], turnsTakenEarly: {} });
    expect(lineup(result.state)).toEqual([
      'w1 ben', 'w2 dee', 'w3 cal', 'w4 ben', 'w5 ana', 'w6 dee', 'w7 cal', 'w8 ben',
    ]);
  });

  it('Outstanding Make-up Turns are kept (only Rebalance settles them)', () => {
    let state = setup({ admins: ['ana'] });
    state = declineAndCover(state, 'w1', 'ana', 'cal');
    const result = act(state, { type: 'reorderQueue', responsibilityId: 'sound', queue: ['dee', 'cal', 'ben', 'ana'] }, { by: 'ana' });
    expect(result.state.makeUpTurns[0].status).toBe('outstanding');
  });

  it('The new order must list exactly the current Qualified Members', () => {
    const state = setup({ admins: ['ana'] });
    const reorder = (queue: string[]): Command => ({ type: 'reorderQueue', responsibilityId: 'sound', queue });
    expect(rejected(state, reorder(['dee', 'cal', 'ben']), { by: 'ana' })).toBe('invalid');
    expect(rejected(state, reorder(['dee', 'cal', 'ben', 'ben']), { by: 'ana' })).toBe('invalid');
    expect(rejected(state, reorder(['dee', 'cal', 'ben', 'zed']), { by: 'ana' })).toBe('invalid');
    expect(rejected(state, { type: 'reorderQueue', responsibilityId: 'nope', queue: [] }, { by: 'ana' })).toBe('notFound');
  });
});

// ---------------------------------------------------------------------------

describe('Event Series and one-off Events', () => {
  it('Adding a series stores its repeat pattern; the engine does not expand it into Events', () => {
    const state = setup({ admins: ['ana'] });
    const bare = act(state, { type: 'addEventSeries', series: { id: 'sat', name: 'Saturdays', responsibilityIds: ['sound'], repeat: SUNDAYS_9AM } }, { by: 'ana' });
    expect(bare.state.eventSeries.at(-1)).toEqual({
      id: 'sat', name: 'Saturdays', responsibilityIds: ['sound'], repeat: SUNDAYS_9AM, removedAt: null,
    });
    expect(bare.state.events).toEqual(state.events);
    expect(bare.changes).toEqual([]);

    const withEvents = act(
      state,
      {
        type: 'addEventSeries',
        series: { id: 'sat', name: 'Saturdays', responsibilityIds: ['sound'] },
        events: [{ id: 's1', seriesId: 'sat', startsAt: '2027-01-02T09:00:00.000Z' }],
      },
      { by: 'ana' },
    );
    expect(lineup(withEvents.state).slice(0, 2)).toEqual(['s1 ana', 'w1 ben']);
  });

  it('Rejects invalid repeat patterns and Events of another series', () => {
    const state = setup({ admins: ['ana'] });
    const add = (repeat: RepeatPattern, events: Extract<Command, { type: 'addEventSeries' }>['events'] = []) =>
      rejected(state, { type: 'addEventSeries', series: { id: 'sat', name: 'Sat', responsibilityIds: ['sound'], repeat }, events }, { by: 'ana' });
    expect(add({ ...SUNDAYS_9AM, frequency: 'custom' })).toBe('invalid'); // custom needs an interval
    expect(add({ ...SUNDAYS_9AM, daysOfWeek: [] })).toBe('invalid');
    expect(add({ ...SUNDAYS_9AM, frequency: 'monthly' })).toBe('invalid'); // monthly needs weekOfMonth
    expect(add({ ...SUNDAYS_9AM, startTime: '25:00' })).toBe('invalid');
    expect(add(SUNDAYS_9AM, [{ id: 'x', seriesId: 'sundays', startsAt: week(9) }])).toBe('invalid');
    expect(rejected(state, { type: 'addEventSeries', series: { id: 'sat', name: 'Sat', responsibilityIds: ['nope'] } }, { by: 'ana' })).toBe('notFound');
  });

  it('Changing a series’ time replaces its future Events; turns move with their Members and ask to confirm again', () => {
    const state = setup({ admins: ['ana'], responsibilities: [{ id: 'sound', requiresConfirmation: true, qualified: CREW }] });
    const saturdays = [3, 4, 5, 6, 7, 8].map((n) => ({
      id: `s${n}`,
      seriesId: 'sundays',
      startsAt: new Date(Date.parse(week(n)) - 24 * 60 * 60 * 1000).toISOString(),
    }));
    const result = act(
      state,
      {
        type: 'editEventSeries',
        seriesId: 'sundays',
        changes: { repeat: { ...SUNDAYS_9AM, daysOfWeek: [6] } },
        replaceFutureEvents: saturdays,
      },
      { by: 'ana', at: afterWeek(2) },
    );
    expect(lineup(result.state)).toEqual(['w1 ana', 'w2 ben', 's3 cal', 's4 dee', 's5 ana', 's6 ben', 's7 cal', 's8 dee']);
    expect(pastAssignments(result.state, 2)).toEqual(pastAssignments(state, 2));
    expect(result.changes).toHaveLength(6);
    for (const change of result.changes) {
      expect(change.before?.eventId.replace('w', 's')).toBe(change.after?.eventId);
      expect(change.after?.confirmation).toBe('requested');
    }
  });

  it('Dropping a Responsibility from a series removes its future seats and cancels a dropped Cover’s Make-up Turn', () => {
    let state = twoResponsibilities();
    state = declineAndCover(state, 'w3', 'eve', 'fay', 'greeter');
    const result = act(state, { type: 'editEventSeries', seriesId: 'sundays', changes: { responsibilityIds: ['sound'] } }, { by: 'ana' });
    expect(lineup(result.state, 'greeter')).toEqual([]);
    expect(result.changes).toHaveLength(8);
    expect(result.changes.every((c) => c.after === null)).toBe(true);
    expect(result.state.makeUpTurns[0]).toMatchObject({ status: 'cancelled', closedReason: 'coverWithdrawn' });

    const back = act(result.state, { type: 'editEventSeries', seriesId: 'sundays', changes: { responsibilityIds: ['sound', 'greeter'] } }, { by: 'ana' });
    expect(lineup(back.state, 'greeter')).toHaveLength(8);
  });

  it('Removing a series removes its future Events and their Assignments, and keeps the past', () => {
    const state = setup({ admins: ['ana'] });
    const result = act(state, { type: 'removeEventSeries', seriesId: 'sundays' }, { by: 'ana', at: afterWeek(2) });
    expect(result.state.events.map((e) => e.id)).toEqual(['w1', 'w2']);
    expect(lineup(result.state)).toEqual(['w1 ana', 'w2 ben']);
    expect(result.changes).toHaveLength(6);
    expect(result.state.eventSeries[0].removedAt).toBe(afterWeek(2));
    expect(rejected(result.state, { type: 'addEvents', events: [{ id: 'x', seriesId: 'sundays', startsAt: week(9) }] }, { by: 'ana', at: afterWeek(2) })).toBe('invalid');
  });

  it('Removing a one-off Event: its seats go and the Rotation closes up', () => {
    let state = setup({ admins: ['ana'] });
    state = act(state, { type: 'addEvents', events: [{ id: 'x', seriesId: null, startsAt: '2027-01-05T18:00:00.000Z', responsibilityIds: ['sound'] }] }, { by: 'ana' }).state;
    expect(lineup(state).slice(0, 3)).toEqual(['w1 ana', 'x ben', 'w2 cal']);
    const result = act(state, { type: 'removeEvent', eventId: 'x' }, { by: 'ana' });
    expect(lineup(result.state)).toEqual(lineup(setup()));
    expect(result.state.events.some((e) => e.id === 'x')).toBe(false);
    expect(rejected(state, { type: 'removeEvent', eventId: 'w2' }, { by: 'ana' })).toBe('invalid'); // use a Skip Date
    expect(rejected(state, { type: 'removeEvent', eventId: 'x' }, { by: 'ana', at: '2027-01-06T00:00:00.000Z' })).toBe('eventHasPassed');
  });
});
