/**
 * Native notifications (ticket 11): show them while the app is open, open the Assignment a
 * tapped notification links to, and keep this device's push token registered. The website's
 * version is notificationTaps.web.ts.
 */
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';

import { refreshPushRegistration } from './push';
import { appPathFrom } from './pushStatus';

// Show notifications that arrive while the app is in the foreground too.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * `enabled`: the person is signed in and in the app (taps wait until then, so a cold start
 * from a notification still lands on its Assignment after the splash and auth gate).
 */
export function useNotificationTaps(enabled: boolean, pushEnabled: boolean): void {
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !response) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const path = appPathFrom(response.notification.request.content.data?.url);
    if (path) router.push(path as Href);
  }, [enabled, response]);

  useEffect(() => {
    if (enabled && pushEnabled) refreshPushRegistration();
  }, [enabled, pushEnabled]);
}
