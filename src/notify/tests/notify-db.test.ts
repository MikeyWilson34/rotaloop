import { beforeEach, describe, expect, it } from 'vitest';

import { rowsFromState } from '../../db/groupRows';
import { newGroupState, run } from '../../db/tests/fixtures';
import { createTestDb, uuid, type TestDb } from '../../db/tests/pglite';
import type { GroupState, HistoryEntry } from '../../engine';
import type { ExpoMessage, ExpoReceipt, ExpoTicket } from '../expo';
import { notifyAfterCommand, runScheduled, type NotifyDeps, type WebPayload, type WebSubscription } from '../run';
import { pgliteNotifyStore } from './pgliteNotifyStore';

const ANA = uuid(1);
const BEN = uuid(2);
const CAL = uuid(3);
const GROUP = uuid(300);

/** A web subscription as a browser would send it (the endpoint is a fake push service). */
const sub = (n: number): WebSubscription => ({
  endpoint: `https://push.example.test/send/${n}`,
  keys: { p256dh: 'BOr9cM1lfnFEcVhNZzVL6cW9bAZpZKs7dE1Wn5u7XvW0QwVQ8xjDQ8KQ6h9tZtM6YRXnSKs1wGEnHBEi1v3qD0s', auth: 'k8JV6sjdbhAi1n3_LDBLvA' },
});

let t: TestDb;
let state: GroupState;

async function seed() {
  t = await createTestDb();
  for (const [id, name] of [[ANA, 'Ana'], [BEN, 'Ben'], [CAL, 'Cal']] as const) await t.createAccount(id, name);
  // ana (Admin), ben, cal have accounts; dee is a Placeholder. Sundays from Jan 3, 2027, 09:00 UTC.
  const filled = run(newGroupState(GROUP, { ana: ANA, ben: BEN, cal: CAL }), { type: 'fillSchedule' }, 'ana');
  state = filled.state;
  await t.store.persist({
    groupId: GROUP,
    expectedVersion: null,
    rows: rowsFromState(state),
    newGroup: { name: 'Team', time_zone: 'UTC', created_by: ANA },
    history: filled.history,
  });
}

/** Fake senders that record what they were asked to send. */
function senders(options: { web?: 'ok' | 'gone'; expo?: ExpoTicket['status'] | 'gone'; receipts?: Record<string, ExpoReceipt> } = {}) {
  const sent = { web: [] as { endpoint: string; payload: WebPayload }[], expo: [] as ExpoMessage[] };
  let ticket = 0;
  const deps: NotifyDeps = {
    store: pgliteNotifyStore(t),
    senders: {
      web: async (subscription, payload) => {
        sent.web.push({ endpoint: subscription.endpoint, payload });
        return options.web ?? 'ok';
      },
      expo: async (messages) => {
        sent.expo.push(...messages);
        return messages.map((): ExpoTicket =>
          options.expo === 'gone'
            ? { status: 'error', details: { error: 'DeviceNotRegistered' } }
            : { status: 'ok', id: `ticket-${++ticket}` },
        );
      },
      expoReceipts: async () => options.receipts ?? {},
    },
  };
  return { deps, sent };
}

const sql = <T>(query: string, params: unknown[] = []) => t.as('service_role', null, async () => (await t.db.query<T>(query, params)).rows);

