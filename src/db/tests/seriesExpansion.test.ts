import { beforeAll, describe, expect, it } from 'vitest';

import type { RepeatPattern } from '../../engine';
import { localTime } from '../../schedule/expandSeries';
import { stateFromRows } from '../groupRows';
import { extendHorizons, handleGroupCommand, missingSeriesEvents, type HandlerContext } from '../handleGroupCommand';
import type { ClientCommand, GroupCommandResponse } from '../protocol';
import { createTestDb, uuid, type TestDb } from './pglite';

const ANA = uuid(201);
const NOW = '2026-11-15T12:00:00.000Z';

let t: TestDb;
let nextUuid = 5000;
let clock = NOW;

const context = (): HandlerContext => ({ accountId: ANA, now: () => clock, newId: () => uuid(nextUuid++) });

function expectOk(response: GroupCommandResponse) {
  if (!response.ok) throw new Error(`Expected ok, got ${response.reason}: ${response.message}`);
  return response;
}

const loadState = async (groupId: string) => stateFromRows((await t.store.load(groupId))!.rows);
const version = async (groupId: string) => (await t.store.load(groupId))!.version;

const sundays10: RepeatPattern = {
  frequency: 'weekly',
  intervalWeeks: null,
  daysOfWeek: [0],
  weekOfMonth: null,
  startTime: '10:00',
  timeZone: 'America/Chicago',
  startsOn: '2026-11-15',
};

async function setupGroup(name = 'Series crew') {
  clock = NOW;
  const { groupId } = expectOk(
    await handleGroupCommand(t.store, { action: 'createGroup', name, memberName: 'Ana', timeZone: 'America/Chicago' }, context()),
  );
  const command = (c: ClientCommand) =>
    handleGroupCommand(t.store, { action: 'command', groupId, command: c }, context()).then(expectOk);
  await command({ type: 'addResponsibility', responsibility: { id: 'sound', name: 'Sound', headcount: 1, requiresConfirmation: false } });
  await command({ type: 'addResponsibility', responsibility: { id: 'greeter', name: 'Greeter', headcount: 2, requiresConfirmation: true } });
  for (const n of ['Pat', 'Sam', 'Lee']) await command({ type: 'addMember', member: { name: n }, qualifiedFor: ['sound', 'greeter'] });
  return { groupId, command };
}

beforeAll(async () => {
  t = await createTestDb();
  await t.createAccount(ANA);
});

describe('addEventSeries with a repeat pattern', () => {
  it('creates 12 weeks of Events at the local time and fills them, in one request', async () => {
    const { groupId, command } = await setupGroup();
    const before = await version(groupId);
    const result = await command({
      type: 'addEventSeries',
      series: { id: 'sun', name: 'Sundays', responsibilityIds: ['sound', 'greeter'], repeat: sundays10 },
    });
    expect(await version(groupId)).toBe(before + 1);
    expect(result.history).toHaveLength(1);

    const state = await loadState(groupId);
    const events = state.events.filter((e) => e.seriesId === 'sun');
    expect(events).toHaveLength(12);
    expect(new Set(events.map((e) => localTime(e.startsAt, 'America/Chicago')))).toEqual(new Set(['10:00']));
    for (const e of events) {
      expect(state.assignments.filter((a) => a.eventId === e.id && a.responsibilityId === 'sound')).toHaveLength(1);
      expect(state.assignments.filter((a) => a.eventId === e.id && a.responsibilityId === 'greeter')).toHaveLength(2);
    }
  });

  it('keeps client-sent Events as they are (no expansion)', async () => {
    const { groupId, command } = await setupGroup();
    await command({
      type: 'addEventSeries',
      series: { id: 'sun', name: 'Sundays', responsibilityIds: ['sound'], repeat: sundays10 },
      events: [{ id: 'only', seriesId: 'sun', startsAt: '2026-11-22T16:00:00.000Z' }],
    });
    expect((await loadState(groupId)).events.map((e) => e.id)).toEqual(['only']);
  });

  it('a series without a pattern gets no Events', async () => {
    const { groupId, command } = await setupGroup();
    await command({ type: 'addEventSeries', series: { id: 'adhoc', name: 'Ad hoc', responsibilityIds: ['sound'] } });
    expect((await loadState(groupId)).events).toEqual([]);
  });
});

