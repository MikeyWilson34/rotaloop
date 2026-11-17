/**
 * "Last seen" for the Activity tab: a small store in front of a key-value storage, so the tab
 * badge and the Activity screen agree as soon as it changes. Pure (storage is passed in), so
 * it is unit-tested under Node; src/activity/lastSeen.ts binds it to AsyncStorage.
 */
import type { Instant } from '../engine/types';
import { laterOf } from './feed';

export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export function lastSeenKey(userId: string): string {
  return `rotaloop.activity.lastSeen.${userId}`;
}

/** A stored value back to an instant, or null when it's missing or garbled. */
export function parseLastSeen(value: string | null): Instant | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export type LastSeenStore = ReturnType<typeof createLastSeenStore>;

/** Reads and writes "last seen" per account, keeping the latest value in memory. */
export function createLastSeenStore(storage: KeyValueStore) {
  const values = new Map<string, Instant | null>();
  const loading = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  function load(userId: string): Promise<void> {
    if (values.has(userId)) return Promise.resolve();
    let p = loading.get(userId);
    if (!p) {
      p = storage
        .getItem(lastSeenKey(userId))
        .catch(() => null)
        .then((v) => {
          if (!values.has(userId)) values.set(userId, parseLastSeen(v));
          emit();
        });
      loading.set(userId, p);
    }
    return p;
  }

  return {
    /** The value, `undefined` until it has loaded. */
    get(userId: string): Instant | null | undefined {
      return values.get(userId);
    },
    load,
    /** Moves "last seen" forward (never back) and saves it. */
    async markSeen(userId: string, at: Instant): Promise<void> {
      await load(userId);
      const current = values.get(userId) ?? null;
      const next = laterOf(current, at);
      if (next === current) return;
      values.set(userId, next);
      emit();
      try {
        if (next) await storage.setItem(lastSeenKey(userId), next);
      } catch {
        // Not saved: it's only a convenience.
      }
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
