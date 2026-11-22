/**
 * The "Get Rotaloop on your phone" header icon (feedback-2 tickets 06 and 07): whether to show
 * it and which variant. Pure, so it is unit-tested under Node. The browser facts are read in
 * installEvent.web.ts and useInstallCard.web.ts.
 */

import { isIosDevice } from './pushStatus';

/** How the person can put the website on their phone. */
export type InstallVariant =
  /** iPhone or iPad Safari: Share, then "Add to Home Screen" (the only way to get reminders). */
  | 'ios'
  /** The browser offered an install prompt (Android Chrome and friends): one tap. */
  | 'prompt'
  /** A phone browser without the prompt (e.g. Firefox): steps through its menu. */
  | 'menu';

export type InstallFacts = {
  userAgent: string;
  maxTouchPoints: number;
  /** Opened from the Home Screen already (`display-mode: standalone` or iOS `navigator.standalone`). */
  standalone: boolean;
  /** A `beforeinstallprompt` event is saved and can still be used. */
  promptAvailable: boolean;
};

/** Which variant to show, or null for no icon (installed, or a desktop). */
export function installCardVariant(facts: InstallFacts): InstallVariant | null {
  if (facts.standalone) return null;
  if (isIosDevice(facts.userAgent, facts.maxTouchPoints)) return 'ios';
  // Only phones and tablets: a desktop browser can install too, but this icon is for the phone.
  if (!/Android/.test(facts.userAgent)) return null;
  return facts.promptAvailable ? 'prompt' : 'menu';
}

/** The numbered steps in the sheet (not used for the one-tap prompt). */
export function installSteps(variant: Exclude<InstallVariant, 'prompt'>, appName: string): string[] {
  return variant === 'ios'
    ? ['Tap Share in Safari', 'Tap “Add to Home Screen”', `Open ${appName} from your Home Screen`]
    : ['Open the browser menu (⋮)', 'Tap “Install app” or “Add to Home screen”', `Open ${appName} from your Home screen`];
}
