/**
 * Web notifications (ticket 11): when a notification is clicked and the app is already open,
 * the service worker (public/sw.js) focuses it and posts { type: 'open-url', url }; this
 * opens that path in the running app. With no window open, the service worker opens one at
 * the URL instead. Also keeps this browser's subscription saved for the signed-in account.
 */
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';

import { refreshPushRegistration } from './push';
import { appPathFrom } from './pushStatus';

export function useNotificationTaps(enabled: boolean, pushEnabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'open-url') return;
      const path = appPathFrom(event.data.url);
      if (path) router.push(path as Href);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [enabled]);

  useEffect(() => {
    if (enabled && pushEnabled) refreshPushRegistration();
  }, [enabled, pushEnabled]);
}
