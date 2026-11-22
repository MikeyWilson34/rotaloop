/**
 * Deleting a Group (feedback-2 ticket 08, docs/adr/0009-deleting-a-group.md), against the real
 * migrations in PGlite: who may delete, that a deleted Group is hidden everywhere (RLS, RPCs,
 * group-command, notify), the "deleted" push, and the hand restore.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import type { ExpoMessage } from '../expo';
import { notifyGroupDeleted, runScheduled, type NotifyDeps, type WebPayload } from '../run';
import { pgliteNotifyStore } from './pgliteNotifyStore';
import { handleGroupCommand, type HandlerContext } from '../../db/handleGroupCommand';
import type { GroupCommandResponse } from '../../db/protocol';
import { NOW, week } from '../../db/tests/fixtures';
import { createTestDb, uuid, type TestDb } from '../../db/tests/pglite';

const ANA = uuid(1);
const BEN = uuid(2);
const CAL = uuid(3);
const OUT = uuid(4);

const SCHEDULING_TABLES = [
  'members',
  'responsibilities',
  'rotations',
  'event_series',
  'events',
  'time_off',
  'make_up_turns',
  'assignments',
  'schedule_history',
  'headcount_answers',
  'invite_links',
];

let t: TestDb;
let nextUuid = 5000;
let groupId: string;
let token: string;

const contextFor = (accountId: string): HandlerContext => ({ accountId, now: () => NOW, newId: () => uuid(nextUuid++) });
const send = (accountId: string, request: unknown) => handleGroupCommand(t.store, request, contextFor(accountId));
const sql = <T>(query: string, params: unknown[] = []) =>
  t.as('service_role', null, async () => (await t.db.query<T>(query, params)).rows);
const asUser = <T>(account: string, query: string, params: unknown[] = []) =>
  t.asUser(account, async () => (await t.db.query<T>(query, params)).rows);

function expectOk(response: GroupCommandResponse) {
  if (!response.ok) throw new Error(`Expected ok, got ${response.reason}: ${response.message}`);
  return response;
}

/** Sunday crew: Ana created it, Ben joined, Cal joined and left; Dee is a Stand-in. */
beforeEach(async () => {
  t = await createTestDb();
  for (const [id, name] of [[ANA, 'Ana Lima'], [BEN, 'Ben'], [CAL, 'Cal'], [OUT, 'Out']] as const) await t.createAccount(id, name);
  const created = expectOk(
    await send(ANA, {
      action: 'createGroup',
      name: 'Sunday crew',
      memberName: 'Ana Lima',
      responsibilities: [{ id: 'sound', name: 'Sound', headcount: 1, requiresConfirmation: false }],
      eventSeries: [{ id: 'sun', name: 'Sundays', responsibilityIds: ['sound'] }],
      creatorQualifiedFor: ['sound'],
    }),
  );
  groupId = created.groupId;
  token = (await sql<{ token: string }>('select token from public.invite_links where group_id = $1 and member_id is null', [groupId]))[0].token;
  const ben = expectOk(await send(BEN, { action: 'join', token, memberName: 'Ben' }));
  const cal = expectOk(await send(CAL, { action: 'join', token, memberName: 'Cal' }));
  expectOk(await send(ANA, { action: 'command', groupId, command: { type: 'addMember', member: { name: 'Dee' } } }));
  expectOk(await send(ANA, { action: 'command', groupId, command: { type: 'qualifyMember', memberId: ben.memberId, responsibilityId: 'sound' } }));
  expectOk(
    await send(ANA, {
      action: 'command',
      groupId,
      command: { type: 'addEvents', events: [1, 2, 3].map((n) => ({ id: `w${n}`, seriesId: 'sun', startsAt: week(n) })) },
    }),
  );
  expectOk(await send(CAL, { action: 'command', groupId, command: { type: 'removeMember', memberId: cal.memberId } }));
});

const deleteAs = (account: string) => send(account, { action: 'deleteGroup', groupId });

