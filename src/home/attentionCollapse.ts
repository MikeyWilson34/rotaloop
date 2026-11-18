/**
 * Whether Home's "Needs your attention" section is collapsed, remembered on this device.
 * Pure (storage is passed in), so it is unit-tested under Node; useAttentionCollapsed.ts binds
 * it to AsyncStorage. Any storage failure falls back to expanded: it's only a convenience.
 */
import type { KeyValueStore } from '../activity/lastSeenStore';

export const ATTENTION_COLLAPSED_KEY = 'rotaloop.home.attentionCollapsed';

/** A stored value back to "collapsed". Missing or garbled means expanded (the default). */
export function parseCollapsed(value: string | null): boolean {
  return value === 'collapsed';
}

export async function loadAttentionCollapsed(storage: KeyValueStore): Promise<boolean> {
  try {
    return parseCollapsed(await storage.getItem(ATTENTION_COLLAPSED_KEY));
  } catch {
    return false;
  }
}

export async function saveAttentionCollapsed(storage: KeyValueStore, collapsed: boolean): Promise<void> {
  try {
    await storage.setItem(ATTENTION_COLLAPSED_KEY, collapsed ? 'collapsed' : 'expanded');
  } catch {
    // Not saved: the section just opens expanded next time.
  }
}

/** The line shown under the collapsed header, so nothing is hidden silently. */
export function collapsedSummary(count: number): string {
  if (count === 0) return "You're all caught up.";
  return count === 1 ? '1 item hidden. Tap the heading to show it.' : `${count} items hidden. Tap the heading to show them.`;
}
