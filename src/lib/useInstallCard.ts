/** Native apps never show the install icon: the website's version is useInstallCard.web.ts. */
import type { InstallVariant } from './installCard';

export type InstallCardState = {
  variant: InstallVariant | null;
  /** True until the icon has been tapped once on this device (shows the small dot). */
  fresh: boolean;
  /** Runs the browser's install prompt (the 'prompt' variant). */
  install: () => Promise<void>;
  /** Remembers the icon was tapped (the dot goes away). */
  markSeen: () => void;
};

const NONE: InstallCardState = { variant: null, fresh: false, install: async () => {}, markSeen: () => {} };

export function useInstallCard(): InstallCardState {
  return NONE;
}
