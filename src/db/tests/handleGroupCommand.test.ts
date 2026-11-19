import { beforeAll, describe, expect, it } from 'vitest';

import { stateFromRows } from '../groupRows';
import { handleGroupCommand, type GroupStore, type HandlerContext } from '../handleGroupCommand';
import type { GroupCommandRequest, GroupCommandResponse } from '../protocol';
import { NOW, week } from './fixtures';
import { createTestDb, uuid, type TestDb } from './pglite';

const ANA = uuid(1);
const BEN = uuid(2);
const CAL = uuid(3);
const DEE = uuid(4);

let t: TestDb;
let nextUuid = 1000;

const contextFor = (accountId: string, extra: Partial<HandlerContext> = {}): HandlerContext => ({
  accountId,
  now: () => NOW,
  newId: () => uuid(nextUuid++),
  ...extra,
});

const send = (accountId: string, request: GroupCommandRequest | unknown, store: GroupStore = t.store) =>
  handleGroupCommand(store, request, contextFor(accountId));

function expectOk(response: GroupCommandResponse) {
  if (!response.ok) throw new Error(`Expected ok, got ${response.reason}: ${response.message}`);
  return response;
}

const loadState = async (groupId: string) => stateFromRows((await t.store.load(groupId))!.rows);

const inviteToken = async (groupId: string) =>
  (await t.db.query<{ token: string }>('select token from public.invite_links where group_id = $1 and member_id is null', [groupId]))
    .rows[0].token;

/** Creates a Group (ana is Admin and Qualified for Sound) that ben and cal join. */
async function crewGroup() {
  const created = expectOk(
    await send(ANA, {
      action: 'createGroup',
      name: 'Sunday crew',
      memberName: 'Ana',
      timeZone: 'America/Chicago',
      responsibilities: [{ id: 'sound', name: 'Sound', headcount: 1, requiresConfirmation: true }],
      primaryResponsibilityId: 'sound',
      eventSeries: [{ id: 'sun', name: 'Sundays', responsibilityIds: ['sound'] }],
      creatorQualifiedFor: ['sound'],
    }),
  );
  const { groupId } = created;
  const token = await inviteToken(groupId);
  const ben = expectOk(await send(BEN, { action: 'join', token, memberName: 'Ben' }));
  const cal = expectOk(await send(CAL, { action: 'join', token, memberName: 'Cal' }));
  for (const memberId of [ben.memberId, cal.memberId]) {
    expectOk(await send(ANA, { action: 'command', groupId, command: { type: 'qualifyMember', memberId, responsibilityId: 'sound' } }));
  }
  expectOk(
    await send(ANA, {
      action: 'command',
      groupId,
      command: { type: 'addEvents', events: [1, 2, 3, 4].map((n) => ({ id: `w${n}`, seriesId: 'sun', startsAt: week(n) })) },
    }),
  );
  return { groupId, ana: created.memberId, ben: ben.memberId, cal: cal.memberId };
}

beforeAll(async () => {
  t = await createTestDb();
  for (const id of [ANA, BEN, CAL, DEE]) await t.createAccount(id);
});

describe('createGroup', () => {
  it('creates the Group with the caller as its Admin and fills the schedule', async () => {
    const { groupId, ana } = await crewGroup();
    const state = await loadState(groupId);
    expect(state.members.find((m) => m.id === ana)).toMatchObject({ isAdmin: true, accountId: ANA, name: 'Ana' });
    expect(state.rotations[0].queue).toHaveLength(3);
    expect(state.assignments.filter((a) => a.responsibilityId === 'sound')).toHaveLength(4);

    const row = await t.db.query<{ name: string; time_zone: string; created_by: string }>(
      'select name, time_zone, created_by from public.groups where id = $1',
      [groupId],
    );
    expect(row.rows[0]).toEqual({ name: 'Sunday crew', time_zone: 'America/Chicago', created_by: ANA });
    const history = await t.db.query<{ cause_type: string }>(
      'select cause_type from public.schedule_history where group_id = $1 order by id',
      [groupId],
    );
    expect(history.rows.map((r) => r.cause_type)).toEqual([
      'fillSchedule',
      'addMember',
      'addMember',
      'qualifyMember',
      'qualifyMember',
      'addEvents',
    ]);
  });

  it('rejects a malformed request', async () => {
    const response = await send(ANA, { action: 'createGroup', name: '', memberName: 'Ana' });
    expect(response).toMatchObject({ ok: false, reason: 'invalidRequest' });
    const unknownPrimary = await send(ANA, { action: 'createGroup', name: 'X', memberName: 'A', primaryResponsibilityId: 'nope' });
    expect(unknownPrimary).toMatchObject({ ok: false, reason: 'invalidRequest' });
  });
});

