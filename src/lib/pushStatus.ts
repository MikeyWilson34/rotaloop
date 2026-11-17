/**
 * Push notification status per channel (ticket 11), and the small pure helpers the web and
 * native push code share. Unit-tested under Node.
 */

/**
 * - `on`: this device or browser is registered and allowed to show notifications.
 * - `off`: allowed, or not asked yet, but not registered here.
 * - `blocked`: the person (or the OS / browser) said no; only their settings can undo it.
 * - `needsInstall`: iPhone or iPad Safari outside an installed web app: Web Push only works
 *   after "Add to Home Screen".
 * - `unsupported`: no push here (an old browser, a simulator, or Expo Go on Android).
 * - `notConfigured`: the website was built without the VAPID public key.
 */
export type PushChannelStatus = 'on' | 'off' | 'blocked' | 'needsInstall' | 'unsupported' | 'notConfigured';

export type PushSetupResult = 'registered' | 'denied' | 'unsupported' | 'needsInstall' | 'failed';

/** What Profile shows under the push switch. */
export function pushStatusText(status: PushChannelStatus, platform: 'web' | 'native'): string {
  const here = platform === 'web' ? 'this browser' : 'this device';
  switch (status) {
    case 'on':
      return `On for ${here}`;
    case 'off':
      return `Off for ${here}`;
    case 'blocked':
      return platform === 'web' ? 'Blocked in browser settings' : 'Blocked in device settings';
    case 'needsInstall':
      return 'Add to Home Screen to enable on iPhone';
    case 'unsupported':
      return platform === 'web' ? 'Not supported in this browser' : 'Not available on this device';
    case 'notConfigured':
      return 'Not available on the website yet';
  }
}

/** Whether the switch can do anything here (it can't fix a block or an iPhone browser tab). */
export function canTogglePush(status: PushChannelStatus): boolean {
  return status === 'on' || status === 'off';
}

/**
 * An iPhone or iPad browser tab, not the installed web app: Web Push only works once the site
 * is added to the Home Screen and opened from there (iOS 16.4+). iPadOS reports a Mac user
 * agent, so touch support tells them apart.
 */
export function isIosBrowserTab(input: { userAgent: string; maxTouchPoints: number; standalone: boolean }): boolean {
  const ios = /iPhone|iPad|iPod/.test(input.userAgent) || (/Macintosh/.test(input.userAgent) && input.maxTouchPoints > 1);
  return ios && !input.standalone;
}

/** The VAPID public key (base64url) as the bytes `pushManager.subscribe` wants. */
export function base64UrlToBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64Url.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A notification's link, if it is an in-app path (never another site). */
export function appPathFrom(url: unknown): string | null {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : null;
}

/** Shown instead of a permission prompt in an iPhone or iPad browser tab. */
export const INSTALL_HINT =
  'On iPhone and iPad, notifications from the website need it on your Home Screen: tap Share, then “Add to Home Screen”, open it from there and turn notifications on.';

/** How to undo a block. */
export function blockedHint(platform: 'web' | 'native', appName: string): string {
  return platform === 'web'
    ? 'Notifications are blocked for this site in your browser settings. Allow them there, then try again.'
    : `Notifications are turned off for ${appName} in your device settings. Turn them on there, then try again.`;
}

/** The status to show, given the account's push switch (a granted device with push off reads "Off"). */
export function shownPushStatus(status: PushChannelStatus, pushEnabled: boolean): PushChannelStatus {
  return status === 'on' && !pushEnabled ? 'off' : status;
}