describe('push_tokens: Web Push subscriptions', () => {
  beforeEach(seed);

  it('register_web_push stores the subscription for the caller', async () => {
    await t.asUser(BEN, () => t.db.query('select public.register_web_push($1::jsonb)', [JSON.stringify(sub(1))]));
    const rows = await t.asUser(BEN, async () => (await t.db.query<{ kind: string; platform: string; subscription: WebSubscription }>('select kind, platform, subscription from public.push_tokens')).rows);
    expect(rows).toEqual([{ kind: 'web', platform: 'web', subscription: sub(1) }]);
  });

  it('refuses anything that is not an https push subscription, and anon', async () => {
    const bad = [{ ...sub(1), endpoint: 'http://push.example.test/x' }, { endpoint: sub(1).endpoint, keys: { p256dh: 'x', auth: 'y' } }, {}];
    for (const s of bad) {
      await expect(t.asUser(BEN, () => t.db.query('select public.register_web_push($1::jsonb)', [JSON.stringify(s)]))).rejects.toThrow(/push subscription/);
    }
    await expect(t.as('anon', null, () => t.db.query('select public.register_web_push($1::jsonb)', [JSON.stringify(sub(1))]))).rejects.toThrow(/permission denied/);
  });

  it('a browser signed in to another account moves to it; unregister removes only your own', async () => {
    await t.asUser(BEN, () => t.db.query('select public.register_web_push($1::jsonb)', [JSON.stringify(sub(1))]));
    await t.asUser(CAL, () => t.db.query('select public.register_web_push($1::jsonb)', [JSON.stringify(sub(1))]));
    expect(await sql('select account_id from public.push_tokens')).toEqual([{ account_id: CAL }]);
    await t.asUser(BEN, () => t.db.query('select public.unregister_push_token($1)', [sub(1).endpoint]));
    expect(await sql('select account_id from public.push_tokens')).toHaveLength(1);
    await t.asUser(CAL, () => t.db.query('select public.unregister_push_token($1)', [sub(1).endpoint]));
    expect(await sql('select account_id from public.push_tokens')).toHaveLength(0);
  });

  it('Expo tokens still register as kind expo, without a subscription', async () => {
    await t.asUser(BEN, () => t.db.query(`select public.register_push_token('ExponentPushToken[abc]', 'ios')`));
    expect(await sql('select kind, subscription from public.push_tokens')).toEqual([{ kind: 'expo', subscription: null }]);
    await expect(sql(`insert into public.push_tokens (token, account_id, platform, kind) values ('x', '${BEN}', 'web', 'web')`)).rejects.toThrow(/push_tokens_web_subscription/);
  });

  it('others never see your devices', async () => {
    await t.asUser(BEN, () => t.db.query('select public.register_web_push($1::jsonb)', [JSON.stringify(sub(1))]));
    const seen = await t.asUser(CAL, async () => (await t.db.query('select * from public.push_tokens')).rows);
    expect(seen).toEqual([]);
  });
});

describe('notification_log and expo_push_tickets', () => {
  beforeEach(seed);

  const item = (key: string, accountId = BEN) => ({
    dedupeKey: key,
    accountId,
    kind: 'reminder',
    groupId: GROUP,
    assignmentId: 'a1',
    eventId: 'w1',
    offsetKey: '1d',
    title: 'Tomorrow: Sound',
    body: "You're on Sound",
    url: `/assignment/${GROUP}/a1`,
  });

  it('claim_notifications returns only new keys (dedupe), service role only', async () => {
    const claim = (items: unknown[]) => sql<{ claim_notifications: string }>('select * from public.claim_notifications($1::jsonb)', [JSON.stringify(items)]);
    expect((await claim([item('k1'), item('k2')])).map((r) => r.claim_notifications)).toEqual(['k1', 'k2']);
    expect((await claim([item('k2'), item('k3')])).map((r) => r.claim_notifications)).toEqual(['k3']);
    await expect(t.asUser(BEN, () => t.db.query('select * from public.claim_notifications($1::jsonb)', [JSON.stringify([item('k9')])]))).rejects.toThrow(/permission denied/);
  });

  it('Members read only their own rows and cannot write', async () => {
    await sql('select * from public.claim_notifications($1::jsonb)', [JSON.stringify([item('k1', BEN), item('k2', CAL)])]);
    const mine = await t.asUser(BEN, async () => (await t.db.query<{ dedupe_key: string }>('select dedupe_key from public.notification_log')).rows);
    expect(mine.map((r) => r.dedupe_key)).toEqual(['k1']);
    await expect(t.asUser(BEN, () => t.db.query(`insert into public.notification_log (dedupe_key, account_id, kind, title, body, url) values ('x', '${BEN}', 'reminder', 't', 'b', '/')`))).rejects.toThrow(/permission denied/);
    await expect(t.asUser(BEN, () => t.db.query(`update public.notification_log set title = 'x'`))).rejects.toThrow(/permission denied/);
    await expect(t.asUser(BEN, () => t.db.query(`delete from public.notification_log`))).rejects.toThrow(/permission denied/);
    expect(await t.as('anon', null, async () => (await t.db.query('select * from public.notification_log').catch(() => ({ rows: 'denied' }))).rows)).toBe('denied');
  });

  it('expo_push_tickets and request_notification_run are server-only', async () => {
    await expect(t.asUser(BEN, () => t.db.query('select * from public.expo_push_tickets'))).rejects.toThrow(/permission denied/);
    await expect(t.asUser(BEN, () => t.db.query('select public.request_notification_run()'))).rejects.toThrow(/permission denied/);
  });
});