describe('join', () => {
  it('rejects an unknown token and a second join by the same account', async () => {
    const { groupId, ben } = await crewGroup();
    expect(await send(DEE, { action: 'join', token: 'nope', memberName: 'Dee' })).toMatchObject({
      ok: false,
      reason: 'invalidInvite',
    });
    expect(await send(BEN, { action: 'join', token: await inviteToken(groupId), memberName: 'Ben' })).toMatchObject({
      ok: false,
      reason: 'alreadyMember',
      groupId,
      memberId: ben,
    });
  });

  it('claims a Placeholder through its personal link, which then stops working', async () => {
    const { groupId } = await crewGroup();
    const added = expectOk(
      await send(ANA, { action: 'command', groupId, command: { type: 'addMember', member: { name: 'Dee' }, qualifiedFor: ['sound'] } }),
    );
    const dee = (await loadState(groupId)).members.find((m) => m.name === 'Dee')!;
    expect(dee.accountId).toBeNull();
    expect(added.memberId).not.toBe(dee.id);
    const claimToken = await t.asUser(ANA, () =>
      t.db.query<{ t: string }>('select public.claim_link_for($1, $2) t', [groupId, dee.id]).then((r) => r.rows[0].t),
    );

    const claimed = expectOk(await send(DEE, { action: 'join', token: claimToken, memberName: 'ignored' }));
    expect(claimed.memberId).toBe(dee.id);
    expect((await loadState(groupId)).members.find((m) => m.id === dee.id)?.accountId).toBe(DEE);

    // The link is spent, and Dee can now read the Group.
    expect(await send(BEN, { action: 'join', token: claimToken, memberName: 'Ben' })).toMatchObject({
      reason: 'invalidInvite',
    });
    const visible = await t.asUser(DEE, () => t.db.query('select id from public.groups where id = $1', [groupId]));
    expect(visible.rows).toHaveLength(1);
  });
});

