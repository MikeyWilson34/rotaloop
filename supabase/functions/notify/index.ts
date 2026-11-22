// notify: sends push notifications (ticket 11). Service role only.
//
// Actions:
// - { "action": "afterCommand", groupId, stateVersion, history }: group-command calls this
//   (in the background) after each successful command, with the command's history entries.
// - { "action": "groupDeleted", groupId }: group-command calls this after someone deletes a
//   Group (feedback-2 ticket 08): "Sam deleted Sunday Team" to everyone else who was in it.
// - { "action": "scheduled" }: the 15-minute pg_cron job (migration 20261121000000): asks to
//   confirm Assignments entering the confirmation window, then reminders, the Coverage
//   Request follow-up, Replacement Duty and Admin alerts; then Expo receipts.
//
// What is sent is decided by the pure planner (src/notify/plan.ts); this file only loads
// data, calls src/notify/run.ts and delivers: Expo push for the app, Web Push (VAPID, with
// jsr:@negrel/webpush) for the website. Dead devices (Expo DeviceNotRegistered, Web Push 404
// or 410) are removed. The VAPID key pair is the function secret VAPID_KEYS: base64 of the
// JSON from webpush.exportVapidKeys (never in git).
//
// _shared/{engine,db,schedule,notify} are generated copies of src/: run `npm run functions:sync`.
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as webpush from 'jsr:@negrel/webpush@0.5.0';