describe('deleteGroup (group-command)', () => {
  it('any active Member may delete; it records who and when', async () => {
    const response = expectOk(await deleteAs(BEN));
    expect(response).toMatchObject({ groupId, changes: [], history: [] });
    const [row] = await sql<{ deleted_at: Date | null; deleted_by: string }>('select deleted_at, deleted_by from public.groups where id = $1', [groupId]);
    expect(row.deleted_at).not.toBeNull();
    expect(row.deleted_by).toBe(BEN);
  });

  it('refuses a former Member and an outsider', async () => {
    expect(await deleteAs(CAL)).toMatchObject({ ok: false, reason: 'notMember' });
    expect(await deleteAs(OUT)).toMatchObject({ ok: false, reason: 'notMember' });
    expect((await sql<{ n: number }>('select count(*)::int n from public.groups where deleted_at is not null'))[0].n).toBe(0);
  });

  it('a deleted Group takes no more commands, joins or second deletes', async () => {
    expectOk(await deleteAs(ANA));
    expect(await deleteAs(BEN)).toMatchObject({ ok: false, reason: 'notMember' });
    expect(await send(BEN, { action: 'command', groupId, command: { type: 'addSkipDate', eventId: 'w2' } })).toMatchObject({
      ok: false,
      reason: 'notMember',
    });
    expect(await send(OUT, { action: 'join', token, memberName: 'Out' })).toMatchObject({ ok: false, reason: 'invalidInvite' });
    expect(await t.store.load(groupId)).toBeNull();
  });

  it('rejects a malformed request', async () => {
    expect(await send(ANA, { action: 'deleteGroup', groupId: 'nope' })).toMatchObject({ ok: false, reason: 'invalidRequest' });
  });

  it('only the service role can mark a Group deleted directly', async () => {
    await expect(asUser(ANA, 'select public.mark_group_deleted($1, $2)', [groupId, ANA])).rejects.toThrow(/permission denied/);
    // And it checks membership itself too.
    expect((await sql<{ ok: boolean }>('select public.mark_group_deleted($1, $2) ok', [groupId, OUT]))[0].ok).toBe(false);
  });
});

describe('a deleted Group is hidden from everyone', () => {
  beforeEach(async () => {
    expectOk(await deleteAs(ANA));
  });

  it('RLS: no scheduling rows for anyone who was in it (old app versions included)', async () => {
    for (const account of [ANA, BEN]) {
      for (const table of SCHEDULING_TABLES) {
        const rows = await asUser<{ n: number }>(account, `select count(*)::int n from public.${table} where group_id = $1`, [groupId]);
        expect(rows[0].n, `${table} for ${account}`).toBe(0);
      }
      // What the deployed app's Groups tab and Home read: my memberships with their Group.
      const memberships = await asUser(account, 'select m.group_id from public.members m where m.account_id = $1 and m.left_at is null', [account]);
      expect(memberships).toEqual([]);
    }
  });

  it('the groups row stays readable to the people who were in it, so the app can say it was deleted', async () => {
    const mine = await asUser<{ name: string; deleted_at: Date | null }>(BEN, 'select name, deleted_at from public.groups where id = $1', [groupId]);
    expect(mine).toHaveLength(1);
    expect(mine[0].name).toBe('Sunday crew');
    expect(mine[0].deleted_at).not.toBeNull();
    expect(await asUser(CAL, 'select id from public.groups where id = $1', [groupId])).toEqual([]);
    expect(await asUser(OUT, 'select id from public.groups where id = $1', [groupId])).toEqual([]);
  });

  it('group_state_rows returns no Group, for Members and the service role alike', async () => {
    const [{ r }] = await asUser<{ r: { group: unknown; members: unknown[]; assignments: unknown[] } }>(BEN, 'select public.group_state_rows($1) r', [groupId]);
    expect(r).toMatchObject({ group: null, members: [], assignments: [] });
    const [{ r: svc }] = await sql<{ r: { group: unknown; assignments: unknown[] } }>('select public.group_state_rows($1) r', [groupId]);
    expect(svc).toMatchObject({ group: null, assignments: [] });
  });

  it('member RPCs refuse it', async () => {
    await expect(asUser(BEN, 'select public.group_invite_link($1)', [groupId])).rejects.toThrow(/Members only/);
    await expect(asUser(BEN, 'select public.reset_invite_link($1)', [groupId])).rejects.toThrow(/Members only/);
    await expect(asUser(BEN, `select public.update_group_details($1, 'X', 'UTC')`, [groupId])).rejects.toThrow(/Members only/);
  });

  it('its invite link: no preview, and the join screen can say it was deleted', async () => {
    expect(await t.as('anon', null, async () => (await t.db.query('select * from public.invite_link_preview($1)', [token])).rows)).toEqual([]);
    // No "Are you one of these?" Stand-ins either (Dee is one).
    expect(await asUser(OUT, 'select * from public.invite_link_stand_ins($1)', [token])).toEqual([]);
    const deleted = await t.as('anon', null, async () =>
      (await t.db.query<{ name: string | null }>('select public.deleted_group_for_invite($1) as name', [token])).rows,
    );
    expect(deleted).toEqual([{ name: 'Sunday crew' }]);
    const unknown = await asUser<{ name: string | null }>(OUT, 'select public.deleted_group_for_invite($1) as name', ['nope']);
    expect(unknown).toEqual([{ name: null }]);
  });

  it('a live link of a Group that is not deleted is not reported as deleted', async () => {
    // Restore by hand (the ADR's SQL), then check both RPCs again.
    await sql('update public.groups set deleted_at = null, deleted_by = null where id = $1', [groupId]);
    expect((await asUser<{ name: string | null }>(OUT, 'select public.deleted_group_for_invite($1) as name', [token]))[0].name).toBeNull();
    expect(await asUser(OUT, 'select group_name from public.invite_link_preview($1)', [token])).toEqual([{ group_name: 'Sunday crew' }]);
    expect(await asUser(OUT, 'select name from public.invite_link_stand_ins($1)', [token])).toEqual([{ name: 'Dee' }]);
  });

  it('restoring by hand brings everything back', async () => {
    await sql('update public.groups set deleted_at = null, deleted_by = null where id = $1', [groupId]);
    const [{ n }] = await asUser<{ n: number }>(BEN, 'select count(*)::int n from public.assignments where group_id = $1', [groupId]);
    expect(n).toBeGreaterThan(0);
    expect(await t.store.load(groupId)).not.toBeNull();
  });
});

