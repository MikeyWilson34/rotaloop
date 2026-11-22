/** Native apps have nothing to install: the website's version is installEvent.web.ts. */
export function hasInstallPrompt(): boolean {
  return false;
}

export function wasInstalled(): boolean {
  return false;
}

export function subscribeInstallEvent(): () => void {
  return () => {};
}

export async function promptInstall(): Promise<boolean> {
  return false;
}