import type { GroupRows } from '../_shared/db/groupRows.ts';
import { persistPayload } from '../_shared/db/handleGroupCommand.ts';
import type { HistoryEntry } from '../_shared/engine/types.ts';
import { fetchExpoReceipts, sendExpoMessages } from '../_shared/notify/expo.ts';
import type { NotifyProfile } from '../_shared/notify/plan.ts';
import {
  notifyAfterCommand,
  notifyGroupDeleted,
  runScheduled,
  type Device,
  type NotifyStore,
  type Senders,
  type WebSubscription,
} from '../_shared/notify/run.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Constant-time string comparison (for the service role check). */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Same check as group-command: the env key, or a key PostgREST accepts as service_role. */
async function isServiceRole(token: string): Promise<boolean> {
  if (!token) return false;
  if (sameSecret(token, SERVICE_ROLE_KEY)) return true;
  const caller = createClient(SUPABASE_URL, token, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await caller.rpc('is_service_role_caller');
  return !error && data === true;
}

// ---------------------------------------------------------------------------
// Database access (service role)

function chunks<T>(list: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const check = <T>({ data, error }: { data: T; error: unknown }): T => {
  if (error) throw error;
  return data;
};

const store: NotifyStore = {
  async load(groupId) {
    const rows = check(await admin.rpc('group_state_rows', { p_group_id: groupId })) as
      | (GroupRows & { group: { state_version: number } | null })
      | null;
    if (!rows?.group) return null;
    return { rows: rows as GroupRows, version: Number(rows.group.state_version) };
  },
  async persist(input) {
    const data = check(
      await admin.rpc('apply_group_command_result', {
        p_group_id: input.groupId,
        p_expected_version: input.expectedVersion,
        p_rows: persistPayload(input),
        p_history: input.history,
      }),
    );
    return data === null ? null : Number(data);
  },
  async groupsWithUpcomingEvents(from, until) {
    const data = check(
      await admin.from('events').select('group_id').gt('starts_at', from).lte('starts_at', until).is('skip_date_marked_at', null),
    );
    return [...new Set((data ?? []).map((r: { group_id: string }) => r.group_id))];
  },
  async profiles(ids) {
    const out: NotifyProfile[] = [];
    for (const part of chunks(ids)) {
      const data = check(
        await admin
          .from('profiles')
          .select('id, push_enabled, notify_coverage_requests, notify_changes, reminder_days_before, reminder_time, time_zone, admin_alert_lead_time_ms')
          .in('id', part),
      );
      for (const r of data ?? []) {
        out.push({
          accountId: r.id,
          pushEnabled: r.push_enabled,
          notifyCoverageRequests: r.notify_coverage_requests,
          notifyChanges: r.notify_changes,
          reminderDaysBefore: r.reminder_days_before ?? [],
          reminderTime: r.reminder_time,
          timeZone: r.time_zone,
          adminAlertLeadTimeMs: Number(r.admin_alert_lead_time_ms),
        });
      }
    }
    return out;
  },
  async devices(ids) {
    const out: Device[] = [];
    for (const part of chunks(ids)) {
      const data = check(await admin.from('push_tokens').select('token, account_id, kind, subscription').in('account_id', part));
      for (const r of data ?? []) {
        out.push({ token: r.token, accountId: r.account_id, kind: r.kind, subscription: r.subscription as WebSubscription | null });
      }
    }
    return out;
  },
  async claim(items) {
    const data = check(await admin.rpc('claim_notifications', { p_items: items })) as string[] | null;
    return data ?? [];
  },
  async recordDelivery(keys, delivered) {
    check(await admin.from('notification_log').update({ delivered }).in('dedupe_key', keys));
  },
  async removeDevices(tokens) {
    for (const part of chunks(tokens)) check(await admin.from('push_tokens').delete().in('token', part));
  },
  async saveExpoTickets(tickets, createdAt) {
    check(await admin.from('expo_push_tickets').upsert(tickets.map((t) => ({ ...t, created_at: createdAt })), { ignoreDuplicates: true }));
  },
  async expoTickets(before) {
    const data = check(await admin.from('expo_push_tickets').select('id, token, created_at').lte('created_at', before).limit(1000));
    return (data ?? []).map((r: { id: string; token: string; created_at: string }) => ({
      id: r.id,
      token: r.token,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  },
  async deleteExpoTickets(ids) {
    for (const part of chunks(ids)) check(await admin.from('expo_push_tickets').delete().in('id', part));
  },
  async deletedGroup(groupId) {
    const group = check(
      await admin.from('groups').select('id, name, deleted_at, deleted_by').eq('id', groupId).not('deleted_at', 'is', null).maybeSingle(),
    ) as { id: string; name: string; deleted_at: string; deleted_by: string | null } | null;
    if (!group) return null;
    const members = check(
      await admin.from('members').select('display_name, account_id, left_at').eq('group_id', groupId).order('position'),
    ) as { display_name: string; account_id: string | null; left_at: string | null }[] | null;
    return {
      id: group.id,
      name: group.name,
      deletedAt: new Date(group.deleted_at).toISOString(),
      deletedBy: group.deleted_by,
      members: (members ?? []).map((m) => ({ name: m.display_name, accountId: m.account_id, leftAt: m.left_at })),
    };
  },
};

// ---------------------------------------------------------------------------
// Delivery

let applicationServer: Promise<webpush.ApplicationServer> | null = null;

/** The VAPID application server, from the VAPID_KEYS secret (null when it isn't set). */
function vapidServer(): Promise<webpush.ApplicationServer> | null {
  const encoded = Deno.env.get('VAPID_KEYS');
  if (!encoded) return null;
  applicationServer ??= (async () => {
    const vapidKeys = await webpush.importVapidKeys(JSON.parse(atob(encoded)), { extractable: false });
    // The VAPID "sub": a contact URL for push services (the website, not a personal address).
    const contactInformation = Deno.env.get('VAPID_SUBJECT') ?? 'https://rotaloop.expo.app';
    return webpush.ApplicationServer.new({ contactInformation, vapidKeys });
  })();
  return applicationServer;
}

const senders: Senders = {
  expo: (messages) => sendExpoMessages(messages),
  expoReceipts: (ids) => fetchExpoReceipts(ids),
  async web(subscription, payload) {
    const server = vapidServer();
    if (!server) {
      console.warn('Web Push skipped: set the VAPID_KEYS secret');
      return 'failed';
    }
    try {
      await (await server).subscribe(subscription).pushTextMessage(JSON.stringify(payload), {
        ttl: 24 * 60 * 60,
        urgency: webpush.Urgency.High,
      });
      return 'ok';
    } catch (error) {
      if (error instanceof webpush.PushMessageError) {
        const status = error.response.status;
        if (status === 404 || status === 410) return 'gone';
        console.error('Web Push failed', status);
        return 'failed';
      }
      console.error('Web Push failed', String(error));
      return 'failed';
    }
  },
};

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, message: 'Use POST' }, 405);
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!(await isServiceRole(token))) return json({ ok: false, message: 'System only' }, 403);

  let body: { action?: unknown; groupId?: unknown; stateVersion?: unknown; history?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, message: 'Body must be JSON' }, 400);
  }
  const deps = { store, senders };
  const now = new Date().toISOString();
  try {
    if (body.action === 'scheduled') {
      const report = await runScheduled(deps, now);
      console.log('scheduled', report);
      return json({ ok: true, ...report });
    }
    if (body.action === 'afterCommand') {
      if (typeof body.groupId !== 'string' || typeof body.stateVersion !== 'number' || !Array.isArray(body.history)) {
        return json({ ok: false, message: 'groupId, stateVersion and history are required' }, 400);
      }
      const report = await notifyAfterCommand(deps, {
        groupId: body.groupId,
        stateVersion: body.stateVersion,
        history: body.history as HistoryEntry[],
        now,
      });
      console.log('afterCommand', report);
      return json({ ok: true, ...report });
    }
    if (body.action === 'groupDeleted') {
      if (typeof body.groupId !== 'string') return json({ ok: false, message: 'groupId is required' }, 400);
      const report = await notifyGroupDeleted(deps, { groupId: body.groupId, now });
      console.log('groupDeleted', report);
      return json({ ok: true, ...report });
    }
    return json({ ok: false, message: 'Unknown action' }, 400);
  } catch (error) {
    console.error('notify failed', error);
    return json({ ok: false, message: 'Something went wrong' }, 500);
  }
});
