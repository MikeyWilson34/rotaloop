/**
 * The `notify` Edge Function's work, free of Deno and Supabase so it runs under Node tests:
 * load the data, call the planner (plan.ts), claim each item in the notification log
 * (only new dedupe keys are sent) and deliver one batched message per person to each of
 * their devices (Expo push for the app, Web Push for the website). The function supplies
 * the store (database access) and the senders.
 */
import { rowsFromState, stateFromRows, type GroupRows } from '../db/groupRows';
import type { GroupStore } from '../db/handleGroupCommand';
import { applyCommand } from '../engine';
import type { GroupState, HistoryEntry, Instant } from '../engine/types';
import { expoMessage, isDeviceGone, type ExpoMessage, type ExpoReceipt, type ExpoTicket } from './expo';
import {
  composeMessages,
  confirmationRequestsDue,
  lookaheadEnd,
  planCommandNotifications,
  planScheduledNotifications,
  type NotificationItem,
  type NotifyGroup,
  type NotifyProfile,
  type PushMessage,
} from './plan';

export interface WebSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface Device {
  token: string;
  accountId: string;
  kind: 'expo' | 'web';
  subscription: WebSubscription | null;
}

/** What the service worker receives (public/sw.js). */
export interface WebPayload {
  title: string;
  body: string;
  url: string;
  icon: string;
  tag: string;
}

export interface NotifyStore extends Pick<GroupStore, 'load' | 'persist'> {
  /** Groups with an Event (not a Skip Date) starting in [from, until]. */
  groupsWithUpcomingEvents(from: Instant, until: Instant): Promise<string[]>;
  profiles(accountIds: string[]): Promise<NotifyProfile[]>;
  devices(accountIds: string[]): Promise<Device[]>;
  /** Inserts the items into notification_log; returns the dedupe keys that were new. */
  claim(items: NotificationItem[]): Promise<string[]>;
  recordDelivery(dedupeKeys: string[], delivered: number): Promise<void>;
  removeDevices(tokens: string[]): Promise<void>;
  /** `createdAt`: the run's clock, so receipts are read 15 minutes later on that clock. */
  saveExpoTickets(tickets: { id: string; token: string }[], createdAt: Instant): Promise<void>;
  /** Tickets created at or before `before`. */
  expoTickets(before: Instant): Promise<{ id: string; token: string; createdAt: Instant }[]>;
  deleteExpoTickets(ids: string[]): Promise<void>;
}

export interface Senders {
  expo(messages: ExpoMessage[]): Promise<ExpoTicket[]>;
  expoReceipts(ids: string[]): Promise<Record<string, ExpoReceipt>>;
  /** `gone`: the push service answered 404 or 410, so the subscription is dead. */
  web(subscription: WebSubscription, payload: WebPayload): Promise<'ok' | 'gone' | 'failed'>;
}

export interface NotifyDeps {
  store: NotifyStore;
  senders: Senders;
  /** Attempts for the confirmation-request write on a version conflict. Default 4. */
  maxAttempts?: number;
}

export interface DeliveryReport {
  planned: number;
  /** New in the log (the rest were sent before). */
  claimed: number;
  messages: number;
  /** Devices a message was handed to. */
  delivered: number;
  /** Dead devices removed (Expo DeviceNotRegistered, Web Push 404/410). */
  removed: number;
  failed: number;
}

export const WEB_ICON = '/icons/icon-192.png';
/** Expo receipts are ready about 15 minutes after sending, and kept for a day. */
const RECEIPT_DELAY_MS = 15 * 60_000;
const RECEIPT_EXPIRY_MS = 24 * 60 * 60_000;

export function webPayload(message: PushMessage): WebPayload {
  return { title: message.title, body: message.body, url: message.url, icon: WEB_ICON, tag: message.dedupeKeys[0] };
}

function groupName(rows: GroupRows): string {
  return (rows.group as { name?: string }).name ?? 'Your group';
}

function accountsOf(states: GroupState[]): string[] {
  const ids = new Set<string>();
  for (const state of states) {
    for (const m of state.members) if (m.accountId && m.leftAt === null) ids.add(m.accountId);
  }
  return [...ids];
}

