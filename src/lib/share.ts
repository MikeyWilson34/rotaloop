import * as Clipboard from 'expo-clipboard';
import { Platform, Share } from 'react-native';

/** Copies text. Returns false if the clipboard isn't available. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Opens the system share sheet with a link. On web it uses the browser's share sheet where
 * there is one, and otherwise copies the link. Returns what happened.
 */
export async function shareLink(url: string, message: string): Promise<'shared' | 'copied' | 'failed'> {
  if (Platform.OS === 'web') {
    const nav = (globalThis as { navigator?: Navigator }).navigator;
    if (nav?.share) {
      try {
        await nav.share({ text: message, url });
        return 'shared';
      } catch (e) {
        // Dismissing the browser's share sheet isn't an error worth copying for.
        if (e instanceof Error && e.name === 'AbortError') return 'shared';
      }
    }
    return (await copyText(url)) ? 'copied' : 'failed';
  }
  try {
    // iOS shows `url` as a rich link; Android only sends `message`, so the link goes in both.
    await Share.share(Platform.OS === 'ios' ? { message, url } : { message: `${message} ${url}` });
    return 'shared';
  } catch {
    return 'failed';
  }
}
