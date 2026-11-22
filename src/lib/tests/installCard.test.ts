import { describe, expect, it } from 'vitest';

import { INSTALL_DISMISS_MS, installCardVariant, installSteps, installSubtitle, type InstallFacts } from '../installCard';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const ANDROID_FIREFOX = 'Mozilla/5.0 (Android 14; Mobile; rv:125.0) Gecko/125.0 Firefox/125.0';
const DESKTOP_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const NOW = Date.UTC(2026, 10, 21);

const facts = (over: Partial<InstallFacts>): InstallFacts => ({
  userAgent: DESKTOP_CHROME,
  maxTouchPoints: 0,
  standalone: false,
  promptAvailable: false,
  dismissedAt: null,
  now: NOW,
  ...over,
});

describe('installCardVariant', () => {
  it('iPhone and iPad browser tabs get the Home Screen steps', () => {
    expect(installCardVariant(facts({ userAgent: IPHONE, maxTouchPoints: 5 }))).toBe('ios');
    expect(installCardVariant(facts({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5 }))).toBe('ios');
  });

  it('Android with the saved prompt installs in one tap; without it shows the menu steps', () => {
    expect(installCardVariant(facts({ userAgent: ANDROID_CHROME, maxTouchPoints: 5, promptAvailable: true }))).toBe('prompt');
    expect(installCardVariant(facts({ userAgent: ANDROID_FIREFOX, maxTouchPoints: 5 }))).toBe('menu');
  });

  it('never shows on a desktop, even with the prompt', () => {
    expect(installCardVariant(facts({}))).toBeNull();
    expect(installCardVariant(facts({ promptAvailable: true }))).toBeNull();
    // A real Mac has no touch screen.
    expect(installCardVariant(facts({ userAgent: IPAD_AS_MAC, maxTouchPoints: 0 }))).toBeNull();
  });

  it('never shows once installed (standalone)', () => {
    expect(installCardVariant(facts({ userAgent: IPHONE, maxTouchPoints: 5, standalone: true }))).toBeNull();
    expect(installCardVariant(facts({ userAgent: ANDROID_CHROME, maxTouchPoints: 5, standalone: true, promptAvailable: true }))).toBeNull();
  });

  it('"Not now" hides it for 30 days, then it comes back', () => {
    const base = { userAgent: IPHONE, maxTouchPoints: 5 };
    expect(installCardVariant(facts({ ...base, dismissedAt: NOW - 1000 }))).toBeNull();
    expect(installCardVariant(facts({ ...base, dismissedAt: NOW - INSTALL_DISMISS_MS + 1 }))).toBeNull();
    expect(installCardVariant(facts({ ...base, dismissedAt: NOW - INSTALL_DISMISS_MS }))).toBe('ios');
    expect(installCardVariant(facts({ ...base, dismissedAt: NOW - 90 * 24 * 60 * 60 * 1000 }))).toBe('ios');
  });
});

describe('install card words', () => {
  it('has a subtitle per variant', () => {
    expect(installSubtitle('ios')).toBe('Add it to your Home Screen to get reminders');
    expect(installSubtitle('prompt')).toBe('Install it to open in one tap');
    expect(installSubtitle('menu')).toBe('Install it to open in one tap');
  });

  it('has three steps on iPhone and the menu steps elsewhere', () => {
    expect(installSteps('ios', 'Rotaloop')).toHaveLength(3);
    expect(installSteps('ios', 'Rotaloop')[1]).toContain('Add to Home Screen');
    expect(installSteps('menu', 'Rotaloop')[0]).toContain('menu');
  });
});
