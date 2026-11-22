/** A NotifyStore over the PGlite test database, as the `notify` Edge Function's (service role). */
import type { TestDb } from '../../db/tests/pglite';
import type { NotificationItem, NotifyProfile } from '../plan';
import type { Device, NotifyStore, WebSubscription } from '../run';

export function pgliteNotifyStore(t: TestDb): NotifyStore {
  const svc = <T>(fn: () => Promise<T>) => t.as('service_role', null, fn);
  return {
    load: t.store.load,
    persist: t.store.persist,
    groupsWithUpcomingEvents: (from, until) =>
      svc(async () => {
        const { rows } = await t.db.query<{ group_id: string }>(
          `select distinct group_id from public.events
           where starts_at > $1 and starts_at <= $2 and skip_date_marked_at is null order by group_id`,
          [from, until],
        );
        return rows.map((r) => r.group_id);
      }),
    profiles: (ids) =>
      svc(async () => {
        const { rows } = await t.db.query<{
          id: string;
          push_enabled: boolean;
          notify_coverage_requests: boolean;
          notify_changes: boolean;
          reminder_days_before: number[];
          reminder_time: string;
          time_zone: string;
          admin_alert_lead_time_ms: string | number;
        }>('select * from public.profiles where id = any($1::uuid[])', [ids]);
        return rows.map(
          (r): NotifyProfile => ({
            accountId: r.id,
            pushEnabled: r.push_enabled,
            notifyCoverageRequests: r.notify_coverage_requests,
            notifyChanges: r.notify_changes,
            reminderDaysBefore: r.reminder_days_before,
            reminderTime: r.reminder_time,
            timeZone: r.time_zone,
            adminAlertLeadTimeMs: Number(r.admin_alert_lead_time_ms),
          }),
        );
      }),
    devices: (ids) =>
      svc(async () => {
        const { rows } = await t.db.query<{ token: string; account_id: string; kind: 'expo' | 'web'; subscription: WebSubscription | null }>(
          'select token, account_id, kind, subscription from public.push_tokens where account_id = any($1::uuid[]) order by token',
          [ids],
        );
        return rows.map((r): Device => ({ token: r.token, accountId: r.account_id, kind: r.kind, subscription: r.subscription }));
      }),
    claim: (items: NotificationItem[]) =>
      svc(async () => {
        const { rows } = await t.db.query<{ claim_notifications: string }>('select * from public.claim_notifications($1::jsonb)', [
          JSON.stringify(items),
        ]);
        return rows.map((r) => r.claim_notifications);
      }),
    recordDelivery: (keys, delivered) =>
      svc(async () => {
        await t.db.query('update public.notification_log set delivered = $2 where dedupe_key = any($1::text[])', [keys, delivered]);
      }),
    removeDevices: (tokens) =>
      svc(async () => {
        await t.db.query('delete from public.push_tokens where token = any($1::text[])', [tokens]);
      }),
    saveExpoTickets: (tickets, createdAt) =>
      svc(async () => {
        for (const ticket of tickets) {
          await t.db.query('insert into public.expo_push_tickets (id, token, created_at) values ($1, $2, $3) on conflict do nothing', [ticket.id, ticket.token, createdAt]);
        }
      }),
    expoTickets: (before) =>
      svc(async () => {
        const { rows } = await t.db.query<{ id: string; token: string; created_at: Date }>(
          'select id, token, created_at from public.expo_push_tickets where created_at <= $1',
          [before],
        );
        return rows.map((r) => ({ id: r.id, token: r.token, createdAt: new Date(r.created_at).toISOString() }));
      }),
    deleteExpoTickets: (ids) =>
      svc(async () => {
        await t.db.query('delete from public.expo_push_tickets where id = any($1::text[])', [ids]);
      }),
    deletedGroup: (groupId) =>
      svc(async () => {
        const { rows } = await t.db.query<{ id: string; name: string; deleted_at: Date; deleted_by: string | null }>(
          'select id, name, deleted_at, deleted_by from public.groups where id = $1 and deleted_at is not null',
          [groupId],
        );
        if (!rows[0]) return null;
        const members = await t.db.query<{ display_name: string; account_id: string | null; left_at: Date | null }>(
          'select display_name, account_id, left_at from public.members where group_id = $1 order by position',
          [groupId],
        );
        return {
          id: rows[0].id,
          name: rows[0].name,
          deletedAt: new Date(rows[0].deleted_at).toISOString(),
          deletedBy: rows[0].deleted_by,
          members: members.rows.map((m) => ({
            name: m.display_name,
            accountId: m.account_id,
            leftAt: m.left_at ? new Date(m.left_at).toISOString() : null,
          })),
        };
      }),
  };
}
