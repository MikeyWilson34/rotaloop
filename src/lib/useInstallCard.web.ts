/**
 * The website's "Get Rotaloop on your phone" icon state: reads the browser facts, applies
 * installCardVariant (src/lib/installCard.ts) and remembers the first tap (for the dot) in
 * localStorage.
 */
import { useCallback, useState, useSyncExternalStore } from 'react';

import { hasInstallPrompt, promptInstall, subscribeInstallEvent, wasInstalled } from './installEvent';
import { installCardVariant } from './installCard';
import type { InstallCardState } from './useInstallCard';

const KEY = 'rotaloop.installIconSeen';

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return true; // storage unavailable: no dot is fine
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function useInstallCard(): InstallCardState {
  const promptAvailable = useSyncExternalStore(subscribeInstallEvent, hasInstallPrompt, () => false);
  const installed = useSyncExternalStore(subscribeInstallEvent, wasInstalled, () => false);
  // The site is a single-page export (no server render), so storage can be read right away.
  const [seen, setSeen] = useState<boolean>(readSeen);

  const markSeen = useCallback(() => {
    setSeen(true);
    try {
      window.localStorage.setItem(KEY, '1');
    } catch {
      // ignore: the dot is gone for this visit only
    }
  }, []);

  const install = useCallback(async () => {
    await promptInstall();
  }, []);

  const variant = installed
    ? null
    : installCardVariant({
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints ?? 0,
        standalone: isStandalone(),
        promptAvailable,
      });
  return { variant, fresh: variant !== null && !seen, install, markSeen };
}
