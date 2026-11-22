import { describe, expect, it } from 'vitest';

import { installCardVariant, installSteps, type InstallFacts } from '../installCard';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const ANDROID_FIREFOX = 'Mozilla/5.0 (Android 14; Mobile; rv:125.0) Gecko/125.0 Firefox/125.0';
const DESKTOP_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const facts = (over: Partial<InstallFacts>): InstallFacts => ({
  userAgent: DESKTOP_CHROME,
  maxTouchPoints: 0,
  standalone: false,
  promptAvailable: false,
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

});

describe('install steps', () => {
  it('has three steps on iPhone and the menu steps elsewhere', () => {
    expect(installSteps('ios', 'Rotaloop')).toHaveLength(3);
    expect(installSteps('ios', 'Rotaloop')[1]).toContain('Add to Home Screen');
    expect(installSteps('menu', 'Rotaloop')[0]).toContain('menu');
  });
});