describe('notifications', () => {
  function senders() {
    const sent = { web: [] as WebPayload[], expo: [] as ExpoMessage[] };
    const deps: NotifyDeps = {
      store: pgliteNotifyStore(t),
      senders: {
        web: async (_s, payload) => {
          sent.web.push(payload);
          return 'ok';
        },
        expo: async (messages) => {
          sent.expo.push(...messages);
          return messages.map((_, i) => ({ status: 'ok' as const, id: `t${i}` }));
        },
        expoReceipts: async () => ({}),
      },
    };
    return { deps, sent };
  }

  beforeEach(async () => {
    for (const account of [ANA, BEN, CAL]) {
      await t.asUser(account, () => t.db.query(`select public.register_push_token($1, 'android')`, [`ExponentPushToken[${account}]`]));
    }
  });

  it('tells everyone else still in it, once: "Ana deleted Sunday crew"', async () => {
    expectOk(await deleteAs(ANA));
    const { deps, sent } = senders();
    const report = await notifyGroupDeleted(deps, { groupId, now: NOW });
    expect(report.claimed).toBe(1);
    expect(sent.expo.map((m) => m.to)).toEqual([`ExponentPushToken[${BEN}]`]);
    expect(sent.expo[0]).toMatchObject({ title: 'Ana deleted Sunday crew', body: 'The group and its schedule are gone for everyone.' });
    expect(sent.expo[0].data.url).toBe('/groups');
    const again = await notifyGroupDeleted(deps, { groupId, now: NOW });
    expect(again.claimed).toBe(0);
    const logged = await asUser<{ kind: string }>(BEN, 'select kind from public.notification_log');
    expect(logged).toEqual([{ kind: 'groupDeleted' }]);
  });

  it('sends nothing for a Group that is not deleted', async () => {
    const { deps, sent } = senders();
    expect((await notifyGroupDeleted(deps, { groupId, now: NOW })).planned).toBe(0);
    expect(sent.expo).toEqual([]);
  });

  it('the scheduled run (reminders and the rest) skips a deleted Group', async () => {
    const { deps } = senders();
    const before = await runScheduled(deps, week(1));
    expect(before.groups).toBe(1);
    expectOk(await deleteAs(BEN));
    const after = await runScheduled(deps, week(1));
    expect(after.groups).toBe(0);
    expect(after.planned).toBe(0);
  });
});
