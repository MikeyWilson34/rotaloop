import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import { EAS_PROJECT_ID } from '@/config/app';

import { supabase } from './supabase';

/**
 * - `registered`: permission granted and this device's Expo push token is saved.
 * - `denied`: the person (or the OS) said no to notifications.
 * - `unsupported`: no push here (web, a simulator, or Expo Go on Android since SDK 53).
 *   Permission may still have been granted.
 * - `failed`: something went wrong getting or saving the token.
 */
/** Expo push doesn't reach browsers; web push is a follow-up (iOS needs an installed PWA). */
export const PUSH_ON_THIS_PLATFORM = Platform.OS !== 'web';

/** Shown on the website where the push setting would be. */
export const WEB_PUSH_NOTE = "Notifications on the website are coming soon; reminders will show in the app.";

export type PushSetupResult = 'registered' | 'denied' | 'unsupported' | 'failed';

/**
 * Asks for notification permission and registers this device's Expo push token for the
 * signed-in account (`register_push_token`). Never throws: push setup must not block onboarding.
 */
export async function enablePushNotifications(): Promise<PushSetupResult> {
  // Web push needs a service worker and VAPID keys; not part of the MVP.
  if (!PUSH_ON_THIS_PLATFORM) return 'unsupported';
  try {
    if (Platform.OS === 'android') {
      // Android 13+ only shows the permission prompt once a channel exists.
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Reminders and coverage',
        importance: AndroidImportance.DEFAULT,
      });
    }

    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted
      ? true
      : (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return 'denied';

    const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
    if (!Device.isDevice || (inExpoGo && Platform.OS === 'android')) return 'unsupported';

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
    const { error } = await supabase.rpc('register_push_token', {
      p_token: token,
      p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
    if (error) throw error;
    return 'registered';
  } catch (error) {
    console.warn('Push notification setup failed', error);
    return 'failed';
  }
}