async function profileMap(store: NotifyStore, states: GroupState[]): Promise<Map<string, NotifyProfile>> {
  const accounts = accountsOf(states);
  const profiles = accounts.length ? await store.profiles(accounts) : [];
  return new Map(profiles.map((p) => [p.accountId, p]));
}

// ---------------------------------------------------------------------------
// Delivery

/** Claims the items, batches the new ones per person and sends them to every device. */
export async function deliver(deps: NotifyDeps, items: NotificationItem[], now: Instant): Promise<DeliveryReport> {
  const report: DeliveryReport = { planned: items.length, claimed: 0, messages: 0, delivered: 0, removed: 0, failed: 0 };
  if (items.length === 0) return report;
  const { store, senders } = deps;

  const claimed = new Set(await store.claim(items));
  const fresh = items.filter((i) => claimed.has(i.dedupeKey));
  report.claimed = fresh.length;
  const messages = composeMessages(fresh);
  report.messages = messages.length;
  if (messages.length === 0) return report;

  const devices = await store.devices([...new Set(messages.map((m) => m.accountId))]);
  const counts = new Map<PushMessage, number>(messages.map((m) => [m, 0]));
  const gone: string[] = [];
  const expoQueue: { message: PushMessage; token: string }[] = [];

  for (const message of messages) {
    for (const device of devices.filter((d) => d.accountId === message.accountId)) {
      if (device.kind === 'expo') {
        expoQueue.push({ message, token: device.token });
      } else if (device.subscription) {
        let result: 'ok' | 'gone' | 'failed';
        try {
          result = await senders.web(device.subscription, webPayload(message));
        } catch {
          result = 'failed';
        }
        if (result === 'ok') counts.set(message, counts.get(message)! + 1);
        else if (result === 'gone') gone.push(device.token);
        else report.failed++;
      }
    }
  }

  if (expoQueue.length > 0) {
    const tickets = await senders.expo(expoQueue.map((q) => expoMessage(q.token, q.message)));
    const saved: { id: string; token: string }[] = [];
    tickets.forEach((ticket, i) => {
      const { message, token } = expoQueue[i];
      if (ticket?.status === 'ok') {
        counts.set(message, counts.get(message)! + 1);
        saved.push({ id: ticket.id, token });
      } else if (ticket && isDeviceGone(ticket)) gone.push(token);
      else report.failed++;
    });
    if (saved.length) await store.saveExpoTickets(saved, now);
  }

  if (gone.length) {
    await store.removeDevices([...new Set(gone)]);
    report.removed = new Set(gone).size;
  }
  for (const [message, n] of counts) {
    report.delivered += n;
    if (n > 0) await store.recordDelivery(message.dedupeKeys, n);
  }
  return report;
}

/** Reads Expo receipts for tickets old enough, removing tokens that are DeviceNotRegistered. */
export async function checkExpoReceipts(deps: NotifyDeps, now: Instant): Promise<{ checked: number; removed: number }> {
  const { store, senders } = deps;
  const tickets = await store.expoTickets(new Date(Date.parse(now) - RECEIPT_DELAY_MS).toISOString());
  if (tickets.length === 0) return { checked: 0, removed: 0 };
  const receipts = await senders.expoReceipts(tickets.map((t) => t.id));
  const gone = new Set<string>();
  const done: string[] = [];
  for (const ticket of tickets) {
    const receipt = receipts[ticket.id];
    if (receipt) {
      done.push(ticket.id);
      if (isDeviceGone(receipt)) gone.add(ticket.token);
    } else if (Date.parse(now) - Date.parse(ticket.createdAt) > RECEIPT_EXPIRY_MS) {
      done.push(ticket.id);
    }
  }
  if (gone.size) await store.removeDevices([...gone]);
  if (done.length) await store.deleteExpoTickets(done);
  return { checked: done.length, removed: gone.size };
}

// ---------------------------------------------------------------------------
// Right after a command

export interface AfterCommandInput {
  groupId: string;
  history: HistoryEntry[];
  stateVersion: number;
  now: Instant;
}

