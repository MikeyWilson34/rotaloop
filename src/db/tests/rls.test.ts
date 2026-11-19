import { beforeAll, describe, expect, it } from 'vitest';

import type { GroupState } from '../../engine';
import { rowsFromState } from '../groupRows';
import { newGroupState, run } from './fixtures';
import { createTestDb, uuid, type TestDb } from './pglite';

// Accounts: ana (Admin of group A), ben (Member of A), cal (left A), out (no Group).
const ANA = uuid(1);
const BEN = uuid(2);
const CAL = uuid(3);
const OUT = uuid(4);
const GROUP_A = uuid(200);
const GROUP_B = uuid(201);

const SCHEDULING_TABLES = [
  'groups',
  'members',
  'responsibilities',
  'rotations',
  'event_series',
  'events',
  'time_off',
  'make_up_turns',
  'assignments',
  'schedule_history',
];

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
  for (const [id, name] of [[ANA, 'Ana'], [BEN, 'Ben'], [CAL, 'Cal'], [OUT, 'Out']]) await t.createAccount(id, name);

  // Group A has a row in every scheduling table: Time Off, and a Decline covered by ana
  // under Pay It Back (a Make-up Turn). The sound rotation starts with dee, so ana is free at w1.
  let a = run(newGroupState(GROUP_A, { ana: ANA, ben: BEN, cal: CAL }), { type: 'fillSchedule' }, 'ana');
  a = run(a.state, { type: 'addTimeOff', timeOff: { id: 't1', memberId: 'ben', startsAt: '2027-02-01T00:00:00.000Z', endsAt: '2027-02-02T00:00:00.000Z' } }, 'ben');
  const w1 = a.state.assignments.find((x) => x.eventId === 'w1' && x.responsibilityId === 'sound')!;
  a = run(a.state, { type: 'decline', assignmentId: w1.id }, w1.memberId);
  a = run(a.state, { type: 'cover', assignmentId: w1.id }, freeAt(a.state, 'w1', w1.memberId!));
  await t.store.persist({
    groupId: GROUP_A,
    expectedVersion: null,
    rows: rowsFromState(a.state),
    newGroup: { name: 'Group A', time_zone: 'UTC', created_by: ANA },
    history: a.history,
  });
  const left = run(a.state, { type: 'removeMember', memberId: 'cal' }, 'cal');
  await t.store.persist({ groupId: GROUP_A, expectedVersion: 1, rows: rowsFromState(left.state), history: left.history });

  // Group B has only Placeholder Members: no account can read it.
  const b = run(newGroupState(GROUP_B), { type: 'fillSchedule' }, 'ana');
  await t.store.persist({
    groupId: GROUP_B,
    expectedVersion: null,
    rows: rowsFromState(b.state),
    newGroup: { name: 'Group B', time_zone: 'UTC', created_by: OUT },
    history: b.history,
  });
});

/** A Sound-qualified Member other than `except` with no seat at the Event (and not cal, who leaves). */
function freeAt(state: GroupState, eventId: string, except: string): string {
  const busy = new Set(state.assignments.filter((x) => x.eventId === eventId).map((x) => x.memberId));
  return ['ana', 'ben', 'dee'].find((m) => m !== except && !busy.has(m))!;
}

const count = (table: string, groupId: string) =>
  t.db
    .query<{ n: number }>(`select count(*)::int n from public.${table} where group_id = $1`, [groupId])
    .then((r) => r.rows[0].n);

const groupCount = (groupId: string) =>
  t.db.query<{ n: number }>('select count(*)::int n from public.groups where id = $1', [groupId]).then((r) => r.rows[0].n);

const countIn = (table: string, groupId: string) => (table === 'groups' ? groupCount(groupId) : count(table, groupId));

