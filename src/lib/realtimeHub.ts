/**
 * Shared Supabase Realtime subscriptions.
 *
 * realtime-js returns the *existing* channel when a topic name is reused, and adding
 * `postgres_changes` callbacks to a channel that is joining or joined throws. Two mounted
 * screens that subscribe to the same thing (the Group screen under the Assignment screen,
 * or the Home, Schedule and Activity tabs) therefore used to crash the app, and the first
 * one to unmount removed the channel the other was still using.
 *
 * The hub keeps one channel per distinct set of bindings (table + filter), counts the
 * subscribers, fans each change out to all of them and removes the channel only when the
 * last one leaves (after a short grace period, so StrictMode's double mount and quick
 * back-and-forth navigation reuse the channel). Every channel it creates gets a new topic
 * name, so it never collides with a channel that is still being removed.
 *
 * This file is pure (no Supabase import) so it can be unit-tested with a fake client.
 */

export type ChangeEvent = '*' | 'INSERT' | 'UPDATE' | 'DELETE';

/** One `postgres_changes` binding. */
export type PgBinding = {
  event: ChangeEvent;
  schema: string;
  table: string;
  filter?: string;
};

export type ChangeListener = (payload: unknown) => void;

/** The parts of a realtime-js channel the hub uses. */
export type ChannelLike = {
  on(type: 'postgres_changes', filter: PgBinding, callback: (payload: unknown) => void): ChannelLike;
  subscribe(): unknown;
};

/** The parts of a Supabase client the hub uses. */
export type RealtimeClientLike = {
  channel(name: string): ChannelLike;
  removeChannel(channel: ChannelLike): Promise<unknown> | unknown;
};

export type RealtimeHubOptions = {
  /** How long a channel with no subscribers is kept before it's removed. */
  releaseDelayMs?: number;
  /** Reports failures (creating or removing a channel). Never throws into React. */
  onError?: (message: string, error: unknown) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export type RealtimeHub = {
  /**
   * Listens for changes matching `bindings`. Returns an idempotent unsubscribe function.
   * `label` only names the channel (for debugging); subscribers with the same bindings
   * share one channel whatever their labels.
   */
  subscribe(label: string, bindings: PgBinding[], listener: ChangeListener): () => void;
  /** Removes every channel and forgets every subscriber (sign-out). */
  removeAll(): void;
  /** Open channels, for tests and debugging. */
  channelCount(): number;
};

type Entry = {
  key: string;
  channel: ChannelLike | null;
  listeners: Set<ChangeListener>;
  releaseTimer: unknown;
};

/** A stable key for a set of bindings (order of bindings and of their fields doesn't matter). */
export function bindingsKey(bindings: PgBinding[]): string {
  return bindings
    .map((b) => JSON.stringify([b.event, b.schema, b.table, b.filter ?? '']))
    .sort()
    .join('|');
}

export function createRealtimeHub(client: RealtimeClientLike, options: RealtimeHubOptions = {}): RealtimeHub {
  const releaseDelayMs = options.releaseDelayMs ?? 1000;
  const onError = options.onError ?? ((message, error) => console.warn(message, error));
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const entries = new Map<string, Entry>();
  let seq = 0;

  function removeChannel(channel: ChannelLike | null) {
    if (!channel) return;
    try {
      const result = client.removeChannel(channel);
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        (result as Promise<unknown>).catch((error) => onError('Removing a realtime channel failed', error));
      }
    } catch (error) {
      onError('Removing a realtime channel failed', error);
    }
  }

  function teardown(entry: Entry) {
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
    if (entry.releaseTimer !== null) clearTimer(entry.releaseTimer);
    entry.releaseTimer = null;
    entry.listeners.clear();
    removeChannel(entry.channel);
    entry.channel = null;
  }

  function open(label: string, key: string, bindings: PgBinding[]): Entry {
    const entry: Entry = { key, channel: null, listeners: new Set(), releaseTimer: null };
    const fanOut = (payload: unknown) => {
      for (const listener of [...entry.listeners]) {
        try {
          listener(payload);
        } catch (error) {
          onError('A realtime listener failed', error);
        }
      }
    };
    // A fresh topic every time: realtime-js would otherwise hand back a channel with the
    // same name that is still joined (or still being removed).
    const topic = `${label}#${++seq}`;
    let channel: ChannelLike | null = null;
    try {
      channel = client.channel(topic);
      for (const binding of bindings) channel = channel.on('postgres_changes', { ...binding }, fanOut);
      channel.subscribe();
    } catch (error) {
      // Live updates are a nicety: never let them take the screen down.
      onError('Subscribing to realtime changes failed', error);
      removeChannel(channel);
      channel = null;
    }
    entry.channel = channel;
    entries.set(key, entry);
    return entry;
  }

  return {
    subscribe(label, bindings, listener) {
      if (bindings.length === 0) return () => {};
      const key = bindingsKey(bindings);
      let entry = entries.get(key);
      if (!entry) entry = open(label, key, bindings);
      if (entry.releaseTimer !== null) {
        clearTimer(entry.releaseTimer);
        entry.releaseTimer = null;
      }
      // Wrapped so the same function can subscribe twice (e.g. two hooks sharing a callback).
      const own: ChangeListener = (payload) => listener(payload);
      entry.listeners.add(own);
      const mine = entry;
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        mine.listeners.delete(own);
        // Torn down already (sign-out), or replaced by a newer entry for the same key.
        if (entries.get(mine.key) !== mine || mine.listeners.size > 0) return;
        if (releaseDelayMs <= 0) {
          teardown(mine);
          return;
        }
        mine.releaseTimer = setTimer(() => {
          mine.releaseTimer = null;
          if (mine.listeners.size === 0) teardown(mine);
        }, releaseDelayMs);
      };
    },
    removeAll() {
      for (const entry of [...entries.values()]) teardown(entry);
    },
    channelCount() {
      return entries.size;
    },
  };
}
