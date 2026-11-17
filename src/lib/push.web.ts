/**
 * Push notifications on the website: Web Push with VAPID (ticket 11). Same API as push.ts
 * (Metro picks this file on web). The service worker is public/sw.js; the server sends from
 * the notify Edge Function. On iPhone and iPad it only works in the installed web app ("Add
 * to Home Screen", iOS 16.4+), so a Safari tab gets `needsInstall` instead of a prompt.
 */
import type { Json } from './database.types';
import { base64UrlToBytes, isIosBrowserTab, type PushChannelStatus, type PushSetupResult } from './pushStatus';
import { supabase } from './supabase';

export type { PushChannelStatus, PushSetupResult } from './pushStatus';

export const PUSH_PLATFORM: 'web' | 'native' = 'web';

/** Public by design: browsers need it to subscribe. The private half is a server secret. */
const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ?? '';
const SERVICE_WORKER = '/sw.js';

function hasWebPush(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function iosBrowserTab(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return isIosBrowserTab({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints ?? 0, standalone });
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration('/');
  return (await registration?.pushManager.getSubscription()) ?? null;
}

function sameKey(subscription: PushSubscription): boolean {
  const key = subscription.options?.applicationServerKey;
  if (!key) return true;
  const a = new Uint8Array(key);
  const b = base64UrlToBytes(VAPID_PUBLIC_KEY);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

async function saveSubscription(subscription: PushSubscription): Promise<void> {
  const { error } = await supabase.rpc('register_web_push', { p_subscription: subscription.toJSON() as Json });
  if (error) throw error;
}

/** This browser's push status, for Profile. */
export async function getPushStatus(): Promise<PushChannelStatus> {
  if (!VAPID_PUBLIC_KEY) return 'notConfigured';
  if (iosBrowserTab()) return 'needsInstall';
  if (!hasWebPush()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  try {
    const subscription = await currentSubscription();
    return subscription && Notification.permission === 'granted' ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

/**
 * Asks for notification permission, subscribes this browser with the VAPID key and saves the
 * subscription for the signed-in account (`register_web_push`). Never throws.
 */
export async function enablePushNotifications(): Promise<PushSetupResult> {
  if (iosBrowserTab()) return 'needsInstall';
  if (!VAPID_PUBLIC_KEY || !hasWebPush()) return 'unsupported';
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return 'denied';
    await navigator.serviceWorker.register(SERVICE_WORKER, { scope: '/' });
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !sameKey(subscription)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(VAPID_PUBLIC_KEY),
    });
    await saveSubscription(subscription);
    return 'registered';
  } catch (error) {
    console.warn('Web push setup failed', error);
    return 'failed';
  }
}

/** Unsubscribes this browser and forgets its subscription on the server. Never throws. */
export async function disablePushNotifications(): Promise<void> {
  if (!hasWebPush()) return;
  try {
    const subscription = await currentSubscription();
    if (!subscription) return;
    await supabase.rpc('unregister_push_token', { p_token: subscription.endpoint });
    await subscription.unsubscribe();
  } catch (error) {
    console.warn('Web push unsubscribe failed', error);
  }
}

/** Saves this browser's existing subscription for whoever is signed in now. Never prompts. */
export async function refreshPushRegistration(): Promise<void> {
  if (!VAPID_PUBLIC_KEY || !hasWebPush() || Notification.permission !== 'granted') return;
  try {
    const subscription = await currentSubscription();
    if (subscription && sameKey(subscription)) await saveSubscription(subscription);
  } catch (error) {
    console.warn('Web push refresh failed', error);
  }
}