describe('reading scheduling state', () => {
  it('lets an active Member read every scheduling table of their Group', async () => {
    for (const table of SCHEDULING_TABLES) {
      expect(await t.asUser(BEN, () => countIn(table, GROUP_A)), table).toBeGreaterThan(0);
    }
  });

  it("hides another Group's data from a non-member", async () => {
    for (const table of SCHEDULING_TABLES) {
      expect(await t.asUser(OUT, () => countIn(table, GROUP_A)), table).toBe(0);
      expect(await t.asUser(BEN, () => countIn(table, GROUP_B)), table).toBe(0);
    }
  });

  it('hides the Group from a former Member', async () => {
    expect(await t.asUser(CAL, () => groupCount(GROUP_A))).toBe(0);
    expect(await t.asUser(CAL, () => count('assignments', GROUP_A))).toBe(0);
  });

  it('gives signed-out (anon) callers nothing', async () => {
    await expect(t.as('anon', null, () => groupCount(GROUP_A))).rejects.toThrow(/permission denied/);
  });

  it('group_state_rows returns a Member their Group and a non-member nothing', async () => {
    const rowsFor = (account: string) =>
      t.asUser(account, () =>
        t.db
          .query<{ r: { group: unknown; assignments: unknown[] } }>('select public.group_state_rows($1) r', [GROUP_A])
          .then((x) => x.rows[0].r),
      );
    const member = await rowsFor(BEN);
    expect(member.group).not.toBeNull();
    expect(member.assignments.length).toBeGreaterThan(0);
    const outsider = await rowsFor(OUT);
    expect(outsider.group).toBeNull();
    expect(outsider.assignments).toEqual([]);
  });
});