describe('command', () => {
  it('rejects callers who are not active Members', async () => {
    const { groupId } = await crewGroup();
    expect(await send(DEE, { action: 'command', groupId, command: { type: 'addSkipDate', eventId: 'w1' } })).toMatchObject({
      ok: false,
      reason: 'notMember',
    });
    expect(await send(ANA, { action: 'command', groupId: uuid(9999), command: { type: 'fillSchedule' } })).toMatchObject({
      reason: 'notMember',
    });
  });

  it('lets a plain Member run every command that used to be Admin-only (no Admins for now)', async () => {
    const { groupId, ben } = await crewGroup();
    const asBen = async (command: unknown) => expectOk(await send(BEN, { action: 'command', groupId, command }));
    expect((await loadState(groupId)).members.find((m) => m.id === ben)?.isAdmin).toBe(false);

    await asBen({ type: 'fillSchedule' });
    await asBen({ type: 'addEvents', events: [{ id: 'w9', seriesId: 'sun', startsAt: week(9) }] });
    await asBen({ type: 'requestConfirmation', assignmentIds: [] });
    await asBen({ type: 'addMember', member: { name: 'Eve' } });
    await asBen({ type: 'addResponsibility', responsibility: { id: 'video', name: 'Video', headcount: 1, requiresConfirmation: false } });
    await asBen({ type: 'qualifyMember', memberId: ben, responsibilityId: 'video' });
    await asBen({ type: 'unqualifyMember', memberId: ben, responsibilityId: 'video' });
    await asBen({ type: 'editResponsibility', responsibilityId: 'sound', changes: { name: 'Audio' } });
    await asBen({ type: 'reorderResponsibilities', responsibilityIds: ['video', 'sound'] });
    await asBen({ type: 'setPrimaryResponsibility', responsibilityId: 'video' });
    const queue = (await loadState(groupId)).rotations.find((r) => r.responsibilityId === 'sound')!.queue;
    await asBen({ type: 'reorderQueue', responsibilityId: 'sound', queue: [...queue].reverse() });
    await asBen({ type: 'addEventSeries', series: { id: 'sat', name: 'Saturdays', responsibilityIds: ['sound'] } });
    await asBen({ type: 'editEventSeries', seriesId: 'sat', changes: { name: 'Sat' } });
    await asBen({ type: 'removeEventSeries', seriesId: 'sat' });
    await asBen({ type: 'addEvents', events: [{ id: 'once', seriesId: null, startsAt: week(10), responsibilityIds: ['sound'] }] });
    await asBen({ type: 'removeEvent', eventId: 'once' });
    await asBen({ type: 'changeSettings', settings: { allowDoubling: true } });
    await asBen({ type: 'rebalance', responsibilityId: 'sound' });
    await asBen({ type: 'removeResponsibility', responsibilityId: 'video' });
    await asBen({ type: 'addSkipDate', eventId: 'w4' });
    // The hidden Admin flag can still be set, but grants nothing.
    await asBen({ type: 'setAdmin', memberId: ben, isAdmin: true });
    await asBen({ type: 'setAdmin', memberId: ben, isAdmin: false });

    const state = await loadState(groupId);
    expect(state.responsibilities.map((r) => [r.name, r.removedAt === null])).toEqual([['Video', false], ['Audio', true]]);
    expect(state.settings.allowDoubling).toBe(true);
    // The Stand-in Ben added is in every current Job's Rotation, like anyone.
    const eve = state.members.find((m) => m.name === 'Eve')!;
    expect(eve.accountId).toBeNull();
    expect(state.rotations.find((r) => r.responsibilityId === 'sound')?.queue).toContain(eve.id);
  });

  it('keeps one person’s own things theirs: Time Off, name and membership, except for a Stand-in', async () => {
    const { groupId, ana, ben } = await crewGroup();
    const asBen = (command: unknown) => send(BEN, { action: 'command', groupId, command });
    expectOk(await asBen({ type: 'addMember', member: { name: 'Dee' } }));
    const dee = (await loadState(groupId)).members.find((m) => m.name === 'Dee')!.id;

    const timeOff = (memberId: string) => ({
      type: 'addTimeOff',
      timeOff: { id: `t-${memberId}`, memberId, startsAt: week(2), endsAt: week(3) },
    });
    expect(await asBen(timeOff(ana))).toMatchObject({ ok: false, reason: 'notPermitted' });
    expectOk(await asBen(timeOff(ben)));
    expectOk(await asBen(timeOff(dee)));
    expectOk(await send(ANA, { action: 'command', groupId, command: timeOff(ana) }));
    expect(await asBen({ type: 'removeTimeOff', timeOffId: `t-${ana}` })).toMatchObject({ reason: 'notPermitted' });
    expectOk(await asBen({ type: 'removeTimeOff', timeOffId: `t-${ben}` }));
    expectOk(await asBen({ type: 'removeTimeOff', timeOffId: `t-${dee}` }));

    expect(await asBen({ type: 'renameMember', memberId: ana, name: 'Annie' })).toMatchObject({ reason: 'notPermitted' });
    expectOk(await asBen({ type: 'renameMember', memberId: dee, name: 'Deb' }));
    expect(await asBen({ type: 'removeMember', memberId: ana })).toMatchObject({ reason: 'notPermitted' });
    expectOk(await asBen({ type: 'removeMember', memberId: dee }));
  });

  it('lets anyone leave, including the Group’s creator (no last-Admin guard)', async () => {
    const { groupId, ana } = await crewGroup();
    const asAna = (command: unknown) => send(ANA, { action: 'command', groupId, command });
    expectOk(await asAna({ type: 'removeMember', memberId: ana }));
    expect(await asAna({ type: 'fillSchedule' })).toMatchObject({ ok: false, reason: 'notMember' });
  });

  it('runs the setup commands and persists them', async () => {
    const { groupId, ben, cal } = await crewGroup();
    const asAna = async (command: unknown) => expectOk(await send(ANA, { action: 'command', groupId, command }));
    await asAna({ type: 'addResponsibility', responsibility: { id: 'video', name: 'Video', headcount: 1, requiresConfirmation: false }, qualifiedMemberIds: [ben, cal] });
    await asAna({
      type: 'addEventSeries',
      series: {
        id: 'sat',
        name: 'Saturdays',
        responsibilityIds: ['video'],
        repeat: { frequency: 'biweekly', intervalWeeks: null, daysOfWeek: [6], weekOfMonth: null, startTime: '18:00', timeZone: 'America/Chicago', startsOn: '2027-01-09' },
      },
      events: [{ id: 's1', seriesId: 'sat', startsAt: '2027-01-10T00:00:00Z' }],
    });
    await asAna({ type: 'editResponsibility', responsibilityId: 'sound', changes: { headcount: 2 } });
    expectOk(await send(BEN, { action: 'command', groupId, command: { type: 'renameMember', memberId: ben, name: 'Benny' } }));

    const state = await loadState(groupId);
    expect(state.responsibilities.map((r) => [r.id, r.headcount])).toEqual([['sound', 2], ['video', 1]]);
    expect(state.eventSeries.find((s) => s.id === 'sat')?.repeat?.frequency).toBe('biweekly');
    expect(state.assignments.filter((a) => a.eventId === 'w1')).toHaveLength(2);
    expect(state.assignments.find((a) => a.eventId === 's1')?.memberId).toBe(ben);
    expect(state.members.find((m) => m.id === ben)?.name).toBe('Benny');
  });

  it('passes engine rejections through', async () => {
    const { groupId } = await crewGroup();
    const state = await loadState(groupId);
    const seat = state.assignments.find((a) => a.eventId === 'w1')!;
    const notHolder = state.members.find((m) => m.id !== seat.memberId && !m.isAdmin)!;
    const account = [ANA, BEN, CAL][state.members.indexOf(notHolder)];
    expect(await send(account, { action: 'command', groupId, command: { type: 'decline', assignmentId: seat.id } })).toMatchObject({
      ok: false,
      reason: 'notPermitted',
    });
    expect(await send(ANA, { action: 'command', groupId, command: { type: 'confirm', assignmentId: 'nope' } })).toMatchObject({
      reason: 'notFound',
    });
  });

  it('returns changes and history, and persists them', async () => {
    const { groupId } = await crewGroup();
    const before = await loadState(groupId);
    const response = expectOk(await send(ANA, { action: 'command', groupId, command: { type: 'addSkipDate', eventId: 'w1' } }));
    expect(response.changes.length).toBeGreaterThan(0);
    expect(response.history.at(-1)?.cause).toEqual({ type: 'addSkipDate', eventId: 'w1' });
    const after = await loadState(groupId);
    expect(after.events.find((e) => e.id === 'w1')?.skipDate).not.toBeNull();
    expect(after.assignments).not.toEqual(before.assignments);
  });

  it('lets exactly one of two simultaneous Covers win; the other gets alreadyCovered', async () => {
    const { groupId } = await crewGroup();
    const state = await loadState(groupId);
    const seat = state.assignments.find((a) => a.eventId === 'w1')!;
    const accountOf = new Map(state.members.map((m) => [m.id, m.accountId!]));
    expectOk(await send(accountOf.get(seat.memberId!)!, { action: 'command', groupId, command: { type: 'decline', assignmentId: seat.id } }));
    const [first, second] = state.members.filter((m) => m.id !== seat.memberId).map((m) => accountOf.get(m.id)!);

    // Both callers load the same state before either saves.
    // The first load waits until the second has loaded too; later loads (retries) pass straight through.
    let loads = 0;
    let releaseFirst: () => void = () => {};
    const firstMayProceed = new Promise<void>((resolve) => (releaseFirst = resolve));
    const barrier: GroupStore = {
      ...t.store,
      load: async (id) => {
        const loaded = await t.store.load(id);
        loads++;
        if (loads === 1) await firstMayProceed;
        else if (loads === 2) releaseFirst();
        return loaded;
      },
    };
    const cover = { action: 'command', groupId, command: { type: 'cover', assignmentId: seat.id } };
    const results = await Promise.all([send(first, cover, barrier), send(second, cover, barrier)]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ ok: false, reason: 'alreadyCovered' });
    const cover1 = (await loadState(groupId)).assignments.find((a) => a.id === seat.id)!.coverageRequest!.cover;
    expect(cover1?.kind).toBe('member');
  });

  it('gives up with `conflict` when the version keeps moving', async () => {
    const { groupId } = await crewGroup();
    let persists = 0;
    const alwaysStale: GroupStore = {
      ...t.store,
      persist: async () => {
        persists++;
        return null;
      },
    };
    const response = await handleGroupCommand(
      alwaysStale,
      { action: 'command', groupId, command: { type: 'addSkipDate', eventId: 'w2' } },
      contextFor(ANA, { maxAttempts: 3 }),
    );
    expect(response).toMatchObject({ ok: false, reason: 'conflict' });
    expect(persists).toBe(3);
  });
});

