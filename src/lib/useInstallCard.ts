/** Native apps never show the install card: the website's version is useInstallCard.web.ts. */
import type { InstallVariant } from './installCard';

export type InstallCardState = {
  variant: InstallVariant | null;
  /** Runs the browser's install prompt (the 'prompt' variant). */
  install: () => Promise<void>;
  /** "Not now": hides the card on this device for a while. */
  dismiss: () => void;
};

const NONE: InstallCardState = { variant: null, install: async () => {}, dismiss: () => {} };

export function useInstallCard(): InstallCardState {
  return NONE;
}
