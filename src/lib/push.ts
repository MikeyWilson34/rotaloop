/**
 * Push notifications on iOS and Android: Expo push tokens (ticket 05, ticket 11). The
 * website uses Web Push instead: push.web.ts has the same API (Metro picks it on web).
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import { EAS_PROJECT_ID } from '@/config/app';

import type { PushChannelStatus, PushSetupResult } from './pushStatus';
import { supabase } from './supabase';

export type { PushChannelStatus, PushSetupResult } from './pushStatus';

/** Which channel this build uses: Expo push here, Web Push on the website. */
export const PUSH_PLATFORM: 'web' | 'native' = 'native';

/** No push in a simulator, or in Expo Go on Android since SDK 53. */
function pushUnavailable(): boolean {
  const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  return !Device.isDevice || (inExpoGo && Platform.OS === 'android');
}

async function registerToken(): Promise<void> {
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
  const { error } = await supabase.rpc('register_push_token', {
    p_token: token,
    p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });
  if (error) throw error;
}

/**
 * Asks for notification permission and registers this device's Expo push token for the
 * signed-in account (`register_push_token`). Never throws: push setup must not block onboarding.
 * - `registered`: permission granted and the token is saved.
 * - `denied`: the person (or the OS) said no.
 * - `unsupported`: no push here (permission may still have been granted).
 * - `failed`: something went wrong getting or saving the token.
 */
export async function enablePushNotifications(): Promise<PushSetupResult> {
  try {
    if (Platform.OS === 'android') {
      // Android 13+ only shows the permission prompt once a channel exists.
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Reminders and coverage',
        importance: AndroidImportance.DEFAULT,
      });
    }

    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted ? true : (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return 'denied';
    if (pushUnavailable()) return 'unsupported';
    await registerToken();
    return 'registered';
  } catch (error) {
    console.warn('Push notification setup failed', error);
    return 'failed';
  }
}

/**
 * Push off is the account's `push_enabled` flag, which the server checks before sending; the
 * device keeps its token so turning push back on needs no new prompt.
 */
export async function disablePushNotifications(): Promise<void> {}

/** This device's push status, for Profile. */
export async function getPushStatus(): Promise<PushChannelStatus> {
  if (pushUnavailable()) return 'unsupported';
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (permission.granted) return 'on';
    return permission.canAskAgain ? 'off' : 'blocked';
  } catch {
    return 'unsupported';
  }
}

/**
 * Re-registers this device's token for whoever is signed in now (tokens can change, and a
 * device can switch accounts), when permission was already given. Never prompts or throws.
 */
export async function refreshPushRegistration(): Promise<void> {
  try {
    if (pushUnavailable() || !(await Notifications.getPermissionsAsync()).granted) return;
    await registerToken();
  } catch (error) {
    console.warn('Push token refresh failed', error);
  }
}
