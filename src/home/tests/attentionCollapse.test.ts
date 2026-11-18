import { describe, expect, it } from 'vitest';

import type { KeyValueStore } from '../../activity/lastSeenStore';
import {
  ATTENTION_COLLAPSED_KEY,
  collapsedSummary,
  loadAttentionCollapsed,
  parseCollapsed,
  saveAttentionCollapsed,
} from '../attentionCollapse';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: async (key) => data[key] ?? null,
    setItem: async (key, value) => {
      data[key] = value;
    },
  };
}

const broken: KeyValueStore = {
  getItem: () => Promise.reject(new Error('storage unavailable')),
  setItem: () => {
    throw new Error('storage unavailable');
  },
};

describe('"Needs your attention" collapse, remembered per device', () => {
  it('defaults to expanded when nothing or something garbled is stored', () => {
    expect(parseCollapsed(null)).toBe(false);
    expect(parseCollapsed('yes')).toBe(false);
    expect(parseCollapsed('expanded')).toBe(false);
    expect(parseCollapsed('collapsed')).toBe(true);
  });

  it('saves and loads the choice', async () => {
    const store = memoryStore();
    expect(await loadAttentionCollapsed(store)).toBe(false);
    await saveAttentionCollapsed(store, true);
    expect(store.data[ATTENTION_COLLAPSED_KEY]).toBe('collapsed');
    expect(await loadAttentionCollapsed(store)).toBe(true);
    await saveAttentionCollapsed(store, false);
    expect(await loadAttentionCollapsed(store)).toBe(false);
  });

  it('falls back to expanded, without throwing, when storage fails', async () => {
    expect(await loadAttentionCollapsed(broken)).toBe(false);
    await expect(saveAttentionCollapsed(broken, true)).resolves.toBeUndefined();
  });

  it('says how many items are hidden when collapsed', () => {
    expect(collapsedSummary(0)).toBe("You're all caught up.");
    expect(collapsedSummary(1)).toBe('1 item hidden. Tap the heading to show it.');
    expect(collapsedSummary(3)).toBe('3 items hidden. Tap the heading to show them.');
  });
});
