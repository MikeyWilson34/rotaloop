import { describe, expect, it } from 'vitest';

import {
  appPathFrom,
  base64UrlToBytes,
  blockedHint,
  canTogglePush,
  isIosBrowserTab,
  pushStatusText,
  shownPushStatus,
} from '../pushStatus';
import { reminderSummary } from '../notificationPrefs';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';

describe('push status per channel', () => {
  it('reads plainly on the website and on a device', () => {
    expect(pushStatusText('on', 'web')).toBe('On for this browser');
    expect(pushStatusText('blocked', 'web')).toBe('Blocked in browser settings');
    expect(pushStatusText('needsInstall', 'web')).toBe('Add to Home Screen to enable on iPhone');
    expect(pushStatusText('on', 'native')).toBe('On for this device');
    expect(pushStatusText('blocked', 'native')).toBe('Blocked in device settings');
    expect(pushStatusText('unsupported', 'native')).toBe('Not available on this device');
    expect(pushStatusText('notConfigured', 'web')).toBe('Not available on the website yet');
  });

  it('the switch only works where it can change something', () => {
    expect(canTogglePush('on')).toBe(true);
    expect(canTogglePush('off')).toBe(true);
    for (const s of ['blocked', 'needsInstall', 'unsupported', 'notConfigured'] as const) expect(canTogglePush(s)).toBe(false);
  });

  it('a granted device reads "Off" while the account has push off', () => {
    expect(shownPushStatus('on', false)).toBe('off');
    expect(shownPushStatus('on', true)).toBe('on');
    expect(shownPushStatus('blocked', false)).toBe('blocked');
  });

  it('tells how to undo a block', () => {
    expect(blockedHint('web', 'Rotaloop')).toMatch(/browser settings/);
    expect(blockedHint('native', 'Rotaloop')).toMatch(/Rotaloop in your device settings/);
  });
});

describe('isIosBrowserTab', () => {
  it('is an iPhone or iPad browser tab, not the installed web app or other phones', () => {
    expect(isIosBrowserTab({ userAgent: IPHONE, maxTouchPoints: 5, standalone: false })).toBe(true);
    expect(isIosBrowserTab({ userAgent: IPHONE, maxTouchPoints: 5, standalone: true })).toBe(false);
    // iPadOS reports a Mac; touch gives it away.
    expect(isIosBrowserTab({ userAgent: IPAD, maxTouchPoints: 5, standalone: false })).toBe(true);
    expect(isIosBrowserTab({ userAgent: IPAD, maxTouchPoints: 0, standalone: false })).toBe(false);
    expect(isIosBrowserTab({ userAgent: ANDROID, maxTouchPoints: 5, standalone: false })).toBe(false);
  });
});

describe('helpers', () => {
  it('decodes a base64url VAPID key', () => {
    expect([...base64UrlToBytes('AQID_-8')]).toEqual([1, 2, 3, 255, 239]);
    expect(base64UrlToBytes('BOr9cM1lfnFEcVhNZzVL6cW9bAZpZKs7dE1Wn5u7XvW0QwVQ8xjDQ8KQ6h9tZtM6YRXnSKs1wGEnHBEi1v3qD0s')).toHaveLength(65);
  });

  it('only opens in-app paths from a notification', () => {
    expect(appPathFrom('/assignment/g/a?action=cover')).toBe('/assignment/g/a?action=cover');
    expect(appPathFrom('https://evil.example/')).toBeNull();
    expect(appPathFrom('//evil.example/')).toBeNull();
    expect(appPathFrom(undefined)).toBeNull();
  });
});

describe('reminderSummary', () => {
  const prefs = (days: number[], time = '18:00:00', push = true) => ({ push_enabled: push, reminder_days_before: days, reminder_time: time });

  it('describes the real reminder settings', () => {
    expect(reminderSummary(prefs([1]))).toBe("We'll remind you the day before at 6:00 PM.");
    expect(reminderSummary(prefs([1, 7]))).toBe("We'll remind you a week before and the day before at 6:00 PM.");
    expect(reminderSummary(prefs([7, 2, 1], '08:00'))).toBe("We'll remind you a week before, 2 days before and the day before at 8:00 AM.");
  });

  it('"Morning of" uses the morning time it is really sent at', () => {
    expect(reminderSummary(prefs([0]))).toBe("We'll remind you the morning of at 7:00 AM.");
    expect(reminderSummary(prefs([1, 0]))).toBe("We'll remind you the day before at 6:00 PM, and the morning of at 7:00 AM.");
    expect(reminderSummary(prefs([1, 0], '08:00'))).toBe("We'll remind you the day before and the morning of at 8:00 AM.");
  });

  it('says so when reminders are off', () => {
    expect(reminderSummary(prefs([]))).toBe('You have no reminders set. Choose some in Profile.');
    expect(reminderSummary(prefs([1], '18:00', false))).toMatch(/^Reminders are off/);
  });
});