describe('writing scheduling state', () => {
  it('rejects client inserts, updates and deletes on every scheduling table, even for Admins', async () => {
    for (const table of SCHEDULING_TABLES) {
      const key = table === 'groups' ? 'id' : 'group_id';
      await expect(
        t.asUser(ANA, () => t.db.query(`update public.${table} set ${key} = ${key} where ${key} = $1`, [GROUP_A])),
        `update ${table}`,
      ).rejects.toThrow(/permission denied/);
      await expect(
        t.asUser(ANA, () => t.db.query(`delete from public.${table} where ${key} = $1`, [GROUP_A])),
        `delete ${table}`,
      ).rejects.toThrow(/permission denied/);
    }
    await expect(
      t.asUser(ANA, () =>
        t.db.query(
          `insert into public.assignments (group_id, id, position, event_id, responsibility_id, confirmation)
           values ($1, 'x', 99, 'w1', 'sound', 'notRequired')`,
          [GROUP_A],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      t.asUser(OUT, () => t.db.query(`insert into public.groups (name) values ('Mine')`)),
    ).rejects.toThrow(/permission denied/);
  });

  it('does not let clients call apply_group_command_result', async () => {
    await expect(
      t.asUser(ANA, () =>
        t.db.query(`select public.apply_group_command_result($1, 2, '{}'::jsonb)`, [GROUP_A]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('profiles', () => {
  it('creates a profile with notification defaults when an account is created', async () => {
    const profile = await t.asUser(BEN, () =>
      t.db.query<Record<string, unknown>>('select * from public.profiles where id = $1', [BEN]).then((r) => r.rows[0]),
    );
    expect(profile).toMatchObject({
      display_name: 'Ben',
      push_enabled: true,
      email_enabled: false,
      sms_enabled: false,
      reminder_days_before: [1],
      onboarding_completed_at: null,
    });
  });

  it('lets a user read and update only their own profile', async () => {
    const updated = await t.asUser(BEN, () =>
      t.db.query(
        `update public.profiles set display_name = 'Benjamin', sms_enabled = true, phone = '+15555550100',
           reminder_days_before = '{0,2}', onboarding_completed_at = now() where id = $1`,
        [BEN],
      ),
    );
    expect(updated.affectedRows).toBe(1);

    const others = await t.asUser(BEN, () =>
      t.db.query(`update public.profiles set display_name = 'Hacked' where id = $1`, [ANA]),
    );
    expect(others.affectedRows).toBe(0);
    const visible = await t.asUser(BEN, () => t.db.query('select id from public.profiles'));
    expect(visible.rows).toEqual([{ id: BEN }]);

    await expect(
      t.asUser(BEN, () => t.db.query(`update public.profiles set id = $1 where id = $2`, [OUT, BEN])),
    ).rejects.toThrow();
    await expect(
      t.asUser(BEN, () => t.db.query(`update public.profiles set reminder_days_before = '{5}' where id = $1`, [BEN])),
    ).rejects.toThrow(/check constraint/);
  });
});

describe('invite links', () => {
  const linkCount = () =>
    t.db.query<{ n: number }>('select count(*)::int n from public.invite_links where group_id = $1', [GROUP_A]).then((r) => r.rows[0].n);

  it('creates a join link with each Group, visible to its active Members only (no Admins for now)', async () => {
    expect(await t.asUser(ANA, linkCount)).toBe(1);
    expect(await t.asUser(BEN, linkCount)).toBe(1);
    expect(await t.asUser(CAL, linkCount)).toBe(0);
    expect(await t.asUser(OUT, linkCount)).toBe(0);
  });

  it('lets any active Member reset the join link, and no one else', async () => {
    const old = await t.asUser(ANA, () =>
      t.db.query<{ token: string }>('select token from public.invite_links where group_id = $1 and member_id is null', [GROUP_A]),
    );
    const fresh = await t.asUser(ANA, () =>
      t.db.query<{ t: string }>('select public.reset_invite_link($1) t', [GROUP_A]).then((r) => r.rows[0].t),
    );
    expect(fresh).toMatch(/^[0-9a-f]{64}$/);
    expect(fresh).not.toBe(old.rows[0].token);
    expect(await t.asUser(ANA, linkCount)).toBe(1);
    const byBen = await t.asUser(BEN, () =>
      t.db.query<{ t: string }>('select public.reset_invite_link($1) t', [GROUP_A]).then((r) => r.rows[0].t),
    );
    expect(byBen).not.toBe(fresh);
    await expect(t.asUser(CAL, () => t.db.query('select public.reset_invite_link($1)', [GROUP_A]))).rejects.toThrow(
      /Members only/,
    );
    await expect(t.asUser(OUT, () => t.db.query('select public.reset_invite_link($1)', [GROUP_A]))).rejects.toThrow(
      /Members only/,
    );
  });

  it('gives any active Member a claim link only for Stand-ins (Placeholder Members), and previews it', async () => {
    const claim = await t.asUser(ANA, () =>
      t.db.query<{ t: string }>(`select public.claim_link_for($1, 'dee') t`, [GROUP_A]).then((r) => r.rows[0].t),
    );
    const again = await t.asUser(ANA, () =>
      t.db.query<{ t: string }>(`select public.claim_link_for($1, 'dee') t`, [GROUP_A]).then((r) => r.rows[0].t),
    );
    expect(again).toBe(claim);
    await expect(t.asUser(ANA, () => t.db.query(`select public.claim_link_for($1, 'ben')`, [GROUP_A]))).rejects.toThrow(
      /Not a Placeholder/,
    );
    const byBen = await t.asUser(BEN, () =>
      t.db.query<{ t: string }>(`select public.claim_link_for($1, 'dee') t`, [GROUP_A]).then((r) => r.rows[0].t),
    );
    expect(byBen).toBe(claim);
    await expect(t.asUser(OUT, () => t.db.query(`select public.claim_link_for($1, 'dee')`, [GROUP_A]))).rejects.toThrow(
      /Members only/,
    );

    const preview = await t.asUser(OUT, () => t.db.query('select * from public.invite_link_preview($1)', [claim]));
    expect(preview.rows).toEqual([{ group_id: GROUP_A, group_name: 'Group A', placeholder_name: 'DEE' }]);
    const unknown = await t.asUser(OUT, () => t.db.query('select * from public.invite_link_preview($1)', ['nope']));
    expect(unknown.rows).toEqual([]);
  });

  it('gives any active Member the current join link, and no one else', async () => {
    const link = (account: string) =>
      t.asUser(account, () =>
        t.db.query<{ t: string | null }>('select public.group_invite_link($1) t', [GROUP_A]).then((r) => r.rows[0].t),
      );
    const current = await t.as('service_role', null, () =>
      t.db
        .query<{ token: string }>('select token from public.invite_links where group_id = $1 and member_id is null', [GROUP_A])
        .then((r) => r.rows[0].token),
    );
    expect(await link(ANA)).toBe(current);
    expect(await link(BEN)).toBe(current);
    await expect(link(CAL)).rejects.toThrow(/Members only/);
    await expect(link(OUT)).rejects.toThrow(/Members only/);
    await expect(
      t.as('anon', null, () => t.db.query('select public.group_invite_link($1)', [GROUP_A])),
    ).rejects.toThrow(/permission denied/);

    // After a reset, Members get the new link.
    const fresh = await t.asUser(ANA, () =>
      t.db.query<{ t: string }>('select public.reset_invite_link($1) t', [GROUP_A]).then((r) => r.rows[0].t),
    );
    expect(await link(BEN)).toBe(fresh);
  });

  it('previews an invite link for signed-out (anon) visitors: the Group name only', async () => {
    const token = await t.asUser(BEN, () =>
      t.db.query<{ t: string }>('select public.group_invite_link($1) t', [GROUP_A]).then((r) => r.rows[0].t),
    );
    const preview = await t.as('anon', null, () => t.db.query('select * from public.invite_link_preview($1)', [token]));
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]).toMatchObject({ group_id: GROUP_A, placeholder_name: null });
    expect(Object.keys(preview.rows[0] as object).sort()).toEqual(['group_id', 'group_name', 'placeholder_name']);
    const unknown = await t.as('anon', null, () => t.db.query('select * from public.invite_link_preview($1)', ['nope']));
    expect(unknown.rows).toEqual([]);
    // Still nothing else for anon.
    await expect(t.as('anon', null, () => t.db.query('select public.claim_link_for($1, $2)', [GROUP_A, 'dee']))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('lets any active Member rename the Group or change its time zone, and no one else', async () => {
    await t.asUser(BEN, () => t.db.query(`select public.update_group_details($1, ' Crew A ', 'America/Chicago')`, [GROUP_A]));
    const g = await t.asUser(BEN, () => t.db.query<{ name: string; time_zone: string }>('select name, time_zone from public.groups where id = $1', [GROUP_A]));
    expect(g.rows[0]).toEqual({ name: 'Crew A', time_zone: 'America/Chicago' });
    await expect(
      t.asUser(CAL, () => t.db.query(`select public.update_group_details($1, 'Mine', 'UTC')`, [GROUP_A])),
    ).rejects.toThrow(/Members only/);
    await expect(
      t.asUser(OUT, () => t.db.query(`select public.update_group_details($1, 'Mine', 'UTC')`, [GROUP_A])),
    ).rejects.toThrow(/Members only/);
  });
});

describe('push tokens', () => {
  it('registers a device for the caller, and hands it over when another account signs in on it', async () => {
    await t.asUser(BEN, () => t.db.query(`select public.register_push_token('ExponentPushToken[1]', 'ios')`));
    expect((await t.asUser(BEN, () => t.db.query('select token from public.push_tokens'))).rows).toHaveLength(1);
    expect((await t.asUser(ANA, () => t.db.query('select token from public.push_tokens'))).rows).toHaveLength(0);

    await t.asUser(ANA, () => t.db.query(`select public.register_push_token('ExponentPushToken[1]', 'ios')`));
    expect((await t.asUser(BEN, () => t.db.query('select token from public.push_tokens'))).rows).toHaveLength(0);
    expect((await t.asUser(ANA, () => t.db.query('select token from public.push_tokens'))).rows).toHaveLength(1);

    await expect(
      t.asUser(ANA, () => t.db.query(`insert into public.push_tokens (token, platform) values ('x', 'web')`)),
    ).rejects.toThrow(/permission denied/);
    const removed = await t.asUser(ANA, () => t.db.query(`delete from public.push_tokens where token = 'ExponentPushToken[1]'`));
    expect(removed.affectedRows).toBe(1);
  });
});
