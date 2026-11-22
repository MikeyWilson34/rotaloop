/**
 * The website's "Get Rotaloop on your phone" card state: reads the browser facts, applies
 * installCardVariant (src/lib/installCard.ts) and remembers "Not now" in localStorage.
 */
import { useCallback, useState, useSyncExternalStore } from 'react';

import { hasInstallPrompt, promptInstall, subscribeInstallEvent, wasInstalled } from './installEvent';
import { installCardVariant } from './installCard';
import type { InstallCardState } from './useInstallCard';

const KEY = 'rotaloop.installDismissedAt';

function readDismissedAt(): number | null {
  try {
    const value = Number(window.localStorage.getItem(KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null; // storage unavailable: the card just shows again next time
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
  const [dismissedAt, setDismissedAt] = useState<number | null>(readDismissedAt);
  const [now] = useState(() => Date.now());

  const dismiss = useCallback(() => {
    const at = Date.now();
    setDismissedAt(at);
    try {
      window.localStorage.setItem(KEY, String(at));
    } catch {
      // ignore: hidden for this visit only
    }
  }, []);

  const install = useCallback(async () => {
    await promptInstall();
  }, []);

  const variant =
    installed
      ? null
      : installCardVariant({
          userAgent: navigator.userAgent,
          maxTouchPoints: navigator.maxTouchPoints ?? 0,
          standalone: isStandalone(),
          promptAvailable,
          dismissedAt,
          now,
        });
  return { variant, install, dismiss };
}