/** Plans and sends what a successful group-command caused. */
export async function notifyAfterCommand(deps: NotifyDeps, input: AfterCommandInput): Promise<DeliveryReport> {
  const loaded = await deps.store.load(input.groupId);
  if (!loaded) return deliver(deps, [], input.now);
  const state = stateFromRows(loaded.rows);
  const profiles = await profileMap(deps.store, [state]);
  const items = planCommandNotifications({
    group: { id: input.groupId, name: groupName(loaded.rows), state },
    history: input.history,
    stateVersion: input.stateVersion,
    profiles,
    now: input.now,
  });
  return deliver(deps, items, input.now);
}

// ---------------------------------------------------------------------------
// The 15-minute job

export interface ScheduledReport extends DeliveryReport {
  groups: number;
  /** Assignments asked to confirm (now Pending). */
  confirmationsRequested: number;
  receipts: { checked: number; removed: number };
}

/**
 * Asks to confirm whatever entered the confirmation window (requestConfirmation, as the
 * system, written like any command), then plans and sends the confirmation requests and
 * the timed notifications, then checks Expo receipts.
 */
export async function runScheduled(deps: NotifyDeps, now: Instant): Promise<ScheduledReport> {
  const { store } = deps;
  const groupIds = await store.groupsWithUpcomingEvents(now, lookaheadEnd(now));
  const loaded: { id: string; rows: GroupRows; version: number }[] = [];
  for (const id of groupIds) {
    const result = await store.load(id);
    if (result) loaded.push({ id, ...result });
  }
  const profiles = await profileMap(store, loaded.map((l) => stateFromRows(l.rows)));

  const groups: NotifyGroup[] = [];
  const items: NotificationItem[] = [];
  let confirmationsRequested = 0;
  for (const entry of loaded) {
    const requested = await requestConfirmations(deps, entry, now);
    const group: NotifyGroup = { id: entry.id, name: groupName(requested.rows), state: requested.state };
    groups.push(group);
    if (requested.history.length > 0) {
      confirmationsRequested += requested.count;
      items.push(
        ...planCommandNotifications({ group, history: requested.history, stateVersion: requested.version, profiles, now }),
      );
    }
  }
  items.push(...planScheduledNotifications({ groups, profiles, now }));

  const report = await deliver(deps, items, now);
  let receipts = { checked: 0, removed: 0 };
  try {
    receipts = await checkExpoReceipts(deps, now);
  } catch (error) {
    console.error('Expo receipts failed', error);
  }
  return { ...report, groups: groups.length, confirmationsRequested, receipts };
}

/** requestConfirmation for the Group's Assignments entering the window, with conflict retries. */
async function requestConfirmations(
  deps: NotifyDeps,
  first: { id: string; rows: GroupRows; version: number },
  now: Instant,
): Promise<{ state: GroupState; rows: GroupRows; version: number; history: HistoryEntry[]; count: number }> {
  let current = first;
  for (let attempt = 0; attempt < (deps.maxAttempts ?? 4); attempt++) {
    const state = stateFromRows(current.rows);
    const ids = confirmationRequestsDue(state, now);
    if (ids.length === 0) return { state, rows: current.rows, version: current.version, history: [], count: 0 };
    const result = applyCommand(state, { type: 'requestConfirmation', assignmentIds: ids }, { now, actorId: null });
    if (!result.ok) {
      console.error('requestConfirmation rejected', current.id, result.reason, result.message);
      return { state, rows: current.rows, version: current.version, history: [], count: 0 };
    }
    const version = await deps.store.persist({
      groupId: current.id,
      expectedVersion: current.version,
      rows: rowsFromState(result.state),
      history: result.history,
    });
    if (version !== null) {
      return { state: result.state, rows: current.rows, version, history: result.history, count: ids.length };
    }
    const reloaded = await deps.store.load(current.id);
    if (!reloaded) break;
    current = { id: current.id, ...reloaded };
  }
  const state = stateFromRows(current.rows);
  return { state, rows: current.rows, version: current.version, history: [], count: 0 };
}
