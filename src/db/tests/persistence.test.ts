import { beforeAll, describe, expect, it } from 'vitest';

import type { Command, CommandResult, GroupState, RepeatPattern } from '../../engine';
import { rowsFromState, stateFromRows } from '../groupRows';
import { afterWeek, holder, newGroupState, NOW, run, seat, week } from './fixtures';
import { createTestDb, uuid, type TestDb } from './pglite';

type Ok = Extract<CommandResult, { ok: true }>;

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
  await t.createAccount(uuid(1), 'Ana');
  await t.createAccount(uuid(5), 'Eve');
});

/** Persists an engine result, then reloads the Group and returns the reloaded state. */
async function persistAndReload(groupId: string, version: number | null, result: Ok) {
  const newVersion = await t.store.persist({
    groupId,
    expectedVersion: version,
    rows: rowsFromState(result.state),
    newGroup: version === null ? { name: 'Crew', time_zone: 'UTC', created_by: uuid(1) } : undefined,
    history: result.history,
  });
  expect(newVersion).not.toBeNull();
  const loaded = await t.store.load(groupId);
  expect(loaded?.version).toBe(newVersion);
  return { version: newVersion as number, state: stateFromRows(loaded!.rows) };
}

/** A Member qualified for Sound who holds no seat at the Event and isn't `except`. */
function freeAt(state: GroupState, eventId: string, except: string[]): string {
  const busy = new Set(state.assignments.filter((a) => a.eventId === eventId).map((a) => a.memberId));
  const free = state.rotations
    .find((r) => r.responsibilityId === 'sound')!
    .queue.find((m) => !busy.has(m) && !except.includes(m));
  if (!free) throw new Error(`No one free at ${eventId}`);
  return free;
}

