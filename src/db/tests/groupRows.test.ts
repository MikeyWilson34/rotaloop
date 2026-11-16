import { describe, expect, it } from 'vitest';

import { rowsFromState, stateFromRows } from '../groupRows';
import { parseClientCommand, parseRequest } from '../parseRequest';
import { newGroupState, run, seat } from './fixtures';

describe('groupRows', () => {
  it('round-trips a GroupState through rows in memory', () => {
    let state = run(newGroupState('g'), { type: 'fillSchedule' }, 'ana').state;
    const target = seat(state, 'w1', 'sound');
    state = run(state, { type: 'decline', assignmentId: target }, state.assignments.find((a) => a.id === target)!.memberId).state;
    expect(stateFromRows(rowsFromState(state))).toEqual(state);
  });

  it('reads Postgres timestamps and out-of-order rows back into engine form', () => {
    const state = run(newGroupState('g'), { type: 'fillSchedule' }, 'ana').state;
    const rows = rowsFromState(state);
    const pg = {
      ...rows,
      events: [...rows.events].reverse().map((e) => ({ ...e, starts_at: e.starts_at.replace('.000Z', '+00:00') })),
      group: { ...rows.group, replacement_deadline_ms: String(rows.group.replacement_deadline_ms) as unknown as number },
    };
    expect(stateFromRows(pg)).toEqual(state);
  });
});

describe('parseRequest', () => {
  it('keeps only known fields and normalizes instants', () => {
    const command = parseClientCommand({
      type: 'addTimeOff',
      sneaky: true,
      timeOff: { id: ' t1 ', memberId: 'ben', startsAt: '2027-01-01T00:00:00Z', endsAt: '2027-01-02T00:00:00Z', removedAt: 'x' },
    });
    expect(command).toEqual({
      type: 'addTimeOff',
      timeOff: { id: 't1', memberId: 'ben', startsAt: '2027-01-01T00:00:00.000Z', endsAt: '2027-01-02T00:00:00.000Z' },
    });
  });

  it('parses the setup commands, keeping only known fields', () => {
    const repeat = {
      frequency: 'monthly',
      intervalWeeks: null,
      daysOfWeek: [0],
      weekOfMonth: 1,
      startTime: '09:30',
      timeZone: 'America/Chicago',
      startsOn: '2027-01-03',
      extra: 1,
    };
    const { extra: _, ...cleanRepeat } = repeat;
    const cases: [unknown, unknown][] = [
      [{ type: 'renameMember', memberId: 'm1', name: ' Ben ' }, { type: 'renameMember', memberId: 'm1', name: 'Ben' }],
      [{ type: 'setAdmin', memberId: 'm1', isAdmin: false }, { type: 'setAdmin', memberId: 'm1', isAdmin: false }],
      [
        { type: 'addResponsibility', responsibility: { id: 'v', name: 'Video', headcount: 2, requiresConfirmation: true, removedAt: 'x' }, qualifiedMemberIds: ['m1'] },
        { type: 'addResponsibility', responsibility: { id: 'v', name: 'Video', headcount: 2, requiresConfirmation: true }, qualifiedMemberIds: ['m1'] },
      ],
      [
        { type: 'editResponsibility', responsibilityId: 'v', changes: { headcount: 3, sneaky: true } },
        { type: 'editResponsibility', responsibilityId: 'v', changes: { headcount: 3 } },
      ],
      [{ type: 'removeResponsibility', responsibilityId: 'v' }, { type: 'removeResponsibility', responsibilityId: 'v' }],
      [{ type: 'reorderResponsibilities', responsibilityIds: ['b', 'a'] }, { type: 'reorderResponsibilities', responsibilityIds: ['b', 'a'] }],
      [{ type: 'setPrimaryResponsibility', responsibilityId: null }, { type: 'setPrimaryResponsibility', responsibilityId: null }],
      [{ type: 'reorderQueue', responsibilityId: 'v', queue: ['m2', 'm1'] }, { type: 'reorderQueue', responsibilityId: 'v', queue: ['m2', 'm1'] }],
      [
        { type: 'addEventSeries', series: { id: 's', name: 'Sun', responsibilityIds: ['v'], repeat }, events: [{ id: 'e1', seriesId: 's', startsAt: '2027-01-03T15:30:00Z' }] },
        { type: 'addEventSeries', series: { id: 's', name: 'Sun', responsibilityIds: ['v'], repeat: cleanRepeat }, events: [{ id: 'e1', seriesId: 's', startsAt: '2027-01-03T15:30:00.000Z' }] },
      ],
      [
        { type: 'editEventSeries', seriesId: 's', changes: { repeat: null }, replaceFutureEvents: [] },
        { type: 'editEventSeries', seriesId: 's', changes: { repeat: null }, replaceFutureEvents: [] },
      ],
      [{ type: 'removeEventSeries', seriesId: 's' }, { type: 'removeEventSeries', seriesId: 's' }],
      [{ type: 'removeEvent', eventId: 'e1' }, { type: 'removeEvent', eventId: 'e1' }],
    ];
    for (const [input, expected] of cases) expect(parseClientCommand(input)).toEqual(expected);
  });

  it.each([
    [{ type: 'editResponsibility', responsibilityId: 'v', changes: { headcount: 0 } }],
    [{ type: 'setAdmin', memberId: 'm1', isAdmin: 'yes' }],
    [{ type: 'addEventSeries', series: { id: 's', name: 'S', responsibilityIds: [], repeat: { frequency: 'weekly', intervalWeeks: null, daysOfWeek: [0], weekOfMonth: null, startTime: '09:00', timeZone: 'Mars/Olympus', startsOn: '2027-01-03' } } }],
    [{ type: 'addEventSeries', series: { id: 's', name: 'S', responsibilityIds: [], repeat: { frequency: 'weekly', intervalWeeks: null, daysOfWeek: [9], weekOfMonth: null, startTime: '09:00', timeZone: 'UTC', startsOn: '2027-01-03' } } }],
    [{ type: 'renameMember', memberId: 'm1', name: '' }],
  ])('rejects the setup command %j', (command) => {
    expect(() => parseClientCommand(command)).toThrow();
  });

  it.each([
    [{ action: 'nope' }],
    [{ action: 'command', groupId: 'not-a-uuid', command: { type: 'fillSchedule' } }],
    [{ action: 'command', groupId: '00000000-0000-4000-8000-000000000001', command: { type: 'claimPlaceholder' } }],
    [{ action: 'command', groupId: '00000000-0000-4000-8000-000000000001', command: { type: 'confirm' } }],
    [{ action: 'join', token: 'x', memberName: '   ' }],
    [{ action: 'createGroup', name: 'X', memberName: 'Y', responsibilities: [{ id: 'a', name: 'A', headcount: 0, requiresConfirmation: true }] }],
    [{ action: 'createGroup', name: 'X', memberName: 'Y', events: [{ id: 'e', seriesId: null, startsAt: '2027-01-01T00:00:00Z' }] }],
  ])('rejects %j', (body) => {
    expect(() => parseRequest(body)).toThrow();
  });
});
