/**
 * The Expo Push API (https://docs.expo.dev/push-notifications/sending-notifications/):
 * batched sends, tickets and receipts. Plain `fetch`, so it runs in the Edge Function and
 * under Node tests (pass a fake fetch).
 */

export const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
/** The API takes at most 100 messages per request, and 1000 receipt ids. */
export const EXPO_SEND_BATCH = 100;
export const EXPO_RECEIPT_BATCH = 1000;

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: { url: string };
  sound: 'default';
  channelId: 'default';
  priority: 'high';
}

export type ExpoTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message?: string; details?: { error?: string } };

export type ExpoReceipt =
  | { status: 'ok' }
  | { status: 'error'; message?: string; details?: { error?: string } };

type Fetch = typeof fetch;

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function expoMessage(token: string, message: { title: string; body: string; url: string }): ExpoMessage {
  return {
    to: token,
    title: message.title,
    body: message.body,
    data: { url: message.url },
    sound: 'default',
    channelId: 'default',
    priority: 'high',
  };
}

/** Sends the messages in batches of 100. Returns one ticket per message, in order. */
export async function sendExpoMessages(messages: ExpoMessage[], fetchImpl: Fetch = fetch): Promise<ExpoTicket[]> {
  const tickets: ExpoTicket[] = [];
  for (const batch of chunks(messages, EXPO_SEND_BATCH)) {
    try {
      const response = await fetchImpl(EXPO_SEND_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });
      const json = (await response.json().catch(() => null)) as { data?: ExpoTicket[] } | null;
      const data = response.ok && Array.isArray(json?.data) ? json!.data : null;
      for (let i = 0; i < batch.length; i++) {
        tickets.push(data?.[i] ?? { status: 'error', message: `HTTP ${response.status}` });
      }
    } catch (error) {
      for (let i = 0; i < batch.length; i++) tickets.push({ status: 'error', message: String(error) });
    }
  }
  return tickets;
}

/** Fetches receipts for ticket ids (missing ones aren't ready yet). */
export async function fetchExpoReceipts(ids: string[], fetchImpl: Fetch = fetch): Promise<Record<string, ExpoReceipt>> {
  const receipts: Record<string, ExpoReceipt> = {};
  for (const batch of chunks(ids, EXPO_RECEIPT_BATCH)) {
    const response = await fetchImpl(EXPO_RECEIPTS_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: batch }),
    });
    const json = (await response.json().catch(() => null)) as { data?: Record<string, ExpoReceipt> } | null;
    Object.assign(receipts, json?.data ?? {});
  }
  return receipts;
}

/** The device is gone (app uninstalled, token expired): stop sending to it. */
export function isDeviceGone(result: ExpoTicket | ExpoReceipt): boolean {
  return result.status === 'error' && result.details?.error === 'DeviceNotRegistered';
}