describe('apply_group_command_result round trip', () => {
  it('reloads exactly the GroupState the engine produced, command after command', async () => {
    const groupId = uuid(100);
    let result = run(newGroupState(groupId, { ana: uuid(1) }), { type: 'fillSchedule' }, 'ana');
    let { version, state } = await persistAndReload(groupId, null, result);
    expect(version).toBe(1);
    expect(state).toEqual(result.state);
    let historyCount = result.history.length;

    const step = async (next: Ok) => {
      result = next;
      historyCount += next.history.length;
      ({ version, state } = await persistAndReload(groupId, version, next));
      expect(state).toEqual(next.state);
    };

    const sound = (eventId: string) => seat(state, eventId, 'sound');

    await step(run(state, { type: 'requestConfirmation', assignmentIds: ['w1', 'w2', 'w3'].map(sound) }, null));
    await step(run(state, { type: 'confirm', assignmentId: sound('w1') }, holder(state, sound('w1'))));

    // A Decline and a Member Cover (creates a Make-up Turn under Pay It Back).
    const w2 = sound('w2');
    const decliner = holder(state, w2);
    await step(run(state, { type: 'decline', assignmentId: w2, reason: 'Traveling: back on the 10th' }, decliner));
    expect(state.assignments.find((x) => x.id === w2)?.coverageRequest?.note).toBe('Traveling: back on the 10th');
    await step(run(state, { type: 'cover', assignmentId: w2 }, freeAt(state, 'w2', [decliner])));
    expect(state.makeUpTurns).toHaveLength(1);

    // A Decline settled by a Guest Cover.
    const w3 = sound('w3');
    await step(run(state, { type: 'decline', assignmentId: w3 }, holder(state, w3)));
    await step(run(state, { type: 'markCovered', assignmentId: w3, by: { guestName: 'Pat (guest)' } }, 'ana'));

    // A Decline taken back ("I can make it after all").
    const w4 = sound('w4');
    const w4Holder = holder(state, w4);
    await step(run(state, { type: 'decline', assignmentId: w4, reason: 'Sick' }, w4Holder));
    await step(run(state, { type: 'withdrawDecline', assignmentId: w4 }, w4Holder));
    expect(state.assignments.find((x) => x.id === w4)).toMatchObject({ memberId: w4Holder, coverageRequest: null });

    // Repeating, Responsibility-scoped Time Off, then a Skip Date, then removing the Time Off.
    await step(
      run(
        state,
        {
          type: 'addTimeOff',
          timeOff: {
            id: 't1',
            memberId: 'ben',
            startsAt: '2027-01-24T00:00:00.000Z',
            endsAt: '2027-01-25T00:00:00.000Z',
            repeatEveryWeeks: 2,
            repeatUntil: week(6),
            responsibilityIds: ['greeter'],
            timeZone: 'America/Chicago',
            note: 'Family trip',
          },
        },
        'ben',
      ),
    );
    await step(run(state, { type: 'addSkipDate', eventId: 'w5', reason: 'Holiday: Building closed' }, 'cal'));
    expect(state.assignments.some((a) => a.eventId === 'w5')).toBe(false);
    await step(run(state, { type: 'removeTimeOff', timeOffId: 't1' }, 'ben'));

    await step(
      run(state, { type: 'changeSettings', settings: { allowDoubling: true, replacementDuty: 'admins' } }, 'ana'),
    );

    // Time passes: w1 and w2 become history.
    await step(run(state, { type: 'fillSchedule' }, null, afterWeek(2)));
    expect(state.rotatedThrough).toBe(afterWeek(2));

    await step(run(state, { type: 'rebalance', responsibilityId: 'sound' }, 'ana', afterWeek(2)));

    // A Placeholder Member who is then claimed, and a Member who leaves.
    await step(
      run(state, { type: 'addMember', member: { id: 'eve', name: 'Eve' }, qualifiedFor: ['sound'] }, 'ana', afterWeek(2)),
    );
    await step(run(state, { type: 'claimPlaceholder', memberId: 'eve', accountId: uuid(5) }, 'eve', afterWeek(2)));
    await step(run(state, { type: 'removeMember', memberId: 'cal' }, 'cal', afterWeek(2)));

    // Every mapped field was exercised.
    expect(state.timeOff[0].removedAt).not.toBeNull();
    expect(state.events.find((e) => e.id === 'w5')?.skipDate).toEqual({ markedBy: 'cal', markedAt: NOW, reason: 'Holiday: Building closed' });
    expect(state.timeOff[0]).toMatchObject({ timeZone: 'America/Chicago', note: 'Family trip' });
    expect(state.members.find((m) => m.id === 'cal')?.leftAt).toBe(afterWeek(2));
    expect(state.members.find((m) => m.id === 'eve')?.accountId).toBe(uuid(5));
    expect(state.assignments.some((a) => a.coverageRequest?.cover?.kind === 'guest')).toBe(true);
    expect(state.assignments.some((a) => a.coverageRequest?.cover?.kind === 'member')).toBe(true);
    expect(state.makeUpTurns.some((m) => m.status !== 'outstanding')).toBe(true);

    // Database row counts match the state, and history was appended.
    const count = async (table: string) =>
      Number((await t.db.query<{ n: number }>(`select count(*)::int n from public.${table} where group_id = $1`, [groupId])).rows[0].n);
    expect(await count('assignments')).toBe(state.assignments.length);
    expect(await count('members')).toBe(5);
    expect(await count('schedule_history')).toBe(historyCount);
  });

  it('round-trips the setup commands: removals, the repeat pattern, renames and Admins', async () => {
    const groupId = uuid(106);
    let result = run(newGroupState(groupId, { ana: uuid(1), ben: uuid(5) }), { type: 'fillSchedule' }, 'ana');
    let { version, state } = await persistAndReload(groupId, null, result);
    const step = async (command: Command, actor: string | null = 'ana') => {
      result = run(state, command, actor);
      ({ version, state } = await persistAndReload(groupId, version, result));
      expect(state).toEqual(result.state);
    };
    const repeat: RepeatPattern = {
      frequency: 'custom',
      intervalWeeks: 3,
      daysOfWeek: [6],
      weekOfMonth: null,
      startTime: '17:30',
      timeZone: 'Europe/London',
      startsOn: '2027-01-09',
    };

    await step({
      type: 'addResponsibility',
      responsibility: { id: 'video', name: 'Video', headcount: 1, requiresConfirmation: false },
      qualifiedMemberIds: ['ben', 'cal'],
    });
    await step({
      type: 'addEventSeries',
      series: { id: 'sat', name: 'Saturdays', responsibilityIds: ['video'], repeat },
      events: [
        { id: 's1', seriesId: 'sat', startsAt: '2027-01-09T17:30:00.000Z' },
        { id: 's2', seriesId: 'sat', startsAt: '2027-01-30T17:30:00.000Z' },
      ],
    });
    await step({
      type: 'editEventSeries',
      seriesId: 'sundays',
      changes: { repeat: { ...repeat, frequency: 'monthly', intervalWeeks: null, weekOfMonth: -1, daysOfWeek: [0] } },
    });
    await step({ type: 'editResponsibility', responsibilityId: 'greeter', changes: { headcount: 1, name: 'Welcome' } });
    // A Greeter Make-up Turn, cancelled below when Greeter is removed.
    const greeterSeat = seat(state, 'w1', 'greeter');
    const decliner = holder(state, greeterSeat);
    await step({ type: 'decline', assignmentId: greeterSeat }, decliner);
    const busy = new Set(state.assignments.filter((a) => a.eventId === 'w1').map((a) => a.memberId));
    const coverer = state.rotations.find((r) => r.responsibilityId === 'greeter')!.queue.find((m) => !busy.has(m))!;
    await step({ type: 'cover', assignmentId: greeterSeat }, coverer);
    await step({ type: 'reorderQueue', responsibilityId: 'sound', queue: ['dee', 'cal', 'ben', 'ana'] });
    await step({ type: 'setAdmin', memberId: 'ben', isAdmin: true });
    await step({ type: 'renameMember', memberId: 'ben', name: 'Benjamin' }, 'ben');
    await step({ type: 'removeEvent', eventId: 'special' });
    await step({ type: 'removeResponsibility', responsibilityId: 'greeter' });
    await step({ type: 'setPrimaryResponsibility', responsibilityId: 'video' });
    await step({ type: 'reorderResponsibilities', responsibilityIds: ['video', 'sound'] });
    await step({ type: 'removeEventSeries', seriesId: 'sat' });

    expect(state.responsibilities.find((r) => r.id === 'greeter')?.removedAt).toBe(NOW);
    expect(state.eventSeries.find((s) => s.id === 'sat')).toMatchObject({ removedAt: NOW, repeat });
    expect(state.eventSeries.find((s) => s.id === 'sundays')?.repeat).toMatchObject({ frequency: 'monthly', weekOfMonth: -1 });
    expect(state.makeUpTurns[0]).toMatchObject({ status: 'cancelled', closedReason: 'responsibilityRemoved' });
    expect(state.members.find((m) => m.id === 'ben')).toMatchObject({ name: 'Benjamin', isAdmin: true });
    expect(state.events.map((e) => e.id)).not.toContain('special');
    expect(state.primaryResponsibilityId).toBe('video');
    // Removed rows that past history needs stay in the database.
    const rows = await t.db.query<{ id: string; removed_at: string | null }>(
      'select id, removed_at from public.responsibilities where group_id = $1 order by position',
      [groupId],
    );
    expect(rows.rows.map((r) => [r.id, r.removed_at !== null])).toEqual([['video', false], ['sound', false], ['greeter', true]]);
  });

  it('refuses a malformed repeat pattern', async () => {
    const groupId = uuid(107);
    const created = run(newGroupState(groupId, { ana: uuid(1) }), { type: 'fillSchedule' }, 'ana');
    await persistAndReload(groupId, null, created);
    const rows = rowsFromState(created.state);
    for (const repeat of [
      { frequency: 'yearly', intervalWeeks: null, daysOfWeek: [0], weekOfMonth: null, startTime: '09:00', timeZone: 'UTC', startsOn: '2027-01-03' },
      { frequency: 'custom', intervalWeeks: null, daysOfWeek: [0], weekOfMonth: null, startTime: '09:00', timeZone: 'UTC', startsOn: '2027-01-03' },
      { frequency: 'weekly', intervalWeeks: null, daysOfWeek: [7], weekOfMonth: null, startTime: '09:00', timeZone: 'UTC', startsOn: '2027-01-03' },
      { frequency: 'weekly', intervalWeeks: null, daysOfWeek: [0], weekOfMonth: null, startTime: '9am', timeZone: 'UTC', startsOn: '2027-01-03' },
      // The newer options (20261122000000_repeat_options.sql)
      { frequency: 'daily', intervalWeeks: null, daysOfWeek: [], weekOfMonth: null, startTime: '09:00', timeZone: 'UTC', startsOn: '2027-01-03' },
      { frequency: 'daily', intervalWeeks: null, intervalDays: 2, daysOfWeek: [1], weekOfMonth: null, startTime: '09:00', timeZone: 'UTC', startsOn: '2027-01-03' },
      { frequency: 'weekly', intervalWeeks: null, intervalDays: 2, daysOfWeek: [0], weekOfMonth: null, startTime: '09:00', timeZone: 'UTC', startsOn: '2027-01-03' },
      { frequency: 'monthly', intervalWeeks: null, daysOfWeek: [], weekOfMonth: 1, dayOfMonth: 15, startTime: '09:00', timeZone: 'UTC', startsOn: '2027-01-03' },
      { frequency: 'monthly', intervalWeeks: null, daysOfWeek: [0], weekOfMonth: null, dayOfMonth: 15, startTime: '09:00', timeZone: 'UTC', startsOn: '2027-01-03' },
      { frequency: 'monthly', intervalWeeks: null, daysOfWeek: [], weekOfMonth: 1, startTime: '09:00', timeZone: 'UTC', startsOn: '2027-01-03' },
      { frequency: 'weekly', intervalWeeks: null, daysOfWeek: [0], weekOfMonth: null, dayOfMonth: 3, startTime: '09:00', timeZone: 'UTC', startsOn: '2027-01-03' },
      { frequency: 'weekly', intervalWeeks: null, daysOfWeek: [0], weekOfMonth: null, intervalMonths: 2, startTime: '09:00', timeZone: 'UTC', startsOn: '2027-01-03' },
      { frequency: 'weekly', intervalWeeks: null, daysOfWeek: [0], weekOfMonth: null, endsOn: 'soon', startTime: '09:00', timeZone: 'UTC', startsOn: '2027-01-03' },
      { frequency: 'weekly', intervalWeeks: null, daysOfWeek: [0], weekOfMonth: null, endsOn: '2027-06-30', endsAfter: 4, startTime: '09:00', timeZone: 'UTC', startsOn: '2027-01-03' },
    ]) {
      const bad = { ...rows, event_series: rows.event_series.map((s) => ({ ...s, repeat: repeat as unknown as RepeatPattern })) };
      await expect(t.store.persist({ groupId, expectedVersion: 1, rows: bad, history: [] }), JSON.stringify(repeat)).rejects.toThrow(
        /check constraint/,
      );
    }
  });

  it('stores and reloads the newer repeat options exactly', async () => {
    const groupId = uuid(108);
    let result = run(newGroupState(groupId, { ana: uuid(1) }), { type: 'fillSchedule' }, 'ana');
    let { version, state } = await persistAndReload(groupId, null, result);
    const base = { intervalWeeks: null, weekOfMonth: null, startTime: '09:00', timeZone: 'America/Chicago', startsOn: '2027-01-03' };
    const patterns: RepeatPattern[] = [
      { ...base, frequency: 'daily', intervalDays: 10, daysOfWeek: [], endsAfter: 6 },
      { ...base, frequency: 'monthly', dayOfMonth: 31, daysOfWeek: [], intervalMonths: 3, endsOn: '2027-06-30' },
      { ...base, frequency: 'monthly', weekOfMonth: 1, daysOfWeek: [2], intervalMonths: 3 },
    ];
    for (const [i, repeat] of patterns.entries()) {
      result = run(state, { type: 'addEventSeries', series: { id: `s${i}`, name: `S${i}`, responsibilityIds: ['sound'], repeat } }, 'ana');
      ({ version, state } = await persistAndReload(groupId, version, result));
      expect(state).toEqual(result.state);
      expect(state.eventSeries.find((s) => s.id === `s${i}`)?.repeat).toEqual(repeat);
    }
  });

  it('stores history entries with the version that produced them', async () => {
    const groupId = uuid(101);
    const created = run(newGroupState(groupId, { ana: uuid(1) }), { type: 'fillSchedule' }, 'ana');
    const { state } = await persistAndReload(groupId, null, created);
    const declined = run(state, { type: 'decline', assignmentId: seat(state, 'w1', 'sound') }, holder(state, seat(state, 'w1', 'sound')));
    await persistAndReload(groupId, 1, declined);

    const { rows } = await t.db.query<{ state_version: number; cause_type: string; actor_id: string | null; changes: unknown[] }>(
      'select state_version::int, cause_type, actor_id, changes from public.schedule_history where group_id = $1 order by id',
      [groupId],
    );
    expect(rows.map((r) => [r.state_version, r.cause_type])).toEqual([
      [1, 'fillSchedule'],
      [2, 'decline'],
    ]);
    expect(rows[1].actor_id).toBe(declined.history[0].actorId);
    expect(rows[1].changes).toEqual(JSON.parse(JSON.stringify(declined.history[0].changes)));
  });

  it('rejects a stale state_version and leaves the Group untouched', async () => {
    const groupId = uuid(102);
    const created = run(newGroupState(groupId, { ana: uuid(1) }), { type: 'fillSchedule' }, 'ana');
    const { state } = await persistAndReload(groupId, null, created);
    const first = run(state, { type: 'addSkipDate', eventId: 'w1' }, 'ana');
    const second = run(state, { type: 'addSkipDate', eventId: 'w2' }, 'ana');
    await persistAndReload(groupId, 1, first);

    const stale = await t.store.persist({ groupId, expectedVersion: 1, rows: rowsFromState(second.state), history: second.history });
    expect(stale).toBeNull();
    const loaded = await t.store.load(groupId);
    expect(loaded?.version).toBe(2);
    expect(stateFromRows(loaded!.rows)).toEqual(first.state);
  });

  it('refuses to create a Group that already exists', async () => {
    const groupId = uuid(103);
    const created = run(newGroupState(groupId, { ana: uuid(1) }), { type: 'fillSchedule' }, 'ana');
    await persistAndReload(groupId, null, created);
    const again = await t.store.persist({
      groupId,
      expectedVersion: null,
      rows: rowsFromState(created.state),
      newGroup: { name: 'Again', time_zone: 'UTC', created_by: uuid(1) },
      history: [],
    });
    expect(again).toBeNull();
  });

  it('leaves unchanged rows alone, so Realtime only sees real changes', async () => {
    const groupId = uuid(104);
    const created = run(newGroupState(groupId, { ana: uuid(1) }), { type: 'fillSchedule' }, 'ana');
    const { state } = await persistAndReload(groupId, null, created);
    const xmins = async () =>
      new Map(
        (
          await t.db.query<{ id: string; x: string }>(
            'select id, xmin::text x from public.assignments where group_id = $1',
            [groupId],
          )
        ).rows.map((r) => [r.id, r.x]),
      );
    const before = await xmins();
    const target = seat(state, 'w1', 'sound');
    const confirmed = run(state, { type: 'confirm', assignmentId: target }, holder(state, target));
    await persistAndReload(groupId, 1, confirmed);
    const after = await xmins();

    const touched = [...after].filter(([id, x]) => before.get(id) !== x).map(([id]) => id);
    expect(touched).toEqual([target]);
  });

  it('refuses a payload missing a row array, which would otherwise delete everything', async () => {
    const groupId = uuid(105);
    const created = run(newGroupState(groupId, { ana: uuid(1) }), { type: 'fillSchedule' }, 'ana');
    await persistAndReload(groupId, null, created);
    const { assignments: _, ...partial } = rowsFromState(created.state);
    await expect(
      t.as('service_role', null, () =>
        t.db.query('select public.apply_group_command_result($1, 1, $2::jsonb)', [groupId, JSON.stringify(partial)]),
      ),
    ).rejects.toThrow(/every row array/);
  });
});