describe('Stand-ins and outside covers (simplify ticket 04)', () => {
  const seatOf = async (groupId: string, memberId: string) =>
    (await loadState(groupId)).assignments.find((a) => a.memberId === memberId && a.coverageRequest === null)!;

  it('joining puts the new Member in every Job’s Rotation', async () => {
    const { groupId, ben, cal } = await crewGroup();
    const queue = (await loadState(groupId)).rotations.find((r) => r.responsibilityId === 'sound')!.queue;
    expect(queue).toEqual(expect.arrayContaining([ben, cal]));
  });

  it('any Member adds a Stand-in, says they can’t make it for them, and gets the link they claim their spot with', async () => {
    const { groupId, cal } = await crewGroup();
    const asBen = (command: unknown) => send(BEN, { action: 'command', groupId, command });
    expectOk(await asBen({ type: 'addMember', member: { name: 'Dee' } }));
    const dee = (await loadState(groupId)).members.find((m) => m.name === 'Dee')!;
    expect(dee.accountId).toBeNull();
    const deeSeat = await seatOf(groupId, dee.id);
    expect(deeSeat).toBeDefined();

    // Ben says Dee can't make it: the request is Dee's.
    expectOk(await asBen({ type: 'decline', assignmentId: deeSeat.id, reason: 'Away' }));
    const request = (await loadState(groupId)).assignments.find((a) => a.id === deeSeat.id)!.coverageRequest;
    expect(request).toMatchObject({ reason: 'declined', requestedBy: dee.id, note: 'Away', cover: null });
    // But not for another app user.
    const calSeat = await seatOf(groupId, cal);
    expect(await asBen({ type: 'decline', assignmentId: calSeat.id })).toMatchObject({ ok: false, reason: 'notPermitted' });

    // Dee claims their spot through the personal link any Member can get.
    const claimToken = await t.asUser(BEN, () =>
      t.db.query<{ t: string }>('select public.claim_link_for($1, $2) t', [groupId, dee.id]).then((r) => r.rows[0].t),
    );
    expect(expectOk(await send(DEE, { action: 'join', token: claimToken, memberName: 'ignored' })).memberId).toBe(dee.id);
    const claimed = await loadState(groupId);
    expect(claimed.members.find((m) => m.id === dee.id)?.accountId).toBe(DEE);
    expect(claimed.rotations.find((r) => r.responsibilityId === 'sound')?.queue).toContain(dee.id);
  });

  it('“I’ll find someone to cover”: a Member cover is set in one step and is a swap', async () => {
    const { groupId, ben, cal } = await crewGroup();
    const calSeat = await seatOf(groupId, cal);
    const response = expectOk(
      await send(CAL, { action: 'command', groupId, command: { type: 'decline', assignmentId: calSeat.id, coveredBy: { memberId: ben } } }),
    );
    expect(response.history.at(-1)?.cause).toMatchObject({ type: 'decline', coveredBy: { memberId: ben } });
    const state = await loadState(groupId);
    const seat = state.assignments.find((a) => a.id === calSeat.id)!;
    expect(seat.memberId).toBe(ben);
    expect(seat.coverageRequest).toMatchObject({ requestedBy: cal, cover: { kind: 'member', memberId: ben, arrangedBy: cal } });
    expect(state.makeUpTurns).toEqual([expect.objectContaining({ debtorId: cal, creditorId: ben, status: 'outstanding' })]);
  });

  it('“Pick someone to do it”: any Member may hand anyone’s turn to someone else', async () => {
    const { groupId, ana, cal } = await crewGroup();
    const calSeat = await seatOf(groupId, cal);
    expectOk(
      await send(BEN, { action: 'command', groupId, command: { type: 'decline', assignmentId: calSeat.id, coveredBy: { memberId: ana } } }),
    );
    const seat = (await loadState(groupId)).assignments.find((a) => a.id === calSeat.id)!;
    expect(seat.coverageRequest).toMatchObject({ requestedBy: cal, cover: { kind: 'member', memberId: ana } });
  });

  it('an outside cover is a typed name: not a Member, no swap, and kept in history', async () => {
    const { groupId, ana } = await crewGroup();
    const anaSeat = await seatOf(groupId, ana);
    const membersBefore = (await loadState(groupId)).members.length;
    expectOk(
      await send(ANA, {
        action: 'command',
        groupId,
        command: { type: 'decline', assignmentId: anaSeat.id, coveredBy: { guestName: ' Pat Smith ' } },
      }),
    );
    const state = await loadState(groupId);
    const seat = state.assignments.find((a) => a.id === anaSeat.id)!;
    expect(seat.memberId).toBeNull();
    expect(seat.coverageRequest).toMatchObject({ requestedBy: ana, cover: { kind: 'guest', guestName: 'Pat Smith' } });
    expect(state.members).toHaveLength(membersBefore);
    expect(state.makeUpTurns).toEqual([]);
    const history = await t.db.query<{ cause: { coveredBy?: { guestName: string } } }>(
      `select cause from public.schedule_history where group_id = $1 and cause_type = 'decline'`,
      [groupId],
    );
    expect(history.rows.map((r) => r.cause.coveredBy)).toEqual([{ guestName: 'Pat Smith' }]);

    // Any Member may also cover an open request with an outside name ("mark covered").
    const { groupId: g2, cal } = await crewGroup();
    const calSeat = await seatOf(g2, cal);
    expectOk(await send(CAL, { action: 'command', groupId: g2, command: { type: 'decline', assignmentId: calSeat.id } }));
    expectOk(
      await send(BEN, { action: 'command', groupId: g2, command: { type: 'markCovered', assignmentId: calSeat.id, by: { guestName: 'Lee' } } }),
    );
    expect((await loadState(g2)).assignments.find((a) => a.id === calSeat.id)?.coverageRequest?.cover).toMatchObject({
      kind: 'guest',
      guestName: 'Lee',
    });
  });
});
