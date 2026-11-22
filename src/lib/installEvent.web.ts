/**
 * Catches the browser's install prompt (`beforeinstallprompt`) as early as possible: it can
 * fire before Home mounts, so this module is imported at startup (src/app/_layout.tsx). It
 * keeps the event (after `preventDefault()`, so the browser's own mini-bar stays away) for the
 * "Get Rotaloop on your phone" card, which calls `promptInstall()` when tapped.
 */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let saved: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    saved = event as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    saved = null;
    installed = true;
    emit();
  });
}

export function hasInstallPrompt(): boolean {
  return saved !== null;
}

/** True once the app was installed during this visit (the card hides). */
export function wasInstalled(): boolean {
  return installed;
}

export function subscribeInstallEvent(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Shows the browser's install dialog. A saved event works once; resolves true if accepted. */
export async function promptInstall(): Promise<boolean> {
  const event = saved;
  if (!event) return false;
  saved = null;
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === 'accepted') installed = true;
    return outcome === 'accepted';
  } catch {
    return false;
  } finally {
    emit();
  }
}