describe('the notify runner against the database', () => {
  beforeEach(seed);

  /** w1 is Sun Jan 3, 2027 09:00 UTC; profiles default to 1 day before at 18:00 UTC. */
  const REMINDER = '2027-01-02T18:05:00.000Z';

  it('the scheduled run asks to confirm, reminds, logs once and sends nothing new the second time', async () => {
    await t.asUser(BEN, () => t.db.query('select public.register_web_push($1::jsonb)', [JSON.stringify(sub(1))]));
    await t.asUser(CAL, () => t.db.query(`select public.register_push_token('ExponentPushToken[cal]', 'android')`));
    const { deps, sent } = senders();

    const first = await runScheduled(deps, REMINDER);
    expect(first.groups).toBe(1);
    // Sound (needs confirmation) within 14 days: w1 and w2.
    expect(first.confirmationsRequested).toBe(2);
    const sound = (await sql<{ id: string; confirmation: string; event_id: string }>(
      `select id, confirmation, event_id from public.assignments where group_id = $1 and responsibility_id = 'sound' and event_id in ('w1', 'w2') order by event_id`,
      [GROUP],
    )).map((r) => r.confirmation);
    expect(sound).toEqual(['requested', 'requested']);
    const history = await sql<{ cause_type: string; actor_id: string | null }>(`select cause_type, actor_id from public.schedule_history where group_id = $1 and cause_type = 'requestConfirmation'`, [GROUP]);
    expect(history).toEqual([{ cause_type: 'requestConfirmation', actor_id: null }]);

    expect(first.claimed).toBeGreaterThan(0);
    expect(sent.web).toHaveLength(1);
    expect(sent.web[0].endpoint).toBe(sub(1).endpoint);
    expect(sent.web[0].payload).toMatchObject({ icon: '/icons/icon-192.png' });
    expect(sent.expo).toHaveLength(1);
    expect(sent.expo[0]).toMatchObject({ to: 'ExponentPushToken[cal]', sound: 'default' });
    expect(sent.expo[0].data.url).toMatch(/^\/assignment\//);

    // Ben reads his own log rows; Ana (no device) was logged with nothing delivered.
    const bens = await t.asUser(BEN, async () => (await t.db.query<{ kind: string; delivered: number }>('select kind, delivered from public.notification_log order by kind')).rows);
    expect(bens.length).toBeGreaterThan(0);
    expect(bens.every((r) => r.delivered === 1)).toBe(true);
    const anas = await t.asUser(ANA, async () => (await t.db.query<{ delivered: number }>('select delivered from public.notification_log')).rows);
    expect(anas.every((r) => r.delivered === 0)).toBe(true);

    const second = await runScheduled(deps, '2027-01-02T18:20:00.000Z');
    expect(second.confirmationsRequested).toBe(0);
    expect(second.claimed).toBe(0);
    expect(sent.web).toHaveLength(1);
    expect(sent.expo).toHaveLength(1);
  });

  it('a 404/410 web subscription and a DeviceNotRegistered token are removed', async () => {
    await t.asUser(BEN, () => t.db.query('select public.register_web_push($1::jsonb)', [JSON.stringify(sub(1))]));
    await t.asUser(CAL, () => t.db.query(`select public.register_push_token('ExponentPushToken[cal]', 'android')`));
    const { deps } = senders({ web: 'gone', expo: 'gone' });
    const report = await runScheduled(deps, REMINDER);
    expect(report.removed).toBe(2);
    expect(await sql('select token from public.push_tokens')).toEqual([]);
  });

  it('Expo receipts: DeviceNotRegistered removes the token, read tickets are deleted', async () => {
    await t.asUser(CAL, () => t.db.query(`select public.register_push_token('ExponentPushToken[cal]', 'android')`));
    const { deps } = senders();
    await runScheduled(deps, REMINDER);
    // Receipts are read 15 minutes or more after sending.
    const tickets = await sql<{ id: string }>('select id from public.expo_push_tickets');
    expect(tickets).toHaveLength(1);
    const notYet = await runScheduled(senders().deps, '2027-01-02T18:15:00.000Z');
    expect(notYet.receipts).toEqual({ checked: 0, removed: 0 });
    const later = '2027-01-02T18:25:00.000Z';
    const gone = senders({ receipts: { [tickets[0].id]: { status: 'error', details: { error: 'DeviceNotRegistered' } } } });
    const report = await runScheduled(gone.deps, later);
    expect(report.receipts).toEqual({ checked: 1, removed: 1 });
    expect(await sql('select * from public.push_tokens')).toEqual([]);
    expect(await sql('select * from public.expo_push_tickets')).toEqual([]);
  });

  it('after a Decline: the Qualified Members are told, the decliner is not', async () => {
    await t.asUser(ANA, () => t.db.query('select public.register_web_push($1::jsonb)', [JSON.stringify(sub(1))]));
    await t.asUser(BEN, () => t.db.query('select public.register_web_push($1::jsonb)', [JSON.stringify(sub(2))]));
    // Everyone serves every Sunday here, so let the Group allow doubling: Ana and Cal are asked.
    const doubling = run(state, { type: 'changeSettings', settings: { allowDoubling: true } }, 'ana');
    const seat = doubling.state.assignments.find((a) => a.responsibilityId === 'sound' && a.memberId === 'ben')!;
    const declined = run(doubling.state, { type: 'decline', assignmentId: seat.id, reason: 'Away' }, 'ben');
    const version = await t.store.persist({ groupId: GROUP, expectedVersion: 1, rows: rowsFromState(declined.state), history: declined.history });
    const { deps, sent } = senders();
    const report = await notifyAfterCommand(deps, { groupId: GROUP, history: declined.history as HistoryEntry[], stateVersion: version!, now: '2026-12-01T00:00:00.000Z' });
    expect(report.claimed).toBeGreaterThan(0);
    expect(sent.web.map((w) => w.endpoint)).toEqual([sub(1).endpoint]);
    expect(sent.web[0].payload.url).toBe(`/assignment/${GROUP}/${seat.id}?action=cover`);
    const log = await sql<{ account_id: string; kind: string }>('select account_id, kind from public.notification_log order by account_id');
    expect(log.some((r) => r.account_id === BEN)).toBe(false);
    expect(log).toContainEqual({ account_id: ANA, kind: 'coverageRequest' });
    // Retrying the same trigger sends nothing.
    const again = await notifyAfterCommand(deps, { groupId: GROUP, history: declined.history as HistoryEntry[], stateVersion: version!, now: '2026-12-01T00:00:00.000Z' });
    expect(again.claimed).toBe(0);
    expect(sent.web).toHaveLength(1);
  });
});