describe('editEventSeries with a new pattern', () => {
  it('moves future Events to the new time and refills them; same-time Events keep their ids', async () => {
    const { groupId, command } = await setupGroup();
    await command({ type: 'addEventSeries', series: { id: 'sun', name: 'Sundays', responsibilityIds: ['sound'], repeat: sundays10 } });

    // Every other week: half the Events stay, untouched.
    const before = await loadState(groupId);
    await command({ type: 'editEventSeries', seriesId: 'sun', changes: { repeat: { ...sundays10, frequency: 'biweekly' } } });
    const biweekly = await loadState(groupId);
    expect(biweekly.events).toHaveLength(6);
    for (const e of biweekly.events) expect(before.events.find((b) => b.id === e.id)?.startsAt).toBe(e.startsAt);

    // A new time: every future Event moves, and the Assignments follow.
    const result = await command({ type: 'editEventSeries', seriesId: 'sun', changes: { repeat: { ...sundays10, startTime: '11:15' } } });
    const moved = await loadState(groupId);
    expect(moved.events).toHaveLength(12);
    expect(new Set(moved.events.map((e) => localTime(e.startsAt, 'America/Chicago')))).toEqual(new Set(['11:15']));
    expect(moved.assignments.filter((a) => a.responsibilityId === 'sound')).toHaveLength(12);
    expect(result.changes.length).toBeGreaterThan(0);
  });

  it('a name-only edit leaves the Events alone', async () => {
    const { groupId, command } = await setupGroup();
    await command({ type: 'addEventSeries', series: { id: 'sun', name: 'Sundays', responsibilityIds: ['sound'], repeat: sundays10 } });
    const before = (await loadState(groupId)).events;
    await command({ type: 'editEventSeries', seriesId: 'sun', changes: { name: 'Sunday mornings' } });
    expect((await loadState(groupId)).events).toEqual(before);
  });
});

describe('createGroup with a repeating series', () => {
  it('expands it up to the horizon', async () => {
    clock = NOW;
    const created = expectOk(
      await handleGroupCommand(
        t.store,
        {
          action: 'createGroup',
          name: 'Created with series',
          memberName: 'Ana',
          responsibilities: [{ id: 'host', name: 'Host', headcount: 1, requiresConfirmation: false }],
          creatorQualifiedFor: ['host'],
          eventSeries: [{ id: 'fri', name: 'Fridays', responsibilityIds: ['host'], repeat: { ...sundays10, daysOfWeek: [5] } }],
        },
        context(),
      ),
    );
    const state = await loadState(created.groupId);
    expect(state.events).toHaveLength(12);
    expect(state.assignments).toHaveLength(12);
  });
});

describe('is_service_role_caller (the system action check)', () => {
  it('only service_role may call it', async () => {
    const call = () => t.db.query<{ ok: boolean }>('select public.is_service_role_caller() as ok');
    expect((await t.as('service_role', null, call)).rows[0].ok).toBe(true);
    await expect(t.as('anon', null, call)).rejects.toThrow(/permission denied/);
    await expect(t.asUser(ANA, call)).rejects.toThrow(/permission denied/);
  });

  it('the horizon job function is not callable by app users', async () => {
    const call = () => t.db.query('select public.request_event_horizon_extension()');
    await expect(t.as('anon', null, call)).rejects.toThrow(/permission denied/);
    await expect(t.asUser(ANA, call)).rejects.toThrow(/permission denied/);
  });
});

describe('extendHorizons (the daily job)', () => {
  it('adds only the missing weeks, keeps 10:00 local across DST, and skips Groups with nothing to add', async () => {
    const { groupId, command } = await setupGroup('Horizon crew');
    await command({ type: 'addEventSeries', series: { id: 'sun', name: 'Sundays', responsibilityIds: ['sound'], repeat: sundays10 } });

    // Nothing missing yet: the Group isn't written.
    const v0 = await version(groupId);
    let report = await extendHorizons(t.store, { now: () => clock });
    expect(report.failed).toBe(0);
    expect(await version(groupId)).toBe(v0);

    // Ten weeks later the horizon reaches past the spring-forward change (Mar 14 2027).
    clock = '2027-01-24T12:00:00.000Z';
    report = await extendHorizons(t.store, { now: () => clock });
    expect(report.extended).toBeGreaterThanOrEqual(1);
    const state = await loadState(groupId);
    const series = state.events.filter((e) => e.seriesId === 'sun');
    expect(series).toHaveLength(22);
    expect(new Set(series.map((e) => e.id)).size).toBe(22);
    expect(new Set(series.map((e) => localTime(e.startsAt, 'America/Chicago')))).toEqual(new Set(['10:00']));
    expect(series.map((e) => e.startsAt)).toEqual(expect.arrayContaining(['2027-03-07T16:00:00.000Z', '2027-03-14T15:00:00.000Z']));
    const future = series.filter((e) => Date.parse(e.startsAt) > Date.parse(clock));
    for (const e of future) expect(state.assignments.some((a) => a.eventId === e.id)).toBe(true);
    const lastHistory = await t.db.query<{ actor_id: string | null }>(
      'select actor_id from public.schedule_history where group_id = $1 order by state_version desc limit 1',
      [groupId],
    );
    expect(lastHistory.rows[0].actor_id).toBeNull();

    // Running again the same day adds nothing.
    const v1 = await version(groupId);
    await extendHorizons(t.store, { now: () => clock });
    expect(await version(groupId)).toBe(v1);
  });

  it('ignores removed series', async () => {
    const { groupId, command } = await setupGroup('Removed series');
    await command({ type: 'addEventSeries', series: { id: 'sun', name: 'Sundays', responsibilityIds: ['sound'], repeat: sundays10 } });
    await command({ type: 'removeEventSeries', seriesId: 'sun' });
    expect(missingSeriesEvents(await loadState(groupId), '2027-01-24T12:00:00.000Z')).toEqual([]);
  });
});
